import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
export const db = new DatabaseSync(cfg.dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  opening_hours TEXT NOT NULL DEFAULT '{"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[["09:00","17:00"]],"sat":[],"sun":[]}',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  horizon_days INTEGER NOT NULL DEFAULT 14,
  services TEXT NOT NULL DEFAULT '',
  extra_info TEXT NOT NULL DEFAULT '',
  formality TEXT NOT NULL DEFAULT 'u',
  voice_id TEXT NOT NULL DEFAULT '',
  google_refresh_token TEXT,
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  vapi_assistant_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  start_utc INTEGER NOT NULL,
  end_utc INTEGER NOT NULL,
  gcal_event_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  vapi_call_id TEXT,
  ended_reason TEXT,
  summary TEXT,
  transcript TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

export const tenants = {
  create(t) {
    const stmt = db.prepare(
      `INSERT INTO tenants (name, timezone, opening_hours, slot_minutes, min_notice_hours,
        horizon_days, services, extra_info, formality, voice_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const r = stmt.run(
      t.name, t.timezone || 'Europe/Amsterdam',
      t.opening_hours || defaultHours(),
      t.slot_minutes ?? 30, t.min_notice_hours ?? 2, t.horizon_days ?? 14,
      t.services ?? '', t.extra_info ?? '', t.formality ?? 'u', t.voice_id ?? ''
    );
    return this.get(Number(r.lastInsertRowid));
  },
  get(id) { return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id); },
  byAssistant(assistantId) {
    return db.prepare('SELECT * FROM tenants WHERE vapi_assistant_id = ?').get(assistantId);
  },
  list() { return db.prepare('SELECT * FROM tenants ORDER BY id').all(); },
  update(id, fields) {
    const allowed = ['name','timezone','opening_hours','slot_minutes','min_notice_hours',
      'horizon_days','services','extra_info','formality','voice_id',
      'google_refresh_token','google_calendar_id','vapi_assistant_id'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (!keys.length) return this.get(id);
    const sql = `UPDATE tenants SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map(k => fields[k]), id);
    return this.get(id);
  },
};

function defaultHours() {
  return JSON.stringify({
    mon: [['09:00','17:00']], tue: [['09:00','17:00']], wed: [['09:00','17:00']],
    thu: [['09:00','17:00']], fri: [['09:00','17:00']], sat: [], sun: [],
  });
}

export const bookings = {
  create(b) {
    const r = db.prepare(
      `INSERT INTO bookings (tenant_id, customer_name, customer_phone, service, start_utc, end_utc, gcal_event_id)
       VALUES (?,?,?,?,?,?,?)`
    ).run(b.tenant_id, b.customer_name, b.customer_phone ?? '', b.service ?? '', b.start_utc, b.end_utc, b.gcal_event_id ?? null);
    return Number(r.lastInsertRowid);
  },
  forTenant(tenantId) {
    return db.prepare('SELECT * FROM bookings WHERE tenant_id = ? ORDER BY start_utc DESC LIMIT 200').all(tenantId);
  },
};

export const messages = {
  create(m) {
    const r = db.prepare(
      'INSERT INTO messages (tenant_id, customer_name, customer_phone, message) VALUES (?,?,?,?)'
    ).run(m.tenant_id, m.customer_name ?? '', m.customer_phone ?? '', m.message);
    return Number(r.lastInsertRowid);
  },
  forTenant(tenantId) {
    return db.prepare('SELECT * FROM messages WHERE tenant_id = ? ORDER BY id DESC LIMIT 200').all(tenantId);
  },
};

export const calls = {
  create(c) {
    const r = db.prepare(
      'INSERT INTO calls (tenant_id, vapi_call_id, ended_reason, summary, transcript) VALUES (?,?,?,?,?)'
    ).run(c.tenant_id ?? null, c.vapi_call_id ?? null, c.ended_reason ?? null, c.summary ?? null, c.transcript ?? null);
    return Number(r.lastInsertRowid);
  },
  forTenant(tenantId) {
    return db.prepare('SELECT * FROM calls WHERE tenant_id = ? ORDER BY id DESC LIMIT 200').all(tenantId);
  },
};

export const oauthStates = {
  create(state, tenantId) {
    db.prepare('INSERT INTO oauth_states (state, tenant_id) VALUES (?,?)').run(state, tenantId);
  },
  consume(state) {
    const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state);
    if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    // states older than 15 minutes are invalid
    if (row && Date.now() / 1000 - row.created_at > 900) return null;
    return row;
  },
};
