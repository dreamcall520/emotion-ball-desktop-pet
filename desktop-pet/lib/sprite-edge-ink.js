'use strict';
const COLUMNS=64, ROWS=64, TUCK_FRACTION=.672, ASPECT=192/208;
function normalizeSpriteEdgeInk(packet){
 if(!packet||typeof packet.id!=='string'||packet.id.length>256||packet.columns!==COLUMNS||!Array.isArray(packet.rows)||packet.rows.length!==ROWS||Object.keys(packet).some(key=>!['id','columns','rows'].includes(key))||packet.rows.some(row=>typeof row!=='string'||!/^[a-f0-9]{16}$/.test(row)))return null;
 return Object.freeze({id:packet.id,columns:COLUMNS,rows:Object.freeze([...packet.rows])});
}
function containsSpriteEdgeInk(mask,{bounds,side,mode='tucked',point}){
 if(!mask||!bounds||!point||!['left','right'].includes(side)||!Number.isFinite(point.x)||!Number.isFinite(point.y)||bounds.width<=0||bounds.height<=0)return false;
 if(!['tucked','peeked'].includes(mode)||point.x<bounds.x||point.x>=bounds.x+bounds.width||point.y<bounds.y||point.y>=bounds.y+bounds.height)return false;
 if(mode==='peeked'&&containsSpriteEdgeInk(mask,{bounds,side,mode:'tucked',point}))return true;
 const size=Math.min(bounds.width,bounds.height),width=size*ASPECT;
 const shift=mode==='tucked'?(side==='left'?-1:1)*bounds.width*TUCK_FRACTION:0;
 const left=(bounds.width-width)/2+shift,top=(bounds.height-size)/2;
 let u=(point.x-bounds.x-left)/width;const v=(point.y-bounds.y-top)/size;
 if(side==='right')u=1-u;
 if(u<0||u>=1||v<0||v>=1)return false;
 const x=Math.floor(u*COLUMNS),y=Math.floor(v*ROWS),nibble=parseInt(mask.rows[y][Math.floor(x/4)],16);
 return Boolean(nibble&(1<<(3-x%4)));
}
module.exports={COLUMNS,ROWS,TUCK_FRACTION,normalizeSpriteEdgeInk,containsSpriteEdgeInk};
