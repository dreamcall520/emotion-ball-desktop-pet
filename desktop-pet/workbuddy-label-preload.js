const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qiuqiuWorkBuddyLabel', {
  toggle: () => ipcRenderer.send('pet:workbuddy-label-toggle'),
  refresh: () => ipcRenderer.send('pet:workbuddy-label-refresh'),
  chat: () => ipcRenderer.send('pet:workbuddy-label-chat'),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:workbuddy-label', listener);
    return () => ipcRenderer.removeListener('pet:workbuddy-label', listener);
  }
});
