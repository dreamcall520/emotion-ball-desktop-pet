const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPomodoro } = require('../lib/pomodoro');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-pomodoro-'));
  const filePath = path.join(directory, 'pomodoro.json');
  let stamp = new Date(2026, 9, 11, 12).getTime(), scheduled, cleared = 0;
  const errors = [], changes = [], models = [];
  const open = (extra = {}) => {
    const model = createPomodoro({ filePath, now: () => stamp, onError: error => errors.push(error),
      onChange: state => changes.push(state), setTimer(fn, delay) { assert.equal(delay, 1000); scheduled = fn; return 1; },
      clearTimer(id) { assert.equal(id, 1); cleared++; }, ...options, ...extra });
    models.push(model); return model;
  };
  t.after(() => { models.forEach(model => model.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, filePath, open, errors, changes, advance: ms => stamp += ms, setTime: value => stamp = value,
    now: () => stamp, fire: () => scheduled(), cleared: () => cleared };
}
const ok = (model, type, value) => { const result = model.action(type, value); assert.equal(result.ok, true, result.message); return result.state; };

test('defaults, isolated snapshots and one notification per action/second', t => {
  const f = fixture(t), model = f.open(), initial = model.getSnapshot();
  assert.deepEqual(initial.durations, { focus: 25, short: 5, long: 15 });
  assert.equal(initial.face, 'analog'); assert.equal(initial.status, 'idle'); assert.equal(initial.total, 1500);
  assert.equal(initial.quiet, false); assert.equal(initial.encouragement, ''); assert.equal(initial.pinned, false);
  assert.equal(initial.encouragementEnabled, true, '新用户默认开启偶尔鼓励，已保存的关闭选项仍保留');
  initial.durations.focus = 99; assert.equal(model.getSnapshot().durations.focus, 25);
  assert.equal(fs.existsSync(f.filePath), false);
  ok(model, 'toggle'); f.advance(1000); f.fire();
  assert.equal(model.getSnapshot().remaining, 1499); assert.equal(model.getSnapshot().quiet, true);
  assert.equal(f.changes.length, 2); f.changes[0].durations.focus = 99;
  assert.equal(model.getSnapshot().durations.focus, 25);
  assert.equal(model.close().ok, true); assert.equal(f.cleared(), 1);
  assert.equal(model.action('toggle').ok, false);
});

test('deadline handles sleep; pause freezes, resume continues, seconds never write disk', t => {
  const f = fixture(t), model = f.open(); ok(model, 'toggle');
  const saved = fs.readFileSync(f.filePath, 'utf8');
  f.advance(12345); model.tick(); assert.equal(model.getSnapshot().remaining, 1488);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), saved);
  const paused = ok(model, 'toggle'); assert.equal(paused.status, 'paused'); assert.equal(paused.deadline, 0); assert.equal(paused.quiet, true);
  f.advance(3600000); model.tick(); assert.equal(model.getSnapshot().remaining, 1488);
  const resumed = ok(model, 'toggle'); assert.equal(resumed.deadline, f.now() + 1488000);
  f.advance(1488500); model.tick();
  const complete = model.getSnapshot(); assert.equal(complete.status, 'complete'); assert.equal(complete.remaining, 0);
  assert.equal(complete.completed, 1); assert.equal(complete.minutes, 25); assert.equal(complete.reminder, true); assert.equal(complete.quiet, false);
  f.advance(10000); model.tick(); assert.equal(model.getSnapshot().completed, 1); assert.equal(model.getSnapshot().minutes, 25);
  ok(model, 'dismiss'); assert.equal(model.getSnapshot().reminder, false);
});

test('four focus sessions select a long break; extension adds minutes, not sessions', t => {
  const f = fixture(t), model = f.open(); ok(model, 'settings', { durations: { focus: 1, short: 1, long: 1 } });
  for (let i = 1; i <= 4; i++) {
    ok(model, 'reset'); ok(model, 'toggle'); f.advance(60000); model.tick();
    assert.equal(model.getSnapshot().completed, i); assert.equal(model.getSnapshot().cycleCompleted, i);
  }
  ok(model, 'extend'); assert.equal(model.getSnapshot().extension, true); assert.equal(model.getSnapshot().total, 300);
  f.advance(300000); model.tick(); assert.equal(model.getSnapshot().completed, 4); assert.equal(model.getSnapshot().cycleCompleted, 4); assert.equal(model.getSnapshot().minutes, 9);
  const rest = ok(model, 'rest'); assert.equal(rest.mode, 'long'); assert.equal(rest.status, 'running');
  assert.equal(rest.quiet, false, '休息计时允许普通互动');
  assert.equal(ok(model, 'toggle').quiet, false, '暂停休息也允许普通互动');
  ok(model, 'toggle');
  f.advance(60000); model.tick(); assert.equal(model.getSnapshot().completed, 4); assert.equal(model.getSnapshot().minutes, 9);
  const next = ok(model, 'toggle'); assert.equal(next.mode, 'focus'); assert.equal(next.cycleCompleted, 0);
  f.advance(60000); model.tick(); assert.equal(model.getSnapshot().completed, 5); assert.equal(model.getSnapshot().cycleCompleted, 1);
});

test('style and encouragement settings preserve timer and records; duration changes reset only current timer', t => {
  const f = fixture(t), model = f.open(); ok(model, 'settings', { durations: { focus: 1 } }); ok(model, 'toggle'); f.advance(60000); model.tick();
  ok(model, 'reset'); ok(model, 'intention', '整理产品方案'); ok(model, 'pin', true); ok(model, 'toggle'); f.advance(10000); model.tick();
  const before = model.getSnapshot();
  for (const face of ['timeline', 'modules', 'minutes', 'analog']) {
    const after = ok(model, 'settings', { face, encouragementEnabled: false });
    for (const key of ['mode', 'status', 'deadline', 'total', 'remaining', 'completed', 'cycleCompleted', 'minutes', 'intention', 'pinned']) assert.equal(after[key], before[key]);
  }
  const changed = ok(model, 'settings', { durations: { focus: 26, short: 7, long: 120 }, face: 'minutes', encouragementEnabled: true });
  assert.equal(changed.status, 'idle'); assert.equal(changed.deadline, 0); assert.equal(changed.remaining, 1560);
  assert.equal(changed.completed, 1); assert.equal(changed.minutes, 1); assert.equal(changed.intention, '整理产品方案'); assert.equal(changed.pinned, true);
  ok(model, 'reset'); assert.equal(model.getSnapshot().completed, 1);
});

test('selecting the current mode preserves running, paused and completed timers without saving', t => {
  const f = fixture(t), model = f.open();
  for (const mode of ['focus', 'short', 'long']) {
    ok(model, 'mode', mode); ok(model, 'toggle'); f.advance(12345); model.tick();
    for (const status of ['running', 'paused']) {
      if (status === 'paused') ok(model, 'toggle');
      const before = model.getSnapshot(), saved = fs.readFileSync(f.filePath, 'utf8'), changes = f.changes.length;
      assert.equal(before.status, status);
      assert.deepEqual(ok(model, 'mode', mode), before);
      assert.equal(fs.readFileSync(f.filePath, 'utf8'), saved);
      assert.equal(f.changes.length, changes, '重复选择不触发保存或状态广播');
    }
    ok(model, 'toggle'); f.advance(model.getSnapshot().remaining * 1000); model.tick();
    const complete = model.getSnapshot(); assert.equal(complete.reminder, true);
    assert.deepEqual(ok(model, 'mode', mode), complete, '重复选择也不收起到时提醒');
  }
  ok(model, 'mode', 'focus'); ok(model, 'toggle'); f.advance(3000); model.tick();
  const switched = ok(model, 'mode', 'short');
  assert.equal(switched.mode, 'short'); assert.equal(switched.status, 'idle');
  assert.equal(switched.remaining, 300); assert.equal(switched.deadline, 0);
  ok(model, 'toggle'); f.advance(3000); model.tick();
  const reset = ok(model, 'reset'); assert.equal(reset.remaining, 300); assert.equal(reset.status, 'idle');
});

test('trust boundary rejects invalid types, out of range numbers and unsafe text without mutation', t => {
  const f = fixture(t), model = f.open();
  const invalid = [
    ['settings', null], ['settings', []], ['settings', {}], ['settings', { durations: {} }],
    ['settings', { durations: { focus: NaN } }], ['settings', { durations: { focus: Infinity } }],
    ['settings', { durations: { focus: '25' } }], ['settings', { durations: { focus: 0 } }],
    ['settings', { durations: { focus: 181 } }], ['settings', { durations: { short: 61 } }],
    ['settings', { durations: { long: 121 } }], ['settings', { durations: { focus: 1.5 } }],
    ['settings', { durations: { invalid: 25 } }], ['settings', { face: '__proto__' }],
    ['settings', { encouragementEnabled: 'false' }], ['settings', { face: 'analog', other: true }],
    ['mode', '__proto__'], ['mode', null], ['intention', 'x'.repeat(61)], ['intention', 'bad\u0000text'],
    ['intention', 1], ['pin', 'true'], ['toggle', true], ['rest'], ['extend'], ['unknown']
  ];
  const initial = model.getSnapshot();
  for (const [type, value] of invalid) { assert.equal(model.action(type, value).ok, false); assert.deepEqual(model.getSnapshot(), initial); }
  assert.equal(fs.existsSync(f.filePath), false);
  ok(model, 'intention', 'x'.repeat(60)); ok(model, 'settings', { durations: { focus: 180, short: 60, long: 120 } });
  assert.deepEqual(model.getSnapshot().durations, { focus: 180, short: 60, long: 120 });
});

test('close saves paused remaining, preferences and records; restart never starts by itself', t => {
  const f = fixture(t), model = f.open();
  ok(model, 'settings', { face: 'modules', encouragementEnabled: false }); ok(model, 'intention', '保留目标'); ok(model, 'pin'); ok(model, 'toggle');
  f.advance(12345); assert.equal(model.close().ok, true); const saved = JSON.parse(fs.readFileSync(f.filePath));
  assert.equal(saved.status, 'paused'); assert.equal(saved.remaining, 1488); assert.equal(saved.deadline, 0);
  f.advance(86400000); const restored = f.open().getSnapshot();
  assert.equal(restored.status, 'paused'); assert.equal(restored.remaining, 1488); assert.equal(restored.quiet, true);
  assert.equal(restored.face, 'modules'); assert.equal(restored.encouragementEnabled, false); assert.equal(restored.intention, '保留目标'); assert.equal(restored.pinned, true);
});

test('unexpected exit restores deadline as paused, or completes an expired session once', t => {
  const f = fixture(t), first = f.open(); ok(first, 'toggle'); const running = fs.readFileSync(f.filePath, 'utf8'); first.close();
  fs.writeFileSync(f.filePath, running); f.advance(100000); const recovered = f.open();
  assert.equal(recovered.getSnapshot().status, 'paused'); assert.equal(recovered.getSnapshot().remaining, 1400); recovered.close();
  fs.writeFileSync(f.filePath, running); f.advance(1500000); const expired = f.open();
  assert.equal(expired.getSnapshot().status, 'complete'); assert.equal(expired.getSnapshot().completed, 1); assert.equal(expired.getSnapshot().reminder, true); expired.close();
  const again = f.open(); assert.equal(again.getSnapshot().completed, 1); again.tick(); assert.equal(again.getSnapshot().completed, 1);
});

test('restart consumes encouragement milestones missed while the app was closed', t => {
  const f = fixture(t), model = f.open(); ok(model, 'settings', { durations: { focus: 10 } }); ok(model, 'toggle');
  const running = fs.readFileSync(f.filePath, 'utf8'); model.close(); fs.writeFileSync(f.filePath, running);
  f.advance(300001); const recovered = f.open(); assert.equal(recovered.getSnapshot().status, 'paused');
  ok(recovered, 'toggle'); recovered.tick(); assert.equal(recovered.getSnapshot().encouragement, '');
});

test('normal exit at an encouragement milestone before the next tick does not replay it on resume', t => {
  const f = fixture(t), model = f.open();
  ok(model, 'settings', { durations: { focus: 10 } }); ok(model, 'toggle');
  f.advance(300001); assert.equal(model.close().ok, true);
  f.advance(600000); const recovered = f.open();
  assert.equal(recovered.getSnapshot().remaining, 300);
  ok(recovered, 'toggle'); recovered.tick();
  assert.equal(recovered.getSnapshot().encouragement, '');
});

test('corrupt records remain untouched by timers and close, and explicit saving can recover', t => {
  const f = fixture(t), bad = '{invalid json'; fs.writeFileSync(f.filePath, bad);
  const model = f.open(); assert.equal(f.errors.length, 1); assert.equal(model.getSnapshot().face, 'analog');
  f.advance(86400000); model.tick(); model.close(); assert.equal(fs.readFileSync(f.filePath, 'utf8'), bad);
  const recovered = f.open(); ok(recovered, 'settings', { face: 'timeline' });
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).face, 'timeline'); recovered.close();
  const malformed = JSON.parse(fs.readFileSync(f.filePath)); malformed.remaining = null;
  fs.writeFileSync(f.filePath, JSON.stringify(malformed)); const invalid = f.open(); assert.equal(invalid.getSnapshot().status, 'idle'); invalid.close();
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).remaining, null);
});

test('failed atomic save returns an error and preserves old in-memory and on-disk state', t => {
  const f = fixture(t), nested = path.join(f.directory, 'nested'), filePath = path.join(nested, 'pomodoro.json');
  const model = f.open({ filePath }); ok(model, 'toggle'); f.advance(1000); model.tick();
  const before = model.getSnapshot(), saved = fs.readFileSync(filePath, 'utf8');
  fs.renameSync(nested, nested + '-saved'); fs.writeFileSync(nested, 'blocks directory creation');
  const result = model.action('settings', { face: 'minutes' }); assert.equal(result.ok, false); assert.match(result.message, /保存/);
  assert.deepEqual(model.getSnapshot(), before); assert.equal(fs.readFileSync(path.join(nested + '-saved', 'pomodoro.json'), 'utf8'), saved);
  assert.ok(f.errors.length > 0); fs.unlinkSync(nested); fs.renameSync(nested + '-saved', nested);
  ok(model, 'settings', { face: 'minutes' }); assert.equal(model.getSnapshot().face, 'minutes');
  assert.deepEqual(fs.readdirSync(nested), ['pomodoro.json']);
});

test('automatic encouragement uses duration milestones, lasts five seconds and never repeats after pause/style changes', t => {
  const f = fixture(t);
  for (const minutes of [5, 9, 10, 25, 44, 45, 60]) {
    const filePath = path.join(f.directory, `encouragement-${minutes}.json`), model = f.open({ filePath });
    ok(model, 'settings', { durations: { focus: minutes } }); ok(model, 'toggle'); const started = f.now();
    const marks = minutes < 10 ? [] : minutes < 45 ? [minutes * 30000] : [minutes * 20000, minutes * 40000];
    if (!marks.length) { f.advance(minutes * 30000); model.tick(); assert.equal(model.getSnapshot().encouragement, ''); }
    for (const mark of marks) {
      f.setTime(started + mark - 1); model.tick(); assert.equal(model.getSnapshot().encouragement, '');
      f.advance(1); model.tick(); assert.ok(model.getSnapshot().encouragement);
      f.advance(4999); model.tick(); assert.ok(model.getSnapshot().encouragement);
      f.advance(1); model.tick(); assert.equal(model.getSnapshot().encouragement, '');
      ok(model, 'toggle'); ok(model, 'settings', { face: 'minutes' }); ok(model, 'toggle'); model.tick(); assert.equal(model.getSnapshot().encouragement, '');
    }
    model.close();
  }
});

test('hidden, disabled or missed encouragement is consumed rather than replayed', t => {
  const f = fixture(t); let visible = true;
  for (const reason of ['hidden', 'disabled', 'late']) {
    const model = f.open({ filePath: path.join(f.directory, `${reason}.json`), canEncourage: () => visible });
    ok(model, 'settings', { durations: { focus: 10 }, encouragementEnabled: reason !== 'disabled' }); ok(model, 'toggle');
    if (reason === 'hidden') visible = false;
    f.advance(reason === 'late' ? 302001 : 300000); model.tick(); assert.equal(model.getSnapshot().encouragement, '');
    visible = true; ok(model, 'settings', { encouragementEnabled: true }); model.tick(); assert.equal(model.getSnapshot().encouragement, ''); model.close();
  }
});

test('daily totals follow local completion date while cycle progress survives midnight', t => {
  const f = fixture(t); f.setTime(new Date(2026, 9, 11, 23, 50).getTime()); const model = f.open();
  ok(model, 'settings', { durations: { focus: 1 } }); ok(model, 'toggle'); f.advance(60000); model.tick(); assert.equal(model.getSnapshot().completed, 1);
  ok(model, 'settings', { durations: { focus: 25 } }); ok(model, 'toggle'); f.setTime(new Date(2026, 9, 12, 0, 1).getTime()); model.tick();
  assert.equal(model.getSnapshot().date, '2026-10-12'); assert.equal(model.getSnapshot().completed, 0); assert.equal(model.getSnapshot().minutes, 0); assert.equal(model.getSnapshot().cycleCompleted, 1);
  f.setTime(new Date(2026, 9, 12, 0, 16).getTime()); model.tick(); assert.equal(model.getSnapshot().completed, 1); assert.equal(model.getSnapshot().minutes, 25); assert.equal(model.getSnapshot().cycleCompleted, 2);
  model.close();
  f.setTime(new Date(2026, 9, 11, 23, 50).getTime()); const delayed = f.open({ filePath: path.join(f.directory, 'delayed.json') }); ok(delayed, 'toggle');
  f.setTime(new Date(2026, 9, 12, 1).getTime()); delayed.tick(); assert.equal(delayed.getSnapshot().status, 'complete'); assert.equal(delayed.getSnapshot().completed, 1);
  delayed.close();
  f.setTime(new Date(2026, 9, 11, 23, 30).getTime()); const yesterday = f.open({ filePath: path.join(f.directory, 'yesterday.json') }); ok(yesterday, 'toggle');
  f.setTime(new Date(2026, 9, 12, 1).getTime()); yesterday.tick(); assert.equal(yesterday.getSnapshot().completed, 0); assert.equal(yesterday.getSnapshot().minutes, 0); assert.equal(yesterday.getSnapshot().cycleCompleted, 1);
});
