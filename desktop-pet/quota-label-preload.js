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

function copyItem(value) {
  const item = record(value);
  if (!item) return null;
  let labelValue;
  let windowMinutes;
  let remaining;
  try {
    labelValue = item.label;
    windowMinutes = item.windowMinutes;
    remaining = item.remaining;
  } catch (_) { return null; }
  const label = cleanLabel(labelValue);
  if (!label || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
    typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return { label, windowMinutes, remaining };
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

function safeModel(value) {
  const source = record(value);
  if (!source) return { state: 'disconnected', size: 'standard', expanded: false, items: [], overflow: 0 };
  let stateValue;
  let sizeValue;
  let expandedValue;
  try {
    stateValue = source.state;
    sizeValue = source.size;
    expandedValue = source.expanded;
  } catch (_) {
    return { state: 'disconnected', size: 'standard', expanded: false, items: [], overflow: 0 };
  }
  const state = STATES.has(stateValue) ? stateValue : 'disconnected';
  const size = sizeValue === 'compact' ? 'compact' : 'standard';
  const expanded = size === 'compact' && expandedValue === true;
  if (!['ready', 'stale'].includes(state)) return { state, size, expanded: false, items: [], overflow: 0 };
  let rawItems;
  let overflowValue;
  try {
    rawItems = source.items;
    overflowValue = source.overflow;
  } catch (_) { return { state, size, expanded, items: [], overflow: 0 }; }
  const overflow = Number.isSafeInteger(overflowValue) && overflowValue > 0
    ? Math.min(overflowValue, 99) : 0;
  return { state, size, expanded, items: copyItems(rawItems), overflow };
}

contextBridge.exposeInMainWorld('petQuotaLabel', {
  toggleExpanded() {
    try { ipcRenderer.send(TOGGLE_CHANNEL); } catch (_) {}
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
