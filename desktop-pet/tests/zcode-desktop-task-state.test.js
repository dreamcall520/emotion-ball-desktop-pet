'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createZcodeDesktopTaskState } = require('../lib/zcode-desktop-task-state');
const owner = { accountKey: 'a'.repeat(64), epoch: 1 };
const event = (name = 'UserPromptSubmit', extra = {}) => ({ version: 1, sessionId: 'sess_synthetic', turnId: 'turn_synthetic', event: name,
  phase: name === 'UserPromptSubmit' ? 'submitted' : 'stop-observed', ...extra });
function fixture(t, extra = {}) {
  let at = 1000, row = null, scheduled;
  const alerts = [], clears = [];
  const state = createZcodeDesktopTaskState({ now: () => at, readTurnStatus: async () => row,
    schedule: fn => { scheduled = fn; return 1; }, cancel: () => { scheduled = null; },
    onAlert: alert => alerts.push(alert), onClear: value => clears.push(value), ...extra });
  state.bind(owner); t.after(() => state.close());
  return { state, alerts, clears, setTime: value => { at = value; }, setRow: value => { row = value; }, fire: () => scheduled?.(),
    terminal: (status = 'completed', more = {}) => { row = { sessionId: 'sess_synthetic', turnId: 'turn_synthetic', status, startedAt: 990, completedAt: at, ...more }; } };
}
test('Stop only refreshes; only exact observed turn_usage terminal ends processing and emits a result', async t => {
  const f = fixture(t); f.state.accept(event(), owner); await f.state.refresh();
  assert.equal(f.state.getState().activeCount, 1); assert.equal(f.state.getState().runningCount, null);
  f.state.accept(event('Stop'), owner); await f.state.refresh();
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing']); assert.equal(f.state.getState().activeCount, 1);
  f.setTime(2000); f.terminal(); await f.state.refresh();
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing', 'completed']); assert.equal(f.state.getState().activeCount, 0);
  assert.equal(f.alerts[1].terminalKind, 'main-reply'); assert.equal(f.alerts[1].accountAttributionVerified, false);
  assert.equal(f.state.getState().tasks[0].evidence, 'exact-observed-turn-usage-terminal');
});
test('another session, another turn and a historical terminal cannot complete the observed turn', async t => {
  const f = fixture(t); f.state.accept(event(), owner); await f.state.refresh(); f.setTime(2000);
  for (const more of [{ sessionId: 'sess_other' }, { turnId: 'turn_other' }, { completedAt: 999 }, { completedAt: 2001 }, { status: 'running' }]) {
    f.terminal('completed', more); await f.state.refresh(); assert.equal(f.alerts.length, 1);
  }
  f.terminal(); await f.state.refresh(); assert.equal(f.alerts.at(-1).kind, 'completed');
});
test('a short official turn completed during account verification is matched from authenticated receipt time', async t => {
  const f = fixture(t); f.setTime(2000);
  assert.equal(f.state.accept(event('UserPromptSubmit', { observedAt: 1100 }), owner), true);
  await f.state.refresh(); f.terminal('completed', { startedAt: 1090, completedAt: 1500 }); await f.state.refresh();
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing', 'completed']);
  assert.equal(f.state.getState().tasks[0].startedAt, 1100); assert.equal(f.state.getState().tasks[0].acceptedAt, 2000);
});
test('receipt timestamps from an earlier binding or the future cannot start a task', t => {
  const f = fixture(t); f.setTime(2000);
  for (const observedAt of [999, 2001, '1100', -1]) assert.equal(f.state.accept(event('UserPromptSubmit', { observedAt }), owner), false);
  assert.equal(f.alerts.length, 0); assert.equal(f.state.getState().tasks.length, 0);
});
test('terminal without an observed new submit, missing turn id or body-bearing metadata never starts or completes', async t => {
  const f = fixture(t); f.terminal(); assert.equal(f.state.accept(event('Stop'), owner), false);
  assert.equal(f.state.accept(event('UserPromptSubmit', { turnId: undefined }), owner), false);
  assert.equal(f.state.accept(event('UserPromptSubmit', { prompt: 'PRIVATE_BODY' }), owner), false);
  assert.equal(f.state.accept(event(), { ...owner, epoch: 2 }), false); await f.state.refresh();
  assert.equal(f.alerts.length, 0); assert.equal(f.state.getState().tasks.length, 0);
});
test('duplicate callbacks, repeated DB polls and Stop after terminal emit each result only once', async t => {
  const f = fixture(t); assert.equal(f.state.accept(event(), owner), true); assert.equal(f.state.accept(event(), owner), false); await f.state.refresh();
  f.setTime(2000); f.terminal(); await f.state.refresh(); await f.state.refresh();
  assert.equal(f.state.accept(event('Stop'), owner), false); assert.equal(f.state.accept(event(), owner), false);
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing', 'completed']);
});
test('error and cancellation are separate from successful new result', async t => {
  for (const [status, expected] of [['error', 'failed'], ['cancelled', 'interrupted']]) {
    const f = fixture(t); f.state.accept(event(), owner); await f.state.refresh(); f.setTime(2000); f.terminal(status); await f.state.refresh();
    assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing', expected]); assert.equal(f.state.getState().activeCount, 0);
  }
});
test('a superseded turn or a reset cannot publish a delayed database result', async t => {
  let resolve;
  const f = fixture(t, { readTurnStatus: () => new Promise(done => { resolve = done; }) });
  f.state.accept(event(), owner); await Promise.resolve();
  f.state.reset(); f.state.bind({ ...owner, epoch: 2 });
  resolve({ sessionId: 'sess_synthetic', turnId: 'turn_synthetic', status: 'completed', startedAt: 990, completedAt: 1000 });
  await f.state.refresh(); assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing']);
  assert.equal(f.state.getState().tasks.length, 0);
});
test('missing or unreadable terminal expires to unknown and clears animation without inventing success', async t => {
  const f = fixture(t, { inactivityMs: 20, maxWatchMs: 100, pollMs: 10, readTurnStatus: async () => { throw Error('unavailable'); } });
  f.state.accept(event(), owner); await f.state.refresh(); f.setTime(1021); await f.state.refresh();
  assert.equal(f.state.getState().activeCount, 0); assert.equal(f.state.getState().tasks[0].state, 'unknown');
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['processing']); assert.ok(f.clears.some(clear => clear.reason === 'inactivity'));
});
test('a later exact terminal may resolve an unknown turn, while another session remains processing', async t => {
  const rows = new Map(); const f = fixture(t, { inactivityMs: 20, maxWatchMs: 100, pollMs: 10,
    readTurnStatus: async input => rows.get(input.sessionId) });
  f.state.accept(event(), owner); await f.state.refresh(); f.setTime(1021); await f.state.refresh();
  f.state.accept(event('UserPromptSubmit', { sessionId: 'sess_second', turnId: 'turn_second' }), owner); await f.state.refresh();
  rows.set('sess_synthetic', { sessionId: 'sess_synthetic', turnId: 'turn_synthetic', status: 'completed', startedAt: 990, completedAt: 1021 });
  await f.state.refresh(); assert.equal(f.state.getState().activeCount, 1); assert.equal(f.alerts.at(-1).kind, 'completed');
});
