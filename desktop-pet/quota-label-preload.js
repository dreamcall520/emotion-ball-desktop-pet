const { contextBridge, ipcRenderer } = require('electron');

const sourceId = typeof process !== 'undefined' && process.argv?.includes('--pet-source=zcode') ? 'zcode' : 'codex';
const CHANNEL = sourceId === 'zcode' ? 'pet:zcode-quota-label' : 'pet:quota-label';
const TOGGLE_CHANNEL = sourceId === 'zcode' ? 'pet:zcode-quota-label-toggle' : 'pet:quota-label-toggle';
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

function bucketFields(item, sourceId) {
  if (sourceId !== 'zcode') return {};
  try { return {
      planName: cleanLabel(item.planName),
      ...(typeof item.model === 'string' ? { model: cleanLabel(item.model) } : {}),
      bucketId: typeof item.bucketId === 'string' && /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(item.bucketId) ? item.bucketId : '',
      periodKind: ['one_time', 'expiry', 'daily', 'rolling', 'weekly', 'monthly', 'unknown'].includes(item.periodKind) ? item.periodKind : 'unknown',
      periodStart: Number.isSafeInteger(item.periodStart) && item.periodStart > 0 ? item.periodStart : null,
      total: Number.isFinite(item.total) && item.total >= 0 ? item.total : null,
      remainingUnits: Number.isFinite(item.remainingUnits) && item.remainingUnits >= 0 ? item.remainingUnits : null,
      unit: typeof item.unit === 'string' ? item.unit.replace(/[^a-zA-Z\u4e00-\u9fff]/gu, '').slice(0, 16) : ''
  }; } catch (_) { return {}; }
}

function copyItem(value, sourceId = 'codex') {
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
  if (!label || (sourceId === 'zcode' ? windowMinutes !== null && (!Number.isFinite(windowMinutes) || windowMinutes <= 0) : !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0) ||
    typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return {
    label,
    windowMinutes,
    remaining,
    ...bucketFields(item, sourceId),
    ...(Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
    ...paceFields(pace),
    ...(resetLabel ? { resetLabel } : {})
  };
}

function copyItems(value, sourceId = 'codex') {
  try { if (!Array.isArray(value)) return []; } catch (_) { return []; }
  let length;
  try { length = value.length; } catch (_) { return []; }
  const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, sourceId === 'zcode' ? 32 : 2) : 0;
  const items = [];
  for (let index = 0; index < limit; index += 1) {
    let raw;
    try { raw = value[index]; } catch (_) { continue; }
    const item = copyItem(raw, sourceId);
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

function numberFields(source) {
  try {
    if (source.display !== 'numbers') return {};
    const rawPeriods = source.numberPeriods;
    const periods = Array.isArray(rawPeriods) && rawPeriods.length <= 2
      ? [...new Set(rawPeriods.filter(value => ['fiveHour', 'weekly'].includes(value)))] : [];
    const colors = record(source.numberColors);
    const bodyColor = colors?.bodyColor, glowPinkColor = colors?.glowPinkColor, shape = colors?.shape;
    return { display: 'numbers', numberPeriods: periods.length ? periods : ['fiveHour'], numberColors: {
      shape: shape === 'aurora-cloud' ? 'aurora-cloud' : 'blob',
      bodyColor: typeof bodyColor === 'string' && /^#[\da-f]{6}$/i.test(bodyColor) ? bodyColor : '#EEEBE4',
      glowPinkColor: typeof glowPinkColor === 'string' && /^#[\da-f]{6}$/i.test(glowPinkColor) ? glowPinkColor : '#D05ED6'
    } };
  } catch (_) { return {}; }
}

function iconPreferenceFields(source) {
  try { const value = source.codexIconPreference; return ['app-default', 'codex-system', 'space-system'].includes(value)
    ? { codexIconPreference: value, ...(typeof source.codexIconDark === 'boolean' ? { codexIconDark: source.codexIconDark } : {}) } : {}; }
  catch (_) { return {}; }
}

function zcodeStatusFields(source) {
  try { const code = source.statusCode; return ['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED',
    'ZCODE_QUOTA_QUERY_FAILED', 'ZCODE_QUOTA_UPDATE_FAILED', 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE'].includes(code)
    ? { statusCode: code } : {}; } catch (_) { return {}; }
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
  const identity = sourceId === 'zcode' ? { sourceId: 'zcode', ...zcodeStatusFields(source) } : iconPreferenceFields(source);
  const size = sizeValue === 'compact' ? 'compact' : 'standard';
  const appearance = ['light', 'dark'].includes(appearanceValue) ? appearanceValue : 'system';
  const numbers = numberFields(source);
  const expanded = numbers.display !== 'numbers' && expandedValue === true;
  if (!['ready', 'stale'].includes(state)) return { ...identity, state, size, appearance, expanded: false, items: [], overflow: 0, ...numbers };
  let rawItems;
  let overflowValue;
  let resetCreditsAvailable;
  let activity;
  try {
    rawItems = source.items;
    overflowValue = source.overflow;
    resetCreditsAvailable = source.resetCreditsAvailable;
    activity = record(source.activity);
  } catch (_) { return { ...identity, state, size, appearance, expanded, items: [], overflow: 0, ...numbers }; }
  const overflow = Number.isSafeInteger(overflowValue) && overflowValue > 0
    ? Math.min(overflowValue, 99) : 0;
  return {
    ...identity,
    state,
    ...numbers,
    size,
    appearance,
    expanded,
    items: copyItems(rawItems, sourceId),
    overflow,
    ...(sourceId === 'zcode' ? {} : extraCreditsFields(source, state)),
    ...activityFields(activity),
    ...(sourceId !== 'zcode' && Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
      ? { resetCreditsAvailable } : {})
  };
}

contextBridge.exposeInMainWorld('petQuotaLabel', {
  onPointerReset(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('pet:quota-card-pointer-reset', listener);
    return () => ipcRenderer.removeListener('pet:quota-card-pointer-reset', listener);
  },
  onMotion(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      if (!value || typeof value.visible !== 'boolean' || typeof value.animate !== 'boolean') return;
      callback({visible:value.visible,animate:value.animate,index:Number.isInteger(value.index)?Math.max(0,Math.min(3,value.index)):0});
    };
    ipcRenderer.on('pet:quota-card-motion',listener);
    return () => ipcRenderer.removeListener('pet:quota-card-motion',listener);
  },

  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', ['blue', 'purple'].includes(theme) ? theme : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  toggleExpanded() {
    try { ipcRenderer.send(TOGGLE_CHANNEL); } catch (_) {}
  },
  setPointerInteractive(value) {
    if (typeof value !== 'boolean') return;
    try { ipcRenderer.send(sourceId === 'zcode' ? 'pet:zcode-quota-label-pointer' : 'pet:quota-label-pointer', value); } catch (_) {}
  },
  openGuard() {
    try { ipcRenderer.send(sourceId === 'zcode' ? 'pet:zcode-quota-guard-open' : 'pet:quota-guard-open'); } catch (_) {}
  },
  openDetail(action, period) {
    if (sourceId === 'zcode') {
      if (!['tasks', 'results', 'trend', 'quota'].includes(action) || typeof period !== 'string' || !/^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(period)) return;
      try { ipcRenderer.send('pet:zcode-quota-label-detail', action, period); } catch (_) {}
      return;
    }
    if (!['tasks', 'results', 'trend', 'opportunities', 'credits'].includes(action)) return;
    try { ipcRenderer.send('pet:quota-label-detail', action, period === 10080 ? 10080 : 300); } catch (_) {}
  },
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const model = safeModel(payload);
      try {
        const source = record(payload);
        const visible = source?.visible;
        if (typeof visible === 'boolean') model.visible = visible;
        const guardEntry = source?.guardEntry;
        if (typeof guardEntry === 'boolean') model.guardEntry = guardEntry;
        const targetWidth = source?.guardTargetWidth;
        if ([48,64].includes(targetWidth)) model.guardTargetWidth = targetWidth;
        const side = source?.guardSide;
        if (['left', 'right'].includes(side)) model.guardSide = side;
        const transition = record(source?.cardTransition);
        const host = record(transition?.host), from = record(transition?.from), to = record(transition?.to);
        const dimension = value => Number.isFinite(value) && value > 0 && value <= 2048;
        const frame = value => value && dimension(value.width) && dimension(value.height) &&
          Number.isFinite(value.left) && value.left >= 0 && value.left + value.width <= host.width + 1 &&
          Number.isFinite(value.top) && value.top >= 0 && value.top + value.height <= host.height + 1;
        if (host && dimension(host.width) && dimension(host.height) && transition.duration === 180 && frame(from) && frame(to)) {
          const copy = value => ({left:value.left,top:value.top,width:value.width,height:value.height});
          model.cardTransition = {from:copy(from),to:copy(to),host:{width:host.width,height:host.height},duration:180};
        }
        const viewport = record(source?.cardViewport), viewportHost = record(viewport?.host), viewportFace = record(viewport?.face);
        if (viewportHost && viewportFace && dimension(viewportHost.width) && dimension(viewportHost.height) &&
            dimension(viewportFace.width) && dimension(viewportFace.height) &&
            Number.isFinite(viewportFace.left) && viewportFace.left >= 0 && viewportFace.left + viewportFace.width <= viewportHost.width + 1 &&
            Number.isFinite(viewportFace.top) && viewportFace.top >= 0 && viewportFace.top + viewportFace.height <= viewportHost.height + 1) {
          model.cardViewport = {host:{width:viewportHost.width,height:viewportHost.height},face:{left:viewportFace.left,top:viewportFace.top,width:viewportFace.width,height:viewportFace.height}};
        }
        const inset = record(source?.cardInset);
        const x = inset?.x, y = inset?.y;
        if (Number.isFinite(x) && x >= 0 && x <= 512 && Number.isFinite(y) && y >= 0 && y <= 512) model.cardInset = { x, y };
      } catch (_) {}
      try { callback(model); } catch (_) {}
    };
    try { ipcRenderer.on(CHANNEL, listener); } catch (_) { return () => {}; }
    return () => {
      try { ipcRenderer.removeListener(CHANNEL, listener); } catch (_) {}
    };
  }
});
