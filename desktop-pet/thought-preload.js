const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petThought', {
  onFrame(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:thought-frame', listener);
    return () => ipcRenderer.removeListener('pet:thought-frame', listener);
  }
});
