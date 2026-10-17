const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuSettings', {
  get: () => ipcRenderer.invoke('pet:global-settings-get'),
  act: (id, checked) => ipcRenderer.invoke('pet:global-settings-action', id, checked),
  onColorMode(callback) {
    const listener = (_event, mode, appearance, theme) => callback(mode, appearance, theme);
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
