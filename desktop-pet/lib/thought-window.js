const path = require('node:path');

// 单独的无鼠标透明窗容纳头顶光迹，球体和文字气泡的尺寸始终独立。
function placement(pet, area, side, obstacle = null) {
  const size = pet.width;
  const topBounds = { x: pet.x + (side === 'left' ? -.20 : .54) * size,
    y: pet.y - .46 * size, width: .66 * size, height: .50 * size };
  const overlaps = obstacle && topBounds.x < obstacle.x + obstacle.width &&
    topBounds.x + topBounds.width > obstacle.x && topBounds.y < obstacle.y + obstacle.height &&
    topBounds.y + topBounds.height > obstacle.y;
  const lateral = pet.y - area.y < size * 0.46 || overlaps;
  const view = lateral
    ? (side === 'left' ? [-48, 18, 56, 70] : [92, 18, 56, 70])
    : (side === 'left' ? [-20, -46, 66, 50] : [54, -46, 66, 50]);
  const bounds = {
    x: Math.floor(pet.x + view[0] * size / 100),
    y: Math.floor(pet.y + view[1] * size / 100),
    width: Math.ceil(view[2] * size / 100), height: Math.ceil(view[3] * size / 100)
  };
  if (bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width ||
      bounds.y + bounds.height > area.y + area.height) return null;
  return { bounds, viewBox: view.join(' '), rotation: lateral ? (side === 'left' ? -60 : 60) : 0 };
}

function createThoughtWindow({ BrowserWindow, screen, getPetWindow, alwaysOnTop = true,
  getObstacle = () => null, onError = () => {} }) {
  let win = null, ready = false, current = null, expiry = null;
  let top = alwaysOnTop;
  function hide() {
    current = null;
    clearTimeout(expiry); expiry = null;
    if (win && !win.isDestroyed()) {
      if (ready) win.webContents.send('pet:thought-frame', { visible: false });
      win.hide();
    }
  }
  function present() {
    if (!current || !ready || !win || win.isDestroyed()) return;
    const remainingMs = current.endsAt - Date.now();
    if (remainingMs <= 0) { hide(); return; }
    const pet = getPetWindow();
    if (!pet || pet.isDestroyed() || !pet.isVisible()) { hide(); return; }
    const bounds = pet.getBounds();
    const place = placement(bounds, screen.getDisplayMatching(bounds).workArea, current.side, getObstacle());
    if (!place) { hide(); return; }
    win.setBounds(place.bounds, false);
    win.webContents.send('pet:thought-frame', { visible: true, side: current.side,
      ...place, elapsedMs: 6000 - remainingMs, reducedMotion: current.reducedMotion });
    win.showInactive();
  }
  function show(payload) {
    if (!payload?.visible) { hide(); return; }
    hide();
    current = { side: payload.side === 'left' ? 'left' : 'right',
      reducedMotion: payload.reducedMotion === true, endsAt: Date.now() + 6000 };
    expiry = setTimeout(hide, 6000); expiry.unref?.();
    if (!win || win.isDestroyed()) {
      ready = false;
      const created = new BrowserWindow({ width: 80, height: 60, show: false, frame: false,
        transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
        movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: top,
        webPreferences: { preload: path.join(__dirname, '../thought-preload.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      win = created;
      created.setIgnoreMouseEvents(true);
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      created.webContents.on('did-finish-load', () => { if (win === created) { ready = true; present(); } });
      const discard = error => {
        if (win !== created) return;
        destroy();
        onError(error);
      };
      created.webContents.on('render-process-gone', () => discard(new Error('思考光迹页面退出，下轮重新创建')));
      created.on('closed', () => { if (win === created) { win = null; ready = false; hide(); } });
      created.loadFile(path.join(__dirname, '../thought.html')).catch(discard);
    } else present();
  }
  function destroy() { hide(); const old = win; win = null; ready = false; if (old && !old.isDestroyed()) old.destroy(); }
  return { show, hide, destroy, reposition: present, getWindow: () => win,
    setAlwaysOnTop(value) { top = value === true; if (win && !win.isDestroyed()) win.setAlwaysOnTop(top); } };
}
module.exports = { createThoughtWindow, placement };
