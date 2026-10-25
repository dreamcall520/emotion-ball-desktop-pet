const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('quotaCardGroup',{activate:mode=>ipcRenderer.send('pet:quota-card-group-action',mode==='pointer'?'pointer':'keyboard'),dismiss:()=>ipcRenderer.send('pet:quota-card-group-action','dismiss'),onState:fn=>ipcRenderer.on('pet:quota-card-group-state',(_e,value)=>fn(value))});
