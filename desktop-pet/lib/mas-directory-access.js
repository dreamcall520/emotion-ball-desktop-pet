'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROVIDERS = new Set(['codex', 'zcode', 'workbuddy']);
const TITLES = { codex: '允许球球连接 Codex', zcode: '允许球球连接 ZCode', workbuddy: '允许球球连接 WorkBuddy' };
const MESSAGES = {
  codex: '球球将读取账号额度和任务日志。不会自动发送消息或执行任务。请直接允许连接。',
  zcode: '球球将读取账号套餐、历史任务和已有模型配置。不会自动发送消息；聊天沿用所选来源的计费方式。请直接允许连接。',
  workbuddy: '球球只读取原 WorkBuddy 的任务标题、历史状态和未读标记，不读取聊天正文或登录凭据。请直接允许连接。'
};
function accessError(code, reason) {
  const messages = {
    INVALID_PROVIDER: '不支持的工具。',
    DIRECTORY_ACCESS_REQUIRED: '请重新允许球球连接该工具。',
    INVALID_DIRECTORY: '选择的目录与该工具不匹配，请保留系统预选的位置后允许连接。',
    DIRECTORY_STORAGE_FAILED: '目录授权未能保存，请重试。'
  };
  return Object.assign(new Error(messages[code]), { code, reason });
}
function checkProvider(provider) {
  if (!PROVIDERS.has(provider)) throw accessError('INVALID_PROVIDER', 'unsupported-provider');
}
function validGrant(grant) {
  return grant && typeof grant.directory === 'string' && path.posix.isAbsolute(grant.directory) &&
    typeof grant.bookmark === 'string' && grant.bookmark.length > 0;
}

// Directory grants are explicit system selections. This module never scans home,
// opens provider data or exposes bookmarks through its public status results.
// storage must persist each save/remove atomically; a rejection is never a success.
// Dependency-injected tests cannot establish native bookmark validity or MAS approval.
// acquire() keeps one independent native scope alive until its idempotent release().
// Watchers must close their native observer before releasing that lease. withAccess()
// is for bounded operations and always releases in finally. revoke forgets the local
// grant; it does not terminate existing leases or change another App's permissions.
function createMasDirectoryAccess({ app, dialog, storage, purpose='read-data', validateDirectory = async directory => {
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Not a directory');
} } = {}) {
  if (!app || typeof app.startAccessingSecurityScopedResource !== 'function' ||
      !dialog || typeof dialog.showOpenDialog !== 'function' || !storage ||
      !['load', 'save', 'remove'].every(name => typeof storage[name] === 'function')) {
    throw new TypeError('app, dialog and atomic storage load/save/remove are required');
  }
  if(!['read-data','plugin-installation','receiver-pairing'].includes(purpose))throw new TypeError('Invalid directory authorization purpose');
  const pending = new Map();
  function mutation(provider, operation, recoverPreviousFailure = true) {
    const previous = pending.get(provider) || Promise.resolve();
    const current = (recoverPreviousFailure ? previous.catch(() => {}) : previous).then(operation);
    pending.set(provider, current);
    void current.finally(() => { if (pending.get(provider) === current) pending.delete(provider); }).catch(() => {});
    return current;
  }
  async function load(provider) {
    try { return await storage.load(provider); }
    catch (_) { throw accessError('DIRECTORY_STORAGE_FAILED', 'load-failed'); }
  }
  async function openLease(grant) {
    if (!validGrant(grant)) throw accessError('DIRECTORY_ACCESS_REQUIRED', 'missing-bookmark');
    let stop;
    try { stop = app.startAccessingSecurityScopedResource(grant.bookmark); }
    catch (_) { throw accessError('DIRECTORY_ACCESS_REQUIRED', 'bookmark-unavailable'); }
    if (typeof stop !== 'function') throw accessError('DIRECTORY_ACCESS_REQUIRED', 'bookmark-unavailable');
    let released = false;
    function release() {
      if (released) return;
      released = true;
      stop();
    }
    try {
      await validateDirectory(grant.directory);
    } catch (_) {
      release();
      throw accessError('DIRECTORY_ACCESS_REQUIRED', 'directory-unavailable');
    }
    return Object.freeze({ directory: grant.directory, release });
  }
  async function authorize(provider) {
    checkProvider(provider);
    return mutation(provider, async () => {
      const selection = await dialog.showOpenDialog({
        title: purpose==='receiver-pairing'?'允许球球连接已有任务插件':purpose==='plugin-installation'?'允许球球安装 '+(provider==='zcode'?'ZCode':'WorkBuddy')+' 任务插件':TITLES[provider], buttonLabel: purpose==='receiver-pairing'?'允许连接插件':purpose==='plugin-installation'?'允许安装插件':'允许连接',
        defaultPath: path.join(app.getPath('home'), '.' + provider), message: purpose==='receiver-pairing'?'只更新已安装球球插件的本机连接信息，不修改代码、市场、启用设置、聊天记录或账号凭据。':purpose==='plugin-installation'?'球球只安装自己的任务同步插件，并更新相应插件记录与启用设置。其他设置原样保留，不读取聊天记录或独立登录凭据文件，不发送模型消息。':MESSAGES[provider],
        properties: ['openDirectory', 'showHiddenFiles'], securityScopedBookmarks: true
      });
      if (selection?.canceled) return { status: 'cancelled' };
      if (!selection || selection.filePaths?.length !== 1 || selection.bookmarks?.length !== 1) {
        throw accessError('DIRECTORY_ACCESS_REQUIRED', 'missing-bookmark');
      }
      const grant = { directory: selection.filePaths[0], bookmark: selection.bookmarks[0] };
      // Reject a wrong selection before opening its scope or replacing an older grant.
      if (typeof grant.directory !== 'string' || path.basename(grant.directory) !== '.' + provider) {
        throw accessError('INVALID_DIRECTORY', 'provider-directory-mismatch');
      }
      // Verify the selected grant under its security scope before committing it.
      const verification = await openLease(grant);
      verification.release();
      try { await storage.save(provider, { ...grant }); }
      catch (_) { throw accessError('DIRECTORY_STORAGE_FAILED', 'save-failed'); }
      return { status: 'stored', directory: grant.directory };
    });
  }
  async function acquire(provider) {
    checkProvider(provider);
    // Serialize only acquisition, not the lease lifetime. A later revoke cannot race
    // an in-flight load and revive its grant; each live lease owns its own stop().
    return mutation(provider, async () => openLease(await load(provider)), false);
  }
  async function withAccess(provider, operation) {
    checkProvider(provider);
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    const lease = await acquire(provider);
    try { return await operation(lease.directory); }
    finally { lease.release(); }
  }
  async function getStatus(provider) {
    checkProvider(provider);
    if (pending.has(provider)) await pending.get(provider);
    const grant = await load(provider);
    // Stored is not a promise that macOS will still accept the bookmark.
    return validGrant(grant) ? { status: 'stored', directory: grant.directory } : { status: 'needs-authorization' };
  }
  async function revoke(provider) {
    checkProvider(provider);
    return mutation(provider, async () => {
      try { await storage.remove(provider); }
      catch (_) { throw accessError('DIRECTORY_STORAGE_FAILED', 'remove-failed'); }
      return { status: 'needs-authorization' };
    });
  }
  return { authorize, acquire, withAccess, getStatus, revoke };
}

module.exports = { createMasDirectoryAccess };
