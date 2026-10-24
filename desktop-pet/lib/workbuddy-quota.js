const { runWorkBuddy } = require('./workbuddy-client');

function createWorkBuddyQuota({ run = runWorkBuddy, onChange = () => {}, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let state = { enabled: false, busy: false, error: null, report: null, accountKey: null, stale: false };
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
      if (!result?.accountKey || !result.report || !Number.isFinite(result.report.total) || result.report.total < 0) {
        throw Object.assign(new Error('WorkBuddy 返回格式异常。'), { code: 'INVALID_RESPONSE' });
      }
      failures = 0;
      state = { ...state, busy: false, error: null, report: result.report, accountKey: result.accountKey, stale: false };
    } catch (error) {
      if (current !== generation) return getState();
      failures++;
      const clear = ['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_AUTH'].includes(error.code) ||
        Boolean(error.accountKey && error.accountKey !== state.accountKey);
      state = { ...state, busy: false, error: error.publicMessage || 'WorkBuddy 积分更新失败，请稍后重试。',
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
    state = { enabled: Boolean(enabled), busy: false, error: null, report: null, accountKey: null, stale: false };
    notify(); if (state.enabled) refresh();
  }
  function close() { stop(); closed = true; state = { enabled: false, busy: false, error: null, report: null, accountKey: null, stale: false }; }
  return { setEnabled, refresh, getState, close };
}
module.exports = { createWorkBuddyQuota };
