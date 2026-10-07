const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuApiUsage', {
  getState: () => ipcRenderer.invoke('pet:api-usage-get'),
  connect: value => ipcRenderer.invoke('pet:api-usage-connect', value),
  refresh: () => ipcRenderer.invoke('pet:api-usage-refresh'),
  disconnect: () => ipcRenderer.invoke('pet:api-usage-disconnect'),
  openGuide: () => ipcRenderer.invoke('pet:api-usage-guide'),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:api-usage-state', listener);
    return () => ipcRenderer.removeListener('pet:api-usage-state', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
