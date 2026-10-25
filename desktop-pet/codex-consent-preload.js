const { contextBridge, ipcRenderer } = require('electron');

const sourceId = typeof process !== 'undefined' && process.argv?.includes('--pet-source=zcode') ? 'zcode' : 'codex';
const prefix = sourceId === 'zcode' ? 'pet:zcode-consent' : 'pet:codex-consent';

contextBridge.exposeInMainWorld('qiuqiuConsent', {
  getInfo: () => ipcRenderer.invoke(`${prefix}-get`),
  answer: accepted => typeof accepted === 'boolean' ? ipcRenderer.invoke(`${prefix}-answer`, accepted) : Promise.resolve(false),
  onInfo: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(`${prefix}-info`, listener);
    return () => ipcRenderer.removeListener(`${prefix}-info`, listener);
  },
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, mode, appearance, theme) => callback(mode === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
