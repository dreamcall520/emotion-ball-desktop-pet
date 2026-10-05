const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petCustomizer', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  load: () => ipcRenderer.invoke('pet:customization-get'),
  addPreset: (name, appearance) => ipcRenderer.invoke('pet:appearance-preset-add', { name, appearance }),
  renamePreset: (id, name) => ipcRenderer.invoke('pet:appearance-preset-rename', { id, name }),
  deletePreset: id => ipcRenderer.invoke('pet:appearance-preset-delete', { id }),
  save: (value, setAsStartupDefault) => ipcRenderer.invoke('pet:customization-save', value, setAsStartupDefault),
  preview: appearance => ipcRenderer.send('pet:customization-preview', appearance)
});
