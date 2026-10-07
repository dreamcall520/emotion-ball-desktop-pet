const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['tasks', 'results', 'trend', 'opportunities', 'credits']);
contextBridge.exposeInMainWorld('petCodexDetails', {
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, model) => { if (actions.has(model?.action)) callback(model); };
    ipcRenderer.on('pet:codex-details', listener);
    return () => ipcRenderer.removeListener('pet:codex-details', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  close() { ipcRenderer.send('pet:codex-details-close'); },
  openDetail(action, period) { if (actions.has(action)) ipcRenderer.send('pet:codex-details-open', action, period === 10080 ? 10080 : 300); },
  openThread(id, turnId) { if (typeof id === 'string' && id.length <= 200) ipcRenderer.send('pet:codex-details-thread', id, typeof turnId === 'string' ? turnId.slice(0, 200) : null); },
  resize(height) { if (Number.isSafeInteger(height) && height >= 120 && height <= 2000) ipcRenderer.send('pet:codex-details-resize', height); }
});
