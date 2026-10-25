const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuWorkBuddyLabel', {
  onMotion(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      if (!value || typeof value.visible !== 'boolean' || typeof value.animate !== 'boolean') return;
      callback({visible:value.visible,animate:value.animate,index:Number.isInteger(value.index)?Math.max(0,Math.min(3,value.index)):0});
    };
    ipcRenderer.on('pet:quota-card-motion',listener);
    return () => ipcRenderer.removeListener('pet:quota-card-motion',listener);
  },

  toggle: () => ipcRenderer.send('pet:workbuddy-label-toggle'),
  refresh: () => ipcRenderer.send('pet:workbuddy-label-refresh'),
  tasks: (kind = 'tasks') => { if (['tasks', 'results'].includes(kind)) ipcRenderer.send('pet:workbuddy-label-tasks', kind); },
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
