const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuPomodoro', {
  load: () => ipcRenderer.invoke('pomodoro:load'),
  action: (type, value) => ipcRenderer.invoke('pomodoro:action', type, value),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pomodoro:state', listener);
    return () => ipcRenderer.removeListener('pomodoro:state', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', ['blue', 'purple'].includes(theme) ? theme : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
