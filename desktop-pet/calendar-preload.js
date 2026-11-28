const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuCalendar', Object.freeze({
  get: () => ipcRenderer.invoke('calendar:get'),
  action: (action, value) => ipcRenderer.invoke('calendar:action', { action, value }),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('calendar:state', listener);
    return () => ipcRenderer.removeListener('calendar:state', listener);
  }
}));
