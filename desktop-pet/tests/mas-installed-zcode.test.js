'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createInstalledZcodeChatRpc, createMasInstalledZcodeRunner } = require('../lib/mas-installed-zcode');
const { PassThrough } = require('node:stream');
const { prepareZcodeRuntime, SAFE_CONFIG } = require('../lib/zcode-chat-rpc');
async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(await fs.promises.realpath(os.tmpdir()), 'installed-zcode-test-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'ZCode.app'), accountDir = path.join(root, 'selected/.zcode'), workspaceDir = path.join(root, 'container/workspace');
  const release = { revision: 1, config: { providerConfigRules: { providerRules: [] } } };
  for (const relative of ['Contents/MacOS/ZCode', 'Contents/Resources/glm/zcode.cjs', 'Contents/Resources/config/provider/zcode-builtin.json', 'Contents/Info.plist', 'Contents/Resources/app.asar']) {
    const file = path.join(app, relative); await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, relative.endsWith('.json') ? JSON.stringify(release) : relative.endsWith('.plist') ? '<key>CFBundleShortVersionString</key><string>3.18.2</string>' : 'synthetic component, never executed', { mode: 0o700 });
  }
  await fs.promises.mkdir(accountDir, { recursive: true }); await fs.promises.mkdir(workspaceDir, { recursive: true });
  await fs.promises.writeFile(path.join(accountDir, 'sentinel'), 'original account untouched');
  const events = [], child = new EventEmitter(); child.pid = 42;
  let account = { accountKey: 'a'.repeat(64), family: 'zai', jwtToken: 'synthetic-memory-only', baseDir: path.dirname(accountDir), selection: { kind: 'start-plan' } };
  let consent = account.accountKey, epoch = 0, grantCurrent = true, captured;
  const port = (kind, directory) => ({ acquire: async provider => { assert.equal(provider, 'zcode'); events.push('acquire:' + kind); return { directory, release: () => events.push('release:' + kind), isCurrent: () => grantCurrent }; } });
  const options = { installedAppAccess: port('app', app), directoryAccess: port('account', accountDir), workspaceDir,
    readAccount: async () => account, expectedAccountKey: account.accountKey, getAuthorizedAccountKey: () => consent, getChatGrantEpoch: () => epoch,
    spawn: () => { events.push('spawn'); return child; },
    createRpc: value => { captured = value; return { start: async () => { value.spawn(value.executable, [value.appDirectory], {}); },
      close: async () => { events.push('rpc-close'); }, readAccount: async () => ({ authenticated: true }), listModels: async () => [],
      startThread: async () => ({ id: 'synthetic' }), resumeThread: async () => ({}), startTurn: async () => ({}), interruptTurn: async () => ({}) }; }
  };
  return { root, app, accountDir, workspaceDir, options, events, child, port, captured: () => captured,
    account: () => account, switchAccount: value => { account = { ...account, ...value }; }, revoke: () => { consent = null; epoch++; }, changeGrant: () => { grantCurrent = false; } };
}
test('official runner pins explicit App/current account, strips custom sources and arbitrary environment', async t => {
  const f = await fixture(t); f.switchAccount({ personal: { hasConfigured: true, private: 'synthetic custom material' } });
  const rpc = await createInstalledZcodeChatRpc({ ...f.options, env: { OPENAI_API_KEY: 'private', ZCODE_CREDENTIAL_SECRET: 'private', NODE_OPTIONS: 'private', HTTPS_PROXY: 'https://proxy.invalid' } });
  const o = f.captured(); assert.equal(o.appDirectory, f.app); assert.equal(o.executable, path.join(f.app, 'Contents/MacOS/ZCode'));
  assert.equal(o.runtimeHome, path.join(f.workspaceDir, 'runtime-home')); assert.equal(o.officialOnly, true); assert.equal(o.strictOfficialSelection, true);
  assert.deepEqual(o.env, { HTTPS_PROXY: 'https://proxy.invalid', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }); assert.equal((await o.readAccount()).personal, undefined);
  for (const method of ['request', 'startLogin', 'logout', 'setApiKey']) assert.equal(rpc[method], undefined);
  await rpc.close(); assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
  assert.deepEqual(await fs.promises.readdir(f.accountDir), ['sentinel']);
});
test('scopes remain open after protocol close timeout until confirmed child exit', async t => {
  const f = await fixture(t), rpc = await createInstalledZcodeChatRpc({ ...f.options, closeTimeoutMs: 5 }); await rpc.start();
  await assert.rejects(rpc.close(), { code: 'PROCESS_EXIT_UNCONFIRMED' }); assert.equal(f.events.some(e => e.startsWith('release:')), false);
  f.child.emit('error', new Error('process error without exit')); assert.equal(f.events.some(e => e.startsWith('release:')), false);
  f.child.emit('exit', 0); f.child.emit('close', 0); assert.equal(f.events.filter(e => e === 'release:app').length, 1);
  assert.equal(f.events.filter(e => e === 'release:account').length, 1); await assert.rejects(rpc.listModels(), { code: 'CLOSED' });
});
test('late replies and notifications are discarded after account, consent or grant changes', async t => {
  for (const change of ['account', 'consent', 'grant']) {
    const f = await fixture(t); let complete, entered;
    const gate = new Promise(resolve => { entered = resolve; }); const notices = [];
    f.options.createRpc = options => { f.options.captured = options; return { close: async () => {}, listModels: async () => { entered(); return new Promise(resolve => { complete = resolve; }); } }; };
    const rpc = await createInstalledZcodeChatRpc({ ...f.options, onNotification: value => notices.push(value) });
    const models = rpc.listModels(); const rejected = assert.rejects(models, { code: change === 'account' ? 'UNAUTHENTICATED' : 'CHAT_AUTHORIZATION_REQUIRED' }); await gate;
    if (change === 'account') f.switchAccount({ accountKey: 'b'.repeat(64) }); else if (change === 'consent') f.revoke(); else f.changeGrant();
    f.options.captured.onNotification({ method: 'turn/completed', params: {} }); complete([{ id: 'old' }]); await rejected;
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(notices, []); await rpc.close();
  }
});
test('unselected or unsafe components cannot discover another installation', async t => {
  for (const change of ['missing', 'symlink']) {
    const f = await fixture(t), binary = path.join(f.app, 'Contents/Resources/glm/zcode.cjs');
    if (change === 'missing') await fs.promises.unlink(binary);
    else { const outside = path.join(f.root, 'external'); await fs.promises.rename(binary, outside); await fs.promises.symlink(outside, binary); }
    await assert.rejects(createInstalledZcodeChatRpc(f.options)); assert.equal(f.captured(), undefined);
    assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
  }
});
test('official runtime never sends unsupported Coding Plan or unverified Start Plan chat', async t => {
  for (const kind of ['start-plan', 'individual-coding-plan', 'team-coding-plan']) {
    const f = await fixture(t); f.switchAccount({ selection: { kind } }); let sent = 0;
    f.options.createRpc = () => ({ close: async () => {}, startTurn: async () => { sent++; } });
    const rpc = await createInstalledZcodeChatRpc(f.options), code = kind === 'start-plan' ? 'ZCODE_START_PLAN_SCOPE_UNVERIFIED' : 'CODING_PLAN_SCOPE_UNSUPPORTED';
    assert.deepEqual((await rpc.getChatScope()).available, false); assert.equal((await rpc.getChatScope()).code, code);
    await assert.rejects(rpc.startTurn('session', 'synthetic', {}), { code }); assert.equal(sent, 0); await rpc.close();
  }
});
test('isolated runtime puts safety controls in user config and never writes original account', async t => {
  const f = await fixture(t), runtimeHome = path.join(f.workspaceDir, 'runtime-home');
  const runtime = await prepareZcodeRuntime({ workspaceDir: f.workspaceDir, account: f.account(), appDirectory: f.app, runtimeHome, home: path.dirname(f.accountDir), env: { ZCODE_API_KEY: 'not inherited', NODE_OPTIONS: 'not inherited' } });
  assert.equal(runtime.env.HOME, runtimeHome); assert.equal(runtime.env.ZCODE_API_KEY, undefined); assert.equal(runtime.env.NODE_OPTIONS, undefined);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(runtimeHome, '.zcode/cli/config.json'), 'utf8')), SAFE_CONFIG);
  assert.deepEqual(await fs.promises.readdir(f.accountDir), ['sentinel']);
  await fs.promises.rm(runtimeHome, { recursive: true }); await fs.promises.symlink(f.accountDir, runtimeHome);
  await assert.rejects(prepareZcodeRuntime({ workspaceDir: f.workspaceDir, account: f.account(), appDirectory: f.app, runtimeHome }), { code: 'UNSAFE_CONFIG' });
});
function bridge(f, result, extra = {}) {
  for (const name of ['stdin', 'stdout', 'stderr']) f.child[name] = new PassThrough(); f.child.kill = () => {};
  let spawnOptions, request;
  f.child.stdin.on('data', bytes => { request = JSON.parse(String(bytes)); });
  const run = createMasInstalledZcodeRunner({ access: { installedAppAccess: f.options.installedAppAccess, directoryAccess: f.options.directoryAccess },
    env: { ZCODE_CREDENTIAL_SECRET: 'private', NODE_OPTIONS: 'private', HTTPS_PROXY: 'https://proxy.invalid' },
    spawnProcess: (executable, args, options) => { spawnOptions = { executable, args, ...options }; return f.child; }, ...extra });
  return { run, request: () => request, spawned: () => spawnOptions, reply: () => f.child.stdout.write(JSON.stringify({ type: 'result', result }) + '\n') };
}
test('read-only bridge projects account and quota without exposing credential fields', async t => {
  for (const operation of ['account-check', 'usage']) {
    const f = await fixture(t), common = { accountKey: 'a'.repeat(64) };
    const result = operation === 'account-check' ? { ...common, family: 'zai', selection: { kind: 'start-plan', scope: 'personal', private: 'private' },
      hasJwtToken: true, hasAccessToken: true, hasCodingPlanKey: false, hasDeviceMid: true, jwtToken: 'private', accountId: 'private' }
      : { ...common, state: 'connected', buckets: [], windows: [{ private: 'private' }], modelIds: [], updatedAt: 1000, balanceState: 'empty', paidState: 'unavailable', jwtToken: 'private' };
    const h = bridge(f, result), pending = h.run(operation, operation === 'usage' ? { expectedAccountKey: common.accountKey } : {}, { now: () => 1000 });
    await new Promise(resolve => setTimeout(resolve, 5)); h.reply();
    assert.equal(f.events.some(e => e.startsWith('release:')), false); f.child.emit('exit', 0); f.child.emit('close', 0);
    const projected = await pending; assert.equal(JSON.stringify(projected).includes('private'), false);
    assert.equal(h.spawned().executable, path.join(f.app, 'Contents/MacOS/ZCode')); assert.equal(h.spawned().env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(h.spawned().env.NODE_OPTIONS, undefined); assert.equal(h.spawned().env.ZCODE_CREDENTIAL_SECRET, undefined);
    assert.equal(h.request().operation, operation); assert.equal(h.request().now, 1000);
    assert.equal(f.events.filter(e => e === 'release:app').length, 1);
  }
});
test('read-only bridge abort retains scopes until actual exit and drops stale account output', async t => {
  const f = await fixture(t), controller = new AbortController(), h = bridge(f, {}, { closeTimeoutMs: 5 });
  const pending = h.run('account-check', {}, { signal: controller.signal }); const rejected = assert.rejects(pending, { code: 'PROCESS_EXIT_UNCONFIRMED' });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); await rejected;
  assert.equal(f.events.some(e => e.startsWith('release:')), false); f.child.emit('close', 1);
  assert.equal(f.events.filter(e => e === 'release:account').length, 1);
});
