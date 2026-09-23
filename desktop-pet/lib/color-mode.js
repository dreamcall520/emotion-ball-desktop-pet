function createColorModeManager({ getMode, getAppearance = () => 'system' }) {
  const windows = new Set();
  const send = win => {
    if (win.isDestroyed()) return;
    try {
      const appearance = getAppearance();
      win.webContents.send('pet:color-mode', getMode() === 'accessible' ? 'accessible' : 'standard',
        ['light', 'dark'].includes(appearance) ? appearance : 'system');
    } catch (_) {
      // A satellite window can close between the liveness check and send.
    }
  };
  return {
    track(win) {
      if (windows.has(win) || win.isDestroyed()) return;
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
