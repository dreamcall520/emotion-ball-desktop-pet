const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['enable-provider','open-provider-chat','revoke-provider','authorize-workbuddy-desktop','read-workbuddy-desktop','revoke-workbuddy-desktop','import-workbuddy-cli','refresh-workbuddy-cli','connect-workbuddy-cli','send-workbuddy-cli','cancel-workbuddy-cli','review-workbuddy-cli-unknown','configure-workbuddy-official','authorize-workbuddy-official','refresh-workbuddy-official','send-workbuddy-assistant','read-workbuddy-assistant','disconnect-workbuddy-official','review-workbuddy-unknown','import-zcode-service','connect-zcode','revoke-codex','revoke-zcode','status','authorize-codex','authorize-zcode','import-codex-service','connect-codex','open-chat','workbuddy-login','refresh-workbuddy','refresh-zcode','refresh-status']);
contextBridge.exposeInMainWorld('storeConnections', {
  command: (action,payload) => action==='enable-provider'&&payload?.provider==='zcode'&&payload.accountSource!==undefined&&!['official','configured-custom'].includes(payload.accountSource)?Promise.reject(new Error('INVALID_ACCOUNT_SOURCE')):actions.has(action) ? ipcRenderer.invoke('pet:store-connections-command', action, payload && typeof payload==='object' ? {provider:['codex','zcode','workbuddy'].includes(payload.provider)?payload.provider:undefined,accountSource:action==='enable-provider'&&payload.provider==='zcode'&&['official','configured-custom'].includes(payload.accountSource)?payload.accountSource:undefined,partitionId:typeof payload.partitionId==='string'?payload.partitionId.slice(0,80):undefined,baseUrl:typeof payload.baseUrl==='string'?payload.baseUrl.slice(0,512):undefined,content:typeof payload.content==='string'?payload.content.slice(0,8001):undefined}:undefined) : Promise.reject(new Error('INVALID_ACTION')),
  onFocusProvider: listener => {
    if(typeof listener!=='function')return()=>{};
    const receive=(_event,provider)=>{if(['codex','zcode','workbuddy'].includes(provider))listener(provider);};
    ipcRenderer.on('pet:store-focus-provider',receive);
    return()=>ipcRenderer.removeListener('pet:store-focus-provider',receive);
  },
  onChange: listener => { const receive = () => listener(); ipcRenderer.on('pet:store-connections-changed', receive); return () => ipcRenderer.removeListener('pet:store-connections-changed', receive); }
});
