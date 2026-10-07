const PERIOD_MINUTES = Object.freeze({ fiveHour: 300, weekly: 10080 });
const PERIODS = new Set(['auto', ...Object.keys(PERIOD_MINUTES)]);
const CONNECTION_STATES = new Set([
  'disabled', 'connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const MAX_WINDOWS = 64;
const MAX_TIME = 8640000000000000;
const MAX_TEXT_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const DISPLAYED_QUOTA_FAMILIES = Object.freeze(['codex', 'gpt-reserve']);
const { quotaCreditDetails, quotaResetDetails, accountResetHistoryDetails, isTaskId } = require('./codex-state');

function normalizePeriod(period) {
  return PERIODS.has(period) ? period : 'auto';
}

function validNow(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
}

function validResetTime(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIME;
}

function reasonableText(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
    && value.trim().length > 0 && !CONTROL_CHARACTERS.test(value);
}

function validScalars(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item)
    && reasonableText(item.id) && reasonableText(item.label)
    && Number.isSafeInteger(item.windowMinutes) && item.windowMinutes > 0
    && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100
    && validResetTime(item.resetsAt));
}

function copyWindow(item) {
  return {
    id: item.id,
    label: item.label,
    windowMinutes: item.windowMinutes,
    remaining: item.remaining,
    resetsAt: item.resetsAt
  };
}

function limitedWindows(windows) {
  return Array.isArray(windows) ? windows.slice(0, MAX_WINDOWS) : [];
}

function quotaFamily(item) {
  if (!item || typeof item !== 'object') return '';
  const id = typeof item.id === 'string' ? item.id.split(':', 1)[0].trim().toLowerCase() : '';
  const label = typeof item.label === 'string' ? item.label.trim().toLowerCase() : '';
  if (id === 'codex') return 'codex';
  if (id === 'gpt-reserve' || label === 'gpt-reserve' || label === 'gpt reserve') return 'gpt-reserve';
  return '';
}

function scopeQuotaWindows(windows) {
  const selected = new Map();
  for (const item of limitedWindows(windows)) {
    const family = quotaFamily(item);
    if (!family) continue;
    const current = selected.get(family);
    if (!current || familyPriority(item) <= familyPriority(current)) selected.set(family, item);
  }
  return DISPLAYED_QUOTA_FAMILIES.flatMap(family => selected.has(family)
    ? [{ ...selected.get(family), label: family }] : []);
}

function matchesPeriod(item, period) {
  return period === 'auto' || item.windowMinutes === PERIOD_MINUTES[period];
}

function selectQuotaWindows(windows, period = 'auto', now = Date.now()) {
  if (!validNow(now)) return [];
  const normalizedPeriod = normalizePeriod(period);
  return limitedWindows(windows)
    .filter(item => validScalars(item) && item.resetsAt > now && matchesPeriod(item, normalizedPeriod))
    .map(copyWindow);
}

function canonicalWindow(item) {
  const family = quotaFamily(item);
  return { ...copyWindow(item), label: family === 'codex' ? 'Codex' : family || 'Codex' };
}

function familyPriority(item) {
  const id = typeof item?.id === 'string' ? item.id.split(':', 1)[0].trim().toLowerCase() : '';
  const label = typeof item?.label === 'string' ? item.label.trim().toLowerCase() : '';
  if (id === 'codex') return 0;
  if (id === 'gpt-reserve' || label === 'gpt-reserve' || label === 'gpt reserve') return 1;
  return 2;
}

function validWindows(windows, now) {
  return selectQuotaWindows(windows, 'auto', now).filter(item => quotaFamily(item) === 'codex'
    && Object.values(PERIOD_MINUTES).includes(item.windowMinutes));
}

function resolvePrimaryMinutes(windows, period) {
  const normalizedPeriod = normalizePeriod(period);
  if (normalizedPeriod !== 'auto') {
    const expected = PERIOD_MINUTES[normalizedPeriod];
    return windows.some(item => item.windowMinutes === expected) ? expected : null;
  }
  if (windows.some(item => item.windowMinutes === PERIOD_MINUTES.fiveHour)) return PERIOD_MINUTES.fiveHour;
  if (windows.some(item => item.windowMinutes === PERIOD_MINUTES.weekly)) return PERIOD_MINUTES.weekly;
  return windows.reduce((shortest, item) => shortest === null || item.windowMinutes < shortest
    ? item.windowMinutes : shortest, null);
}

function representativeForPeriod(windows, windowMinutes) {
  return windows
    .filter(item => item.windowMinutes === windowMinutes)
    .reduce((best, item) => !best || familyPriority(item) < familyPriority(best) ? item : best, null);
}

function selectPrimaryQuotaWindows(windows, period = 'auto', now = Date.now()) {
  const valid = validWindows(windows, now);
  const primaryMinutes = resolvePrimaryMinutes(valid, period);
  if (primaryMinutes === null) return [];
  return valid.filter(item => item.windowMinutes === primaryMinutes).map(canonicalWindow);
}

function selectDisplayedQuotaWindows(windows, period = 'auto', now = Date.now()) {
  const valid = validWindows(windows, now);
  const primaryMinutes = resolvePrimaryMinutes(valid, period);
  if (primaryMinutes === null) return [];
  const periods = [primaryMinutes];
  const alternate = [PERIOD_MINUTES.fiveHour, PERIOD_MINUTES.weekly]
    .find(minutes => minutes !== primaryMinutes && valid.some(item => item.windowMinutes === minutes));
  if (alternate) periods.push(alternate);
  return periods.flatMap(minutes => {
    const representative = representativeForPeriod(valid, minutes);
    return representative ? [canonicalWindow(representative)] : [];
  });
}

function emptyModel(state) {
  return { state, items: [], overflow: 0 };
}

function buildQuotaBaseModel(snapshot, options = {}, now = Date.now()) {
  const validSource = Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  const source = validSource ? snapshot : {};
  if (validSource && source.enabled === false) return emptyModel('disabled');
  const validQuota = Boolean(source.quota && typeof source.quota === 'object' && !Array.isArray(source.quota));
  const quota = validQuota ? source.quota : {};
  const knownState = validQuota && CONNECTION_STATES.has(quota.state);
  if (!knownState) return emptyModel('disconnected');
  if (quota.state !== 'connected') return emptyModel(quota.state);
  if (source.enabled !== true) return emptyModel('disabled');
  if (!Array.isArray(quota.windows) || typeof quota.stale !== 'boolean' || !validNow(now)) {
    return emptyModel('disconnected');
  }

  const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const period = normalizePeriod(safeOptions.period);
  const selectedByPeriod = selectDisplayedQuotaWindows(quota.windows, period, now);
  const selected = safeOptions.size === 'standard' && period !== 'auto'
    ? selectedByPeriod.slice(0, 1) : selectedByPeriod;
  const resetCredits = Number.isSafeInteger(quota.resetCreditsAvailable)
    && quota.resetCreditsAvailable >= 0
    ? { resetCreditsAvailable: quota.resetCreditsAvailable } : {};
  const details = quotaCreditDetails(quota);
  let extraCredits = {};
  if (safeOptions.showExtraCredits !== false && details.credits) {
    const credits = details.credits;
    const state = quota.stale ? 'stale' : credits.unlimited === true ? 'unlimited'
      : credits.hasCredits === false ? 'none' : credits.balance !== null ? 'balance' : 'unknown';
    extraCredits = { extraCredits: { state,
      ...(state === 'balance' ? { balance: credits.balance } : {}),
      ...(!quota.stale && details.spendControlReached === true ? { usageStatus: 'blocked' } : {}) } };
  }
  const expired = validNow(now) && limitedWindows(quota.windows)
    .some(item => validScalars(item) && quotaFamily(item) === 'codex'
      && Object.values(PERIOD_MINUTES).includes(item.windowMinutes)
      && item.resetsAt <= now && matchesPeriod(item, period));
  if (quota.stale === true) {
    if (!selected.length && expired) return emptyModel('reset-wait');
    return { state: 'stale', items: selected, overflow: 0, ...resetCredits, ...extraCredits };
  }
  if (selected.length) {
    return { state: 'ready', items: selected, overflow: 0, ...resetCredits, ...extraCredits };
  }

  if (expired) return emptyModel('reset-wait');
  return emptyModel(period === 'auto' ? 'empty' : 'period-missing');
}

function formatQuotaDate(value, windowMinutes, now) {
  if (!validResetTime(value) || !validNow(now)) return '';
  const date = new Date(value); const current = new Date(now);
  const two = number => String(number).padStart(2, '0');
  const clock = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (windowMinutes === PERIOD_MINUTES.fiveHour && date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth() && date.getDate() === current.getDate()) return clock;
  const year = date.getFullYear() === current.getFullYear() ? '' : `${date.getFullYear()}/`;
  return `${year}${two(date.getMonth() + 1)}/${two(date.getDate())} ${clock}`;
}

function buildPace(window, state, now) {
  const duration = window.windowMinutes * 60000;
  const remainingTime = window.resetsAt - now;
  if (state !== 'ready' || remainingTime <= 0 || remainingTime > duration) {
    return { state: 'unknown', remainingTimePercent: null };
  }
  const remainingTimePercent = Math.max(0, Math.min(100, remainingTime / duration * 100));
  const difference = window.remaining - remainingTimePercent;
  return { state: difference < -10 ? 'fast' : difference > 10 ? 'slow' : 'balanced', remainingTimePercent };
}

function safeResults(snapshot) {
  if (snapshot?.enabled !== true || snapshot?.history?.available !== true) return [];
  return (Array.isArray(snapshot.history.results) ? snapshot.history.results.slice(-64) : []).flatMap(row => {
    if (!isTaskId(row?.id) || !reasonableText(row.turnId) || row.turnId.length > 160
      || !['completed', 'failed', 'interrupted'].includes(row.state) || !validNow(row.updatedAt)) return [];
    return [{ id: row.id, turnId: row.turnId, title: typeof row.title === 'string' ? row.title.slice(0, 140) : '未命名任务',
      state: row.state, updatedAt: row.updatedAt, readAt: validNow(row.readAt) ? row.readAt : null }];
  });
}

function buildActivity(snapshot) {
  const knownTasks = snapshot?.enabled === true && snapshot.tasks?.state === 'connected';
  return {
    runningCount: knownTasks ? (Array.isArray(snapshot.tasks.items) ? snapshot.tasks.items.slice(0, 64) : [])
      .filter(task => isTaskId(task?.id) && ['active', 'waiting'].includes(task.state)).length : null,
    unreadCount: snapshot?.enabled === true && snapshot.history?.available === true
      ? safeResults(snapshot).filter(row => row.readAt === null).length : null
  };
}

function buildQuotaLabelModel(snapshot, options = {}, now = Date.now()) {
  const model = buildQuotaBaseModel(snapshot, options, now);
  model.items = model.items.map(item => ({ ...item, pace: buildPace(item, model.state, now),
    resetLabel: formatQuotaDate(item.resetsAt, item.windowMinutes, now) }));
  if (snapshot?.tasks || snapshot?.history) model.activity = buildActivity(snapshot);
  return model;
}

function buildTrend(snapshot, window, now) {
  const unknown = { state: 'unknown', status: 'unknown', exhaustsAt: null, label: '',
    summary: '暂无法预估额度用完时间', detail: '连续用量记录不足，稍后再查看' };
  const base = { period: window?.windowMinutes ?? null,
    windowMinutes: window?.windowMinutes ?? null, resetsAt: window?.resetsAt ?? null,
    resetLabel: window ? formatQuotaDate(window.resetsAt, window.windowMinutes, now) : '',
    samples: [], forecast: unknown };
  if (!window || snapshot?.enabled !== true || snapshot.history?.available !== true) return base;
  const maximum = window.windowMinutes === 10080 ? 6000 : 192;
  const byTime = new Map();
  for (const cycle of Array.isArray(snapshot.history.windows) ? snapshot.history.windows.slice(-8) : []) {
    if (cycle?.id !== window.id || cycle.windowMinutes !== window.windowMinutes
      || !validResetTime(cycle.resetsAt) || Math.abs(cycle.resetsAt - window.resetsAt) > 1000) continue;
    for (const sample of Array.isArray(cycle.samples) ? cycle.samples.slice(-maximum) : []) {
      if (!validNow(sample?.at) || sample.at > now || sample.at < window.resetsAt - window.windowMinutes * 60000 - 1000
        || !Number.isFinite(sample.remaining) || sample.remaining < 0 || sample.remaining > 100) continue;
      byTime.set(sample.at, { at: sample.at, remaining: sample.remaining });
    }
  }
  base.samples = [...byTime.values()].sort((a, b) => a.at - b.at).slice(-maximum);
  if (snapshot.quota?.state !== 'connected' || snapshot.quota.stale !== false || !validNow(snapshot.quota.updatedAt)
    || snapshot.quota.updatedAt > now || now - snapshot.quota.updatedAt >= 300000) {
    base.forecast.detail = '用量尚未更新，稍后再看'; return base;
  }
  const horizon = window.windowMinutes === 300 ? 30 * 60000 : 48 * 3600000;
  let recent = base.samples.filter(sample => sample.at >= now - horizon);
  if (recent.length < 3 || now - recent.at(-1).at >= 300000) return base;
  for (let index = recent.length - 1; index > 0; index--) {
    const previous = recent[index - 1]; const current = recent[index];
    if (current.at - previous.at >= 300000 || current.remaining > previous.remaining
      || previous.remaining - current.remaining >= 25) {
      recent = recent.slice(index); break;
    }
  }
  if (recent.length < 3) return base;
  const first = recent[0]; const last = recent.at(-1);
  const minimumSpan = window.windowMinutes === 300 ? 10 * 60000 : 24 * 3600000;
  if (last.at - first.at < minimumSpan || last.remaining !== window.remaining) return base;
  const consumed = first.remaining - last.remaining;
  const rate = consumed / (last.at - first.at);
  const remainingAtReset = window.remaining - rate * (window.resetsAt - now);
  const status = remainingAtReset < 0 ? 'risk' : remainingAtReset < 10 ? 'tight' : 'safe';
  const projectedAt = rate > 0 ? Math.ceil(now + window.remaining / rate) : null;
  const exhaustsAt = validResetTime(projectedAt) ? projectedAt : null;
  if (status === 'risk' && exhaustsAt === null) return base;
  const label = exhaustsAt === null ? '' : formatQuotaDate(exhaustsAt, window.windowMinutes, now);
  base.forecast = { state: 'estimate', status, exhaustsAt, label,
    summary: status === 'risk' ? window.remaining <= 0 ? '额度已用完' : `预计约 ${label} 用完`
      : status === 'tight' ? '预计够用到重置' : '额度充裕',
    detail: status === 'risk' ? `早于 ${base.resetLabel} 重置`
      : status === 'tight' ? '刚够，留意用量' : '预计够用到重置' };
  return base;
}

function buildCodexDetailsModel(snapshot, options = {}, now = Date.now()) {
  const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const requestedMinutes = [300, 10080].includes(safeOptions.period) ? safeOptions.period
    : PERIOD_MINUTES[normalizePeriod(safeOptions.period)] ?? null;
  const model = buildQuotaLabelModel(snapshot, { ...safeOptions, size: 'large', period: 'auto' }, now);
  const selectedWindow = model.items.find(item => item.windowMinutes === requestedMinutes) || model.items[0];
  const period = selectedWindow?.windowMinutes ?? requestedMinutes ?? 300;
  const details = snapshot?.enabled === true ? quotaResetDetails(snapshot.quota) : {};
  const fresh = model.state === 'ready';
  const accountResetHistory = accountResetHistoryDetails(snapshot?.enabled === true ? snapshot.quota?.accountResetHistory : null);
  if (!fresh && ['ready', 'partial'].includes(accountResetHistory.state)) {
    accountResetHistory.state = 'error'; accountResetHistory.code = 'DISCONNECTED';
  }
  const rows = details.resetOpportunities ?? null;
  const resetHistory = [];
  const past = snapshot?.enabled === true && snapshot?.history?.available === true
    && Array.isArray(snapshot.history.resetHistory) ? snapshot.history.resetHistory : [];
  const seen = new Set();
  for (const row of quotaResetDetails({ resetOpportunities: [...past, ...(fresh ? rows || [] : [])] }).resetOpportunities || []) {
    const state = row.status === 'redeemed' ? 'used'
      : typeof row.expiresAt === 'number' && row.expiresAt <= now ? 'expired' : null;
    if (state && !seen.has(row.id)) { seen.add(row.id); resetHistory.push({ ...row, state }); }
  }
  const tasks = (Array.isArray(snapshot?.tasks?.items) && snapshot.enabled === true ? snapshot.tasks.items.slice(0, 64) : [])
    .filter(row => isTaskId(row?.id)).map(row => ({ id: row.id,
      title: typeof row.title === 'string' ? row.title.slice(0, 140) : '未命名任务',
      state: snapshot.tasks.state === 'connected' && ['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle', 'unknown']
        .includes(row.state) ? row.state : 'unknown',
      turnId: typeof row.turnId === 'string' ? row.turnId.slice(0, 160) : null,
      updatedAt: validNow(row.updatedAt) ? row.updatedAt : null }));
  return { ...model, action: reasonableText(safeOptions.action) ? safeOptions.action.slice(0, 40) : 'trend',
    period, appearance: ['light', 'dark', 'system'].includes(safeOptions.appearance) ? safeOptions.appearance : 'system',
    ...details, activity: buildActivity(snapshot), tasks,
    results: safeResults(snapshot).filter(row => row.readAt === null),
    resetDetailsState: rows === null ? 'unknown' : 'known',
    resetOpportunities: rows === null ? null : rows.filter(row => row.status !== 'redeemed'
      && !(typeof row.expiresAt === 'number' && row.expiresAt <= now)),
    resetHistory, accountResetHistory, trend: buildTrend(snapshot, selectedWindow, now) };
}

module.exports = {
  PERIOD_MINUTES,
  DISPLAYED_QUOTA_FAMILIES,
  scopeQuotaWindows,
  selectQuotaWindows,
  selectPrimaryQuotaWindows,
  selectDisplayedQuotaWindows,
  buildQuotaLabelModel,
  buildCodexDetailsModel,
  formatQuotaDate
};
