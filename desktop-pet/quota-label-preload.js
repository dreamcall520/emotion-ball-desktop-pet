const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'pet:quota-label';
const STATES = new Set([
  'disabled', 'connecting', 'connected', 'ready', 'stale', 'reset-wait', 'period-missing',
  'empty', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const CONTROL_AND_DIRECTION = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(CONTROL_AND_DIRECTION, ' ').replace(/\s+/gu, ' ').trim())
    .slice(0, 32).join('');
}

function safeModel(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const state = STATES.has(source.state) ? source.state : 'disconnected';
  if (!['ready', 'stale'].includes(state)) return { state, items: [], overflow: 0 };
  const items = [];
  for (const item of Array.isArray(source.items) ? source.items.slice(0, 2) : []) {
    const label = cleanLabel(item && item.label);
    if (!label || !Number.isSafeInteger(item && item.windowMinutes) || item.windowMinutes <= 0 ||
      !Number.isFinite(item.remaining) || item.remaining < 0 || item.remaining > 100) continue;
    items.push({ label, windowMinutes: item.windowMinutes, remaining: item.remaining });
  }
  const overflow = Number.isSafeInteger(source.overflow) && source.overflow > 0
    ? Math.min(source.overflow, 99) : 0;
  return { state, items, overflow };
}

contextBridge.exposeInMainWorld('petQuotaLabel', {
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(safeModel(payload));
    ipcRenderer.on(CHANNEL, listener);
    return () => ipcRenderer.removeListener(CHANNEL, listener);
  }
});
