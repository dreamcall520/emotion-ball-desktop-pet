const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBubble', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onMessage: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:bubble', listener);
    return () => ipcRenderer.removeListener('pet:bubble', listener);
  },
  reply: (id, action) => {
    if (Number.isInteger(id) && ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss'].includes(action)) {
      ipcRenderer.send('pet:bubble-reply', { id, action });
    }
  },
  resize: (id, height) => {
    if (Number.isInteger(id) && Number.isFinite(height) && height > 0 && height <= 1000) {
      ipcRenderer.send('pet:bubble-resize', { id, height: Math.ceil(height) });
    }
  }
});
