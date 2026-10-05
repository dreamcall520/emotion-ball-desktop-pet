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
  save: (value, setAsStartupDefault) => ipcRenderer.invoke('pet:customization-save', value, setAsStartupDefault),
  preview: appearance => ipcRenderer.send('pet:customization-preview', appearance)
});
