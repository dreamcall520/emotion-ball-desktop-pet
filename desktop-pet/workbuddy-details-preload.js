const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petWorkBuddyDetails', {
  onModel(callback) { if (typeof callback !== 'function') return () => {}; const listener = (_, value) => callback(value); ipcRenderer.on('pet:workbuddy-details', listener); return () => ipcRenderer.removeListener('pet:workbuddy-details', listener); },
  onColorMode(callback) { if (typeof callback !== 'function') return () => {}; const listener = (_, mode, appearance, theme) => callback(mode === 'accessible' ? 'accessible' : 'standard', ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green'); ipcRenderer.on('pet:color-mode', listener); return () => ipcRenderer.removeListener('pet:color-mode', listener); },
  resize(height) { if (Number.isSafeInteger(height) && height >= 120 && height <= 700) ipcRenderer.send('pet:workbuddy-details-resize', height); },
  close: () => ipcRenderer.send('pet:workbuddy-details-close')
});
