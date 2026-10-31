const path = require('node:path');
const { bubbleBounds } = require('./bubble-placement');

function createBubbleWindow({ BrowserWindow, screen, getPetWindow, getShape = () => 'blob', getObstacles = () => [], onError, alwaysOnTop = true }) {
  let win = null;
  let ready = false;
  let current = null;
  let timer = null;
  let topmost = alwaysOnTop;
  let details = null;

  function closeDetails() {
    const previous = details;
    details = null;
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  function hide({ keepDetails = false } = {}) {
    if (!keepDetails) closeDetails();
    clearTimeout(timer);
    timer = null;
    current = null;
    if (win && !win.isDestroyed()) {
      win.hide();
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  function destroy() {
    hide();
    const previous = win;
    win = null;
    ready = false;
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  function reposition() {
    const pet = getPetWindow();
    if (!current || !ready || !win || win.isDestroyed() || !pet || pet.isDestroyed()) return;
    const petBounds = pet.getBounds();
    const workArea = screen.getDisplayMatching(petBounds).workArea;
    const layout = bubbleBounds(
      petBounds,
      workArea,
      current.actions.length > 0 || current.truncated,
      current.preferredHeight,
      getShape(),
      getObstacles()
    );
    const { x, y, width, height, placement, anchorX } = layout;
    win.setBounds({ x, y, width, height }, false);
    win.webContents.send('pet:bubble', { ...current, placement, anchorX, maxHeight: Math.min(1000, Math.max(1, workArea.height - 16)) });
  }

  function present() {
    const pet = getPetWindow();
    if (!current || !ready || !win || win.isDestroyed() || !pet || pet.isDestroyed() || !pet.isVisible()) return;
    reposition();
    win.setIgnoreMouseEvents(current.actions.length === 0 && !current.truncated, { forward: true });
    win.showInactive();
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    ready = false;
    win = new BrowserWindow({
      width: 224, height: 118,
      title: '球球的悄悄话',
      transparent: true, frame: false, resizable: false,
      focusable: false, skipTaskbar: true, show: false,
      fullscreenable: false, maximizable: false, minimizable: false,
      hasShadow: false, backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../bubble-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        spellcheck: false, backgroundThrottling: false
      }
    });
    const loadingWindow = win;
    win.setAlwaysOnTop(topmost, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setHiddenInMissionControl(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_event, details) => {
      if (win !== loadingWindow) return;
      destroy();
      onError(new Error(`气泡渲染退出：${details.reason}`));
    });
    win.on('closed', () => {
      if (win !== loadingWindow) return;
      win = null;
      ready = false;
      current = null;
      clearTimeout(timer);
      timer = null;
    });
    win.loadFile(path.join(__dirname, '../bubble.html')).then(() => {
      if (win !== loadingWindow || loadingWindow.isDestroyed()) return;
      ready = true;
      present();
    }).catch(error => {
      if (win !== loadingWindow) return;
      destroy();
      onError(error);
    });
  }

  return {
    show(payload) {
      if (current?.id !== payload.id || current?.text !== payload.text) closeDetails();
      current = { ...payload, preferredHeight: null, truncated: false };
      clearTimeout(timer);
      ensureWindow();
      present();
      timer = setTimeout(() => hide({ keepDetails: true }), payload.durationMs);
    },
    resize(payload) {
      if (!current || payload?.id !== current.id || !Number.isFinite(payload.height) || payload.height <= 0) return false;
      const height = Math.ceil(payload.height);
      const truncated = payload.truncated === true;
      if (height === current.preferredHeight && truncated === current.truncated) return true;
      current.preferredHeight = height;
      current.truncated = truncated;
      win.setIgnoreMouseEvents(current.actions.length === 0 && !truncated, { forward: true });
      reposition();
      return true;
    },
    showDetails(id) {
      if (!current || current.id !== id || !current.truncated || !win || win.isDestroyed() || !win.isVisible()) return false;
      if (details && !details.isDestroyed()) { details.show(); return true; }
      const source = { id: current.id, text: current.text };
      const area = screen.getDisplayMatching(getPetWindow().getBounds()).workArea;
      const created = new BrowserWindow({ title: '球球 · 消息详情', width: Math.min(520, area.width), height: Math.min(560, area.height),
        show: false, autoHideMenuBar: true, backgroundColor: '#f7f8fb',
        webPreferences: { preload: path.join(__dirname, '../bubble-details-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
      details = created;
      created.setAlwaysOnTop(topmost, 'floating');
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.webContents.on('will-navigate', event => event.preventDefault());
      created.on('closed', () => { if (details === created) details = null; });
      created.loadFile(path.join(__dirname, '../bubble-details.html')).then(() => {
        if (details !== created || created.isDestroyed()) return;
        created.webContents.send('pet:bubble-details-content', source);
        created.show();
      }).catch(error => { if (details === created) closeDetails(); onError(error); });
      return true;
    },
    hide,
    reposition,
    getWindow: () => win,
    getDetailsWindow: () => details,
    closeDetails,
    setAlwaysOnTop(enabled) {
      topmost = enabled;
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, 'floating');
      if (details && !details.isDestroyed()) details.setAlwaysOnTop(enabled, 'floating');
    },
    destroy
  };
}

module.exports = { createBubbleWindow };
