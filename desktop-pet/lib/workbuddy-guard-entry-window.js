const path = require('node:path');
const { pathToFileURL } = require('node:url');
const CHANNEL = 'pet:workbuddy-guard-entry';
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function entryBounds(card, area, obstacles = [], side = null) {
  const width = 48, height = 44, y = Math.max(area.y, Math.min(card.y + (card.height - height) / 2, area.y + area.height - height));
  const candidates = [{ x: card.x + card.width + 8, side: 'right' }, { x: card.x - width - 8, side: 'left' }];
  if (side === 'right') candidates.reverse();
  for (const candidate of candidates) {
    const bounds = { x: Math.round(candidate.x), y: Math.round(y), width, height };
    if (bounds.x >= area.x && bounds.y >= area.y && bounds.x + width <= area.x + area.width && bounds.y + height <= area.y + area.height &&
      ![card, ...obstacles].some(b => b && overlaps(bounds, b))) return { bounds, side: candidate.side };
  }
  return null;
}
function createWorkBuddyGuardEntryWindow({ BrowserWindow, onGuard = () => {}, onError = () => {}, alwaysOnTop = true }) {
  let win = null, ready = false, visible = false, layout = null, top = Boolean(alwaysOnTop), presenting = false;
  const file = path.join(__dirname, '../workbuddy-guard-entry.html'), url = pathToFileURL(file).href;
  const live = target => target && !target.isDestroyed() && !target.webContents.isDestroyed?.();
  const report = error => { try { onError(error); } catch (_) {} };
  function hide() { visible = false; if (live(win) && win.isVisible()) win.hide(); }
  function destroy() { const old = win; win = null; ready = visible = false; if (live(old)) old.destroy(); }
  function present() {
    if (presenting || !ready || !visible || !layout || !live(win)) return;
    presenting = true;
    try {
      const previous = win.getBounds();
      if (Object.keys(layout.bounds).some(k => previous[k] !== layout.bounds[k])) win.setBounds(layout.bounds, false);
      win.webContents.send(CHANNEL, { state: 'ready', practice: true, items: [], guardEntry: true, expanded: false, visible: true, size: 'compact', guardSide: layout.side, guardTargetWidth: 48 });
      if (!win.isVisible()) win.showInactive();
    } catch (error) { hide(); report(error); }
    finally { presenting = false; }
  }
  function ensure() {
    if (live(win)) return;
    const target = new BrowserWindow({ width: 48, height: 44, title: '球球守护战自由练习', show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
      fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '../workbuddy-guard-entry-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    win = target; ready = false;
    target.setAlwaysOnTop(top, 'floating'); target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview']) target.webContents.on(event, e => e.preventDefault());
    target.webContents.on('ipc-message', (event, channel) => {
      if (channel !== `${CHANNEL}-open` || win !== target || !ready || !visible || !target.isVisible() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame || event.sender.getURL() !== url) return;
      try { onGuard(); } catch (error) { report(error); }
    });
    const loaded = () => { if (win === target && !ready) { ready = true; present(); } };
    target.webContents.on('did-finish-load', loaded);
    target.on('closed', () => { if (win === target) { win = null; ready = visible = false; } });
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    Promise.resolve(target.loadFile(file)).then(loaded).catch(error => { if (win === target) destroy(); report(error); });
  }
  return { show(card, area, obstacles, side) { layout = entryBounds(card, area, obstacles, side); if (!layout) { hide(); return; } visible = true; try { ensure(); present(); } catch (error) { destroy(); report(error); } }, hide, destroy,
    getWindow: () => live(win) ? win : null,
    setAlwaysOnTop(value) { top = Boolean(value); try { if (live(win)) win.setAlwaysOnTop(top, 'floating'); } catch (error) { report(error); } } };
}
module.exports = { createWorkBuddyGuardEntryWindow, entryBounds };
