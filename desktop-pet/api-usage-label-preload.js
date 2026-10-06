const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuApiUsageLabel', {
  toggle: () => ipcRenderer.send('pet:api-usage-label-toggle'),
  openDetails: () => ipcRenderer.send('pet:api-usage-label-open'),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:api-usage-label', listener);
    return () => ipcRenderer.removeListener('pet:api-usage-label', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
