'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { createMasInstalledWorkBuddyRunner } = require('../lib/mas-installed-workbuddy');
const { createMasInstalledWorkBuddyAccess } = require('../lib/mas-installed-workbuddy-access');
const key = 'a'.repeat(64);
const report = { total: 12, basic: 10, reward: 2, purchased: 0, plan: '体验版', nextRefreshAt: null, expires: [], updatedAt: 100 };
function child() {
  const value = new EventEmitter(); value.pid = 123; value.exitCode = null;
  value.stdout = new PassThrough(); value.stderr = new PassThrough(); value.stdin = new PassThrough();
  value.kill = () => { value.killed = true; };
  value.finish = code => { value.exitCode = code; value.emit('exit', code); value.emit('close', code); };
  return value;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'mas-workbuddy-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'WorkBuddy.app'), auth = path.join(root, 'Library/Application Support/CodeBuddyExtension/Data/Public/auth');
  const binary = path.join(app, 'Contents/MacOS/Electron'); await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(binary, 'fixture', { mode: 0o700 }); await fs.mkdir(auth, { recursive: true });
  let valid = true; const releases = [], acquired = [], spawnCalls = [], children = [];
  const port = directory => ({ async acquire(provider) {
    assert.equal(provider, 'workbuddy'); acquired.push(directory); let released = false;
    return { directory, isCurrent: () => valid, release() { if (!released) { released = true; releases.push(directory); } } };
  } });
  const access = { installedAppAccess: port(app), directoryAccess: port(auth) };
  const run = createMasInstalledWorkBuddyRunner({ access, env: { QIUQIU_FAKE_SECRET: 'secret', HTTP_PROXY: 'http://127.0.0.1:1234', NODE_OPTIONS: '--bad', ELECTRON_EXTRA_LAUNCH_ARGS: 'bad' },
    spawnProcess(...args) { spawnCalls.push(args); const value = child(); children.push(value); return value; } });
  return { root, app, auth, binary, run, access, releases, acquired, spawnCalls, children, revoke() { valid = false; } };
}
async function tick() { await new Promise(resolve => setImmediate(resolve)); }
async function spawned(f) {
  const deadline = Date.now() + 1000;
  while (!f.children.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.children.length, 1, 'authorized helper should start');
}
function result(value, extra = {}) { value.stdout.write(JSON.stringify({ type: 'result', result: { accountKey: key, report, ...extra } }) + '\n'); }

test('quota runs only the selected WorkBuddy component and selected auth directory, then strips unknown output', async t => {
  const f = await fixture(t), pending = f.run('quota'); await spawned(f);
  const [binary, args, options] = f.spawnCalls[0]; assert.equal(binary, f.binary);
  assert.equal(options.env.QIUQIU_WORKBUDDY_AUTH_DIRECTORY, f.auth); assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(options.env.NODE_OPTIONS, undefined); assert.equal(options.env.QIUQIU_FAKE_SECRET, undefined);
  assert.equal(options.env.HTTP_PROXY, 'http://127.0.0.1:1234');
  assert.equal(f.releases.length, 0); assert.ok(args[0].endsWith('workbuddy-helper.cjs'));
  const value = f.children[0]; result(value, { token: 'private', report: { ...report, token: 'private' } });
  assert.equal(f.releases.length, 0); value.finish(0);
  assert.deepEqual(await pending, { accountKey: key, report }); assert.equal(f.releases.length, 2);
});

test('models, chat, tasks and caller-supplied auth overrides never reach a helper', async t => {
  const f = await fixture(t);
  for (const operation of ['models', 'chat', 'tasks', 'task-open']) await assert.rejects(f.run(operation), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.run('quota', { authDirectory: '/outside' }), { code: 'INVALID_REQUEST' });
  assert.equal(f.acquired.length, 0); assert.equal(f.spawnCalls.length, 0);
});

test('cancel terminates its child but retains both scopes until confirmed process exit', async t => {
  const f = await fixture(t), abort = new AbortController(), pending = f.run('quota', {}, { signal: abort.signal });
  await spawned(f); abort.abort(); await tick(); const value = f.children[0]; assert.equal(value.killed, true);
  assert.equal(f.releases.length, 0); result(value); value.finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.releases.length, 2);
});

test('revoke prevents late success and releases scopes after child exits', async t => {
  const f = await fixture(t), pending = f.run('quota'); await spawned(f); f.revoke();
  result(f.children[0]); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.releases.length, 2);
});

test('invalid executable and failed second grant release acquired scopes without spawning', async t => {
  const f = await fixture(t); await fs.unlink(f.binary); await fs.symlink('/usr/bin/true', f.binary);
  await assert.rejects(f.run('quota'), { code: 'DIRECTORY_ACCESS_REQUIRED' }); assert.equal(f.releases.length, 2); assert.equal(f.spawnCalls.length, 0);
  f.access.directoryAccess.acquire = async () => { throw Object.assign(Error('private'), { code: 'DIRECTORY_ACCESS_REQUIRED' }); };
  await assert.rejects(f.run('quota'), { code: 'DIRECTORY_ACCESS_REQUIRED' }); assert.equal(f.releases.length, 3);
});

test('raw stderr, malformed stdout and spawn failure produce only fixed errors', async t => {
  const f = await fixture(t), pending = f.run('quota'); await spawned(f);
  const value = f.children[0]; value.stderr.write('Bearer private'); value.stdout.write('private-unparseable\n');
  await tick(); assert.equal(f.releases.length, 0); value.finish(1);
  await assert.rejects(pending, error => error.code === 'INVALID_RESPONSE' && !error.message.includes('private'));
  assert.equal(f.releases.length, 2);
});

test('real access leases survive normal exit then close delivery without cancelling a valid result', async t => {
  const f = await fixture(t), selections = [f.app, f.auth], scopes = [];
  let stored;
  const access = createMasInstalledWorkBuddyAccess({ mas: true,
    app: { getPath: () => f.root, startAccessingSecurityScopedResource(bookmark) { scopes.push('open:' + bookmark); return () => scopes.push('stop:' + bookmark); } },
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [selections.shift()], bookmarks: ['synthetic-bookmark'] }; } },
    storage: { load: async () => stored, save: async (_, value) => { stored = value; }, remove: async () => { stored = null; } }
  });
  await access.ensure({ interactive: true }); let process;
  const run = createMasInstalledWorkBuddyRunner({ access, spawnProcess: () => (process = child()) });
  const pending = run('quota');
  const deadline = Date.now() + 1000;
  while (!process && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(process); result(process); process.finish(0);
  assert.deepEqual(await pending, { accountKey: key, report });
  assert.equal(scopes.filter(x => x.startsWith('open:')).length, scopes.filter(x => x.startsWith('stop:')).length);
});

test('usage returns only verified billing metadata and does not expose credentials or provider extras', async t => {
  const f = await fixture(t), pending = f.run('usage', { expectedAccountKey: key }); await spawned(f);
  const endDate = '2026-01-07', updatedAt = Date.parse(endDate + 'T12:00:00+08:00');
  const usage = { source: 'official-request-usage', timezone: 'Asia/Shanghai', startDate: '2026-01-01', endDate,
    days: Array.from({ length: 7 }, (_, i) => ({ date: '2026-01-0' + (i + 1), credits: i === 6 ? 1 : 0 })),
    todayRecords: [{ at: updatedAt - 1000, credits: 1 }], todayCredits: 1, totalCredits: 1, requestCount: 1, updatedAt, delayHours: 3, complete: true };
  result(f.children[0], { usage: { ...usage, token: 'private', input: 'private prompt' }, cookie: 'private' }); f.children[0].finish(0);
  assert.deepEqual(await pending, { accountKey: key, usage });
});

test('unconfirmed cancellation retains scopes through timeout and releases them only on a later exit', async t => {
  const f = await fixture(t); let value;
  const run = createMasInstalledWorkBuddyRunner({ access: f.access, closeTimeoutMs: 10, spawnProcess: () => (value = child()) });
  const abort = new AbortController(), pending = run('quota', {}, { signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'PROCESS_EXIT_UNCONFIRMED' });
  const deadline = Date.now() + 1000;
  while (!value && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  abort.abort(); await rejected; assert.equal(value.killed, true); assert.equal(f.releases.length, 0);
  value.finish(0); assert.equal(f.releases.length, 2);
});

test('spawn error with no process releases scopes and exposes only a fixed connection failure', async t => {
  const f = await fixture(t);
  const run = createMasInstalledWorkBuddyRunner({ access: f.access, spawnProcess: () => {
    const value = child(); value.pid = undefined; setImmediate(() => value.emit('error', Error('private native secret'))); return value;
  } });
  await assert.rejects(run('quota'), error => error.code === 'CONNECTION_FAILED' && !error.message.includes('private'));
  assert.equal(f.releases.length, 2);
});

test('a partial balance or malformed usage cannot cross the main process adapter boundary', async t => {
  const f = await fixture(t), pending = f.run('quota'); await spawned(f);
  result(f.children[0], { report: { ...report, total: 99 } }); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'INVALID_RESPONSE' });
});
