const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edgeNotice', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value === 'accessible' ? 'accessible' : 'standard');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onUpdate(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('pet:edge-notice', listener);
    return () => ipcRenderer.removeListener('pet:edge-notice', listener);
  }
});
