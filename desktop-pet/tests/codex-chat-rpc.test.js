const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { createCodexChatRpc, DISABLED_FEATURES, CHAT_OUTPUT_SCHEMA } = require('../lib/codex-chat-rpc');

const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
const TURN = '019fae37-6bb8-7873-8873-14a6661bd1f2';
const WORKSPACE = '/private/qiuqiu-chat';
const goodConfig = () => ({ config: { features: Object.fromEntries(DISABLED_FEATURES.map(key => [key, false])),
  web_search: 'disabled', project_doc_max_bytes: 0, mcp_servers: { 'company.private': { command: 'SECRET' }, foo: {} } } });
const goodThread = () => ({ thread: { id: ID, environments: [], status: { type: 'idle' }, turns: [] },
  cwd: WORKSPACE, approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [] });
const goodModel = (id = 'gpt-6-luna', extra = {}) => ({ id, model: id, displayName: id.toUpperCase(), description: '适合聊天', hidden: false,
  supportedReasoningEfforts: ['low', 'medium'].map(reasoningEffort => ({ reasoningEffort, description: 'effort description' })),
  defaultReasoningEffort: 'medium', isDefault: false, ...extra });
function fakeChild() {
  const child = new EventEmitter(); child.pid = 999999;
  for (const name of ['stdin', 'stdout', 'stderr']) child[name] = new PassThrough();
  child.kills = []; child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('exit', 1)); return true; };
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('exit', 0)));
  return child;
}
function defaultReply(packet) {
  if (packet.method === 'config/read') return { result: goodConfig() };
  if (packet.method === 'account/read') return { result: { account: { type: 'chatgpt', email: 'person@example.test' } } };
  if (packet.method === 'thread/start' || packet.method === 'thread/resume') return { result: goodThread() };
  if (packet.method === 'turn/start') return { result: { turn: { id: TURN, status: 'inProgress' } } };
  return { result: {} };
}
function setup({ reply = defaultReply, installed = true, timeoutMs = 200, maxFrameBytes, onNotification,
  onDisconnect, fakeFs, env = {} } = {}) {
  const child = fakeChild(), sent = [], probes = [], launches = [], notifications = [], disconnects = [];
  const send = packet => child.stdout.write(JSON.stringify(packet) + '\n');
  child.stdin.on('data', chunk => {
    const packet = JSON.parse(chunk); sent.push(packet);
    if (!Object.hasOwn(packet, 'id') || packet.error) return;
    const response = reply(packet, { send, child });
    if (response !== undefined) queueMicrotask(() => send({ id: packet.id, ...response }));
  });
  const rpc = createCodexChatRpc({ workspaceDir: WORKSPACE, timeoutMs, maxFrameBytes, env,
    spawn: (...args) => { launches.push(args); return child; }, homedir: () => '/private/test-user',
    onNotification: value => { notifications.push(value); onNotification?.(value); },
    onDisconnect: value => { disconnects.push(value); onDisconnect?.(value); },
    fs: fakeFs || { promises: {
      lstat: async file => { probes.push(file); if (!installed) throw new Error('SECRET'); return { isFile: () => true, isSymbolicLink: () => false }; },
      access: async () => {}
    } }
  });
  return { rpc, child, sent, send, probes, launches, notifications, disconnects };
}
async function connected(h, resume = false) {
  await h.rpc.start(); await h.rpc.readAccount();
  return resume ? h.rpc.resumeThread(ID) : h.rpc.startThread();
}

test('构造无探测，固定四个安装位置，不搜索PATH或运行shell', async () => {
  const h = setup({ installed: false });
  assert.equal(h.probes.length, 0); assert.equal(h.launches.length, 0);
  await assert.rejects(h.rpc.start(), { code: 'MISSING' });
  assert.deepEqual(h.probes, ['/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/private/test-user/Applications/Codex.app/Contents/Resources/codex', '/private/test-user/Applications/ChatGPT.app/Contents/Resources/codex']);
  assert.equal(h.launches.length, 0);
});

test('start幂等，启动仅握手和只读config，关闭工具开关不改用户全局配置', async t => {
  const h = setup(); t.after(() => h.rpc.close());
  const first = h.rpc.start(); assert.equal(first, h.rpc.start()); await first;
  assert.deepEqual(h.sent.map(p => p.method), ['initialize', 'initialized', 'config/read']);
  const [, args, options] = h.launches[0];
  assert.equal(options.cwd, WORKSPACE); assert.equal(options.shell, undefined);
  for (const key of DISABLED_FEATURES) assert.ok(args.includes(`features.${key}=false`), key);
  assert.equal(h.sent[0].params.capabilities.experimentalApi, true);
  assert.equal(h.rpc.request, undefined);
});

for (const name of ['AGENTS.md', 'AGENTS.override.md']) test(`仅允许Codex默认home内建全局偏好${name}，仍禁环境和执行`, async t => {
  const h = setup({ reply: p => p.method === 'thread/start' ? { result: {
    ...goodThread(), instructionSources: [`/private/test-user/.codex/${name}`]
  } } : defaultReply(p) });
  t.after(() => h.rpc.close());
  assert.equal((await connected(h)).id, ID);
  await h.rpc.startTurn(ID, 'hello');
  assert.deepEqual(h.sent.at(-1).params.environments, []);
  assert.deepEqual(h.sent.at(-1).params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
});

test('显式默认CODEX_HOME可用，非默认home在探测和启动前拒绝', async t => {
  const h = setup({ env: { CODEX_HOME: '/private/test-user/.codex' } });
  t.after(() => h.rpc.close()); await h.rpc.start();
  for (const home of ['/private/other-profile', '', '~/.codex']) {
    const other = setup({ env: { CODEX_HOME: home } });
    await assert.rejects(other.rpc.start(), { code: 'UNSAFE_CONFIG' });
    assert.equal(other.probes.length, 0); assert.equal(other.launches.length, 0);
  }
});

test('账号只返回稳定hash，不输出邮箱/API Key，身份不依赖套餐', async t => {
  let plan = 'plus';
  const h = setup({ reply: p => p.method === 'account/read'
    ? { result: { account: { type: 'chatgpt', email: 'Person@Example.test', planType: plan, accessToken: 'SECRET' } } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start();
  const first = await h.rpc.readAccount(); plan = 'pro';
  assert.deepEqual(await h.rpc.readAccount(), first);
  assert.match(first.accountKey, /^[a-f0-9]{64}$/); assert.equal(first.authenticated, true);
  assert.equal(JSON.stringify(first).includes('SECRET'), false); assert.equal(JSON.stringify(first).includes('@'), false);
  assert.deepEqual(h.sent.find(p => p.method === 'account/read').params, { refreshToken: false });
});

test('未登录不创建thread，API Key账号不误认为可复用ChatGPT身份', async t => {
  let account = null;
  const h = setup({ reply: p => p.method === 'account/read' ? { result: { account } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start();
  assert.deepEqual(await h.rpc.readAccount(), { accountKey: null, authenticated: false });
  await assert.rejects(h.rpc.startThread(), { code: 'UNAUTHENTICATED' });
  account = { type: 'apiKey', apiKey: 'SECRET' };
  await assert.rejects(h.rpc.readAccount(), { code: 'UNSUPPORTED' });
  assert.equal(h.sent.some(p => p.method === 'thread/start'), false);
});

test('账号通知清身份并投影空参数，迟到旧账号响应必须另读确认且重读次数有界', async t => {
  let pendingRead = null;
  const h = setup({ reply: p => {
    if (pendingRead !== null && p.method === 'account/read') { pendingRead = p; return undefined; }
    return defaultReply(p);
  } });
  t.after(() => h.rpc.close()); await connected(h);
  h.send({ method: 'account/updated', params: { authMode: 'chatgpt', email: 'SECRET', planType: 'pro' } });
  assert.deepEqual(h.notifications.at(-1), { method: 'account/updated', params: {} });
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'UNAUTHENTICATED' });
  pendingRead = {};
  const read = h.rpc.readAccount();
  h.send({ method: 'account/updated', params: { authMode: null } });
  h.send({ id: pendingRead.id, ...defaultReply(pendingRead) });
  await new Promise(resolve => setImmediate(resolve));
  h.send({ method: 'account/updated', params: { authMode: null } });
  h.send({ id: pendingRead.id, ...defaultReply(pendingRead) });
  await assert.rejects(read, { code: 'UNAUTHENTICATED' });
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'UNAUTHENTICATED' });
});

test('首次读取先收到账号初始化通知时，重新只读确认一次，不假报切换或接受旧身份', async t => {
  let reads = 0;
  const h = setup({ reply: (packet, { send }) => {
    if (packet.method !== 'account/read') return defaultReply(packet);
    reads++;
    if (reads === 1) {
      send({ method: 'account/updated', params: { authMode: 'chatgpt' } });
      return { result: { account: { type: 'chatgpt', email: 'stale@example.test' } } };
    }
    return defaultReply(packet);
  } });
  t.after(() => h.rpc.close()); await h.rpc.start();
  const confirmed = await h.rpc.readAccount();
  assert.equal(reads, 2); assert.equal(confirmed.authenticated, true);
  assert.equal(h.notifications.length, 0);
  assert.deepEqual(await h.rpc.readAccount(), confirmed);
  assert.equal((await h.rpc.startThread()).id, ID);
  h.send({ method: 'account/updated', params: { authMode: null } });
  assert.deepEqual(h.notifications, [{ method: 'account/updated', params: {} }]);
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'UNAUTHENTICATED' });
});

test('读取账号失败或切换身份都不能沿用旧thread授权', async t => {
  let mode = 'same';
  const h = setup({ reply: p => {
    if (p.method === 'account/read' && mode === 'error') return { error: { code: 500, message: 'SECRET' } };
    if (p.method === 'account/read' && mode === 'switch') return { result: { account: { type: 'chatgpt', email: 'other@example.test' } } };
    return defaultReply(p);
  } });
  t.after(() => h.rpc.close()); await connected(h);
  mode = 'error'; await assert.rejects(h.rpc.readAccount(), { code: 'DISCONNECTED' });
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'UNAUTHENTICATED' });
  mode = 'switch'; await h.rpc.readAccount();
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'UNAUTHENTICATED' });
});

test('命名独立于创建，命名超时不丢id也不关闭聊天连接', async t => {
  const h = setup({ timeoutMs: 25, reply: p => p.method === 'thread/name/set' ? undefined : defaultReply(p) });
  t.after(() => h.rpc.close()); assert.equal((await connected(h)).id, ID);
  assert.equal(h.sent.some(p => p.method === 'thread/name/set'), false);
  await assert.rejects(h.rpc.nameThread(ID), { code: 'TIMEOUT' });
  assert.deepEqual(h.child.kills, []); assert.deepEqual(h.disconnects, []);
  await h.rpc.startTurn(ID, '名字没改也能继续');
  assert.equal(h.sent.filter(p => p.method === 'thread/start').length, 1);
});

test('首次建一次thread，每句都复用同id；固定空环境、只读、逐项关闭继承MCP和输出schema', async t => {
  const h = setup(); t.after(() => h.rpc.close());
  assert.deepEqual(await connected(h), { id: ID, status: 'idle', activeTurnId: null });
  const start = h.sent.find(p => p.method === 'thread/start').params;
  assert.deepEqual(start.environments, []); assert.deepEqual(start.dynamicTools, []);
  assert.equal(start.ephemeral, false); assert.equal(start.model, undefined);
  assert.equal(start.sandbox, 'read-only'); assert.equal(start.approvalPolicy, 'never');
  assert.deepEqual(start.config.mcp_servers, { 'company.private': { enabled: false }, foo: { enabled: false } });
  assert.match(start.developerInstructions, /只有用户明确要求/);
  await h.rpc.startTurn(ID, '你好');
  h.send({ method: 'turn/completed', params: { threadId: ID, turn: { id: TURN, status: 'completed' } } });
  await h.rpc.startTurn(ID, '记得刚才吗');
  const turns = h.sent.filter(p => p.method === 'turn/start');
  assert.equal(h.sent.filter(p => p.method === 'thread/start').length, 1);
  assert.equal(turns.length, 2);
  for (const p of turns) {
    assert.equal(p.params.threadId, ID); assert.deepEqual(p.params.environments, []);
    assert.deepEqual(p.params.outputSchema, CHAT_OUTPUT_SCHEMA);
    assert.deepEqual(p.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.equal(p.params.model, undefined); assert.equal(p.params.input[0].type, 'text');
  }
  await assert.rejects(h.rpc.startThread(), { code: 'BUSY' });
});

test('重启只resume明确id，不取其他任务列表或全量历史', async t => {
  const h = setup(); t.after(() => h.rpc.close());
  await connected(h, true); await h.rpc.startTurn(ID, '接着聊');
  const resume = h.sent.find(p => p.method === 'thread/resume').params;
  assert.equal(resume.threadId, ID); assert.equal(resume.excludeTurns, true);
  assert.equal(h.sent.some(p => p.method === 'thread/start' || p.method === 'thread/list'), false);
});

test('恢复仅允许唯一聊天local元数据；实际每轮输入前清空环境，完成后可只读核验', async t => {
  let sentTurn = false;
  const h = setup({ reply: packet => {
    if (packet.method === 'thread/resume') {
      const raw = goodThread(); raw.thread.environments = [{ environmentId: 'local', cwd: WORKSPACE, runtimeWorkspaceRoots: [WORKSPACE] }];
      return { result: raw };
    }
    if (packet.method === 'turn/start') sentTurn = true;
    if (packet.method === 'thread/read') return { result: { thread: { id: ID, environments: sentTurn ? [] : [{ environmentId: 'local' }], turns: ['SECRET'] } } };
    return defaultReply(packet);
  } });
  t.after(() => h.rpc.close()); await connected(h, true);
  await assert.rejects(h.rpc.verifyThreadEnvironment(ID), { code: 'UNSAFE_CONFIG' });
  await h.rpc.startTurn(ID, '继续');
  const params = h.sent.find(packet => packet.method === 'turn/start').params;
  assert.deepEqual(params.environments, []);
  assert.deepEqual(params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.deepEqual(await h.rpc.verifyThreadEnvironment(ID), { id: ID, environmentsDisabled: true });
  assert.deepEqual(h.sent.at(-1).params, { threadId: ID, includeTurns: false });
});

for (const environments of [
  null, [{ environmentId: 'remote', cwd: WORKSPACE, runtimeWorkspaceRoots: [WORKSPACE] }],
  [{ environmentId: 'local', cwd: '/private/other', runtimeWorkspaceRoots: [WORKSPACE] }],
  [{ environmentId: 'local', cwd: WORKSPACE, runtimeWorkspaceRoots: [] }],
  [{ environmentId: 'local', cwd: WORKSPACE, runtimeWorkspaceRoots: [WORKSPACE, '/private/other'] }],
  [{ environmentId: 'local', cwd: WORKSPACE, runtimeWorkspaceRoots: [WORKSPACE] }, { environmentId: 'other' }]
]) test('恢复拒绝其他目录、远程、多环境或未知选择，未发送model turn', async t => {
  const h = setup({ reply: packet => packet.method === 'thread/resume'
    ? { result: { ...goodThread(), thread: { ...goodThread().thread, environments } } } : defaultReply(packet) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  await assert.rejects(h.rpc.resumeThread(ID), { code: 'UNSAFE_CONFIG' });
  assert.equal(h.sent.some(packet => packet.method === 'turn/start'), false);
});

test('恢复错误不自动新建、不重试turn；安全码不暴露服务器正文', async t => {
  const h = setup({ reply: p => p.method === 'thread/resume' ? { error: { code: 404, message: 'SECRET path token' } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  await assert.rejects(h.rpc.resumeThread(ID), error => error.code === 'THREAD_NOT_FOUND' && error.message === 'THREAD_NOT_FOUND');
  assert.equal(h.sent.filter(p => p.method === 'thread/resume').length, 1);
  assert.equal(h.sent.some(p => p.method === 'thread/start'), false);
});

test('恢复仍在运行的thread明确返回active，阻止新turn混入', async t => {
  const h = setup({ reply: p => p.method === 'thread/resume' ? { result: { ...goodThread(),
    thread: { id: ID, environments: [], status: { type: 'active' }, turns: [{ id: TURN, status: 'inProgress', items: ['SECRET'] }] } } } : defaultReply(p) });
  t.after(() => h.rpc.close());
  assert.deepEqual(await connected(h, true), { id: ID, status: 'active', activeTurnId: TURN });
  await assert.rejects(h.rpc.startTurn(ID, '不能混入'), { code: 'BUSY' });
  await h.rpc.interruptTurn(ID, TURN);
  assert.deepEqual(h.sent.at(-1).params, { threadId: ID, turnId: TURN });
});

test('active但没有turn正文仍阻止发送，不假装已经完成', async t => {
  const h = setup({ reply: p => p.method === 'thread/resume' ? { result: { ...goodThread(),
    thread: { id: ID, environments: [], status: { type: 'active' }, turns: [] } } } : defaultReply(p) });
  t.after(() => h.rpc.close());
  assert.deepEqual(await connected(h, true), { id: ID, status: 'active', activeTurnId: null });
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'BUSY' });
});

test('早于turn/start应答的流和完成事件即时交付，晚应答不会重新锁住已完成turn', async t => {
  const h = setup({ reply: (p, { send }) => {
    if (p.method !== 'turn/start') return defaultReply(p);
    send({ method: 'turn/started', params: { threadId: ID, turn: { id: TURN, status: 'inProgress', items: ['SECRET'] } } });
    send({ method: 'item/agentMessage/delta', params: { threadId: ID, turnId: TURN, itemId: 'message_1', delta: '{"text":"你好"', secret: 'SECRET' } });
    send({ method: 'item/completed', params: { threadId: ID, turnId: TURN,
      item: { type: 'agentMessage', id: 'message_1', text: '{"text":"你好","action":"none"}', phase: 'final_answer', memoryCitation: 'SECRET' } } });
    send({ method: 'turn/completed', params: { threadId: ID, turn: { id: TURN, status: 'completed', items: ['SECRET'] } } });
    return defaultReply(p);
  } });
  t.after(() => h.rpc.close()); await connected(h);
  await h.rpc.startTurn(ID, '你好');
  assert.equal(h.notifications.length, 4);
  assert.equal(JSON.stringify(h.notifications).includes('SECRET'), false);
  assert.deepEqual(h.notifications[1].params, { threadId: ID, turnId: TURN, itemId: 'message_1', delta: '{"text":"你好"' });
  await h.rpc.startTurn(ID, '下一句');
});

test('忽略其他thread内容；错误通知只投影固定码，callback抛错不影响连接', async t => {
  const h = setup({ onNotification: () => { throw new Error('UI'); } }); t.after(() => h.rpc.close()); await connected(h);
  h.send({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: TURN, itemId: 'x', delta: 'SECRET' } });
  h.send({ method: 'error', params: { threadId: ID, turnId: TURN,
    error: { codexErrorInfo: 'usageLimitExceeded', message: 'SECRET' }, willRetry: true } });
  assert.deepEqual(h.notifications, [{ method: 'error', params: { threadId: ID, turnId: TURN, error: { code: 'RATE_LIMITED' }, willRetry: true } }]);
  await h.rpc.readAccount();
});

for (const mutation of ['thread/start', 'turn/start']) test(`${mutation}超时关闭拥有的进程、不重发或新建替代thread`, async () => {
  const h = setup({ timeoutMs: 25, reply: p => p.method === mutation ? undefined : defaultReply(p) });
  await h.rpc.start(); await h.rpc.readAccount();
  if (mutation === 'turn/start') await h.rpc.startThread();
  await assert.rejects(mutation === 'thread/start' ? h.rpc.startThread() : h.rpc.startTurn(ID, 'hi'), { code: 'TIMEOUT' });
  assert.equal(h.sent.filter(p => p.method === mutation).length, 1);
  assert.deepEqual(h.child.kills, ['SIGKILL']); assert.deepEqual(h.disconnects, ['TIMEOUT']);
  await assert.rejects(h.rpc.start(), { code: 'CLOSED' });
});

test('在途turn禁止重复发送，取消使用相同thread/turn', async t => {
  const h = setup(); t.after(() => h.rpc.close()); await connected(h);
  const promise = h.rpc.startTurn(ID, 'hello');
  await assert.rejects(h.rpc.startTurn(ID, 'double'), { code: 'BUSY' }); await promise;
  await assert.rejects(h.rpc.startTurn(ID, 'again'), { code: 'BUSY' });
  await h.rpc.interruptTurn(ID, TURN);
  assert.deepEqual(h.sent.at(-1).params, { threadId: ID, turnId: TURN });
});

for (const packet of [
  { id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'SECRET' } },
  { method: 'item/started', params: { threadId: ID, turnId: TURN, item: { id: 'x', type: 'mcpToolCall', arguments: 'SECRET' } } }
]) test(`工具或审批请求立即拒绝并终止独占连接：${packet.method}`, async () => {
  const h = setup(); await connected(h); h.send(packet);
  assert.deepEqual(h.disconnects, ['TOOL_BLOCKED']); assert.equal(h.notifications.length, 0);
  assert.deepEqual(h.child.kills, ['SIGKILL']);
  if (packet.id) assert.deepEqual(h.sent.at(-1), { id: packet.id, error: { code: -32601, message: 'Chat tools are disabled' } });
});

for (const change of [raw => { raw.config.features.shell_tool = true; }, raw => { delete raw.config.features.plugins; },
  raw => { raw.config.project_doc_max_bytes = 32768; }]) test('安全配置未生效则拒绝启动，不向模型发送任何消息', async () => {
  const h = setup({ reply: p => { if (p.method !== 'config/read') return defaultReply(p); const raw = goodConfig(); change(raw); return { result: raw }; } });
  await assert.rejects(h.rpc.start(), { code: 'UNSAFE_CONFIG' });
  assert.deepEqual(h.child.kills, ['SIGKILL']); assert.equal(h.sent.some(p => p.method === 'thread/start'), false);
});

for (const change of [raw => { raw.sandbox.type = 'dangerFullAccess'; }, raw => { raw.sandbox.networkAccess = true; },
  raw => { raw.thread.environments = [{ id: 'local', cwd: '/Users/real/project' }]; },
  raw => { raw.thread.environments = null; }, raw => { delete raw.thread.environments; },
  raw => { raw.cwd = '/Users/real/project'; }, raw => { raw.instructionSources = ['/Users/real/AGENTS.md']; }]) test('thread返回实际权限或目录不符，禁止发turn', async t => {
  const h = setup({ reply: p => { if (p.method !== 'thread/start') return defaultReply(p); const raw = goodThread(); change(raw); return { result: raw }; } });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  await assert.rejects(h.rpc.startThread(), { code: 'UNSAFE_CONFIG' });
  await assert.rejects(h.rpc.startTurn(ID, 'hello'), { code: 'INVALID_INPUT' });
});

for (const bytes of [Buffer.from('{broken}\n'), Buffer.from('[]\n'), Buffer.from('x'.repeat(1025)), Buffer.from([0xff, 0x0a])]) {
  test(`损坏JSON、UTF8和超长帧有界关闭（${bytes.length}字节）`, async () => {
    const h = setup({ maxFrameBytes: 1024 }); await h.rpc.start(); h.child.stdout.write(bytes);
    assert.deepEqual(h.disconnects, ['INVALID_FRAME']); assert.deepEqual(h.child.kills, ['SIGKILL']);
  });
}

test('UTF8跨字节分片、多帧和空行正确解码', async t => {
  const h = setup(); t.after(() => h.rpc.close()); await connected(h);
  const raw = Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: ID, turnId: TURN, itemId: 'a', delta: '球球' } }) + '\n\n');
  const middle = raw.indexOf(Buffer.from('球')) + 1;
  h.child.stdout.write(raw.subarray(0, middle)); h.child.stdout.write(raw.subarray(middle));
  assert.equal(h.notifications[0].params.delta, '球球');
});

test('退出/关闭拒绝在途请求，stderr和晚到消息不进入回调，仅杀自身进程一次', async () => {
  for (const closeByUser of [false, true]) {
    const h = setup({ reply: p => p.method === 'account/read' ? undefined : defaultReply(p) }); await h.rpc.start();
    const pending = h.rpc.readAccount();
    h.child.stderr.write('SECRET_STDERR');
    if (closeByUser) h.rpc.close(); else h.child.emit('exit', 1);
    h.rpc.close(); await assert.rejects(pending, { code: closeByUser ? 'CLOSED' : 'DISCONNECTED' });
    await h.rpc.close();
    h.send({ method: 'item/agentMessage/delta', params: { threadId: ID, delta: 'SECRET' } });
    assert.equal(h.notifications.length, 0); assert.equal(h.child.kills.length, closeByUser ? 0 : 1);
    assert.equal(h.child.stdout.listenerCount('data'), 0); assert.equal(h.child.listenerCount('exit'), 0);
  }
});

test('关闭或启动超时发生于安装探测时，迟到探测不能拉起进程', async () => {
  let finish;
  const h = setup({ fakeFs: { promises: { lstat: () => new Promise(resolve => { finish = resolve; }), access: async () => {} } } });
  const pending = h.rpc.start(); h.rpc.close();
  finish({ isFile: () => true, isSymbolicLink: () => false });
  await assert.rejects(pending, { code: 'CLOSED' }); assert.equal(h.launches.length, 0);
});

test('真实子进程在无模型调用下完成stdio握手、分片账号读取和关闭', async () => {
  const config = goodConfig(); let owned;
  const rpc = createCodexChatRpc({ workspaceDir: '/tmp', timeoutMs: 2000,
    fs: { promises: { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }), access: async () => {} } },
    spawn: () => {
      owned = spawn(process.execPath, ['-e', `const r=require('readline').createInterface({input:process.stdin});r.on('line',line=>{const p=JSON.parse(line);if(p.id===undefined)return;const result=p.method==='config/read'?${JSON.stringify(config)}:p.method==='account/read'?{account:{type:'chatgpt',email:'测试@example.test'}}:{};const out=Buffer.from(JSON.stringify({id:p.id,result})+'\\n');process.stdout.write(out.subarray(0,5));setImmediate(()=>process.stdout.write(out.subarray(5)));});process.stderr.write('SECRET');`], { stdio: ['pipe', 'pipe', 'pipe'] });
      return owned;
    }
  });
  try { await rpc.start(); assert.match((await rpc.readAccount()).accountKey, /^[a-f0-9]{64}$/); }
  finally { await rpc.close(); }
});

test('正常关闭先发送EOF，等待自己进程退出，重复关闭复用完成Promise', async () => {
  const h = setup(); await connected(h);
  const closing = h.rpc.close();
  assert.equal(h.child.stdin.writableEnded, true);
  assert.equal(h.rpc.close(), closing);
  await closing;
  assert.deepEqual(h.child.kills, []);
  assert.deepEqual(h.disconnects, []);
});

test('另一个连接占用同对话时返回明确码，不新建或暴露服务端正文', async t => {
  const h = setup({ reply: p => p.method === 'thread/resume'
    ? { error: { code: -32600, message: `thread ${ID} already has an active writer SECRET` } } : defaultReply(p) });
  t.after(() => h.rpc.close());
  await h.rpc.start(); await h.rpc.readAccount();
  await assert.rejects(h.rpc.resumeThread(ID), { code: 'THREAD_BUSY', message: 'THREAD_BUSY' });
  assert.equal(h.sent.some(packet => packet.method === 'thread/start'), false);
});

test('模型目录只读分页，过滤隐藏项和不相关字段，不创建thread或模型轮次', async t => {
  const h = setup({ reply: p => p.method === 'model/list' ? { result: p.params.cursor
    ? { data: [goodModel('gpt-6-sol')], nextCursor: null }
    : { data: [goodModel(undefined, { credentials: 'SECRET', serviceTiers: ['SECRET'] }), goodModel('gpt-hidden', { hidden: true })], nextCursor: 'page-2' }
  } : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const catalog = await h.rpc.listModels();
  assert.deepEqual(catalog, ['gpt-6-luna', 'gpt-6-sol'].map(id => ({ id, displayName: id.toUpperCase(), description: '适合聊天', supportedReasoningEfforts: ['low', 'medium'], defaultReasoningEffort: 'medium', isDefault: false })));
  assert.equal(JSON.stringify(catalog).includes('SECRET'), false);
  assert.deepEqual(h.sent.filter(p => p.method === 'model/list').map(p => p.params), [
    { includeHidden: false, limit: 50 }, { includeHidden: false, limit: 50, cursor: 'page-2' }]);
  assert.equal(h.sent.some(p => p.method.startsWith('thread/') || p.method.startsWith('turn/')), false);
});

test('模型目录的并发读取合并，一次完成后显式读取会刷新', async t => {
  let reads = 0;
  const h = setup({ reply: p => p.method === 'model/list' ? (reads++, { result: { data: [goodModel()] } }) : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const [first, second] = await Promise.all([h.rpc.listModels(), h.rpc.listModels()]);
  assert.deepEqual(first, second); assert.equal(reads, 1);
  await h.rpc.listModels(); assert.equal(reads, 2);
});

test('同一thread切换目录内模型与支持的effort，保留其他隔离参数', async t => {
  const h = setup({ reply: p => p.method === 'model/list' ? { result: { data: [goodModel(), goodModel('gpt-6-sol', { model: 'gpt-6-sol-20260923' })] } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await connected(h); const catalog = await h.rpc.listModels();
  // Mutating the projected list cannot authorize an unsupported effort.
  catalog[0].supportedReasoningEfforts.push('xhigh');
  await assert.rejects(h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'xhigh' }), { code: 'MODEL_UNAVAILABLE' });
  await h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'low' });
  h.send({ method: 'turn/completed', params: { threadId: ID, turn: { id: TURN, status: 'completed' } } });
  await h.rpc.startTurn(ID, '比较一下', { model: 'gpt-6-sol', effort: 'medium' });
  const turns = h.sent.filter(p => p.method === 'turn/start');
  assert.deepEqual(turns.map(p => ({ threadId: p.params.threadId, model: p.params.model, effort: p.params.effort })), [
    { threadId: ID, model: 'gpt-6-luna', effort: 'low' }, { threadId: ID, model: 'gpt-6-sol-20260923', effort: 'medium' }]);
  assert.equal(h.sent.filter(p => p.method === 'thread/start').length, 1);
  for (const { params } of turns) { assert.deepEqual(params.environments, []); assert.deepEqual(params.outputSchema, CHAT_OUTPUT_SCHEMA); }
});

test('没有目录、恶意id、隐藏模型、未支持effort均在发送前拒绝', async t => {
  const h = setup({ reply: p => p.method === 'model/list' ? { result: { data: [goodModel(), goodModel('hidden-model', { hidden: true })] } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await connected(h);
  await assert.rejects(h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'low' }), { code: 'MODELS_UNAVAILABLE' });
  await h.rpc.listModels();
  for (const selection of [null, {}, { model: '../secret', effort: 'low' }, { model: '--config', effort: 'low' },
    { model: 'hidden-model', effort: 'low' }, { model: 'gpt-6-luna', effort: 'high' }, { model: 'gpt-6-luna', effort: null }]) {
    await assert.rejects(h.rpc.startTurn(ID, '你好', selection), { code: 'MODEL_UNAVAILABLE' });
  }
  assert.equal(h.sent.some(p => p.method === 'turn/start'), false);
});

test('刷新后过期模型不可发送，不替换为默认模型；刷新失败也不得用旧目录', async t => {
  let available = 'gpt-6-luna', fail = false;
  const h = setup({ reply: p => p.method === 'model/list' ? fail ? { error: { code: 500, message: 'SECRET' } } : { result: { data: [goodModel(available)] } } : defaultReply(p) });
  t.after(() => h.rpc.close()); await connected(h); await h.rpc.listModels();
  available = 'gpt-6-sol'; await h.rpc.listModels();
  await assert.rejects(h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'low' }), { code: 'MODEL_UNAVAILABLE' });
  fail = true;
  await assert.rejects(h.rpc.listModels(), { code: 'MODELS_UNAVAILABLE', message: 'MODELS_UNAVAILABLE' });
  await assert.rejects(h.rpc.startTurn(ID, '你好', { model: 'gpt-6-sol', effort: 'low' }), { code: 'MODELS_UNAVAILABLE' });
  assert.equal(h.sent.some(p => p.method === 'turn/start'), false);
});

for (const mode of ['cycle', 'pages', 'count', 'malformed', 'duplicate', 'empty']) test(`模型目录拒绝异常或无界分页：${mode}`, async t => {
  let page = 0;
  const h = setup({ reply: p => {
    if (p.method !== 'model/list') return defaultReply(p);
    page++;
    let data = [goodModel(`model-${page}`)], nextCursor = `cursor-${page}`;
    if (mode === 'cycle') nextCursor = 'same-cursor';
    if (mode === 'count') data = Array.from({ length: 50 }, (_, i) => goodModel(`model-${page}-${i}`));
    if (mode === 'malformed') data[0].supportedReasoningEfforts = [{ reasoningEffort: 'bad\nSECRET' }];
    if (mode === 'duplicate') data = [goodModel(), goodModel()];
    if (mode === 'empty') { data = []; nextCursor = null; }
    return { result: { data, nextCursor } };
  } });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  await assert.rejects(h.rpc.listModels(), { code: 'MODELS_UNAVAILABLE' });
  assert.ok(page <= 10);
  assert.equal(h.sent.some(p => p.method.startsWith('thread/') || p.method.startsWith('turn/')), false);
});

test('账号通知或身份切换使模型目录失效，晚到目录不能重新授权', async t => {
  let account = 'one@example.test', hold = false, waiting;
  const h = setup({ reply: p => {
    if (p.method === 'account/read') return { result: { account: { type: 'chatgpt', email: account } } };
    if (p.method === 'model/list') { if (hold) { waiting = p; return; } return { result: { data: [goodModel()] } }; }
    return defaultReply(p);
  } });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount(); await h.rpc.listModels();
  account = 'two@example.test'; await h.rpc.readAccount(); await h.rpc.startThread();
  await assert.rejects(h.rpc.startTurn(ID, '你好', { model: 'gpt-6-luna', effort: 'low' }), { code: 'MODELS_UNAVAILABLE' });
  hold = true;
  const listing = h.rpc.listModels();
  h.send({ method: 'account/updated', params: {} });
  h.send({ id: waiting.id, result: { data: [goodModel()] } });
  await assert.rejects(listing, { code: 'UNAUTHENTICATED' });
  assert.equal(h.sent.some(p => p.method === 'turn/start'), false);
});

test('目录请求超时不重发、不建会话且保持只读连接', async t => {
  const h = setup({ timeoutMs: 10, reply: p => p.method === 'model/list' ? undefined : defaultReply(p) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  await Promise.all([assert.rejects(h.rpc.listModels(), { code: 'MODELS_UNAVAILABLE' }),
    assert.rejects(h.rpc.listModels(), { code: 'MODELS_UNAVAILABLE' })]);
  assert.equal(h.sent.filter(p => p.method === 'model/list').length, 1);
  assert.deepEqual(h.child.kills, []);
  assert.equal(h.sent.some(p => p.method.startsWith('thread/') || p.method.startsWith('turn/')), false);
});
