'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuShortcuts', {
  getState: () => ipcRenderer.invoke('shortcut:get-state'),
  openAction: id => ipcRenderer.send('shortcut:action', id),
  close: () => ipcRenderer.send('shortcut:close'),
  openSettings: () => ipcRenderer.send('shortcut:settings'),
  setShape: shape => ipcRenderer.invoke('shortcut:shape', shape),
  save: config => ipcRenderer.invoke('shortcut:save', config),
  pointer: () => ipcRenderer.send('shortcut:pointer'),
  recording: value => ipcRenderer.send('shortcut:recording', value === true),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('shortcut:state', listener);
    return () => ipcRenderer.removeListener('shortcut:state', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, mode, appearance, theme) => callback(
      mode === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system',
      theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
