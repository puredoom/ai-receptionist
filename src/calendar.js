// Google Calendar via REST (no SDK). Each tenant connects their own Google
// account through OAuth; we store the refresh token and mint access tokens on demand.
import { cfg } from './config.js';
import { tenants } from './db.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

export function oauthStartUrl(state) {
  const p = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: `${cfg.baseUrl}/oauth/google/callback`,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${p}`;
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      redirect_uri: `${cfg.baseUrl}/oauth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, ... }
}

const accessTokenCache = new Map(); // tenantId -> { token, expiresAt }

async function accessToken(tenant) {
  const cached = accessTokenCache.get(tenant.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!tenant.google_refresh_token) throw new Error(`Tenant ${tenant.id} has no Google Calendar connected`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tenant.google_refresh_token,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  accessTokenCache.set(tenant.id, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

// ---------- internal (built-in) agenda: bookings + blocks + optional ICS import ----------
import { bookings, blocks } from './db.js';
import { fetchIcsBusy } from './ics.js';

async function internalBusy(tenant, fromMs, toMs) {
  const busy = [
    ...bookings.overlapping(tenant.id, fromMs, toMs).map(b => ({ start: b.start_utc, end: b.end_utc })),
    ...blocks.overlapping(tenant.id, fromMs, toMs).map(b => ({ start: b.start_utc, end: b.end_utc })),
  ];
  if (tenant.ics_import_url) {
    try {
      const feed = await fetchIcsBusy(tenant.ics_import_url);
      busy.push(...feed.filter(e => e.start < toMs && e.end > fromMs));
    } catch (err) {
      // an unreachable feed must not break live calls; log and continue with what we have
      console.error(`ICS import failed for tenant ${tenant.id}:`, err.message);
    }
  }
  return busy;
}

export const calendarApi = {
  /** Busy intervals [{start, end}] in UTC ms between two timestamps. */
  async getBusy(tenant, fromMs, toMs) {
    if (tenant.calendar_mode !== 'google') return internalBusy(tenant, fromMs, toMs);
    const token = await accessToken(tenant);
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        items: [{ id: tenant.google_calendar_id || 'primary' }],
      }),
    });
    if (!res.ok) throw new Error(`freeBusy failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const cal = Object.values(data.calendars || {})[0];
    return (cal?.busy || []).map(b => ({
      start: Date.parse(b.start),
      end: Date.parse(b.end),
    }));
  },

  /** Create an event; returns the Google event id (null in internal mode — the booking row is the source of truth). */
  async createEvent(tenant, { summary, description, startMs, endMs }) {
    if (tenant.calendar_mode !== 'google') return null;
    const token = await accessToken(tenant);
    const calId = encodeURIComponent(tenant.google_calendar_id || 'primary');
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: new Date(startMs).toISOString(), timeZone: tenant.timezone },
        end: { dateTime: new Date(endMs).toISOString(), timeZone: tenant.timezone },
      }),
    });
    if (!res.ok) throw new Error(`event insert failed: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
  },

  /** Delete an event (used when a booking is cancelled in google mode). Best effort. */
  async deleteEvent(tenant, eventId) {
    if (tenant.calendar_mode !== 'google' || !eventId) return;
    const token = await accessToken(tenant);
    const calId = encodeURIComponent(tenant.google_calendar_id || 'primary');
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};

export function saveRefreshToken(tenantId, refreshToken) {
  tenants.update(tenantId, { google_refresh_token: refreshToken });
  accessTokenCache.delete(tenantId);
}
