const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createZcodeQuotaHistory } = require('../lib/zcode-quota-history');
const { createZcodeCompanion } = require('../lib/zcode-companion');
const { normalizeZcodeBalance } = require('../lib/zcode-usage');
const { buildZcodeQuotaLabelModel } = require('../lib/zcode-quota-view');
const fixture = require('./fixtures/zcode-balance.json');
const initialNow = fixture.server_time * 1000;

test('team configuration failures preserve history without presenting previous quota as current, then recover', async t => {
  let now = initialNow, failure = null;
  const buckets = normalizeZcodeBalance(fixture, now);
  const companion = createZcodeCompanion({ now: () => now, readAccount: () => ({ accountKey: 'team-account' }),
    fetchUsage: async () => { if (failure) throw Object.assign(new Error('PRIVATE'), { code: failure }); return { buckets }; },
    readTasks: async () => ({ state: 'unknown', items: [], results: [] }) });
  t.after(() => companion.close());
  await companion.setEnabled(true);
  const history = companion.getSnapshot().history.windows;
  for (const code of ['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED']) {
    now += 1000; failure = code; await companion.refresh();
    const snapshot = companion.getSnapshot(), model = buildZcodeQuotaLabelModel(snapshot, {}, now);
    assert.equal(snapshot.quota.state, 'disconnected'); assert.equal(snapshot.quota.code, code);
    assert.equal(snapshot.quota.queryFailed, false);
    assert.equal(snapshot.quota.stale, true); assert.equal(snapshot.quota.updatedAt, initialNow);
    assert.deepEqual(snapshot.history.windows, history);
    assert.equal(model.state, 'disconnected'); assert.equal(model.statusCode, code); assert.deepEqual(model.items, []);
  }
  failure = null; now += 120000; await companion.refresh();
  const snapshot = companion.getSnapshot(), model = buildZcodeQuotaLabelModel(snapshot, {}, now);
  assert.equal(snapshot.quota.code, null); assert.equal(snapshot.quota.stale, false); assert.equal(snapshot.quota.updatedAt, now);
  assert.equal(model.state, 'ready'); assert.equal(model.statusCode, undefined); assert.equal(model.items.length, buckets.length);
});

test('a temporary quota request failure immediately marks retained values stale and adds no successful sample', async t => {
  let now = initialNow, offline = false;
  const buckets = normalizeZcodeBalance(fixture, now);
  const companion = createZcodeCompanion({ now: () => now, readAccount: () => ({ accountKey: 'team-account' }),
    fetchUsage: async () => { if (offline) throw Object.assign(new Error('offline'), { code: 'ZCODE_NETWORK_ERROR' }); return { buckets }; },
    readTasks: async () => ({ state: 'unknown', items: [], results: [] }) });
  t.after(() => companion.close());
  await companion.setEnabled(true); const history = companion.getSnapshot().history.windows;
  now += 1000; offline = true; await companion.refresh();
  const snapshot = companion.getSnapshot(), model = buildZcodeQuotaLabelModel(snapshot, {}, now);
  assert.equal(snapshot.quota.state, 'connected'); assert.equal(snapshot.quota.stale, true);
  assert.equal(snapshot.quota.updatedAt, initialNow); assert.deepEqual(snapshot.history.windows, history);
  assert.equal(model.state, 'stale'); assert.deepEqual(model.items.map(row => row.remaining), buckets.map(row => row.remaining));
  assert.equal(model.statusCode, 'ZCODE_QUOTA_UPDATE_FAILED');
  offline = false; await companion.refresh();
  assert.equal(companion.getSnapshot().quota.stale, false); assert.equal(companion.getSnapshot().quota.code, null);
});

test('history separates account, bucket and period, bounds storage and never fabricates samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-history-')); const filePath = path.join(dir, 'zcode.json');
  let now = initialNow; const store = createZcodeQuotaHistory({ filePath, now: () => now });
  const buckets = normalizeZcodeBalance(fixture, now);
  store.setAccount('a'); assert.equal(store.getState().windows.length, 0);
  store.record({ enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: buckets } });
  assert.equal(store.getState().windows.length, 4); assert.equal(store.getState().windows[0].samples.length, 1);
  now += 120000; store.record({ enabled: true, quota: { state: 'connected', stale: true, updatedAt: now, windows: buckets } });
  assert.equal(store.getState().windows[0].samples.length, 1);
  store.setAccount('b'); assert.equal(store.getState().windows.length, 0);
  store.setAccount('a'); assert.equal(store.getState().windows.length, 4);
  const later = { ...buckets[0], periodStart: buckets[0].periodStart + 86400000, resetsAt: buckets[0].resetsAt + 86400000 };
  now = later.periodStart + 60000; store.record({ enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: [later] } });
  assert.equal(store.getState().windows.filter(row => row.id === later.id).length, 2);
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('jwt'), false);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  const loaded = createZcodeQuotaHistory({ filePath, now: () => now }); loaded.setAccount('a'); assert.equal(loaded.getState().windows.length, 5);
  store.close(); loaded.close(); fs.rmSync(dir, { recursive: true });
});
test('companion isolates requests across disabled generation and account changes; snapshots never expose credentials', async () => {
  let now = initialNow; let resolve; let accountKey = 'a'; let pending = true;
  const timers = new Map(); let nextTimer = 0;
  const companion = createZcodeCompanion({ now: () => now,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, cancel: id => timers.delete(id),
    readAccount: () => ({ accountKey, family: 'zai', jwtToken: 'secret', deviceMid: 'private' }),
    fetchUsage: async () => pending ? new Promise(done => { resolve = done; }) : { buckets: normalizeZcodeBalance(fixture, now), updatedAt: now },
    readTasks: async () => ({ state: 'unknown', items: [], results: [] }) });
  const first = companion.setEnabled(true); await new Promise(done => setImmediate(done));
  await companion.setEnabled(false); resolve({ buckets: normalizeZcodeBalance(fixture, now), updatedAt: now }); await first;
  assert.equal(companion.getSnapshot().enabled, false); assert.deepEqual(companion.getSnapshot().buckets, []); assert.equal(timers.size, 0);
  pending = false; await companion.setEnabled(true); assert.equal(companion.getSnapshot().buckets.length, 4);
  assert.equal(JSON.stringify(companion.getSnapshot()).includes('secret'), false); assert.equal(companion.getSnapshot().activity.runningCount, null);
  assert.ok([...timers.values()].some(row => row.delay === 120000)); assert.ok([...timers.values()].some(row => row.delay === 15000));
  now += 300000; assert.equal(companion.getSnapshot().quota.stale, true);
  accountKey = 'b'; await companion.refresh(); assert.equal(companion.getSnapshot().accountKey, 'b');
  assert.equal(companion.getSnapshot().history.windows[0].samples.length, 1);
  companion.close(); assert.equal(timers.size, 0);
});
test('only observed live-to-terminal transitions become unread; old results are not backfilled and reads stay read', async () => {
  let phase = 'old';
  const terminal = { id: 'zcode:task1', turnId: 'turn1', title: 'done', state: 'completed', updatedAt: initialNow };
  const companion = createZcodeCompanion({ now: () => initialNow,
    readAccount: () => ({ accountKey: 'a' }), fetchUsage: async () => ({ buckets: [], updatedAt: initialNow }),
    readTasks: async () => ({ state: 'unknown', items: phase === 'live' ? [{ ...terminal, state: 'active', liveVerified: true }] : [],
      results: phase === 'live' ? [] : [terminal] }) });
  await companion.setEnabled(true); assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  assert.equal(companion.getSnapshot().tasks.results.length, 1, 'terminal observations may remain in the snapshot');
  await companion.refresh(); assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  phase = 'live'; await companion.refresh(); phase = 'terminal'; await companion.refresh();
  assert.equal(companion.getSnapshot().activity.unreadCount, 1);
  companion.markAllRead(); await companion.refresh(); assert.equal(companion.getSnapshot().activity.unreadCount, 0); companion.close();
});
test('an account switch during an outstanding quota request discards the old result', async () => {
  let key = 'first'; let finish; const timers = new Map(); let seq = 0;
  const companion = createZcodeCompanion({ now: () => initialNow, readAccount: () => ({ accountKey: key }),
    schedule: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, cancel: id => timers.delete(id),
    fetchUsage: () => new Promise(resolve => { finish = resolve; }), readTasks: async () => ({ state: 'unknown', items: [] }) });
  const pending = companion.setEnabled(true); await new Promise(resolve => setImmediate(resolve)); key = 'second';
  finish({ buckets: normalizeZcodeBalance(fixture, initialNow), updatedAt: initialNow }); await pending;
  assert.equal(companion.getSnapshot().accountKey, 'second'); assert.equal(companion.getSnapshot().buckets.length, 0);
  assert.equal(companion.getSnapshot().history.windows.length, 0); companion.close();
});
test('late failed account recheck from an old enabled run cannot clear a newly connected account', async () => {
  let phase = 'old'; let blockRecheck = false; let failRecheck; let finishOldQuota; let finishOldTasks;
  const accountA = { accountKey: 'a' }, accountB = { accountKey: 'b' };
  const companion = createZcodeCompanion({ now: () => initialNow,
    readAccount: () => {
      if (phase === 'new') return accountB;
      if (blockRecheck) { blockRecheck = false; return new Promise((_resolve, reject) => { failRecheck = reject; }); }
      return accountA;
    },
    fetchUsage: () => phase === 'old' ? new Promise(resolve => { finishOldQuota = resolve; }) : Promise.resolve({ buckets: [], updatedAt: initialNow }),
    readTasks: () => phase === 'old' ? new Promise(resolve => { finishOldTasks = resolve; }) : Promise.resolve({ state: 'idle', items: [] }) });
  const oldRun = companion.setEnabled(true); await new Promise(resolve => setImmediate(resolve));
  blockRecheck = true; finishOldQuota({ buckets: [], updatedAt: initialNow }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof failRecheck, 'function'); await companion.setEnabled(false); phase = 'new'; await companion.setEnabled(true);
  assert.equal(companion.getSnapshot().accountKey, 'b');
  failRecheck(Object.assign(new Error('expired old auth'), { code: 'ZCODE_LOGIN_REQUIRED' }));
  finishOldTasks({ state: 'unknown', items: [] }); await oldRun;
  assert.equal(companion.getSnapshot().accountKey, 'b'); assert.equal(companion.getSnapshot().quota.state, 'connected'); companion.close();
});
test('disable and close abort only this companion in-flight quota requests', async () => {
  const signals = []; let finish;
  const companion = createZcodeCompanion({ readAccount: () => ({ accountKey: 'a' }),
    fetchUsage: (_account, options) => { signals.push(options.signal); return new Promise(resolve => { finish = resolve; }); },
    readTasks: async () => ({ state: 'unknown', items: [] }) });
  const pending = companion.setEnabled(true); await new Promise(resolve => setImmediate(resolve));
  await companion.setEnabled(false); assert.equal(signals[0]?.aborted, true); finish({ buckets: [] }); await pending;
  const second = companion.setEnabled(true); await new Promise(resolve => setImmediate(resolve));
  companion.close(); assert.equal(signals[1]?.aborted, true); finish({ buckets: [] }); await second;
});
test('old initial account reads cannot restart work after an off/on cycle for the same account', async () => {
  let phase = 'old'; const finishReads = []; let fetches = 0;
  const companion = createZcodeCompanion({ now: () => initialNow,
    readAccount: () => phase === 'old' ? new Promise(resolve => finishReads.push(resolve)) : { accountKey: 'same' },
    fetchUsage: async () => { fetches++; return { buckets: [], updatedAt: initialNow }; },
    readTasks: async () => ({ state: 'idle', items: [] }) });
  const oldRun = companion.setEnabled(true); await new Promise(resolve => setImmediate(resolve));
  await companion.setEnabled(false); phase = 'new'; await companion.setEnabled(true); assert.equal(fetches, 1);
  finishReads.forEach(resolve => resolve({ accountKey: 'same' })); await oldRun;
  assert.equal(fetches, 1); assert.equal(companion.getSnapshot().quota.state, 'connected'); companion.close();
});
test('companion preserves per-row verified live evidence without inventing a global running count', async () => {
  const companion = createZcodeCompanion({ now: () => initialNow, readAccount: () => ({ accountKey: 'a' }),
    fetchUsage: async () => ({ buckets: [], updatedAt: initialNow }),
    readTasks: async () => ({ state: 'unknown', items: [{ id: 'verified', title: 'verified', state: 'active', liveVerified: true, updatedAt: initialNow }] }) });
  await companion.setEnabled(true); const snapshot = companion.getSnapshot();
  assert.equal(snapshot.tasks.items[0].liveVerified, true); assert.equal(snapshot.activity.runningCount, null); companion.close();
});
test('unverified running rows or a different turn cannot certify a new completion', async () => {
  let result = { state: 'unknown', items: [{ id: 'task', turnId: 'turn1', state: 'active', liveVerified: false, updatedAt: initialNow }] };
  const companion = createZcodeCompanion({ now: () => initialNow, readAccount: () => ({ accountKey: 'a' }),
    fetchUsage: async () => ({ buckets: [], updatedAt: initialNow }), readTasks: async () => result });
  await companion.setEnabled(true);
  result = { state: 'unknown', results: [{ id: 'task', turnId: 'turn1', state: 'completed', updatedAt: initialNow }] };
  await companion.refresh(); assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  result = { state: 'unknown', items: [{ id: 'task', turnId: 'turn1', state: 'waiting', liveVerified: true, updatedAt: initialNow }] };
  await companion.refresh(); result = { state: 'unknown', results: [{ id: 'task', turnId: 'turn2', state: 'completed', updatedAt: initialNow }] };
  await companion.refresh(); assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  result.results[0].turnId = 'turn1'; await companion.refresh(); assert.equal(companion.getSnapshot().activity.unreadCount, 1); companion.close();
});
test('live observations are cleared by disabling and account changes', async () => {
  let accountKey = 'a'; let terminal = false;
  const row = { id: 'task', turnId: 'turn', updatedAt: initialNow };
  const companion = createZcodeCompanion({ now: () => initialNow, readAccount: () => ({ accountKey }),
    fetchUsage: async () => ({ buckets: [], updatedAt: initialNow }), readTasks: async () => ({ state: 'unknown',
      items: terminal ? [] : [{ ...row, state: 'active', liveVerified: true }], results: terminal ? [{ ...row, state: 'completed' }] : [] }) });
  await companion.setEnabled(true); await companion.setEnabled(false); terminal = true; await companion.setEnabled(true);
  assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  terminal = false; await companion.refresh(); accountKey = 'b'; terminal = true; await companion.refresh();
  assert.equal(companion.getSnapshot().activity.unreadCount, 0); companion.close();
});
test('live observation tracking stays bounded to the latest 64 turns', async () => {
  const row = id => ({ id: `task-${id}`, turnId: `turn-${id}`, state: 'active', liveVerified: true, updatedAt: initialNow });
  let result = { state: 'unknown', items: Array.from({ length: 64 }, (_unused, id) => row(id)) };
  const companion = createZcodeCompanion({ now: () => initialNow, readAccount: () => ({ accountKey: 'a' }),
    fetchUsage: async () => ({ buckets: [], updatedAt: initialNow }), readTasks: async () => result });
  await companion.setEnabled(true); result = { state: 'unknown', items: [row(64)] }; await companion.refresh();
  result = { state: 'unknown', results: [{ ...row(0), state: 'completed' }] }; await companion.refresh();
  assert.equal(companion.getSnapshot().activity.unreadCount, 0);
  result.results = [{ ...row(64), state: 'completed' }]; await companion.refresh();
  assert.equal(companion.getSnapshot().activity.unreadCount, 1); companion.close();
});

test('history retains sub-minute correction boundaries while ordinary polls remain throttled', () => {
  let now = initialNow;
  const store = createZcodeQuotaHistory({ now: () => now }); store.setAccount('boundaries');
  const bucket = normalizeZcodeBalance(fixture, now)[0];
  const record = remaining => store.record({ enabled: true, quota: { state: 'connected', stale: false,
    updatedAt: now, windows: [{ ...bucket, remaining }] } });
  record(80); now += 10000; record(79);
  assert.equal(store.getState().windows[0].samples.length, 1, 'ordinary short poll is not a new history point');
  now += 10000; record(85);
  assert.equal(store.getState().windows[0].samples.length, 2, 'increase must split forecasts');
  now += 10000; record(60);
  assert.equal(store.getState().windows[0].samples.length, 3, 'large decrease must split forecasts');
  now += 300000; record(59);
  assert.deepEqual(store.getState().windows[0].samples.map(row => row.remaining), [80, 85, 60, 59]);
  store.close();
});
