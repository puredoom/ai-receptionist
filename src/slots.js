// Availability engine. Pure logic, no I/O — unit-testable.
// All timestamps are UTC milliseconds; wall-clock math respects the tenant timezone
// (including DST) via the Intl API, so no date library is needed.

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Offset (ms) of `timeZone` from UTC at instant `ms`. Positive = east of UTC. */
function tzOffset(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Convert a wall-clock time in `timeZone` to a UTC timestamp (ms). */
export function wallToUtc(y, mo, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let off = tzOffset(guess, timeZone);
  off = tzOffset(guess - off, timeZone); // second pass handles DST boundaries
  return guess - off;
}

/** Wall-clock fields of a UTC timestamp in `timeZone`. */
export function utcToWall(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {
    y: +p.year, mo: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute,
    dow: p.weekday.toLowerCase().slice(0, 3),
  };
}

/**
 * Generate free appointment slots.
 * @param tenant  { timezone, opening_hours (JSON), slot_minutes, min_notice_hours, horizon_days }
 * @param busy    [{ start, end }] UTC ms intervals from the calendar
 * @param nowMs   current time (injectable for tests)
 * @returns       array of { start, end } UTC ms, ascending
 */
export function freeSlots(tenant, busy, nowMs = Date.now()) {
  const tz = tenant.timezone;
  const opening = typeof tenant.opening_hours === 'string'
    ? JSON.parse(tenant.opening_hours) : tenant.opening_hours;
  const slotMs = tenant.slot_minutes * 60_000;
  const earliest = nowMs + tenant.min_notice_hours * 3_600_000;
  const out = [];

  for (let i = 0; i <= tenant.horizon_days; i++) {
    const w = utcToWall(nowMs + i * 86_400_000, tz);
    for (const [startHm, endHm] of opening[w.dow] || []) {
      const [sh, sm] = startHm.split(':').map(Number);
      const [eh, em] = endHm.split(':').map(Number);
      const windowEnd = wallToUtc(w.y, w.mo, w.d, eh, em, tz);
      for (let t = wallToUtc(w.y, w.mo, w.d, sh, sm, tz); t + slotMs <= windowEnd; t += slotMs) {
        if (t < earliest) continue;
        if (busy.some(b => t < b.end && t + slotMs > b.start)) continue;
        out.push({ start: t, end: t + slotMs });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** True if [startMs, endMs) falls inside the tenant's opening hours. */
export function withinOpeningHours(tenant, startMs, endMs) {
  const tz = tenant.timezone;
  const opening = typeof tenant.opening_hours === 'string'
    ? JSON.parse(tenant.opening_hours) : tenant.opening_hours;
  const w = utcToWall(startMs, tz);
  return (opening[w.dow] || []).some(([startHm, endHm]) => {
    const [sh, sm] = startHm.split(':').map(Number);
    const [eh, em] = endHm.split(':').map(Number);
    return startMs >= wallToUtc(w.y, w.mo, w.d, sh, sm, tz)
        && endMs <= wallToUtc(w.y, w.mo, w.d, eh, em, tz);
  });
}

// ---------- Dutch formatting ----------
const DAYS_NL = { sun: 'zondag', mon: 'maandag', tue: 'dinsdag', wed: 'woensdag',
                  thu: 'donderdag', fri: 'vrijdag', sat: 'zaterdag' };
const MONTHS_NL = ['januari','februari','maart','april','mei','juni','juli',
                   'augustus','september','oktober','november','december'];

export function formatSlotNl(ms, timeZone) {
  const w = utcToWall(ms, timeZone);
  const hh = String(w.hh).padStart(2, '0');
  const mm = String(w.mm).padStart(2, '0');
  return `${DAYS_NL[w.dow]} ${w.d} ${MONTHS_NL[w.mo - 1]} om ${hh}:${mm}`;
}

export function formatDateNl(ms, timeZone) {
  const w = utcToWall(ms, timeZone);
  return `${DAYS_NL[w.dow]} ${w.d} ${MONTHS_NL[w.mo - 1]} ${w.y}`;
}

/** Filter slots to a specific wall-clock date ('YYYY-MM-DD') and/or day part. */
export function filterSlots(slots, timeZone, { date, dayPart } = {}) {
  return slots.filter(s => {
    const w = utcToWall(s.start, timeZone);
    if (date) {
      const iso = `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
      if (iso !== date) return false;
    }
    if (dayPart === 'morning' && w.hh >= 12) return false;
    if (dayPart === 'afternoon' && (w.hh < 12 || w.hh >= 17)) return false;
    if (dayPart === 'evening' && w.hh < 17) return false;
    return true;
  });
}
