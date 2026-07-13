// Handles Vapi server messages during live calls. The calendar client is
// injected so tests can run against a fake calendar. All caller-facing tool
// results are localized to the tenant's language via i18n.js.
import { cfg } from './config.js';
import { tenants, bookings, messages, calls } from './db.js';
import {
  freeSlots, filterSlots, withinOpeningHours, wallToUtc, utcToWall,
} from './slots.js';
import { lang, str, formatSlot, dayName } from './i18n.js';

export function createWebhookHandler(calendar, now = () => Date.now()) {
  async function runTool(tenant, name, args) {
    const l = lang(tenant);
    const s = str(l);

    switch (name) {
      case 'getCurrentDateTime': {
        const w = utcToWall(now(), tenant.timezone);
        const iso = `${w.y}-${String(w.mo).padStart(2,'0')}-${String(w.d).padStart(2,'0')}`;
        const hhmm = `${String(w.hh).padStart(2,'0')}:${String(w.mm).padStart(2,'0')}`;
        return s.today(dayName(w.dow, l), iso, hhmm, tenant.timezone);
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
          const all = freeSlots(tenant, busy, from);
          if (!all.length) return s.noneAtAll;
          const alts = all.slice(0, 3).map(x => formatSlot(x.start, tenant.timezone, l));
          return s.noneRequested(alts.join('; '));
        }
        const shown = slots.slice(0, 5).map(x => formatSlot(x.start, tenant.timezone, l));
        return s.available(shown.join('; '));
      }

      case 'bookAppointment': {
        const { name: custName, phone, date, time, service, notes } = args;
        if (!custName || !date || !time) return s.errMissing;
        const [y, mo, d] = date.split('-').map(Number);
        const [hh, mm] = time.split(':').map(Number);
        if (![y, mo, d, hh, mm].every(Number.isFinite)) return s.errFormat;
        const startMs = wallToUtc(y, mo, d, hh, mm, tenant.timezone);
        const endMs = startMs + tenant.slot_minutes * 60_000;

        if (startMs < now() + tenant.min_notice_hours * 3_600_000) return s.errTooSoon;
        if (!withinOpeningHours(tenant, startMs, endMs)) return s.errOutsideHours;
        const busy = await calendar.getBusy(tenant, startMs - 1, endMs + 1);
        if (busy.some(b => startMs < b.end && endMs > b.start)) return s.errTaken;

        const D = s.eventDesc;
        const eventId = await calendar.createEvent(tenant, {
          summary: s.eventTitle(custName, service),
          description: [
            D.via,
            `${D.name}: ${custName}`,
            phone ? `${D.phone}: ${phone}` : null,
            service ? `${D.service}: ${service}` : null,
            notes ? `${D.notes}: ${notes}` : null,
          ].filter(Boolean).join('\n'),
          startMs, endMs,
        });
        bookings.create({
          tenant_id: tenant.id, customer_name: custName, customer_phone: phone ?? '',
          service: service ?? '', start_utc: startMs, end_utc: endMs, gcal_event_id: eventId,
        });
        return s.booked(formatSlot(startMs, tenant.timezone, l), custName);
      }

      case 'takeMessage': {
        if (!args.message) return s.errNoMessage;
        messages.create({
          tenant_id: tenant.id, customer_name: args.name ?? '',
          customer_phone: args.phone ?? '', message: args.message,
        });
        return s.messageTaken;
      }

      default:
        return s.errUnknownTool(name);
    }
  }

  return async function handle(req, res) {
    if (cfg.vapiWebhookSecret && req.headers['x-vapi-secret'] !== cfg.vapiWebhookSecret) {
      console.warn('webhook rejected: x-vapi-secret mismatch — if this happens during real calls, click "Update AI" in the dashboard to re-sync the assistant with the current VAPI_WEBHOOK_SECRET');
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
          results: toolCalls.map(tc => ({ toolCallId: tc.id, result: str('nl').errNotLinked })),
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
          const s = str(lang(tenant));
          result = String(err.message || '').includes('no Google Calendar connected')
            ? s.errNoCalendar
            : s.errTechnical;
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

    return res.json({});
  };
}
