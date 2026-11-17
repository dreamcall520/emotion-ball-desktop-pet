'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const KIND = 'installed-codex-account-client-v1';
const fail = code => Object.assign(new Error(code), { code });

// Separate storage from task-read grants. A single atomic save commits both
// selections, so cancellation/failure never replaces an already usable pair.
function createMasInstalledCodexAccess({ app, dialog, storage, mas = process.mas === true, home = () => process.mas === true ? os.userInfo().homedir : app.getPath('home') } = {}) {
  if (!app || !dialog || !storage) throw new TypeError('app, dialog and storage are required');
  const supported = mas === true && typeof app.startAccessingSecurityScopedResource === 'function';
  let pending = Promise.resolve(), pendingApp;
  function valid(record) { return record?.kind === KIND && record.app?.purpose === 'installed-app' && record.account?.purpose === 'codex-account-client'; }
  async function lease(grant, kind) {
    if (!supported || !grant || typeof grant.bookmark !== 'string' || !grant.bookmark ||
      typeof grant.directory !== 'string' || !path.isAbsolute(grant.directory) || grant.directory.includes('\0') ||
      (kind === 'app' ? !['Codex.app','ChatGPT.app'].includes(path.basename(grant.directory)) : path.basename(grant.directory) !== '.codex')) throw fail('DIRECTORY_ACCESS_REQUIRED');
    let stop;
    try { stop = app.startAccessingSecurityScopedResource(grant.bookmark); } catch { throw fail('DIRECTORY_ACCESS_REQUIRED'); }
    if (typeof stop !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
    let done = false;
    const release = () => { if (!done) { done = true; stop(); } };
    try {
      const stat = await fs.lstat(grant.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(grant.directory) !== path.resolve(grant.directory)) throw fail('DIRECTORY_ACCESS_REQUIRED');
    } catch { release(); throw fail('DIRECTORY_ACCESS_REQUIRED'); }
    return { directory: grant.directory, release };
  }
  async function acquire(kind) {
    await pending;
    const stored = await storage.load('codex');
    if (!valid(stored)) throw fail('DIRECTORY_ACCESS_REQUIRED');
    return lease(stored[kind], kind);
  }
  async function usable(grant, kind) {
    try { const value = await lease(grant, kind); value.release(); return true; } catch { return false; }
  }
  function ensure({ interactive = false, signal, step } = {}) {
    const current = pending.catch(() => {}).then(async () => {
      const check = () => { if(signal?.aborted)throw fail('CANCELLED'); };
      check();
      if (!supported) return { status: 'unavailable' };
      const before = await storage.load('codex');
      const next = valid(before) ? structuredClone(before) : { kind: KIND };
      if (step === 'app') pendingApp = undefined;
      if (step === 'account' && pendingApp) next.app = pendingApp;
      for (const kind of ['app','account']) {
        check();
        if (await usable(next[kind], kind)) {
          if (step === 'app' && kind === 'app') return { status: 'app-authorized' };
          continue;
        }
        if (step === 'account' && kind === 'app') return { status: 'needs-app' };
        if (!interactive) return { status: 'needs-authorization' };
        const isApp = kind === 'app';
        const selected = await dialog.showOpenDialog({
          title: isApp ? '选择已安装的 ChatGPT' : '授权 Codex 账号目录',
          buttonLabel: isApp ? '允许使用此应用' : '允许使用此目录',
          defaultPath: isApp ? '/Applications/ChatGPT.app' : path.join(home(), '.codex'),
          ...(!isApp && !step ? { message:
            '官方组件可能更新目录中的日志、会话或缓存。任务日志只读同步是独立授权。' } : {}),
          properties: isApp ? ['openFile'] : ['openDirectory','showHiddenFiles'],
          ...(isApp?{filters:[{name:'应用程序',extensions:['app']}]}:{}),
          securityScopedBookmarks: true
        });
        check();
        if (selected?.canceled) return { status: 'cancelled' };
        if (selected?.filePaths?.length !== 1 || selected?.bookmarks?.length !== 1) throw fail('DIRECTORY_ACCESS_REQUIRED');
        const grant = { directory: selected.filePaths[0], bookmark: selected.bookmarks[0], purpose: isApp ? 'installed-app' : 'codex-account-client' };
        let verification;
        try { verification = await lease(grant, kind); }
        catch (error) {
          if (step && error.code === 'DIRECTORY_ACCESS_REQUIRED') return { status: isApp ? 'invalid-app' : 'invalid-directory' };
          throw error;
        }
        verification.release();
        check();
        if (step === 'app') {
          pendingApp = grant;
          return { status: 'app-authorized' };
        }
        next[kind] = grant;
      }
      check();
      const changed=JSON.stringify(before)!==JSON.stringify(next);
      if(changed)await storage.save('codex',next);
      if (step === 'account') pendingApp = undefined;
      return {status:'stored',...(changed?{changed:true}:{})};
    });
    pending = current.then(() => {}, () => {});
    return current;
  }
  return { ensure,
    installedAppAccess: { acquire: provider => { if (provider !== 'codex') throw fail('INVALID_PROVIDER'); return acquire('app'); } },
    directoryAccess: { acquire: provider => { if (provider !== 'codex') throw fail('INVALID_PROVIDER'); return acquire('account'); } },
    async getStatus() { const value = await ensure(); return { status: value.status }; },
    clearPendingApp() { pendingApp = undefined; },
    revoke() {
      const current=pending.catch(()=>{}).then(async()=>{pendingApp=undefined;await storage.remove('codex');return{status:'needs-authorization'};});
      pending=current.then(()=>{},()=>{});return current;
    }
  };
}
module.exports = { createMasInstalledCodexAccess };
