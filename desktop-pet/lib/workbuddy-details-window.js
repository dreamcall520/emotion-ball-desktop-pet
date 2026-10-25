const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { placeDetails } = require('./codex-details-window');
function createWorkBuddyDetailsWindow({ BrowserWindow, screen, getAnchor, getAppearance = () => 'system', alwaysOnTop = true, onError = () => {} }) {
  const file = path.join(__dirname, '../workbuddy-details.html'), url = pathToFileURL(file).href;
  let win = null, ready = false, visible = false, state = null, top = Boolean(alwaysOnTop), height = 360;
  const alive = () => win && !win.isDestroyed();
  const report = error => { try { onError(error); } catch (_) {} };
  function clean(value) {
    return { report: Number.isFinite(value?.report?.total) && value.report.total >= 0 ? { total: value.report.total, updatedAt: Number.isFinite(value.report.updatedAt) ? value.report.updatedAt : null } : null,
      history: Array.isArray(value?.history) ? value.history.filter(p => p && Number.isSafeInteger(p.at) && Number.isFinite(p.total) && p.total >= 0).map(p => ({ at: p.at, total: p.total })) : [],
      historyError: value?.historyError ? '积分趋势暂时无法保存。' : null,
      stale: value?.stale === true || Boolean(value?.error) };
  }
  function send() { if (alive() && ready) win.webContents.send('pet:workbuddy-details', { ...state, appearance: getAppearance() }); }
  function close() { visible = false; if (alive()) win.hide(); }
  function destroy() { const old = win; win = null; ready = visible = false; if (old && !old.isDestroyed()) old.destroy(); }
  function reposition() {
    if (!alive() || !visible) return;
    try {
      const area = screen.getDisplayMatching(getAnchor() || screen.getPrimaryDisplay().workArea).workArea;
      const anchor = getAnchor() || { x: area.x + area.width / 2, y: area.y + area.height / 2, width: 1, height: 1 };
      const bounds = placeDetails(anchor, area, { width: 404, height });
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, false);
    } catch (error) { report(error); close(); }
  }
  function ensure() {
    if (alive()) return;
    const target = new BrowserWindow({ width: 404, height: 360, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, useContentSize: true, fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true, title: 'WorkBuddy 余额趋势',
      webPreferences: { preload: path.join(__dirname, '../workbuddy-details-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    win = target; ready = false; target.setAlwaysOnTop(top, 'floating');
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview']) target.webContents.on(event, e => e.preventDefault());
    target.webContents.on('ipc-message', (event, channel, value) => {
      if (win !== target || !ready || !visible || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame || event.sender.getURL() !== url) return;
      if (channel === 'pet:workbuddy-details-close') close();
      if (channel === 'pet:workbuddy-details-resize' && Number.isSafeInteger(value) && value >= 120 && value <= 700) { height = value; reposition(); }
    });
    target.webContents.on('did-finish-load', () => { if (win !== target) return; ready = true; send(); if (visible) target.show(); });
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    target.on('closed', () => { if (win === target) { win = null; ready = visible = false; } });
    Promise.resolve(target.loadFile(file)).catch(error => { report(error); if (win === target) destroy(); });
  }
  return { open(value) { state = clean(value); visible = true; try { ensure(); reposition(); send(); if (ready && visible) win.show(); return visible; } catch (error) { report(error); destroy(); return false; } },
    update(value) { state = clean(value); if (visible) { try { send(); } catch (error) { report(error); } } },
    close, destroy, reposition, setAlwaysOnTop(value) { top = Boolean(value); if (alive()) win.setAlwaysOnTop(top, 'floating'); },
    isVisible: () => visible && Boolean(alive()), getWindow: () => alive() ? win : null };
}
module.exports = { createWorkBuddyDetailsWindow };
