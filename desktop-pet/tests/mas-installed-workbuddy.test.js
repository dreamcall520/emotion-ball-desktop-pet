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
async function fixture(t, options = {}) {
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
    spawnProcess(...args) { spawnCalls.push(args); const value = child(); children.push(value); return value; }, ...options });
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

test('tasks and caller-supplied auth overrides never reach a helper without their required request', async t => {
  const f = await fixture(t);
  for (const operation of ['chat', 'tasks', 'task-open', 'unreviewed']) await assert.rejects(f.run(operation), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.run('quota', { authDirectory: '/outside' }), { code: 'INVALID_REQUEST' });
  assert.equal(f.acquired.length, 0); assert.equal(f.spawnCalls.length, 0);
});

const chatPayload = { model: 'auto', conversationId: 'synthetic-conversation', expectedAccountKey: key,
  messages: [{ role: 'system', content: 'Synthetic companion only. No tools.' }, { role: 'user', content: '合成消息' }] };
async function chatFixture(t) {
  const authorization = { enabled: true, accountKey: key, epoch: 1 };
  const f = await fixture(t, { getChatEnabled: () => authorization.enabled,
    getAuthorizedChatAccountKey: () => authorization.accountKey, getChatGrantEpoch: () => authorization.epoch,
    taskAccess: { acquire() { throw Error('chat must never acquire task scope'); } } });
  return { ...f, authorization };
}
test('quota grants alone cannot list chat models or send a message', async t => {
  const f = await fixture(t);
  for (const [operation, payload] of [['models', {}], ['chat', chatPayload]])
    await assert.rejects(f.run(operation, payload), { code: 'CHAT_AUTHORIZATION_REQUIRED' });
  assert.equal(f.acquired.length, 0); assert.equal(f.children.length, 0);
});
test('authorized models bind expected account before helper startup and return only reviewed model fields', async t => {
  const f = await chatFixture(t), pending = f.run('models'); await spawned(f);
  let input = ''; f.children[0].stdin.on('data', chunk => { input += chunk; });
  await tick(); assert.deepEqual(JSON.parse(input), { operation: 'models', payload: { expectedAccountKey: key } });
  result(f.children[0], { models: [{ id: 'auto', displayName: '自动', token: 'private' }], token: 'private' }); f.children[0].finish(0);
  assert.deepEqual(await pending, { accountKey: key, models: [{ id: 'auto', displayName: '自动' }] });
  assert.equal(f.acquired.length, 2); assert.equal(f.releases.length, 2);
});
test('authorized chat preserves the website streaming protocol and no additional source scope', async t => {
  const f = await chatFixture(t), deltas = [], pending = f.run('chat', chatPayload, { onDelta: text => deltas.push(text) }); await spawned(f);
  let input = ''; f.children[0].stdin.on('data', chunk => { input += chunk; }); await tick();
  assert.deepEqual(JSON.parse(input), { operation: 'chat', payload: chatPayload });
  assert.equal(f.spawnCalls[0][2].env.QIUQIU_WORKBUDDY_TASK_DIRECTORY, undefined);
  f.children[0].stdout.write(JSON.stringify({ type: 'delta', text: '合成' }) + '\n');
  assert.deepEqual(deltas, ['合成']); assert.equal(f.releases.length, 0);
  result(f.children[0], { text: '合成回复', token: 'private', uid: 'private' }); f.children[0].finish(0);
  assert.deepEqual(await pending, { accountKey: key, text: '合成回复' }); assert.equal(f.releases.length, 2);
});
test('chat grant revocation and same-account reauthorization suppress old deltas and final results until confirmed child exit', async t => {
  for (const change of ['disable', 'account', 'epoch']) {
    const f = await chatFixture(t), deltas = [], pending = f.run('chat', chatPayload, { onDelta: text => deltas.push(text) }); await spawned(f);
    if (change === 'disable') f.authorization.enabled = false;
    else if (change === 'account') f.authorization.accountKey = 'b'.repeat(64);
    else f.authorization.epoch++;
    f.children[0].stdout.write(JSON.stringify({ type: 'delta', text: '不应显示' }) + '\n'); await tick();
    assert.deepEqual(deltas, []); assert.equal(f.children[0].killed, true); assert.equal(f.releases.length, 0);
    result(f.children[0], { text: '不应显示' }); f.children[0].finish(0);
    await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.releases.length, 2);
  }
});
test('chat authorization cannot cross accounts or accept tools and unreviewed payload fields', async t => {
  const f = await chatFixture(t);
  await assert.rejects(f.run('chat', { ...chatPayload, expectedAccountKey: 'b'.repeat(64) }), { code: 'ACCOUNT_CHANGED' });
  for (const payload of [{ ...chatPayload, tools: [] }, { ...chatPayload, messages: [{ role: 'tool', content: 'result' }] },
    { ...chatPayload, messages: [{ role: 'user', content: 'synthetic', tool_calls: [] }] }, { ...chatPayload, token: 'private' }])
    await assert.rejects(f.run('chat', payload), { code: 'INVALID_REQUEST' });
  assert.equal(f.acquired.length, 0); assert.equal(f.children.length, 0);
});
test('a revoked model lookup cannot complete and malformed catalogs never cross the adapter', async t => {
  const revoked = await chatFixture(t), pending = revoked.run('models'); await spawned(revoked); revoked.authorization.epoch++;
  result(revoked.children[0], { models: [{ id: 'auto', displayName: '自动' }] }); revoked.children[0].finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(revoked.releases.length, 2);
  const malformed = await chatFixture(t), bad = malformed.run('models'); await spawned(malformed);
  result(malformed.children[0], { models: [{ id: 'auto', displayName: '自动' }, { id: 'auto', displayName: '重复' }] }); malformed.children[0].finish(0);
  await assert.rejects(bad, { code: 'INVALID_RESPONSE' });
});
test('chat cancellation suppresses late text and keeps App/account scopes until child exit', async t => {
  const f = await chatFixture(t), abort = new AbortController(), deltas = [];
  const pending = f.run('chat', chatPayload, { signal: abort.signal, onDelta: text => deltas.push(text) }); await spawned(f);
  abort.abort(); await tick(); assert.equal(f.children[0].killed, true); assert.equal(f.releases.length, 0);
  f.children[0].stdout.write(JSON.stringify({ type: 'delta', text: '不应显示' }) + '\n');
  result(f.children[0], { text: '不应显示' }); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.deepEqual(deltas, []); assert.equal(f.releases.length, 2);
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

async function taskFixture(t) {
  const f = await fixture(t), taskDirectory = path.join(f.root, '.workbuddy'); await fs.mkdir(taskDirectory);
  let taskCurrent = true, taskAcquires = 0, taskReleases = 0;
  const taskAccess = { async acquire(provider) {
    assert.equal(provider, 'workbuddy'); taskAcquires++; let released = false;
    return { directory: taskDirectory, isCurrent: () => taskCurrent, release() { if (!released) { released = true; taskReleases++; } } };
  } };
  const run = createMasInstalledWorkBuddyRunner({ access: f.access, taskAccess, spawnProcess(...args) {
    f.spawnCalls.push(args); const value = child(); f.children.push(value); return value;
  } });
  return { ...f, run, taskDirectory, taskAccess, get taskAcquires() { return taskAcquires; }, get taskReleases() { return taskReleases; }, revokeTasks() { taskCurrent = false; } };
}
const taskReport = { source: 'local-session-cache', scope: 'current-account', observedAt: 2000, running: null,
  pendingReview: 1, pendingReviewSource: 'cached-unread', total: 1, truncated: false,
  items: [{ id: 'task-a', title: '合成任务', status: 'completed', unread: true, updatedAt: 1000, transport: 'local' }] };

test('tasks require a separate task lease and publish only current-account title/status metadata', async t => {
  const f = await taskFixture(t), pending = f.run('tasks', { expectedAccountKey: key }); await spawned(f);
  assert.equal(f.taskAcquires, 1); assert.equal(f.taskReleases, 0);
  assert.equal(f.spawnCalls[0][2].env.QIUQIU_WORKBUDDY_TASK_DIRECTORY, f.taskDirectory);
  result(f.children[0], { ...taskReport, uid: 'private', body: 'private', items: [{ ...taskReport.items[0], body: 'private', token: 'private' }] });
  f.children[0].finish(0); assert.deepEqual(await pending, { accountKey: key, ...taskReport });
  assert.equal(f.releases.length, 2); assert.equal(f.taskReleases, 1);
});

test('quota never acquires task permission while missing task authority cannot spawn a task reader', async t => {
  const f = await taskFixture(t), pending = f.run('quota'); await spawned(f);
  assert.equal(f.taskAcquires, 0); assert.equal(f.spawnCalls[0][2].env.QIUQIU_WORKBUDDY_TASK_DIRECTORY, undefined);
  result(f.children[0]); f.children[0].finish(0); await pending;
  const ordinary = await fixture(t);
  await assert.rejects(ordinary.run('tasks', { expectedAccountKey: key }), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.equal(ordinary.acquired.length, 0); assert.equal(ordinary.spawnCalls.length, 0);
});

test('task-open accepts only the validated exact local deep link and does not open it', async t => {
  const f = await taskFixture(t), pending = f.run('task-open', { expectedAccountKey: key, id: 'task-a' }); await spawned(f);
  result(f.children[0], { id: 'task-a', url: 'workbuddy://chat/task-a', token: 'private' }); f.children[0].finish(0);
  assert.deepEqual(await pending, { accountKey: key, id: 'task-a', url: 'workbuddy://chat/task-a' });
  const invalid = await taskFixture(t), bad = invalid.run('task-open', { expectedAccountKey: key, id: 'task-a' }); await spawned(invalid);
  result(invalid.children[0], { id: 'task-b', url: 'https://untrusted.invalid/' }); invalid.children[0].finish(0);
  await assert.rejects(bad, { code: 'INVALID_RESPONSE' });
});

test('revoking task authority or cancelling retains scopes until exit and suppresses late task metadata', async t => {
  const f = await taskFixture(t), pending = f.run('tasks', { expectedAccountKey: key }); await spawned(f);
  f.revokeTasks(); result(f.children[0], taskReport); assert.equal(f.taskReleases, 0); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.taskReleases, 1); assert.equal(f.releases.length, 2);
});

test('task payloads cannot select arbitrary databases or pass a different account through', async t => {
  const f = await taskFixture(t);
  await assert.rejects(f.run('tasks', { expectedAccountKey: key, file: '/outside.db' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.run('task-open', { expectedAccountKey: key, id: '../escape' }), { code: 'INVALID_REQUEST' });
  const pending = f.run('tasks', { expectedAccountKey: key }); await spawned(f);
  result(f.children[0], { ...taskReport, accountKey: 'b'.repeat(64) }); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'ACCOUNT_CHANGED' });
});

test('task request cancellation terminates only its helper and retains all three leases through exit', async t => {
  const f = await taskFixture(t), abort = new AbortController();
  const pending = f.run('tasks', { expectedAccountKey: key }, { signal: abort.signal }); await spawned(f);
  abort.abort(); await tick(); assert.equal(f.children[0].killed, true);
  assert.equal(f.releases.length, 0); assert.equal(f.taskReleases, 0);
  result(f.children[0], taskReport); f.children[0].finish(0);
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.taskReleases, 1); assert.equal(f.releases.length, 2);
});

test('a wrong or symbolic task directory cannot borrow the account grants to read a cache', async t => {
  const f = await taskFixture(t); let released = 0;
  f.taskAccess.acquire = async () => ({ directory: f.auth, release: () => released++ });
  await assert.rejects(f.run('tasks', { expectedAccountKey: key }), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.equal(released, 1); assert.equal(f.releases.length, 2); assert.equal(f.spawnCalls.length, 0);
  const moved = path.join(f.root, 'outside'); await fs.rename(f.taskDirectory, moved); await fs.symlink(moved, f.taskDirectory);
  f.taskAccess.acquire = async () => ({ directory: f.taskDirectory, release: () => released++ });
  await assert.rejects(f.run('tasks', { expectedAccountKey: key }), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.equal(released, 2); assert.equal(f.spawnCalls.length, 0);
});

test('task metadata cannot supply arbitrary running counts, secrets in titles or duplicate IDs', async t => {
  const f = await taskFixture(t), pending = f.run('tasks', { expectedAccountKey: key }); await spawned(f);
  result(f.children[0], { ...taskReport, running: 99, items: [{ ...taskReport.items[0], title: 'Bearer synthetic-private-token' }] }); f.children[0].finish(0);
  const value = await pending; assert.equal(value.running, null); assert.ok(!value.items[0].title.includes('synthetic-private-token'));
  const invalid = await taskFixture(t), bad = invalid.run('tasks', { expectedAccountKey: key }); await spawned(invalid);
  result(invalid.children[0], { ...taskReport, total: 2, items: [taskReport.items[0], taskReport.items[0]] }); invalid.children[0].finish(0);
  await assert.rejects(bad, { code: 'INVALID_RESPONSE' });
});
test('account-check uses only the authorized App/account scopes and returns a single verified account hash',async t=>{
 const f=await taskFixture(t),pending=f.run('account-check',{expectedAccountKey:key});await spawned(f);
 assert.equal(f.taskAcquires,0);result(f.children[0],{token:'private',uid:'private',report:{private:true}});f.children[0].finish(0);
 assert.deepEqual(await pending,{accountKey:key});assert.equal(f.releases.length,2);
 const mismatch=await fixture(t),bad=mismatch.run('account-check',{expectedAccountKey:key});await spawned(mismatch);
 result(mismatch.children[0],{accountKey:'b'.repeat(64)});mismatch.children[0].finish(0);await assert.rejects(bad,{code:'ACCOUNT_CHANGED'});
});
