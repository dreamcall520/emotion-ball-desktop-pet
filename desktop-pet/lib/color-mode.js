function createColorModeManager({ getMode }) {
  const windows = new Set();
  const send = win => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send('pet:color-mode', getMode() === 'accessible' ? 'accessible' : 'standard');
    } catch (_) {
      // A satellite window can close between the liveness check and send.
    }
  };
  return {
    track(win) {
      if (windows.has(win) || win.isDestroyed()) return;
      windows.add(win);
      const loaded = () => send(win);
      win.webContents.on('did-finish-load', loaded);
      win.once('closed', () => {
        windows.delete(win);
        win.webContents.removeListener('did-finish-load', loaded);
      });
    },
    sync() { for (const win of windows) send(win); }
  };
}

module.exports = { createColorModeManager };
