const { contextBridge, ipcRenderer } = require('electron');

function pointPayload(point) {
  return { x: point && point.x, y: point && point.y };
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('petDesktop', {
  beginDrag: point => ipcRenderer.send('pet:drag-start', pointPayload(point)),
  dragTo: point => ipcRenderer.send('pet:drag-move', pointPayload(point)),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  bounce: () => ipcRenderer.send('pet:bounce'),
  stopMotion: () => ipcRenderer.send('pet:stop-motion'),
  say: event => {
    if (typeof event === 'string') ipcRenderer.send('pet:say', event);
  },
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onCommand: callback => subscribe('pet:command', callback),
  onActivity: callback => subscribe('pet:activity', callback),
  onSettings: callback => subscribe('pet:settings', callback)
});
