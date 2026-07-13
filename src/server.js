import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.js';
import { tenants, bookings, messages, calls, blocks, leads, oauthStates } from './db.js';
import { calendarApi, oauthStartUrl, exchangeCode, saveRefreshToken } from './calendar.js';
import { createWebhookHandler } from './webhook.js';
import { provisionAssistant } from './vapi.js';
import { buildIcsFeed } from './ics.js';
import { wallToUtc } from './slots.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(pub)); // serves index.html (marketing site) at /

app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));

// ---------- Vapi webhook (called during live phone calls) ----------
app.post('/webhook/vapi', createWebhookHandler(calendarApi));

// ---------- Public: lead capture from the marketing site ----------
app.post('/api/leads', (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim() && !b.email?.trim() && !b.phone?.trim()) {
    return res.status(400).json({ error: 'name, email or phone is required' });
  }
  const clip = (s, n) => String(s ?? '').slice(0, n);
  leads.create({
    name: clip(b.name, 200), business: clip(b.business, 200), email: clip(b.email, 200),
    phone: clip(b.phone, 50), message: clip(b.message, 2000), plan: clip(b.plan, 50),
  });
  res.json({ ok: true });
});

// ---------- Admin auth ----------
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!cfg.adminKey || key !== cfg.adminKey) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---------- Admin: tenants ----------
app.get('/api/tenants', requireAdmin, (req, res) => {
  res.json(tenants.list().map(redactTenant));
});

app.post('/api/tenants', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try { validateTenantFields(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json(redactTenant(tenants.create(req.body)));
});

app.put('/api/tenants/:id', requireAdmin, (req, res) => {
  const t = tenants.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'not found' });
  try { validateTenantFields(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json(redactTenant(tenants.update(t.id, req.body)));
});

app.get('/api/tenants/:id/bookings', requireAdmin, (req, res) => res.json(bookings.forTenant(Number(req.params.id))));
app.get('/api/tenants/:id/messages', requireAdmin, (req, res) => res.json(messages.forTenant(Number(req.params.id))));
app.get('/api/tenants/:id/calls', requireAdmin, (req, res) => res.json(calls.forTenant(Number(req.params.id))));
app.get('/api/leads', requireAdmin, (req, res) => res.json(leads.list()));

app.post('/api/tenants/:id/provision', requireAdmin, async (req, res) => {
  const t = tenants.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'not found' });
  try {
    const assistant = await provisionAssistant(t);
    if (assistant?.id && assistant.id !== t.vapi_assistant_id) {
      tenants.update(t.id, { vapi_assistant_id: assistant.id });
    }
    res.json({ ok: true, assistantId: assistant.id });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get('/api/tenants/:id/availability', requireAdmin, async (req, res) => {
  const t = tenants.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'not found' });
  try {
    const { freeSlots, formatSlotNl } = await import('./slots.js');
    const from = Date.now();
    const busy = await calendarApi.getBusy(t, from, from + (t.horizon_days + 1) * 86_400_000);
    const slots = freeSlots(t, busy, from).slice(0, 20);
    res.json(slots.map(s => ({ start: s.start, label: formatSlotNl(s.start, t.timezone) })));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---------- Google OAuth (per tenant, optional) ----------
app.get('/oauth/google/start', requireAdmin, (req, res) => {
  const tenantId = Number(req.query.tenant);
  if (!tenants.get(tenantId)) return res.status(404).send('tenant not found');
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.create(state, tenantId);
  res.redirect(oauthStartUrl(state));
});

app.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google error: ${error}`);
  const st = state && oauthStates.consume(String(state));
  if (!st) return res.status(400).send('Invalid or expired state. Start the connection again from the dashboard.');
  try {
    const tokens = await exchangeCode(String(code));
    if (!tokens.refresh_token) {
      return res.status(400).send('Google did not return a refresh token. Remove the app\'s access at myaccount.google.com/permissions and try again.');
    }
    saveRefreshToken(st.tenant_id, tokens.refresh_token);
    tenants.update(st.tenant_id, { calendar_mode: 'google' });
    res.send('<h2>Agenda gekoppeld ✔</h2><p>Je kunt dit venster sluiten.</p>');
  } catch (err) {
    res.status(502).send(`Token exchange failed: ${String(err.message || err)}`);
  }
});

// ---------- Client portal (magic-link auth via portal token) ----------
function portalTenant(req, res) {
  const t = tenants.byPortalToken(String(req.params.token || ''));
  if (!t) { res.status(404).json({ error: 'unknown portal link' }); return null; }
  return t;
}

app.get('/portal/:token', (req, res) => {
  if (!tenants.byPortalToken(String(req.params.token))) {
    return res.status(404).send('<h2>Onbekende link</h2><p>Controleer de portal-link die u ontving.</p>');
  }
  res.sendFile(path.join(pub, 'portal.html'));
});

app.get('/portal/:token/api/overview', (req, res) => {
  const t = portalTenant(req, res); if (!t) return;
  const now = Date.now();
  res.json({
    business: {
      name: t.name, language: t.language, timezone: t.timezone,
      slot_minutes: t.slot_minutes, services: t.services,
      opening_hours: JSON.parse(t.opening_hours),
      calendar_mode: t.calendar_mode, ics_import_url: t.ics_import_url,
      ai_active: Boolean(t.vapi_assistant_id),
    },
    upcoming: bookings.forTenant(t.id).filter(b => b.end_utc >= now).sort((a, b) => a.start_utc - b.start_utc),
    past: bookings.forTenant(t.id).filter(b => b.end_utc < now).slice(0, 25),
    messages: messages.forTenant(t.id).slice(0, 50),
    calls: calls.forTenant(t.id).slice(0, 25),
    blocks: blocks.forTenant(t.id).filter(b => b.end_utc >= now),
  });
});

app.post('/portal/:token/api/blocks', (req, res) => {
  const t = portalTenant(req, res); if (!t) return;
  const { date, from, to, reason } = req.body || {};
  const dm = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const fm = String(from || '').match(/^(\d{2}):(\d{2})$/);
  const tm = String(to || '').match(/^(\d{2}):(\d{2})$/);
  if (!dm || !fm || !tm) return res.status(400).json({ error: 'date (YYYY-MM-DD), from and to (HH:MM) are required' });
  const start = wallToUtc(+dm[1], +dm[2], +dm[3], +fm[1], +fm[2], t.timezone);
  const end = wallToUtc(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], t.timezone);
  if (end <= start) return res.status(400).json({ error: 'end time must be after start time' });
  const id = blocks.create({ tenant_id: t.id, start_utc: start, end_utc: end, reason: String(reason || '').slice(0, 200) });
  res.json({ ok: true, id });
});

app.delete('/portal/:token/api/blocks/:id', (req, res) => {
  const t = portalTenant(req, res); if (!t) return;
  blocks.remove(Number(req.params.id), t.id);
  res.json({ ok: true });
});

app.post('/portal/:token/api/bookings/:id/cancel', async (req, res) => {
  const t = portalTenant(req, res); if (!t) return;
  const b = bookings.get(Number(req.params.id));
  if (!b || b.tenant_id !== t.id) return res.status(404).json({ error: 'booking not found' });
  try { await calendarApi.deleteEvent(t, b.gcal_event_id); } catch (err) {
    console.error(`gcal delete failed for booking ${b.id}:`, err.message);
  }
  bookings.remove(b.id);
  res.json({ ok: true });
});

app.post('/portal/:token/api/settings', (req, res) => {
  const t = portalTenant(req, res); if (!t) return;
  const url = String(req.body?.ics_import_url ?? '').trim().slice(0, 500);
  if (url && !/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    return res.status(400).json({ error: 'de agenda-link moet met https:// of webcal:// beginnen' });
  }
  tenants.update(t.id, { ics_import_url: url.replace(/^webcal:\/\//i, 'https://') });
  res.json({ ok: true });
});

app.get('/portal/:token/calendar.ics', (req, res) => {
  const t = tenants.byPortalToken(String(req.params.token));
  if (!t) return res.status(404).send('unknown');
  res.type('text/calendar').send(buildIcsFeed(t, bookings.forTenant(t.id), blocks.forTenant(t.id)));
});

// ---------- helpers ----------
function redactTenant(t) {
  const { google_refresh_token, ...rest } = t;
  return {
    ...rest,
    google_connected: Boolean(google_refresh_token),
    portal_url: `${cfg.baseUrl}/portal/${t.portal_token}`,
  };
}

function validateTenantFields(body) {
  if (body.opening_hours) {
    let oh = body.opening_hours;
    if (typeof oh === 'string') oh = JSON.parse(oh); // throws on bad JSON
    const days = ['mon','tue','wed','thu','fri','sat','sun'];
    for (const [day, windows] of Object.entries(oh)) {
      if (!days.includes(day)) throw new Error(`unknown day "${day}" in opening_hours`);
      for (const w of windows) {
        if (!Array.isArray(w) || w.length !== 2 || !/^\d{2}:\d{2}$/.test(w[0]) || !/^\d{2}:\d{2}$/.test(w[1])) {
          throw new Error(`opening_hours for ${day} must be pairs like ["09:00","17:00"]`);
        }
      }
    }
    if (typeof body.opening_hours !== 'string') body.opening_hours = JSON.stringify(oh);
  }
  for (const k of ['slot_minutes', 'min_notice_hours', 'horizon_days']) {
    if (body[k] != null && (!Number.isInteger(Number(body[k])) || Number(body[k]) < 0)) {
      throw new Error(`${k} must be a non-negative integer`);
    }
  }
  if (body.language && !['nl', 'fr', 'en', 'de', 'lt'].includes(body.language)) {
    throw new Error('language must be one of: nl, fr, en, de, lt');
  }
  if (body.calendar_mode && !['internal', 'google'].includes(body.calendar_mode)) {
    throw new Error('calendar_mode must be internal or google');
  }
  if (body.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); }
    catch { throw new Error(`invalid timezone "${body.timezone}"`); }
  }
}

app.listen(cfg.port, () => {
  console.log(`AI receptionist server on ${cfg.baseUrl} (port ${cfg.port})`);
  console.log(`  marketing site:  ${cfg.baseUrl}/`);
  console.log(`  admin dashboard: ${cfg.baseUrl}/admin`);
  if (!cfg.adminKey) console.warn('WARNING: ADMIN_KEY is empty — admin API is locked out. Set it in .env');
});
