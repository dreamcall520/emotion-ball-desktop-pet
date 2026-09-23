const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petThought', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value === 'accessible' ? 'accessible' : 'standard');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onFrame(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:thought-frame', listener);
    return () => ipcRenderer.removeListener('pet:thought-frame', listener);
  }
});
