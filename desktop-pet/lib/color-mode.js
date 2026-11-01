const path = require('node:path');
function createColorModeManager({ getMode, getAppearance = () => 'system', getTheme = () => 'blue', ipcMain }) {
  const windows = new Set(), sessions = new WeakSet();
  const snapshot = () => ({ mode: getMode() === 'accessible' ? 'accessible' : 'standard',
    appearance: ['light', 'dark'].includes(getAppearance()) ? getAppearance() : 'system',
    theme: ['green', 'blue', 'purple'].includes(getTheme()) ? getTheme() : 'blue' });
  ipcMain?.on('pet:initial-color-mode', event => {
    let value = null;
    for (const win of windows) {
      if (!win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
          event.senderFrame?.url?.startsWith('file:')) { value = snapshot(); break; }
    }
    event.returnValue = value;
  });
  const send = win => {
    if (win.isDestroyed()) return;
    try {
      const { mode, appearance, theme } = snapshot();
      win.webContents.send('pet:color-mode', mode, appearance, theme);
    } catch (_) {
      // A satellite window can close between the liveness check and send.
    }
  };
  return {
    track(win) {
      if (windows.has(win) || win.isDestroyed()) return;
      const session = win.webContents.session;
      if (session && !sessions.has(session)) {
        session.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, '../theme-preload.js') });
        sessions.add(session);
      }
      windows.add(win);
      const contents = win.webContents;
      const loaded = () => send(win);
      contents.on('did-finish-load', loaded);
      win.once('closed', () => {
        windows.delete(win);
        // BrowserWindow.webContents itself throws after native window destruction.
        contents.removeListener('did-finish-load', loaded);
      });
    },
    sync() { for (const win of windows) send(win); }
  };
}

module.exports = { createColorModeManager };
