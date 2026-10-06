const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'pet:quota-label';
const TOGGLE_CHANNEL = 'pet:quota-label-toggle';
const STATES = new Set([
  'disabled', 'connecting', 'connected', 'ready', 'stale', 'reset-wait', 'period-missing',
  'empty', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const CONTROL_AND_DIRECTION = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function record(value) {
  try { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch (_) { return null; }
}

function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(CONTROL_AND_DIRECTION, ' ').replace(/\s+/gu, ' ').trim())
    .slice(0, 32).join('');
}

function paceFields(value) {
  try {
    if (!value || !['fast', 'balanced', 'slow', 'unknown'].includes(value.state)) return {};
    return { pace: { state: value.state,
      remainingTimePercent: Number.isFinite(value.remainingTimePercent) && value.remainingTimePercent >= 0 && value.remainingTimePercent <= 100 ? value.remainingTimePercent : null } };
  } catch (_) { return {}; }
}

function activityFields(value) {
  try {
    if (!value) return {};
    const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 999999 ? value : null;
    return { activity: { runningCount: count(value.runningCount), unreadCount: count(value.unreadCount) } };
  } catch (_) { return {}; }
}

function copyItem(value) {
  const item = record(value);
  if (!item) return null;
  let labelValue;
  let windowMinutes;
  let remaining;
  let resetsAt;
  let pace;
  let resetLabel;
  try {
    labelValue = item.label;
    windowMinutes = item.windowMinutes;
    remaining = item.remaining;
    resetsAt = item.resetsAt;
    pace = record(item.pace);
    resetLabel = cleanLabel(item.resetLabel);
  } catch (_) { return null; }
  const label = cleanLabel(labelValue);
  if (!label || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
    typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return {
    label,
    windowMinutes,
    remaining,
    ...(Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
    ...paceFields(pace),
    ...(resetLabel ? { resetLabel } : {})
  };
}

function copyItems(value) {
  try { if (!Array.isArray(value)) return []; } catch (_) { return []; }
  let length;
  try { length = value.length; } catch (_) { return []; }
  const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, 2) : 0;
  const items = [];
  for (let index = 0; index < limit; index += 1) {
    let raw;
    try { raw = value[index]; } catch (_) { continue; }
    const item = copyItem(raw);
    if (item) items.push(item);
  }
  return items;
}

function extraCreditsFields(source, state) {
  try {
    const value = record(source.extraCredits);
    if (!value || !['balance', 'none', 'unlimited', 'unknown', 'stale'].includes(value.state)) return {};
    const balance = typeof value.balance === 'string' && value.balance.length <= 128 &&
      /^\d+(?:\.\d+)?$/.test(value.balance) ? value.balance : null;
    const creditState = state === 'stale' ? 'stale' : value.state === 'balance' && balance === null ? 'unknown' : value.state;
    return { extraCredits: { state: creditState,
      ...(creditState === 'balance' ? { balance } : {}),
      ...(state === 'ready' && value.usageStatus === 'blocked' ? { usageStatus: 'blocked' } : {}) } };
  } catch (_) { return {}; }
}

function safeModel(value) {
  const source = record(value);
  if (!source) return { state: 'disconnected', size: 'standard', appearance: 'system', expanded: false, items: [], overflow: 0 };
  let stateValue;
  let sizeValue;
  let appearanceValue;
  let expandedValue;
  try {
    stateValue = source.state;
    sizeValue = source.size;
    appearanceValue = source.appearance;
    expandedValue = source.expanded;
  } catch (_) {
    return { state: 'disconnected', size: 'standard', appearance: 'system', expanded: false, items: [], overflow: 0 };
  }
  const state = STATES.has(stateValue) ? stateValue : 'disconnected';
  const size = sizeValue === 'compact' ? 'compact' : 'standard';
  const appearance = ['light', 'dark'].includes(appearanceValue) ? appearanceValue : 'system';
  const expanded = expandedValue === true;
  if (!['ready', 'stale'].includes(state)) return { state, size, appearance, expanded: false, items: [], overflow: 0 };
  let rawItems;
  let overflowValue;
  let resetCreditsAvailable;
  let activity;
  try {
    rawItems = source.items;
    overflowValue = source.overflow;
    resetCreditsAvailable = source.resetCreditsAvailable;
    activity = record(source.activity);
  } catch (_) { return { state, size, appearance, expanded, items: [], overflow: 0 }; }
  const overflow = Number.isSafeInteger(overflowValue) && overflowValue > 0
    ? Math.min(overflowValue, 99) : 0;
  return {
    state,
    size,
    appearance,
    expanded,
    items: copyItems(rawItems),
    overflow,
    ...extraCreditsFields(source, state),
    ...activityFields(activity),
    ...(Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
      ? { resetCreditsAvailable } : {})
  };
}

contextBridge.exposeInMainWorld('petQuotaLabel', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  toggleExpanded() {
    try { ipcRenderer.send(TOGGLE_CHANNEL); } catch (_) {}
  },
  openDetail(action, period) {
    if (!['tasks', 'results', 'trend', 'opportunities', 'credits'].includes(action)) return;
    try { ipcRenderer.send('pet:quota-label-detail', action, period === 10080 ? 10080 : 300); } catch (_) {}
  },
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const model = safeModel(payload);
      try { callback(model); } catch (_) {}
    };
    try { ipcRenderer.on(CHANNEL, listener); } catch (_) { return () => {}; }
    return () => {
      try { ipcRenderer.removeListener(CHANNEL, listener); } catch (_) {}
    };
  }
});
