const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sheepOfferingWindow',{
 onView(callback){if(typeof callback!=='function')return()=>{};const fn=(_e,v)=>callback(v);ipcRenderer.on('pet:offering-view',fn);return()=>ipcRenderer.removeListener('pet:offering-view',fn);},
 pointer(v){if(v&&['hit','approach','begin','move','end','cancel','activate'].includes(v.type)&&(['approach','cancel','activate'].includes(v.type)||[v.x,v.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=8192)))ipcRenderer.send('pet:offering-input',{type:v.type,x:v.x,y:v.y});}
});
