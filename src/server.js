import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.js';
import { tenants, bookings, messages, calls, oauthStates } from './db.js';
import { calendarApi, oauthStartUrl, exchangeCode, saveRefreshToken } from './calendar.js';
import { createWebhookHandler } from './webhook.js';
import { provisionAssistant } from './vapi.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(pub));

// ---------- Vapi webhook (called during live phone calls) ----------
app.post('/webhook/vapi', createWebhookHandler(calendarApi));

// ---------- Admin auth ----------
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!cfg.adminKey || key !== cfg.adminKey) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---------- Tenant API ----------
app.get('/api/tenants', requireAdmin, (req, res) => {
  res.json(tenants.list().map(redactTenant));
});

app.post('/api/tenants', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    validateTenantFields(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json(redactTenant(tenants.create(req.body)));
});

app.put('/api/tenants/:id', requireAdmin, (req, res) => {
  const t = tenants.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'not found' });
  try {
    validateTenantFields(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json(redactTenant(tenants.update(t.id, req.body)));
});

app.get('/api/tenants/:id/bookings', requireAdmin, (req, res) => {
  res.json(bookings.forTenant(Number(req.params.id)));
});
app.get('/api/tenants/:id/messages', requireAdmin, (req, res) => {
  res.json(messages.forTenant(Number(req.params.id)));
});
app.get('/api/tenants/:id/calls', requireAdmin, (req, res) => {
  res.json(calls.forTenant(Number(req.params.id)));
});

// Create/update the Vapi assistant for this tenant
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

// ---------- Google OAuth (per tenant) ----------
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
    res.send('<h2>Agenda gekoppeld ✔</h2><p>Je kunt dit venster sluiten en teruggaan naar het dashboard.</p>');
  } catch (err) {
    res.status(502).send(`Token exchange failed: ${String(err.message || err)}`);
  }
});

// Quick availability preview so you can sanity-check a tenant's agenda from the dashboard
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

function redactTenant(t) {
  const { google_refresh_token, ...rest } = t;
  return { ...rest, google_connected: Boolean(google_refresh_token) };
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
  if (body.language && !['nl', 'fr', 'en', 'de'].includes(body.language)) {
    throw new Error('language must be one of: nl, fr, en, de');
  }
  if (body.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); }
    catch { throw new Error(`invalid timezone "${body.timezone}"`); }
  }
}

app.listen(cfg.port, () => {
  console.log(`AI receptionist server on ${cfg.baseUrl} (port ${cfg.port})`);
  if (!cfg.adminKey) console.warn('WARNING: ADMIN_KEY is empty — admin API is locked out. Set it in .env');
});
