'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createWorkBuddyRunner, workBuddyError } = require('./workbuddy-client');
const { safeEnterpriseReport } = require('./workbuddy-quota');
const { validUsage } = require('./workbuddy-usage');
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

// Run only the user's explicitly selected WorkBuddy component. No CLI bundle,
// shell, account copy, task operation or model operation is exposed by this port.
function createMasInstalledWorkBuddyRunner({ access, fs: fileSystem = fs, spawnProcess = spawn,
  env = process.env, closeTimeoutMs = 6000 } = {}) {
  if (!access?.installedAppAccess?.acquire || !access?.directoryAccess?.acquire ||
    !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('WorkBuddy App/account access is required');
  return async function run(operation, payload = {}, { signal } = {}) {
    if (!['quota', 'usage'].includes(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => key !== 'expectedAccountKey') ||
      payload.expectedAccountKey !== undefined && !/^[0-9a-f]{64}$/.test(payload.expectedAccountKey)) throw fail('INVALID_REQUEST');
    if (signal?.aborted) throw fail('CANCELLED');
    const leases = [];
    let child = null, exited = false, released = false, resolveExit;
    const childExit = new Promise(resolve => { resolveExit = resolve; });
    const release = () => {
      if (released) return; released = true;
      for (const lease of leases.slice().reverse()) { try { lease.release(); } catch {} }
    };
    const confirmExit = () => { exited = true; resolveExit(); release(); };
    const current = () => !signal?.aborted && leases.every(lease => typeof lease.isCurrent !== 'function' || lease.isCurrent());
    const check = () => { if (!current()) throw fail('CANCELLED'); };
    async function directory(port, kind) {
      const lease = await port.acquire('workbuddy');
      if (!lease || typeof lease.release !== 'function') throw fail('DIRECTORY_ACCESS_REQUIRED');
      leases.push(lease); check();
      const value = lease.directory;
      if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
        (kind === 'app' ? path.basename(value) !== 'WorkBuddy.app' : !path.resolve(value).endsWith(path.sep + AUTH_SUFFIX))) throw fail('DIRECTORY_ACCESS_REQUIRED');
      const normalized = path.resolve(value), stat = await fileSystem.promises.lstat(normalized);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fileSystem.promises.realpath(normalized) !== normalized) throw fail('DIRECTORY_ACCESS_REQUIRED');
      return normalized;
    }
    try {
      const appDirectory = await directory(access.installedAppAccess, 'app');
      const authDirectory = await directory(access.directoryAccess, 'account'); check();
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
      const runner = createWorkBuddyRunner({ binary, env: childEnv, spawnProcess(...args) {
        check(); child = spawnProcess(...args);
        child.once('exit', confirmExit); child.once('close', confirmExit);
        child.on('error', () => { if (!child.pid) confirmExit(); });
        return child;
      } });
      const result = await runner(operation, payload, { signal }); check();
      if (!/^[0-9a-f]{64}$/.test(result?.accountKey || '')) throw fail('INVALID_RESPONSE');
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
