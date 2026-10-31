const { contextBridge, ipcRenderer } = require('electron');
const CHANNEL = 'pet:api-balance-label';
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('qiuqiuApiBalanceLabel', {
  onPointerReset(callback) {
    if (typeof callback !== 'function') return () => {};
    return subscribe('pet:quota-card-pointer-reset', () => callback());
  },
  toggle: () => ipcRenderer.send(`${CHANNEL}-toggle`),
  trend: () => ipcRenderer.send(`${CHANNEL}-trend`),
  refresh: () => ipcRenderer.send(`${CHANNEL}-refresh`),
  settings: () => ipcRenderer.send(`${CHANNEL}-settings`),
  selectAccount: id => { if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) ipcRenderer.send(`${CHANNEL}-select`, id); },
  onState: callback => subscribe(CHANNEL, callback),
  onMotion(callback) {
    if (typeof callback !== 'function') return () => {};
    return subscribe('pet:quota-card-motion', value => {
      if (typeof value?.visible === 'boolean' && typeof value.animate === 'boolean') {
        callback({ visible: value.visible, animate: value.animate, index: Number.isInteger(value.index) ? Math.max(0, Math.min(4, value.index)) : 0 });
      }
    });
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', ['blue', 'purple'].includes(theme) ? theme : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
