'use strict';
const fs = require('node:fs');
const physicalFs = process.versions.electron ? require('original-fs') : fs;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { validAccount, METHODS, safeCode, callArguments, projectResult, projectNotification } = require('./zcode-official-chat-wire');
const fail = code => Object.assign(new Error(code), { code });
const within = (root, target) => target === root || target.startsWith(root + path.sep);
async function createMasZcodeOfficialChatRpc({ access, installedAppAccess = access?.installedAppAccess,
  directoryAccess = access?.directoryAccess, workspaceDir, expectedAccountKey, getAuthorizedAccountKey,
  getChatGrantEpoch = () => 0, signal, onNotification = () => {}, onDisconnect = () => {}, getWeatherContext = () => '',
  fs: io = physicalFs, spawnProcess = spawn, env = process.env, timeoutMs = 45000, closeTimeoutMs = 10000,
  helper = path.join(__dirname, 'zcode-official-chat-helper.cjs') } = {}) {
  if (!installedAppAccess?.acquire || !directoryAccess?.acquire || !validAccount(expectedAccountKey) ||
    typeof getAuthorizedAccountKey !== 'function' || typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0') ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('Explicit official ZCode account and App grants are required');
  const owner = getChatGrantEpoch(), leases = [], pending = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
  if (!Number.isSafeInteger(owner) || owner < 0) throw fail('CHAT_AUTHORIZATION_REQUIRED');
  let child, nextId = 0, closed = false, exited = false, runtimeActive = false, released = false, closing;
  let buffer = Buffer.alloc(0), resolveExit;
  const exit = new Promise(resolve => { resolveExit = resolve; });
  function authorized() {
    try { return !signal?.aborted && getAuthorizedAccountKey() === expectedAccountKey && getChatGrantEpoch() === owner &&
      leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent()); } catch { return false; }
  }
  function check() { if (!authorized()) throw fail(signal?.aborted ? 'CANCELLED' : 'CHAT_AUTHORIZATION_REQUIRED'); }
  function release() {
    if (released) return; released = true; signal?.removeEventListener('abort', abort);
    for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} }
  }
  function rejectPending(code) { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(fail(code)); } pending.clear(); }
  async function close() {
    if (closing) return closing;
    closed = true; rejectPending('CLOSED');
    closing = (async () => {
      if (!child) { release(); return; }
      if (!exited) {
        try { child.stdin.end(JSON.stringify({ id: ++nextId, method: 'close' }) + '\n'); } catch {}
        let timer;
        try { await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('PROCESS_EXIT_UNCONFIRMED')), closeTimeoutMs); })]); }
        finally { clearTimeout(timer); }
      }
      if (runtimeActive) throw fail('PROCESS_EXIT_UNCONFIRMED');
      release();
    })();
    return closing;
  }
  function abort() { void close().catch(() => {}); }
  function disconnect(code) {
    const deliver = !closed && authorized();
    rejectPending(safeCode(code));
    if (deliver) { try { onDisconnect(safeCode(code)); } catch {} }
    void close().catch(() => {});
  }
  function packet(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_FRAME');
    if (value.type === 'runtime') {
      if (value.state === 'started' && !runtimeActive) runtimeActive = true;
      else if (value.state === 'exited' && runtimeActive) runtimeActive = false;
      else throw fail('INVALID_FRAME');
      return;
    }
    if (value.type === 'closed') { if (runtimeActive) throw fail('PROCESS_EXIT_UNCONFIRMED'); return; }
    if (value.type === 'notification') {
      if (closed) return; check(); onNotification(projectNotification(value.packet)); return;
    }
    if (value.type === 'disconnect') { disconnect(value.code); return; }
    const entry = pending.get(value.id);
    if (!entry) { if (closed) return; throw fail('INVALID_FRAME'); }
    pending.delete(value.id); clearTimeout(entry.timer);
    try {
      check();
      if (value.type === 'error') entry.reject(fail(safeCode(value.code)));
      else if (Object.hasOwn(value, 'result')) {
        const result = entry.method === 'initialize' ? null : projectResult(entry.method, value.result);
        if (['readAccount', 'getConsentIdentity'].includes(entry.method) && result.accountKey !== expectedAccountKey) throw fail('ZCODE_ACCOUNT_CHANGED');
        entry.resolve(result);
      } else throw fail('INVALID_FRAME');
    } catch (error) { entry.reject(fail(safeCode(error.code))); if (!authorized() || error.code === 'ZCODE_ACCOUNT_CHANGED') void close().catch(() => {}); }
  }
  function onData(chunk) {
    try {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 512 * 1024) throw fail('INVALID_FRAME');
      let end; while ((end = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        if (line.length) packet(JSON.parse(decoder.decode(line)));
      }
    } catch (error) { disconnect(error.code || 'INVALID_FRAME'); }
  }
  function request(method, args, extra = {}) {
    if (closed || exited) return Promise.reject(fail('CLOSED'));
    try { check(); } catch (error) { void close().catch(() => {}); return Promise.reject(error); }
    if (pending.size >= 8) return Promise.reject(fail('BUSY'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { disconnect('TIMEOUT'); }, Math.min(60000, timeoutMs));
      pending.set(id, { method, resolve, reject, timer });
      try { child.stdin.write(JSON.stringify({ id, method, ...(args ? { args } : {}), ...extra }) + '\n'); }
      catch { disconnect('DISCONNECTED'); }
    });
  }
  async function directory(port, name) {
    const lease = await port.acquire('zcode');
    if (!lease || typeof lease.release !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
    leases.push(lease); check(); const value = lease.directory;
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.basename(value) !== name || value.includes('\0')) throw fail('DIRECTORY_ACCESS_REQUIRED');
    const resolved = path.resolve(value), stat = await io.promises.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await io.promises.realpath(resolved) !== resolved) throw fail('DIRECTORY_ACCESS_REQUIRED');
    return resolved;
  }
  try {
    check(); const appDirectory = await directory(installedAppAccess, 'ZCode.app'), directoryPath = await directory(directoryAccess, '.zcode');
    const workspace = path.resolve(workspaceDir), stat = await io.promises.lstat(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await io.promises.realpath(workspace) !== workspace ||
      within(appDirectory, workspace) || within(directoryPath, workspace)) throw fail('UNSAFE_CONFIG');
    const executable = path.join(appDirectory, 'Contents/MacOS/ZCode');
    for (const file of [executable, path.join(appDirectory, 'Contents/Resources/glm/zcode.cjs'),
      path.join(appDirectory, 'Contents/Resources/app.asar'), path.join(appDirectory, 'Contents/Resources/config/provider/zcode-builtin.json')]) {
      const entry = await io.promises.lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || await io.promises.realpath(file) !== file) throw fail('UNSAFE_CONFIG');
    }
    await io.promises.access(executable, fs.constants.X_OK); check();
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
      /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|LANG|LC_ALL|TMPDIR)$/.test(key) && typeof value === 'string'));
    Object.assign(childEnv, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ELECTRON_RUN_AS_NODE: '1',
      QIUQIU_ZCODE_APP_DIRECTORY: appDirectory, QIUQIU_ZCODE_ACCOUNT_DIRECTORY: directoryPath, QIUQIU_ZCODE_WORKSPACE_DIRECTORY: workspace });
    child = spawnProcess(executable, [helper], { cwd: workspace, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', onData); child.stderr.resume();
    child.on('close', () => { exited = true; resolveExit(); if (!runtimeActive) release();
      if (!closed) disconnect(runtimeActive ? 'PROCESS_EXIT_UNCONFIRMED' : 'DISCONNECTED'); });
    child.on('error', () => { if (!child.pid) { exited = true; resolveExit(); release(); } disconnect('DISCONNECTED'); });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => disconnect('DISCONNECTED'));
    signal?.addEventListener('abort', abort, { once: true }); check();
    await request('initialize', null, { expectedAccountKey }); check();
  } catch (error) {
    try { await close(); } catch (closeError) { throw closeError; }
    throw fail(safeCode(error.code));
  }
  const facade = { source: 'installed-zcode-official', close };
  for (const method of METHODS) facade[method] = async (...args) => {
    const safeArgs = callArguments(method, args); let weatherContext = '';
    if (method === 'startTurn') { try { const value = getWeatherContext(safeArgs[1]); if (typeof value === 'string') weatherContext = value.slice(0, 1000).replaceAll('\0', ''); } catch {} }
    return request(method, safeArgs, weatherContext ? { weatherContext } : {});
  };
  return Object.freeze(facade);
}
module.exports = { createMasZcodeOfficialChatRpc };
