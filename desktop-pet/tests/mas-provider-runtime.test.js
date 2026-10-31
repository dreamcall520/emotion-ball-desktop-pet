const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createDirectoryStorage, createDiagnosticDirectoryAccess } = require('../lib/mas-provider-runtime');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-provider-runtime-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const grants = path.join(temp, 'grants'), codex = path.join(temp, '.codex'), zcode = path.join(temp, '.zcode');
  fs.mkdirSync(codex); fs.mkdirSync(zcode);
  return { temp, grants, codex, zcode, storage: createDirectoryStorage(grants) };
}
function diagnostic(f, selected) {
  const dialogs = [];
  const access = createDiagnosticDirectoryAccess({ storage: f.storage,
    dialog: { showOpenDialog: async options => { dialogs.push(options); return typeof selected === 'function' ? selected() : selected; } } });
  return { access, dialogs };
}

test('目录授权原子替换且mode600，临时文件与旧授权在rename前保持完整', async t => {
  const f = fixture(t), before = { directory: '/synthetic/old', bookmark: 'old-fixture' };
  const after = { directory: '/synthetic/new', bookmark: 'new-fixture' };
  assert.equal(fs.statSync(f.grants).mode & 0o777, 0o700);
  await f.storage.save('codex', before);
  const destination = path.join(f.grants, 'codex.json');
  fs.chmodSync(destination, 0o666);
  const rename = fs.renameSync; let checked = false;
  fs.renameSync = function(source, target) {
    if (target === destination) {
      checked = true;
      assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), before);
      assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), after);
      assert.equal(fs.statSync(source).mode & 0o777, 0o600);
    }
    return rename.apply(this, arguments);
  };
  try { await f.storage.save('codex', after); } finally { fs.renameSync = rename; }
  assert.equal(checked, true);
  assert.deepEqual(await f.storage.load('codex'), after);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(f.grants), ['codex.json']);
});

test('持久化rename失败保留旧授权并清理本次tmp，不返回成功', async t => {
  const f = fixture(t), original = { directory: '/synthetic/old' };
  await f.storage.save('codex', original);
  const destination = path.join(f.grants, 'codex.json'), rename = fs.renameSync;
  fs.renameSync = function(source, target) {
    if (target === destination) throw Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' });
    return rename.apply(this, arguments);
  };
  try { await assert.rejects(f.storage.save('codex', { directory: '/synthetic/new' }), { code: 'ENOSPC' }); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(await f.storage.load('codex'), original);
  assert.deepEqual(fs.readdirSync(f.grants), ['codex.json']);
});

test('provider分别保存，撤销codex不修改zcode，未知provider不能越界', async t => {
  const f = fixture(t);
  await f.storage.save('codex', { directory: f.codex }); await f.storage.save('zcode', { directory: f.zcode });
  await f.storage.remove('codex');
  assert.equal(await f.storage.load('codex'), null);
  assert.deepEqual(await f.storage.load('zcode'), { directory: f.zcode });
  for (const provider of ['../outside', 'unsupported-provider', '', '__proto__']) {
    await assert.rejects(f.storage.save(provider, { directory: f.codex }));
    await assert.rejects(f.storage.load(provider)); await assert.rejects(f.storage.remove(provider));
  }
  assert.equal(fs.existsSync(path.join(f.temp, 'outside.json')), false);
  assert.deepEqual(fs.readdirSync(f.grants), ['zcode.json']);
});

test('存储拒绝超大、损坏JSON或符号链接授权文件', async t => {
  const f = fixture(t), file = path.join(f.grants, 'codex.json');
  fs.writeFileSync(file, '{'); await assert.rejects(f.storage.load('codex'), { code: 'GRANT_STORAGE_FAILED' });
  fs.writeFileSync(file, 'x'.repeat(262145)); await assert.rejects(f.storage.load('codex'), { code: 'GRANT_STORAGE_FAILED' });
  fs.unlinkSync(file);
  const outside = path.join(f.temp, 'unrelated.json'); fs.writeFileSync(outside, JSON.stringify({ bookmark: 'must-not-read' }));
  fs.symlinkSync(outside, file);
  await assert.rejects(f.storage.load('codex'), { code: 'GRANT_STORAGE_FAILED' });
});

test('诊断选择明确标识非沙盒验收，不申请bookmark也不隐式读取home', async t => {
  const f = fixture(t), { access, dialogs } = diagnostic(f, { canceled: false, filePaths: [f.codex] });
  assert.deepEqual(await access.authorize('codex'), { status: 'stored', directory: f.codex });
  const options = dialogs[0];
  assert.deepEqual(options.properties, ['openDirectory', 'showHiddenFiles']);
  assert.match(options.message, /不等同系统沙盒验收/);
  assert.equal(Object.hasOwn(options, 'securityScopedBookmarks'), false);
  assert.equal(Object.hasOwn(options, 'defaultPath'), false);
  assert.deepEqual(await f.storage.load('codex'), { kind: 'diagnostic-user-selected', directory: f.codex });
  assert.equal(Object.hasOwn(await f.storage.load('codex'), 'bookmark'), false);
  let received;
  assert.equal(await access.withAccess('codex', directory => { received = directory; return 'synthetic-only'; }), 'synthetic-only');
  assert.equal(received, f.codex);
  assert.equal(fs.existsSync(path.join(f.codex, 'auth.json')), false);
  const lease = await access.acquire('codex'); assert.equal(lease.directory, f.codex);
  lease.release(); lease.release();
});

test('取消保留旧诊断授权，非.codex与无效provider不覆盖授权', async t => {
  const f = fixture(t);
  const old = { kind: 'diagnostic-user-selected', directory: f.codex }; await f.storage.save('codex', old);
  let selection = { canceled: true, filePaths: [] };
  const { access, dialogs } = diagnostic(f, () => selection);
  assert.deepEqual(await access.authorize('codex'), { status: 'cancelled' });
  assert.deepEqual(await f.storage.load('codex'), old);
  selection = { canceled: false, filePaths: [f.zcode] };
  await assert.rejects(access.authorize('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.deepEqual(await f.storage.load('codex'), old);
  const before = dialogs.length;
  await assert.rejects(access.authorize('../codex'), { code: 'INVALID_PROVIDER' });
  assert.equal(dialogs.length, before);
});

test('诊断授权拒绝相对路径及名为.codex的普通文件，不能先保存误报成功', async t => {
  const f = fixture(t);
  const other = path.join(f.temp, 'file-selection'); fs.mkdirSync(other);
  const fakeDirectory = path.join(other, '.codex'); fs.writeFileSync(fakeDirectory, 'fixture-only');
  let selected = '.codex';
  const { access } = diagnostic(f, () => ({ canceled: false, filePaths: [selected] }));
  await assert.rejects(access.authorize('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  selected = fakeDirectory;
  await assert.rejects(access.authorize('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.equal(await f.storage.load('codex'), null);
});

test('MAS bookmark或未知kind不能冒充诊断授权，状态与实际访问结果一致', async t => {
  const f = fixture(t), { access } = diagnostic(f, { canceled: true });
  await f.storage.save('codex', { directory: f.codex, bookmark: 'synthetic-MAS-bookmark' });
  assert.deepEqual(await access.getStatus('codex'), { status: 'needs-authorization' });
  await assert.rejects(access.withAccess('codex', () => assert.fail('must not access')), { code: 'DIRECTORY_ACCESS_REQUIRED' });
});

test('撤销诊断codex授权不会影响zcode，下次访问不回落到home', async t => {
  const f = fixture(t);
  for (const [provider, directory] of [['codex', f.codex], ['zcode', f.zcode]]) {
    await f.storage.save(provider, { kind: 'diagnostic-user-selected', directory });
  }
  const { access, dialogs } = diagnostic(f, { canceled: true });
  assert.deepEqual(await access.revoke('codex'), { status: 'needs-authorization' });
  await assert.rejects(access.withAccess('codex', () => assert.fail('must not access')), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.equal(await access.withAccess('zcode', directory => directory), f.zcode);
  assert.equal(dialogs.length, 0);
});

async function runtimeChatFixture(t, overrides={}) {
  const { once } = require('node:events');
  const { WebSocketServer } = require('ws');
  const { createMasProviderRuntime } = require('../lib/mas-provider-runtime');
  const { createChatCompanion } = require('../lib/chat-companion');
  const { DISABLED_FEATURES } = require('../lib/codex-chat-rpc');
  const f = fixture(t), selections = [], servers = [], events = [];
  const workspaceDir = path.join(f.temp, 'chat-workspace');
  const runtime = createMasProviderRuntime({ app: { getPath: () => f.temp },
    dialog: { showOpenDialog: async () => {
      const value = selections.shift(); if (typeof value === 'function') return value();
      if (!value) throw new Error('No synthetic selection queued'); return value;
    } }, BrowserWindow: function() { throw new Error('Must not open website'); },
    session: { fromPartition: () => ({ getUserAgent: () => 'Synthetic runtime test', fetch: async () => { throw new Error('Must not request websites'); } }) },
    shell: { openExternal: async () => { throw new Error('Must not open external tools'); } },
    fetch: async () => { throw new Error('Must not query real quota'); }, createPluginHost:()=>({getStatus:()=>({known:true,installed:true,running:false}),isStopped:()=>true,waitUntilStopped:async()=>{},launch:async()=>{}}),diagnostic: true,...overrides });
  t.after(async () => { await runtime.close(); for (const server of servers) { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); } });
  selections.push({ canceled: false, filePaths: [f.codex] });
  await runtime.authorize('codex');
  async function service(name) {
    const token = 'synthetic-pairing-' + name + '-token-123456';
    const requests = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0,
      verifyClient: info => info.req.headers.authorization === `Bearer ${token}` });
    servers.push(server); await once(server, 'listening');
    const endpoint = `ws://127.0.0.1:${server.address().port}`;
    server.on('connection', socket => socket.on('message', data => {
      const packet = JSON.parse(data); requests.push(packet);
      if (!Object.hasOwn(packet, 'id')) return;
      let result = {};
      if (packet.method === 'config/read') result = { config: { features: Object.fromEntries(DISABLED_FEATURES.map(key => [key, false])),
        web_search: 'disabled', project_doc_max_bytes: 0, mcp_servers: {} } };
      if (packet.method === 'account/read') result = { account: { type: 'chatgpt', email: 'same-fixture@example.invalid' } };
      if (packet.method === 'model/list') result = { data: [{ id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: name, description: 'Synthetic only', hidden: false,
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true }], nextCursor: null };
      if (['thread/start', 'thread/resume'].includes(packet.method)) result = {
        thread: { id: 'synthetic-runtime-thread', environments: [], status: { type: 'idle' }, turns: [] },
        cwd: workspaceDir, approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [] };
      if (packet.method === 'turn/start') {
        const threadId = packet.params.threadId, id = 'synthetic-turn-' + name + '-' + requests.length;
        socket.send(JSON.stringify({ method: 'item/completed', params: { threadId, turnId: id,
          item: { id: 'synthetic-item', type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ text: name + ' fixture reply', action: 'none' }) } } }));
        socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } }));
        result = { turn: { id, status: 'inProgress' } };
      }
      socket.send(JSON.stringify({ id: packet.id, result }));
    }));
    const directory = path.join(f.temp, 'pairing-' + name); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'pairing.json'), JSON.stringify({ version: 1, endpoint, bearerToken: token, hostHome: f.temp }), { mode: 0o600 });
    return { directory, endpoint, server, requests };
  }
  async function selectService(value) {
    selections.push({ canceled: false, filePaths: [value.directory] }); return runtime.importCodexService();
  }
  function companion() {
    let saved = require('../lib/chat-store').emptyRecord();
    const chat = createChatCompanion({ workspaceDir,
      store: { read: () => saved, write: record => { saved = structuredClone(record); } },
      createRpc: options => runtime.createCodexChatRpc({ ...options, env: {} }), onChange: state => events.push(state) });
    t.after(() => chat.close()); return chat;
  }
  async function authorizeZcode() {
    selections.push({ canceled: false, filePaths: [f.zcode] });
    await runtime.authorize('zcode');
  }
  async function zcodeService(name, { modelsError } = {}) {
    const { startZcodeLocalChatService } = require('../scripts/start-zcode-local-chat-service');
    const calls = [];
    const host = await startZcodeLocalChatService({ temporaryRoot: f.temp, hostHome: f.temp, env: {},
      createRpc: context => ({ start: async () => {}, close: async () => { calls.push(['close']); },
        readAccount: async () => ({ authenticated: true, accountKey: 'b'.repeat(64) }),
        listModels: async () => {
          calls.push(['models']);
          if (modelsError) throw Object.assign(new Error('synthetic private host error'), { code: modelsError });
          return [{ id: 'zcode-fixture-model', displayName: name, defaultReasoningEffort: 'none', supportedReasoningEfforts: ['none'], isDefault: true }];
        },
        startThread: async () => { calls.push(['create']); return { id: 'zcode-fixture-thread', status: 'idle', activeTurnId: null }; },
        resumeThread: async id => { calls.push(['resume', id]); return { id, status: 'idle', activeTurnId: null }; },
        startTurn: async (id, text, selection) => {
          calls.push(['turn', id, text, selection]);
          const turnId = 'zcode-fixture-turn-' + calls.length;
          context.onNotification({ method: 'turn/started', params: { threadId: id, turn: { id: turnId, status: 'inProgress' } } });
          context.onNotification({ method: 'item/agentMessage/delta', params: { threadId: id, turnId, itemId: 'zcode-fixture-item', delta: name + ' synthetic delta' } });
          context.onNotification({ method: 'turn/completed', params: { threadId: id, turn: { id: turnId, status: 'completed' } } });
          return { id: turnId, status: 'inProgress' };
        },
        interruptTurn: async (id, turnId) => { calls.push(['interrupt', id, turnId]); }
      }) });
    t.after(() => host.stop());
    return { ...host, directory: host.pairingDirectory, calls };
  }
  async function selectZcodeService(value) {
    selections.push({ canceled: false, filePaths: [value.directory] }); return runtime.importZcodeService();
  }
  return { ...f, runtime, service, selectService, selections, companion, events, workspaceDir,
    authorizeZcode, zcodeService, selectZcodeService };
}

test('重新导入本机服务会失效整个聊天client，下一轮重读模型并resume原会话', async t => {
  const f = await runtimeChatFixture(t), first = await f.service('first'), second = await f.service('second');
  await f.selectService(first);
  const chat = f.companion();
  await chat.send('first message');
  assert.equal(chat.getState().messages.at(-1).text, 'first fixture reply');
  assert.equal(chat.getState().models[0].displayName, 'first');
  const firstClosed = require('node:events').once([...first.server.clients][0], 'close');
  await f.selectService(second); await firstClosed;
  assert.equal(chat.getState().connection, 'error');
  assert.equal(first.server.clients.size, 0);
  await chat.send('second message');
  assert.equal(chat.getState().messages.at(-1).text, 'second fixture reply');
  assert.equal(chat.getState().models[0].displayName, 'second');
  assert.equal(first.requests.filter(packet => packet.method === 'thread/start').length, 1);
  assert.equal(second.requests.filter(packet => packet.method === 'thread/start').length, 0);
  assert.equal(second.requests.filter(packet => packet.method === 'thread/resume').length, 1);
  assert.equal(second.requests.filter(packet => packet.method === 'model/list').length, 1);
  assert.equal(chat.getState().messages.filter(message => message.role === 'user').length, 2);
});

test('撤销Codex目录同时失效配对和旧socket；旧facade及后续连接不能继续使用', async t => {
  const f = await runtimeChatFixture(t), service = await f.service('revoke'), disconnects = [];
  await f.selectService(service);
  const rpc = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {}, onDisconnect: code => disconnects.push(code) });
  await rpc.start(); await rpc.readAccount();
  const disconnected = require('node:events').once([...service.server.clients][0], 'close');
  await f.runtime.revoke('codex'); await disconnected;
  assert.deepEqual(disconnects, ['DISCONNECTED']); assert.equal(service.server.clients.size, 0);
  await assert.rejects(rpc.readAccount(), { code: 'CLOSED' });
  const state = await f.runtime.getState(); assert.equal(state.codex.serviceConfigured, false); assert.equal(state.codex.directory, 'needs-authorization');
  const other = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {} });
  await assert.rejects(other.start(), { code: 'MISSING' }); await other.close();
});

test('取消或无效导入保留当前已连接的facade与配对，不发伪断开通知', async t => {
  const f = await runtimeChatFixture(t), service = await f.service('unchanged'), disconnects = [];
  await f.selectService(service);
  const rpc = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {}, onDisconnect: code => disconnects.push(code) });
  await rpc.start();
  f.selections.push({ canceled: true }); assert.deepEqual(await f.runtime.importCodexService(), { status: 'cancelled' });
  const invalid = path.join(f.temp, 'invalid-pairing'); fs.mkdirSync(invalid); fs.writeFileSync(path.join(invalid, 'pairing.json'), '{}');
  f.selections.push({ canceled: false, filePaths: [invalid] });
  await assert.rejects(f.runtime.importCodexService(), { code: 'INVALID_PAIRING_FILE' });
  assert.equal((await rpc.readAccount()).authenticated, true);
  assert.deepEqual(disconnects, []); assert.equal(service.server.clients.size, 1);
  await rpc.close();
});

test('runtime关闭会释放聊天socket且无伪错误通知，关闭后不能继续创建或使用client', async t => {
  const f = await runtimeChatFixture(t), service = await f.service('close'), disconnects = [];
  await f.selectService(service);
  const rpc = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {}, onDisconnect: code => disconnects.push(code) });
  await rpc.start();
  const disconnected = require('node:events').once([...service.server.clients][0], 'close');
  await f.runtime.close(); await disconnected;
  assert.deepEqual(disconnects, []); assert.equal(service.server.clients.size, 0);
  await assert.rejects(rpc.readAccount(), { code: 'CLOSED' });
  assert.throws(() => f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {} }), { code: 'CLOSED' });
  await rpc.close();
});

test('runtime已关闭时迟到的目录选择结果不能恢复服务', async t => {
  const f = await runtimeChatFixture(t), service = await f.service('late');
  let finishSelection;
  f.selections.push(() => new Promise(resolve => { finishSelection = resolve; }));
  const importing = f.runtime.importCodexService();
  while (!finishSelection) await new Promise(resolve => setImmediate(resolve));
  await f.runtime.close(); finishSelection({ canceled: false, filePaths: [service.directory] });
  await assert.rejects(importing, { code: 'CLOSED' });
  assert.equal((await f.runtime.getState()).codex.serviceConfigured, false);
});

test('ZCode必须有自己的目录授权，配对provider与路径严格检查，不能混用Codex文件', async t => {
  const f = await runtimeChatFixture(t), codex = await f.service('codex-provider'), zcode = await f.zcodeService('zcode-provider');
  await assert.rejects(f.runtime.importZcodeService(), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  await f.authorizeZcode();
  await assert.rejects(f.selectZcodeService(codex), { code: 'INVALID_PAIRING_FILE' });
  await assert.rejects(f.selectService(zcode), { code: 'INVALID_PAIRING_FILE' });
  const pairing = JSON.parse(fs.readFileSync(zcode.pairingFile, 'utf8'));
  const original = { ...pairing };
  for (const change of [value => { delete value.provider; }, value => { value.provider = 'codex'; },
    value => { value.provider = 'workbuddy'; }, value => { value.hostHome = f.temp + '/foreign'; },
    value => { value.endpoint = value.endpoint.replace('/zcode', '/'); }]) {
    const changed = { ...original }; change(changed);
    fs.writeFileSync(zcode.pairingFile, JSON.stringify(changed));
    await assert.rejects(f.selectZcodeService(zcode), { code: 'INVALID_PAIRING_FILE' });
  }
  fs.writeFileSync(zcode.pairingFile, JSON.stringify(original));
  await f.selectZcodeService(zcode);
  const state = await f.runtime.getState();
  assert.equal(state.zcode.serviceConfigured, true);
  assert.equal(state.zcode.chat, 'experimental-configured-unverified');
  assert.equal(state.zcode.publicApiContractVerified, false);
  assert.equal(JSON.stringify(state).includes(original.bearerToken), false);
  assert.equal(state.codex.serviceConfigured, false);
});

test('ZCode facade经真实合成host转发账号/模型/会话/流式与中断，不调用真实工具', async t => {
  const f = await runtimeChatFixture(t), host = await f.zcodeService('runtime-zcode'), notifications = [];
  await f.authorizeZcode(); await f.selectZcodeService(host);
  const rpc = f.runtime.createZcodeChatRpc({ timeoutMs: 1000, onNotification: packet => notifications.push(packet) });
  await rpc.start();
  assert.deepEqual(await rpc.readAccount(), { authenticated: true, accountKey: 'b'.repeat(64) });
  assert.equal((await rpc.listModels())[0].displayName, 'runtime-zcode');
  const thread = await rpc.startThread();
  const turn = await rpc.startTurn(thread.id, 'synthetic request only', { model: 'zcode-fixture-model', effort: 'none' });
  assert.equal(turn.id.startsWith('zcode-fixture-turn-'), true);
  assert.equal(notifications.find(packet => packet.method === 'item/agentMessage/delta').params.delta, 'runtime-zcode synthetic delta');
  await rpc.interruptTurn(thread.id, turn.id);
  assert.equal(host.calls.filter(call => call[0] === 'turn').length, 1);
  assert.deepEqual(host.calls.at(-1), ['interrupt', thread.id, turn.id]);
  await assert.rejects(rpc.verifyThreadEnvironment(thread.id), { code: 'UNSUPPORTED' });
  await rpc.close();
});

test('ZCode空额度对应模型不可用保持原错误，不制造模型或改走付费API', async t => {
  const f = await runtimeChatFixture(t), host = await f.zcodeService('no-models', { modelsError: 'MODELS_UNAVAILABLE' });
  await f.authorizeZcode(); await f.selectZcodeService(host);
  const rpc = f.runtime.createZcodeChatRpc({ timeoutMs: 1000 });
  await rpc.start(); assert.equal((await rpc.readAccount()).authenticated, true);
  await assert.rejects(rpc.listModels(), { code: 'MODELS_UNAVAILABLE', message: 'MODELS_UNAVAILABLE' });
  assert.equal(host.calls.some(call => call[0] === 'turn'), false);
  await rpc.close();
});

test('ZCode重新导入与撤销只失效自己的client，Codex配对和连接不受影响', async t => {
  const f = await runtimeChatFixture(t), codex = await f.service('independent-codex');
  const first = await f.zcodeService('zcode-first'), second = await f.zcodeService('zcode-second');
  await f.selectService(codex); await f.authorizeZcode(); await f.selectZcodeService(first);
  const codexDisconnects = [], zcodeDisconnects = [];
  const c = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {}, onDisconnect: code => codexDisconnects.push(code) });
  const z = f.runtime.createZcodeChatRpc({ timeoutMs: 1000, onDisconnect: code => zcodeDisconnects.push(code) });
  await c.start(); await z.start();
  await f.selectZcodeService(second);
  assert.deepEqual(zcodeDisconnects, ['DISCONNECTED']); assert.deepEqual(codexDisconnects, []);
  await assert.rejects(z.readAccount(), { code: 'CLOSED' });
  assert.equal((await c.readAccount()).authenticated, true);
  const next = f.runtime.createZcodeChatRpc({ timeoutMs: 1000, onDisconnect: code => zcodeDisconnects.push(code) });
  await next.start(); assert.equal((await next.listModels())[0].displayName, 'zcode-second');
  await f.runtime.revoke('zcode');
  assert.deepEqual(zcodeDisconnects, ['DISCONNECTED', 'DISCONNECTED']);
  await assert.rejects(next.readAccount(), { code: 'CLOSED' });
  assert.equal((await c.readAccount()).authenticated, true);
  const state = await f.runtime.getState();
  assert.equal(state.zcode.serviceConfigured, false); assert.equal(state.zcode.directory, 'needs-authorization');
  assert.equal(state.codex.serviceConfigured, true); assert.deepEqual(codexDisconnects, []);
  const missing = f.runtime.createZcodeChatRpc(); await assert.rejects(missing.start(), { code: 'MISSING' });
  await missing.close(); await c.close();
});

test('取消ZCode导入保留原连接；runtime关闭释放两家client但不停止外部host', async t => {
  const f = await runtimeChatFixture(t), codex = await f.service('close-both-codex'), zcode = await f.zcodeService('close-both-zcode');
  await f.selectService(codex); await f.authorizeZcode(); await f.selectZcodeService(zcode);
  const c = f.runtime.createCodexChatRpc({ workspaceDir: f.workspaceDir, env: {} }), z = f.runtime.createZcodeChatRpc({ timeoutMs: 1000 });
  await c.start(); await z.start();
  f.selections.push({ canceled: true }); assert.deepEqual(await f.runtime.importZcodeService(), { status: 'cancelled' });
  assert.equal((await z.readAccount()).authenticated, true);
  const closing = f.runtime.close(); assert.equal(f.runtime.close(), closing); await closing;
  await assert.rejects(c.readAccount(), { code: 'CLOSED' }); await assert.rejects(z.readAccount(), { code: 'CLOSED' });
  assert.equal((await fetch(`http://127.0.0.1:${zcode.port}/readyz`)).status, 200);
  assert.equal(codex.server.address().port > 0, true);
});

test('个人CLI配对仅接受loopback且不向renderer输出口令或工作区',async t=>{
 const f=await runtimeChatFixture(t),directory=path.join(f.temp,'workbuddy-cli-pairing');fs.mkdirSync(directory);
 const raw={version:1,provider:'workbuddy-cli',endpoint:'http://127.0.0.1:45678',password:'syntheticGatewayPassword'.repeat(2),workspaceDir:path.join(f.temp,'isolated-cli'),cliVersion:'2.179.0'};
 fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify(raw));f.selections.push({canceled:false,filePaths:[directory]});
 assert.deepEqual(await f.runtime.importWorkbuddyCliService(),{status:'configured'});const state=await f.runtime.getState();
 assert.equal(state.workbuddyCli.configured,true);assert.equal(state.workbuddyCli.connected,false);assert.equal(state.workbuddyCli.desktopTasksIncluded,false);
 assert.equal(JSON.stringify(state).includes(raw.password),false);assert.equal(JSON.stringify(state.workbuddyCli).includes(raw.workspaceDir),false);
 fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify({...raw,endpoint:'https://example.com'}));f.selections.push({canceled:false,filePaths:[directory]});
 await assert.rejects(f.runtime.importWorkbuddyCliService(),{code:'INVALID_PAIRING_FILE'});
 assert.equal((await f.runtime.getState()).workbuddyCli.configured,true);
});

test('CLI配对文件符号链接拒绝，取消保持已有状态',async t=>{
 const f=await runtimeChatFixture(t),directory=path.join(f.temp,'link-cli-pairing');fs.mkdirSync(directory);const outside=path.join(f.temp,'outside-cli.json');fs.writeFileSync(outside,'{}');fs.symlinkSync(outside,path.join(directory,'connection.json'));
 f.selections.push({canceled:false,filePaths:[directory]});await assert.rejects(f.runtime.importWorkbuddyCliService(),{code:'INVALID_PAIRING_FILE'});
 f.selections.push({canceled:true});assert.deepEqual(await f.runtime.importWorkbuddyCliService(),{status:'cancelled'});assert.equal((await f.runtime.getState()).workbuddyCli.configured,false);
});

test('启用恢复先验证已有授权，取消不读数据，失效授权非交互不弹框',async t=>{
 const f=await runtimeChatFixture(t);
 assert.deepEqual(await f.runtime.ensureDirectory('codex',{interactive:false}),{status:'stored'});
 await f.runtime.revoke('codex');
 assert.deepEqual(await f.runtime.ensureDirectory('codex',{interactive:false}),{status:'needs-authorization'});
 f.selections.push({canceled:true});assert.deepEqual(await f.runtime.ensureDirectory('codex'),{status:'cancelled'});
});
test('聊天来源显式选择保存独立偏好，官方不回落到上次自定义来源',async t=>{
 const f=await runtimeChatFixture(t);
 await f.runtime.setZcodeAccountSource('configured-custom');
 assert.equal((await f.runtime.getState()).zcode.accountSource,'configured-custom');
 await f.runtime.setZcodeAccountSource('official');
 assert.equal((await f.runtime.getState()).zcode.accountSource,'official');
 const result=await f.runtime.prepareChat('zcode',{interactive:false});
 assert.equal(result.status,'unavailable');
 assert.equal((await f.runtime.getState()).zcode.accountSource,'official');
 await assert.rejects(f.runtime.setZcodeAccountSource('unknown'),{code:'INVALID_INPUT'});
});

test('受管理WorkBuddy重启只查已有身份，后台不发登录也不打开浏览器',async t=>{
 let starts=0,auth=0;const f=await runtimeChatFixture(t,{startWorkbuddyHost:async()=>{starts++;return{endpoint:'http://127.0.0.1:45678',gatewayPassword:'syntheticGatewayPassword'.repeat(2),workspaceDir:'/synthetic/workspace',cliVersion:'2.179.0',stop:async()=>{}};},createWorkbuddyAuthClient:()=>({connect:async()=>{},getVendorAccount:async()=>({authenticated:false}),authenticate:async()=>{auth++;},close:async()=>{}})});
 const result=await f.runtime.prepareWorkbuddyChat({interactive:false});assert.equal(result.status,'needs-login');assert.equal(auth,0);assert.equal(starts,1);
});
test('已登录托管WorkBuddy只恢复身份，不强制登出再登录；旧host退出不清新连接',async t=>{
 const exits=[];let starts=0,auth=0;const f=await runtimeChatFixture(t,{startWorkbuddyHost:async options=>{starts++;exits.push(options.onExit);return{endpoint:'http://127.0.0.1:45678',gatewayPassword:'syntheticGatewayPassword'.repeat(2),workspaceDir:'/synthetic/workspace',cliVersion:'2.179.0',stop:async()=>{}};},createWorkbuddyAuthClient:()=>({connect:async()=>{},getVendorAccount:async()=>({authenticated:true}),authenticate:async()=>auth++,close:async()=>{}})});
 assert.equal((await f.runtime.prepareWorkbuddyChat({interactive:false})).status,'ready');assert.equal(auth,0);
 await f.runtime.disconnectWorkbuddyChat();assert.equal((await f.runtime.prepareWorkbuddyChat({interactive:false})).status,'ready');exits[0]();assert.equal((await f.runtime.getState()).workbuddyCli.configured,true);assert.equal(starts,2);
 exits[1]();assert.equal((await f.runtime.getState()).workbuddyCli.configured,false);
});
test('撤销期间迟到的WorkBuddy官方登录成功不能自动恢复或打开新页面',async t=>{
 let finishAuth,authenticated=false,opened=0,recovered=0;
 const f=await runtimeChatFixture(t,{onManagedReady:()=>recovered++,shell:{openExternal:async()=>{opened++;}},startWorkbuddyHost:async()=>({endpoint:'http://127.0.0.1:45678',gatewayPassword:'syntheticGatewayPassword'.repeat(2),workspaceDir:'/synthetic/workspace',cliVersion:'2.179.0',stop:async()=>{}}),createWorkbuddyAuthClient:()=>({connect:async()=>{},getVendorAccount:async()=>({authenticated}),authenticate:async({onAuthUrl})=>{await onAuthUrl('https://copilot.tencent.com/synthetic-login');await new Promise(r=>finishAuth=r);authenticated=true;},close:async()=>{finishAuth?.();}})});
 assert.equal((await f.runtime.prepareWorkbuddyChat({interactive:true})).status,'needs-login');
 await f.runtime.disconnectWorkbuddyChat();await new Promise(r=>setImmediate(r));
 assert.equal(opened,1);assert.equal(recovered,0);assert.equal((await f.runtime.getState()).workbuddyCli.configured,false);
});

test('原只读用途不默认具有插件安装许可，明确批准后复用同一技术书签不再选目录',async t=>{const installerCalls=[];const f=await runtimeChatFixture(t,{createPluginInstaller:options=>({getState:()=>({status:installerCalls.some(c=>c.provider===options.provider)?'installed-configured':'idle',enabled:true}),install:async value=>{installerCalls.push({provider:options.provider,approved:value.approved});return options.directoryAccess.withAccess(options.provider,async dir=>{assert.equal(path.basename(dir),'.zcode');return{status:'installed',enabled:true};});}})});await f.authorizeZcode();assert.deepEqual(await f.runtime.getPluginAuthorizationStatus('zcode'),{status:'needs-authorization'});await assert.rejects(f.runtime.installProviderPlugin('zcode'),{code:'CONSENT_REQUIRED'});assert.deepEqual(installerCalls,[]);const dialogsBefore=f.selections.length;const result=await f.runtime.installProviderPlugin('zcode',{approved:true});assert.equal(result.status,'installed');assert.equal(f.selections.length,dialogsBefore);assert.deepEqual(installerCalls,[{provider:'zcode',approved:true}]);assert.deepEqual(await f.runtime.getPluginAuthorizationStatus('zcode'),{status:'stored'});await f.runtime.revoke('zcode');assert.deepEqual(await f.runtime.getPluginAuthorizationStatus('zcode'),{status:'needs-authorization'});});

test('退出终止未提交安装并等待其释放，不发布迟到安装成功',async t=>{let started;const ready=new Promise(r=>started=r);let installed=false;const f=await runtimeChatFixture(t,{createPluginInstaller:()=>({getState:()=>({status:'idle'}),install:({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{code:'CANCELLED'})),{once:true});}).then(()=>{installed=true;})})});await f.authorizeZcode();const pending=f.runtime.installProviderPlugin('zcode',{approved:true});await ready;const rejected=assert.rejects(pending,{code:'CANCELLED'});await f.runtime.close();await rejected;assert.equal(installed,false);});

test('同一tick关闭不会让安装microtask弹授权或保存写用途',async t=>{let installs=0;const f=await runtimeChatFixture(t,{createPluginInstaller:()=>({getState:()=>({status:'idle'}),install:async()=>{installs++;}})});const pending=f.runtime.installProviderPlugin('zcode',{approved:true});const rejected=assert.rejects(pending,{code:'CANCELLED'});await f.runtime.close();await rejected;assert.equal(installs,0);assert.deepEqual(await f.runtime.getPluginAuthorizationStatus('zcode'),{status:'needs-authorization'});});

test('安装目录选择迟到确认不能在退出后保留新写用途',async t=>{let selected;const f=await runtimeChatFixture(t,{createPluginInstaller:()=>({getState:()=>({status:'idle'}),install:async()=>assert.fail('must not install after close')})});f.selections.push(()=>new Promise(resolve=>selected=resolve));const pending=f.runtime.installProviderPlugin('zcode',{approved:true});const rejected=assert.rejects(pending,{code:'CANCELLED'});for(let i=0;i<20&&!selected;i++)await new Promise(r=>setImmediate(r));assert.equal(typeof selected,'function');const closing=f.runtime.close();selected({canceled:false,filePaths:[f.zcode]});await rejected;await closing;assert.deepEqual(await f.runtime.getPluginAuthorizationStatus('zcode'),{status:'needs-authorization'});});

test('原工具运行时只等待本人退出，可取消且不会提前写插件',async t=>{let waiting,installed=0,launched=0;const waitingNow=new Promise(r=>waiting=r);const f=await runtimeChatFixture(t,{createPluginHost:()=>({getStatus:()=>({known:true,installed:true,running:true}),isStopped:()=>false,waitUntilStopped:(_p,{signal})=>new Promise((resolve,reject)=>{waiting();signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancel'),{code:'CANCELLED'})),{once:true});}),launch:()=>{launched++;}}),createPluginInstaller:()=>({getState:()=>({status:'idle'}),install:async()=>{installed++;}})});await f.authorizeZcode();const pending=f.runtime.installProviderPlugin('zcode',{approved:true});const rejected=assert.rejects(pending,{code:'CANCELLED'});await waitingNow;const state=await f.runtime.getState();assert.equal(state.pluginInstallations.zcode.phase,'waiting-host');assert.match(state.pluginInstallations.zcode.message,/退出/);assert.equal(installed,0);await f.runtime.cancelPluginInstallation('zcode');await rejected;assert.equal(installed,0);assert.equal(launched,0);});

test('本人退出后自动完成安装，并请求恢复原先运行的工具，不自动发送任务',async t=>{let stopped=false,release,launched=0,done=false;const f=await runtimeChatFixture(t,{createPluginHost:()=>({getStatus:()=>({known:true,installed:true,running:!stopped}),isStopped:()=>stopped,waitUntilStopped:()=>new Promise(resolve=>release=()=>{stopped=true;resolve();}),launch:()=>{launched++;return{requested:true};}}),createPluginInstaller:options=>({getState:()=>({status:done?'installed-configured':'idle',enabled:done}),install:async()=>{assert.equal(await options.assertHostStopped(),true);done=true;}})});await f.authorizeZcode();const pending=f.runtime.installProviderPlugin('zcode',{approved:true});for(let i=0;i<20&&!release;i++)await new Promise(r=>setImmediate(r));assert.equal(done,false);release();const result=await pending;assert.equal(result.status,'installed');assert.equal(done,true);assert.equal(launched,1);});

test('非诊断MAS构建自动安装先被审核门禁拒绝，不弹授权或写目录',async t=>{const f=fixture(t),{createMasProviderRuntime}=require('../lib/mas-provider-runtime');let dialogs=0,installs=0;const runtime=createMasProviderRuntime({app:{getPath:()=>f.temp,startAccessingSecurityScopedResource:()=>{throw Error('must not acquire');}},dialog:{showOpenDialog:async()=>{dialogs++;throw Error('must not open');}},BrowserWindow:function(){throw Error('must not open website');},session:{fromPartition:()=>({getUserAgent:()=> 'Synthetic policy test',fetch:async()=>{throw Error('must not fetch');}})},shell:{openExternal:async()=>{throw Error('must not launch');}},diagnostic:false,createPluginInstaller:()=>({getState:()=>({status:'idle'}),install:async()=>{installs++;}}),createPluginHost:()=>({getStatus:()=>{throw Error('must not inspect host');}})});t.after(()=>runtime.close());await assert.rejects(runtime.installProviderPlugin('zcode',{approved:true}),{code:'AUTO_INSTALL_STORE_REVIEW_REQUIRED'});assert.equal(runtime.getPluginInstallationPolicy().allowed,false);assert.equal(dialogs,0);assert.equal(installs,0);});
