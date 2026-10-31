'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCodexWsTransport, loopbackEndpoint } = require('../lib/codex-ws-transport');
const TOKEN = 'synthetic-capability-token-1234567890';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const frames = [], sockets = [], connections = [];
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.closed = false; }
    send(frame, callback) {
      const packet = JSON.parse(frame); frames.push(packet);
      if (options.sendError) { callback(new Error('raw token must never escape')); return; }
      callback?.();
      if (packet.method === 'initialize' && options.initialize !== false) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: packet.id, result: { serverInfo: 'synthetic' } })), false));
    }
    close() { this.closed = true; this.emit('close'); }
  }
  const createSocket = (url, config) => {
    connections.push({ url, config });
    const socket = new FakeSocket(); sockets.push(socket);
    if (options.open !== false) queueMicrotask(() => socket.emit('open'));
    return socket;
  };
  const transport = createCodexWsTransport({ endpoint: 'ws://127.0.0.1:4500', bearerToken: TOKEN,
    connectTimeoutMs: 1000, requestTimeoutMs: 1000, createSocket, ...options.transport });
  const respond = packet => sockets[0].emit('message', Buffer.from(JSON.stringify(packet)), false);
  return { transport, frames, connections, sockets, respond };
}

test('只允许 loopback，拒绝远端、URL凭据、query token与fragment', () => {
  assert.equal(loopbackEndpoint('ws://127.0.0.1:4500'), 'ws://127.0.0.1:4500/');
  assert.equal(loopbackEndpoint('wss://[::1]:4500'), 'wss://[::1]:4500/');
  for (const endpoint of ['ws://example.com:4500', 'ws://localhost:4500', 'https://127.0.0.1',
    'ws://user:password@127.0.0.1:4500', 'ws://127.0.0.1:4500?token=secret', 'ws://127.0.0.1/#secret', 'invalid']) {
    assert.throws(() => createCodexWsTransport({ endpoint, bearerToken: TOKEN }), { code: 'INVALID_ENDPOINT' });
  }
  for (const bearerToken of [undefined, '', 'short', TOKEN + '\r\nInjected: yes']) {
    assert.throws(() => createCodexWsTransport({ endpoint: 'ws://127.0.0.1:4500', bearerToken }), { code: 'INVALID_TOKEN' });
  }
});

test('握手使用header，不跟随重定向；initialize后才发initialized且start幂等', async () => {
  const { transport, frames, connections } = harness();
  await assert.rejects(transport.request('account/read'), { code: 'NOT_READY' });
  const first = transport.start(); assert.equal(transport.start(), first); await first;
  assert.equal(transport.getState(), 'ready');
  assert.equal(connections.length, 1);
  assert.equal(connections[0].config.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(connections[0].config.followRedirects, false);
  assert.equal(connections[0].url.includes(TOKEN), false);
  assert.deepEqual(frames.map(frame => frame.method), ['initialize', 'initialized']);
  assert.equal(frames[0].params.capabilities.experimentalApi, false);
  assert.equal(JSON.stringify(frames).includes(TOKEN), false);
  transport.close();
});

test('并发响应按id匹配，通知和服务器请求不抢占pending响应', async () => {
  const notifications = [];
  const { transport, frames, respond } = harness({ transport: { onNotification: packet => notifications.push(packet) } });
  await transport.start();
  const account = transport.request('account/read', { refreshToken: false });
  const quota = transport.request('account/rateLimits/read');
  const accountId = frames[2].id, quotaId = frames[3].id;
  respond({ method: 'turn/started', params: { turn: { id: 'fixture-turn' } } });
  respond({ id: accountId, method: 'item/commandExecution/requestApproval', params: {} });
  await tick();
  assert.equal(frames.at(-1).error.code, -32601); // Never silently approve provider requests.
  respond({ id: quotaId, result: { rateLimits: { fixture: true } } });
  respond({ id: accountId, result: { account: { type: 'chatgpt', email: 'fixture@example.invalid' } } });
  assert.deepEqual(await quota, { rateLimits: { fixture: true } });
  assert.equal((await account).account.type, 'chatgpt');
  assert.deepEqual(notifications, [{ method: 'turn/started', params: { turn: { id: 'fixture-turn' } } }]);
  transport.close();
});

test('显式服务器请求处理器返回结果；处理器异常返回固定错误，不泄漏内容', async () => {
  const { transport, frames, respond } = harness({ transport: {
    onServerRequest: async packet => { if (packet.method === 'fixture/fail') throw new Error(TOKEN); return { decision: 'decline' }; }
  } });
  await transport.start();
  respond({ id: 'approval-1', method: 'fixture/approval', params: {} }); await tick();
  assert.deepEqual(frames.at(-1), { id: 'approval-1', result: { decision: 'decline' } });
  respond({ id: 'approval-2', method: 'fixture/fail', params: {} }); await tick();
  assert.deepEqual(frames.at(-1), { id: 'approval-2', error: { code: -32601, message: 'Client request handler unavailable' } });
  assert.equal(JSON.stringify(frames).includes(TOKEN), false);
  transport.close();
});

test('连接超时和initialize超时关闭socket，清理启动与pending状态', async t => {
  for (const mode of ['open', 'initialize']) await t.test(mode, async () => {
    const { transport, sockets } = harness({ [mode]: false, transport: { connectTimeoutMs: 20, requestTimeoutMs: 10 } });
    await assert.rejects(transport.start(), { code: 'TIMEOUT' });
    assert.equal(transport.getState(), 'closed'); assert.equal(sockets[0].closed, true);
    await assert.rejects(transport.request('account/read'), { code: 'CLOSED' });
  });
});

test('单条请求超时不破坏连接，晚响应丢弃，之后仍可请求', async () => {
  const { transport, frames, respond } = harness({ transport: { requestTimeoutMs: 10 } });
  await transport.start();
  const first = transport.request('thread/list'); const oldId = frames.at(-1).id;
  await assert.rejects(first, { code: 'TIMEOUT' });
  respond({ id: oldId, result: { stale: true } });
  const second = transport.request('account/read'); const id = frames.at(-1).id;
  respond({ id, result: { authenticated: true } });
  assert.deepEqual(await second, { authenticated: true }); assert.equal(transport.getState(), 'ready');
  transport.close();
});

test('断开一次拒绝全部pending，不传播原始错误和token，不重复回调', async () => {
  const disconnected = [];
  const { transport, sockets } = harness({ transport: { onDisconnect: code => disconnected.push(code) } });
  await transport.start();
  const first = transport.request('account/read'), second = transport.request('thread/list');
  const checks = [assert.rejects(first, { code: 'DISCONNECTED' }), assert.rejects(second, { code: 'DISCONNECTED' })];
  sockets[0].emit('error', new Error(TOKEN));
  sockets[0].emit('error', new Error(TOKEN));
  await Promise.all(checks);
  assert.deepEqual(disconnected, ['DISCONNECTED']); assert.equal(sockets[0].closed, true);
  transport.close();
});

test('显式close取消pending，不终止provider服务，关闭幂等', async () => {
  const { transport, sockets } = harness(); await transport.start();
  const request = transport.request('thread/list'); const check = assert.rejects(request, { code: 'CLOSED' });
  transport.close(); transport.close(); await check;
  assert.equal(sockets[0].closed, true); await assert.rejects(transport.start(), { code: 'CLOSED' });
});

test('错误响应按固定code映射，不输出服务端错误正文', async () => {
  const { transport, frames, respond } = harness(); await transport.start();
  const request = transport.request('account/read');
  respond({ id: frames.at(-1).id, error: { code: 401, message: TOKEN } });
  await assert.rejects(request, error => error.code === 'UNAUTHENTICATED' && error.message === 'UNAUTHENTICATED');
  transport.close();
});

test('超大帧、无效UTF8、二进制和歧义响应明确关闭且清理pending', async t => {
  const cases = [
    ['size', socket => socket.emit('message', Buffer.alloc(2049, 'a'), false), 'FRAME_TOO_LARGE'],
    ['utf8', socket => socket.emit('message', Buffer.from([0xff]), false), 'INVALID_FRAME'],
    ['binary', socket => socket.emit('message', Buffer.from('{}'), true), 'INVALID_FRAME'],
    ['ambiguous', (socket, id) => socket.emit('message', Buffer.from(JSON.stringify({ id, result: {}, error: {} })), false), 'INVALID_FRAME']
  ];
  for (const [name, emit, code] of cases) await t.test(name, async () => {
    const { transport, sockets, frames } = harness({ transport: { maxFrameBytes: 2048 } }); await transport.start();
    const pending = transport.request('account/read'); const check = assert.rejects(pending, { code });
    emit(sockets[0], frames.at(-1).id); await check; assert.equal(transport.getState(), 'closed');
  });
});

test('发送失败拒绝pending，不悬挂initialize或请求', async () => {
  const { transport } = harness({ sendError: true });
  await assert.rejects(transport.start(), { code: 'DISCONNECTED' });
  assert.equal(transport.getState(), 'closed');
});

test('真实loopback WebSocket：Bearer握手、双向JSON-RPC和断连', async t => {
  const { WebSocketServer } = require('ws');
  let authHeader, peer;
  const received = [], notifications = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: info => {
    authHeader = info.req.headers.authorization;
    return authHeader === `Bearer ${TOKEN}`;
  } });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { for (const client of server.clients) client.terminate(); server.close(resolve); }));
  server.on('connection', socket => {
    peer = socket;
    socket.on('message', data => {
      const packet = JSON.parse(data); received.push(packet);
      if (packet.method === 'initialize') socket.send(JSON.stringify({ id: packet.id, result: { userAgent: 'fixture' } }));
      if (packet.method === 'account/read') {
        socket.send(JSON.stringify({ method: 'account/updated', params: { authMode: 'fixture' } }));
        socket.send(JSON.stringify({ id: packet.id, result: { account: { type: 'chatgpt', planType: 'fixture' } } }));
      }
    });
  });
  const transport = createCodexWsTransport({ endpoint: `ws://127.0.0.1:${server.address().port}`,
    bearerToken: TOKEN, onNotification: packet => notifications.push(packet), requestTimeoutMs: 500, connectTimeoutMs: 500 });
  t.after(() => transport.close());
  await transport.start();
  assert.equal(authHeader, `Bearer ${TOKEN}`);
  assert.deepEqual(await transport.request('account/read'), { account: { type: 'chatgpt', planType: 'fixture' } });
  assert.deepEqual(received.slice(0, 2).map(p => p.method), ['initialize', 'initialized']);
  assert.deepEqual(notifications, [{ method: 'account/updated', params: { authMode: 'fixture' } }]);
  const pending = transport.request('thread/list'); const check = assert.rejects(pending, { code: 'DISCONNECTED' });
  peer.terminate(); await check;
  assert.equal(transport.getState(), 'closed');
});

test('真实loopback WebSocket：错误Bearer握手被拒，错误不回显token', async t => {
  const { WebSocketServer } = require('ws');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0,
    verifyClient: info => info.req.headers.authorization === `Bearer ${TOKEN}` });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const transport = createCodexWsTransport({ endpoint: `ws://127.0.0.1:${server.address().port}`,
    bearerToken: TOKEN + '-wrong', connectTimeoutMs: 500 });
  await assert.rejects(transport.start(), error => error.code === 'DISCONNECTED' && error.message === 'DISCONNECTED');
  assert.equal(transport.getState(), 'closed');
});
