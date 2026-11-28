'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCalendarHolidayReminders } = require('../lib/calendar-holiday-reminders');

const time = (date, hour = 9) => new Date(date + 'T' + String(hour).padStart(2, '0') + ':00:00').getTime();
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture(t, { date = '2026-01-01', enabled = true, suppressed = false, raw, notify = () => true, prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-holiday-reminders-'));
  const filePath = path.join(dir, 'state/holiday-reminders.json');
  if (raw !== undefined) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, raw); }
  prepare?.(filePath, dir);
  const calls = [], errors = [], timers = new Set();
  let currentTime = time(date), allowed = enabled, hidden = suppressed;
  const controller = createCalendarHolidayReminders({ filePath,
    isEnabled: () => allowed, isSuppressed: () => hidden, now: () => currentTime,
    notify(payload) { calls.push(payload); return notify(payload); }, onError: error => errors.push(error),
    setTimer(callback, interval) { const handle = { callback, interval, unref() {} }; timers.add(handle); return handle; },
    clearTimer: handle => timers.delete(handle)
  });
  t.after(() => { controller.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { controller, calls, errors, timers, filePath,
    enabled: value => { allowed = value; }, suppressed: value => { hidden = value; }, setDate: date => { currentTime = time(date); },
    now: () => currentTime, persisted: () => JSON.parse(fs.readFileSync(filePath, 'utf8')),
    async tick() { for (const timer of [...timers]) timer.callback(); await flush(); }
  };
}

test('a visible holiday produces one bubble/action callback and persists only its local date', async t => {
  const f = fixture(t);
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.start(), true);
  assert.deepEqual(f.calls, [{ title: '元旦', message: '元旦快乐！假期从今天开始，球球来陪你过节啦。', motion: 'hop' }]);
  assert.deepEqual(f.persisted(), { schema: 1, dates: ['2026-01-01'] });
  assert.equal(fs.statSync(f.filePath).mode & 0o777, 0o600);
  await f.tick(); await f.controller.start(); await f.controller.resume();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  assert.equal([...f.timers][0].interval, 60000);
});

test('persisted same-day delivery is not repeated after restart', async t => {
  const f = fixture(t); await f.controller.start(); f.controller.dispose();
  const calls = [], restarted = createCalendarHolidayReminders({ filePath: f.filePath, now: f.now,
    notify: payload => { calls.push(payload); return true; }, setTimer: () => 1, clearTimer() {} });
  t.after(() => restarted.dispose());
  assert.equal(await restarted.start(), false); assert.deepEqual(calls, []);
});

test('suppression delays the greeting until the pet can be shown and never backfills yesterday', async t => {
  const f = fixture(t, { suppressed: true }); await f.controller.start(); await f.tick();
  assert.deepEqual(f.calls, []); assert.equal(fs.existsSync(f.filePath), false);
  f.suppressed(false); await f.tick(); assert.equal(f.calls.length, 1);
  f.suppressed(true); f.setDate('2026-02-15'); await f.tick();
  f.setDate('2026-02-16'); f.suppressed(false); await f.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].title, '除夕');
  assert.equal(f.persisted().dates.includes('2026-02-15'), false);
});

test('the reminder switch delays delivery and can be reenabled on the same holiday', async t => {
  const f = fixture(t, { enabled: false });
  assert.equal(await f.controller.start(), false); await f.tick(); assert.equal(f.calls.length, 0);
  f.enabled(true); await f.tick(); assert.equal(f.calls.length, 1);
  f.enabled(false); await f.tick(); f.enabled(true); await f.tick(); assert.equal(f.calls.length, 1);
});

test('pause stops the timer and resume checks the current day immediately', async t => {
  const f = fixture(t, { suppressed: true }); await f.controller.start();
  f.controller.pause(); assert.equal(f.timers.size, 0);
  f.suppressed(false); await f.tick(); assert.equal(f.calls.length, 0);
  assert.equal(await f.controller.resume(), true); assert.equal(f.timers.size, 1); assert.equal(f.calls.length, 1);
});

test('pause before the first scheduled check prevents notification', async t => {
  const f = fixture(t); const starting = f.controller.start(); f.controller.pause();
  assert.equal(await starting, false); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('a false delivery result is not recorded and is retried when display becomes possible', async t => {
  let accepted = false; const f = fixture(t, { notify: () => accepted });
  assert.equal(await f.controller.start(), false); assert.equal(fs.existsSync(f.filePath), false);
  accepted = true; await f.tick(); await f.tick();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.persisted().dates, ['2026-01-01']);
});

test('only an explicit true acknowledgement records a reminder', async t => {
  for (const result of [undefined, null, 'true', 1]) {
    const f = fixture(t, { notify: () => result });
    assert.equal(await f.controller.start(), false); assert.equal(fs.existsSync(f.filePath), false);
  }
});

test('a failed callback is reported without marking the date or stopping later retries', async t => {
  let failing = true;
  const f = fixture(t, { notify: () => { if (failing) throw Error('bubble unavailable'); return true; } });
  assert.equal(await f.controller.start(), false); assert.equal(f.errors.length, 1); assert.equal(fs.existsSync(f.filePath), false);
  failing = false; await f.tick(); assert.equal(f.calls.length, 2); assert.deepEqual(f.persisted().dates, ['2026-01-01']);
});

test('concurrent checks share one pending delivery and keep its acknowledgement across pause', async t => {
  const pending = deferred(), f = fixture(t, { notify: () => pending.promise });
  const starting = f.controller.start(); await flush();
  const again = f.controller.start(); await f.tick(); assert.equal(f.calls.length, 1);
  f.controller.pause(); pending.resolve(true);
  assert.equal(await starting, true); assert.equal(await again, true);
  assert.deepEqual(f.persisted().dates, ['2026-01-01']);
  await f.controller.resume(); assert.equal(f.calls.length, 1);
});

test('a new holiday on a later local date may deliver once without repeating the previous day', async t => {
  const f = fixture(t); await f.controller.start();
  f.setDate('2026-02-17'); await f.tick(); await f.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].title, '春节');
  assert.deepEqual(f.persisted().dates, ['2026-01-01', '2026-02-17']);
});

test('holiday period starts use only the independently verified 2026 and 2027 first days', async t => {
  for (const [date, title] of [['2026-02-15', '春节假期开始'], ['2026-04-04', '清明节假期开始'],
    ['2027-02-05', '除夕、春节假期开始'], ['2027-04-03', '清明节假期开始']]) {
    const f = fixture(t, { date }); assert.equal(await f.controller.start(), true); assert.equal(f.calls[0].title, title);
  }
  for (const date of ['2026-01-02', '2026-02-18', '2027-02-07', '2028-02-05']) {
    const f = fixture(t, { date }); assert.equal(await f.controller.start(), false, date); assert.equal(f.calls.length, 0);
  }
});

test('festival and first-day labels are merged rather than producing separate daily notifications', async t => {
  const f = fixture(t, { date: '2026-10-01' }); await f.controller.start(); await f.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].title, '国庆节');
  const both = fixture(t, { date: '2020-10-01' }); await both.controller.start();
  assert.equal(both.calls.length, 1); assert.equal(both.calls[0].title, '国庆节、中秋节');
});

test('Qingming is the sole solar-term exception and uses a calm greeting without jumping', async t => {
  for (const date of ['2026-04-04', '2026-04-05']) {
    const f = fixture(t, { date }); assert.equal(await f.controller.start(), true);
    assert.equal(f.calls[0].motion, null); assert.match(f.calls[0].message, /思念/); assert.doesNotMatch(f.calls[0].message, /快乐|放假啦/);
  }
  const snow = fixture(t, { date: '2026-11-22' }); await snow.controller.start();
  assert.equal(snow.calls.length, 0); assert.equal(fs.existsSync(snow.filePath), false);
});

test('Dragon Boat Festival uses an 安康 greeting', async t => {
  const f = fixture(t, { date: '2026-06-19' }); await f.controller.start();
  assert.equal(f.calls[0].title, '端午节'); assert.match(f.calls[0].message, /端午安康/);
  assert.doesNotMatch(f.calls[0].message, /端午节快乐/);
});

test('preview works explicitly while disabled without writing or consuming daily deduplication', async t => {
  const f = fixture(t, { enabled: false });
  assert.equal(await f.controller.preview(), true); assert.equal(fs.existsSync(f.filePath), false);
  assert.equal(f.calls[0].preview, true);
  f.enabled(true); assert.equal(await f.controller.start(), true);
  assert.equal(f.calls[1].preview, undefined, '自动提醒不带临时提升层级的标记');
  assert.equal(f.calls.length, 2); assert.deepEqual(f.persisted().dates, ['2026-01-01']);
  assert.equal(await f.controller.preview(), true); assert.equal(f.calls.length, 3);
});

test('ordinary-day preview identifies itself as a sample and honors suppression', async t => {
  const f = fixture(t, { date: '2026-11-22', suppressed: true });
  assert.equal(await f.controller.preview(), false); assert.equal(f.calls.length, 0);
  f.suppressed(false); assert.equal(await f.controller.preview(), true);
  assert.equal(f.calls[0].title, '节日互动预览'); assert.match(f.calls[0].message, /像这样/);
  assert.equal(fs.existsSync(f.filePath), false);
});

test('a damaged state file is preserved and blocks automatic notifications that cannot be deduplicated', async t => {
  for (const raw of ['{broken', JSON.stringify({ schema: 2, dates: [] }), JSON.stringify({ schema: 1, dates: ['2026-02-30'] }),
    JSON.stringify({ schema: 1, dates: Array(65).fill('2026-01-01') }), ' '.repeat(16385)]) {
    const f = fixture(t, { raw }); assert.equal(f.errors.length, 1);
    assert.equal(await f.controller.start(), false); await f.tick(); assert.equal(f.calls.length, 0);
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw);
    assert.equal(await f.controller.preview(), true); assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw);
  }
});

test('symlink state files are never followed or overwritten', async t => {
  let target;
  const f = fixture(t, { prepare(file, dir) {
    target = path.join(dir, 'original.json'); fs.writeFileSync(target, 'original-private-data');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.symlinkSync(target, file);
  } });
  assert.equal(await f.controller.start(), false); assert.equal(f.errors.length, 1);
  assert.equal(fs.lstatSync(f.filePath).isSymbolicLink(), true); assert.equal(fs.readFileSync(target, 'utf8'), 'original-private-data');
});

test('retention keeps bounded recent date labels and drops old records without storing greeting text', async t => {
  const f = fixture(t, { date: '2026-10-01', raw: JSON.stringify({ schema: 1, dates: ['2025-01-01', '2026-05-01', '2026-09-25'] }) });
  await f.controller.start();
  assert.deepEqual(f.persisted(), { schema: 1, dates: ['2026-09-25', '2026-10-01'] });
  assert.ok(fs.statSync(f.filePath).size < 1000);
});

test('a failed persistence does not repeat an already delivered greeting in the current session', async t => {
  const f = fixture(t); fs.writeFileSync(path.dirname(f.filePath), 'not a directory');
  assert.equal(await f.controller.start(), true); assert.equal(f.errors.length, 1);
  await f.tick(); await f.controller.resume(); assert.equal(f.calls.length, 1);
  assert.equal(fs.readFileSync(path.dirname(f.filePath), 'utf8'), 'not a directory');
});

test('dispose clears timers, rejects future starts/previews and tolerates duplicate disposal', async t => {
  const f = fixture(t, { suppressed: true }); await f.controller.start(); assert.equal(f.timers.size, 1);
  f.controller.dispose(); f.controller.dispose(); f.suppressed(false); assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.resume(), false); assert.equal(await f.controller.start(), false);
  assert.equal(await f.controller.preview(), false); await f.tick(); assert.equal(f.calls.length, 0);
});

test('dispose before the queued first check prevents late notification', async t => {
  const f = fixture(t); const starting = f.controller.start(); f.controller.dispose();
  assert.equal(await starting, false); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});
