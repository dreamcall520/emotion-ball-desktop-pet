'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createInstalledCodexChatRpc } = require('../lib/mas-installed-codex');

async function fixture(t, relative = 'Contents/Resources/codex') {
  const root = await fs.promises.mkdtemp(path.join(await fs.promises.realpath(os.tmpdir()), 'qiuqiu-installed-test-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'ChatGPT.app'), codex = path.join(root, 'selected-home/.codex'), workspaceDir = path.join(root, 'container/workspace');
  const binary = path.join(app, relative);
  await fs.promises.mkdir(path.dirname(binary), { recursive: true });
  await fs.promises.writeFile(binary, 'synthetic executable — never executed', { mode: 0o700 });
  await fs.promises.mkdir(codex, { recursive: true });
  await fs.promises.mkdir(workspaceDir, { recursive: true });
  // Synthetic sentinel, not an account credential; must remain untouched.
  await fs.promises.writeFile(path.join(codex, 'sentinel.txt'), 'original fixture');
  const events = [], child = new EventEmitter(); child.pid = 12345;
  const port = (kind, directory) => ({ acquire: async provider => {
    assert.equal(provider, 'codex'); events.push('acquire:' + kind);
    return { directory, release: () => events.push('release:' + kind) };
  } });
  let captured;
  const options = { installedAppAccess: port('app', app), directoryAccess: port('account', codex), workspaceDir,
    spawn: (...args) => { events.push('spawn'); return child; },
    createRpc: value => {
      captured = value;
      return { start: async () => { value.spawn(value.binaryPath, ['synthetic'], {}); },
        close: async () => { events.push('rpc-close'); },
        readAccount: async () => ({ authenticated: false }), readRateLimits: async () => ({ remaining: 42 }),
        listModels: async () => ({ data: [] }), startTurn: async (...args) => args };
    }
  };
  return { root, app, codex, binary, workspaceDir, options, child, events, port, captured: () => captured };
}

test('only explicit grants select executable/home; no credential copy, independent profile or login API', async t => {
  const f = await fixture(t);
  const rpc = await createInstalledCodexChatRpc({ ...f.options, env: { OPENAI_API_KEY: 'must-not-propagate', NODE_OPTIONS: 'unsafe' }, binaryPath: '/unselected/codex', profileHome: '/unselected/profile' });
  assert.deepEqual(f.events, ['acquire:app', 'acquire:account']);
  const options = f.captured();
  assert.equal(options.binaryPath, f.binary);
  assert.equal(options.homedir(), path.dirname(f.codex));
  assert.deepEqual(options.env, { HOME: path.dirname(f.codex), CODEX_HOME: f.codex, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  assert.equal(options.workspaceDir, f.workspaceDir);
  assert.equal(options.disableOptionalTelemetry, true);
  assert.equal(options.webSocket, null);
  for (const method of ['startLogin', 'cancelLogin', 'logout', 'request']) assert.equal(rpc[method], undefined);
  assert.equal(rpc.source, 'installed');
  assert.deepEqual(await rpc.readAccount(), { authenticated: false });
  assert.deepEqual(await rpc.readRateLimits(), { remaining: 42 });
  assert.deepEqual(await rpc.listModels(), { data: [] });
  assert.deepEqual(await rpc.startTurn('thread', 'synthetic text', {}), ['thread', 'synthetic text', {}]);
  await rpc.close();
  assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
  assert.deepEqual(await fs.promises.readdir(f.codex), ['sentinel.txt']);
  assert.equal(await fs.promises.readFile(path.join(f.codex, 'sentinel.txt'), 'utf8'), 'original fixture');
  assert.deepEqual(await fs.promises.readdir(f.workspaceDir), []);
});

test('holds both scopes beyond raw close until owned process actually exits; close is idempotent', async t => {
  const f = await fixture(t), rpc = await createInstalledCodexChatRpc(f.options);
  await rpc.start();
  let done = false;
  const closing = rpc.close().then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  assert.equal(f.events.some(value => value.startsWith('release:')), false);
  f.child.emit('exit', 0);
  await closing; await rpc.close(); f.child.emit('close', 0);
  assert.equal(f.events.filter(value => value === 'release:app').length, 1);
  assert.equal(f.events.filter(value => value === 'release:account').length, 1);
  await assert.rejects(rpc.readAccount(), { code: 'CLOSED' });
});

test('unconfirmed close timeout retains scopes; later real exit releases exactly once', async t => {
  const f = await fixture(t), rpc = await createInstalledCodexChatRpc({ ...f.options, closeTimeoutMs: 10 });
  await rpc.start();
  await assert.rejects(rpc.close(), { code: 'PROCESS_EXIT_UNCONFIRMED' });
  assert.equal(f.events.some(value => value.startsWith('release:')), false);
  f.child.emit('error', new Error('existing process error'));
  assert.equal(f.events.some(value => value.startsWith('release:')), false);
  f.child.emit('close', 1);
  assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
});

test('grant rejection never discovers or spawns; partial acquisition releases', async t => {
  const f = await fixture(t);
  f.options.directoryAccess = { acquire: async () => { throw Object.assign(new Error('expired'), { code: 'DIRECTORY_ACCESS_REQUIRED' }); } };
  await assert.rejects(createInstalledCodexChatRpc(f.options), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.deepEqual(f.events, ['acquire:app', 'release:app']);
  assert.equal(f.captured(), undefined);
});

test('missing executable and symlink escape are rejected under scopes without fallback discovery', async t => {
  for (const kind of ['missing', 'symlink', 'parent-link']) {
    const f = await fixture(t);
    if (kind === 'missing') await fs.promises.unlink(f.binary);
    if (kind === 'symlink') {
      const outside = path.join(f.root, 'outside'); await fs.promises.rename(f.binary, outside);
      await fs.promises.symlink(outside, f.binary);
    }
    if (kind === 'parent-link') {
      const resources = path.dirname(f.binary), outside = path.join(f.root, 'resources');
      await fs.promises.rename(resources, outside); await fs.promises.symlink(outside, resources);
    }
    await assert.rejects(createInstalledCodexChatRpc(f.options), { code: kind === 'missing' ? 'MISSING' : 'UNSAFE_CONFIG' });
    assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
    assert.equal(f.captured(), undefined);
  }
});

test('accepts embedded CodexCLI layout without searching other apps', async t => {
  const f = await fixture(t, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const rpc = await createInstalledCodexChatRpc(f.options);
  assert.equal(f.captured().binaryPath, f.binary); await rpc.close();
});

test('workspace cannot be inside original profile/App or be a symlink', async t => {
  for (const kind of ['profile', 'app', 'symlink']) {
    const f = await fixture(t);
    const workspaceDir = kind === 'profile' ? f.codex : kind === 'app' ? f.app : path.join(f.root, 'linked-workspace');
    if (kind === 'symlink') await fs.promises.symlink(f.workspaceDir, workspaceDir);
    await assert.rejects(createInstalledCodexChatRpc({ ...f.options, workspaceDir }), { code: 'UNSAFE_CONFIG' });
    assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
  }
});

test('start failure without a child and OS spawn failure release all scopes', async t => {
  for (const kind of ['before-spawn', 'spawn-throws', 'spawn-error']) {
    const f = await fixture(t);
    f.options.createRpc = options => ({ start: async () => {
      if (kind === 'before-spawn') throw Object.assign(new Error('bad config'), { code: 'UNSAFE_CONFIG' });
      options.spawn();
      if (kind === 'spawn-error') { f.child.pid = undefined; f.child.emit('error', new Error('spawn failed')); throw new Error('spawn failed'); }
    }, close: async () => {} });
    if (kind === 'spawn-throws') f.options.spawn = () => { throw new Error('spawn throws'); };
    const rpc = await createInstalledCodexChatRpc(f.options);
    await assert.rejects(rpc.start());
    assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
  }
});

test('real RPC initialization keeps safety overrides and never starts login when original account is absent', async t => {
  const { PassThrough } = require('node:stream');
  const { DISABLED_FEATURES } = require('../lib/codex-chat-rpc');
  const f = await fixture(t), packets = [];
  for (const name of ['stdin', 'stdout', 'stderr']) f.child[name] = new PassThrough();
  f.child.kill = () => { queueMicrotask(() => f.child.emit('exit', 1)); return true; };
  f.child.stdin.on('finish', () => queueMicrotask(() => f.child.emit('exit', 0)));
  f.child.stdin.on('data', data => {
    const packet = JSON.parse(data); packets.push(packet);
    if (!Object.hasOwn(packet, 'id')) return;
    let result = {};
    if (packet.method === 'config/read') result = { config: {
      features: Object.fromEntries(DISABLED_FEATURES.map(name => [name, false])),
      web_search: 'disabled', project_doc_max_bytes: 0,
      analytics: { enabled: false }, feedback: { enabled: false },
      otel: { exporter: 'none', trace_exporter: 'none', metrics_exporter: 'none',
        log_user_prompt: false, log_agent_responses: false, log_guardian_assessments: false }
    } };
    if (packet.method === 'account/read') result = { account: null };
    queueMicrotask(() => f.child.stdout.write(JSON.stringify({ id: packet.id, result }) + '\n'));
  });
  const options = { ...f.options }; delete options.createRpc;
  const rpc = await createInstalledCodexChatRpc(options);
  await rpc.start();
  const account = await rpc.readAccount();
  assert.equal(account.authenticated, false);
  assert.deepEqual(packets.map(packet => packet.method), ['initialize', 'initialized', 'config/read', 'account/read']);
  assert.deepEqual(packets.at(-1).params, { refreshToken: false });
  await rpc.close();
  assert.deepEqual(f.events.slice(-2), ['release:account', 'release:app']);
});
