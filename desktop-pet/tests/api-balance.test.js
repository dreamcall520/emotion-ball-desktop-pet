const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApiBalance, POLL_MS } = require('../lib/api-balance');
const { parseApiBalanceAccounts } = require('../lib/api-balance-account');
const flush = () => new Promise(resolve => setImmediate(resolve));
const balance = (available = 44.24) => ({ available, cash: available, voucher: 0, currency: 'CNY' });
function accounts(keys = ['one', 'two']) {
  return parseApiBalanceAccounts({ config: { providerConfigRules: { providerRules: keys.map((key, i) => ({
    providerId: `kimi-${i}`, templateId: 'moonshot-kimi', providerName: 'Kimi',
    config: { access: { type: 'api-key', apiKey: `sk-fixture-${key}` } }
  })) } } });
}
function clock() {
  let time = 10 * 86400000, next = 0; const timers = new Map();
  return { now: () => time, schedule(fn, ms) { const id = ++next; timers.set(id, { fn, at: time + ms }); return id; },
    cancel(id) { timers.delete(id); }, get timers() { return timers; },
    async advance(ms) {
      const end = time + ms; let count = 0;
      while (true) {
        const next = [...timers].filter(([, row]) => row.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break; if (++count > 1000) throw Error('timer loop');
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = end; await flush();
    } };
}
function fixture(options = {}) {
  const c = clock(), changes = [], selections = [], calls = []; let list = accounts(), reads = 0, watch, unwatched = 0;
  const service = createApiBalance({ readAccounts() { reads++; return list; },
    fetchBalance: async (account, context) => { calls.push({ id: account.id, context }); return balance(); },
    watchAccounts(fn) { watch = fn; return () => { unwatched++; }; },
    onChange: value => changes.push(value), onSelectAccount: id => selections.push(id),
    now: c.now, schedule: c.schedule, cancel: c.cancel, ...options });
  return { service, c, calls, changes, selections, get list() { return list; }, set list(v) { list = v; },
    get reads() { return reads; }, get unwatched() { return unwatched; }, watch() { watch(); } };
}
test('constructor and disabled methods do no I/O; explicit enabling queries and disabling clears all work', async () => {
  const f = fixture(); assert.equal(f.reads, 0); assert.equal(f.calls.length, 0); assert.equal(f.c.timers.size, 0);
  assert.equal(f.service.getState().status, 'disabled'); await f.service.refresh(); f.service.recover('auth');
  assert.equal(f.reads, 0); f.service.setEnabled(true); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.service.getState().report.available, 44.24);
  f.service.setEnabled(false); assert.equal(f.unwatched, 1); assert.equal(f.c.timers.size, 0);
  assert.deepEqual(f.service.getState().accounts, []); assert.equal(f.service.getState().report, null);
  await f.c.advance(2 * POLL_MS); assert.equal(f.calls.length, 1); f.service.close();
});
test('all supported accounts are polled serially with independent balance, history and cached selection', async () => {
  const f = fixture({ fetchBalance: async account => balance(account.id === first ? 44 : 88) });
  const first = f.list[0].id, second = f.list[1].id;
  f.service.setEnabled(true); await flush(); assert.equal(f.service.getState().report.available, 44);
  await f.c.advance(500); let state = f.service.getState();
  assert.equal(state.accounts.find(row => row.id === second).report.available, 88);
  assert.equal(state.history.length, 1); assert.equal(state.history[0].available, 44);
  assert.equal(f.service.selectAccount(second), true); assert.equal(f.service.getState().report.available, 88);
  await flush(); state = f.service.getState(); assert.equal(state.history[0].available, 88);
  assert.equal(state.selectedAccountId, second); assert.equal(f.service.selectAccount('bad'), false);
  assert.doesNotMatch(JSON.stringify(state), /sk-fixture|apiKey|baseUrl/); f.service.close();
});
test('duplicate refresh shares one request and selection aborts old response without cross-account leakage', async () => {
  const pending = [];
  const f = fixture({ fetchBalance: (account, context) => new Promise(resolve => pending.push({ account, context, resolve })) });
  const [first, second] = f.list;
  f.service.setEnabled(true); const one = f.service.refresh(), two = f.service.refresh();
  assert.equal(one, two); assert.equal(pending.length, 1);
  f.service.selectAccount(second.id); assert.equal(pending[0].context.signal.aborted, true);
  assert.equal(f.service.getState().report, null); assert.equal(pending.length, 2);
  pending[0].resolve(balance(111)); await flush(); assert.equal(f.service.getState().report, null);
  pending[1].resolve(balance(222)); await flush();
  assert.equal(f.service.getState().report.available, 222);
  assert.equal(f.service.getState().accounts.find(row => row.id === first.id).report, null);
  assert.equal(f.service.getState().history[0].available, 222); f.service.close();
});
test('key rotation during a query discards result and switches safely to new account', async () => {
  const pending = []; const f = fixture({ fetchBalance: (account, context) => new Promise(resolve => pending.push({ account, context, resolve })) });
  f.list = accounts(['old']); f.service.setEnabled(true); const oldId = f.list[0].id;
  f.list = accounts(['new']); const newId = f.list[0].id; pending[0].resolve(balance(111)); await flush();
  assert.equal(f.service.getState().selectedAccountId, newId); assert.equal(f.service.getState().report, null);
  await f.c.advance(500); assert.equal(pending[1].account.id, newId); pending[1].resolve(balance(22)); await flush();
  const state = f.service.getState(); assert.equal(state.report.available, 22); assert.equal(state.accounts.some(row => row.id === oldId), false);
  f.service.close();
});
test('temporary failures keep old balance stale and use bounded short retries before normal polling', async () => {
  let failing = false, requests = 0;
  const f = fixture({ fetchBalance: async () => { requests++; if (failing) throw Object.assign(new Error('raw secret'), { code: 'TIMEOUT' }); return balance(); } });
  f.list = accounts(['one']); f.service.setEnabled(true); await flush(); failing = true;
  await f.service.refresh(); assert.equal(f.service.getState().status, 'stale'); assert.equal(f.service.getState().report.available, 44.24);
  for (const delay of [5000, 15000, 60000, POLL_MS]) {
    assert.equal(f.service.getState().nextRetryAt - f.c.now(), delay); await f.c.advance(delay);
  }
  assert.equal(requests, 6); failing = false; await f.service.refresh();
  assert.equal(f.service.getState().stale, false); assert.equal(f.service.getState().errorCode, null);
  assert.doesNotMatch(JSON.stringify(f.service.getState()), /raw secret/); f.service.close();
});
test('authentication failure clears only the failed account while another account remains intact', async () => {
  let failId = null; const f = fixture({ fetchBalance: async account => {
    if (account.id === failId) throw Object.assign(new Error('bad token'), { code: 'UNAUTHENTICATED' }); return balance(25);
  } });
  f.service.setEnabled(true); await flush(); await f.c.advance(500); const [a, b] = f.list;
  failId = a.id; await f.service.refresh(); let state = f.service.getState();
  assert.equal(state.status, 'unauthenticated'); assert.equal(state.report, null); assert.deepEqual(state.history, []);
  assert.equal(state.accounts.find(row => row.id === b.id).report.available, 25);
  f.service.selectAccount(b.id); await flush(); assert.equal(f.service.getState().report.available, 25); f.service.close();
});
test('rate limits are not bypassed by refresh, recovery bursts or source watcher events', async () => {
  let requests = 0; const f = fixture({ fetchBalance: async () => { requests++; throw Object.assign(new Error(), { code: 'RATE_LIMITED', retryAfterMs: 600000 }); } });
  f.list = accounts(['one']); f.service.setEnabled(true); await flush(); const next = f.service.getState().nextRetryAt;
  await f.service.refresh(); f.service.recover('resume'); f.service.recover('online'); f.watch();
  await f.c.advance(500); assert.equal(requests, 1); assert.equal(f.service.getState().nextRetryAt, next);
  await f.c.advance(599500); assert.equal(requests, 2); f.service.close();
});
test('recovery coalesces, discovers changed config and never requests unsupported providers', async () => {
  const f = fixture(); f.list = [];
  f.service.setEnabled(true); await flush(); assert.equal(f.service.getState().status, 'empty');
  f.list = [...accounts(['new']), ...parseApiBalanceAccounts({ config: { providerConfigRules: { providerRules: [
    { providerId: 'other', templateId: 'other', providerName: 'Other', config: { access: { apiKey: 'sk-other-test' } } }
  ] } } })];
  f.service.recover('online'); f.watch(); f.service.recover('resume'); await f.c.advance(500);
  assert.equal(f.calls.length, 1); assert.equal(f.service.getState().accounts.length, 2);
  const unsupported = f.list[1]; f.service.selectAccount(unsupported.id); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.service.getState().status, 'unsupported'); assert.equal(f.service.getState().report, null);
  f.service.close();
});
test('config errors do not publish in-flight result and recovery can safely retry', async () => {
  let invalid = false, resolve; const list = accounts(['one']);
  const f = fixture({ readAccounts: () => { if (invalid) throw Object.assign(new Error('raw config secret'), { code: 'CONFIG_INVALID' }); return list; },
    fetchBalance: () => new Promise(done => { resolve = done; }) });
  f.service.setEnabled(true); invalid = true; resolve(balance(99)); await flush();
  assert.equal(f.service.getState().report, null); assert.equal(f.service.getState().errorCode, 'CONFIG_INVALID');
  invalid = false; f.service.recover('auth'); await f.c.advance(500); resolve(balance(7)); await flush();
  assert.equal(f.service.getState().report.available, 7); f.service.close();
});
test('close aborts work and ignores late results, including subsequent re-enable attempts', async () => {
  let resolve, signal; const f = fixture({ fetchBalance: (_account, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
  f.service.setEnabled(true); f.service.recover('online'); f.service.close(); assert.equal(signal.aborted, true);
  assert.equal(f.c.timers.size, 0); resolve(balance(999)); await flush(); f.service.setEnabled(true);
  assert.equal(f.service.getState().enabled, false); assert.equal(f.service.getState().report, null);
});
test('history stores bounded account-only numeric data atomically and keeps accounts isolated after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-history-')), file = path.join(dir, 'history.json');
  try {
    const f = fixture({ historyFile: file }); assert.equal(fs.existsSync(file), false);
    f.service.setEnabled(true); await flush(); await f.c.advance(500);
    const stored = JSON.parse(fs.readFileSync(file)); assert.equal(Object.keys(stored.accounts).length, 2);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /sk-fixture|apiKey|Kimi|moonshot/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.deepEqual(fs.readdirSync(dir), ['history.json']);
    const selected = f.list[1].id; f.service.close();
    const second = fixture({ historyFile: file, selectedAccountId: selected, fetchBalance: () => new Promise(() => {}) });
    assert.equal(second.service.getState().report, null); await second.c.advance(500); second.service.setEnabled(true);
    assert.equal(second.service.getState().selectedAccountId, selected); assert.equal(second.service.getState().history.length, 1);
    second.service.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invalid historical files are preserved; network balances can still update', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-history-invalid-')), file = path.join(dir, 'history.json');
  try {
    fs.writeFileSync(file, '{broken-existing-history'); const f = fixture({ historyFile: file });
    assert.equal(f.service.getState().historyError, null); f.service.setEnabled(true); await flush();
    assert.equal(f.service.getState().report.available, 44.24); assert.ok(f.service.getState().historyError);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken-existing-history'); f.service.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
