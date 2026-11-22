'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createZcodeChatRpc } = require('./zcode-chat-rpc');
const { isTeam } = require('./zcode-team-auth');
const fail = code => Object.assign(new Error(code), { code });
const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const within = (root, target) => target === root || target.startsWith(root + path.sep);
const METHODS = ['readAccount', 'listModels', 'startThread', 'resumeThread', 'startTurn', 'interruptTurn'];
function officialChatScope(account) {
  const codingPlan = ['individual-coding-plan', 'team-coding-plan'].includes(account?.selection?.kind);
  return { available: false, source: 'official',
    code: codingPlan ? 'CODING_PLAN_SCOPE_UNSUPPORTED' : 'ZCODE_START_PLAN_SCOPE_UNVERIFIED',
    message: codingPlan ? '当前套餐仅限官方支持的工具，暂不能用于球球聊天。' : '尚未确认 ZCode 体验额度可用于球球聊天，请在 ZCode 中使用。' };
}

// The selected original component owns its runtime; it is never copied, patched,
// re-signed or bundled. Account material comes from the separate scoped reader.
async function createInstalledZcodeChatRpc({ installedAppAccess, directoryAccess, workspaceDir, readAccount,
  fetchUsage, requestJson, resolveTeamAccount = async account => {
    if (isTeam(account) && !account.codingPlanApiKey) throw fail('ZCODE_TEAM_KEY_MISSING');
    return account;
  }, expectedAccountKey, getAuthorizedAccountKey, getChatGrantEpoch = () => 0,
  fs: io = fs, spawn: spawnChild = spawn, createRpc = createZcodeChatRpc, env = process.env,
  timeoutMs, closeTimeoutMs = 6000, signal, getWeatherContext, onNotification, onDisconnect } = {}) {
  if (!installedAppAccess?.acquire || !directoryAccess?.acquire || typeof readAccount !== 'function' ||
    !validAccount(expectedAccountKey) || typeof getAuthorizedAccountKey !== 'function' ||
    typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0') ||
    !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('Explicit ZCode App/account grants and current-account chat consent are required');
  const leases = [], owner = getChatGrantEpoch();
  if (!Number.isSafeInteger(owner) || owner < 0) throw fail('CHAT_AUTHORIZATION_REQUIRED');
  let rpc, child, exited = false, closed = false, released = false, closing, resolveExit, notifications = Promise.resolve();
  const exit = new Promise(resolve => { resolveExit = resolve; });
  function release() {
    if (released) return; released = true;
    signal?.removeEventListener('abort', abort);
    for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} }
  }
  function confirmExit() { exited = true; resolveExit(); release(); }
  function current() {
    try { return !closed && !released && !exited && !signal?.aborted && getAuthorizedAccountKey() === expectedAccountKey && getChatGrantEpoch() === owner &&
      leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent()); } catch { return false; }
  }
  function check() { if (!current()) throw fail(signal?.aborted ? 'CANCELLED' : 'CHAT_AUTHORIZATION_REQUIRED'); }
  async function account() {
    check(); const latest = await readAccount(); check();
    if (latest?.accountKey !== expectedAccountKey || !['zai', 'bigmodel'].includes(latest.family)) throw fail('UNAUTHENTICATED');
    // A configured custom provider can never become this official-account source.
    const { personal: _personal, ...official } = latest; return official;
  }
  async function directory(port, kind) {
    const lease = await port.acquire('zcode');
    if (!lease || typeof lease.release !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
    leases.push(lease); check();
    const value = lease.directory;
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
      path.basename(value) !== (kind === 'app' ? 'ZCode.app' : '.zcode')) throw fail('DIRECTORY_ACCESS_REQUIRED');
    const resolved = path.resolve(value), stat = await io.promises.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await io.promises.realpath(resolved) !== resolved) throw fail('UNSAFE_CONFIG');
    return resolved;
  }
  async function regular(file, executable = false) {
    const stat = await io.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await io.promises.realpath(file) !== file) throw fail('UNSAFE_CONFIG');
    if (executable) await io.promises.access(file, fs.constants.X_OK);
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await rpc?.close(); }
      finally { if (!child || exited) release(); }
      if (child && !exited) {
        let timer;
        try { await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('PROCESS_EXIT_UNCONFIRMED')), closeTimeoutMs); })]); }
        finally { clearTimeout(timer); }
      }
    })();
    return closing;
  }
  function abort() { void close().catch(() => {}); }
  try {
    check(); const appDirectory = await directory(installedAppAccess, 'app'), accountDirectory = await directory(directoryAccess, 'account');
    const workspace = path.resolve(workspaceDir), stat = await io.promises.lstat(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await io.promises.realpath(workspace) !== workspace ||
      within(appDirectory, workspace) || within(accountDirectory, workspace)) throw fail('UNSAFE_CONFIG');
    const executable = path.join(appDirectory, 'Contents/MacOS/ZCode');
    for (const file of [executable, path.join(appDirectory, 'Contents/Resources/glm/zcode.cjs'),
      path.join(appDirectory, 'Contents/Resources/config/provider/zcode-builtin.json'), path.join(appDirectory, 'Contents/Info.plist')]) await regular(file, file === executable);
    await account();
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
      /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|LANG|LC_ALL|TMPDIR)$/.test(key) && typeof value === 'string'));
    childEnv.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    rpc = createRpc({ workspaceDir: workspace, home: path.dirname(accountDirectory), appDirectory,
      runtimeHome: path.join(workspace, 'runtime-home'), officialOnly: true, strictOfficialSelection: true,
      readAccount: account, resolveTeamAccount, ...(fetchUsage ? { fetchUsage } : {}), ...(requestJson ? { requestJson } : {}),
      env: childEnv, executable, timeoutMs, getWeatherContext,
      onNotification: packet => {
        notifications = notifications.then(async () => { await account(); if (current()) onNotification?.(packet); }).catch(error => {
          if (current()) onDisconnect?.(error.code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'DISCONNECTED');
          void close().catch(() => {});
        });
      },
      onDisconnect: code => {
        try { if (!closed && !signal?.aborted && getAuthorizedAccountKey() === expectedAccountKey && getChatGrantEpoch() === owner &&
          leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent())) onDisconnect?.(code); } catch {}
        void close().catch(() => {});
      },
      spawn: (...args) => {
        check(); if (child) throw fail('CLOSED'); child = spawnChild(...args);
        child.once('exit', confirmExit); child.once('close', confirmExit);
        child.on('error', () => { if (!child.pid) confirmExit(); }); return child;
      }
    });
    signal?.addEventListener('abort', abort, { once: true }); check();
  } catch (error) { release(); throw error; }
  const facade = { source: 'installed-zcode-official', getChatScope: async () => officialChatScope(await account()), start: async () => {
    try { await account(); const result = await rpc.start(); check(); await account(); return result; }
    catch (error) { try { await close(); } catch {} throw error; }
  }, close };
  for (const method of METHODS) facade[method] = async (...args) => {
    if (closed || exited) throw fail('CLOSED');
    try {
      const selected = await account();
      // Official runtime availability is not permission to use an unsupported
      // subscription in a third-party chat product. No silent billing fallback.
      if (method === 'startTurn') throw fail(officialChatScope(selected).code);
      const result = await rpc[method](...args); check(); await account(); return result;
    }
    catch (error) {
      if (!current() || error.code === 'UNAUTHENTICATED') { void close().catch(() => {}); throw fail(error.code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'CHAT_AUTHORIZATION_REQUIRED'); }
      throw error;
    }
  };
  return Object.freeze(facade);
}
const SAFE_RUN_ERRORS = new Set(['INVALID_REQUEST', 'DIRECTORY_ACCESS_REQUIRED', 'CANCELLED', 'TIMEOUT', 'PROCESS_EXIT_UNCONFIRMED',
  'ZCODE_ACCOUNT_CHANGED', 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY', 'ZCODE_ACCOUNT_MISSING', 'ZCODE_INVALID_ACCOUNT_FILE',
  'ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED', 'ZCODE_CREDENTIAL_DECRYPT_FAILED', 'ZCODE_PROVIDER_UNSUPPORTED', 'ZCODE_LOGIN_REQUIRED',
  'ZCODE_TEAM_KEY_MISSING', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR', 'ZCODE_INVALID_RESPONSE', 'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_BILLING_ERROR', 'ZCODE_MAS_READ_ONLY']);
function safeAccount(value) {
  if (!validAccount(value?.accountKey) || !['zai', 'bigmodel'].includes(value.family) ||
    !['personal', 'team'].includes(value.selection?.scope) || ![null, 'start-plan', 'individual-coding-plan', 'team-coding-plan', 'api-key'].includes(value.selection?.kind)) throw fail('ZCODE_INVALID_RESPONSE');
  const result = { accountKey: value.accountKey, family: value.family, selection: { kind: value.selection.kind, scope: value.selection.scope } };
  for (const key of ['hasJwtToken', 'hasAccessToken', 'hasCodingPlanKey', 'hasDeviceMid']) {
    if (typeof value[key] !== 'boolean') throw fail('ZCODE_INVALID_RESPONSE'); result[key] = value[key];
  }
  return result;
}
function safeQuota(value) {
  if (!validAccount(value?.accountKey) || value.state !== 'connected' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 ||
    !['connected', 'empty', 'unavailable', 'error'].includes(value.balanceState) || !['connected', 'empty', 'unavailable', 'error'].includes(value.paidState) ||
    !Array.isArray(value.buckets) || value.buckets.length > 128 || !Array.isArray(value.modelIds) || value.modelIds.length > 128) throw fail('ZCODE_INVALID_RESPONSE');
  const buckets = value.buckets.map(row => {
    if (!row || row.sourceId !== 'zcode' || !['zcode-plan', 'coding-plan'].includes(row.source) ||
      typeof row.bucketId !== 'string' || !row.bucketId || row.bucketId.length > 600 ||
      typeof row.remaining !== 'number' || !Number.isFinite(row.remaining) || row.remaining < 0 || row.remaining > 100) throw fail('ZCODE_INVALID_RESPONSE');
    const result = {};
    for (const key of ['sourceId', 'source', 'id', 'bucketId', 'planId', 'entitlementId', 'label', 'planName', 'model', 'meter', 'unit', 'periodKind']) {
      if (row[key] === undefined) continue;
      if (typeof row[key] !== 'string' || row[key].length > 600 || /[\u0000-\u001f\u007f]/.test(row[key])) throw fail('ZCODE_INVALID_RESPONSE');
      result[key] = row[key];
    }
    for (const key of ['windowMinutes', 'remaining', 'resetsAt', 'expiresAt', 'total', 'remainingUnits', 'periodStart']) {
      if (row[key] === undefined) continue;
      if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)) throw fail('ZCODE_INVALID_RESPONSE');
      result[key] = row[key];
    }
    return result;
  });
  const modelIds = value.modelIds.map(id => { if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(id)) throw fail('ZCODE_INVALID_RESPONSE'); return id; });
  return { accountKey: value.accountKey, state: 'connected', buckets, windows: buckets, modelIds, updatedAt: value.updatedAt,
    balanceState: value.balanceState, paidState: value.paidState };
}
function createMasInstalledZcodeRunner({ access, fs: io = fs, spawnProcess = spawn, env = process.env,
  helper = path.join(__dirname, 'zcode-helper.cjs'), closeTimeoutMs = 6000, timeoutMs = 45000 } = {}) {
  if (!access?.installedAppAccess?.acquire || !access?.directoryAccess?.acquire || !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0 ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Explicit ZCode App/account access is required');
  return async function run(operation, payload = {}, { signal, now } = {}) {
    if (!['account-check', 'usage'].includes(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => key !== 'expectedAccountKey') || payload.expectedAccountKey !== undefined && !validAccount(payload.expectedAccountKey) ||
      operation === 'usage' && !validAccount(payload.expectedAccountKey)) throw fail('INVALID_REQUEST');
    const observedAt = typeof now === 'function' ? now() : now;
    if (observedAt !== undefined && (!Number.isSafeInteger(observedAt) || observedAt < 0)) throw fail('INVALID_REQUEST');
    const leases = []; let child, exited = false, released = false, resolveExit;
    const exit = new Promise(resolve => { resolveExit = resolve; });
    const release = () => { if (released) return; released = true; for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} } };
    const confirmExit = () => { exited = true; resolveExit(); release(); };
    const current = () => !signal?.aborted && leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent());
    const check = () => { if (!current()) throw fail('CANCELLED'); };
    async function directory(port, kind) {
      const lease = await port.acquire('zcode'); if (!lease || typeof lease.release !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
      leases.push(lease); check(); const value = lease.directory;
      if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || path.basename(value) !== (kind === 'app' ? 'ZCode.app' : '.zcode')) throw fail('DIRECTORY_ACCESS_REQUIRED');
      const stat = await io.promises.lstat(value);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await io.promises.realpath(value) !== path.resolve(value)) throw fail('DIRECTORY_ACCESS_REQUIRED');
      return path.resolve(value);
    }
    try {
      check(); const appDirectory = await directory(access.installedAppAccess, 'app'), accountDirectory = await directory(access.directoryAccess, 'account');
      const executable = path.join(appDirectory, 'Contents/MacOS/ZCode'), appAsar = path.join(appDirectory, 'Contents/Resources/app.asar');
      for (const file of [executable, appAsar]) { const stat = await io.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || await io.promises.realpath(file) !== file) throw fail('DIRECTORY_ACCESS_REQUIRED'); }
      await io.promises.access(executable, fs.constants.X_OK); check();
      const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
        /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|LANG|LC_ALL|TMPDIR)$/.test(key) && typeof value === 'string'));
      Object.assign(childEnv, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ELECTRON_RUN_AS_NODE: '1',
        QIUQIU_ZCODE_APP_DIRECTORY: appDirectory, QIUQIU_ZCODE_ACCOUNT_DIRECTORY: accountDirectory });
      const result = await new Promise((resolve, reject) => {
        let settled = false, buffer = '', bytes = 0, packet, timer;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (error && child && !exited) { try { child.kill(); } catch {} } error ? reject(error) : resolve(value); };
        const abort = () => finish(fail('CANCELLED'));
        function line(value) {
          if (!value.trim()) return;
          try { const next = JSON.parse(value);
            if (packet || !next || typeof next !== 'object' || !['result', 'error'].includes(next.type)) throw fail('ZCODE_INVALID_RESPONSE'); packet = next;
          } catch { finish(fail('ZCODE_INVALID_RESPONSE')); }
        }
        try {
          child = spawnProcess(executable, [helper], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          child.once('exit', confirmExit); child.once('close', confirmExit);
          child.on('error', () => { if (!child.pid) confirmExit(); finish(fail('ZCODE_INVALID_RESPONSE')); });
          child.stdin.on('error', () => finish(fail('ZCODE_INVALID_RESPONSE'))); child.stdout.on('error', () => finish(fail('ZCODE_INVALID_RESPONSE')));
          child.stderr.on('error', () => {}); child.stderr.resume(); child.stdout.setEncoding('utf8');
          child.stdout.on('data', chunk => { if (settled) return; bytes += Buffer.byteLength(chunk); buffer += chunk;
            if (bytes > 2 * 1024 * 1024) { finish(fail('ZCODE_INVALID_RESPONSE')); return; }
            let end; while (!settled && (end = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0, end); buffer = buffer.slice(end + 1); line(value); }
          });
          child.on('close', code => { if (settled) return; if (buffer.trim()) line(buffer); if (settled) return;
            if (packet?.type === 'error') finish(fail(SAFE_RUN_ERRORS.has(packet.code) ? packet.code : 'ZCODE_INVALID_RESPONSE'));
            else if (code === 0 && packet?.type === 'result') finish(null, packet.result); else finish(fail('ZCODE_INVALID_RESPONSE')); });
          timer = setTimeout(() => finish(fail('TIMEOUT')), Math.min(60000, Math.max(1, timeoutMs)));
          signal?.addEventListener('abort', abort, { once: true }); check();
          child.stdin.end(JSON.stringify({ operation, payload, ...(observedAt === undefined ? {} : { now: observedAt }) }));
        } catch (error) { finish(fail(SAFE_RUN_ERRORS.has(error.code) ? error.code : 'ZCODE_INVALID_RESPONSE')); }
      });
      check(); const projected = operation === 'account-check' ? safeAccount(result) : safeQuota(result);
      if (payload.expectedAccountKey !== undefined && projected.accountKey !== payload.expectedAccountKey) throw fail('ZCODE_ACCOUNT_CHANGED');
      return projected;
    } catch (error) { if (!current()) throw fail('CANCELLED'); throw fail(SAFE_RUN_ERRORS.has(error.code) ? error.code : 'ZCODE_INVALID_RESPONSE'); }
    finally {
      if (!child || exited) release();
      else {
        try { child.kill(); } catch {} let timer;
        try { await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('PROCESS_EXIT_UNCONFIRMED')), closeTimeoutMs); })]); }
        finally { clearTimeout(timer); }
      }
    }
  };
}
module.exports = { createInstalledZcodeChatRpc, createMasInstalledZcodeRunner, officialChatScope };
