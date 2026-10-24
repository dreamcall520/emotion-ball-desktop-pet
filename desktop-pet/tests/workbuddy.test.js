const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { aad, decryptToken, quotaReport, readSse } = require('../lib/workbuddy-helper.cjs');
const { createWorkBuddyRunner } = require('../lib/workbuddy-client');
const { createWorkBuddyQuota } = require('../lib/workbuddy-quota');
const basicCode = 'TCACA_code_008_cfWoLwvjU4', rewardCode = 'TCACA_code_007_nzdH5h4Nl0';
const accountKey = 'a'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('encrypted token authenticates key, nonce, schema and ciphertext without exposing credentials', () => {
  const key = crypto.randomBytes(32), id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(id));
  const ciphertext = Buffer.concat([cipher.update('test-token-not-a-real-credential'), cipher.final()]);
  const envelope = { suite: 1, keyId: id, nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  const field = { $wbEncrypted: 1, envelope: Buffer.from(JSON.stringify(envelope)).toString('base64') };
  assert.equal(decryptToken(field, key, id), 'test-token-not-a-real-credential');
  assert.throws(() => decryptToken(field, crypto.randomBytes(32), id));
  assert.throws(() => decryptToken({ ...field, scheme: 'unknown' }, key, id), { code: 'UNSUPPORTED_AUTH' });
  assert.throws(() => decryptToken({ ...field, envelope: field.envelope + '\n' }, key, id));
});
test('quota uses remaining balances, matches all detail batches, separates base refresh and reward expiry', () => {
  const now = Date.parse('2026-10-24T00:00:00+08:00');
  const summary = { IsPaidUser: false, Packages: [{ PackageCode: basicCode, CycleTotalCapacity: '500', CycleUsedCapacity: '0' },
    { PackageCode: rewardCode, CycleTotalCapacity: '6900', CycleUsedCapacity: '0' }] };
  const expiry = Date.parse('2026-10-28T12:05:57+08:00');
  const accounts = [{ PackageCode: basicCode, CycleCapacityRemain: 500, CycleEndTime: '2026-10-31 23:59:59' },
    { PackageCode: rewardCode, CycleCapacityRemain: 100, DeductionEndTime: expiry },
    { PackageCode: rewardCode, CycleCapacityRemain: 6800, DeductionEndTime: expiry + 86400000 }];
  const report = quotaReport(summary, accounts, now);
  assert.equal(report.total, 7400); assert.equal(report.basic, 500); assert.equal(report.reward, 6900);
  assert.equal(report.purchased, 0); assert.equal(report.nextRefreshAt, Date.parse('2026-11-01T00:00:00+08:00'));
  assert.deepEqual(report.expires[0], { amount: 100, at: expiry });
  assert.throws(() => quotaReport(summary, accounts.slice(0, 2), now), { code: 'INVALID_RESPONSE' });
  assert.throws(() => quotaReport({ ...summary, IsPaidUser: true }, accounts, now), { code: 'UNSUPPORTED_ACCOUNT' });
  const zero = quotaReport({ IsPaidUser: false, Packages: [] }, [], now); assert.equal(zero.total, 0);
});
async function* chunks(text, size = 1) { const bytes = Buffer.from(text); for (let index = 0; index < bytes.length; index += size) yield bytes.subarray(index, index + size); }
test('SSE handles split UTF8 and CRLF, requires terminal and rejects tool calls/truncation', async () => {
  const stream = 'data: {"choices":[{"delta":{"content":"你好","tool_calls":[],"function_call":{"name":"","arguments":""}}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"","tool_calls":[],"function_call":{"name":null,"arguments":null}},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const deltas = []; assert.equal(await readSse(chunks(stream), value => deltas.push(value)), '你好'); assert.deepEqual(deltas, ['你好']);
  await assert.rejects(readSse(chunks('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), () => {}), { code: 'TRUNCATED_RESPONSE' });
  await assert.rejects(readSse(chunks('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"run"}}]}}]}\n\n'), () => {}), { code: 'TOOLS_UNSUPPORTED' });
  await assert.rejects(readSse(chunks('data: {"choices":[{"delta":{"function_call":{"arguments":"{}"}}}]}\n\n'), () => {}), { code: 'TOOLS_UNSUPPORTED' });
  await assert.rejects(readSse(chunks('data: {"choices":[{"delta":{"function_call":{"name":"run"}}}]}\n\n'), () => {}), { code: 'TOOLS_UNSUPPORTED' });
  await assert.rejects(readSse(chunks('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'), () => {}), { code: 'TRUNCATED_RESPONSE' });
});
function fakeChild() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.exitCode = null; child.killed = false; child.kill = () => { child.killed = true; };
  return child;
}
test('runner sends no credentials, streams deltas and waits for successful helper exit', async () => {
  const child = fakeChild(); let args, stdin = ''; child.stdin.on('data', chunk => { stdin += chunk; });
  const run = createWorkBuddyRunner({ spawnProcess: (...values) => { args = values; return child; } });
  const deltas = [], pending = run('chat', { model: 'auto', expectedAccountKey: accountKey }, { onDelta: text => deltas.push(text) });
  child.stdout.write(JSON.stringify({ type: 'delta', text: '你好' }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'result', result: { accountKey, text: '你好' } }) + '\n');
  child.exitCode = 0; child.emit('close', 0);
  assert.equal((await pending).text, '你好'); assert.deepEqual(deltas, ['你好']);
  assert.equal(args[2].env.ELECTRON_RUN_AS_NODE, '1'); assert(!stdin.includes('token')); assert.equal(JSON.parse(stdin).operation, 'chat');
});
test('runner cancellation kills only its helper and ignores stderr secrets', async () => {
  const child = fakeChild(), abort = new AbortController();
  const run = createWorkBuddyRunner({ spawnProcess: () => child });
  const pending = run('quota', {}, { signal: abort.signal }); child.stderr.write('sensitive diagnostic'); abort.abort();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(child.killed, true);
});
test('runner timeout terminates its helper, malformed stdout and unsuccessful exit cannot pass', async () => {
  const child = fakeChild(); let timeout;
  const run = createWorkBuddyRunner({ spawnProcess: () => child, schedule: fn => { timeout = fn; return 1; }, cancel: () => {} });
  const pending = run('quota'); timeout(); await assert.rejects(pending, { code: 'TIMEOUT' }); assert(child.killed);
  const malformed = fakeChild(), bad = createWorkBuddyRunner({ spawnProcess: () => malformed })('models');
  malformed.stdout.write('not json\n'); await assert.rejects(bad, { code: 'INVALID_RESPONSE' });
  const failed = fakeChild(), fail = createWorkBuddyRunner({ spawnProcess: () => failed })('quota');
  failed.stdout.write(JSON.stringify({ type: 'result', result: { accountKey, report: { total: 7400 } } }) + '\n');
  failed.exitCode = 1; failed.emit('close', 1); await assert.rejects(fail, { code: 'CONNECTION_FAILED' });
});
test('quota remains idle until enabled, refreshes independently, clears on disable and rejects late results', async () => {
  const timers = [], jobs = []; let callCount = 0;
  const quota = createWorkBuddyQuota({ run: (...args) => { callCount++; return new Promise(resolve => jobs.push({ resolve, args })); },
    schedule: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, cancel: () => {} });
  assert.equal(callCount, 0); quota.setEnabled(true); assert.equal(callCount, 1); assert.equal(quota.getState().busy, true);
  jobs[0].resolve({ accountKey, report: { total: 7400 } }); await tick(); assert.equal(quota.getState().report.total, 7400); assert.equal(timers[0].delay, 300000);
  const refresh = quota.refresh(); quota.setEnabled(false); assert(jobs[1].args[2].signal.aborted);
  jobs[1].resolve({ accountKey: 'b'.repeat(64), report: { total: 12 } }); await refresh;
  assert.equal(quota.getState().report, null); assert.equal(quota.getState().enabled, false); quota.close();
});
test('quota retains stale results only for transient errors and clears on login/account errors', async () => {
  let outcome = { accountKey, report: { total: 7400 } }; const timers = [];
  const quota = createWorkBuddyQuota({ run: async () => { if (outcome instanceof Error) throw outcome; return outcome; },
    schedule: (fn, delay) => { timers.push(delay); return fn; }, cancel: () => {} });
  quota.setEnabled(true); await tick(); outcome = Object.assign(new Error('private diagnostic'), { code: 'CONNECTION_FAILED' });
  await quota.refresh(); assert.equal(quota.getState().stale, true); assert.equal(quota.getState().report.total, 7400); assert(!quota.getState().error.includes('private'));
  await quota.refresh(); assert.equal(timers.at(-1), 600000);
  outcome = Object.assign(new Error(), { code: 'CONNECTION_FAILED', accountKey: 'b'.repeat(64) });
  await quota.refresh(); assert.equal(quota.getState().report, null); assert.equal(quota.getState().accountKey, null);
  outcome = Object.assign(new Error(), { code: 'ACCOUNT_CHANGED' }); await quota.refresh(); assert.equal(quota.getState().report, null); quota.close();
});
