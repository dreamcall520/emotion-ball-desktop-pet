const {contextBridge,ipcRenderer}=require('electron');
const token=value=>Number.isSafeInteger(value)&&value>0;
const stages=new Set(['decoded','raf1','raf2','animating']);
const trace=(value,stage)=>{if(token(value))ipcRenderer.send('pet:quota-card-transition-trace',{token:value,stage});};
const rect=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0&&b.width<=8192&&b.height<=8192;
contextBridge.exposeInMainWorld('quotaCardTransition',{
  onPrepare(callback){if(typeof callback!=='function')return()=>{};const listener=(_event,value)=>{
    trace(value?.token,'received');
    try{if(!value||!token(value.token))return;
      if(!rect(value.bounds)){trace(value.token,'invalid-bounds');return;}
      if(!rect(value.anchor)){trace(value.token,'invalid-anchor');return;}
      if(!Array.isArray(value.layers)||!value.layers.length||value.layers.length>8){trace(value.token,'invalid-layers');return;}
      let bytes=0;const layers=value.layers.map(layer=>{if(!rect(layer.bounds)||typeof layer.image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(layer.image))throw Error('invalid layer');bytes+=layer.image.length;return{bounds:{x:layer.bounds.x,y:layer.bounds.y,width:layer.bounds.width,height:layer.bounds.height},image:layer.image};});if(bytes>44*1024*1024){trace(value.token,'invalid-size');return;}
      trace(value.token,'accepted');
      callback({token:value.token,bounds:{...value.bounds},anchor:{...value.anchor},layers,expanded:value.expanded===true,scale:Number.isFinite(value.scale)?Math.max(1,Math.min(3,value.scale)):1});
    }catch(_){trace(value?.token,'invalid-layers');}
  };ipcRenderer.on('pet:quota-card-transition-prepare',listener);return()=>ipcRenderer.removeListener('pet:quota-card-transition-prepare',listener);},
  onAnimate(callback){if(typeof callback!=='function')return()=>{};const listener=(_event,value)=>{if(value&&token(value.token)&&typeof value.expanded==='boolean')callback({token:value.token,expanded:value.expanded});};ipcRenderer.on('pet:quota-card-transition-animate',listener);return()=>ipcRenderer.removeListener('pet:quota-card-transition-animate',listener);},
  onClear(callback){if(typeof callback!=='function')return()=>{};const listener=()=>callback();ipcRenderer.on('pet:quota-card-transition-clear',listener);return()=>ipcRenderer.removeListener('pet:quota-card-transition-clear',listener);},
  trace(value){if(value&&stages.has(value.stage))trace(value.token,value.stage);},
  ack(value){if(value&&token(value.token)&&['prepared','finished'].includes(value.phase)&&typeof value.ok==='boolean')ipcRenderer.send('pet:quota-card-transition-ack',{token:value.token,phase:value.phase,ok:value.ok});}
});
