const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuChat', {
  getState: () => ipcRenderer.invoke('pet:chat-get'),
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('pet:chat-state', listener);
    return () => ipcRenderer.removeListener('pet:chat-state', listener);
  },
  send(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
      return Promise.resolve({ accepted: false, error: '请输入 1–2000 字的消息。' });
    }
    return ipcRenderer.invoke('pet:chat-send', text.trim());
  },
  stop: () => ipcRenderer.invoke('pet:chat-stop'),
  newChat: () => ipcRenderer.invoke('pet:chat-new'),
  selectChat(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) {
      return Promise.resolve({ accepted: false, error: '这段聊天暂时无法打开。' });
    }
    return ipcRenderer.invoke('pet:chat-select', id);
  },
  close: () => ipcRenderer.send('pet:chat-close')
});
