const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemCalendar, MAX_RANGE } = require('../lib/system-calendar');
const start = new Date(2026, 9, 1).getTime(), end = start + 30 * 86400000;
const packet = () => ({ calendars: [{ id: 'work', title: '工作', color: '#123abc' }], events: [{ id: 'meeting', calendarId: 'work', title: '设计评审', start: start + 3600000, end: start + 7200000, allDay: false }], truncated: false });
function bridge(overrides = {}) { return createSystemCalendar({ platform: 'darwin', native: { status: () => 'granted', connect: async () => 'granted', read: async () => packet(), ...overrides } }); }

test('status and read never request access; denied reads expose no events', async () => {
  let connects = 0, reads = 0;
  for (const state of ['not-determined', 'denied', 'restricted']) {
    const calendar = bridge({ status: () => state, connect: () => { connects++; }, read: () => { reads++; } });
    assert.equal(calendar.status().status, state);
    assert.deepEqual(await calendar.read({ start, end }), { status: state, calendars: [], events: [], truncated: false });
  }
  assert.equal(connects, 0); assert.equal(reads, 0);
});
test('Connect deduplicates permission requests and respects native failures', async () => {
  let count = 0, resolve, state = 'not-determined';
  const calendar = bridge({ status: () => state, connect: () => { count++; return new Promise(done => { resolve = done; }); } });
  const first = calendar.connect(), second = calendar.connect(); assert.equal(first, second);
  await Promise.resolve(); assert.equal(count, 1); state = 'granted'; resolve('granted');
  assert.deepEqual(await first, { status: 'granted' });
  assert.equal((await bridge({ status: () => 'not-determined', connect: async () => 'error' }).connect()).status, 'error');
});
test('calendar records are validated and only approved fields are returned', async () => {
  const raw = packet(); raw.events[0].privateNotes = 'secret'; raw.events[0].title = '  设计\n评审\0 '; raw.calendars[0].privatePath = '/secret';
  const result = await bridge({ read: async () => JSON.stringify(raw) }).read({ start, end });
  assert.equal(result.status, 'granted'); assert.equal(result.events[0].title, '设计 评审');
  assert.equal('privateNotes' in result.events[0], false); assert.equal('privatePath' in result.calendars[0], false);
});
test('invalid range is rejected without querying native store', async () => {
  let reads = 0; const calendar = bridge({ read: () => { reads++; return packet(); } });
  for (const range of [null, undefined, {}, { start, end: start }, { start, end: start - 1 }, { start: NaN, end }, { start, end: start + MAX_RANGE + 1 }, { start: -Infinity, end }, { start: 1e20, end: 1e20 + 100000 }]) assert.equal((await calendar.read(range)).status, 'error');
  assert.equal(reads, 0);
});
test('permission revoked during a read clears all results', async () => {
  let state = 'granted';
  const calendar = bridge({ status: () => state, read: async () => { state = 'denied'; return packet(); } });
  assert.deepEqual(await calendar.read({ start, end }), { status: 'denied', calendars: [], events: [], truncated: false });
});
test('invalid payloads and native failures become safe errors without private details', async () => {
  const invalid = [null, { calendars: {}, events: [] }, { calendars: [], events: packet().events }];
  for (const change of [value => { value.calendars[0].id = '\0'; }, value => { value.events[0].start = NaN; }, value => { value.events[0].allDay = 1; }, value => { value.events[0].start = end; }, value => { value.events[0].end = start - 1; }]) { const value = packet(); change(value); invalid.push(value); }
  for (const value of invalid) {
    const result = await bridge({ read: async () => value }).read({ start, end });
    assert.equal(result.status, 'error'); assert.deepEqual(result.events, []);
  }
  const result = await bridge({ read: async () => { throw Error('secret path /Users/private'); } }).read({ start, end });
  assert.equal(result.error.includes('secret'), false);
});
test('recurring event instances retain distinct starts, duplicate instances are removed', async () => {
  const value = packet(); value.events.push({ ...value.events[0] }, { ...value.events[0], start: start + 10800000, end: start + 14400000 });
  const result = await bridge({ read: async () => value }).read({ start, end }); assert.equal(result.events.length, 2);
});
test('unsupported systems and missing binding fail safely without permissions', async () => {
  const unsupported = createSystemCalendar({ platform: 'win32', native: null });
  assert.equal(unsupported.status().status, 'unsupported'); assert.equal((await unsupported.connect()).status, 'unsupported');
  assert.equal((await unsupported.read({ start, end })).status, 'unsupported');
  assert.equal(createSystemCalendar({ platform: 'darwin', native: null }).status().status, 'error');
});
test('optional calendar item identifiers stay distinct from event identifiers', async () => {
  const raw = packet(); raw.events[0].itemId = 'item-123'; raw.events[0].recurring = true;
  const event = (await bridge({ read: async () => raw }).read({ start, end })).events[0];
  assert.equal(event.id, 'meeting'); assert.equal(event.itemId, 'item-123'); assert.equal(event.recurring, true);
  raw.events[0].itemId = 'invalid\0id'; raw.events[0].recurring = 'invalid';
  const invalid = (await bridge({ read: async () => raw }).read({ start, end })).events[0];
  assert.equal('itemId' in invalid, false); assert.equal('recurring' in invalid, false);
});

test('readonly event details retain multiline notes and allow only bounded display metadata', async () => {
  const raw = packet(); Object.assign(raw.events[0], {
    location: '  B07\0-2F\n会议室  ', notes: ' \t首行\r\n第二行\0\u0007\r第三行\u0085  ',
    organizer: '\0 负责\n同事 \u0080', reminderMinutes: [15, 0, 15, 0.5, 525600, -1, '30', NaN],
    organizerEmail: 'private@example.test', attendees: [{ name: '参会人', email: 'attendee@example.test' }],
    url: 'mailto:private@example.test', alarms: [{ emailAddress: 'private@example.test' }]
  });
  const result = await bridge({ read: async () => JSON.stringify(raw) }).read({ start, end });
  assert.equal(result.status, 'granted');
  assert.deepEqual(result.events[0], { ...packet().events[0], location: 'B07 -2F 会议室', notes: '首行\n第二行\n第三行',
    organizer: '负责 同事', reminderMinutes: [15, 0, 0.5, 525600] });
  assert.doesNotMatch(JSON.stringify(result), /private@example|attendee@example|organizerEmail|attendees|emailAddress|mailto:/);
});

test('optional event details are capped independently without changing the event basics', async () => {
  const raw = packet(); Object.assign(raw.events[0], {
    location: '地'.repeat(501), notes: '备注\n'.repeat(1400), organizer: '人'.repeat(301),
    reminderMinutes: Array.from({ length: 20 }, (_, index) => index)
  });
  const result = await bridge({ read: async () => raw }).read({ start, end }), event = result.events[0];
  assert.equal(result.status, 'granted'); assert.equal(event.location.length, 500);
  assert.equal(event.notes.length, 4000); assert(event.notes.includes('\n')); assert.equal(event.organizer.length, 300);
  assert.deepEqual(event.reminderMinutes, [0, 1, 2, 3, 4, 5, 6, 7]);
  const { location, notes, organizer, reminderMinutes, ...basic } = event;
  assert.deepEqual(basic, packet().events[0]);
  assert.equal(raw.events[0].location.length, 501, 'cleaning must not mutate native input');
});

test('malformed optional fields and organizer mailboxes are omitted without dropping valid events', async () => {
  for (const invalid of [null, true, 123, {}, [], '', '\0\u0001\u007f\u0080  ']) {
    const raw = packet(); Object.assign(raw.events[0], { location: invalid, notes: invalid, organizer: invalid, reminderMinutes: invalid });
    const result = await bridge({ read: async () => raw }).read({ start, end });
    assert.equal(result.status, 'granted'); assert.deepEqual(result.events, packet().events, String(invalid));
  }
  for (const organizer of ['owner@example.test', '负责人 <owner@example.test>', 'mailto:owner@example.test']) {
    const raw = packet(); raw.events[0].organizer = organizer;
    const result = await bridge({ read: async () => raw }).read({ start, end });
    assert.equal(result.status, 'granted'); assert.deepEqual(result.events, packet().events);
  }
  const raw = packet(); raw.events[0].reminderMinutes = [-1, Infinity, NaN, '15', null, {}, 525601, -Infinity];
  const result = await bridge({ read: async () => raw }).read({ start, end });
  assert.equal(result.status, 'granted'); assert.deepEqual(result.events, packet().events);
});
