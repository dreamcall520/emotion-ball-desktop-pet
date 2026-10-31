const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['import-zcode-service','connect-zcode','revoke-codex','revoke-zcode','status','authorize-codex','authorize-zcode','import-codex-service','connect-codex','open-chat','workbuddy-login','refresh-workbuddy','refresh-zcode','refresh-status']);
contextBridge.exposeInMainWorld('storeConnections', {
  command: action => actions.has(action) ? ipcRenderer.invoke('pet:store-connections-command', action) : Promise.reject(new Error('INVALID_ACTION')),
  onChange: listener => { const receive = () => listener(); ipcRenderer.on('pet:store-connections-changed', receive); return () => ipcRenderer.removeListener('pet:store-connections-changed', receive); }
});
