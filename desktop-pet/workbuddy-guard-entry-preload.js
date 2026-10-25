const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petQuotaLabel', {
  openGuard: () => ipcRenderer.send('pet:workbuddy-guard-entry-open'),
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, model) => callback(model);
    ipcRenderer.on('pet:workbuddy-guard-entry', listener);
    return () => ipcRenderer.removeListener('pet:workbuddy-guard-entry', listener);
  }
});
