const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petCustomizer', {
  onPromotionOpen: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => { if (typeof value === 'string') callback(value); };
    ipcRenderer.on('pet:promotion-open', listener);
    return () => ipcRenderer.removeListener('pet:promotion-open', listener);
  },
  promotionReady: token => { if (typeof token === 'string') ipcRenderer.send('pet:promotion-ready', token); },
  promotionContact: action => ipcRenderer.invoke('pet:promotion-contact', action),
  onVisibility: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, visible) => callback(visible === true);
    ipcRenderer.on('pet:customization-visible', listener);
    return () => ipcRenderer.removeListener('pet:customization-visible', listener);
  },
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', ['blue', 'purple'].includes(theme) ? theme : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  load: () => ipcRenderer.invoke('pet:customization-get'),
  listLocalPets: () => ipcRenderer.invoke('pet:local-pets-list'),
  importLocalPet: () => ipcRenderer.invoke('pet:local-pets-import'),
  deleteLocalPet: id => ipcRenderer.invoke('pet:local-pets-delete', id),
  listCodexPets: () => ipcRenderer.invoke('pet:codex-pets-list'),
  setSize: size => ipcRenderer.invoke('pet:customization-size', size),
  onSize: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, size) => callback(size);
    ipcRenderer.on('pet:size', listener);
    return () => ipcRenderer.removeListener('pet:size', listener);
  },
  addPreset: (name, appearance) => ipcRenderer.invoke('pet:appearance-preset-add', { name, appearance }),
  renamePreset: (id, name) => ipcRenderer.invoke('pet:appearance-preset-rename', { id, name }),
  deletePreset: id => ipcRenderer.invoke('pet:appearance-preset-delete', { id }),
  save: (value, setAsStartupDefault, quotaDisplay) => quotaDisplay === undefined
    ? ipcRenderer.invoke('pet:customization-save', value, setAsStartupDefault)
    : ipcRenderer.invoke('pet:customization-save', value, setAsStartupDefault, quotaDisplay),
  onQuota: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, model) => callback(model);
    ipcRenderer.on('pet:quota-display', listener);
    return () => ipcRenderer.removeListener('pet:quota-display', listener);
  },
  preview: appearance => ipcRenderer.send('pet:customization-preview', appearance)
});
