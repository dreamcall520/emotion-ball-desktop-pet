const path = require('node:path');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function chatBounds(petBounds, workArea) {
  const areaWidth = Math.max(1, Math.floor(workArea.width));
  const areaHeight = Math.max(1, Math.floor(workArea.height));
  const paddingX = Math.min(12, Math.floor((areaWidth - 1) / 2));
  const paddingY = Math.min(12, Math.floor((areaHeight - 1) / 2));
  const width = Math.min(360, areaWidth - paddingX * 2);
  const height = Math.min(480, areaHeight - paddingY * 2);
  const petCenterX = petBounds.x + petBounds.width / 2;
  const towardRight = petCenterX < workArea.x + areaWidth / 2;
  const targetX = towardRight ? petBounds.x + petBounds.width + 12 : petBounds.x - width - 12;
  return {
    x: Math.round(clamp(targetX, workArea.x + paddingX, workArea.x + areaWidth - paddingX - width)),
    y: Math.round(clamp(petBounds.y + petBounds.height / 2 - height / 2,
      workArea.y + paddingY, workArea.y + areaHeight - paddingY - height)),
    width,
    height
  };
}

function createChatWindow({ BrowserWindow, screen, getPetWindow, onError = () => {}, onVisibilityChange = () => {}, alwaysOnTop = true }) {
  let win = null;
  let ready = false;
  let wantedVisible = false;
  let current = null;
  let topmost = alwaysOnTop;
  let lastVisible = false;

  function visibilityChanged(visible) {
    if (visible === lastVisible) return;
    lastVisible = visible;
    onVisibilityChange(visible);
  }

  function reposition() {
    if (!win || win.isDestroyed()) return;
    const pet = getPetWindow();
    if (!pet || pet.isDestroyed()) return;
    const petBounds = pet.getBounds();
    win.setBounds(chatBounds(petBounds, screen.getDisplayMatching(petBounds).workArea), false);
  }

  function deliver() {
    if (ready && current && win && !win.isDestroyed()) win.webContents.send('pet:chat-state', current);
  }

  function present() {
    if (!wantedVisible || !ready || !win || win.isDestroyed()) return;
    reposition();
    win.show();
    win.focus();
  }

  function hide() {
    wantedVisible = false;
    if (win && !win.isDestroyed()) win.hide();
  }

  function destroy() {
    wantedVisible = false;
    ready = false;
    const previous = win;
    win = null;
    visibilityChanged(false);
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    ready = false;
    win = new BrowserWindow({
      width: 360, height: 480,
      title: '和球球聊聊',
      transparent: true, frame: false, resizable: false,
      focusable: true, skipTaskbar: true, show: false,
      fullscreenable: false, maximizable: false, minimizable: false,
      hasShadow: true, backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../chat-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        spellcheck: false
      }
    });
    const loadingWindow = win;
    win.setAlwaysOnTop(topmost, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setHiddenInMissionControl(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_event, details) => {
      if (win !== loadingWindow) return;
      destroy();
      onError(new Error(`聊天面板意外退出：${details.reason}`));
    });
    win.on('show', () => { if (win === loadingWindow) visibilityChanged(true); });
    win.on('hide', () => { if (win === loadingWindow) visibilityChanged(false); });
    win.on('close', event => {
      if (win !== loadingWindow) return;
      event.preventDefault();
      hide();
    });
    win.on('closed', () => {
      if (win !== loadingWindow) return;
      win = null;
      ready = false;
      wantedVisible = false;
      visibilityChanged(false);
    });
    win.loadFile(path.join(__dirname, '../chat.html')).then(() => {
      if (win !== loadingWindow || loadingWindow.isDestroyed()) return;
      ready = true;
      deliver();
      present();
    }).catch(error => {
      if (win !== loadingWindow) return;
      destroy();
      onError(error);
    });
  }

  return {
    show(snapshot) {
      current = snapshot;
      wantedVisible = true;
      ensureWindow();
      deliver();
      present();
    },
    update(snapshot) {
      current = snapshot;
      deliver();
    },
    hide,
    destroy,
    reposition,
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
    getWindow: () => win,
    setAlwaysOnTop(enabled) {
      topmost = enabled;
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, 'floating');
    }
  };
}

module.exports = { createChatWindow, chatBounds };
