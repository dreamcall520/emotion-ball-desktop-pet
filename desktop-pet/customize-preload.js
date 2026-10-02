const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petCustomizer', {
  load: () => ipcRenderer.invoke('pet:customization-get'),
  save: (value, setAsStartupDefault) => ipcRenderer.invoke('pet:customization-save', value, setAsStartupDefault),
  preview: appearance => ipcRenderer.send('pet:customization-preview', appearance)
});
