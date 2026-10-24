const { contextBridge, ipcRenderer } = require('electron');
const sourceId = typeof process !== 'undefined' && process.argv?.includes('--pet-source=zcode') ? 'zcode' : 'codex';
const prefix = sourceId === 'zcode' ? 'pet:zcode-details' : 'pet:codex-details';
const actions = new Set(sourceId === 'zcode' ? ['tasks', 'results', 'trend', 'quota'] : ['tasks', 'results', 'trend', 'opportunities', 'credits']);
contextBridge.exposeInMainWorld('petCodexDetails', {
  onModel(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, model) => { if (actions.has(model?.action)) callback(sourceId === 'zcode' ? { ...model, sourceId } : model); };
    ipcRenderer.on(prefix, listener);
    return () => ipcRenderer.removeListener(prefix, listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  close() { ipcRenderer.send(`${prefix}-close`); },
  openDetail(action, period) {
    if (!actions.has(action)) return;
    if (sourceId === 'zcode') {
      if (typeof period === 'string' && /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(period)) ipcRenderer.send(`${prefix}-open`, action, period);
    } else ipcRenderer.send(`${prefix}-open`, action, period === 10080 ? 10080 : 300);
  },
  openThread(id, turnId) { if (typeof id === 'string' && id.length <= 200) ipcRenderer.send(`${prefix}-thread`, id, typeof turnId === 'string' ? turnId.slice(0, 200) : null); },
  markAllRead(generation) { return Number.isSafeInteger(generation) && generation >= 0 ? ipcRenderer.invoke(`${prefix}-read-all`, generation) : Promise.resolve(false); },
  resize(height) { if (Number.isSafeInteger(height) && height >= 120 && height <= 2000) ipcRenderer.send(`${prefix}-resize`, height); }
});
