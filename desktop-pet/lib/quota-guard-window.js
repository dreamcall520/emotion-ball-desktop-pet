const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { safeModel } = require('./quota-label-window');
const { placeDetails } = require('./codex-details-window');
const { adjacentBounds } = require('./window-placement');

const CHANNEL = 'pet:quota-guard-model';

function guardModel(value, size = 'standard', appearance = 'system', visible = false) {
  return { ...safeModel(value), size: size === 'compact' ? 'compact' : 'standard',
    appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system', expanded: false,
    visible: visible === true };
}

function createQuotaGuardWindow({ BrowserWindow, screen, getAnchor, getSize = () => 'standard',
  getAppearance = () => 'system', getObstacles = () => [], canShow = () => true, alwaysOnTop = true,
  onError = () => {}, onVisibilityChange = () => {}, onLayout = () => {} }) {
  const file = path.join(__dirname, '../quota-guard.html');
  const url = pathToFileURL(file).href;
  let win = null, ready = false, model = null, visible = false, topmost = Boolean(alwaysOnTop);
  const alive = () => Boolean(win && !win.isDestroyed());
  const report = error => { try { onError(error); } catch (_) {} };
  const allowed = () => { try { return canShow() === true; } catch (error) { report(error); return false; } };
  function changed(value) {
    if (visible === value) return;
    visible = value;
    try { onVisibilityChange(value); } catch (error) { report(error); }
  }
  function layoutChanged() {
    try { onLayout(); } catch (error) { report(error); }
  }
  function send() {
    if (!alive() || !ready || !model) return;
    try { win.webContents.send(CHANNEL, { ...model, visible }); } catch (error) { report(error); }
  }
  function bounds() {
    const anchor = getAnchor?.() || screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(anchor).workArea;
    const size = { width: Math.min(420, area.width), height: Math.min(410, area.height) };
    const placed = placeDetails(anchor, area, size), obstacles = getObstacles();
    const intersects = obstacle => obstacle && placed.x < obstacle.x + obstacle.width && placed.x + placed.width > obstacle.x &&
      placed.y < obstacle.y + obstacle.height && placed.y + placed.height > obstacle.y;
    const { x, y, width, height } = obstacles.some(intersects) ? adjacentBounds(anchor, area, size, obstacles) : placed;
    return { x, y, width, height };
  }
  function close() {
    changed(false);
    send();
    if (alive()) { try { win.hide(); } catch (error) { report(error); } }
    layoutChanged();
  }
  function destroy() {
    const target = win;
    win = null; ready = false; model = null;
    changed(false);
    if (target && !target.isDestroyed()) { try { target.destroy(); } catch (error) { report(error); } }
  }
  function present(focus = false) {
    if (!alive() || !ready || !visible) return;
    if (!allowed()) { close(); return; }
    try {
      win.setBounds(bounds(), false);
      send();
      if (!visible || !allowed()) { close(); return; }
      if (focus) { win.show(); win.focus(); }
      else if (!win.isVisible()) win.showInactive();
      layoutChanged();
    } catch (error) { report(error); destroy(); }
  }
  function ensure() {
    if (alive()) return;
    win = new BrowserWindow({ ...bounds(), show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false, useContentSize: true,
      fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      title: '球球守护战', webPreferences: { preload: path.join(__dirname, '../quota-guard-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        spellcheck: false } });
    const target = win;
    target.setAlwaysOnTop(topmost, 'floating');
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', event => event.preventDefault());
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    target.on('close', event => { if (win === target) { event.preventDefault(); close(); } });
    target.on('closed', () => { if (win === target) { win = null; ready = false; changed(false); } });
    target.webContents.once('did-finish-load', () => {
      if (win !== target) return;
      ready = true; send(); present(true);
    });
    Promise.resolve(target.loadFile(file)).catch(error => { report(error); if (win === target) destroy(); });
  }
  return {
    open(value) {
      const next = guardModel(value, getSize(), getAppearance(), true);
      if (!allowed() || next.state !== 'ready' || !next.items.length) return false;
      model = next;
      try { ensure(); changed(true); present(true); return true; }
      catch (error) { report(error); destroy(); return false; }
    },
    update(value) {
      model = guardModel(value, getSize(), getAppearance(), visible);
      if (visible && !allowed()) close();
      else send();
    },
    reposition() { if (visible) present(); },
    owns(event) {
      return Boolean(alive() && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === url);
    },
    setAlwaysOnTop(value) { topmost = Boolean(value); if (alive()) win.setAlwaysOnTop(topmost, 'floating'); },
    getWindow() { return alive() ? win : null; },
    isVisible() { return visible && alive(); },
    close, destroy
  };
}

module.exports = { createQuotaGuardWindow, guardModel, CHANNEL };
