'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyWebQuota } = require('../lib/workbuddy-web-quota');
const endpoint = 'https://www.workbuddy.cn/billing/meter/get-user-resource-summary';
const credit = (fields = {}) => ({ CapacityUnit: 'credits', CycleTotalCapacity: '500', CycleRemainCapacity: '450',
  CycleFrozenCapacity: '2.5', SubscriptionPackageName: '体验版', ...fields });
const payload = packages => ({ code: 0, data: { Packages: packages || [credit()], UIN: 'SECRET_ACCOUNT', AccountId: 'SECRET_ID' } });
const jsonResponse = (raw, options = {}) => new Response(JSON.stringify(raw), { status: 200, ...options });
function harness({ fetch, getUserAgent = () => 'SyntheticSession/123.0', ...options } = {}) {
  const calls = [];
  const session = { getUserAgent, fetch: fetch || (async (...args) => { calls.push(args); return jsonResponse(payload()); }) };
  return { calls, reader: createWorkBuddyWebQuota({ session, now: () => 1000, ...options }) };
}

test('只向固定HTTPS汇总端点POST并使用自有Session cookie和对应UA，不添加凭据', async () => {
  const { reader, calls } = harness();
  const result = await reader.readSummary();
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(url, endpoint);
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{}');
  assert.equal(request.credentials, 'include');
  assert.equal(request.redirect, 'manual');
  assert.equal(request.headers['User-Agent'], 'SyntheticSession/123.0');
  assert.deepEqual(Object.keys(request.headers).sort(), ['Accept', 'Content-Type', 'User-Agent']);
  assert.equal(request.signal.aborted, true);
  assert.deepEqual(result, {
    scope: 'website-summary', credits: { total: 500, remaining: 450, used: 50, reserved: 2.5 },
    planNames: ['体验版'], updatedAt: 1000,
    coverage: { packages: 'credits-only', basicRewardPurchased: 'not-separated', cycleReset: 'not-queried', enterpriseLimit: 'not-verified' }
  });
  assert.ok(!JSON.stringify(result).includes('SECRET_'));
});

test('仅汇总credits包，过滤其他单位且不冒充basic/reward/enterprise分类', async () => {
  const packages = [credit(), credit({ CycleTotalCapacity: 20.25, CycleRemainCapacity: '30', CycleFrozenCapacity: undefined }),
    { CapacityUnit: 'tokens', CycleTotalCapacity: 'not-credits', UIN: 'hidden' }];
  const { reader } = harness({ fetch: async () => jsonResponse(payload(packages)) });
  const result = await reader.readSummary();
  assert.deepEqual(result.credits, { total: 520.25, remaining: 480, used: 40.25, reserved: 2.5 });
  assert.deepEqual(result.planNames, ['体验版']);
  assert.equal(Object.hasOwn(result, 'basic'), false);
  assert.equal(Object.hasOwn(result, 'accountKey'), false);
});

test('允许剩余超过周期总额，保留真实数量而将used置0', async () => {
  const { reader } = harness({ fetch: async () => jsonResponse(payload([credit({ CycleTotalCapacity: '5', CycleRemainCapacity: '7' })])) });
  assert.deepEqual((await reader.readSummary()).credits, { total: 5, remaining: 7, used: 0, reserved: 2.5 });
});

test('明确零额度可以返回；没有credits数据不能伪造零', async () => {
  const zero = harness({ fetch: async () => jsonResponse(payload([credit({ CycleTotalCapacity: '0', CycleRemainCapacity: '0', CycleFrozenCapacity: '0' })])) });
  assert.equal((await zero.reader.readSummary()).credits.total, 0);
  for (const packages of [[], [{ CapacityUnit: 'tokens' }]]) {
    const { reader } = harness({ fetch: async () => jsonResponse(payload(packages)) });
    await assert.rejects(reader.readSummary(), { code: 'NO_CREDIT_DATA' });
  }
});

test('credit数值不接受空值/负数/NaN/无穷/指数文本/溢出，不静默丢包', async () => {
  for (const value of ['', ' ', '-1', -1, null, true, 'NaN', 'Infinity', '1e3', '9'.repeat(400)]) {
    for (const key of ['CycleTotalCapacity', 'CycleRemainCapacity', 'CycleFrozenCapacity']) {
      const { reader } = harness({ fetch: async () => jsonResponse(payload([credit({ [key]: value })])) });
      await assert.rejects(reader.readSummary(), { code: 'INVALID_RESPONSE' });
    }
  }
  const { reader } = harness({ fetch: async () => jsonResponse(payload([credit({ CycleTotalCapacity: Number.MAX_VALUE }), credit({ CycleTotalCapacity: Number.MAX_VALUE })])) });
  await assert.rejects(reader.readSummary(), { code: 'INVALID_RESPONSE' });
});

test('HTTP401/403和明确认证API错误要求重新登录，不尝试其他cookie源', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const { reader } = harness({ fetch: async () => { calls++; return new Response('PRIVATE_LOGIN_BODY', { status }); } });
    await assert.rejects(reader.readSummary(), error => error.code === 'LOGIN_REQUIRED' && !error.message.includes('PRIVATE'));
    assert.equal(calls, 1);
    const api = harness({ fetch: async () => jsonResponse({ code: status, message: 'SECRET_MESSAGE' }) });
    await assert.rejects(api.reader.readSummary(), { code: 'LOGIN_REQUIRED' });
  }
});

test('429及服务失败明确报错，无自动重试', async () => {
  for (const [status, code] of [[429, 'RATE_LIMITED'], [500, 'SERVICE_UNAVAILABLE'], [503, 'SERVICE_UNAVAILABLE'], [400, 'API_ERROR']]) {
    let calls = 0;
    const { reader } = harness({ fetch: async () => { calls++; return new Response('SECRET', { status }); } });
    await assert.rejects(reader.readSummary(), { code }); assert.equal(calls, 1);
  }
});

test('跳转、已被跟随的响应及其他URL均拒绝，不转发网站会话', async () => {
  for (const value of [new Response('', { status: 302, headers: { Location: 'https://elsewhere.invalid/login' } }),
    { status: 200, redirected: true }, { status: 200, type: 'opaqueredirect' }, { status: 200, url: 'https://elsewhere.invalid/' }]) {
    const { reader } = harness({ fetch: async () => value });
    await assert.rejects(reader.readSummary(), { code: 'REDIRECT_REJECTED' });
  }
});

test('要求code数值0及Packages数组，HTML与坏UTF8不泄露原响应', async () => {
  for (const raw of [{ code: 1, message: 'SECRET' }, { code: '0', data: { Packages: [] } }, { code: 0, data: {} }]) {
    const { reader } = harness({ fetch: async () => jsonResponse(raw) });
    await assert.rejects(reader.readSummary(), error => ['API_ERROR', 'INVALID_RESPONSE'].includes(error.code) && !error.message.includes('SECRET'));
  }
  for (const body of ['<html>SECRET_LOGIN</html>', new Uint8Array([0xff])]) {
    const { reader } = harness({ fetch: async () => new Response(body) });
    await assert.rejects(reader.readSummary(), { code: 'INVALID_RESPONSE' });
  }
});

test('按Content-Length或流实际累计大小拒绝超大响应', async () => {
  const declared = harness({ fetch: async () => new Response('x', { headers: { 'Content-Length': '1000' } }), maxResponseBytes: 32 });
  await assert.rejects(declared.reader.readSummary(), { code: 'RESPONSE_TOO_LARGE' });
  let cancelled = false;
  const streamed = harness({ maxResponseBytes: 32, fetch: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(20)); c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; }
  })) });
  await assert.rejects(streamed.reader.readSummary(), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('请求前已取消不发请求；请求阶段取消会中止fetch', async () => {
  const before = new AbortController(); before.abort();
  const a = harness(); await assert.rejects(a.reader.readSummary({ signal: before.signal }), { code: 'CANCELLED' });
  assert.equal(a.calls.length, 0);
  let requestSignal;
  const b = harness({ fetch: async (url, options) => { requestSignal = options.signal; return new Promise(() => {}); } });
  const controller = new AbortController(), flight = b.reader.readSummary({ signal: controller.signal });
  controller.abort(); await assert.rejects(flight, { code: 'CANCELLED' });
  assert.equal(requestSignal.aborted, true);
});

test('超时覆盖fetch阶段，即使fetch忽略signal也按时返回', async () => {
  let requestSignal;
  const { reader } = harness({ timeoutMs: 15, fetch: async (url, options) => { requestSignal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(reader.readSummary(), { code: 'TIMEOUT' });
  assert.equal(requestSignal.aborted, true);
});

test('取消覆盖response body读取且取消stream，不错误发布部分JSON', async () => {
  let cancelled = false, startBody;
  const bodyStarted = new Promise(resolve => { startBody = resolve; });
  const { reader } = harness({ fetch: async () => new Response(new ReadableStream({
    pull() { startBody(); return new Promise(() => {}); }, cancel() { cancelled = true; }
  })) });
  const controller = new AbortController(), flight = reader.readSummary({ signal: controller.signal });
  await bodyStarted; controller.abort();
  await assert.rejects(flight, { code: 'CANCELLED' });
  assert.equal(cancelled, true);
});

test('超时覆盖response body读取，不只是response header', async () => {
  let cancelled = false;
  const { reader } = harness({ timeoutMs: 15, fetch: async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() { cancelled = true; }
  })) });
  await assert.rejects(reader.readSummary(), { code: 'TIMEOUT' });
  assert.equal(cancelled, true);
});

test('网站会话UA不可用明确失败；网络错误不透传cookie/token等内容', async () => {
  const unavailable = harness({ getUserAgent: () => '' });
  await assert.rejects(unavailable.reader.readSummary(), { code: 'SESSION_UNAVAILABLE' });
  assert.equal(unavailable.calls.length, 0);
  const unicodeUA = harness({ getUserAgent: () => 'Mozilla/5.0 球球/0.4.9 Chrome/142.0.0.0' });
  await assert.rejects(unicodeUA.reader.readSummary(), { code: 'SESSION_UNAVAILABLE' });
  assert.equal(unicodeUA.calls.length, 0, '非法header在发网之前明确失败');
  const { reader } = harness({ fetch: async () => { throw new Error('Cookie=SECRET; access_token=SECRET'); } });
  await assert.rejects(reader.readSummary(), error => error.code === 'CONNECTION_FAILED' && !error.message.includes('SECRET'));
});

test('stream取消自身卡住不能吞掉超大响应错误或阻止调用返回', async () => {
  const { reader } = harness({ timeoutMs: 30, maxResponseBytes: 4, fetch: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(8)); }, cancel() { return new Promise(() => {}); }
  })) });
  await assert.rejects(reader.readSummary(), { code: 'RESPONSE_TOO_LARGE' });
});
