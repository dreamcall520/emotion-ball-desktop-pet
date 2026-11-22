'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createMasInstalledZcodeAccess } = require('../lib/mas-installed-zcode-access');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'installed-zcode-access-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'ZCode.app'), accountDir = path.join(root, '.zcode');
  await fs.mkdir(appDir); await fs.mkdir(accountDir);
  let saved = null; const picks = [], requests = [], events = [];
  const storage = { load: async () => saved, save: async (_, value) => { saved = structuredClone(value); }, remove: async () => { saved = null; } };
  const app = { getPath: () => root, startAccessingSecurityScopedResource: bookmark => {
    if (bookmark === 'expired') throw Error(); events.push('open:' + bookmark); return () => events.push('stop:' + bookmark);
  } };
  const dialog = { showOpenDialog: async options => { requests.push(options); const next = picks.shift(); assert.ok(next); return typeof next === 'function' ? next() : next; } };
  const pick = (directory, bookmark) => ({ canceled: false, filePaths: [directory], bookmarks: [bookmark] });
  return { root, appDir, accountDir, app, dialog, storage, picks, requests, events, pick,
    make: () => createMasInstalledZcodeAccess({ app, dialog, storage, mas: true, home: () => root }),
    get saved() { return saved; }, set saved(value) { saved = value; } };
}
test('ZCode pair has independent purposes, short native pickers and balanced restored leases', async t => {
  const f = await fixture(t), access = f.make(); assert.equal((await access.getStatus()).status, 'needs-authorization');
  f.picks.push(f.pick(f.appDir, 'app'), f.pick(f.accountDir, 'account'));
  assert.deepEqual(await access.ensure({ interactive: true }), { status: 'stored', changed: true });
  assert.equal(f.saved.app.purpose, 'installed-app'); assert.equal(f.saved.account.purpose, 'zcode-official-account');
  assert.equal(f.requests[0].title, '选择已安装的 ZCode'); assert.equal(f.requests[1].title, '授权 ZCode 账号目录');
  assert.ok(f.requests.every(row => row.securityScopedBookmarks === true && row.message === undefined));
  const restored = f.make(); assert.equal((await restored.ensure()).status, 'stored'); assert.equal(f.requests.length, 2);
  assert.equal(await restored.directoryAccess.withAccess('zcode', directory => directory), f.accountDir);
  const lease = await restored.installedAppAccess.acquire('zcode'); lease.release(); lease.release();
  assert.equal(f.events.filter(x => x.startsWith('open:')).length, f.events.filter(x => x.startsWith('stop:')).length);
});
test('cancel or invalid second selection preserves prior pair and staged app choice', async t => {
  const f = await fixture(t), access = f.make();
  f.picks.push(f.pick(f.appDir, 'app')); assert.equal((await access.ensure({ interactive: true, step: 'app' })).status, 'app-authorized');
  f.picks.push(f.pick(f.root, 'wrong')); assert.equal((await access.ensure({ interactive: true, step: 'account' })).status, 'invalid-directory'); assert.equal(f.saved, null);
  f.picks.push(f.pick(f.accountDir, 'account')); await access.ensure({ interactive: true, step: 'account' });
  f.saved.app.bookmark = 'expired'; const before = structuredClone(f.saved);
  f.picks.push({ canceled: true }); assert.equal((await access.ensure({ interactive: true })).status, 'cancelled'); assert.deepEqual(f.saved, before);
});
test('revoke invalidates live scope immediately and discards late native selections', async t => {
  const f = await fixture(t), access = f.make(); f.picks.push(f.pick(f.appDir, 'app'), f.pick(f.accountDir, 'account')); await access.ensure({ interactive: true });
  const lease = await access.directoryAccess.acquire('zcode'); assert.equal(lease.isCurrent(), true); const revoke = access.revoke(); assert.equal(lease.isCurrent(), false); await revoke; lease.release();
  assert.equal(f.saved, null);
  let release, entered; const gate = new Promise(resolve => { entered = resolve; });
  f.picks.push(() => new Promise(resolve => { release = resolve; entered(); }));
  const pending = access.ensure({ interactive: true }); const rejected = assert.rejects(pending, { code: 'CANCELLED' }); await gate;
  const removed = access.revoke(); release(f.pick(f.appDir, 'late')); await rejected; await removed; assert.equal(f.saved, null);
});
test('foreign grants and ordinary Electron never claim ZCode native authority', async t => {
  const f = await fixture(t); f.saved = { kind: 'installed-workbuddy-quota-account-v1', account: { directory: f.accountDir, bookmark: 'foreign', purpose: 'zcode-official-account' } };
  await assert.rejects(f.make().directoryAccess.acquire('zcode'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  const ordinary = createMasInstalledZcodeAccess({ app: f.app, dialog: f.dialog, storage: f.storage, mas: false });
  assert.equal((await ordinary.ensure({ interactive: true })).status, 'unavailable'); assert.equal(f.requests.length, 0);
});
