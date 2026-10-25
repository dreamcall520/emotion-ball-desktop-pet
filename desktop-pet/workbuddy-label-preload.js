const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuWorkBuddyLabel', {
  toggle: () => ipcRenderer.send('pet:workbuddy-label-toggle'),
  refresh: () => ipcRenderer.send('pet:workbuddy-label-refresh'),
  tasks: () => ipcRenderer.send('pet:workbuddy-label-tasks'),
  trend: () => ipcRenderer.send('pet:workbuddy-label-trend'),
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:workbuddy-label', listener);
    return () => ipcRenderer.removeListener('pet:workbuddy-label', listener);
  }
});
