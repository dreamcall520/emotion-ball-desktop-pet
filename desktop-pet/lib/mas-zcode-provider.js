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
// The parent path is an identity/cipher context string, never an additional read grant.
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
function createMasZcodeProvider({ directoryAccess, credentialContext = {}, fetch: fetchImpl = globalThis.fetch,
  Database = require('node:sqlite').DatabaseSync, now = Date.now } = {}) {
  if (!directoryAccess || typeof directoryAccess.withAccess !== 'function') throw new TypeError('Explicit directoryAccess.withAccess is required');
  function accountFrom(files) {
    const credentialHome = credentialContext.home || path.dirname(files.root);
    const username = credentialContext.username || os.userInfo().username;
    const secret = credentialContext.secret || `zcode-credential-fallback:${credentialContext.platform || os.platform()}:${credentialHome}:${username}`;
    return readZcodeAccount({ home: path.dirname(files.root), env: {
      ZCODE_DATA_BASE_DIR: path.dirname(files.root), ZCODE_CREDENTIAL_SECRET: secret
    }, fs: files.io });
  }
  async function scoped(operation) {
    return directoryAccess.withAccess('zcode', directory => operation(scopedFiles(directory)));
  }
  const readAccount = () => scoped(files => accountFrom(files));
  function verifyAccount(expected, latest) {
    if (expected && expected.accountKey !== latest.accountKey) throw fail('ZCODE_LOGIN_REQUIRED');
  }
  async function fetchUsage(account, options = {}) {
    return scoped(async files => {
      const latest = accountFrom(files); verifyAccount(account, latest);
      const readOnlyFetch = (url, init = {}) => {
        if ((init.method || 'GET') !== 'GET') throw fail('ZCODE_MAS_READ_ONLY');
        if (typeof fetchImpl !== 'function') throw fail('ZCODE_NETWORK_ERROR');
        return fetchImpl(url, init);
      };
      const result = await fetchZcodeUsage(latest, { ...options, now: options.now ?? now,
        fetch: readOnlyFetch, resolveTeamAccount: async selected => {
          // Never mint a project token or change an account from this read-only adapter.
          if (isTeam(selected) && !selected.codingPlanApiKey) throw fail('ZCODE_TEAM_KEY_MISSING');
          return selected;
        } });
      verifyAccount(latest, accountFrom(files));
      return result;
    });
  }
  async function readTasks({ account, now: observedAt = now(), signal } = {}) {
    return scoped(files => {
      if (signal?.aborted) throw fail('DISCONNECTED');
      const latest = accountFrom(files); verifyAccount(account, latest);
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
    });
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
