const fs = require('node:fs');
const path = require('node:path');
function createWorkBuddyTasks({ run, getAccountKey, onChange = () => {}, now = Date.now, stateFile }) {
  let enabled = false, closed = false, generation = 0, controller = null, owner = null;
  let state = { busy: false, error: null, report: null };
  let rawReport = null, dismissed = [], storageFailed = false;
  const validRevision = value => value && /^[0-9a-f]{64}$/.test(value.accountKey || '') &&
    typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id) && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0;
  if (stateFile) try {
    const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (stored.version !== 1 || !Array.isArray(stored.dismissed) || !stored.dismissed.every(validRevision)) throw Error();
    dismissed = stored.dismissed;
  } catch (error) { storageFailed = error.code !== 'ENOENT'; }
  const getState = () => structuredClone(state);
  const emit = () => onChange(getState());
  function reset() { generation++; controller?.abort(); controller = null; owner = null; rawReport = null; state = { busy: false, error: null, report: null }; }
  function applyDismissed() {
    if (!rawReport) return;
    const items = rawReport.items.filter(item => item.unread && !dismissed.some(value => value.accountKey === owner &&
      value.id === item.id && value.updatedAt === item.updatedAt));
    state.report = { ...rawReport, items, pendingReview: items.length, pendingReviewSource: 'qiuqiu-local-review',
      pendingReviewScope: 'loaded-cache-revisions', cachedUnreadTotal: rawReport.cachedUnreadTotal };
  }
  function dismissItems(items) {
    if (!enabled || closed || !owner || owner !== getAccountKey() || !rawReport || storageFailed) return { accepted: false, error: '暂时无法保存已查看状态，请刷新后重试。' };
    const revisions = items.filter(item => item.unread && Number.isSafeInteger(item.updatedAt)).map(item => ({ accountKey: owner, id: item.id, updatedAt: item.updatedAt }));
    const next = dismissed.filter(old => !revisions.some(value => value.accountKey === old.accountKey && value.id === old.id));
    next.push(...revisions);
    let temporary;
    try {
      if (stateFile) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        temporary = stateFile + '.' + process.pid + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, dismissed: next }), { mode: 0o600 });
        fs.renameSync(temporary, stateFile);
      }
      dismissed = next; applyDismissed(); emit(); return { accepted: true };
    } catch (_) { return { accepted: false, error: '已查看状态未能保存，请重试。' }; }
    finally { if (temporary) try { fs.unlinkSync(temporary); } catch (_) {} }
  }
  async function refresh(force = true) {
    const account = getAccountKey();
    if (!enabled || closed || state.busy || !account) return getState();
    if (owner !== account) reset();
    if (!force && state.report && now() - state.report.observedAt < 5 * 60000) return getState();
    const current = ++generation;
    controller = new AbortController(); state.busy = true; state.error = null; emit();
    try {
      const value = await run('tasks', { expectedAccountKey: account }, { signal: controller.signal });
      if (current !== generation) return getState();
      if (getAccountKey() !== account) { reset(); emit(); return getState(); }
      if (value?.accountKey !== account || value.source !== 'local-session-cache' || !Array.isArray(value.items) ||
          !Number.isSafeInteger(value.pendingReview) || value.pendingReview < 0 || !Number.isFinite(value.observedAt)) throw Error();
      owner = account;
      state = { busy: false, error: null, report: { source: value.source, scope: 'current-account', observedAt: value.observedAt,
        running: null, pendingReview: value.pendingReview, cachedUnreadTotal: value.pendingReview, total: value.total, truncated: value.truncated === true,
        items: value.items.slice(0, 100).filter(item => item && typeof item.id === 'string' &&
          /^[A-Za-z0-9_-]{1,100}$/.test(item.id) && Number.isSafeInteger(item.updatedAt) && item.updatedAt >= 0).map(item => ({
          id: item.id.slice(0, 100), title: typeof item.title === 'string' ? item.title.slice(0, 160) : '未命名任务',
          status: typeof item.status === 'string' ? item.status.slice(0, 40) : 'unknown', unread: item.unread === true,
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : null,
          transport: ['local', 'cloud', 'remote'].includes(item.transport) ? item.transport : 'unknown' })) } };
      rawReport = state.report; applyDismissed();
    } catch (_) {
      if (current !== generation) return getState();
      state = { busy: false, error: '本机任务记录暂时无法读取，请确认 WorkBuddy 已登录后重试。', report: null }; owner = null; rawReport = null;
    } finally {
      if (current === generation) { controller = null; state.busy = false; emit(); }
    }
    return getState();
  }
  return { getState, refresh,
    dismiss(id) { const item = state.report?.items.find(value => value.id === id); return item ? dismissItems([item]) : { accepted: false, error: '该待查看任务已变化，请刷新。' }; },
    dismissAll() { return state.report ? dismissItems(state.report.items) : { accepted: false, error: '请先刷新待查看任务。' }; },
    setEnabled(value) { enabled = value === true; if (!enabled || owner && owner !== getAccountKey()) { reset(); emit(); } },
    close() { closed = true; enabled = false; reset(); } };
}
module.exports = { createWorkBuddyTasks };
