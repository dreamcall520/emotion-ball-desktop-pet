const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyQuota } = require('../lib/workbuddy-quota');
const { safeState } = require('../lib/workbuddy-label-window');
const { watchWorkBuddyAuth } = require('../lib/workbuddy-auth-watch');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const accountKey = 'a'.repeat(64);
const success = total => ({ accountKey, report: { total, basic: total, reward: 0, purchased: 0 } });
const fail = code => Object.assign(new Error('secret diagnostic'), { code, publicMessage: 'secret token' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(run) {
  let time = 1000000, authChanged, stopped = 0;
  const timers = new Map(), changes = []; let id = 0;
  const quota = createWorkBuddyQuota({ run, now: () => time, onChange: state => changes.push(state),
    watchAuth: listener => { authChanged = listener; return () => { stopped++; }; },
    schedule: (fn, delay) => { const token = ++id; timers.set(token, { fn, at: time + delay }); return token; },
    cancel: token => timers.delete(token) });
  return { quota, timers, changes, auth: () => authChanged(), stopped: () => stopped, now: () => time,
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      time = end;
    } };
}
test('transient failure retains last success, retries promptly and recovers without manual refresh', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; if (calls === 2) throw fail('CONNECTION_FAILED'); return success(calls === 1 ? 10 : 9); });
  f.quota.setEnabled(true); await tick();
  await f.advance(300000);
  assert.equal(f.quota.getState().stale, true);
  assert.equal(f.quota.getState().report.total, 10);
  assert.equal(f.quota.getState().errorCode, 'CONNECTION_FAILED');
  assert.equal(f.quota.getState().nextRetryAt, f.now() + 15000);
  assert.doesNotMatch(JSON.stringify(f.quota.getState()), /secret/);
  await f.advance(15000);
  assert.equal(calls, 3); assert.equal(f.quota.getState().report.total, 9);
  assert.equal(f.quota.getState().stale, false); assert.equal(f.quota.getState().errorCode, null);
  assert.equal(f.quota.getState().nextRetryAt, null);
  assert.equal([...f.timers.values()][0].at - f.now(), 300000);
  f.quota.close();
});
test('fast retries are bounded and rate limits keep exponential backoff across recovery events', async () => {
  let code = 'TIMEOUT';
  const f = fixture(async () => { throw fail(code); });
  f.quota.setEnabled(true); await tick();
  for (const delay of [15000, 45000, 120000, 300000, 600000, 1200000, 1800000]) {
    assert.equal(f.quota.getState().nextRetryAt - f.now(), delay);
    await f.advance(delay);
  }
  code = 'RATE_LIMITED';
  f.quota.setEnabled(false); f.quota.setEnabled(true); await tick();
  const retryAt = f.quota.getState().nextRetryAt;
  assert.equal(retryAt - f.now(), 300000);
  f.quota.recover('resume'); f.quota.recover('online'); f.auth();
  await f.advance(1000); assert.equal(f.quota.getState().nextRetryAt, retryAt);
  await f.advance(299000); assert.equal(f.quota.getState().nextRetryAt - f.now(), 600000);
  f.quota.close();
});
test('login loss clears private account state and auth change restores it with a single coalesced request', async () => {
  let outcome = success(10), calls = 0;
  const f = fixture(async () => { calls++; if (outcome instanceof Error) throw outcome; return outcome; });
  f.quota.setEnabled(true); await tick(); outcome = fail('LOGIN_REQUIRED'); await f.quota.refresh();
  assert.equal(f.quota.getState().report, null); assert.equal(f.quota.getState().accountKey, null);
  assert.deepEqual(f.quota.getState().history, []); assert.equal(f.timers.size, 0);
  assert.equal(safeState(f.quota.getState()).error, '请在 WorkBuddy 中重新登录');
  outcome = success(8); f.auth(); f.auth(); f.quota.recover('online'); f.quota.recover('resume');
  await f.advance(500); assert.equal(calls, 3); assert.equal(f.quota.getState().report.total, 8);
  f.quota.close(); assert.equal(f.stopped(), 1);
});
test('recovery during a request queues one fresh read and disabling cancels all pending work', async () => {
  const jobs = [];
  const f = fixture((operation, payload, options) => new Promise(resolve => jobs.push({ resolve, options })));
  f.quota.setEnabled(true); f.auth(); f.quota.recover('resume'); f.quota.recover('online');
  assert.equal(jobs.length, 1);
  jobs[0].resolve(success(10)); await tick(); await f.advance(500);
  assert.equal(jobs.length, 2);
  f.auth(); f.quota.setEnabled(false);
  assert.equal(jobs[1].options.signal.aborted, true); assert.equal(f.timers.size, 0); assert.equal(f.stopped(), 1);
  jobs[1].resolve(success(99)); await tick(); await f.advance(1000000);
  assert.equal(f.quota.getState().report, null); assert.equal(jobs.length, 2);
  f.auth(); f.quota.recover('resume'); assert.equal(f.timers.size, 0);
  f.quota.setEnabled(true); assert.equal(jobs.length, 3); f.quota.close();
  jobs[2].resolve(success(55)); await tick(); f.auth(); f.quota.recover('online');
  assert.equal(f.timers.size, 0); assert.equal(f.quota.getState().enabled, false); assert.equal(f.stopped(), 2);
});
test('quota IPC allows only safe error codes and finite retry timestamps', () => {
  const state = safeState({ error: 'secret', errorCode: 'TIMEOUT', nextRetryAt: 12345 });
  assert.equal(state.errorCode, 'TIMEOUT'); assert.equal(state.nextRetryAt, 12345); assert.doesNotMatch(JSON.stringify(state), /secret/);
  const unknown = safeState({ error: 'secret', errorCode: 'TOKEN_secret', nextRetryAt: Infinity });
  assert.equal(unknown.errorCode, 'UPDATE_FAILED'); assert.equal(unknown.nextRetryAt, null);
});
test('a rate-limited in-flight recovery still publishes its final state without another request', async () => {
  let reject;
  const f = fixture(() => new Promise((resolve, rejectJob) => { reject = rejectJob; }));
  f.quota.setEnabled(true); f.quota.recover('online'); reject(fail('RATE_LIMITED')); await tick();
  assert.equal(f.changes.at(-1).busy, false); assert.equal(f.changes.at(-1).errorCode, 'RATE_LIMITED');
  assert.equal(f.changes.at(-1).nextRetryAt - f.now(), 300000); assert.equal(f.timers.size, 1);
  f.quota.close();
});
test('auth watcher filters unrelated events, follows directory creation and closes old subscriptions', () => {
  const watchers = [], available = new Set(['/tmp/auth-test']); let changed = 0, stats = 0;
  const stop = watchWorkBuddyAuth(() => changed++, {
    authFile: '/tmp/auth-test/auth/workbuddy-desktop.info',
    stat(directory) { stats++; if (!available.has(directory)) throw Error(); return { isDirectory: () => true }; },
    watch(directory, options, listener) {
      const item = new EventEmitter(); Object.assign(item, { directory, options, listener, closed: false, close() { this.closed = true; } });
      watchers.push(item); return item;
    }
  });
  assert.equal(watchers[0].directory, '/tmp/auth-test'); assert.equal(watchers[0].options.persistent, false);
  const initialStats = stats; watchers[0].listener('change', 'unrelated'); assert.equal(stats, initialStats); assert.equal(changed, 0);
  available.add('/tmp/auth-test/auth'); watchers[0].listener('rename', 'auth');
  assert.equal(watchers[0].closed, true); assert.equal(watchers[1].directory, '/tmp/auth-test/auth'); assert.equal(changed, 1);
  watchers[0].listener('rename', 'auth'); assert.equal(changed, 1);
  watchers[1].listener('change', 'workbuddy-desktop.info'); assert.equal(changed, 2);
  watchers[1].listener('rename', 'workbuddy-desktop.info'); assert.equal(changed, 3); assert.equal(watchers[1].closed, true);
  watchers[2].listener('change', 'workbuddy-desktop.info.logged-out'); assert.equal(changed, 4);
  watchers[2].emit('error', new Error('private OS diagnostic'));
  assert.equal(watchers[2].closed, true); assert.equal(watchers[3].directory, '/tmp/auth-test');
  stop(); watchers[3].listener('rename', 'auth'); assert.equal(changed, 4); assert.equal(watchers[3].closed, true);
});
test('native auth directory watcher observes atomic replacement of a temporary fixture twice', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-auth-watch-'));
  const authFile = path.join(directory, 'workbuddy-desktop.info');
  fs.writeFileSync(authFile, 'fixture only');
  let nextChange = null;
  const stop = watchWorkBuddyAuth(() => { const next = nextChange; nextChange = null; next?.(); }, { authFile });
  t.after(() => { stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function replace() {
    let timeout;
    const changed = new Promise((resolve, reject) => {
      nextChange = resolve; timeout = setTimeout(() => reject(new Error('fixture watcher did not observe replacement')), 3000);
    });
    fs.writeFileSync(`${authFile}.tmp`, 'replacement fixture only'); fs.renameSync(`${authFile}.tmp`, authFile);
    try { await changed; } finally { clearTimeout(timeout); }
  }
  await replace(); await replace();
});
