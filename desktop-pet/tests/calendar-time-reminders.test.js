'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCalendarTimeReminders, PHRASES } = require('../lib/calendar-time-reminders');
const KINDS = ['morning', 'lunch', 'rest', 'offWork'];
const defaults = { timeReminders: true, reminderWeekdaysOnly: true, morningTime: '09:00', lunchTime: '12:00', restTime: '13:00', offWorkTime: '18:00' };
const empty = () => ({ schema: 1, days: {}, pools: Object.fromEntries(KINDS.map(kind => [kind, { remaining: [], last: null }])) });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture(t, { at = '2026-11-23T09:00:00', prefs = {}, suppressed = false, raw, notify = () => true, random = () => 0.4, prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-time-reminders-')), filePath = path.join(dir, 'state/reminders.json');
  if (raw !== undefined) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, raw); }
  prepare?.(filePath, dir);
  const calls = [], errors = [], timers = new Set();
  let currentTime = new Date(at).getTime(), preferences = { ...defaults, ...prefs }, hidden = suppressed, controller;
  const create = () => createCalendarTimeReminders({ filePath, now: () => currentTime, getPreferences: () => preferences,
    isSuppressed: () => hidden, notify(payload) { calls.push(payload); return notify(payload); }, random, onError: error => errors.push(error),
    setTimer(callback, interval) { const timer = { callback, interval, unref() {} }; timers.add(timer); return timer; }, clearTimer: timer => timers.delete(timer) });
  controller = create();
  t.after(() => { controller.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { get controller() { return controller; }, filePath, dir, calls, errors, timers,
    setTime: value => { currentTime = typeof value === 'number' ? value : new Date(value).getTime(); },
    setPreferences: value => { preferences = value; }, suppress: value => { hidden = value; },
    restart() { controller.dispose(); controller = create(); }, persisted: () => JSON.parse(fs.readFileSync(filePath, 'utf8')),
    async tick() { for (const timer of [...timers]) timer.callback(); await flush(); }
  };
}

test('four immutable phrase groups contain exactly 16 distinct original strings each', () => {
  assert.deepEqual(Object.keys(PHRASES), KINDS); assert.equal(Object.isFrozen(PHRASES), true);
  for (const kind of KINDS) {
    assert.equal(PHRASES[kind].length, 16); assert.equal(new Set(PHRASES[kind]).size, 16); assert.equal(Object.isFrozen(PHRASES[kind]), true);
    assert.ok(PHRASES[kind].every(text => typeof text === 'string' && text.trim() === text));
  }
  assert.equal(PHRASES.morning[0], '早呀，今天也一起慢慢来。');
  assert.equal(PHRASES.lunch[12], '午饭记得吃，球球记挂着。');
  assert.equal(PHRASES.rest[15], '给下午留一点精神吧。');
  assert.equal(PHRASES.offWork[15], '到了约好的收工时间，我来提醒你。');
});

test('default settings deliver each category at most once per local date and persist no phrase text', async t => {
  const f = fixture(t); f.setPreferences({}); assert.equal(await f.controller.start(), true);
  assert.equal(f.calls[0].kind, 'morning'); assert.equal(f.calls[0].motion, 'peek');
  await f.tick(); assert.equal(f.calls.length, 1);
  for (const [clock, kind, motion] of [['12:00', 'lunch', 'hop'], ['13:00', 'rest', 'sway'], ['18:00', 'offWork', 'bow']]) {
    f.setTime('2026-11-23T' + clock + ':00'); await f.tick(); assert.equal(f.calls.at(-1).kind, kind); assert.equal(f.calls.at(-1).motion, motion);
  }
  await f.tick(); assert.equal(f.calls.length, 4);
  assert.deepEqual(f.persisted().days, { '2026-11-23': KINDS }); assert.equal(fs.statSync(f.filePath).mode & 0o777, 0o600);
  const saved = fs.readFileSync(f.filePath, 'utf8');
  assert.equal(Object.values(PHRASES).flat().some(text => saved.includes(text)), false);
});

test('the delivery window includes the target and excludes the exact 30-minute boundary', async t => {
  for (const [at, expected] of [['2026-11-23T08:59:59.999', false], ['2026-11-23T09:00:00', true],
    ['2026-11-23T09:29:59.999', true], ['2026-11-23T09:30:00', false]]) {
    const f = fixture(t, { at }); assert.equal(await f.controller.start(), expected, at);
  }
});

test('enabling late checks only the current window and never replays the entire day', async t => {
  const f = fixture(t, { at: '2026-11-23T18:10:00' }); await f.controller.start();
  assert.deepEqual(f.calls.map(call => call.kind), ['offWork']);
  assert.deepEqual(f.persisted().days, { '2026-11-23': ['offWork'] });
  f.setTime('2026-11-23T19:00:00'); await f.tick(); assert.equal(f.calls.length, 1);
});

test('custom reminder times work and malformed times are not normalized or replaced silently', async t => {
  const custom = fixture(t, { at: '2026-11-23T10:05:00', prefs: { morningTime: '10:00' } }); await custom.controller.start();
  assert.equal(custom.calls[0].kind, 'morning');
  for (const value of ['9:00', '24:00', '09:60', '09:00:00', '', null, 900]) {
    const f = fixture(t, { prefs: { morningTime: value } }); assert.equal(await f.controller.start(), false); assert.equal(f.calls.length, 0);
  }
});

test('weekends are skipped by default and become eligible only when the setting allows them', async t => {
  const f = fixture(t, { at: '2026-11-22T09:00:00' }); assert.equal(await f.controller.start(), false);
  f.setPreferences({ ...defaults, reminderWeekdaysOnly: false }); await f.tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].kind, 'morning');
});

test('the time-reminder switch can be reenabled inside the window without consuming disabled checks', async t => {
  const f = fixture(t, { prefs: { timeReminders: false } }); await f.controller.start(); await f.tick();
  assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.filePath), false);
  f.setPreferences(defaults); f.setTime('2026-11-23T09:20:00'); await f.tick(); assert.equal(f.calls.length, 1);
});

test('suppression delays within a window and drops reminders whose window has expired', async t => {
  const f = fixture(t, { suppressed: true }); await f.controller.start(); await f.tick(); assert.equal(f.calls.length, 0);
  f.setTime('2026-11-23T09:20:00'); f.suppress(false); await f.tick(); assert.equal(f.calls.length, 1);
  const missed = fixture(t, { suppressed: true }); await missed.controller.start(); missed.setTime('2026-11-23T09:31:00');
  missed.suppress(false); await missed.tick(); assert.equal(missed.calls.length, 0); assert.equal(fs.existsSync(missed.filePath), false);
});

test('one tick emits at most one category even when all four are due together', async t => {
  const f = fixture(t, { prefs: { lunchTime: '09:00', restTime: '09:00', offWorkTime: '09:00' } });
  await f.controller.start(); assert.equal(f.calls.length, 1);
  for (let count = 2; count <= 4; count++) { await f.tick(); assert.equal(f.calls.length, count); }
  await f.tick(); assert.deepEqual(f.calls.map(call => call.kind), KINDS);
});

test('false and thrown deliveries do not consume a phrase or mark the category complete', async t => {
  let result = false;
  const f = fixture(t, { notify: () => { if (result === 'throw') throw Error('cannot show'); return result; } });
  await f.controller.start(); assert.equal(fs.existsSync(f.filePath), false);
  result = 'throw'; await f.tick(); assert.equal(f.errors.length, 1); assert.equal(fs.existsSync(f.filePath), false);
  result = true; await f.tick(); await f.tick(); assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.map(call => call.message)).size, 1);
  assert.deepEqual(f.persisted().days, { '2026-11-23': ['morning'] }); assert.equal(f.persisted().pools.morning.remaining.length, 15);
});

test('a failed category does not fall through to another category in the same tick', async t => {
  const f = fixture(t, { prefs: { lunchTime: '09:00' }, notify: () => false });
  await f.controller.start(); assert.deepEqual(f.calls.map(call => call.kind), ['morning']);
  await f.tick(); assert.deepEqual(f.calls.map(call => call.kind), ['morning', 'morning']);
});

test('nonboolean acknowledgements never consume a phrase', async t => {
  for (const result of [undefined, null, 'true', 1]) {
    const f = fixture(t, { notify: () => result }); assert.equal(await f.controller.start(), false); assert.equal(fs.existsSync(f.filePath), false);
  }
});

test('each group uses a full shuffle bag before repeating and preview does not mark daily delivery', async t => {
  const f = fixture(t, { prefs: { timeReminders: false } });
  for (const kind of KINDS) {
    const messages = [];
    for (let index = 0; index < 17; index++) { assert.equal(await f.controller.preview(kind), true); messages.push(f.calls.at(-1).message); }
    assert.equal(new Set(messages.slice(0, 16)).size, 16); assert.notEqual(messages[15], messages[16]);
  }
  assert.deepEqual(f.persisted().days, {}); assert.equal(f.calls.length, 68);
});

test('restart preserves daily deduplication and the remaining phrase bag', async t => {
  const f = fixture(t); await f.controller.start(); const first = f.calls[0].message;
  f.restart(); assert.equal(await f.controller.start(), false); assert.equal(f.calls.length, 1);
  f.setTime('2026-11-24T09:00:00'); await f.tick(); assert.equal(f.calls.length, 2); assert.notEqual(f.calls[1].message, first);
  assert.equal(f.persisted().pools.morning.remaining.length, 14);
  assert.deepEqual(f.persisted().days, { '2026-11-23': ['morning'], '2026-11-24': ['morning'] });
});

test('a refilled bag avoids the last phrase even after restart', async t => {
  const saved = empty(); saved.pools.morning.last = 0;
  const f = fixture(t, { raw: JSON.stringify(saved), random: () => 0.999 }); await f.controller.preview('morning');
  assert.notEqual(f.calls[0].message, PHRASES.morning[0]); assert.equal(f.calls[0].message, PHRASES.morning[1]);
});

test('pending delivery is shared by concurrent checks; pause cannot consume it twice', async t => {
  const pending = deferred(), f = fixture(t, { notify: () => pending.promise });
  const first = f.controller.start(); await flush(); const again = f.controller.start(); await f.tick();
  assert.equal(f.calls.length, 1); assert.equal(await f.controller.preview('morning'), false); assert.equal(fs.existsSync(f.filePath), false);
  f.controller.pause(); assert.equal(f.timers.size, 0); pending.resolve(true); assert.equal(await first, true); assert.equal(await again, true);
  await f.controller.resume(); assert.equal(f.calls.length, 1); assert.equal(f.persisted().pools.morning.remaining.length, 15);
});

test('preview ignores time/workday switches, rotates phrases and leaves automatic daily eligibility intact', async t => {
  const f = fixture(t, { at: '2026-11-22T18:10:00', prefs: { timeReminders: false } });
  await f.controller.preview(); await f.controller.preview('offWork');
  assert.ok(f.calls.every(call => call.kind === 'offWork')); assert.notEqual(f.calls[0].message, f.calls[1].message);
  assert.ok(f.calls.every(call => call.preview === true));
  assert.deepEqual(f.persisted().days, {}); await f.controller.start(); assert.equal(f.calls.length, 2);
  f.setTime('2026-11-23T18:00:00'); f.setPreferences(defaults); await f.tick(); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].preview, undefined, '自动提醒不带临时提升层级的标记');
  assert.equal(f.persisted().days['2026-11-23'][0], 'offWork');
});

test('preview still honors suppression and invalid category requests never notify', async t => {
  const f = fixture(t, { suppressed: true }); assert.equal(await f.controller.preview('morning'), false);
  f.suppress(false);
  for (const kind of ['unknown', null, {}, 1]) assert.equal(await f.controller.preview(kind), false);
  assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.filePath), false);
});

test('a late-night window crosses midnight and uses the scheduled workday for deduplication', async t => {
  const f = fixture(t, { at: '2026-11-28T00:10:00', prefs: { offWorkTime: '23:50' } });
  await f.controller.start(); assert.deepEqual(f.calls.map(call => call.kind), ['offWork']);
  assert.deepEqual(f.persisted().days, { '2026-11-27': ['offWork'] });
  await f.tick(); assert.equal(f.calls.length, 1);
  f.setTime('2026-11-28T18:00:00'); await f.tick(); assert.equal(f.calls.length, 1);
});

test('a previous-day window never prunes a category already delivered on the current day', async t => {
  const f = fixture(t, { at: '2026-11-24T00:10:00', prefs: { morningTime: '00:00', offWorkTime: '23:50' } });
  await f.controller.start(); await f.tick(); await f.tick();
  assert.deepEqual(f.calls.map(call => call.kind), ['morning', 'offWork']);
  assert.deepEqual(f.persisted().days, { '2026-11-23': ['offWork'], '2026-11-24': ['morning'] });
});

test('date records remain bounded while each group retains its shuffle progress', async t => {
  const f = fixture(t, { prefs: { reminderWeekdaysOnly: false } }); await f.controller.start();
  for (let day = 1; day < 75; day++) { f.setTime(new Date(2026, 10, 23 + day, 9).getTime()); await f.tick(); }
  const saved = f.persisted(); assert.equal(f.calls.length, 75); assert.ok(Object.keys(saved.days).length <= 64);
  assert.equal(Object.hasOwn(saved.days, '2026-11-23'), false); assert.ok(saved.pools.morning.remaining.length <= 15);
  assert.ok(fs.statSync(f.filePath).size < 10000);
});

test('corrupt or oversized state is preserved and blocks automatic delivery', async t => {
  const invalidPool = empty(); invalidPool.pools.morning = { remaining: [0, 0], last: null };
  const invalidDate = empty(); invalidDate.days['2026-02-30'] = ['morning'];
  for (const raw of ['{broken', JSON.stringify({ ...empty(), schema: 2 }), JSON.stringify(invalidPool), JSON.stringify(invalidDate), ' '.repeat(65537)]) {
    const f = fixture(t, { raw }); assert.equal(f.errors.length, 1); assert.equal(await f.controller.start(), false);
    assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw);
    assert.equal(await f.controller.preview('morning'), true); assert.equal(fs.readFileSync(f.filePath, 'utf8'), raw);
  }
});

test('symlink state files are not followed or overwritten', async t => {
  let target;
  const f = fixture(t, { prepare(file, dir) {
    target = path.join(dir, 'original'); fs.writeFileSync(target, 'private original'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.symlinkSync(target, file);
  } });
  assert.equal(await f.controller.start(), false); assert.equal(f.errors.length, 1);
  assert.equal(fs.lstatSync(f.filePath).isSymbolicLink(), true); assert.equal(fs.readFileSync(target, 'utf8'), 'private original');
});

test('storage failure cannot repeat a successful delivery within the current session', async t => {
  const f = fixture(t); fs.writeFileSync(path.dirname(f.filePath), 'blocked');
  assert.equal(await f.controller.start(), true); assert.equal(f.errors.length, 1); await f.tick(); await f.controller.resume();
  assert.equal(f.calls.length, 1); assert.equal(fs.readFileSync(path.dirname(f.filePath), 'utf8'), 'blocked');
});

test('pause and disposal clear timers and prevent queued late notifications', async t => {
  const f = fixture(t); const first = f.controller.start(); f.controller.pause(); assert.equal(await first, false); assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0); await f.controller.resume(); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  f.controller.dispose(); f.controller.dispose(); assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.start(), false); assert.equal(await f.controller.resume(), false); assert.equal(await f.controller.preview(), false);
  const queued = fixture(t); const pending = queued.controller.start(); queued.controller.dispose(); assert.equal(await pending, false); assert.equal(queued.calls.length, 0);
});

test('local timezones, DST gaps and repeated clock hours do not shift or duplicate reminders', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-timezone-reminders-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const modulePath = path.resolve(__dirname, '../lib/calendar-time-reminders.js');
  let sequence = 0;
  function run(zone, stamps, prefs = {}) {
    const spec = { stamps, prefs, filePath: path.join(dir, 'state-' + (++sequence) + '.json') };
    const script = `const {createCalendarTimeReminders}=require(${JSON.stringify(modulePath)}); const spec=${JSON.stringify(spec)}; let now=Date.parse(spec.stamps[0]); const calls=[]; const c=createCalendarTimeReminders({filePath:spec.filePath,getPreferences:()=>spec.prefs,now:()=>now,notify:p=>{calls.push(p.kind);return true},random:()=>0.4,setTimer:()=>1,clearTimer(){}}); (async()=>{await c.start();for(const stamp of spec.stamps.slice(1)){now=Date.parse(stamp);await c.resume()}c.dispose();console.log(JSON.stringify(calls))})().catch(e=>{console.error(e);process.exitCode=1});`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  }
  assert.deepEqual(run('Asia/Shanghai', ['2026-11-23T01:00:00Z']), ['morning']);
  assert.deepEqual(run('UTC', ['2026-11-23T01:00:00Z']), []);
  assert.deepEqual(run('America/New_York', ['2026-11-23T01:00:00Z'], { morningTime: '20:00' }), []);
  assert.deepEqual(run('America/New_York', ['2026-11-23T01:00:00Z'], { morningTime: '20:00', reminderWeekdaysOnly: false }), ['morning']);
  assert.deepEqual(run('America/New_York', ['2026-03-08T07:30:00Z'], { morningTime: '02:30', reminderWeekdaysOnly: false }), []);
  assert.deepEqual(run('America/New_York', ['2026-11-01T05:10:00Z', '2026-11-01T06:10:00Z'], { morningTime: '01:00', reminderWeekdaysOnly: false }), ['morning']);
});
