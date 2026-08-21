const { contextBridge, ipcRenderer } = require('electron');

function pointPayload(point) {
  return { x: point && point.x, y: point && point.y };
}

contextBridge.exposeInMainWorld('petDesktop', {
  beginDrag: point => ipcRenderer.send('pet:drag-start', pointPayload(point)),
  dragTo: point => ipcRenderer.send('pet:drag-move', pointPayload(point)),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  bounce: () => ipcRenderer.send('pet:bounce'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onCommand: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('pet:command', listener);
    return () => ipcRenderer.removeListener('pet:command', listener);
  }
});
