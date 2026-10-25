const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { readWorkBuddyUsage, aggregateUsage, usageRange, createCookieJar } = require('../lib/workbuddy-usage-reader');
const now = Date.parse('2026-10-25T15:00:00+08:00'), accountKey = 'a'.repeat(64);
const auth = { accountKey, refreshToken: 'fixture-refresh-not-real-value' };
function response(data, status = 200, extra = {}) {
  return { ok: status >= 200 && status < 300, status, body: Readable.from([Buffer.from(JSON.stringify(data))]),
    headers: { get: name => name === 'location' ? extra.location || null : null, getSetCookie: () => extra.cookies || [] } };
}
function transport(rows, mutate) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input); calls.push({ path: url.pathname, options });
    if (url.pathname === '/v2/plugin/device/auth/code') return response({ code: 0, data: { deviceCode: 'fixture-ephemeral-code' } });
    if (url.pathname === '/console/client-login') return response({}, 302, { location: '/profile/plans-usage', cookies: ['website=fixture-cookie; Domain=.workbuddy.cn; Path=/; Secure'] });
    if (url.pathname === '/profile/plans-usage') return response({});
    assert.equal(url.pathname, '/billing/meter/get-user-request-usage');
    const body = JSON.parse(options.body), start = (body.pageNum - 1) * body.pageSize;
    const page = { total: rows.length, data: rows.slice(start, start + body.pageSize) }; mutate?.(page, body);
    return response({ code: 0, data: page });
  };
  return { calls, fetchImpl };
}
test('official personal usage uses bounded v1 pagination and produces exact continuous seven-day consumption', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ requestId: 'request-' + index, requestTime: index === 100 ? '2026-10-24 23:59:59' : '2026-10-25 00:00:00',
    credit: index === 0 ? 0.74999999 : index === 1 ? 0.35 : index === 100 ? 0.09 : 0, input: 'DO_NOT_RETURN_PROMPT', inputTrunc: 'DO_NOT_RETURN_PROMPT' }));
  const f = transport(rows);
  const result = await readWorkBuddyUsage({ auth, authHeaders: { Authorization: 'fixture-access' }, fetchImpl: f.fetchImpl, now: () => now });
  assert.equal(result.accountKey, accountKey); const u = result.usage;
  assert.deepEqual(usageRange(now), { startDate: '2026-10-19', endDate: '2026-10-25' });
  assert.equal(u.days.length, 7); assert.equal(u.todayCredits, 1.09999999); assert.equal(u.totalCredits, 1.18999999);
  assert.equal(u.days[0].credits, 0); assert.equal(u.requestCount, 101); assert.equal(u.complete, true); assert.equal(u.delayHours, 3);
  assert.deepEqual(u.todayRecords, [{ at: Date.parse('2026-10-25T00:00:00+08:00'), credits: 1.09999999 }]);
  const pages = f.calls.filter(value => value.path.endsWith('get-user-request-usage'));
  assert.deepEqual(pages.map(value => JSON.parse(value.options.body).pageNum), [1, 2]);
  assert(pages.every(value => !JSON.parse(value.options.body).version && !value.options.headers.Authorization));
  assert(!JSON.stringify(result).includes('PROMPT')); assert(!JSON.stringify(result).includes('fixture-'));
});
test('aggregation never accesses prompt getters and rejects negative, truncated, duplicate or invalid-date data', () => {
  const row = { requestId: 'id', requestTime: '2026-10-25 10:00:00', credit: 0.09 };
  for (const key of ['input', 'inputTrunc']) Object.defineProperty(row, key, { get() { throw Error('prompt accessed'); } });
  const range = usageRange(now); assert.equal(aggregateUsage([[row]], range, now).totalCredits, 0.09);
  for (const rows of [[{ ...row, credit: -1 }], [{ ...row, requestTime: '2026-02-31 10:00:00' }], [row, row]]) {
    assert.throws(() => aggregateUsage([rows], range, now), { code: 'INVALID_USAGE_RESPONSE' });
  }
});
test('zero is official only after completed pagination; incomplete or changing totals fail rather than fabricate zero', async () => {
  const empty = await readWorkBuddyUsage({ auth, fetchImpl: transport([]).fetchImpl, now: () => now });
  assert.equal(empty.usage.totalCredits, 0); assert.equal(empty.usage.days.length, 7); assert.equal(empty.usage.requestCount, 0);
  assert.deepEqual(empty.usage.todayRecords, []);
  const rows = [{ requestTime: '2026-10-25 10:00:00', credit: 1 }];
  await assert.rejects(readWorkBuddyUsage({ auth, fetchImpl: transport(rows, page => { page.total = 2; }).fetchImpl, now: () => now }), { code: 'INVALID_USAGE_RESPONSE' });
});
test('official login redirects reject third parties before any code or cookie can reach them', async () => {
  let calls = 0;
  await assert.rejects(readWorkBuddyUsage({ auth, now: () => now, fetchImpl: async () => {
    calls++; return calls === 1 ? response({ code: 0, data: { deviceCode: 'fixture-code' } }) : response({}, 302, { location: 'https://untrusted.example/' });
  } }), { code: 'INVALID_USAGE_RESPONSE' });
  assert.equal(calls, 2);
});
test('cookie jar respects domains and paths and ignores overbroad domains', () => {
  const jar = createCookieJar();
  jar.take(response({}, 200, { cookies: ['a=secret; Domain=.workbuddy.cn; Path=/billing', 'b=bad; Domain=.com; Path=/'] }), new URL('https://www.workbuddy.cn/'));
  assert.equal(jar.header(new URL('https://www.workbuddy.cn/billing/meter/test')), 'a=secret');
  assert.equal(jar.header(new URL('https://www.workbuddy.cn/billing-other')), '');
  assert.equal(jar.header(new URL('https://www.codebuddy.cn/billing/test')), '');
});
test('today records preserve real Shanghai event times, merge equal timestamps and match the daily total', () => {
  const range = usageRange(now), row = (time, credit, requestId) => ({ requestTime: time, credit, requestId });
  const rows = [row('2026-10-25 14:00:00', 0.74999999, 'r1'), row('2026-10-24 23:59:59', 5, 'r2'),
    row('2026-10-25 00:00:00', 0, 'r3'), row('2026-10-25 08:30:00', 0.09, 'r4'), row('2026-10-25 14:00:00', 0.35, 'r5')];
  for (const row of rows) for (const key of ['input', 'inputTrunc']) Object.defineProperty(row, key, { get() { throw Error('prompt accessed'); } });
  const usage = aggregateUsage([rows], range, now);
  assert.deepEqual(usage.todayRecords, [
    { at: Date.parse('2026-10-25T00:00:00+08:00'), credits: 0 },
    { at: Date.parse('2026-10-25T08:30:00+08:00'), credits: 0.09 },
    { at: Date.parse('2026-10-25T14:00:00+08:00'), credits: 1.09999999 }
  ]);
  assert.equal(usage.todayRecords.reduce((sum, value) => sum + Math.round(value.credits * 1e8), 0), Math.round(usage.todayCredits * 1e8));
  assert.equal(usage.totalCredits, 6.18999999);
  assert(usage.todayRecords.every(value => Object.keys(value).sort().join(',') === 'at,credits' && value.at <= usage.updatedAt));
  assert.throws(() => aggregateUsage([[row('2026-10-25 15:00:01', 1)]], range, now), { code: 'INVALID_USAGE_RESPONSE' });
});
