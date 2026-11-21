'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createMasInstalledWorkBuddyAccess } = require('../lib/mas-installed-workbuddy-access');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'mas-workbuddy-access-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'WorkBuddy.app');
  const authDir = path.join(root, 'Library/Application Support/CodeBuddyExtension/Data/Public/auth');
  await fs.mkdir(appDir); await fs.mkdir(authDir, { recursive: true });
  let saved = null;
  const selections = [], requests = [], scopes = [], storageCalls = [];
  const app = { getPath: () => root, startAccessingSecurityScopedResource(bookmark) {
    if (bookmark === 'expired') throw Error('private native error');
    scopes.push('open:' + bookmark); return () => scopes.push('stop:' + bookmark);
  } };
  const storage = {
    async load(provider) { storageCalls.push(['load', provider]); return saved; },
    async save(provider, value) { storageCalls.push(['save', provider]); saved = structuredClone(value); },
    async remove(provider) { storageCalls.push(['remove', provider]); saved = null; }
  };
  const dialog = { async showOpenDialog(options) {
    requests.push(options); const value = selections.shift(); assert.ok(value, 'unexpected system picker');
    return typeof value === 'function' ? value() : value;
  } };
  const make = () => createMasInstalledWorkBuddyAccess({ app, dialog, storage, mas: true });
  const pick = (directory, bookmark) => ({ canceled: false, filePaths: [directory], bookmarks: [bookmark] });
  return { root, appDir, authDir, app, storage, dialog, make, pick, selections, requests, scopes, storageCalls,
    get saved() { return saved; }, set saved(value) { saved = value; } };
}

test('two explicit WorkBuddy selections save atomically and restart never opens a picker', async t => {
  const f = await fixture(t), access = f.make();
  assert.deepEqual(await access.getStatus(), { status: 'needs-authorization' });
  assert.equal(f.requests.length, 0);
  f.selections.push(f.pick(f.appDir, 'app'), f.pick(f.authDir, 'auth'));
  assert.deepEqual(await access.ensure({ interactive: true }), { status: 'stored', changed: true });
  assert.equal(f.saved.app.purpose, 'installed-app'); assert.equal(f.saved.account.purpose, 'workbuddy-quota-account');
  assert.ok(f.requests.every(value => value.securityScopedBookmarks === true));
  assert.equal(f.requests[1].defaultPath, f.authDir);
  assert.deepEqual(await f.make().ensure(), { status: 'stored' }); assert.equal(f.requests.length, 2);
  assert.ok(f.storageCalls.every(([, provider]) => provider === 'workbuddy'));
  const lease = await access.directoryAccess.acquire('workbuddy'); lease.release(); lease.release();
  assert.equal(f.scopes.filter(x => x.startsWith('open:')).length, f.scopes.filter(x => x.startsWith('stop:')).length);
});

test('cancelled second selection preserves an existing unusable pair and commits no new pair', async t => {
  const f = await fixture(t), access = f.make();
  f.selections.push(f.pick(f.appDir, 'app'), { canceled: true });
  assert.equal((await access.ensure({ interactive: true })).status, 'cancelled'); assert.equal(f.saved, null);
  f.selections.push(f.pick(f.appDir, 'app'), f.pick(f.authDir, 'auth')); await access.ensure({ interactive: true });
  f.saved.app.bookmark = 'expired'; f.saved.account.bookmark = 'expired'; const before = structuredClone(f.saved);
  f.selections.push(f.pick(f.appDir, 'replacement-app'), { canceled: true });
  assert.equal((await access.ensure({ interactive: true })).status, 'cancelled'); assert.deepEqual(f.saved, before);
});

test('step flow retains app grant after a wrong directory and commits only the complete pair', async t => {
  const f = await fixture(t), access = f.make();
  f.selections.push(f.pick(f.appDir, 'app'), f.pick(f.root, 'wrong'), f.pick(f.authDir, 'auth'));
  assert.equal((await access.ensure({ interactive: true, step: 'app' })).status, 'app-authorized'); assert.equal(f.saved, null);
  assert.equal((await access.ensure({ interactive: true, step: 'account' })).status, 'invalid-directory'); assert.equal(f.saved, null);
  assert.equal((await access.ensure({ interactive: true, step: 'account' })).status, 'stored');
  assert.equal(f.requests.filter(x => x.properties.includes('openFile')).length, 1);
});

test('task grants, wrong app, symbolic directory and ordinary Electron cannot become quota authority', async t => {
  const f = await fixture(t); f.saved = { directory: f.authDir, bookmark: 'task', purpose: 'workbuddy-task-events' };
  const access = f.make(); await assert.rejects(access.directoryAccess.acquire('workbuddy'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  f.selections.push(f.pick(f.root, 'wrong'));
  assert.equal((await access.ensure({ interactive: true, step: 'app' })).status, 'invalid-app');
  const target = path.join(f.root, 'outside'); await fs.rename(f.authDir, target); await fs.symlink(target, f.authDir);
  f.selections.push(f.pick(f.appDir, 'app'), f.pick(f.authDir, 'symlink'));
  assert.equal((await access.ensure({ interactive: true, step: 'app' })).status, 'app-authorized');
  assert.equal((await access.ensure({ interactive: true, step: 'account' })).status, 'invalid-directory');
  const normal = createMasInstalledWorkBuddyAccess({ app: f.app, dialog: f.dialog, storage: f.storage, mas: false });
  assert.equal((await normal.ensure({ interactive: true })).status, 'unavailable');
});

test('abort or revoke during a pending native picker cannot persist late authorization', async t => {
  const f = await fixture(t), access = f.make(), abort = new AbortController();
  f.selections.push(() => { abort.abort(); return f.pick(f.appDir, 'app'); });
  await assert.rejects(access.ensure({ interactive: true, signal: abort.signal }), { code: 'CANCELLED' }); assert.equal(f.saved, null);
  let complete;
  f.selections.push(() => new Promise(resolve => { complete = resolve; }));
  const pending = access.ensure({ interactive: true });
  await new Promise(resolve => setImmediate(resolve));
  const revoked = access.revoke(); complete(f.pick(f.appDir, 'late'));
  await assert.rejects(pending, { code: 'CANCELLED' }); await revoked; assert.equal(f.saved, null);
});

test('revoke invalidates live leases immediately while their scopes remain until caller releases', async t => {
  const f = await fixture(t), access = f.make();
  f.selections.push(f.pick(f.appDir, 'app'), f.pick(f.authDir, 'auth')); await access.ensure({ interactive: true });
  const lease = await access.installedAppAccess.acquire('workbuddy'); assert.equal(lease.isCurrent(), true);
  const stops = f.scopes.filter(x => x.startsWith('stop:')).length;
  const revoked = access.revoke(); assert.equal(lease.isCurrent(), false);
  assert.equal(f.scopes.filter(x => x.startsWith('stop:')).length, stops);
  await revoked; lease.release(); await assert.rejects(access.directoryAccess.acquire('workbuddy'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
});
