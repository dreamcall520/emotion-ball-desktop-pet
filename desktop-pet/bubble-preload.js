const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBubble', {
  onMessage: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:bubble', listener);
    return () => ipcRenderer.removeListener('pet:bubble', listener);
  },
  reply: (id, action) => {
    if (Number.isInteger(id) && ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss'].includes(action)) {
      ipcRenderer.send('pet:bubble-reply', { id, action });
    }
  }
});
