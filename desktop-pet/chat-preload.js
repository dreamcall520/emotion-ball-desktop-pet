const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qiuqiuChat', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
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
  setModel(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id)) {
      return Promise.resolve({ accepted: false, error: '请选择可用的模型。' });
    }
    return ipcRenderer.invoke('pet:chat-model', id);
  },
  refreshModels: () => ipcRenderer.invoke('pet:chat-models-refresh'),
  newChat: () => ipcRenderer.invoke('pet:chat-new'),
  selectChat(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) {
      return Promise.resolve({ accepted: false, error: '这段聊天暂时无法打开。' });
    }
    return ipcRenderer.invoke('pet:chat-select', id);
  },
  close: () => ipcRenderer.send('pet:chat-close')
});
