const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkBuddyQuota } = require('../lib/workbuddy-quota');
const tick = () => new Promise(resolve => setImmediate(resolve));
const a = 'a'.repeat(64), b = 'b'.repeat(64), week = 7 * 86400000;
function fixture(t, historyFile) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-history-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = 2000000000000, outcome = { accountKey: a, report: { total: 7400 } };
  const options = { historyFile: historyFile || path.join(directory, 'history.json'), now: () => time, schedule: () => 1, cancel() {}, run: async () => { if (outcome instanceof Error) throw outcome; return outcome; } };
  const quota = createWorkBuddyQuota(options); t.after(() => quota.close());
  return { quota, options, time: value => { time = value; }, outcome: value => { outcome = value; } };
}
test('records only real successful observations, restores only after matching successful account query', async t => {
  const f = fixture(t); assert.deepEqual(f.quota.getState().history, []);
  f.quota.setEnabled(true); await tick();
  f.time(2000000300000); await f.quota.refresh();
  assert.deepEqual(f.quota.getState().history, [{ at: 2000000000000, total: 7400 }, { at: 2000000300000, total: 7400 }]);
  f.outcome(Object.assign(Error(), { code: 'CONNECTION_FAILED' })); await f.quota.refresh(); assert.equal(f.quota.getState().history.length, 2);
  const restored = createWorkBuddyQuota(f.options); t.after(() => restored.close());
  assert.deepEqual(restored.getState().history, []); assert.equal(restored.getState().report, null);
  restored.setEnabled(true); await tick(); assert.deepEqual(restored.getState().history, []);
  f.outcome({ accountKey: a, report: { total: 7300 } }); f.time(2000000600000); await restored.refresh(); assert.equal(restored.getState().history.length, 3);
  assert.equal(fs.statSync(f.options.historyFile).mode & 0o777, 0o600);
});
test('account switching, login invalidation and disabling never expose another account history', async t => {
  const f = fixture(t); f.quota.setEnabled(true); await tick();
  f.time(2000000300000); f.outcome({ accountKey: b, report: { total: 500 } }); await f.quota.refresh();
  assert.deepEqual(f.quota.getState().history.map(p => p.total), [500]);
  f.outcome(Object.assign(Error(), { code: 'LOGIN_REQUIRED' })); await f.quota.refresh(); assert.deepEqual(f.quota.getState().history, []);
  f.quota.setEnabled(false); assert.deepEqual(f.quota.getState().history, []); assert.ok(fs.existsSync(f.options.historyFile));
  f.outcome({ accountKey: a, report: { total: 7000 } }); f.quota.setEnabled(true); await tick(); assert.deepEqual(f.quota.getState().history.map(p => p.total), [7400, 7000]);
});
test('prunes seven days and caps samples without fabricating intermediate values', async t => {
  const f = fixture(t); const start = 2000000000000;
  const points = Array.from({ length: 2016 }, (_, i) => ({ at: start - 2016 + i, total: i }));
  fs.writeFileSync(f.options.historyFile, JSON.stringify({ version: 1, accounts: { [a]: points, [b]: [{ at: start - week - 1, total: 9 }] } }));
  const q = createWorkBuddyQuota(f.options); t.after(() => q.close()); q.setEnabled(true); await tick();
  assert.equal(q.getState().history.length, 2016); assert.equal(q.getState().history[0].total, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.options.historyFile)).accounts[b], undefined);
});
test('corrupt history preserves original file while current valid balance still updates', async t => {
  const f = fixture(t); fs.writeFileSync(f.options.historyFile, 'broken');
  const q = createWorkBuddyQuota(f.options); t.after(() => q.close()); q.setEnabled(true); await tick();
  assert.equal(q.getState().report.total, 7400); assert.equal(q.getState().history.length, 1); assert.match(q.getState().historyError, /无法保存/);
  assert.equal(fs.readFileSync(f.options.historyFile, 'utf8'), 'broken');
});
test('atomic save failure preserves balance and retries persistence on next successful query', async t => {
  const f = fixture(t); fs.writeFileSync(path.dirname(f.options.historyFile) + '/blocker', 'block');
  const options = { ...f.options, historyFile: path.join(path.dirname(f.options.historyFile), 'blocker', 'history.json') };
  const q = createWorkBuddyQuota(options); t.after(() => q.close());
  // The parent is a regular file, so the read is absent but atomic mkdir/write cannot succeed.
  q.setEnabled(true); await tick();
  assert.equal(q.getState().report.total, 7400); assert.match(q.getState().historyError, /无法保存/);
  fs.unlinkSync(path.dirname(f.options.historyFile) + '/blocker');
  await q.refresh();
  assert.equal(q.getState().historyError, null); assert.ok(fs.existsSync(options.historyFile));
});
test('enriches new samples with balance categories and expiry, while restoring old total-only samples', async t => {
  const f = fixture(t); fs.writeFileSync(f.options.historyFile, JSON.stringify({ version: 1, accounts: { [a]: [{ at: 1999999700000, total: 7400 }] } }));
  const report = { total: 7399, basic: 500, reward: 6899, purchased: 0, nextRefreshAt: 2000100000000, expires: [{ at: 2000050000000, amount: 99 }] };
  f.outcome({ accountKey: a, report });
  const q = createWorkBuddyQuota(f.options); t.after(() => q.close()); q.setEnabled(true); await tick();
  assert.deepEqual(q.getState().history, [{ at: 1999999700000, total: 7400 }, { at: 2000000000000, ...report }]);
  const stored = JSON.parse(fs.readFileSync(f.options.historyFile)); assert.equal(stored.accounts[a][1].reward, 6899);
});
