const path = require('node:path');

function edgeNoticeBounds(pet, area, side, kind = 'text') {
  const width = Math.min(kind === 'quota' ? 284 : 244, area.width), height = Math.min(44, area.height);
  const inward = side === 'left' ? pet.x + pet.width / 2 + 6 : pet.x + pet.width / 2 - width - 6;
  return { x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, inward))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, pet.y + (pet.height - height) / 2))),
    width, height };
}

function createEdgeNoticeWindow({ BrowserWindow, screen, getPetWindow, alwaysOnTop = true, onError = () => {} }) {
  let win = null, ready = false, current = null, topmost = alwaysOnTop;
  function hide() {
    current = null;
    if (win && !win.isDestroyed()) win.hide();
  }
  function destroy() {
    const previous = win;
    win = null; ready = false; current = null;
    if (previous && !previous.isDestroyed()) previous.destroy();
  }
  function failed(error, target) {
    if (target && win !== target) return;
    destroy();
    onError(error);
  }
  function present() {
    const target = win;
    if (!target || target.isDestroyed() || !ready || !current) return;
    try {
      const pet = getPetWindow();
      if (!pet || pet.isDestroyed() || !pet.isVisible()) { hide(); return; }
      const bounds = pet.getBounds();
      target.setBounds(edgeNoticeBounds(bounds, screen.getDisplayMatching(bounds).workArea, current.side, current.kind), false);
      target.webContents.send('pet:edge-notice', current);
      target.showInactive();
    } catch (error) { failed(error, target); }
  }
  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    const target = new BrowserWindow({
      width: 244, height: 44, title: '球球的边边悄悄话',
      transparent: true, frame: false, resizable: false, focusable: false,
      skipTaskbar: true, show: false, fullscreenable: false, maximizable: false,
      minimizable: false, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, '../edge-notice-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    });
    win = target; ready = false;
    try {
      target.setAlwaysOnTop(topmost, 'floating');
      target.setIgnoreMouseEvents(true, { forward: true });
      target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      target.setHiddenInMissionControl(true);
      target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      target.webContents.on('will-navigate', event => event.preventDefault());
      target.webContents.on('render-process-gone', (_event, details) => failed(new Error(`边缘提示渲染退出：${details.reason}`), target));
      target.on('closed', () => { if (win === target) { win = null; ready = false; current = null; } });
      target.loadFile(path.join(__dirname, '../edge-notice.html')).then(() => {
        if (win !== target || target.isDestroyed()) return;
        ready = true; present();
      }).catch(error => failed(error, target));
    } catch (error) { failed(error, target); }
  }
  return {
    show(payload) {
      current = { ...payload };
      try { ensureWindow(); present(); } catch (error) { failed(error); }
    },
    hide, destroy, reposition: present, getWindow: () => win,
    setAlwaysOnTop(value) { topmost = Boolean(value); if (win && !win.isDestroyed()) win.setAlwaysOnTop(topmost, 'floating'); }
  };
}
module.exports = { createEdgeNoticeWindow, edgeNoticeBounds };
