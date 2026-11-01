'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const KIND = 'installed-codex-account-client-v1';
const fail = code => Object.assign(new Error(code), { code });

// Separate storage from task-read grants. A single atomic save commits both
// selections, so cancellation/failure never replaces an already usable pair.
function createMasInstalledCodexAccess({ app, dialog, storage, mas = process.mas === true } = {}) {
  if (!app || !dialog || !storage) throw new TypeError('app, dialog and storage are required');
  const supported = mas === true && typeof app.startAccessingSecurityScopedResource === 'function';
  let pending = Promise.resolve();
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
  function ensure({ interactive = false, signal } = {}) {
    const current = pending.catch(() => {}).then(async () => {
      const check = () => { if(signal?.aborted)throw fail('CANCELLED'); };
      check();
      if (!supported) return { status: 'unavailable' };
      const before = await storage.load('codex');
      const next = valid(before) ? structuredClone(before) : { kind: KIND };
      for (const kind of ['app','account']) {
        check();
        if (await usable(next[kind], kind)) continue;
        if (!interactive) return { status: 'needs-authorization' };
        const isApp = kind === 'app';
        const selected = await dialog.showOpenDialog({
          title: isApp ? '选择已安装的 Codex 应用' : '允许球球使用本机 Codex 账号',
          buttonLabel: isApp ? '允许使用此应用' : '允许使用原账号',
          defaultPath: isApp ? '/Applications/ChatGPT.app' : path.join(app.getPath('home'), '.codex'),
          message: isApp ? '选择已安装的 ChatGPT.app 或 Codex.app。球球将调用其中的官方组件查询额度及提供聊天，不修改原应用。' :
            '复用原应用已登录的账号查询额度及提供聊天；官方组件可能更新原目录中的运行日志、会话或缓存。球球不复制登录凭据，不主动登录、退出或换号，不修改原配置。连接不会自动发送模型消息；发送聊天另行询问同意。任务日志只读同步是独立授权。',
          properties: isApp ? ['openFile'] : ['openDirectory','showHiddenFiles'],
          ...(isApp?{filters:[{name:'应用程序',extensions:['app']}]}:{}),
          securityScopedBookmarks: true
        });
        check();
        if (selected?.canceled) return { status: 'cancelled' };
        if (selected?.filePaths?.length !== 1 || selected?.bookmarks?.length !== 1) throw fail('DIRECTORY_ACCESS_REQUIRED');
        const grant = { directory: selected.filePaths[0], bookmark: selected.bookmarks[0], purpose: isApp ? 'installed-app' : 'codex-account-client' };
        const verification = await lease(grant, kind); verification.release();
        next[kind] = grant;
      }
      check();
      const changed=JSON.stringify(before)!==JSON.stringify(next);
      if(changed)await storage.save('codex',next);
      return {status:'stored',...(changed?{changed:true}:{})};
    });
    pending = current.then(() => {}, () => {});
    return current;
  }
  return { ensure,
    installedAppAccess: { acquire: provider => { if (provider !== 'codex') throw fail('INVALID_PROVIDER'); return acquire('app'); } },
    directoryAccess: { acquire: provider => { if (provider !== 'codex') throw fail('INVALID_PROVIDER'); return acquire('account'); } },
    async getStatus() { const value = await ensure(); return { status: value.status }; },
    revoke() {
      const current=pending.catch(()=>{}).then(async()=>{await storage.remove('codex');return{status:'needs-authorization'};});
      pending=current.then(()=>{},()=>{});return current;
    }
  };
}
module.exports = { createMasInstalledCodexAccess };
