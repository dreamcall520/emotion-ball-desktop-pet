'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createMasZcodeQuotaConnection, projectMasZcodeSnapshot } = require('../lib/mas-zcode-quota-connection');
const A = 'a'.repeat(64), B = 'b'.repeat(64), purpose = 'zcode-quota-device-tasks-v1';
const saved = (accountKey = A, tasks = false) => ({ purpose, version: 1, accountKey, tasks });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture(t, options = {}) {
  let accountKey = A, preference = options.preference === true, record = options.record, readImpl = async () => ({ accountKey });
  let cleared = 0, revoked = 0, suspended = 0, refreshed = 0, changed = 0;
  const enabledWrites = [], source = { enabled: false, accountKey: A, quota: { state: 'connected', updatedAt: 1, code: null, windows: [{ remaining: 70 }] },
    buckets: [{ remaining: 70 }], tasks: { state: 'unknown', items: [{ id: 'private-task' }], results: [{ id: 'private-result' }] },
    history: { available: true, windows: [{ samples: [{ remaining: 70 }] }], results: [{ id: 'private-result' }] }, activity: { runningCount: 99, unreadCount: 1 } };
  let port;
  const access = { ensure: async () => ({ status: 'stored' }), clearPendingApp: () => { cleared++; }, revoke: async () => { revoked++; } };
  const storage = { load: async () => record, save: async (_id, value) => { record = structuredClone(value); }, remove: async () => { record = undefined; } };
  const link = { getSnapshot: () => projectMasZcodeSnapshot(source, port?.isTasksAuthorized(), port?.getAccountKey()),
    setEnabled: async value => { enabledWrites.push(value); preference = value; source.enabled = value; source.accountKey = accountKey; return true; },
    refresh: async () => { refreshed++; }, suspend: () => { suspended++; source.enabled = false; } };
  port = createMasZcodeQuotaConnection({ access, storage, link, readAccount: () => readImpl(), onAccountChanged: () => { changed++; } });
  t.after(() => port.close());
  return { port, access, storage, link, source, enabledWrites, setAccount: value => { accountKey = value; }, setReader: value => { readImpl = value; },
    get record() { return record; }, get preference() { return preference; }, get cleared() { return cleared; }, get revoked() { return revoked; },
    get suspended() { return suspended; }, get refreshed() { return refreshed; }, get changed() { return changed; } };
}
test('new profile or missing saved purpose never restores reads from an enabled preference alone', async t => {
  for (const record of [undefined, { ...saved(), purpose: 'some-other-consent' }, { ...saved(), accountKey: 'invalid' }]) {
    const f = fixture(t, { preference: true, record }); await f.port.restore(true);
    assert.equal(f.port.getState().status, 'needs-authorization'); assert.equal(f.port.getState().connected, false);
    assert.deepEqual(f.enabledWrites, []); assert.equal(f.preference, true); assert.equal(f.port.isTasksAuthorized(), false);
    assert.equal(f.link.getSnapshot().history.windows.length, 0);
  }
});
test('restore rechecks actual account and both native grants without opening a picker', async t => {
  const f = fixture(t, { preference: true, record: saved(A, true) }), interactive = [];
  f.access.ensure = async options => { interactive.push(options.interactive); return { status: 'stored' }; };
  await f.port.restore(true); await settle(); assert.equal(f.port.getState().connected, true); assert.equal(f.port.isTasksAuthorized(), true); assert.deepEqual(interactive, [false]);
  const other = fixture(t, { preference: true, record: saved(A, true) }); other.setAccount(B); await other.port.restore(true);
  assert.equal(other.port.getState().connected, false); assert.deepEqual(other.enabledWrites, []); assert.equal(other.preference, true);
});
test('connect cancellation while saving consent restores the prior record without starting or persistently disabling anything', async t => {
  const f = fixture(t), abort = new AbortController(); let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; }), save = f.storage.save;
  f.storage.save = async (...args) => { await save(...args); entered(); await new Promise(resolve => { release = resolve; }); };
  const connecting = f.port.connect(abort.signal); await waiting; abort.abort(); f.port.cancel(); release();
  assert.equal((await connecting).status, 'cancelled'); assert.equal(f.record, undefined); assert.deepEqual(f.enabledWrites, []); assert.equal(f.preference, false);
});
test('a cancelled reconnect and repeated connect preserve an existing enabled connection and task consent', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); await f.port.authorizeTasks(); await settle();
  assert.equal(f.port.isTasksAuthorized(), true); await f.port.connect(); await settle();
  assert.deepEqual(f.enabledWrites, [true]); assert.equal(f.record.tasks, true);
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  f.access.ensure = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const reconnecting = f.port.connect(); await started; f.port.cancel(); release({ status: 'stored' });
  assert.equal((await reconnecting).status, 'cancelled'); assert.equal(f.port.getState().connected, true); assert.equal(f.preference, true); assert.equal(f.port.isTasksAuthorized(), true);
  assert.deepEqual(f.enabledWrites, [true]);
});
test('account change suspends source reads and masks all old account data without saving disabled', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); f.setAccount(B); f.source.accountKey = B;
  const beforeCheck = f.link.getSnapshot(); assert.equal(beforeCheck.enabled, false); assert.deepEqual(beforeCheck.buckets, []); assert.deepEqual(beforeCheck.history.windows, []);
  await f.port.refreshAccount(); assert.equal(f.port.getState().connected, false); assert.equal(f.port.getState().status, 'needs-authorization');
  assert.equal(f.preference, true); assert.deepEqual(f.enabledWrites, [true]); assert.ok(f.suspended > 0); assert.equal(f.port.getAccountKey(), null);
});
test('a stale identity read cannot invalidate a newer successful connection', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); let reject;
  f.setReader(() => new Promise((_resolve, no) => { reject = no; })); const old = f.port.refreshAccount();
  f.setReader(async () => ({ accountKey: A })); await f.port.connect();
  reject(Error('old source access failed')); await old; await settle();
  assert.equal(f.port.getState().connected, true); assert.equal(f.preference, true); assert.equal(f.changed, 0); assert.deepEqual(f.enabledWrites, [true]);
});
test('close invalidates a pending restore and stops runtime without rewriting the saved enabled preference', async t => {
  const f = fixture(t, { preference: true, record: saved() }); let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  f.storage.load = () => { entered(); return new Promise(resolve => { release = resolve; }); }; const restoring = f.port.restore(true); await waiting;
  f.port.close(); release(saved()); await restoring; assert.equal(f.port.getState().status, 'disconnected'); assert.equal(f.port.getState().enabled, false);
  assert.equal(f.preference, true); assert.deepEqual(f.enabledWrites, []); assert.ok(f.suspended > 0);
});
test('explicit disconnect persists disabled and revokes access even when preference saving fails synchronously', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); await f.port.disconnect();
  assert.equal(f.preference, false); assert.equal(f.port.getState().connected, false); assert.equal(f.record, undefined); assert.equal(f.revoked, 1);
  const failed = fixture(t, { preference: true, record: saved() }); failed.link.setEnabled = () => { throw Error('preference disk failed'); };
  await assert.rejects(failed.port.disconnect()); assert.equal(failed.record, undefined); assert.equal(failed.revoked, 1); assert.equal(failed.port.getState().connected, false);
});
test('task grant/revoke hides old task history immediately and preserves quota/trend and the main connection', async t => {
  const f = fixture(t); await f.port.connect(); await settle();
  assert.equal(f.link.getSnapshot().history.results.length, 0); assert.equal(f.link.getSnapshot().history.windows.length, 1);
  await f.port.authorizeTasks(); await settle(); assert.equal(f.link.getSnapshot().history.results.length, 1);
  const revoked = f.port.revokeTasks(); assert.equal(f.port.isTasksAuthorized(), false); assert.equal(f.link.getSnapshot().history.results.length, 0);
  await revoked; assert.equal(f.record.tasks, false); assert.equal(f.port.getState().connected, true); assert.equal(f.preference, true);
  assert.equal(f.link.getSnapshot().quota.windows[0].remaining, 70); assert.equal(f.link.getSnapshot().history.windows.length, 1);
  assert.deepEqual(f.enabledWrites, [true]); assert.equal(f.link.getSnapshot().activity.runningCount, null);
});
test('revoke overtakes an in-flight task grant and a late save cannot authorize task reading', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); let release, entered; const save = f.storage.save;
  const waiting = new Promise(resolve => { entered = resolve; }); let blocked = false;
  f.storage.save = async (...args) => { await save(...args); if (!blocked && args[1].tasks) { blocked = true; entered(); await new Promise(resolve => { release = resolve; }); } };
  const authorizing = f.port.authorizeTasks(); await waiting; const revoking = f.port.revokeTasks(); release();
  assert.equal((await authorizing).status, 'cancelled'); await revoking;
  assert.equal(f.port.isTasksAuthorized(), false); assert.equal(f.record.tasks, false); assert.equal(f.port.getState().connected, true);
});
test('an account change during a task grant cannot attach old device history to the new connection', async t => {
  const f = fixture(t); await f.port.connect(); await settle(); const save = f.storage.save;
  f.storage.save = async (...args) => { await save(...args); if (args[1].tasks) f.setAccount(B); };
  await assert.rejects(f.port.authorizeTasks(), { code: 'ACCOUNT_CHANGED' }); assert.equal(f.port.isTasksAuthorized(), false);
  assert.equal(f.port.getAccountKey(), null); assert.equal(f.preference, true); assert.equal(f.record.tasks, false);
});
test('projection is pure, masks unapproved identity and task history, and cannot recurse through controller getState', async t => {
  const f = fixture(t); await f.port.connect(); await settle();
  for (let i = 0; i < 10; i++) assert.equal(f.port.getState().connected, true);
  const raw = structuredClone(f.source), before = JSON.stringify(raw), masked = projectMasZcodeSnapshot(raw, false, A);
  assert.deepEqual(masked.tasks.items, []); assert.deepEqual(masked.history.results, []); assert.equal(masked.history.windows.length, 1); assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(projectMasZcodeSnapshot(raw, true, B).history.windows, []); assert.deepEqual(projectMasZcodeSnapshot(raw, true, null).buckets, []);
  const approved = projectMasZcodeSnapshot(raw, true, A); assert.equal(approved.tasks.accountAttributionVerified, false); assert.equal(approved.activity.runningCount, null);
});
