const { contextBridge, ipcRenderer } = require('electron');
const CHANNEL = 'pet:api-balance-details';
contextBridge.exposeInMainWorld('petApiBalanceDetails', {
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_, value) => callback(value); ipcRenderer.on(CHANNEL, listener);
    return () => ipcRenderer.removeListener(CHANNEL, listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_, mode, appearance, theme) => callback(mode === 'accessible' ? 'accessible' : 'standard', ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener); return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  resize(height) { if (Number.isSafeInteger(height) && height >= 300 && height <= 700) ipcRenderer.send(`${CHANNEL}-resize`, height); },
  close: () => ipcRenderer.send(`${CHANNEL}-close`)
});
