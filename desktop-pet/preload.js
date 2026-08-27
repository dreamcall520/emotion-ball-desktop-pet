const { contextBridge, ipcRenderer } = require('electron');
// sandbox 预加载不加载本地模块，只暴露固定的动作名称与数据字段。
const motionIds = new Set(['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']);

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
  playMotion: request => {
    if (request && Number.isSafeInteger(request.token) && request.token > 0 && motionIds.has(request.action)) {
      ipcRenderer.send('pet:motion-start', { token: request.token, action: request.action });
    }
  },
  say: event => {
    if (typeof event === 'string') ipcRenderer.send('pet:say', event);
    else if (event?.event === 'play' && motionIds.has(event.motion)) {
      ipcRenderer.send('pet:say', { event: 'play', motion: event.motion });
    }
  },
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onCommand: callback => subscribe('pet:command', callback),
  onMotion: callback => subscribe('pet:motion-frame', callback),
  onActivity: callback => subscribe('pet:activity', callback),
  onSettings: callback => subscribe('pet:settings', callback)
});
