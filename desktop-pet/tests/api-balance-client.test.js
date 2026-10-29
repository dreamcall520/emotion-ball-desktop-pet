const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseApiBalanceAccounts } = require('../lib/api-balance-account');
const { createApiBalanceClient, parseBalance } = require('../lib/api-balance-client');
const account = () => parseApiBalanceAccounts({ config: { providerConfigRules: { providerRules: [
  { providerId: 'moonshot-kimi', config: { access: { type: 'api-key', apiKey: 'sk-test-client-only' } } }
] } } })[0];
// Mirrors the official live response: status is at the top level, alongside code/data.
const response = () => ({ code: 0, status: true, scode: '0x0', data: { available_balance: 44.242123, cash_balance: 44.242123, voucher_balance: 0 } });
function transport({ status = 200, headers = {}, body = response(), hang = false, requestError = false, abortResponse = false } = {}) {
  const calls = []; let req, res;
  const request = (url, options, callback) => {
    calls.push({ url, options }); req = new EventEmitter(); req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      if (requestError) { req.emit('error', new Error('secret fixture must not surface')); return; }
      if (hang) return;
      res = new EventEmitter(); Object.assign(res, { statusCode: status, headers, destroy() { this.destroyed = true; } }); callback(res);
      if (res.destroyed) return;
      if (abortResponse) { res.emit('aborted'); return; }
      res.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); res.emit('end');
    }); return req;
  };
  return { request, calls, get req() { return req; } };
}
test('one official read-only GET returns precise CNY amounts, including debt', async () => {
  const fake = transport(); const result = await createApiBalanceClient({ request: fake.request })(account());
  assert.deepEqual(result, { available: 44.242123, cash: 44.242123, voucher: 0, currency: 'CNY' });
  assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].url, 'https://api.moonshot.cn/v1/users/me/balance');
  assert.equal(fake.calls[0].options.method, 'GET'); assert.equal(fake.calls[0].options.headers.Authorization, 'Bearer sk-test-client-only');
  const debt = response(); debt.data.cash_balance = debt.data.available_balance = -1.25;
  assert.equal(parseBalance(debt).available, -1.25);
});
test('redirects/auth/rate limit/service errors remain safe structured failures with no follow-up request', async () => {
  for (const [status, code] of [[301, 'UNSUPPORTED_ENDPOINT'], [302, 'UNSUPPORTED_ENDPOINT'], [401, 'UNAUTHENTICATED'],
    [403, 'UNAUTHENTICATED'], [429, 'RATE_LIMITED'], [500, 'SERVICE_UNAVAILABLE'], [400, 'INVALID_RESPONSE']]) {
    const fake = transport({ status, headers: { location: 'https://attacker.test', 'retry-after': '60' } });
    await assert.rejects(createApiBalanceClient({ request: fake.request })(account()), e => e.code === code && !String(e).includes('sk-test'));
    assert.equal(fake.calls.length, 1);
  }
});
test('bad or oversized response never becomes a zero balance', async () => {
  for (const body of ['not json', { ...response(), code: 1 }, { ...response(), status: false },
    { ...response(), data: { ...response().data, available_balance: null } }, { ...response(), data: { ...response().data, cash_balance: '44' } },
    { ...response(), data: { ...response().data, voucher_balance: -1 } }, ' '.repeat(128 * 1024 + 1)]) {
    const fake = transport({ body });
    await assert.rejects(createApiBalanceClient({ request: fake.request })(account()), { code: 'INVALID_RESPONSE' });
  }
});
test('unsupported or forged metadata has no credential and cannot request network', async () => {
  const fake = transport(), fetch = createApiBalanceClient({ request: fake.request });
  await assert.rejects(fetch({ provider: 'unknown', supported: false }), { code: 'UNSUPPORTED_PROVIDER' });
  await assert.rejects(fetch(structuredClone(account())), { code: 'MISSING_API_KEY' });
  assert.equal(fake.calls.length, 0);
});
test('abort before start, abort in flight, timeout and transport failure are bounded and sanitized', async () => {
  const before = new AbortController(); before.abort(); const fake = transport({ hang: true });
  const fetch = createApiBalanceClient({ request: fake.request });
  await assert.rejects(fetch(account(), { signal: before.signal }), { code: 'CANCELLED' }); assert.equal(fake.calls.length, 0);
  const controller = new AbortController(), pending = fetch(account(), { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(fake.req.destroyed, true);
  let timer, cancelled = false;
  const timeout = createApiBalanceClient({ request: fake.request, schedule: fn => { timer = fn; return 1; }, cancel: () => { cancelled = true; } })(account());
  timer(); await assert.rejects(timeout, { code: 'TIMEOUT' }); assert.equal(cancelled, true);
  for (const options of [{ requestError: true }, { abortResponse: true }]) {
    const f = transport(options); await assert.rejects(createApiBalanceClient({ request: f.request })(account()), e => e.code === 'CONNECTION_FAILED' && !String(e).includes('secret fixture'));
  }
});

test('official top-level status is required; nested status cannot counterfeit a successful response', () => {
  assert.equal(parseBalance(response()).available, 44.242123);
  for (const status of [undefined, null, false, 'true', 1]) {
    const body = { ...response(), status, data: { ...response().data, status: true } };
    assert.throws(() => parseBalance(body), { code: 'INVALID_RESPONSE' });
  }
  for (const data of [undefined, null, {}, [], { available_balance: 0, cash_balance: 0 }]) {
    assert.throws(() => parseBalance({ code: 0, status: true, data }), { code: 'INVALID_RESPONSE' });
  }
  assert.deepEqual(parseBalance({ code: 0, status: true, data: { available_balance: 0, cash_balance: 0, voucher_balance: 0 } }),
    { available: 0, cash: 0, voucher: 0, currency: 'CNY' });
});
