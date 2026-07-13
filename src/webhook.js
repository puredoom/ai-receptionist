// Handles Vapi server messages during live calls. The calendar client is
// injected so tests can run against a fake calendar.
import { cfg } from './config.js';
import { tenants, bookings, messages, calls } from './db.js';
import {
  freeSlots, filterSlots, formatSlotNl, withinOpeningHours, wallToUtc, utcToWall,
} from './slots.js';

const DAYS_NL = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];

export function createWebhookHandler(calendar, now = () => Date.now()) {
  async function runTool(tenant, name, args) {
    switch (name) {
      case 'getCurrentDateTime': {
        const w = utcToWall(now(), tenant.timezone);
        const dowIdx = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(w.dow);
        const iso = `${w.y}-${String(w.mo).padStart(2,'0')}-${String(w.d).padStart(2,'0')}`;
        return `Vandaag is ${DAYS_NL[dowIdx]} ${iso}. De tijd is ${String(w.hh).padStart(2,'0')}:${String(w.mm).padStart(2,'0')} (${tenant.timezone}).`;
      }

      case 'checkAvailability': {
        const from = now();
        const to = from + (tenant.horizon_days + 1) * 86_400_000;
        const busy = await calendar.getBusy(tenant, from, to);
        let slots = freeSlots(tenant, busy, from);
        slots = filterSlots(slots, tenant.timezone, {
          date: args.date || undefined,
          dayPart: args.dayPart || undefined,
        });
        if (!slots.length) {
          // nothing on the requested day/part: offer nearest alternatives instead
          const all = freeSlots(tenant, busy, from);
          if (!all.length) return 'Er is de komende periode helaas geen enkele vrije plek in de agenda.';
          const alts = all.slice(0, 3).map(s => formatSlotNl(s.start, tenant.timezone));
          return `Op het gevraagde moment is er niets vrij. Dichtstbijzijnde opties: ${alts.join('; ')}.`;
        }
        const shown = slots.slice(0, 5).map(s => formatSlotNl(s.start, tenant.timezone));
        return `Beschikbare tijden: ${shown.join('; ')}.`;
      }

      case 'bookAppointment': {
        const { name: custName, phone, date, time, service, notes } = args;
        if (!custName || !date || !time) {
          return 'FOUT: naam, datum (JJJJ-MM-DD) en tijd (UU:MM) zijn verplicht om te boeken.';
        }
        const [y, mo, d] = date.split('-').map(Number);
        const [hh, mm] = time.split(':').map(Number);
        if (![y, mo, d, hh, mm].every(Number.isFinite)) {
          return 'FOUT: datum of tijd heeft een ongeldig formaat. Gebruik JJJJ-MM-DD en UU:MM.';
        }
        const startMs = wallToUtc(y, mo, d, hh, mm, tenant.timezone);
        const endMs = startMs + tenant.slot_minutes * 60_000;

        if (startMs < now() + tenant.min_notice_hours * 3_600_000) {
          return 'FOUT: dit tijdstip is te kort dag of ligt in het verleden. Kies een later moment.';
        }
        if (!withinOpeningHours(tenant, startMs, endMs)) {
          return 'FOUT: dit tijdstip valt buiten de openingstijden. Gebruik checkAvailability voor geldige opties.';
        }
        const busy = await calendar.getBusy(tenant, startMs - 1, endMs + 1);
        if (busy.some(b => startMs < b.end && endMs > b.start)) {
          return 'FOUT: dit tijdstip is zojuist bezet geraakt. Gebruik checkAvailability voor alternatieven.';
        }

        const eventId = await calendar.createEvent(tenant, {
          summary: `Afspraak: ${custName}${service ? ` — ${service}` : ''}`,
          description: [
            `Geboekt via AI-receptionist.`,
            `Naam: ${custName}`,
            phone ? `Telefoon: ${phone}` : null,
            service ? `Dienst: ${service}` : null,
            notes ? `Notities: ${notes}` : null,
          ].filter(Boolean).join('\n'),
          startMs, endMs,
        });
        bookings.create({
          tenant_id: tenant.id, customer_name: custName, customer_phone: phone ?? '',
          service: service ?? '', start_utc: startMs, end_utc: endMs, gcal_event_id: eventId,
        });
        return `GELUKT: afspraak bevestigd op ${formatSlotNl(startMs, tenant.timezone)} voor ${custName}.`;
      }

      case 'takeMessage': {
        if (!args.message) return 'FOUT: er is nog geen boodschap om te noteren.';
        messages.create({
          tenant_id: tenant.id, customer_name: args.name ?? '',
          customer_phone: args.phone ?? '', message: args.message,
        });
        return 'GELUKT: het bericht is genoteerd. Er wordt zo snel mogelijk teruggebeld.';
      }

      default:
        return `FOUT: onbekende functie ${name}.`;
    }
  }

  return async function handle(req, res) {
    if (cfg.vapiWebhookSecret && req.headers['x-vapi-secret'] !== cfg.vapiWebhookSecret) {
      return res.status(401).json({ error: 'bad secret' });
    }
    const msg = req.body?.message;
    if (!msg?.type) return res.json({});

    // Identify the tenant from the assistant on the call (paths differ across Vapi versions)
    const assistantId = msg.call?.assistantId || msg.assistant?.id || msg.call?.assistant?.id;
    const tenant = assistantId ? tenants.byAssistant(assistantId) : null;

    if (msg.type === 'tool-calls') {
      const toolCalls = msg.toolCallList || msg.toolCalls || [];
      if (!tenant) {
        return res.json({
          results: toolCalls.map(tc => ({
            toolCallId: tc.id,
            result: 'FOUT: configuratieprobleem, dit nummer is niet gekoppeld. Bied aan een bericht door te geven via het bedrijf zelf.',
          })),
        });
      }
      const results = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name || tc.name;
        let args = tc.function?.arguments ?? tc.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        let result;
        try {
          result = await runTool(tenant, name, args);
        } catch (err) {
          console.error(`tool ${name} failed for tenant ${tenant.id}:`, err);
          result = 'FOUT: er ging technisch iets mis. Bied aan een bericht aan te nemen.';
        }
        results.push({ toolCallId: tc.id, result });
      }
      return res.json({ results });
    }

    if (msg.type === 'end-of-call-report') {
      calls.create({
        tenant_id: tenant?.id ?? null,
        vapi_call_id: msg.call?.id ?? null,
        ended_reason: msg.endedReason ?? null,
        summary: msg.summary ?? msg.analysis?.summary ?? null,
        transcript: msg.transcript ?? null,
      });
      return res.json({});
    }

    return res.json({}); // status updates etc.
  };
}
