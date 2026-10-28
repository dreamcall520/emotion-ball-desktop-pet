const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaReport, execute, sessionIdentity } = require('../lib/workbuddy-helper.cjs');
const { workBuddyError } = require('../lib/workbuddy-client');
const status = require('../lib/workbuddy-quota-status');
const now = Date.parse('2026-10-27T12:00:00+08:00'), expiry = now + 7 * 86400000;
const basic = 'TCACA_code_008_cfWoLwvjU4', benefit = 'TCACA_code_007_nzdH5h4Nl0';
const bonus = 'TCACA_code_028_NtpWi0jzXs', reward = 'TCACA_code_029_6wCGEWquYy';
const trial = 'TCACA_code_039_KRcQj7wUat', pro = 'TCACA_code_002_AkiJS3ZHF5';
const addon = 'TCACA_code_009_0XmEQc2xOf', legacy = 'TCACA_code_006_DbXS0lrypC';
function fixture(entries = [[basic, 500], [benefit, 99.91]], paid = false) {
  return {
    summary: { IsPaidUser: paid, Packages: entries.map(([PackageCode, left]) => ({ PackageCode, CycleRemainCapacity: String(left) })) },
    accounts: entries.map(([PackageCode, left], index) => ({ ResourceId: `fixture-${index}`, PackageCode,
      CycleCapacityRemain: Math.floor(left), CycleCapacityRemainPrecise: String(left),
      CycleEndTime: '2026-10-31 23:59:59', DeductionEndTime: expiry }))
  };
}
test('same personal plan accepts zero legacy packs and additional official reward credits', () => {
  const f = fixture([[basic, 500], [benefit, 99.91], [legacy, 0], [bonus, 50], [reward, 25]]);
  const r = quotaReport(f.summary, f.accounts, now);
  assert.equal(r.total, 674.91); assert.equal(r.basic, 500); assert.equal(r.reward, 174.91); assert.equal(r.purchased, 0);
  assert.equal(r.nextRefreshAt, Date.parse('2026-11-01T00:00:00+08:00'));
  assert.deepEqual(r.expires.map(e => e.amount), [99.91, 25], 'plan bonus refresh must not be described as reward expiry');
});
test('trial, personal subscription and purchased credit packs retain their separate balances', () => {
  for (const base of [trial, pro]) {
    const f = fixture([[base, 1500], [benefit, 99.91], [addon, 200.25]], base === pro);
    const r = quotaReport(f.summary, f.accounts, now);
    assert.equal(r.total, 1800.16); assert.equal(r.basic, 1500); assert.equal(r.reward, 99.91); assert.equal(r.purchased, 200.25);
  }
  const f = fixture([[basic, 500], [pro, 1500]], true);
  assert.equal(quotaReport(f.summary, f.accounts, now).nextRefreshAt, null, 'unknown active plan must not use an old free-plan refresh');
  f.summary.SubscriptionPackageCode = pro; f.accounts[1].CycleEndTime = '2026-11-07 23:59:59';
  assert.equal(quotaReport(f.summary, f.accounts, now).nextRefreshAt, Date.parse('2026-11-08T00:00:00+08:00'));
});
test('resource ids deduplicate overlapping pages; conflicting copies and missing details fail closed', () => {
  const f = fixture();
  const r = quotaReport(f.summary, [...f.accounts, { ...f.accounts[1] }], now);
  assert.equal(r.total, 599.91); assert.equal(r.expires.length, 1);
  assert.throws(() => quotaReport(f.summary, [...f.accounts, { ...f.accounts[1], CycleCapacityRemainPrecise: '98.91' }], now), { code: 'INVALID_RESPONSE' });
  assert.throws(() => quotaReport(f.summary, f.accounts.slice(0, 1), now), { code: 'INVALID_RESPONSE' });
  assert.throws(() => quotaReport(fixture([[basic, 500]]).summary, f.accounts, now), { code: 'INVALID_RESPONSE' });
});
test('slice-based credits use current precise slice and reject corrupt or inconsistent amounts', () => {
  const f = fixture([[trial, 300.25]]);
  Object.assign(f.accounts[0], { CapacityType: 4, CycleCapacityRemainPrecise: '2000',
    SlicePeriodUsageDetails: [{ SlicePeriodCapacityRemainPrecise: '300.25' }] });
  assert.equal(quotaReport(f.summary, f.accounts, now).total, 300.25);
  for (const left of ['invalid', '', '-1', 'Infinity', null, '300.24']) {
    f.accounts[0].SlicePeriodUsageDetails[0].SlicePeriodCapacityRemainPrecise = left;
    assert.throws(() => quotaReport(f.summary, f.accounts, now), { code: 'INVALID_RESPONSE' });
  }
});
test('unknown positive units are never reported as credits or mistaken for an unsupported plan', () => {
  for (const code of [legacy, 'new-unknown-package']) {
    const f = fixture([[basic, 500], [code, 10]]);
    assert.throws(() => quotaReport(f.summary, f.accounts, now), { code: 'UNSUPPORTED_QUOTA' });
  }
  assert.match(workBuddyError('UNSUPPORTED_QUOTA').message, /积分格式/);
  assert.match(status.errorMessage('UNSUPPORTED_ACCOUNT'), /登录身份/);
  assert.equal(status.clearsAccount('UNSUPPORTED_QUOTA'), false);
  assert.equal(status.retryDelay('UNSUPPORTED_QUOTA', 1), null);
});
test('official billing timestamps accept milliseconds and explicit dates without a local-time guess', () => {
  const at = Date.parse('2026-11-01T00:00:00+08:00');
  for (const value of [at, String(at), '2026-11-01 00:00:00', '2026-11-01T00:00:00+08:00', '2026-10-31T16:00:00.000Z']) {
    const f = fixture([[trial, 500], [addon, 99.91]]);
    f.accounts[0].CycleEndTime = value; f.accounts[1].DeductionEndTime = value;
    const r = quotaReport(f.summary, f.accounts, now);
    assert.equal(r.nextRefreshAt, at + 1000); assert.equal(r.expires[0].at, at);
  }
  for (const value of ['tomorrow', '2026-11-01T00:00:00', -1, Infinity, '']) {
    const f = fixture([[addon, 99.91]]); f.accounts[0].DeductionEndTime = value;
    assert.throws(() => quotaReport(f.summary, f.accounts, now), { code: 'INVALID_RESPONSE' });
  }
});
test('personal Pro reconciles summary and unified resources with a scope-safe format error and no model request', async t => {
  const f = fixture([[pro, 1500], [addon, 20]], true), calls = [];
  const auth = { ...sessionIdentity({ account: { type: 'pro', uid: 'fixture-user' }, auth: { domain: 'www.workbuddy.cn' } }), token: 'fixture-not-a-real-token' };
  const previous = global.fetch; t.after(() => { global.fetch = previous; });
  global.fetch = async (url, options) => {
    calls.push(url); assert.equal(options.headers['X-Enterprise-Id'], undefined);
    const data = url.endsWith('summary') ? f.summary : { Response: { Data: { Accounts: f.accounts.map(p => ({ ...p, ProductCode: 'p_tcaca', CapacityUnit: 'credits', Status: 0 })), TotalCount: f.accounts.length } } };
    return new Response(JSON.stringify({ code: 0, data }));
  };
  assert.equal((await execute('quota', {}, () => {}, { authReader: () => auth })).report.total, 1520);
  assert.equal(calls.length, 2); assert(calls.every(url => url.includes('/billing/meter/get-user-resource')));
  f.summary.Packages.push({ PackageCode: 'unknown', CycleRemainCapacity: '1' });
  await assert.rejects(execute('quota', {}, () => {}, { authReader: () => auth }), error => error.code === 'UNSUPPORTED_QUOTA' && error.accountKey === auth.accountKey);
});
