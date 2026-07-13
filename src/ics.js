// Minimal ICS (iCalendar) support: parse external busy feeds and export bookings.
// Parsing covers plain VEVENTs (UTC "Z", TZID, and all-day dates). Recurring
// events (RRULE) are not expanded — documented limitation for import feeds.
import { wallToUtc } from './slots.js';

function unfold(text) {
  // continuation lines start with a space or tab
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function parseIcsDate(value, params) {
  // 20260720T090000Z | 20260720T090000 (+TZID) | 20260720 (all-day)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', , z] = m;
  if (z) return Date.UTC(+y, +mo - 1, +d, +hh, +mm);
  const tzid = /TZID=([^;:]+)/.exec(params || '')?.[1];
  if (tzid) {
    try { return wallToUtc(+y, +mo, +d, +hh, +mm, tzid); } catch { /* fall through */ }
  }
  return Date.UTC(+y, +mo - 1, +d, +hh, +mm); // best effort: treat as UTC
}

/** Parse ICS text into busy intervals [{start, end}] (UTC ms). */
export function parseIcsBusy(text) {
  const out = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.start != null) {
        out.push({ start: cur.start, end: cur.end ?? cur.start + 3_600_000 });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const m = line.match(/^(DTSTART|DTEND)([^:]*):(.+)$/);
    if (m) {
      const ms = parseIcsDate(m[3].trim(), m[2]);
      if (ms != null) cur[m[1] === 'DTSTART' ? 'start' : 'end'] = ms;
    }
    if (/^TRANSP:TRANSPARENT/.test(line) && cur) cur.transparent = true;
  }
  return out.filter(e => !e.transparent);
}

const feedCache = new Map(); // url -> { at, busy }
const FEED_TTL = 5 * 60_000;

/** Fetch + parse an external ICS busy feed, cached for 5 minutes. */
export async function fetchIcsBusy(url) {
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.at < FEED_TTL) return cached.busy;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ICS feed fetch failed: ${res.status}`);
  const busy = parseIcsBusy(await res.text());
  feedCache.set(url, { at: Date.now(), busy });
  return busy;
}

function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Export bookings + blocks as an ICS calendar (for subscribing from any calendar app). */
export function buildIcsFeed(tenant, bookingList, blockList) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ai-receptionist//NONSGML v1//EN',
    `X-WR-CALNAME:${icsEscape(tenant.name)} — afspraken`,
  ];
  for (const b of bookingList) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:booking-${b.id}@ai-receptionist`,
      `DTSTAMP:${icsStamp(b.created_at * 1000 || Date.now())}`,
      `DTSTART:${icsStamp(b.start_utc)}`,
      `DTEND:${icsStamp(b.end_utc)}`,
      `SUMMARY:${icsEscape(`${b.customer_name}${b.service ? ` — ${b.service}` : ''}`)}`,
      `DESCRIPTION:${icsEscape(`Tel: ${b.customer_phone}`)}`,
      'END:VEVENT',
    );
  }
  for (const bl of blockList) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:block-${bl.id}@ai-receptionist`,
      `DTSTAMP:${icsStamp(bl.created_at * 1000 || Date.now())}`,
      `DTSTART:${icsStamp(bl.start_utc)}`,
      `DTEND:${icsStamp(bl.end_utc)}`,
      `SUMMARY:${icsEscape(bl.reason || 'Geblokkeerd')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
