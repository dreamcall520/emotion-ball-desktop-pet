'use strict';
// Pure projections of already-authorized snapshots. No directory, account or network access.
const text = (v, n = 160) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : '';
const time = v => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000 ? v : null;
const amount = v => Number.isFinite(v) && v >= 0 ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
function safeWebsiteUsage(value) {
  const r = value?.report;
  const recognized = r?.source === 'website-usage' && r.scope === 'website-request-usage';
  // Reuse aggregate integrity checks only; the legacy delay/source markers are
  // validation inputs, never claims about website data and never leave this function.
  const checked = recognized ? require('./workbuddy-usage').validUsage({ ...r, source: 'official-request-usage', delayHours: 3 }) : null;
  let report = null;
  if (checked) { const { delayHours: _delay, ...aggregate } = checked; report = { ...aggregate, source: 'website-usage', scope: 'website-request-usage' }; }
  const websiteState = recognized || ['idle','loading','connected','unavailable','needs-login','error'].includes(value?.status);
  return { busy: websiteState && value?.busy === true, error: websiteState && value?.error ? '网站消耗记录暂不可用。' : null,
    stale: websiteState && value?.stale === true, report };
}
function safeDeviceTasks(value) {
  const history = value?.deviceHistory || value?.report;
  const accepted = history?.source === 'workbuddy-session-cache' && history.scope === 'authorized-device-cache' && Array.isArray(history.items);
  const deviceHistory = accepted ? { source: 'workbuddy-session-cache', scope: 'authorized-device-cache',
    accountAttributionVerified: false, partial: true, observedAt: time(history.observedAt),
    total: count(history.total), pendingReview: count(history.pendingReview), truncated: history.truncated === true,
    items: history.items.slice(0, 100).filter(i => /^[A-Za-z0-9_-]{1,100}$/.test(i?.id || '')).map(i => ({ id: i.id,
      title: text(i.title, 240) || '未命名任务', state: ['last-completed', 'last-interrupted', 'last-failed'].includes(i.state) ? i.state : 'unknown',
      unread: i.unread === true, updatedAt: time(i.updatedAt) })) } : null;
  const live = value?.liveObservations;
  const observations = live?.source === 'workbuddy-desktop-hook' && live.scope === 'authorized-original-workbuddy-hook-metadata' && Array.isArray(live.observations)
    ? live.observations.slice(0, 32).filter(i => /^[a-f0-9]{32}$/.test(i?.id || '') && time(i.observedAt) !== null).map(i => {
      const phase = ['session-opened','submitted','stop-observed','failure-observed','session-ended','final-stop-observed'].includes(i.phase) ? i.phase : 'unknown';
      const terminal = phase === 'final-stop-observed' && i.correlated === true && i.terminalConfirmed === true && i.terminalKind === 'main-reply' && i.evidence === 'versioned-final-stop-hook' && ['completed','interrupted','failed'].includes(i.state);
      return { id: i.id, phase, state: terminal ? i.state : 'unknown', observedAt: i.observedAt, realtime: live.enabled === true && i.realtime === true,
        terminalConfirmed: terminal, terminalKind: terminal ? 'main-reply' : null, overallTaskVerified: false };
    }) : [];
  return { busy: value?.busy === true, error: value?.error ? '设备任务记录暂不可用。' : null, report: null, deviceHistory,
    liveObservations: { source: 'workbuddy-desktop-hook', scope: 'authorized-original-workbuddy-hook-metadata',
      accountAttributionVerified: false, overallTaskVerified: false, observations } };
}
function createMasWorkBuddyDetailsState({ action = 'trend', quota = {}, usage = {}, desktopTasks = {}, desktopIntegration = {} } = {}) {
  const raw = quota.summary;
  const report = raw?.scope === 'website-summary' && amount(raw.credits?.remaining) !== null && time(raw.updatedAt) !== null
    ? { scope: 'website-summary', total: raw.credits.remaining, updatedAt: raw.updatedAt, basic: null, reward: null, purchased: null,
      nextRefreshAt: null, expires: [], plan: Array.isArray(raw.planNames) ? raw.planNames.map(v => text(v, 200)).slice(0, 20).join(' / ') : '网站汇总' } : null;
  return { action: ['tasks','results'].includes(action) ? action : 'trend', report, history: [], historyError: null,
    stale: quota.stale === true, busy: quota.busy === true, error: quota.errorCode ? '网站积分暂不可用。' : null,
    usage: safeWebsiteUsage(usage), tasks: safeDeviceTasks({ ...desktopTasks, liveObservations: desktopIntegration }) };
}
module.exports = { createMasWorkBuddyDetailsState, safeDeviceTasks, safeWebsiteUsage };
