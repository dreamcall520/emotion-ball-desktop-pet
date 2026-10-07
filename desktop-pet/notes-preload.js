const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('qiuNotes', {
  load: () => ipcRenderer.invoke('notes:load'),
  save: (state, revision) => ipcRenderer.invoke('notes:save', state, revision),
  openNote: id => ipcRenderer.invoke('notes:open-note', id),
  hidePanel: () => ipcRenderer.invoke('notes:hide-panel'),
  closeWindow: () => ipcRenderer.invoke('notes:close-window'),
  pinNote: value => ipcRenderer.invoke('notes:pin-note', value),
  pinPanel: value => ipcRenderer.invoke('notes:pin-panel', value),
  copyText: text => ipcRenderer.invoke('notes:copy', text),
  organizeNote: snapshot => ipcRenderer.invoke('notes:organize', snapshot),
  cancelOrganize: () => ipcRenderer.invoke('notes:organize-cancel'),
  exportRaw: () => ipcRenderer.invoke('notes:export'),
  reset: () => ipcRenderer.invoke('notes:reset'),
  actionReminder: (id, occurrenceId, name) => ipcRenderer.invoke('notes:reminder-action', id, occurrenceId, name),
  onAppearance: callback => listen('notes:appearance', callback),
  onState: callback => listen('notes:state', callback),
  onOpen: callback => listen('notes:open', callback),
  onReminder: callback => listen('notes:reminder', callback),
  onStorageError: callback => listen('notes:storage-error', callback),
  onCloseCancelled: callback => listen('notes:close-cancelled', callback),
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  onBeforeClose(callback) {
    return listen('notes:before-close', async packet => {
      let allowed = false;
      try { allowed = typeof callback === 'function' && await callback(packet) === true; } catch (_) {}
      ipcRenderer.send('notes:close-response', packet?.token, allowed);
    });
  }
});
