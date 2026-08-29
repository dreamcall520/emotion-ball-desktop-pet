const PERIOD_MINUTES = Object.freeze({ fiveHour: 300, weekly: 10080 });
const PERIODS = new Set(['auto', ...Object.keys(PERIOD_MINUTES)]);
const CONNECTION_STATES = new Set([
  'disabled', 'connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const MAX_WINDOWS = 64;
const MAX_TIME = 8640000000000000;
const MAX_TEXT_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function normalizePeriod(period) {
  return PERIODS.has(period) ? period : 'auto';
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
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
    && validTime(item.resetsAt));
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

function matchesPeriod(item, period) {
  return period === 'auto' || item.windowMinutes === PERIOD_MINUTES[period];
}

function selectQuotaWindows(windows, period = 'auto', now = Date.now()) {
  if (!validTime(now)) return [];
  const normalizedPeriod = normalizePeriod(period);
  return limitedWindows(windows)
    .filter(item => validScalars(item) && item.resetsAt > now && matchesPeriod(item, normalizedPeriod))
    .map(copyWindow);
}

function sortedWindows(windows) {
  return windows.map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.remaining - right.item.remaining
      || (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0)
      || left.index - right.index)
    .map(entry => entry.item);
}

function emptyModel(state) {
  return { state, items: [], overflow: 0 };
}

function buildQuotaLabelModel(snapshot, options = {}, now = Date.now()) {
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const quota = source.quota && typeof source.quota === 'object' && !Array.isArray(source.quota)
    ? source.quota : {};
  const quotaState = CONNECTION_STATES.has(quota.state) ? quota.state : 'disconnected';
  const state = source.enabled === false ? 'disabled' : quotaState;
  if (state !== 'connected') return emptyModel(state);

  const period = normalizePeriod(options && typeof options === 'object' && !Array.isArray(options)
    ? options.period : 'auto');
  const selected = sortedWindows(selectQuotaWindows(quota.windows, period, now));
  const expired = validTime(now) && limitedWindows(quota.windows)
    .some(item => validScalars(item) && item.resetsAt <= now && matchesPeriod(item, period));
  if (quota.stale === true) {
    if (!selected.length && expired) return emptyModel('reset-wait');
    return { state: 'stale', items: selected.slice(0, 2), overflow: Math.max(0, selected.length - 2) };
  }
  if (selected.length) {
    return { state: 'ready', items: selected.slice(0, 2), overflow: Math.max(0, selected.length - 2) };
  }

  if (expired) return emptyModel('reset-wait');
  return emptyModel(period === 'auto' ? 'empty' : 'period-missing');
}

module.exports = { PERIOD_MINUTES, selectQuotaWindows, buildQuotaLabelModel };
