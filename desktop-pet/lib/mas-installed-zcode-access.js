'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const KIND = 'installed-zcode-official-account-v1';
const fail = code => Object.assign(new Error(code), { code });

// Only this pair authorizes the installed ZCode component and official account.
// Task-read grants and another provider never supply this authority. Both native
// choices commit atomically; cancellation preserves a previous usable pair.
function createMasInstalledZcodeAccess({ app, dialog, storage, mas = process.mas === true,
  home = () => process.mas === true ? os.userInfo().homedir : app.getPath('home') } = {}) {
  if (!app || !dialog || !storage) throw new TypeError('app, dialog and storage are required');
  const supported = mas === true && typeof app.startAccessingSecurityScopedResource === 'function';
  let pending = Promise.resolve(), pendingApp, epoch = 0, selectionEpoch = 0;
  const valid = record => record?.kind === KIND && record.app?.purpose === 'installed-app' &&
    record.account?.purpose === 'zcode-official-account';
  async function lease(grant, kind) {
    if (!supported || !grant || typeof grant.bookmark !== 'string' || !grant.bookmark ||
      typeof grant.directory !== 'string' || !path.isAbsolute(grant.directory) || grant.directory.includes('\0') ||
      (kind === 'app' ? path.basename(grant.directory) !== 'ZCode.app' :
        path.basename(grant.directory) !== '.zcode')) throw fail('DIRECTORY_ACCESS_REQUIRED');
    let stop;
    try { stop = app.startAccessingSecurityScopedResource(grant.bookmark); } catch { throw fail('DIRECTORY_ACCESS_REQUIRED'); }
    if (typeof stop !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
    let released = false;
    const release = () => { if (!released) { released = true; try { stop(); } catch {} } };
    try {
      const stat = await fs.lstat(grant.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(grant.directory) !== path.resolve(grant.directory)) {
        throw fail('DIRECTORY_ACCESS_REQUIRED');
      }
    } catch { release(); throw fail('DIRECTORY_ACCESS_REQUIRED'); }
    const owner = epoch;
    return { directory: grant.directory, release, isCurrent: () => epoch === owner };
  }
  async function usable(grant, kind) {
    try { const value = await lease(grant, kind); value.release(); return true; } catch { return false; }
  }
  async function acquire(kind) {
    const owner = epoch;
    await pending;
    if (owner !== epoch) throw fail('CANCELLED');
    const stored = await storage.load('zcode');
    if (!valid(stored)) throw fail('DIRECTORY_ACCESS_REQUIRED');
    const value = await lease(stored[kind], kind);
    if (owner !== epoch) { value.release(); throw fail('CANCELLED'); }
    return value;
  }
  function ensure({ interactive = false, signal, step } = {}) {
    const requested = selectionEpoch;
    const current = pending.catch(() => {}).then(async () => {
      const check = () => { if (signal?.aborted || requested !== selectionEpoch) throw fail('CANCELLED'); };
      check();
      if (!supported) return { status: 'unavailable' };
      if (step !== undefined && !['app', 'account'].includes(step)) throw fail('INVALID_REQUEST');
      const before = await storage.load('zcode');
      const next = valid(before) ? structuredClone(before) : { kind: KIND };
      if (step === 'app') pendingApp = undefined;
      if (step === 'account' && pendingApp) next.app = pendingApp;
      for (const kind of ['app', 'account']) {
        check();
        const authorized = await usable(next[kind], kind); check();
        if (authorized) {
          if (step === 'app' && kind === 'app') return { status: 'app-authorized' };
          continue;
        }
        if (step === 'account' && kind === 'app') return { status: 'needs-app' };
        if (!interactive) return { status: 'needs-authorization' };
        const isApp = kind === 'app';
        const selected = await dialog.showOpenDialog({
          title: isApp ? '选择已安装的 ZCode' : '授权 ZCode 账号目录',
          buttonLabel: isApp ? '允许使用此应用' : '允许读取此目录',
          defaultPath: isApp ? '/Applications/ZCode.app' : path.join(home(), '.zcode'),
          properties: isApp ? ['openFile'] : ['openDirectory', 'showHiddenFiles'],
          ...(isApp ? { filters: [{ name: '应用程序', extensions: ['app'] }] } : {}),
          securityScopedBookmarks: true
        });
        check();
        if (selected?.canceled) return { status: 'cancelled' };
        if (selected?.filePaths?.length !== 1 || selected?.bookmarks?.length !== 1) throw fail('DIRECTORY_ACCESS_REQUIRED');
        const grant = { directory: selected.filePaths[0], bookmark: selected.bookmarks[0],
          purpose: isApp ? 'installed-app' : 'zcode-official-account' };
        try { const verification = await lease(grant, kind); verification.release(); }
        catch (error) {
          if (step && error.code === 'DIRECTORY_ACCESS_REQUIRED') return { status: isApp ? 'invalid-app' : 'invalid-directory' };
          throw error;
        }
        check();
        if (step === 'app') { pendingApp = grant; return { status: 'app-authorized' }; }
        next[kind] = grant;
      }
      check();
      const changed = JSON.stringify(before) !== JSON.stringify(next);
      if (changed) { await storage.save('zcode', next); check(); epoch++; }
      if (step === 'account') pendingApp = undefined;
      return { status: 'stored', ...(changed ? { changed: true } : {}) };
    });
    pending = current.then(() => {}, () => {});
    return current;
  }
  return { ensure,
    installedAppAccess: { acquire: provider => {
      if (provider !== 'zcode') throw fail('INVALID_PROVIDER'); return acquire('app');
    } },
    directoryAccess: {
      acquire: provider => { if (provider !== 'zcode') throw fail('INVALID_PROVIDER'); return acquire('account'); },
      async withAccess(provider, operation) {
        if (typeof operation !== 'function') throw new TypeError('An access operation is required');
        const value = await this.acquire(provider);
        try {
          if (!value.isCurrent()) throw fail('CANCELLED');
          const result = await operation(value.directory);
          if (!value.isCurrent()) throw fail('CANCELLED');
          return result;
        } finally { value.release(); }
      }
    },
    getGeneration() { return epoch; },
    async getStatus() { const value = await ensure(); return { status: value.status }; },
    clearPendingApp() { pendingApp = undefined; selectionEpoch++; },
    revoke() {
      // Invalidate running readers before a queued native dialog can finish.
      epoch++; selectionEpoch++; pendingApp = undefined;
      const current = pending.catch(() => {}).then(async () => {
        await storage.remove('zcode'); return { status: 'needs-authorization' };
      });
      pending = current.then(() => {}, () => {});
      return current;
    }
  };
}
module.exports = { createMasInstalledZcodeAccess };
