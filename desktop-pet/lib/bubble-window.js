const path = require('node:path');
const { bubbleBounds } = require('./bubble-placement');

function createBubbleWindow({ BrowserWindow, screen, getPetWindow, onError, alwaysOnTop = true }) {
  let win = null;
  let ready = false;
  let current = null;
  let timer = null;
  let topmost = alwaysOnTop;

  function hide() {
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
    const layout = bubbleBounds(petBounds, screen.getDisplayMatching(petBounds).workArea, current.actions.length > 0);
    const { x, y, width, height, placement, anchorX } = layout;
    win.setBounds({ x, y, width, height }, false);
    win.webContents.send('pet:bubble', { ...current, placement, anchorX });
  }

  function present() {
    const pet = getPetWindow();
    if (!current || !ready || !win || win.isDestroyed() || !pet || pet.isDestroyed() || !pet.isVisible()) return;
    reposition();
    win.setIgnoreMouseEvents(current.actions.length === 0, { forward: true });
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
      current = payload;
      clearTimeout(timer);
      ensureWindow();
      present();
      timer = setTimeout(hide, payload.durationMs);
    },
    hide,
    reposition,
    getWindow: () => win,
    setAlwaysOnTop(enabled) {
      topmost = enabled;
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, 'floating');
    },
    destroy
  };
}

module.exports = { createBubbleWindow };
