const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createZcodeConsentWindow({ BrowserWindow, ipcMain, getInfo, position,
  getAppearance = () => 'light', isBlocked = () => false, onError = () => {},
  schedule = setTimeout, cancel = clearTimeout }) {
  const file = path.join(__dirname, '../codex-consent.html'), url = pathToFileURL(file).href;
  let pending = null, closed = false;
  const info = () => ({ ...getInfo(), sourceId: 'zcode' });
  function finish(accepted = false) {
    const current = pending;
    if (!current) return false;
    pending = null; cancel(current.timer); current.resolve(accepted === true);
    if (!current.win.isDestroyed()) current.win.destroy();
    return true;
  }
  function owns(event) {
    const win = pending?.win;
    return Boolean(!closed && !isBlocked() && pending?.ready && win && !win.isDestroyed() && win.isVisible()
      && event?.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
      && event.sender.getURL() === url);
  }
  ipcMain.handle('pet:zcode-consent-get', event => owns(event) ? info() : null);
  ipcMain.handle('pet:zcode-consent-answer', (event, accepted) =>
    typeof accepted === 'boolean' && owns(event) ? finish(accepted) : false);
  function open() {
    if (closed || pending || isBlocked()) return Promise.resolve(false);
    let win;
    try {
      win = new BrowserWindow({ width: 460, height: 656, resizable: false, maximizable: false, fullscreenable: false,
        title: '开启 ZCode 联动', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
        backgroundColor: getAppearance() === 'dark' ? '#242838' : '#EDF4FF', show: false,
        webPreferences: { preload: path.join(__dirname, '../codex-consent-preload.js'),
          additionalArguments: ['--pet-source=zcode'], contextIsolation: true, nodeIntegration: false,
          sandbox: true, spellcheck: false, devTools: false } });
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const request = { win, resolve, ready: false, timer: null };
      pending = request;
      const dismiss = () => { if (pending === request) finish(false); };
      request.timer = schedule(dismiss, 30000);
      position(win);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.webContents.on('did-fail-load', dismiss); win.webContents.on('render-process-gone', dismiss);
      win.on('closed', dismiss); win.on('hide', dismiss);
      win.once('ready-to-show', () => {
        if (pending !== request || win.isDestroyed()) return;
        if (isBlocked()) { dismiss(); return; }
        try {
          cancel(request.timer); request.timer = null; request.ready = true;
          position(win); win.show(); win.focus(); win.webContents.send('pet:zcode-consent-info', info());
        } catch (error) { onError(error); dismiss(); }
      });
      Promise.resolve(win.loadFile(file)).catch(dismiss);
      return result;
    } catch (error) {
      onError(error);
      if (pending) finish(false); else if (win && !win.isDestroyed()) win.destroy();
      return Promise.resolve(false);
    }
  }
  return { open, cancel: () => finish(false), getWindow: () => pending?.win || null,
    close() { closed = true; finish(false); ipcMain.removeHandler('pet:zcode-consent-get'); ipcMain.removeHandler('pet:zcode-consent-answer'); } };
}
module.exports = { createZcodeConsentWindow };
