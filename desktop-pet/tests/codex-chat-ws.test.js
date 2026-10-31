'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { createCodexChatRpc, DISABLED_FEATURES, CHAT_OUTPUT_SCHEMA } = require('../lib/codex-chat-rpc');
const TOKEN = 'synthetic-local-chat-token-123456';
const WORKSPACE = '/private/qiuqiu-mas-chat';
const HOST_HOME = '/Users/synthetic-host';
const ID = 'fixture-chat-thread', TURN = 'fixture-chat-turn';
const goodConfig = () => ({ config: { features: Object.fromEntries(DISABLED_FEATURES.map(key => [key, false])),
  web_search: 'disabled', project_doc_max_bytes: 0, mcp_servers: { 'fixture-mcp': { command: 'PRIVATE' } } } });
const goodThread = () => ({ thread: { id: ID, environments: [], status: { type: 'idle' }, turns: [] },
  cwd: WORKSPACE, approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false },
  instructionSources: [HOST_HOME + '/.codex/AGENTS.md'] });
const model = () => ({ id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'Fixture model', description: 'Synthetic only', hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true });
function defaultReply(packet) {
  if (packet.method === 'config/read') return { result: goodConfig() };
  if (packet.method === 'account/read') return { result: { account: { type: 'chatgpt', email: 'fixture@example.invalid', accessToken: 'SECRET' } } };
  if (packet.method === 'model/list') return { result: { data: [model()], nextCursor: null } };
  if (packet.method === 'thread/start' || packet.method === 'thread/resume') return { result: goodThread() };
  if (packet.method === 'thread/read') return { result: { thread: { id: ID, environments: [] } } };
  if (packet.method === 'turn/start') return { result: { turn: { id: TURN, status: 'inProgress' } } };
  return { result: {} };
}
async function setup(t, { reply = defaultReply, options = {} } = {}) {
  const sent = [], notifications = [], disconnects = [], connections = [];
  let spawns = 0, probes = 0, homes = 0;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0,
    verifyClient: info => info.req.headers.authorization === `Bearer ${TOKEN}` });
  await once(server, 'listening');
  server.on('connection', (socket, req) => {
    connections.push({ socket, authHeader: req.headers.authorization });
    socket.on('message', data => {
      const packet = JSON.parse(data); sent.push(packet);
      if (!Object.hasOwn(packet, 'id') || packet.error) return;
      const result = reply(packet, socket);
      if (result !== undefined) socket.send(JSON.stringify({ id: packet.id, ...result }));
    });
  });
  const rpcOptions = { workspaceDir: WORKSPACE, hostHome: HOST_HOME, env: {}, timeoutMs: 1000,
    homedir: () => { homes++; throw new Error('Must not inspect container or host home'); },
    fs: { promises: { lstat: async () => { probes++; throw new Error('Must not discover'); } } },
    spawn: () => { spawns++; throw new Error('Must not spawn'); },
    onNotification: packet => notifications.push(packet), onDisconnect: code => disconnects.push(code),
    webSocket: { endpoint: `ws://127.0.0.1:${server.address().port}`, bearerToken: TOKEN }, ...options };
  const rpc = createCodexChatRpc(rpcOptions);
  t.after(async () => { await rpc.close(); for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); });
  return { rpc, server, rpcOptions, sent, notifications, disconnects, connections,
    counts: () => ({ spawns, probes, homes }) };
}
async function connect(h) { await h.rpc.start(); await h.rpc.readAccount(); }
const tick = () => new Promise(resolve => setImmediate(resolve));

test('WS仅初始化一次：账号/模型/建会话/流式回复/中断复用安全RPC，不扫描或spawn', async t => {
  const h = await setup(t, { reply: (packet, socket) => {
    if (packet.method === 'turn/start') {
      socket.send(JSON.stringify({ method: 'turn/started', params: { threadId: ID, turn: { id: TURN, status: 'inProgress' } } }));
      socket.send(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: ID, turnId: TURN, itemId: 'fixture-item', delta: '你好' } }));
    }
    if (packet.method === 'turn/interrupt') {
      socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: ID, turn: { id: TURN, status: 'interrupted' } } }));
    }
    return defaultReply(packet);
  } });
  const first = h.rpc.start(); assert.equal(h.rpc.start(), first); await first;
  const account = await h.rpc.readAccount();
  assert.equal(account.authenticated, true); assert.match(account.accountKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(account).includes('SECRET'), false); assert.equal(JSON.stringify(account).includes('@'), false);
  assert.equal((await h.rpc.listModels())[0].id, 'gpt-6-luna');
  assert.equal((await h.rpc.startThread()).id, ID);
  assert.equal((await h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'low' })).id, TURN);
  assert.equal(h.notifications.find(p => p.method === 'item/agentMessage/delta').params.delta, '你好');
  await h.rpc.interruptTurn(ID, TURN);
  assert.equal(h.notifications.at(-1).params.turn.status, 'interrupted');
  assert.deepEqual(await h.rpc.verifyThreadEnvironment(ID), { id: ID, environmentsDisabled: true });
  const thread = h.sent.find(p => p.method === 'thread/start').params;
  assert.deepEqual(thread.environments, []); assert.deepEqual(thread.dynamicTools, []);
  assert.equal(thread.config.mcp_servers['fixture-mcp'].enabled, false);
  const turn = h.sent.find(p => p.method === 'turn/start').params;
  assert.deepEqual(turn.outputSchema, CHAT_OUTPUT_SCHEMA);
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.equal(turn.approvalPolicy, 'never'); assert.deepEqual(turn.environments, []);
  assert.equal(h.sent.filter(p => p.method === 'initialize').length, 1);
  assert.equal(h.sent.filter(p => p.method === 'initialized').length, 1);
  assert.equal(h.connections[0].authHeader, `Bearer ${TOKEN}`);
  assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 });
});

test('WS启动必须核对服务禁工具配置，不能用连接成功绕过安全检查', async t => {
  const h = await setup(t, { reply: packet => {
    if (packet.method === 'config/read') { const raw = goodConfig(); raw.config.features.shell_tool = true; return { result: raw }; }
    return defaultReply(packet);
  } });
  await assert.rejects(h.rpc.start(), { code: 'UNSAFE_CONFIG' });
  assert.equal(h.sent.some(p => p.method === 'thread/start' || p.method === 'turn/start'), false);
  assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 });
});

test('WS明确hostHome只验证global instruction path，其他目录仍不允许发turn', async t => {
  const h = await setup(t, { reply: packet => packet.method === 'thread/start'
    ? { result: { ...goodThread(), instructionSources: ['/Users/another/.codex/AGENTS.md'] } } : defaultReply(packet) });
  await connect(h);
  await assert.rejects(h.rpc.startThread(), { code: 'UNSAFE_CONFIG' });
  assert.equal(h.sent.some(p => p.method === 'turn/start'), false);
  assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 });
});

test('WS仍拒绝服务端工具审批，并仅关闭自己socket而不停止服务', async t => {
  const h = await setup(t); await connect(h); await h.rpc.startThread();
  h.connections[0].socket.send(JSON.stringify({ id: 'approval-fixture', method: 'item/commandExecution/requestApproval',
    params: { threadId: ID, arguments: 'PRIVATE_COMMAND' } }));
  await once(h.connections[0].socket, 'close'); await tick();
  assert.deepEqual(h.sent.at(-1), { id: 'approval-fixture', error: { code: -32601, message: 'Chat tools are disabled' } });
  assert.deepEqual(h.disconnects, ['TOOL_BLOCKED']); assert.deepEqual(h.notifications, []);
  assert.equal(h.server.address().port > 0, true);
  const other = createCodexChatRpc(h.rpcOptions); t.after(() => other.close());
  await other.start(); assert.equal((await other.readAccount()).authenticated, true);
  await other.close();
});

test('WS拒绝非聊天执行item；工具通知不泄漏给界面', async t => {
  const h = await setup(t); await connect(h); await h.rpc.startThread();
  h.connections[0].socket.send(JSON.stringify({ method: 'item/started', params: { threadId: ID, turnId: TURN,
    item: { id: 'tool-item', type: 'commandExecution', command: 'PRIVATE_COMMAND' } } }));
  await once(h.connections[0].socket, 'close');
  assert.deepEqual(h.disconnects, ['TOOL_BLOCKED']); assert.deepEqual(h.notifications, []);
});

test('WS迟到完成早于turn应答时仍能开启下一轮，不重发旧turn', async t => {
  let turns = 0;
  const h = await setup(t, { reply: (packet, socket) => {
    if (packet.method === 'turn/start') {
      const id = 'fixture-turn-' + ++turns;
      socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: ID, turn: { id, status: 'completed' } } }));
      return { result: { turn: { id, status: 'inProgress' } } };
    }
    return defaultReply(packet);
  } });
  await connect(h); await h.rpc.startThread();
  await h.rpc.startTurn(ID, 'first'); await h.rpc.startTurn(ID, 'second');
  assert.equal(turns, 2); assert.equal(h.sent.filter(p => p.method === 'thread/start').length, 1);
});

test('WS在途请求超时/主动close只关闭连接，provider继续可接新连接', async t => {
  const h = await setup(t, { options: { timeoutMs: 50 }, reply: packet => packet.method === 'turn/start' ? undefined : defaultReply(packet) });
  await connect(h); await h.rpc.startThread();
  await assert.rejects(h.rpc.startTurn(ID, 'timeout'), { code: 'TIMEOUT' });
  await h.rpc.close(); assert.equal(h.server.address().port > 0, true);
  assert.equal(h.sent.filter(p => p.method === 'turn/start').length, 1);
  const other = createCodexChatRpc({ ...h.rpcOptions, timeoutMs: 1000 });
  await other.start(); await other.close();
  assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 });
});

test('WS主动close拒绝pending，重复close复用完成Promise', async t => {
  const h = await setup(t, { reply: packet => packet.method === 'account/read' ? undefined : defaultReply(packet) });
  await h.rpc.start();
  const read = h.rpc.readAccount(); const check = assert.rejects(read, { code: 'CLOSED' });
  const closing = h.rpc.close(); assert.equal(h.rpc.close(), closing); await closing; await check;
  assert.equal(h.server.address().port > 0, true);
});

test('WS拒绝坏鉴权和非loopback端点，未扫描、spawn或发送模型请求', async t => {
  const h = await setup(t, { options: { webSocket: { endpoint: 'ws://fixture.invalid:4500', bearerToken: TOKEN } } });
  await assert.rejects(h.rpc.start(), { code: 'INVALID_INPUT' });
  assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 }); assert.deepEqual(h.sent, []);
  const wrong = createCodexChatRpc({ ...h.rpcOptions, webSocket: {
    endpoint: `ws://127.0.0.1:${h.server.address().port}`, bearerToken: TOKEN + '-wrong' } });
  await assert.rejects(wrong.start(), error => error.code === 'DISCONNECTED' && !error.message.includes(TOKEN));
  await wrong.close(); assert.deepEqual(h.sent, []);
});

test('WS缺真实hostHome或CODEX_HOME偏离默认根时拒绝，不能关闭身份检查', async t => {
  assert.throws(() => createCodexChatRpc({ workspaceDir: WORKSPACE,
    webSocket: { endpoint: 'ws://127.0.0.1:4500', bearerToken: TOKEN } }), { code: 'INVALID_INPUT' });
  const h = await setup(t, { options: { env: { CODEX_HOME: '/private/other-profile' } } });
  await assert.rejects(h.rpc.start(), { code: 'UNSAFE_CONFIG' });
  assert.deepEqual(h.connections, []); assert.deepEqual(h.counts(), { spawns: 0, probes: 0, homes: 0 });
});
