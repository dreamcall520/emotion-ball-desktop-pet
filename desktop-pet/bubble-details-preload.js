const { contextBridge, ipcRenderer } = require('electron');
const onColorMode = callback => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
    ['light', 'dark'].includes(appearance) ? appearance : 'system', ['blue', 'purple'].includes(theme) ? theme : 'green');
  ipcRenderer.on('pet:color-mode', listener);
  return () => ipcRenderer.removeListener('pet:color-mode', listener);
};
contextBridge.exposeInMainWorld('petBubbleDetails', {
  onColorMode,
  onMessage: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:bubble-details-content', listener);
    return () => ipcRenderer.removeListener('pet:bubble-details-content', listener);
  }
});
// Shared color-mode.js discovers the established bubble bridge.
contextBridge.exposeInMainWorld('petBubble', { onColorMode });
