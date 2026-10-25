const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createWorkBuddyConsent({ BrowserWindow, ipcMain, positionWindow = () => {}, getInfo = () => ({}),
  canRequest = () => true, getAppearance = () => 'light', isPackaged = true,
  schedule = setTimeout, cancelTimer = clearTimeout } = {}) {
  const file = path.join(__dirname, '../workbuddy-consent.html'), url = pathToFileURL(file).href;
  let pending = null, closed = false;
  function finish(accepted = false) {
    const current = pending;
    if (!current) return false;
    pending = null;
    if (current.timer !== null) cancelTimer(current.timer);
    current.resolve(accepted === true);
    try { if (!current.win.isDestroyed()) current.win.destroy(); } catch (_) {}
    return true;
  }
  function owns(event) {
    const win = pending?.win;
    return Boolean(!closed && canRequest() && pending?.ready && win && !win.isDestroyed() && win.isVisible() &&
      event?.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      event.sender.getURL() === url && event.senderFrame?.url === url);
  }
  ipcMain.handle('pet:workbuddy-consent-get', event => owns(event) ? getInfo() : null);
  ipcMain.handle('pet:workbuddy-consent-answer', (event, accepted) =>
    typeof accepted === 'boolean' && owns(event) ? finish(accepted) : false);
  function request() {
    if (closed || pending || !canRequest()) return Promise.resolve(false);
    let win;
    try {
      win = new BrowserWindow({ width: 460, height: 656, resizable: false, maximizable: false, fullscreenable: false,
        title: '开启 WorkBuddy 联动', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
        backgroundColor: getAppearance() === 'dark' ? '#242838' : '#EDF4FF', show: false,
        webPreferences: { preload: path.join(__dirname, '../workbuddy-consent-preload.js'), contextIsolation: true,
          nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !isPackaged } });
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const current = { win, resolve, ready: false, timer: null };
      pending = current;
      const dismiss = () => { if (pending === current) finish(false); };
      current.timer = schedule(dismiss, 30000);
      positionWindow(win);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const name of ['will-navigate', 'will-attach-webview']) win.webContents.on(name, event => event.preventDefault());
      for (const name of ['did-fail-load', 'render-process-gone']) win.webContents.on(name, dismiss);
      win.on('closed', dismiss); win.on('hide', dismiss);
      win.once('ready-to-show', () => {
        if (pending !== current || win.isDestroyed()) return;
        if (!canRequest()) { dismiss(); return; }
        try {
          cancelTimer(current.timer); current.timer = null;
          positionWindow(win); win.show(); win.focus();
          if (!win.isVisible() || win.webContents.getURL() !== url) { dismiss(); return; }
          current.ready = true;
          win.webContents.send('pet:workbuddy-consent-info', getInfo());
        } catch (_) { dismiss(); }
      });
      Promise.resolve(win.loadFile(file)).catch(dismiss);
      return result;
    } catch (_) {
      if (pending) finish(false);
      else try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
      return Promise.resolve(false);
    }
  }
  return { request, cancel: () => finish(false), getWindow: () => pending?.win || null, isPending: () => pending !== null,
    close() { closed = true; finish(false); ipcMain.removeHandler('pet:workbuddy-consent-get'); ipcMain.removeHandler('pet:workbuddy-consent-answer'); } };
}
module.exports = { createWorkBuddyConsent };
