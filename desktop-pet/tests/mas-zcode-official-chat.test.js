'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { createMasZcodeOfficialChatRpc } = require('../lib/mas-zcode-official-chat');
const { createOfficialChatSession } = require('../lib/zcode-official-chat-helper.cjs');
const { projectResult, projectNotification } = require('../lib/zcode-official-chat-wire');
const { createOfficialFetch } = require('../lib/zcode-helper.cjs');
const accountKey = 'a'.repeat(64);
test('official async scope acquisition integrates with the real synchronous ChatCompanion client contract', async () => {
  const {createMasZcodeOfficialChatClient}=require('../lib/mas-zcode-official-chat');
  const {createChatCompanion}=require('../lib/chat-companion');let closed=0;
  const rpc={start:async()=>{},readAccount:async()=>({authenticated:true,accountKey}),
    listModels:async()=>[{id:'glm-5.3',displayName:'GLM-5.3',supportedReasoningEfforts:['none'],defaultReasoningEffort:'none',isDefault:true}],close:async()=>{closed++;}};
  const chat=createChatCompanion({store:{read:()=>null,write(){}},workspaceDir:'/unused',
    createRpc:options=>createMasZcodeOfficialChatClient(options,{createRpc:async()=>{await tick();return rpc;}})});
  await chat.connect();assert.equal(chat.getState().connection,'ready');assert.equal(chat.getState().modelsStatus,'ready');
  await chat.close();assert.equal(closed,1);
});
test('closing the immediate client during async acquisition retires the late original process without starting it',async()=>{
  const {createMasZcodeOfficialChatClient}=require('../lib/mas-zcode-official-chat');let release,started=0,closed=0;
  const client=createMasZcodeOfficialChatClient({}, {createRpc:()=>new Promise(resolve=>{release=resolve;})});
  const starting=client.start(),rejected=assert.rejects(starting,{code:'CLOSED'});await tick();const closing=client.close();
  const late={start:async()=>{started++;},close:async()=>{closed++;}};release(late);await rejected;await closing;
  assert.equal(started,0);assert(closed>=1);await assert.rejects(client.readAccount(),{code:'CLOSED'});
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'zcode-official-bridge-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'ZCode.app'), directory = path.join(root, 'account/.zcode'), workspaceDir = path.join(root, 'container/chat');
  for (const name of ['Contents/MacOS/ZCode', 'Contents/Resources/glm/zcode.cjs', 'Contents/Resources/app.asar',
    'Contents/Resources/config/provider/zcode-builtin.json', 'Contents/Info.plist']) {
    const file = path.join(app, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, name.endsWith('plist') ? '<key>CFBundleShortVersionString</key><string>3.18.2</string>' :
      name.endsWith('json') ? JSON.stringify({ revision: 1, config: { providerConfigRules: { providerRules: [
        { providerId: 'account:zai-start-plan', config: { api: { baseUrl: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic' } } }
      ] } } }) : 'synthetic, never executed', { mode: 0o700 });
  }
  await fs.mkdir(directory, { recursive: true }); await fs.mkdir(workspaceDir, { recursive: true });
  let consent = accountKey, epoch = 0, current = true;
  const events = [], requests = [], child = new EventEmitter(); child.pid = 42;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { events.push('kill'); };
  const send = value => child.stdout.write(JSON.stringify(value) + '\n');
  let input = ''; child.stdin.on('data', chunk => { input += chunk; let end;
    while ((end = input.indexOf('\n')) >= 0) { const value = JSON.parse(input.slice(0, end)); input = input.slice(end + 1); requests.push(value);
      if (value.method === 'initialize') queueMicrotask(() => send({ id: value.id, result: null })); }
  });
  const grant = (name, selected) => ({ acquire: async () => { events.push('acquire:' + name); return {
    directory: selected, isCurrent: () => current, release: () => events.push('release:' + name) }; } });
  let spawned;
  const options = { installedAppAccess: grant('app', app), directoryAccess: grant('account', directory), workspaceDir,
    expectedAccountKey: accountKey, getAuthorizedAccountKey: () => consent, getChatGrantEpoch: () => epoch,
    spawnProcess: (...args) => { spawned = args; return child; }, closeTimeoutMs: 10 };
  return { app, directory, workspaceDir, events, requests, options, child, send, spawned: () => spawned,
    revoke: () => { consent = null; epoch++; }, changeEpoch: () => { epoch++; }, changeGrant: () => { current = false; },
    finish: () => { child.emit('close', 0); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('adapter pins original executable and both grants; environment and results contain no credentials', async t => {
  const f = await fixture(t), rpc = await createMasZcodeOfficialChatRpc({ ...f.options,
    env: { NODE_OPTIONS: 'private', ZCODE_CREDENTIAL_SECRET: 'private', OPENAI_API_KEY: 'private', HTTPS_PROXY: 'https://proxy.invalid' } });
  assert.equal(f.spawned()[0], path.join(f.app, 'Contents/MacOS/ZCode'));
  assert.equal(f.spawned()[1][0].endsWith('/zcode-official-chat-helper.cjs'), true);
  const env = f.spawned()[2].env; assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.ZCODE_CREDENTIAL_SECRET, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, 'https://proxy.invalid');
  const pending = rpc.readAccount(); await tick(); const request = f.requests.at(-1);
  f.send({ id: request.id, result: { authenticated: true, accountKey, accessToken: 'private', accountId: 'private' } });
  assert.deepEqual(await pending, { authenticated: true, accountKey });
  for (const name of ['request', 'logout', 'setApiKey', 'startLogin']) assert.equal(rpc[name], undefined);
  const close = rpc.close(); f.finish(); await close; assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
});
test('late replies and notifications are discarded on revoke, epoch change and scope invalidation', async t => {
  for (const change of ['revoke', 'changeEpoch', 'changeGrant']) {
    const f = await fixture(t), notifications = [], rpc = await createMasZcodeOfficialChatRpc({ ...f.options, onNotification: value => notifications.push(value) });
    const pending = rpc.readAccount(), rejected = assert.rejects(pending, { code: 'CHAT_AUTHORIZATION_REQUIRED' }); await tick(); const request = f.requests.at(-1);
    f[change](); f.send({ id: request.id, result: { authenticated: true, accountKey } }); await rejected;
    f.send({ type: 'notification', packet: { method: 'turn/completed', params: { threadId: 'session', turn: { id: 'turn', status: 'completed' } } } });
    await tick(); assert.deepEqual(notifications, []); f.finish(); await rpc.close();
  }
});
test('scopes remain held until helper and its nested official runtime actually exit', async t => {
  const f = await fixture(t), rpc = await createMasZcodeOfficialChatRpc(f.options);
  f.send({ type: 'runtime', state: 'started' });
  await assert.rejects(rpc.close(), { code: 'PROCESS_EXIT_UNCONFIRMED' });
  assert.equal(f.events.some(value => value.startsWith('release:')), false);
  f.send({ type: 'runtime', state: 'exited' }); f.finish();
  assert.equal(f.events.filter(value => value === 'release:app').length, 1);
  const g = await fixture(t), other = await createMasZcodeOfficialChatRpc(g.options);
  g.send({ type: 'runtime', state: 'started' }); g.finish();
  await assert.rejects(other.close(), { code: 'PROCESS_EXIT_UNCONFIRMED' });
  assert.equal(g.events.some(value => value.startsWith('release:')), false);
});
test('consent identity follows the selected runtime route and is projected across the bridge', async t => {
  const f = await fixture(t), rpc = await createMasZcodeOfficialChatRpc(f.options);
  const pending = rpc.getConsentIdentity({ model: 'zcode-team-coding-plan-GLM-5.3', private: 'discard' }); await tick(); const request = f.requests.at(-1);
  assert.deepEqual(request.args, [{ model: 'zcode-team-coding-plan-GLM-5.3' }]);
  f.send({ id: request.id, result: { accountKey, recipientOrigin: 'https://open.bigmodel.cn', channel: 'official', token: 'private' } });
  assert.deepEqual(await pending, { accountKey, recipientOrigin: 'https://open.bigmodel.cn', channel: 'official' });
  const close = rpc.close(); f.finish(); await close;
});
test('wire projections strip private fields and reject unrecognized official routes and events', () => {
  assert.deepEqual(projectNotification({ method: 'item/completed', params: { threadId: 'session', turnId: 'turn', secret: 'private',
    item: { id: 'turn', type: 'agentMessage', text: '{"text":"test","action":"none"}', phase: 'final_answer', accessToken: 'private' } } }),
  { method: 'item/completed', params: { threadId: 'session', turnId: 'turn', item: { id: 'turn', type: 'agentMessage', text: '{"text":"test","action":"none"}', phase: 'final_answer' } } });
  assert.throws(() => projectResult('getConsentIdentity', { accountKey, recipientOrigin: 'https://custom.invalid', channel: 'official' }));
  assert.throws(() => projectNotification({ method: 'tool/completed', params: { threadId: 'session', turnId: 'turn' } }));
});
test('official HTTP boundary allows only quota reads and existing-key short-lived exchange', async () => {
  const calls = [], fetch = createOfficialFetch(async (url, init) => { calls.push({ url, ...init }); return {}; });
  const base = 'https://api.z.ai/api/biz/v1/organization/org/projects/project/api_keys';
  await fetch(base + '/key/access_tokens', { method: 'POST', body: JSON.stringify({ clientType: 'zcode', clientVersion: '3.18.2' }) });
  await fetch('https://open.bigmodel.cn/api/biz/subscription/list', { method: 'GET' });
  for (const [url, options] of [[base, { method: 'POST', body: '{}' }], [base + '/key', { method: 'DELETE' }],
    [base + '/key/access_tokens', { method: 'POST', body: JSON.stringify({ clientType: 'zcode', clientVersion: '3.18.2', persist: true }) }],
    ['https://custom.invalid/api/biz/subscription/list', {}], ['https://api.z.ai/api/anthropic', { method: 'POST' }]]) {
    assert.throws(() => fetch(url, options), { code: 'ZCODE_UNTRUSTED_ENDPOINT' });
  }
  assert.equal(calls.length, 2); assert(calls.every(row => row.redirect === 'error'));
});
test('helper keeps raw account material internal and drops a response after same-account session rotation', async t => {
  const f = await fixture(t); let current = { accountKey, accountId: 'private-user', family: 'zai', jwtToken: 'private-jwt',
    accessToken: 'private-oauth', sessionRevision: 'one', selection: { kind: 'start-plan' }, personal: { hasConfigured: true, token: 'private-custom' } };
  let options, finish, entered; const gate = new Promise(resolve => { entered = resolve; });
  const session = await createOfficialChatSession({ directory: f.directory, appDirectory: f.app, workspaceDir: f.workspaceDir, expectedAccountKey: accountKey,
    reader: { read: async () => current, close: () => {} }, createRpc: value => { options = value; return {
      readAccount: async () => ({ authenticated: true, accountKey, token: 'private' }), close: async () => {},
      listModels: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } }; } });
  assert.equal(options.officialOnly, true); assert.equal(options.strictOfficialSelection, true); assert.equal((await options.readAccount()).personal, undefined);
  assert.deepEqual(await session.call('readAccount', []), { authenticated: true, accountKey });
  const pending = session.call('listModels', []), rejected = assert.rejects(pending, { code: 'ZCODE_ACCOUNT_CHANGED' }); await gate;
  current = { ...current, sessionRevision: 'two' }; finish([]); await rejected; await session.close();
});
test('helper obtains consent origin from the same official runtime provider config', async t => {
  const f = await fixture(t), notices = [];
  const account = { accountKey, accountId: 'private-user', family: 'zai', jwtToken: 'private-jwt', selection: { kind: 'start-plan' } };
  const model = { id: 'zcode-start-plan-GLM-5.3-Flash', displayName: 'GLM', supportedReasoningEfforts: ['none'], defaultReasoningEffort: 'none', isDefault: true };
  const session = await createOfficialChatSession({ directory: f.directory, appDirectory: f.app, workspaceDir: f.workspaceDir, expectedAccountKey: accountKey,
    reader: { read: async () => account, close: () => {} }, onNotification: packet => notices.push(packet), createRpc: options => ({
      start: async () => options.prepareRuntime({ workspaceDir: f.workspaceDir, account, appDirectory: f.app, runtimeHome: path.join(f.workspaceDir, 'runtime-home') }),
      listModels: async () => [model], close: async () => {} }) });
  await session.call('start', []); await session.call('listModels', []);
  assert.deepEqual(await session.call('getConsentIdentity', [{ model: model.id }]), { accountKey, recipientOrigin: 'https://zcode.z.ai', channel: 'official' });
  await assert.rejects(session.call('getConsentIdentity', [{ model: 'configured-custom' }]), { code: 'MODEL_UNAVAILABLE' }); await session.close();
});
