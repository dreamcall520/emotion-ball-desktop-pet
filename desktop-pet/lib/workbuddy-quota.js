const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runWorkBuddy } = require('./workbuddy-client');

function historyPoint(value) {
  const point = { at: value.at, total: value.total };
  for (const key of ['basic', 'reward', 'purchased', 'nextRefreshAt']) if (Number.isFinite(value[key]) && value[key] >= 0) point[key] = value[key];
  if (Array.isArray(value.expires)) point.expires = value.expires.filter(e => e && Number.isFinite(e.at) && e.at >= 0 && Number.isFinite(e.amount) && e.amount >= 0).map(e => ({ at: e.at, amount: e.amount }));
  return point;
}

function createWorkBuddyQuota({ run = runWorkBuddy, onChange = () => {}, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout, historyFile } = {}) {
  const week = 7 * 24 * 3600000, limit = 2016;
  let histories = {}, historyProblem = false, historyBlocked = false;
  const prune = points => points.filter(p => p.at >= now() - week && p.at <= now()).slice(-limit);
  if (historyFile) {
    try {
      const stat = fs.lstatSync(historyFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw Error();
      const stored = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (stored?.version !== 1 || !stored.accounts || typeof stored.accounts !== 'object' || Array.isArray(stored.accounts)) throw Error();
      for (const [key, points] of Object.entries(stored.accounts)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(points) || points.length > limit || points.some((p, i) =>
          !p || !Number.isSafeInteger(p.at) || p.at < 0 || !Number.isFinite(p.total) || p.total < 0 || (i && points[i - 1].at >= p.at))) throw Error();
        histories[key] = prune(points).map(historyPoint);
      }
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { histories = {}; historyProblem = historyBlocked = true; } }
  }
  function appendHistory(key, report) {
    const point = historyPoint({ ...report, at: now() }), at = point.at, points = prune(histories[key] || []);
    if (Number.isSafeInteger(at) && at >= 0) {
      if (points.at(-1)?.at === at) points[points.length - 1] = point;
      else points.push(point);
    }
    histories[key] = points.slice(-limit);
    for (const account of Object.keys(histories)) { histories[account] = prune(histories[account]); if (!histories[account].length) delete histories[account]; }
    if (historyFile && !historyBlocked) {
      const temporary = `${historyFile}.${randomUUID()}.tmp`;
      try {
        const content = JSON.stringify({ version: 1, accounts: histories });
        if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw Error();
        fs.mkdirSync(path.dirname(historyFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, historyFile); historyProblem = false;
      } catch (_) { try { fs.unlinkSync(temporary); } catch (_) {} historyProblem = true; }
    }
    return histories[key] || [];
  }
  let state = { enabled: false, busy: false, error: null, report: null, accountKey: null, stale: false, history: [], historyError: null };
  let timer = null, controller = null, generation = 0, closed = false, failures = 0;
  const getState = () => structuredClone(state);
  const notify = () => onChange(getState());
  function stop() {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    controller?.abort(); controller = null;
  }
  async function refresh() {
    if (closed || !state.enabled || state.busy) return getState();
    if (timer !== null) cancel(timer);
    timer = null;
    const current = ++generation;
    controller = new AbortController();
    state.busy = true; state.error = null; notify();
    try {
      const result = await run('quota', {}, { signal: controller.signal });
      if (current !== generation) return getState();
      if (!/^[a-f0-9]{64}$/.test(result?.accountKey || '') || !result.report || !Number.isFinite(result.report.total) || result.report.total < 0) {
        throw Object.assign(new Error('WorkBuddy 返回格式异常。'), { code: 'INVALID_RESPONSE' });
      }
      failures = 0;
      const history = appendHistory(result.accountKey, result.report);
      state = { ...state, busy: false, error: null, report: result.report, accountKey: result.accountKey, stale: false, history,
        historyError: historyProblem ? '积分趋势暂时无法保存，本次余额已更新。' : null };
    } catch (error) {
      if (current !== generation) return getState();
      failures++;
      const clear = ['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_AUTH'].includes(error.code) ||
        Boolean(error.accountKey && error.accountKey !== state.accountKey);
      state = { ...state, busy: false, error: error.publicMessage || 'WorkBuddy 积分更新失败，请稍后重试。',
        history: clear ? [] : state.history, historyError: clear ? null : state.historyError,
        report: clear ? null : state.report, accountKey: clear ? null : state.accountKey, stale: clear ? false : Boolean(state.report) };
    }
    if (current === generation) {
      controller = null; notify();
      const delay = failures ? Math.min(30 * 60000, 5 * 60000 * 2 ** (failures - 1)) : 5 * 60000;
      timer = schedule(() => { timer = null; refresh(); }, delay); timer?.unref?.();
    }
    return getState();
  }
  function setEnabled(enabled) {
    if (closed || state.enabled === Boolean(enabled)) return;
    stop(); failures = 0;
    state = { enabled: Boolean(enabled), busy: false, error: null, report: null, accountKey: null, stale: false, history: [], historyError: null };
    notify(); if (state.enabled) refresh();
  }
  function close() { stop(); closed = true; state = { enabled: false, busy: false, error: null, report: null, accountKey: null, stale: false, history: [], historyError: null }; }
  return { setEnabled, refresh, getState, close };
}
module.exports = { createWorkBuddyQuota };
