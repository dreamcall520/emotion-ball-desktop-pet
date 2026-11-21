'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createWorkBuddyRunner, workBuddyError } = require('./workbuddy-client');
const { safeEnterpriseReport } = require('./workbuddy-quota');
const { validUsage } = require('./workbuddy-usage');
const { cleanTitle } = require('./workbuddy-tasks-reader');
const AUTH_SUFFIX = path.join('CodeBuddyExtension', 'Data', 'Public', 'auth');
const fail = code => code === 'DIRECTORY_ACCESS_REQUIRED' || code === 'PROCESS_EXIT_UNCONFIRMED'
  ? Object.assign(new Error(code === 'DIRECTORY_ACCESS_REQUIRED' ? '请重新授权 WorkBuddy 应用和账号目录。' : 'WorkBuddy 查询进程尚未确认退出。'), { code })
  : workBuddyError(code);

function safeReport(value) {
  if (value?.scope === 'enterprise') return safeEnterpriseReport(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const date = value => value === null || number(value) && value <= 8640000000000000;
  if (!value || !['total', 'basic', 'reward', 'purchased'].every(key => number(value[key])) ||
    Math.abs(value.total - value.basic - value.reward - value.purchased) > 0.00001 ||
    typeof value.plan !== 'string' || value.plan.length > 60 || !date(value.nextRefreshAt) ||
    !number(value.updatedAt) || value.updatedAt > 8640000000000000 || !Array.isArray(value.expires) ||
    value.expires.length > 10000 || value.expires.some(row => !row || !number(row.amount) || !number(row.at) || !date(row.at))) return null;
  return { total: value.total, basic: value.basic, reward: value.reward, purchased: value.purchased, plan: value.plan,
    nextRefreshAt: value.nextRefreshAt, expires: value.expires.map(row => ({ amount: row.amount, at: row.at })), updatedAt: value.updatedAt };
}

function safeTasks(value) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  if (value?.source !== 'local-session-cache' || value.scope !== 'current-account' ||
    !count(value.observedAt) || !count(value.total) || !count(value.pendingReview) || value.pendingReview > value.total ||
    !Array.isArray(value.items) || value.items.length > 100 || value.items.length > value.total) return null;
  const ids = new Set(), items = [];
  for (const row of value.items) {
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || ids.has(row.id) ||
      !count(row.updatedAt) || typeof row.unread !== 'boolean') return null;
    ids.add(row.id);
    items.push({ id: row.id, title: cleanTitle(row.title),
      status: typeof row.status === 'string' && /^[a-z_-]{1,40}$/.test(row.status) ? row.status : 'unknown',
      unread: row.unread, updatedAt: row.updatedAt,
      transport: ['local', 'remote', 'cloud'].includes(row.transport) ? row.transport : 'unknown' });
  }
  return { source: 'local-session-cache', scope: 'current-account', observedAt: value.observedAt, running: null,
    pendingReview: value.pendingReview, pendingReviewSource: 'cached-unread', total: value.total,
    truncated: value.total > items.length, items };
}

function safeModels(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) return null;
  const seen = new Set(), models = [];
  for (const model of value) {
    if (!model || typeof model.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(model.id) || seen.has(model.id) ||
      typeof model.displayName !== 'string' || !model.displayName.trim() || model.displayName.length > 200 || model.displayName.includes('\0')) return null;
    seen.add(model.id); models.push({ id: model.id, displayName: model.displayName });
  }
  return models;
}
function validChatPayload(payload) {
  return typeof payload.model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(payload.model) &&
    typeof payload.conversationId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.conversationId) &&
    /^[0-9a-f]{64}$/.test(payload.expectedAccountKey || '') && Array.isArray(payload.messages) &&
    payload.messages.length > 0 && payload.messages.length <= 100 && payload.messages.every(message =>
      message && typeof message === 'object' && !Array.isArray(message) &&
      Object.keys(message).every(key => ['role', 'content'].includes(key)) &&
      ['system', 'user', 'assistant'].includes(message.role) && typeof message.content === 'string') &&
    JSON.stringify(payload.messages).length <= 200000;
}

// Run only the explicitly selected official component. Task access and chat
// consent are independent of the two quota grants; no CLI bundle or shell.
function createMasInstalledWorkBuddyRunner({ access, taskAccess, fs: fileSystem = fs, spawnProcess = spawn,
  getChatEnabled = () => false, getAuthorizedChatAccountKey = () => null, getChatGrantEpoch = () => 0,
  env = process.env, closeTimeoutMs = 6000 } = {}) {
  if (!access?.installedAppAccess?.acquire || !access?.directoryAccess?.acquire ||
    !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('WorkBuddy App/account access is required');
  return async function run(operation, payload = {}, { signal, onDelta } = {}) {
    const taskOperation = ['tasks', 'task-open'].includes(operation);
    const chatOperation = ['models', 'chat'].includes(operation);
    if (!['quota', 'usage', 'tasks', 'task-open', 'account-check', 'models', 'chat'].includes(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => key !== 'expectedAccountKey' && !(operation === 'task-open' && key === 'id') &&
        !(operation === 'chat' && ['model', 'messages', 'conversationId'].includes(key))) ||
      taskOperation && !/^[0-9a-f]{64}$/.test(payload.expectedAccountKey || '') ||
      operation === 'task-open' && (typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.id)) ||
      operation === 'chat' && !validChatPayload(payload) || onDelta !== undefined && typeof onDelta !== 'function' ||
      payload.expectedAccountKey !== undefined && !/^[0-9a-f]{64}$/.test(payload.expectedAccountKey)) throw fail('INVALID_REQUEST');
    if (signal?.aborted) throw fail('CANCELLED');
    if (taskOperation && typeof taskAccess?.acquire !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
    let chatBinding = null;
    if (chatOperation) {
      let enabled, accountKey, epoch;
      try { enabled = getChatEnabled(); accountKey = getAuthorizedChatAccountKey(); epoch = getChatGrantEpoch(); } catch {}
      if (enabled !== true || !/^[0-9a-f]{64}$/.test(accountKey || '') || !Number.isSafeInteger(epoch) || epoch < 0)
        throw fail('CHAT_AUTHORIZATION_REQUIRED');
      if (payload.expectedAccountKey !== undefined && payload.expectedAccountKey !== accountKey) throw fail('ACCOUNT_CHANGED');
      chatBinding = { accountKey, epoch };
      payload = { ...payload, expectedAccountKey: accountKey };
    }
    const leases = [];
    let child = null, exited = false, released = false, resolveExit;
    const childExit = new Promise(resolve => { resolveExit = resolve; });
    const release = () => {
      if (released) return; released = true;
      for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} }
    };
    const confirmExit = () => { exited = true; resolveExit(); release(); };
    const current = () => {
      try { return !signal?.aborted && leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent()) &&
        (!chatBinding || getChatEnabled() === true && getAuthorizedChatAccountKey() === chatBinding.accountKey && getChatGrantEpoch() === chatBinding.epoch); }
      catch { return false; }
    };
    const check = () => { if (!current()) throw fail('CANCELLED'); };
    async function directory(port, kind) {
      const lease = await port.acquire('workbuddy');
      if (!lease || typeof lease.release !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
      leases.push(lease); check();
      const value = lease.directory;
      if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
        (kind === 'app' ? path.basename(value) !== 'WorkBuddy.app' : kind === 'tasks' ? path.basename(value) !== '.workbuddy' :
          !path.resolve(value).endsWith(path.sep + AUTH_SUFFIX))) throw fail('DIRECTORY_ACCESS_REQUIRED');
      const normalized = path.resolve(value), stat = await fileSystem.promises.lstat(normalized);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fileSystem.promises.realpath(normalized) !== normalized) throw fail('DIRECTORY_ACCESS_REQUIRED');
      return normalized;
    }
    try {
      const appDirectory = await directory(access.installedAppAccess, 'app');
      const authDirectory = await directory(access.directoryAccess, 'account');
      const taskDirectory = taskOperation ? await directory(taskAccess, 'tasks') : null; check();
      const binary = path.join(appDirectory, 'Contents/MacOS/Electron');
      try {
        const stat = await fileSystem.promises.lstat(binary);
        if (!stat.isFile() || stat.isSymbolicLink() || await fileSystem.promises.realpath(binary) !== binary) throw Error();
        await fileSystem.promises.access(binary, fs.constants.X_OK);
      } catch { throw fail('DIRECTORY_ACCESS_REQUIRED'); }
      // Only transport settings needed for the official request are inherited.
      // WorkBuddy resolves its private native key; credentials never enter argv/stdin.
      const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
        /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|LANG|LC_ALL|TMPDIR)$/.test(key) && typeof value === 'string'));
      Object.assign(childEnv, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', QIUQIU_WORKBUDDY_AUTH_DIRECTORY: authDirectory });
      if (taskDirectory) childEnv.QIUQIU_WORKBUDDY_TASK_DIRECTORY = taskDirectory;
      const runner = createWorkBuddyRunner({ binary, env: childEnv, spawnProcess(...args) {
        check(); child = spawnProcess(...args);
        child.once('exit', confirmExit); child.once('close', confirmExit);
        child.on('error', () => { if (!child.pid) confirmExit(); });
        return child;
      } });
      let deltaLength = 0;
      const result = await runner(operation, payload, { signal, onDelta: operation === 'chat' ? text => {
        check(); deltaLength += text.length;
        if (deltaLength > 32000) throw fail('INVALID_RESPONSE');
        onDelta?.(text);
      } : undefined }); check();
      if (!/^[0-9a-f]{64}$/.test(result?.accountKey || '')) throw fail('INVALID_RESPONSE');
      if (payload.expectedAccountKey !== undefined && result.accountKey !== payload.expectedAccountKey) throw fail('ACCOUNT_CHANGED');
      if (operation === 'account-check') return { accountKey: result.accountKey };
      if (operation === 'models') {
        const models = safeModels(result.models); if (!models) throw fail('INVALID_RESPONSE');
        return { accountKey: result.accountKey, models };
      }
      if (operation === 'chat') {
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 32000) throw fail('INVALID_RESPONSE');
        return { accountKey: result.accountKey, text: result.text };
      }
      if (operation === 'tasks') {
        const report = safeTasks(result); if (!report) throw fail('INVALID_RESPONSE');
        return { accountKey: result.accountKey, ...report };
      }
      if (operation === 'task-open') {
        if (result.id !== payload.id || result.url !== 'workbuddy://chat/' + encodeURIComponent(payload.id)) throw fail('INVALID_RESPONSE');
        return { accountKey: result.accountKey, id: payload.id, url: result.url };
      }
      if (operation === 'quota') {
        const report = safeReport(result.report); if (!report) throw fail('INVALID_RESPONSE');
        return { accountKey: result.accountKey, report };
      }
      const usage = validUsage(result.usage); if (!usage) throw fail('INVALID_USAGE_RESPONSE');
      return { accountKey: result.accountKey, usage };
    } catch (error) {
      if (!current()) throw fail('CANCELLED');
      const safe = fail(error?.code);
      if (/^[0-9a-f]{64}$/.test(error?.accountKey || '')) safe.accountKey = error.accountKey;
      if (['quota-auth', 'quota-request', 'quota-parse', 'quota-query'].includes(error?.stage)) safe.stage = error.stage;
      if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) safe.httpStatus = error.httpStatus;
      throw safe;
    } finally {
      if (!child || exited) release();
      else {
        try { child.kill(); } catch {}
        let timer;
        try {
          await Promise.race([childExit, new Promise((_, reject) => {
            timer = setTimeout(() => reject(fail('PROCESS_EXIT_UNCONFIRMED')), closeTimeoutMs);
          })]);
        } finally { clearTimeout(timer); }
        // If exit cannot be confirmed, exit/close listeners retain the leases.
      }
    }
  };
}
module.exports = { createMasInstalledWorkBuddyRunner };
