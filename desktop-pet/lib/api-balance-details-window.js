const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { placeDetails } = require('./codex-details-window');
const { safeState } = require('./api-balance-label-window');
const CHANNEL = 'pet:api-balance-details';
function createApiBalanceDetailsWindow({ BrowserWindow, screen, getAnchor, getAppearance = () => 'system', alwaysOnTop = true, onError = () => {}, onVisibilityChange = () => {} }) {
  const file = path.join(__dirname, '../api-balance-details.html'), url = pathToFileURL(file).href;
  let win = null, ready = false, visible = false, state = null, top = Boolean(alwaysOnTop), height = 363;
  const alive = () => win && !win.isDestroyed() && !win.webContents.isDestroyed?.();
  const report = error => { try { onError(error); } catch (_) {} };
  function send() {
    if (!alive() || !ready) return;
    const appearance = getAppearance();
    win.webContents.send(CHANNEL, { ...state, appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system' });
  }
  function changed(value) { if (visible === value) return; visible = value; try { onVisibilityChange(value); } catch (error) { report(error); } }
  function close() { changed(false); if (alive()) win.hide(); }
  function destroy() { const old = win; win = null; ready = false; state = null; changed(false); if (old && !old.isDestroyed()) old.destroy(); }
  function reposition() {
    if (!alive() || !visible) return;
    try {
      const requested = getAnchor(), area = screen.getDisplayMatching(requested || screen.getPrimaryDisplay().workArea).workArea;
      const anchor = requested || { x: area.x + area.width / 2, y: area.y + area.height / 2, width: 1, height: 1 };
      const bounds = placeDetails(anchor, area, { width: 404, height });
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, false);
    } catch (error) { report(error); close(); }
  }
  function ensure() {
    if (alive()) return;
    const target = new BrowserWindow({ width: 404, height: 363, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, useContentSize: true, fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true, title: '余额趋势',
      webPreferences: { preload: path.join(__dirname, '../api-balance-details-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    win = target; ready = false; target.setAlwaysOnTop(top, 'floating');
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview']) target.webContents.on(event, e => e.preventDefault());
    target.webContents.on('ipc-message', (event, channel, value) => {
      if (win !== target || !alive() || !ready || !visible || !target.isVisible() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame || event.sender.getURL() !== url) return;
      if (channel === `${CHANNEL}-close`) close();
      if (channel === `${CHANNEL}-resize` && Number.isSafeInteger(value) && value >= 300 && value <= 700 && value !== height) { height = value; reposition(); }
    });
    target.webContents.on('did-finish-load', () => { if (win !== target) return; ready = true; try { send(); if (visible) target.show(); } catch (error) { report(error); destroy(); } });
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    target.on('closed', () => { if (win === target) { win = null; ready = false; state = null; changed(false); } });
    Promise.resolve(target.loadFile(file)).catch(error => { report(error); if (win === target) destroy(); });
  }
  return {
    open(value) {
      state = safeState(value);
      if (!state.enabled || !state.accounts.some(account => account.id === state.selectedAccountId && account.supported)) { close(); return false; }
      try { ensure(); changed(true); reposition(); send(); if (ready && visible) win.show(); return visible; } catch (error) { report(error); destroy(); return false; }
    },
    update(value) {
      state = safeState(value);
      if (!state.enabled || !state.accounts.some(account => account.id === state.selectedAccountId && account.supported)) { close(); return; }
      if (visible) { try { send(); } catch (error) { report(error); destroy(); } }
    },
    close, destroy, reposition,
    setAlwaysOnTop(value) { top = Boolean(value); if (alive()) win.setAlwaysOnTop(top, 'floating'); },
    isVisible: () => visible && Boolean(alive()), getWindow: () => alive() ? win : null
  };
}
module.exports = { createApiBalanceDetailsWindow };
