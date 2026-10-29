const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuAbout', {
  getInfo: () => ipcRenderer.invoke('pet:about-get'),
  openWebsite: () => ipcRenderer.invoke('pet:about-website'),
  checkUpdates: () => ipcRenderer.invoke('pet:about-update'),
  downloadUpdate: () => ipcRenderer.invoke('pet:about-release'),
  openBrowserDownload: () => ipcRenderer.invoke('pet:about-download-alternative', 'browser'),
  openDomesticDownload: () => ipcRenderer.invoke('pet:about-download-alternative', 'domestic'),
  close: () => ipcRenderer.send('pet:about-close'),
  onUpdate(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:about-update-state', listener);
    return () => ipcRenderer.removeListener('pet:about-update-state', listener);
  },
  onColorMode(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  }
});
