'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readCodexAccountUsage, normalizeCodexAccountUsage } = require('../lib/codex-account-usage');
const SECRET = 'synthetic-secret-token-never-return';
const ACCOUNT = 'synthetic-private-account-id';
const AT = 1793420000000;
const RESET = 1794000000;
const auth = { auth_mode: 'chatgpt', tokens: { access_token: SECRET, account_id: ACCOUNT, refresh_token: 'synthetic-refresh-not-used' } };
const weekly = { rate_limit: { secondary_window: { used_percent: 45, limit_window_seconds: 604800, reset_at: RESET } } };
async function fixture(t, content = JSON.stringify(auth)) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-codex-usage-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'auth.json'), content);
  const calls = [], requests = [];
  const options = { directoryAccess: { withAccess: async (provider, operation) => {
    calls.push(['start', provider]);
    try { return await operation(directory); } finally { calls.push(['stop', provider]); }
  } }, now: () => AT, fetch: async (url, config) => { requests.push({ url, config }); return Response.json(weekly); } };
  return { directory, calls, requests, options };
}
function noSecrets(value) {
  assert.equal(JSON.stringify(value).includes(SECRET), false);
  assert.equal(JSON.stringify(value).includes(ACCOUNT), false);
  assert.equal(JSON.stringify(value).includes('synthetic-refresh-not-used'), false);
}

test('仅授权根auth.json和固定GET：安全输出单个真实周窗口，不补主窗口', async t => {
  const f = await fixture(t);
  const result = await readCodexAccountUsage(f.options);
  assert.deepEqual(result, { source: 'web-account-quota', state: 'ready', updatedAt: AT,
    windows: [{ id: 'codex:secondary', usedPercent: 45, windowMinutes: 10080, resetsAt: RESET * 1000 }] });
  assert.deepEqual(f.calls, [['start', 'codex'], ['stop', 'codex']]);
  const [{ url, config }] = f.requests;
  assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(config.method, 'GET'); assert.equal(config.redirect, 'manual'); assert.equal(config.cache, 'no-store');
  assert.equal(config.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(config.headers['ChatGPT-Account-Id'], ACCOUNT);
  assert.equal(Object.hasOwn(config, 'body'), false);
  noSecrets(result);
});

test('忽略additional model pools；缺失或无效数值保持未知，真实0仍保留', () => {
  const result = normalizeCodexAccountUsage({
    rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: RESET },
      secondary_window: { used_percent: '0', limit_window_seconds: null, reset_after_seconds: 60 } },
    additional_rate_limits: [{ rate_limit: { primary_window: { used_percent: 95, limit_window_seconds: 300, reset_at: RESET } } }],
    access_token: SECRET, account_id: ACCOUNT
  }, AT);
  assert.deepEqual(result.windows, [
    { id: 'codex:primary', usedPercent: 0, windowMinutes: 300, resetsAt: RESET * 1000 },
    { id: 'codex:secondary', usedPercent: null, windowMinutes: null, resetsAt: null }
  ]);
  assert.equal(result.state, 'partial'); noSecrets(result);
  assert.deepEqual(normalizeCodexAccountUsage({ additional_rate_limits: [{ used_percent: 0 }] }, AT).windows, []);
  assert.equal(normalizeCodexAccountUsage({ rate_limit: { primary_window: null } }, AT).state, 'unavailable');
  assert.throws(() => normalizeCodexAccountUsage(null, AT), { code: 'INVALID_RESPONSE' });
});

test('API key、缺token、缺account id和非法header内容均不猜测、不请求', async t => {
  const cases = [
    [{ auth_mode: 'apikey', OPENAI_API_KEY: SECRET }, 'UNSUPPORTED_AUTH'],
    [{ OPENAI_API_KEY: SECRET }, 'UNSUPPORTED_AUTH'],
    [{ tokens: {} }, 'LOGIN_REQUIRED'],
    [{ tokens: { access_token: SECRET } }, 'INVALID_AUTH'],
    [{ tokens: { access_token: SECRET + '\r\nInjected: yes', account_id: ACCOUNT } }, 'INVALID_AUTH'],
    [{ tokens: { access_token: SECRET, account_id: ACCOUNT + '\n' } }, 'INVALID_AUTH']
  ];
  for (const [content, code] of cases) await t.test(code + JSON.stringify(content).length, async t => {
    const f = await fixture(t, JSON.stringify(content));
    await assert.rejects(readCodexAccountUsage(f.options), error => { noSecrets({ message: error.message, code: error.code }); return error.code === code; });
    assert.equal(f.requests.length, 0);
  });
});

test('拒绝auth.json符号链接、目录与超过1MiB文件', async t => {
  const f = await fixture(t);
  const filename = path.join(f.directory, 'auth.json');
  await fs.rename(filename, path.join(f.directory, 'secret-target.json'));
  await fs.symlink('secret-target.json', filename);
  await assert.rejects(readCodexAccountUsage(f.options), { code: 'UNSAFE_AUTH_FILE' });
  await fs.unlink(filename); await fs.mkdir(filename);
  await assert.rejects(readCodexAccountUsage(f.options), { code: 'UNSAFE_AUTH_FILE' });
  await fs.rmdir(filename); await fs.writeFile(filename, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(readCodexAccountUsage(f.options), { code: 'AUTH_TOO_LARGE' });
  assert.equal(f.requests.length, 0);
});

test('打开时inode改变和读取过程中增长越界均拒绝且关闭句柄', async t => {
  const f = await fixture(t);
  let closed = 0;
  const before = { isFile: () => true, isSymbolicLink: () => false, size: 10, dev: 1, ino: 1 };
  const changed = { ...before, ino: 2 };
  const io = { lstat: async () => before, open: async () => ({ stat: async () => changed,
    close: async () => { closed++; } }) };
  await assert.rejects(readCodexAccountUsage({ ...f.options, io }), { code: 'UNSAFE_AUTH_FILE' });
  assert.equal(closed, 1);
  io.open = async () => ({ stat: async () => before,
    read: async (buffer, offset, length) => { buffer.fill(65, offset, offset + length); return { bytesRead: length }; },
    close: async () => { closed++; } });
  await assert.rejects(readCodexAccountUsage({ ...f.options, io }), { code: 'AUTH_TOO_LARGE' });
  assert.equal(closed, 2); assert.equal(f.requests.length, 0);
});

test('损坏auth、授权失效和fetch异常只返回固定错误，不泄漏secret', async t => {
  const f = await fixture(t, '{"secret":"' + SECRET + '"');
  await assert.rejects(readCodexAccountUsage(f.options), { code: 'INVALID_AUTH' });
  await fs.writeFile(path.join(f.directory, 'auth.json'), JSON.stringify(auth));
  await assert.rejects(readCodexAccountUsage({ ...f.options, directoryAccess: { withAccess: async () => { throw Object.assign(new Error(SECRET), { code: 'DIRECTORY_ACCESS_REQUIRED' }); } } }), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async () => { throw new Error(SECRET); } }), error => {
    assert.equal(error.message, 'CONNECTION_FAILED'); noSecrets(error); return true;
  });
});

test('401/403不refresh、429不自动重试、其他HTTP错误不解析响应正文', async t => {
  for (const [status, code] of [[401, 'LOGIN_REQUIRED'], [403, 'LOGIN_REQUIRED'], [429, 'RATE_LIMITED'], [500, 'HTTP_ERROR']]) await t.test(String(status), async t => {
    const f = await fixture(t); let requests = 0;
    await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async () => { requests++; return new Response(SECRET, { status }); } }), { code });
    assert.equal(requests, 1);
  });
});

test('重定向不跟随，不向第二站转发任何凭据，伪装的最终URL也拒绝', async t => {
  const f = await fixture(t); const requests = [];
  await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async (url, config) => {
    requests.push({ url, config }); return new Response(SECRET, { status: 302, headers: { Location: 'https://fixture.invalid/collect' } });
  } }), { code: 'REDIRECT_REJECTED' });
  assert.equal(requests.length, 1); assert.equal(requests[0].config.redirect, 'manual');
  const response = Response.json(weekly); Object.defineProperty(response, 'url', { value: 'https://fixture.invalid/collect' });
  await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async () => response }), { code: 'REDIRECT_REJECTED' });
});

test('响应content-length与流式累计上限都执行，不以response.json无限读取', async t => {
  const f = await fixture(t);
  await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async () => new Response('{}', { headers: { 'Content-Length': String(1024 * 1024 + 1) } }) }), { code: 'RESPONSE_TOO_LARGE' });
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  await assert.rejects(readCodexAccountUsage({ ...f.options, fetch: async () => new Response(body) }), { code: 'RESPONSE_TOO_LARGE' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});

test('截止时间覆盖fetch和卡住的响应body，signal被传递并取消读取', async t => {
  const f = await fixture(t);
  let signal;
  await assert.rejects(readCodexAccountUsage({ ...f.options, timeoutMs: 20, fetch: async (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  } }), { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
  let cancelled = false;
  const body = new ReadableStream({ start() {}, cancel() { cancelled = true; } });
  await assert.rejects(readCodexAccountUsage({ ...f.options, timeoutMs: 20, fetch: async () => new Response(body) }), { code: 'TIMEOUT' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});

test('调用方取消覆盖读取响应阶段，取消reason中的secret不向外传播', async t => {
  const f = await fixture(t), abort = new AbortController();
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  const body = new ReadableStream({ start() {}, pull() { started(); } });
  const operation = readCodexAccountUsage({ ...f.options, signal: abort.signal, fetch: async () => new Response(body) });
  await reading; abort.abort(new Error(SECRET));
  await assert.rejects(operation, error => error.code === 'CANCELLED' && error.message === 'CANCELLED');
  const pre = new AbortController(); pre.abort(new Error(SECRET));
  const initialCalls = f.calls.length;
  await assert.rejects(readCodexAccountUsage({ ...f.options, signal: pre.signal }), { code: 'CANCELLED' });
  assert.equal(f.calls.length, initialCalls);
});

test('超时后迟到的授权读不发网络请求，最终关闭文件作用域', async t => {
  const f = await fixture(t); let release, callbackDone = false;
  const directoryAccess = { withAccess: async (_provider, operation) => {
    await new Promise(resolve => { release = resolve; });
    try { return await operation(f.directory); } finally { callbackDone = true; }
  } };
  await assert.rejects(readCodexAccountUsage({ ...f.options, directoryAccess, timeoutMs: 10 }), { code: 'TIMEOUT' });
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(callbackDone, true); assert.equal(f.requests.length, 0);
});

test('history identity is stable across token rotation and changes across accounts without leaking credentials', async t => {
  const f = await fixture(t);
  const read = () => readCodexAccountUsage({ ...f.options, includeAccountKey: true });
  const first = await read();
  assert.match(first.accountKey, /^[a-f0-9]{64}$/);
  await fs.writeFile(path.join(f.directory, 'auth.json'), JSON.stringify({ ...auth, tokens: { ...auth.tokens, access_token: 'different-synthetic-token' } }));
  assert.equal((await read()).accountKey, first.accountKey);
  await fs.writeFile(path.join(f.directory, 'auth.json'), JSON.stringify({ ...auth, tokens: { ...auth.tokens, account_id: 'another-synthetic-account' } }));
  const changed = await read();
  assert.notEqual(changed.accountKey, first.accountKey);
  noSecrets(first); noSecrets(changed);
  assert.equal(JSON.stringify(changed).includes('another-synthetic-account'), false);
});
