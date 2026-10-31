'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROVIDERS = new Set(['codex', 'zcode', 'workbuddy']);
const TITLES = { codex: '选择 Codex 数据目录', zcode: '选择 ZCode 数据目录', workbuddy: '选择 WorkBuddy 数据目录' };
function accessError(code, reason) {
  const messages = {
    INVALID_PROVIDER: '不支持的工具。',
    DIRECTORY_ACCESS_REQUIRED: '请重新选择并授权工具数据目录。',
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

// This module is deliberately not wired to the App. It never scans a home directory,
// opens provider data or exposes bookmarks through its public status results.
// storage must persist each save/remove atomically; a rejection is never a success.
// Dependency-injected tests cannot establish native bookmark validity or MAS approval.
// revoke forgets the local grant; an already-running scoped operation releases it
// in its own finally block. It does not alter macOS permissions or another App.
function createMasDirectoryAccess({ app, dialog, storage, validateDirectory = async directory => {
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Not a directory');
} } = {}) {
  if (!app || typeof app.startAccessingSecurityScopedResource !== 'function' ||
      !dialog || typeof dialog.showOpenDialog !== 'function' || !storage ||
      !['load', 'save', 'remove'].every(name => typeof storage[name] === 'function')) {
    throw new TypeError('app, dialog and atomic storage load/save/remove are required');
  }
  const pending = new Map();
  function mutation(provider, operation) {
    const previous = pending.get(provider) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    pending.set(provider, current);
    void current.finally(() => { if (pending.get(provider) === current) pending.delete(provider); }).catch(() => {});
    return current;
  }
  async function load(provider) {
    try { return await storage.load(provider); }
    catch (_) { throw accessError('DIRECTORY_STORAGE_FAILED', 'load-failed'); }
  }
  async function scoped(grant, operation) {
    if (!validGrant(grant)) throw accessError('DIRECTORY_ACCESS_REQUIRED', 'missing-bookmark');
    let stop;
    try { stop = app.startAccessingSecurityScopedResource(grant.bookmark); }
    catch (_) { throw accessError('DIRECTORY_ACCESS_REQUIRED', 'bookmark-unavailable'); }
    if (typeof stop !== 'function') throw accessError('DIRECTORY_ACCESS_REQUIRED', 'bookmark-unavailable');
    try {
      try { await validateDirectory(grant.directory); }
      catch (_) { throw accessError('DIRECTORY_ACCESS_REQUIRED', 'directory-unavailable'); }
      return await operation(grant.directory);
    } finally {
      stop();
    }
  }
  async function authorize(provider) {
    checkProvider(provider);
    return mutation(provider, async () => {
      const selection = await dialog.showOpenDialog({
        title: TITLES[provider], buttonLabel: '授权此目录',
        properties: ['openDirectory', 'showHiddenFiles'], securityScopedBookmarks: true
      });
      if (selection?.canceled) return { status: 'cancelled' };
      if (!selection || selection.filePaths?.length !== 1 || selection.bookmarks?.length !== 1) {
        throw accessError('DIRECTORY_ACCESS_REQUIRED', 'missing-bookmark');
      }
      const grant = { directory: selection.filePaths[0], bookmark: selection.bookmarks[0] };
      // Verify the selected grant under its security scope before committing it.
      await scoped(grant, async () => {});
      try { await storage.save(provider, { ...grant }); }
      catch (_) { throw accessError('DIRECTORY_STORAGE_FAILED', 'save-failed'); }
      return { status: 'stored', directory: grant.directory };
    });
  }
  async function withAccess(provider, operation) {
    checkProvider(provider);
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    // Wait for a pending selection/revocation, but do not swallow its failure.
    if (pending.has(provider)) await pending.get(provider);
    return scoped(await load(provider), operation);
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
  return { authorize, withAccess, getStatus, revoke };
}

module.exports = { createMasDirectoryAccess };
