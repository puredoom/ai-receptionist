// End-to-end simulation of the booking brain, no Vapi or Google needed.
// Runs the real webhook handler with a fake calendar and asserts on results.
process.env.DB_PATH = ':memory:';
process.env.VAPI_WEBHOOK_SECRET = 'test-secret';

const { tenants, bookings, messages } = await import('../src/db.js');
const { createWebhookHandler } = await import('../src/webhook.js');
const { freeSlots, wallToUtc, utcToWall } = await import('../src/slots.js');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; console.log(`  FAIL - ${name} ${extra}`); }
}

// ---------- fixed "now": Monday 2026-07-13 10:00 Amsterdam ----------
const TZ = 'Europe/Amsterdam';
const NOW = wallToUtc(2026, 7, 13, 10, 0, TZ);

// ---------- tenant ----------
const tenant = tenants.create({
  name: 'Kapsalon Test', services: 'knippen, kleuren',
  slot_minutes: 30, min_notice_hours: 2, horizon_days: 7,
});
tenants.update(tenant.id, { vapi_assistant_id: 'asst_test_123' });

// ---------- fake calendar ----------
const fakeEvents = [
  // Tuesday 2026-07-14 fully booked 09:00-17:00
  { start: wallToUtc(2026, 7, 14, 9, 0, TZ), end: wallToUtc(2026, 7, 14, 17, 0, TZ) },
];
let createdEvents = [];
const fakeCalendar = {
  async getBusy(_t, from, to) {
    return [...fakeEvents, ...createdEvents].filter(b => b.start < to && b.end > from);
  },
  async createEvent(_t, { startMs, endMs, summary }) {
    createdEvents.push({ start: startMs, end: endMs, summary });
    return 'evt_' + createdEvents.length;
  },
};

const handle = createWebhookHandler(fakeCalendar, () => NOW);

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
async function call(toolName, args, headers = { 'x-vapi-secret': 'test-secret' }) {
  const res = fakeRes();
  await handle({
    headers,
    body: { message: {
      type: 'tool-calls',
      call: { assistantId: 'asst_test_123' },
      toolCallList: [{ id: 'tc1', function: { name: toolName, arguments: JSON.stringify(args) } }],
    } },
  }, res);
  return res;
}

console.log('\n== slots engine ==');
{
  const busy = await fakeCalendar.getBusy(tenant, NOW, NOW + 8 * 86_400_000);
  const t = tenants.get(tenant.id);
  const slots = freeSlots(t, busy, NOW);
  check('slots exist', slots.length > 0);
  const w0 = utcToWall(slots[0].start, TZ);
  check('first slot respects 2h notice (>= 12:00 today)',
    !(w0.y === 2026 && w0.mo === 7 && w0.d === 13) || w0.hh >= 12,
    `got ${w0.hh}:${w0.mm}`);
  check('no slot on fully-booked Tuesday',
    !slots.some(s => { const w = utcToWall(s.start, TZ); return w.d === 14 && w.mo === 7; }));
  check('no slots on weekend',
    !slots.some(s => ['sat','sun'].includes(utcToWall(s.start, TZ).dow)));
  check('all slots on 30-min boundaries',
    slots.every(s => utcToWall(s.start, TZ).mm % 30 === 0));
}

console.log('\n== webhook security & identification ==');
{
  const bad = await call('checkAvailability', {}, { 'x-vapi-secret': 'wrong' });
  check('wrong secret rejected with 401', bad.statusCode === 401);

  const res = fakeRes();
  await handle({ headers: { 'x-vapi-secret': 'test-secret' }, body: { message: {
    type: 'tool-calls', call: { assistantId: 'asst_unknown' },
    toolCallList: [{ id: 'x', function: { name: 'checkAvailability', arguments: '{}' } }],
  } } }, res);
  check('unknown assistant gets config error, not crash',
    res.body.results[0].result.includes('FOUT'));
}

console.log('\n== tools ==');
{
  const r1 = await call('getCurrentDateTime', {});
  check('getCurrentDateTime names Monday 2026-07-13',
    r1.body.results[0].result.includes('maandag') && r1.body.results[0].result.includes('2026-07-13'),
    r1.body.results[0].result);

  const r2 = await call('checkAvailability', {});
  check('checkAvailability returns Dutch slot list',
    r2.body.results[0].result.startsWith('Beschikbare tijden:'), r2.body.results[0].result);

  const r3 = await call('checkAvailability', { date: '2026-07-14' });
  check('fully booked day yields alternatives',
    r3.body.results[0].result.includes('niets vrij'), r3.body.results[0].result);

  const r4 = await call('bookAppointment',
    { name: 'Jan de Vries', phone: '0612345678', date: '2026-07-15', time: '10:00', service: 'knippen' });
  check('valid booking succeeds', r4.body.results[0].result.startsWith('GELUKT'), r4.body.results[0].result);
  check('booking stored in DB', bookings.forTenant(tenant.id).length === 1);
  check('calendar event created', createdEvents.length === 1);

  const r5 = await call('bookAppointment',
    { name: 'Piet', phone: '06', date: '2026-07-15', time: '10:00' });
  check('double-booking same slot rejected', r5.body.results[0].result.includes('bezet'), r5.body.results[0].result);

  const r6 = await call('bookAppointment', { name: 'Kees', date: '2026-07-15', time: '20:00' });
  check('outside opening hours rejected', r6.body.results[0].result.includes('openingstijden'), r6.body.results[0].result);

  const r7 = await call('bookAppointment', { name: 'Anna', date: '2026-07-13', time: '10:30' });
  check('too-short notice rejected', r7.body.results[0].result.includes('te kort dag'), r7.body.results[0].result);

  const r8 = await call('bookAppointment', { name: 'Bob', date: 'morgen', time: '10:00' });
  check('garbage date rejected gracefully', r8.body.results[0].result.includes('FOUT'), r8.body.results[0].result);

  const r9 = await call('takeMessage', { name: 'Lisa', phone: '0687654321', message: 'Graag terugbellen over kleuradvies' });
  check('message stored', r9.body.results[0].result.startsWith('GELUKT') && messages.forTenant(tenant.id).length === 1);
}

console.log('\n== end-of-call report ==');
{
  const res = fakeRes();
  await handle({ headers: { 'x-vapi-secret': 'test-secret' }, body: { message: {
    type: 'end-of-call-report', call: { id: 'call_1', assistantId: 'asst_test_123' },
    endedReason: 'customer-ended-call', summary: 'Klant boekte een afspraak.',
  } } }, res);
  const { calls } = await import('../src/db.js');
  check('call report stored', calls.forTenant(tenant.id).length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
