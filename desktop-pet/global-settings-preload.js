const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuSettings', {
  saveShortcuts: config => ipcRenderer.invoke('pet:global-shortcuts-save', config),
  recordShortcuts: value => ipcRenderer.send('pet:global-shortcuts-record', value),
  get: () => ipcRenderer.invoke('pet:global-settings-get'),
  act: (id, checked) => ipcRenderer.invoke('pet:global-settings-action', id, checked),
  onNavigate(callback) {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('pet:global-settings-navigate', listener);
    return () => ipcRenderer.removeListener('pet:global-settings-navigate', listener);
  },
  onColorMode(callback) {
    const listener = (_event, mode, appearance, theme) => callback(mode, appearance, theme);
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
