const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edgeNotice', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onUpdate(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('pet:edge-notice', listener);
    return () => ipcRenderer.removeListener('pet:edge-notice', listener);
  }
});
