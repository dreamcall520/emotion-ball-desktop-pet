'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createCodexChatRpc } = require('./codex-chat-rpc');

const EXECUTABLES = Object.freeze([
  'Contents/Resources/codex',
  'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
]);
const METHODS = Object.freeze(['readAccount', 'readRateLimits', 'listModels', 'startThread', 'resumeThread',
  'startTurn', 'nameThread', 'readThreadEnvironment', 'verifyThreadEnvironment', 'interruptTurn']);
function failure(code) { return Object.assign(new Error(code), { code }); }
function within(root, target) { return target === root || target.startsWith(root + path.sep); }

// Both ports use createMasDirectoryAccess's acquire('codex') lease contract.
// installedAppAccess must represent an explicit App selection; directoryAccess
// must represent explicit account-client permission, NEVER the task-read grant.
// Authorizing/persisting those separate purposes belongs to the main process.
// Starting the original CLI can write its own logs/cache/session; this adapter
// neither copies credentials nor promises that the original profile is read-only.
async function createInstalledCodexChatRpc({ installedAppAccess, directoryAccess, workspaceDir,
  fs: fileSystem = fs, spawn: spawnChild = spawn, createRpc = createCodexChatRpc,
  timeoutMs, closeTimeoutMs = 6000, purpose = 'chat', getWeatherContext, onNotification, onDisconnect } = {}) {
  if (!installedAppAccess || typeof installedAppAccess.acquire !== 'function' ||
      !directoryAccess || typeof directoryAccess.acquire !== 'function' ||
      typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0') ||
      !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('Explicit App/account access and container workspace are required');
  const leases = [];
  let released = false, child = null, exited = false, resolveExit, rpc, closed = false, closing;
  const childExit = new Promise(resolve => { resolveExit = resolve; });
  function release() {
    if (released) return;
    released = true;
    // Release both scopes even when one native stop function fails.
    for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} }
  }
  function confirmExit() { exited = true; resolveExit(); release(); }
  async function directory(port) {
    const lease = await port.acquire('codex');
    if (!lease || typeof lease.release !== 'function') throw failure('DIRECTORY_ACCESS_REQUIRED');
    leases.push(lease);
    const value = lease.directory;
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw failure('UNSAFE_CONFIG');
    const normalized = path.resolve(value);
    const stat = await fileSystem.promises.lstat(normalized);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fileSystem.promises.realpath(normalized) !== normalized) throw failure('UNSAFE_CONFIG');
    return normalized;
  }
  try {
    const appDirectory = await directory(installedAppAccess);
    if (!['Codex.app', 'ChatGPT.app'].includes(path.basename(appDirectory))) throw failure('UNSAFE_CONFIG');
    const codexDirectory = await directory(directoryAccess);
    if (path.basename(codexDirectory) !== '.codex') throw failure('UNSAFE_CONFIG');
    const workspace = path.resolve(workspaceDir);
    if (within(appDirectory, workspace) || within(codexDirectory, workspace)) throw failure('UNSAFE_CONFIG');
    const workspaceStat = await fileSystem.promises.lstat(workspace);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() || await fileSystem.promises.realpath(workspace) !== workspace) throw failure('UNSAFE_CONFIG');
    let binaryPath;
    for (const relative of EXECUTABLES) {
      const candidate = path.join(appDirectory, relative);
      try {
        const stat = await fileSystem.promises.lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || await fileSystem.promises.realpath(candidate) !== candidate) throw failure('UNSAFE_CONFIG');
        await fileSystem.promises.access(candidate, fs.constants.X_OK);
        binaryPath = candidate; break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!binaryPath) throw failure('MISSING');
    const home = path.dirname(codexDirectory);
    rpc = createRpc({ binaryPath, workspaceDir: workspace, fs: fileSystem,
      homedir: () => home, env: { HOME: home, CODEX_HOME: codexDirectory, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      webSocket: null, disableOptionalTelemetry: true, timeoutMs, purpose, getWeatherContext, onNotification, onDisconnect,
      spawn: (...args) => {
        if (closed || child) throw failure('CLOSED');
        child = spawnChild(...args);
        child.once('exit', confirmExit);
        child.once('close', confirmExit);
        // A failed spawn has no process to wait for. Errors on an existing
        // process do not prove termination and must not release its scopes.
        child.on('error', () => { if (!child.pid) confirmExit(); });
        return child;
      }
    });
  } catch (error) { release(); throw error; }

  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await rpc.close(); }
      finally { if (!child || exited) release(); }
      if (child && !exited) {
        let timer;
        try {
          await Promise.race([childExit, new Promise((_, reject) => {
            timer = setTimeout(() => reject(failure('PROCESS_EXIT_UNCONFIRMED')), closeTimeoutMs);
          })]);
        } finally { clearTimeout(timer); }
      }
    })();
    return closing;
  }
  const facade = { source: 'installed', start: async () => {
    if (closed || exited) throw failure('CLOSED');
    try { return await rpc.start(); }
    catch (error) { try { await close(); } catch {} throw error; }
  }, close };
  for (const method of METHODS) facade[method] = (...args) => {
    if (closed || exited) return Promise.reject(failure('CLOSED'));
    return rpc[method](...args);
  };
  // No raw request, login, logout, alternate profile or executable override.
  return Object.freeze(facade);
}
module.exports = { createInstalledCodexChatRpc };
