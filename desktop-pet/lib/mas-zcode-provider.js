'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readZcodeAccount } = require('./zcode-account');
const { fetchZcodeUsage } = require('./zcode-usage');
const { isTeam } = require('./zcode-team-auth');
const TERMINAL = Object.freeze({ completed: 'completed', error: 'failed', failed: 'failed', interrupted: 'interrupted', cancelled: 'interrupted' });
const fail = code => Object.assign(new Error(code), { code });
const title = value => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 140) : '未命名任务';
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

// Only follows resources inside the explicitly selected .zcode directory.
// The parent path identifies the data base, never an additional read grant or cipher identity.
function scopedFiles(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.basename(directory) !== '.zcode') throw fail('ZCODE_DIRECTORY_REQUIRED');
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw fail('ZCODE_DIRECTORY_REQUIRED');
  function check(file) {
    const candidate = path.resolve(file);
    if (!inside(path.resolve(directory), candidate)) throw fail('ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY');
    const canonical = fs.realpathSync(candidate);
    if (!inside(root, canonical)) throw fail('ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY');
    return canonical;
  }
  return { root: directory, check, io: {
    statSync: file => fs.statSync(check(file)),
    readFileSync: (file, ...args) => fs.readFileSync(check(file), ...args)
  } };
}
function queryCache(files, relative, query, Database) {
  const file = path.join(files.root, relative);
  const canonical = files.check(file);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { files.check(file + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let db;
  try {
    db = new Database(canonical, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
    return db.prepare(query).all();
  } finally { db?.close(); }
}
const INDEX_QUERY = 'SELECT task_id,title,task_status,provider,updated_at,cli_updated_at,cli_last_outcome FROM tasks WHERE deleted = 0 AND archived = 0 ORDER BY updated_at DESC LIMIT 256';
const RUNTIME_QUERY = `SELECT s.id AS task_id,s.title,t.turn_id,t.status,t.started_at,t.completed_at
  FROM session s JOIN turn_usage t ON t.session_id=s.id
  WHERE s.time_deleted IS NULL AND s.time_archived IS NULL
    AND t.started_at=(SELECT MAX(n.started_at) FROM turn_usage n WHERE n.session_id=s.id)
  ORDER BY t.started_at DESC LIMIT 256`;
function projectRows(rows, runtime = false) {
  const items = [], results = [];
  for (const row of rows.slice(0, 256)) {
    if (typeof row.task_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row.task_id) ||
        !runtime && row.provider && !['zcode', 'glm'].includes(row.provider)) continue;
    const recorded = runtime ? row.status : row.task_status || row.cli_last_outcome;
    const terminal = Object.hasOwn(TERMINAL, recorded) ? TERMINAL[recorded] : null;
    const updatedAt = Number(runtime ? row.completed_at || row.started_at : row.cli_updated_at || row.updated_at);
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) continue;
    const projected = { id: row.task_id, title: title(row.title), state: terminal || 'unknown', updatedAt,
      turnId: terminal && typeof row.turn_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(row.turn_id) ? row.turn_id : null,
      source: runtime ? 'zcode-authorized-turn-cache' : 'zcode-authorized-task-cache', liveVerified: false };
    (terminal ? results : items).push(projected);
  }
  return { items, results };
}
function capabilities() {
  return {
    account: { available: true, source: 'user-authorized-local-account', verified: 'candidate' },
    quota: { available: true, readOnly: true, source: 'existing-account-https-endpoints', publicApiContractVerified: false },
    tasks: { available: true, scope: 'authorized-device-cache', accountAttributionVerified: false, live: false, partial: true },
    chat: { available: false, code: 'ZCODE_MAS_CHAT_TRANSPORT_UNAVAILABLE',
      reason: '现有聊天需要外部 ZCode 运行时；尚未验证可供球球使用的官方授权聊天接口，未改用独立付费 API。' }
  };
}
function createMasZcodeProvider({ directoryAccess, installedAppAccess, run, credentialContext = {}, fetch: fetchImpl = globalThis.fetch,
  Database = require('node:sqlite').DatabaseSync, now = Date.now } = {}) {
  if (!directoryAccess || typeof directoryAccess.withAccess !== 'function' && typeof directoryAccess.acquire !== 'function') throw new TypeError('Explicit directory access is required');
  if (installedAppAccess !== undefined && typeof installedAppAccess?.acquire !== 'function') throw new TypeError('Explicit installed App access is required');
  if (run !== undefined && typeof run !== 'function') throw new TypeError('An official ZCode runner is required');
  function safeAccount(value) {
    const kind = value?.selection?.kind ?? null, scope = kind === 'team-coding-plan' ? 'team' : 'personal';
    if (!/^[a-f0-9]{64}$/.test(value?.accountKey || '') || !['zai', 'bigmodel'].includes(value?.family)
      || kind !== null && !['start-plan', 'individual-coding-plan', 'team-coding-plan'].includes(kind)
      || value?.selection?.scope !== scope) throw fail('ZCODE_INVALID_RESPONSE');
    return { accountKey: value.accountKey, family: value.family, selection: { kind, scope },
      ...Object.fromEntries(['hasJwtToken', 'hasAccessToken', 'hasCodingPlanKey', 'hasDeviceMid']
        .filter(key => typeof value[key] === 'boolean').map(key => [key, value[key]])) };
  }
  function safeUsage(value) {
    const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
    const rows = Array.isArray(value?.buckets) ? value.buckets : value?.windows;
    if (value?.state !== 'connected' || !Array.isArray(rows) || rows.length > 64 || !validTime(value.updatedAt)) throw fail('ZCODE_INVALID_RESPONSE');
    const buckets = rows.map(row => {
      if (typeof row?.id !== 'string' || !row.id.startsWith('zcode:') || row.id.length > 400
        || !Number.isFinite(row.remaining) || row.remaining < 0 || row.remaining > 100 || !validTime(row.resetsAt)
        || !(row.windowMinutes === null || Number.isFinite(row.windowMinutes) && row.windowMinutes > 0)
        || !(row.periodStart === null || validTime(row.periodStart))) throw fail('ZCODE_INVALID_RESPONSE');
      const projected = { sourceId: 'zcode', id: row.id, bucketId: row.id, remaining: row.remaining,
        resetsAt: row.resetsAt, windowMinutes: row.windowMinutes, periodStart: row.periodStart };
      for (const key of ['source', 'planId', 'entitlementId', 'label', 'planName', 'model', 'unit', 'meter', 'periodKind']) {
        if (typeof row[key] === 'string') projected[key] = row[key].replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
      }
      for (const key of ['expiresAt', 'total', 'remainingUnits']) {
        if (row[key] === null || Number.isFinite(row[key]) && row[key] >= 0) projected[key] = row[key];
      }
      return projected;
    });
    const states = new Set(['connected', 'empty', 'unavailable', 'error']);
    return { state: 'connected', buckets, windows: buckets, updatedAt: value.updatedAt,
      modelIds: (Array.isArray(value.modelIds) ? value.modelIds : []).filter(value => typeof value === 'string' && value.length <= 160).slice(0, 64),
      balanceState: states.has(value.balanceState) ? value.balanceState : 'unavailable',
      paidState: states.has(value.paidState) ? value.paidState : 'unavailable' };
  }
  function accountFrom(files) {
    // The official cipher uses the OS account's home, even when ZCode stores
    // data in a custom base directory or Qiuqiu runs inside an App container.
    const user = os.userInfo();
    const credentialHome = credentialContext.home || user.homedir;
    const username = credentialContext.username || user.username;
    const secret = credentialContext.secret || `zcode-credential-fallback:${credentialContext.platform || os.platform()}:${credentialHome}:${username}`;
    return readZcodeAccount({ home: path.dirname(files.root), env: {
      ZCODE_DATA_BASE_DIR: path.dirname(files.root), ZCODE_CREDENTIAL_SECRET: secret
    }, fs: files.io, requireScopedApiKey: true });
  }
  const check = (lease, signal) => {
    if (signal?.aborted || typeof lease?.isCurrent === 'function' && !lease.isCurrent()) throw fail('DISCONNECTED');
  };
  async function scoped(operation, { signal } = {}) {
    check(null, signal);
    if (typeof directoryAccess.acquire !== 'function') return directoryAccess.withAccess('zcode', async directory => {
      check(null, signal); const result = await operation(scopedFiles(directory)); check(null, signal); return result;
    });
    const lease = await directoryAccess.acquire('zcode');
    try {
      if (!lease || typeof lease.release !== 'function') throw fail('ZCODE_DIRECTORY_REQUIRED');
      check(lease, signal); const result = await operation(scopedFiles(lease.directory)); check(lease, signal); return result;
    } finally { if (typeof lease?.release === 'function') lease.release(); }
  }
  async function withAppVersion(operation, { signal } = {}) {
    if (!installedAppAccess) return operation(undefined);
    check(null, signal);
    const lease = await installedAppAccess.acquire('zcode');
    try {
      check(lease, signal);
      const directory = lease?.directory;
      if (typeof lease?.release !== 'function' || typeof directory !== 'string' || !path.isAbsolute(directory)
        || path.basename(directory) !== 'ZCode.app') throw fail('ZCODE_APP_VERSION_UNAVAILABLE');
      const root = fs.realpathSync(directory), stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || root !== path.resolve(directory)) throw fail('ZCODE_APP_VERSION_UNAVAILABLE');
      const plist = fs.realpathSync(path.join(root, 'Contents/Info.plist'));
      if (!inside(root, plist)) throw fail('ZCODE_APP_VERSION_UNAVAILABLE');
      const info = fs.statSync(plist);
      if (!info.isFile() || info.size > 1024 * 1024) throw fail('ZCODE_APP_VERSION_UNAVAILABLE');
      const version = /<key>CFBundleShortVersionString<\/key>\s*<string>(\d{1,4}(?:\.\d{1,4}){1,3})<\/string>/.exec(fs.readFileSync(plist, 'utf8'))?.[1];
      if (!version) throw fail('ZCODE_APP_VERSION_UNAVAILABLE');
      check(lease, signal); const result = await operation(version); check(lease, signal); return result;
    } finally { if (typeof lease?.release === 'function') lease.release(); }
  }
  const readAccount = async (options = {}) => {
    check(null, options.signal);
    if (!run) return scoped(files => accountFrom(files), options);
    const account = safeAccount(await run('account-check', {}, { signal: options.signal }));
    check(null, options.signal); return account;
  };
  function verifyAccount(expected, latest) {
    if (expected && expected.accountKey !== latest.accountKey) throw fail('ZCODE_LOGIN_REQUIRED');
  }
  async function fetchUsage(account, options = {}) {
    if (run) {
      const latest = await readAccount(options); verifyAccount(account, latest);
      const result = await run('usage', { expectedAccountKey: latest.accountKey }, { signal: options.signal, now: options.now ?? now });
      check(null, options.signal); verifyAccount(latest, result); verifyAccount(latest, await readAccount(options));
      return safeUsage(result);
    }
    return scoped(async files => {
      const latest = accountFrom(files); verifyAccount(account, latest);
      const readOnlyFetch = (url, init = {}) => {
        if ((init.method || 'GET') !== 'GET') throw fail('ZCODE_MAS_READ_ONLY');
        if (typeof fetchImpl !== 'function') throw fail('ZCODE_NETWORK_ERROR');
        return fetchImpl(url, init);
      };
      const result = await withAppVersion(appVersion => fetchZcodeUsage(latest, { ...options, now: options.now ?? now,
        ...(appVersion ? { appVersion } : {}),
        fetch: readOnlyFetch, resolveTeamAccount: async selected => {
          // Never mint a project token or change an account from this read-only adapter.
          if (isTeam(selected) && !selected.codingPlanApiKey) throw fail('ZCODE_TEAM_KEY_MISSING');
          return selected;
        } }), options);
      verifyAccount(latest, accountFrom(files));
      return result;
    }, options);
  }
  async function readTasks({ account, now: observedAt = now(), signal } = {}) {
    const latest = await readAccount({ signal }); verifyAccount(account, latest);
    const result = await scoped(files => {
      if (signal?.aborted) throw fail('DISCONNECTED');
      const observed = typeof observedAt === 'function' ? observedAt() : observedAt;
      const caches = [], errors = [];
      for (const [relative, query, runtime] of [
        ['v2/tasks-index.sqlite', INDEX_QUERY, false], ['cli/db/db.sqlite', RUNTIME_QUERY, true]
      ]) {
        try { caches.push(projectRows(queryCache(files, relative, query, Database), runtime)); }
        catch (error) {
          if (error.code === 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY') throw error;
          errors.push('ZCODE_TASK_CACHE_UNAVAILABLE');
        }
      }
      const rows = new Map();
      for (const cache of caches) for (const row of [...cache.items, ...cache.results]) rows.set(row.id, row);
      const items = [...rows.values()].filter(row => !Object.hasOwn(TERMINAL, row.state));
      const results = [...rows.values()].filter(row => Object.hasOwn(TERMINAL, row.state));
      return { state: 'unknown', items, tasks: items, results, updatedAt: observed,
        activity: { runningCount: null, unreadCount: null }, source: 'zcode-authorized-device-cache',
        scope: 'authorized-device-cache', accountAttributionVerified: false, partial: true,
        ...(errors.length ? { code: 'ZCODE_TASK_CACHE_UNAVAILABLE' } : {}) };
    }, { signal });
    verifyAccount(latest, await readAccount({ signal }));
    return result;
  }
  async function read() {
    const account = await readAccount();
    const [quota, tasks] = await Promise.all([fetchUsage(account), readTasks({ account })]);
    return { sourceId: 'zcode', account: { accountKey: account.accountKey, family: account.family,
      scope: account.selection.scope, kind: account.selection.kind }, quota, tasks, capabilities: capabilities() };
  }
  const companionOptions = { readAccount, fetchUsage, readTasks };
  return { readAccount, fetchUsage, readTasks, read, companionOptions, getCapabilities: capabilities,
    createClient: () => ({ read, readAccount, fetchUsage, readTasks, getCapabilities: capabilities }) };
}

module.exports = { createMasZcodeProvider };
