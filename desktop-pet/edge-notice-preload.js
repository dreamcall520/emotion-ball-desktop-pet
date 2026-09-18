const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edgeNotice', {
  onUpdate(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('pet:edge-notice', listener);
    return () => ipcRenderer.removeListener('pet:edge-notice', listener);
  }
});
