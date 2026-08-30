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
  if (id === 'codex' || label === 'codex') return 'codex';
  if (id === 'gpt-reserve' || label === 'gpt-reserve' || label === 'gpt reserve') return 'gpt-reserve';
  if (id.startsWith('codex_') || label.includes('codex')) return 'codex';
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
  return { ...copyWindow(item), label: quotaFamily(item) || 'codex' };
}

function familyPriority(item) {
  const id = typeof item?.id === 'string' ? item.id.split(':', 1)[0].trim().toLowerCase() : '';
  const label = typeof item?.label === 'string' ? item.label.trim().toLowerCase() : '';
  if (id === 'codex' || label === 'codex') return 0;
  if (id === 'gpt-reserve' || label === 'gpt-reserve' || label === 'gpt reserve') return 1;
  if (id.startsWith('codex_') || label.includes('codex')) return 2;
  return 3;
}

function validWindows(windows, now) {
  return selectQuotaWindows(windows, 'auto', now);
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

function buildQuotaLabelModel(snapshot, options = {}, now = Date.now()) {
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

  const period = normalizePeriod(options && typeof options === 'object' && !Array.isArray(options)
    ? options.period : 'auto');
  const selected = selectDisplayedQuotaWindows(quota.windows, period, now);
  const resetCredits = Number.isSafeInteger(quota.resetCreditsAvailable)
    && quota.resetCreditsAvailable >= 0
    ? { resetCreditsAvailable: quota.resetCreditsAvailable } : {};
  const expired = validNow(now) && limitedWindows(quota.windows)
    .some(item => validScalars(item) && item.resetsAt <= now && matchesPeriod(item, period));
  if (quota.stale === true) {
    if (!selected.length && expired) return emptyModel('reset-wait');
    return { state: 'stale', items: selected, overflow: 0, ...resetCredits };
  }
  if (selected.length) {
    return { state: 'ready', items: selected, overflow: 0, ...resetCredits };
  }

  if (expired) return emptyModel('reset-wait');
  return emptyModel(period === 'auto' ? 'empty' : 'period-missing');
}

module.exports = {
  PERIOD_MINUTES,
  DISPLAYED_QUOTA_FAMILIES,
  scopeQuotaWindows,
  selectQuotaWindows,
  selectPrimaryQuotaWindows,
  selectDisplayedQuotaWindows,
  buildQuotaLabelModel
};
