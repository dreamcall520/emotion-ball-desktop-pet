const path = require('node:path');
const { quotaLabelBounds } = require('./quota-label-placement');

const CHANNEL = 'pet:quota-label';
const STATES = new Set([
  'disabled', 'connecting', 'connected', 'ready', 'stale', 'reset-wait', 'period-missing',
  'empty', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const CONTROL_AND_DIRECTION = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const EMPTY_MODEL = Object.freeze({ state: 'disconnected', items: Object.freeze([]), overflow: 0 });

function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(CONTROL_AND_DIRECTION, ' ').replace(/\s+/gu, ' ').trim())
    .slice(0, 32).join('');
}

function record(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
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
  } catch (_) {
    return null;
  }
  const label = cleanLabel(labelValue);
  if (!label || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
    typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return { label, windowMinutes, remaining };
}

function copyItems(value) {
  try {
    if (!Array.isArray(value)) return [];
  } catch (_) {
    return [];
  }
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
  if (!source) return { state: EMPTY_MODEL.state, items: [], overflow: 0 };
  let stateValue;
  try { stateValue = source.state; } catch (_) { return { state: EMPTY_MODEL.state, items: [], overflow: 0 }; }
  const state = STATES.has(stateValue) ? stateValue : 'disconnected';
  if (!['ready', 'stale'].includes(state)) return { state, items: [], overflow: 0 };
  let rawItems;
  let overflowValue;
  try {
    rawItems = source.items;
    overflowValue = source.overflow;
  } catch (_) {
    return { state, items: [], overflow: 0 };
  }
  const overflow = Number.isSafeInteger(overflowValue) && overflowValue > 0
    ? Math.min(overflowValue, 99) : 0;
  return { state, items: copyItems(rawItems), overflow };
}

function createQuotaLabelWindow({
  BrowserWindow, screen, getPetWindow, getObstacle = () => null, onError = () => {}, alwaysOnTop = true
}) {
  let win = null;
  let ready = false;
  let requestedVisible = false;
  let currentModel = null;
  let topmost = Boolean(alwaysOnTop);
  let operation = 0;
  let reporting = false;
  let silentWindow = null;

  function safeDestroy(target) {
    if (!target) return;
    let destroyed = false;
    try { destroyed = typeof target.isDestroyed === 'function' && target.isDestroyed(); } catch (_) {}
    if (destroyed) return;
    try { if (typeof target.destroy === 'function') target.destroy(); } catch (_) {}
  }

  function report(error, target = null) {
    if (!error || reporting || (target && target === silentWindow)) return;
    reporting = true;
    const before = win;
    try { onError(error); } catch (_) {}
    if (win && win !== before) silentWindow = win;
    reporting = false;
  }

  function detach(target, error = null) {
    const current = win === target;
    if (current) {
      win = null;
      ready = false;
      operation += 1;
    }
    safeDestroy(target);
    if (current && error) report(error, target);
  }

  function health(target) {
    if (!target) return { ok: false, error: null };
    try {
      if (typeof target.isDestroyed !== 'function' || target.isDestroyed()) return { ok: false, error: null };
      const contents = target.webContents;
      if (!contents) return { ok: false, error: null };
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return { ok: false, error: null };
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function confirm(target, token, model, requireVisible = true) {
    if (win !== target || operation !== token || currentModel !== model ||
      (requireVisible && !requestedVisible)) return false;
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return false;
    }
    return win === target && operation === token && currentModel === model &&
      (!requireVisible || requestedVisible);
  }

  function conceal(target = win, token = operation) {
    if (!target || win !== target || operation !== token) return;
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return;
    }
    if (win !== target || operation !== token) return;
    try { target.hide(); } catch (error) { detach(target, error); return; }
    if (win !== target || operation !== token) return;
    const afterHide = health(target);
    if (!afterHide.ok) {
      detach(target, afterHide.error);
      return;
    }
    if (win !== target || operation !== token) return;
    try { target.setIgnoreMouseEvents(true, { forward: true }); } catch (error) { detach(target, error); }
  }

  function petLayout() {
    try {
      const pet = getPetWindow();
      if (!pet || typeof pet.isDestroyed !== 'function' || pet.isDestroyed() ||
        typeof pet.isVisible !== 'function' || !pet.isVisible() || typeof pet.getBounds !== 'function') return null;
      const petBounds = pet.getBounds();
      const display = screen.getDisplayMatching(petBounds);
      return quotaLabelBounds(petBounds, display && display.workArea, getObstacle());
    } catch (error) {
      report(error);
      return null;
    }
  }

  function present() {
    const target = win;
    const token = operation;
    const model = currentModel;
    if (!ready || !confirm(target, token, model)) return;
    const layout = petLayout();
    if (!confirm(target, token, model)) return;
    if (!layout) {
      conceal(target, token);
      return;
    }
    const { x, y, width, height } = layout;
    try { target.setBounds({ x, y, width, height }, false); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    try { target.webContents.send(CHANNEL, model); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    try { target.setIgnoreMouseEvents(true, { forward: true }); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    try { target.showInactive(); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) {
      if (win === target && !requestedVisible) conceal(target, operation);
      return;
    }
    if (silentWindow === target) silentWindow = null;
  }

  function setupStep(target, callback) {
    try { callback(); } catch (error) { detach(target, error); return false; }
    if (win !== target) {
      detach(target);
      return false;
    }
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return false;
    }
    return win === target;
  }

  function ensureWindow() {
    if (win) {
      const currentWindow = win;
      const currentStatus = health(currentWindow);
      if (currentStatus.ok && win === currentWindow) return;
      if (win === currentWindow) detach(currentWindow, currentStatus.error);
    }
    let loadingWindow = null;
    try { loadingWindow = new BrowserWindow({
      width: 176,
      height: 54,
      title: 'Codex 剩余额度',
      transparent: true,
      frame: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../quota-label-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false
      }
    }); } catch (error) { report(error); return; }
    win = loadingWindow;
    const steps = [
      () => loadingWindow.setAlwaysOnTop(topmost, 'floating'),
      () => loadingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }),
      () => loadingWindow.setHiddenInMissionControl(true),
      () => loadingWindow.setIgnoreMouseEvents(true, { forward: true }),
      () => loadingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' })),
      () => loadingWindow.webContents.on('will-navigate', event => {
        try { event.preventDefault(); } catch (_) {}
      }),
      () => loadingWindow.webContents.on('render-process-gone', (_event, details) => {
        let reason = 'unknown';
        try { if (details && typeof details.reason === 'string') reason = details.reason; } catch (_) {}
        detach(loadingWindow, new Error(`额度标签渲染退出：${reason}`));
      }),
      () => loadingWindow.on('closed', () => {
        if (win !== loadingWindow) return;
        win = null;
        ready = false;
        requestedVisible = false;
        operation += 1;
      })
    ];
    for (const step of steps) if (!setupStep(loadingWindow, step)) return;

    const markReady = () => {
      if (win !== loadingWindow || ready) return;
      const status = health(loadingWindow);
      if (!status.ok) {
        detach(loadingWindow, status.error);
        return;
      }
      if (win !== loadingWindow) return;
      ready = true;
      try { present(); } catch (error) { detach(loadingWindow, error); }
    };
    if (!setupStep(loadingWindow,
      () => loadingWindow.webContents.on('did-finish-load', markReady))) return;
    let loading;
    try { loading = loadingWindow.loadFile(path.join(__dirname, '../quota-label.html')); }
    catch (error) { detach(loadingWindow, error); return; }
    if (win !== loadingWindow) {
      detach(loadingWindow);
      return;
    }
    Promise.resolve(loading).then(markReady).catch(error => detach(loadingWindow, error));
  }

  function hide() {
    operation += 1;
    requestedVisible = false;
    conceal(win, operation);
  }

  function destroy() {
    operation += 1;
    requestedVisible = false;
    currentModel = null;
    const previous = win;
    win = null;
    ready = false;
    safeDestroy(previous);
  }

  return {
    show(model) {
      operation += 1;
      const token = operation;
      const copied = safeModel(model);
      if (operation !== token) return;
      currentModel = copied;
      requestedVisible = true;
      try { ensureWindow(); } catch (error) { report(error); }
      try { present(); } catch (error) { if (win) detach(win, error); else report(error); }
    },
    hide,
    reposition() {
      operation += 1;
      try { present(); } catch (error) { if (win) detach(win, error); else report(error); }
    },
    getWindow() {
      const target = win;
      if (!target) return null;
      const status = health(target);
      if (!status.ok) {
        detach(target, status.error);
        return null;
      }
      return win === target ? target : null;
    },
    setAlwaysOnTop(enabled) {
      operation += 1;
      topmost = Boolean(enabled);
      const target = win;
      const token = operation;
      if (!target) return;
      const status = health(target);
      if (!status.ok) {
        detach(target, status.error);
        return;
      }
      if (win !== target || operation !== token) return;
      try { target.setAlwaysOnTop(topmost, 'floating'); } catch (error) { detach(target, error); }
    },
    destroy
  };
}

module.exports = { createQuotaLabelWindow };
