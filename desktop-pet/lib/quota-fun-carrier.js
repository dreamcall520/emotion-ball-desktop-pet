'use strict';
const SOURCES=new Set(['codex','workbuddy','api','balance','zcode']);
const validBounds=value=>value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))&&value.width>0&&value.height>0;
// Main supplies only the bounds of genuinely shown native cards. Keep selection
// in the user's displayed order; weather never carries a quota interaction.
function selectQuotaFunCarrier({order=[],enabled=false,visible={},playable=null}={}){
 if(enabled!==true||!Array.isArray(order)||!visible||typeof visible!=='object')return null;
 let fallback=null;
 for(const source of order){
  if(!SOURCES.has(source)||!Object.hasOwn(visible,source)||!validBounds(visible[source]))continue;
  const {x,y,width,height}=visible[source],candidate={source,bounds:{x,y,width,height}};
  if(!fallback)fallback=candidate;
  if(!playable||playable[source]===true)return candidate;
 }
 return fallback;
}
module.exports={selectQuotaFunCarrier};
