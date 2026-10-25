function createWorkBuddyTasks({ run, getAccountKey, onChange = () => {}, now = Date.now }) {
  let enabled = false, closed = false, generation = 0, controller = null, owner = null;
  let state = { busy: false, error: null, report: null };
  const getState = () => structuredClone(state);
  const emit = () => onChange(getState());
  function reset() { generation++; controller?.abort(); controller = null; owner = null; state = { busy: false, error: null, report: null }; }
  async function refresh(force = true) {
    const account = getAccountKey();
    if (!enabled || closed || state.busy || !account) return getState();
    if (owner !== account) reset();
    if (!force && state.report && now() - state.report.observedAt < 5 * 60000) return getState();
    const current = ++generation;
    controller = new AbortController(); state.busy = true; state.error = null; emit();
    try {
      const value = await run('tasks', { expectedAccountKey: account }, { signal: controller.signal });
      if (current !== generation || getAccountKey() !== account) return getState();
      if (value?.accountKey !== account || value.source !== 'local-session-cache' || !Array.isArray(value.items) ||
          !Number.isSafeInteger(value.pendingReview) || value.pendingReview < 0 || !Number.isFinite(value.observedAt)) throw Error();
      owner = account;
      state = { busy: false, error: null, report: { source: value.source, scope: 'current-account', observedAt: value.observedAt,
        running: null, pendingReview: value.pendingReview, total: value.total, truncated: value.truncated === true,
        items: value.items.slice(0, 100).filter(item => item && typeof item.id === 'string').map(item => ({
          id: item.id.slice(0, 100), title: typeof item.title === 'string' ? item.title.slice(0, 160) : '未命名任务',
          status: typeof item.status === 'string' ? item.status.slice(0, 40) : 'unknown', unread: item.unread === true,
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : null,
          transport: ['local', 'cloud', 'remote'].includes(item.transport) ? item.transport : 'unknown' })) } };
    } catch (_) {
      if (current !== generation) return getState();
      state = { busy: false, error: '本机任务记录暂时无法读取，请确认 WorkBuddy 已登录后重试。', report: null }; owner = null;
    } finally {
      if (current === generation) { controller = null; state.busy = false; emit(); }
    }
    return getState();
  }
  return { getState, refresh, setEnabled(value) { enabled = value === true; if (!enabled || owner && owner !== getAccountKey()) { reset(); emit(); } },
    close() { closed = true; enabled = false; reset(); } };
}
module.exports = { createWorkBuddyTasks };
