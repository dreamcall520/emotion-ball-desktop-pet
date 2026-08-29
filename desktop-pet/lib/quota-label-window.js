const path = require('node:path');
const { quotaLabelBounds } = require('./quota-label-placement');

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

function createQuotaLabelWindow({
  BrowserWindow, screen, getPetWindow, getObstacle = () => null, onError = () => {}, alwaysOnTop = true
}) {
  let win = null;
  let ready = false;
  let requestedVisible = false;
  let currentModel = null;
  let topmost = Boolean(alwaysOnTop);

  function report(error) {
    try { onError(error); } catch (_) {}
  }

  function conceal(target = win) {
    if (!target || target.isDestroyed()) return;
    target.hide();
    target.setIgnoreMouseEvents(true, { forward: true });
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
    if (!requestedVisible || !currentModel || !ready || !target || target.isDestroyed()) return;
    const layout = petLayout();
    if (!layout) {
      conceal(target);
      return;
    }
    const { x, y, width, height } = layout;
    target.setBounds({ x, y, width, height }, false);
    target.webContents.send(CHANNEL, currentModel);
    target.setIgnoreMouseEvents(true, { forward: true });
    target.showInactive();
  }

  function discard(target, error) {
    if (win !== target) return;
    win = null;
    ready = false;
    if (!target.isDestroyed()) target.destroy();
    if (error) report(error);
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    ready = false;
    let loadingWindow;
    try {
      loadingWindow = new BrowserWindow({
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
      });
      win = loadingWindow;
      loadingWindow.setAlwaysOnTop(topmost, 'floating');
      loadingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      loadingWindow.setHiddenInMissionControl(true);
      loadingWindow.setIgnoreMouseEvents(true, { forward: true });
      loadingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      loadingWindow.webContents.on('will-navigate', event => event.preventDefault());
      loadingWindow.webContents.on('render-process-gone', (_event, details = {}) => {
        discard(loadingWindow, new Error(`额度标签渲染退出：${details.reason || 'unknown'}`));
      });
      loadingWindow.on('closed', () => {
        if (win !== loadingWindow) return;
        win = null;
        ready = false;
        requestedVisible = false;
      });

      const markReady = () => {
        if (win !== loadingWindow || loadingWindow.isDestroyed() || ready) return;
        ready = true;
        present();
      };
      loadingWindow.webContents.on('did-finish-load', markReady);
      Promise.resolve(loadingWindow.loadFile(path.join(__dirname, '../quota-label.html')))
        .then(markReady)
        .catch(error => discard(loadingWindow, error));
    } catch (error) {
      if (loadingWindow && win === loadingWindow) discard(loadingWindow, error);
      else report(error);
    }
  }

  function hide() {
    requestedVisible = false;
    conceal();
  }

  function destroy() {
    requestedVisible = false;
    currentModel = null;
    const previous = win;
    win = null;
    ready = false;
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  return {
    show(model) {
      currentModel = safeModel(model);
      requestedVisible = true;
      ensureWindow();
      present();
    },
    hide,
    reposition() {
      present();
    },
    getWindow: () => win,
    setAlwaysOnTop(enabled) {
      topmost = Boolean(enabled);
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(topmost, 'floating');
    },
    destroy
  };
}

module.exports = { createQuotaLabelWindow };
