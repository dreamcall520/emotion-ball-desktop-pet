const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuConsent', {
  getInfo: () => ipcRenderer.invoke('pet:codex-consent-get'),
  answer: accepted => typeof accepted === 'boolean' ? ipcRenderer.invoke('pet:codex-consent-answer', accepted) : Promise.resolve(false),
  onInfo: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('pet:codex-consent-info', listener);
    return () => ipcRenderer.removeListener('pet:codex-consent-info', listener);
  },
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, mode, appearance, theme) => callback(mode === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
