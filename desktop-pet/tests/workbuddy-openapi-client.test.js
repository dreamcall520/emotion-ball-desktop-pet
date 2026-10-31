'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyOpenApiClient } = require('../lib/workbuddy-openapi-client');
const TOKEN = 'synthetic-workbuddy-access-secret';
const PRIVATE = 'synthetic-private-account-subject';
const NOW = 1800000000000, EXPIRES = NOW + 60000;
const SCOPES = ['user.localassistant.readable', 'user.localassistant.invokable', 'user.task.readable', 'user.task.invokable'];
function response(data, status = 200, headers) { return Response.json(data, { status, headers }); }
function ok(data) { return response({ code: 0, data }); }
function harness({ reply = (_url, config) => config.method === 'POST' ? ok({ message_id: 'fixture-message' }) : ok({ online: true }),
  credentials, timeoutMs = 1000, tokenPort } = {}) {
  const requests = [], authorizations = [];
  const client = createWorkBuddyOpenApiClient({ now: () => NOW, timeoutMs,
    tokenPort: tokenPort || { getAccessToken: async options => { authorizations.push(options);
      return credentials || { accessToken: TOKEN, scopes: [...SCOPES, 'user.phone.sensitive', PRIVATE], expiresAt: EXPIRES, accountId: PRIVATE, refreshToken: PRIVATE }; } },
    fetch: async (url, config) => { requests.push({ url, config }); return reply(url, config); } });
  return { client, requests, authorizations };
}
function noSecrets(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(TOKEN), false); assert.equal(serialized.includes(PRIVATE), false);
}

test('未配置应用授权明确阻塞，不触网站Session、桌面凭据或任何HTTP', async () => {
  let fetched = false;
  const client = createWorkBuddyOpenApiClient({ fetch: async () => { fetched = true; } });
  await assert.rejects(client.getAssistantStatus(), { code: 'APP_NOT_CONFIGURED' });
  assert.equal(fetched, false);
  assert.deepEqual(client.getCapabilities(), { source: 'workbuddy-openapi', configured: false, verified: false,
    externalApplicationAuthorization: 'required', requiredScopes: SCOPES,
    localAssistantConversationIsolated: false, modelSelectionSupported: false,
    automaticPermissionResponses: false, cloudTasksAreLocalTasks: false });
});

test('状态只查固定官方URL，Header鉴权且仅投影safe scopes/expiresAt', async () => {
  const { client, requests, authorizations } = harness();
  const result = await client.getAssistantStatus();
  assert.deepEqual(result, { source: 'workbuddy-openapi', scope: 'pc-local-assistant', online: true,
    authorization: { scopes: SCOPES, expiresAt: EXPIRES } });
  assert.deepEqual(authorizations[0].requiredScopes, ['user.localassistant.readable']);
  assert.equal(requests[0].url, 'https://www.workbuddy.cn/openapi/v2/localassistant');
  assert.equal(requests[0].config.method, 'GET'); assert.equal(requests[0].config.redirect, 'manual');
  assert.equal(requests[0].config.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(requests[0].url.includes(TOKEN), false); noSecrets(result);
});

test('缺权限、过期token和恶意header内容均在HTTP前拒绝，不用其他登录替代', async t => {
  for (const [credentials, code] of [
    [{ accessToken: TOKEN, scopes: ['user.task.readable'], expiresAt: EXPIRES }, 'PERMISSION_REQUIRED'],
    [{ accessToken: TOKEN, scopes: SCOPES, expiresAt: NOW }, 'AUTHORIZATION_REQUIRED'],
    [{ accessToken: TOKEN + '\r\nInjected: true', scopes: SCOPES }, 'AUTHORIZATION_REQUIRED'],
    [{ scopes: SCOPES, refreshToken: TOKEN }, 'AUTHORIZATION_REQUIRED']
  ]) await t.test(code + JSON.stringify(credentials).length, async () => {
    const { client, requests } = harness({ credentials });
    await assert.rejects(client.getAssistantStatus(), { code }); assert.equal(requests.length, 0);
  });
  const { client } = harness({ tokenPort: { getAccessToken: async () => { throw Object.assign(new Error(TOKEN), { code: 'SESSION_EXPIRED' }); } } });
  await assert.rejects(client.getAssistantStatus(), error => { noSecrets(error); return error.code === 'AUTHORIZATION_REQUIRED'; });
});

test('云任务按page/size分页，不返回ACP link/token/prompt或伪造本地任务', async () => {
  const { client, requests } = harness({ reply: () => response({ total: 5, pagination: { page: 2, size: 2, total: 5 }, tasks: [
    { task_id: 'cloud-task-3', name: 'third ' + TOKEN, status: 'working', created_at: '2026-10-31T00:00:00Z', updated_at: '2026-10-31T00:01:00Z', link: 'https://fixture.invalid/' + TOKEN, token: TOKEN, prompt: PRIVATE },
    { task_id: 'cloud-task-4', name: 'fourth', status: 'new-unknown-status', created_at: 1, token: TOKEN }
  ] }) });
  const result = await client.listTasks({ page: 2, size: 2 });
  assert.equal(requests[0].url, 'https://www.workbuddy.cn/openapi/v2/tasks?page=2&size=2');
  assert.deepEqual(result.pagination, { page: 2, size: 2, total: 5 });
  assert.equal(result.scope, 'cloud-tasks-only'); assert.equal(result.tasks[0].status, 'working');
  assert.equal(result.tasks[0].name, 'third [redacted]'); assert.equal(result.tasks[1].status, 'unknown');
  assert.equal(result.tasks[1].createdAt, null);
  assert.equal(Object.hasOwn(result.tasks[0], 'token'), false); assert.equal(Object.hasOwn(result.tasks[0], 'prompt'), false);
  noSecrets(result);
});

test('任务分页不一致或未知envelope明确失败，参数越界不触HTTP', async () => {
  const f = harness({ reply: () => response({ tasks: [], total: 4, pagination: { page: 1, size: 20, total: 3 } }) });
  await assert.rejects(f.client.listTasks(), { code: 'INVALID_RESPONSE' });
  for (const options of [{ page: 0 }, { page: 1.5 }, { size: 101 }, { size: 0 }]) await assert.rejects(f.client.listTasks(options), { code: 'INVALID_INPUT' });
  assert.equal(f.requests.length, 1);
});

test('消息历史必须显式增量anchor，保留content数组，不擅自导入PC历史或自动审批', async () => {
  const { client, requests } = harness({ reply: () => ok({ messages: [
    { message_id: 'message-2', role: 'assistant', msg_type: 'text', created_at: '2026-10-31T00:00:00Z',
      content: [{ type: 'text', text: 'hello' }, { type: 'text', text: TOKEN }, { type: 'image', url: TOKEN }],
      attachments: [{ url: TOKEN }], metadata: { token: TOKEN, accountId: PRIVATE } },
    { message_id: 'approval-3', role: 'assistant', msg_type: 'permission_request',
      content: [{ type: 'permission', requestId: PRIVATE }], attachments: [], metadata: {} }
  ] }) });
  await assert.rejects(client.listMessages(), { code: 'INVALID_INPUT' }); assert.equal(requests.length, 0);
  const result = await client.listMessages({ afterMessageId: 'message-1', limit: 2, offset: 2 });
  assert.equal(requests[0].url, 'https://www.workbuddy.cn/openapi/v2/localassistant/message?message_id=message-1&limit=2&offset=2');
  assert.deepEqual(result.pagination, { limit: 2, offset: 2, afterMessageId: 'message-1', hasMore: null });
  assert.equal(result.scope, 'pc-assistant-incremental-shared-history'); assert.equal(result.partial, true);
  assert.deepEqual(result.messages[0].content, [{ type: 'text', text: 'hello' }, { type: 'text', text: '[redacted]' }]);
  assert.equal(result.messages[0].attachmentCount, 1); assert.equal(result.messages[0].metadataPresent, true);
  assert.equal(result.messages[0].unsupportedContentCount, 1); assert.equal(result.messages[1].msgType, 'permission_request');
  assert.deepEqual(result.messages[1].content, []); assert.equal(requests.some(r => r.config.method === 'POST'), false);
  noSecrets(result);
});

test('历史content/attachments/metadata类型不匹配不按字符串伪造聊天', async () => {
  const { client } = harness({ reply: () => ok({ messages: [{ message_id: 'm2', content: 'not-an-array', attachments: [], metadata: {} }] }) });
  await assert.rejects(client.listMessages({ afterMessageId: 'm1' }), { code: 'INVALID_RESPONSE' });
});

test('发送先检查online，单次仅POST text；接受不等于回复完成', async () => {
  const { client, requests, authorizations } = harness();
  const result = await client.sendMessage({ content: 'synthetic explicit message' });
  assert.deepEqual(requests.map(r => r.config.method), ['GET', 'POST']);
  assert.equal(requests[1].url, 'https://www.workbuddy.cn/openapi/v2/localassistant/message');
  assert.deepEqual(JSON.parse(requests[1].config.body), { content: 'synthetic explicit message', msg_type: 'text' });
  assert.deepEqual(authorizations[0].requiredScopes, ['user.localassistant.readable', 'user.localassistant.invokable']);
  assert.equal(result.state, 'accepted'); assert.equal(result.messageId, 'fixture-message');
  assert.equal(result.completion, 'not-confirmed'); noSecrets(result);
  await assert.rejects(client.sendMessage({ content: 'synthetic', msg_type: 'permission_response' }), { code: 'INVALID_INPUT' });
  assert.equal(requests.length, 2);
});

test('离线或未知在线状态不POST，缺调用权限也不会偷偷读取/发送', async () => {
  const offline = harness({ reply: () => ok({ online: false }) });
  await assert.rejects(offline.client.sendMessage({ content: 'synthetic' }), { code: 'ASSISTANT_OFFLINE' });
  assert.deepEqual(offline.requests.map(r => r.config.method), ['GET']);
  const unscoped = harness({ credentials: { accessToken: TOKEN, scopes: ['user.localassistant.readable'], expiresAt: EXPIRES } });
  await assert.rejects(unscoped.client.sendMessage({ content: 'synthetic' }), { code: 'PERMISSION_REQUIRED' });
  assert.equal(unscoped.requests.length, 0);
});

test('发送网络失败、坏响应或服务500保持UNKNOWN_OUTCOME，不自动重试或打印秘密', async t => {
  for (const [name, post] of [['network', () => { throw new Error(TOKEN); }],
    ['invalid', () => new Response(TOKEN)], ['server-error', () => new Response(TOKEN, { status: 500 })],
    ['missing-message-id', () => ok({ accepted: true })], ['redirect', () => new Response(null, { status: 302, headers: { Location: 'https://fixture.invalid/' + TOKEN } })]]) {
    await t.test(name, async () => {
      const { client, requests } = harness({ reply: (_url, config) => config.method === 'POST' ? post() : ok({ online: true }) });
      await assert.rejects(client.sendMessage({ content: 'synthetic' }), error => {
        noSecrets({ message: error.message, ...error });
        return error.code === 'UNKNOWN_OUTCOME' && error.outcome === 'unknown' && error.retryable === false;
      });
      assert.equal(requests.filter(r => r.config.method === 'POST').length, 1);
    });
  }
});

test('401/403/429和明确业务拒绝不refresh/重试，错误正文不泄漏', async t => {
  for (const [status, code] of [[401, 'AUTHORIZATION_REQUIRED'], [403, 'PERMISSION_REQUIRED'], [429, 'RATE_LIMITED']]) await t.test(String(status), async () => {
    const { client, requests } = harness({ reply: (_url, config) => config.method === 'POST' ? new Response(TOKEN, { status }) : ok({ online: true }) });
    await assert.rejects(client.sendMessage({ content: 'synthetic' }), { code, outcome: 'rejected', retryable: false });
    assert.equal(requests.filter(r => r.config.method === 'POST').length, 1);
  });
  const { client } = harness({ reply: (_url, config) => config.method === 'POST' ? response({ code: 999, message: TOKEN, data: { accountId: PRIVATE } }) : ok({ online: true }) });
  await assert.rejects(client.sendMessage({ content: 'synthetic' }), error => { noSecrets(error); return error.code === 'API_ERROR' && error.outcome === 'rejected'; });
});

test('只读重定向拒绝，永不向Location/伪装最终URL转发Authorization', async () => {
  const { client, requests } = harness({ reply: () => new Response(null, { status: 302, headers: { Location: 'https://fixture.invalid/' + TOKEN } }) });
  await assert.rejects(client.getAssistantStatus(), { code: 'REDIRECT_REJECTED' }); assert.equal(requests.length, 1);
  const next = harness({ reply: () => { const r = ok({ online: true }); Object.defineProperty(r, 'url', { value: 'https://fixture.invalid/' + TOKEN }); return r; } });
  await assert.rejects(next.client.getAssistantStatus(), { code: 'REDIRECT_REJECTED' }); assert.equal(next.requests.length, 1);
});

test('响应content-length与累计流大小都有界，超大错误不含body', async () => {
  const declared = harness({ reply: () => new Response('{}', { headers: { 'Content-Length': String(1024 * 1024 + 1) } }) });
  await assert.rejects(declared.client.getAssistantStatus(), { code: 'RESPONSE_TOO_LARGE' });
  let cancelled = false;
  const streaming = harness({ reply: () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } })) });
  await assert.rejects(streaming.client.getAssistantStatus(), { code: 'RESPONSE_TOO_LARGE' }); assert.equal(cancelled, true);
});

test('超时/取消覆盖body：只读返回TIMEOUT，已POST时UNKNOWN_OUTCOME，取消前不发HTTP', async () => {
  let cancelled = false;
  const read = harness({ timeoutMs: 50, reply: () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } })) });
  await assert.rejects(read.client.getAssistantStatus(), { code: 'TIMEOUT' }); assert.equal(cancelled, true);
  const send = harness({ timeoutMs: 50, reply: (_url, config) => config.method === 'POST'
    ? new Response(new ReadableStream({ start() {} })) : ok({ online: true }) });
  await assert.rejects(send.client.sendMessage({ content: 'synthetic' }), { code: 'UNKNOWN_OUTCOME', causeCode: 'TIMEOUT' });
  assert.equal(send.requests.filter(r => r.config.method === 'POST').length, 1);
  const abort = new AbortController(); abort.abort(new Error(TOKEN));
  const pre = harness(); await assert.rejects(pre.client.sendMessage({ content: 'synthetic', signal: abort.signal }), { code: 'CANCELLED' });
  assert.equal(pre.requests.length, 0); assert.equal(pre.authorizations.length, 0);
});

test('发送在途拒绝并发第二次POST，只有明确后续调用能再次发送', async () => {
  let resolvePost, started;
  const posting = new Promise(resolve => { started = resolve; });
  const { client, requests } = harness({ reply: (_url, config) => {
    if (config.method !== 'POST') return ok({ online: true });
    started(); return new Promise(resolve => { resolvePost = resolve; });
  } });
  const first = client.sendMessage({ content: 'first synthetic' }); await posting;
  await assert.rejects(client.sendMessage({ content: 'second synthetic' }), { code: 'BUSY' });
  resolvePost(ok({ message_id: 'accepted-first' })); assert.equal((await first).messageId, 'accepted-first');
  assert.equal(requests.filter(r => r.config.method === 'POST').length, 1);
});
