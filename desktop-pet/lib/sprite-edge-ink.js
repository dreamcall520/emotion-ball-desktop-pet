'use strict';
const COLUMNS=64, ROWS=64, TUCK_FRACTION=.672, XIAOBAI_TUCK_FRACTION=.533538461538, ASPECT=192/208;
const DIRECTIONAL_TUCK_FRACTION = .407;
function normalizeSpriteEdgeInk(packet){
 if(!packet||typeof packet.id!=='string'||packet.id.length>256||packet.columns!==COLUMNS||!Array.isArray(packet.rows)||packet.rows.length!==ROWS||Object.keys(packet).some(key=>!['id','columns','rows','aspect'].includes(key))||(packet.aspect!==undefined&&(!Number.isFinite(packet.aspect)||packet.aspect<ASPECT||packet.aspect>320/208))||packet.rows.some(row=>typeof row!=='string'||!/^[a-f0-9]{16}$/.test(row)))return null;
 return Object.freeze({id:packet.id,columns:COLUMNS,rows:Object.freeze([...packet.rows]),...(packet.aspect===undefined?{}:{aspect:packet.aspect})});
}
function spriteInkSize(mask, bounds) {
 const aspect = mask?.aspect ?? ASPECT;
 const width = Math.min(Math.min(bounds.width, bounds.height) * aspect, bounds.width);
 return { width, height: width / aspect };
}
function spriteHalfTuckFraction(mask, idleFacing, bounds = { width: 1, height: 1 }) {
 let first = COLUMNS, last = -1;
 for (const row of mask?.rows || []) for (let x = 0; x < COLUMNS; x++) {
  if (parseInt(row[Math.floor(x / 4)], 16) & (1 << (3 - x % 4))) {
   first = Math.min(first, x); last = Math.max(last, x);
  }
 }
 // Align the screen edge with the painted body's centre, including asymmetric transparent margins.
 return last < first ? .5 : .5 + (idleFacing === 'right' ? 1 : -1) * spriteInkSize(mask, bounds).width / bounds.width * ((first + last + 1) / (2 * COLUMNS) - .5);
}
function containsSpriteEdgeInk(mask,{bounds,side,mode='tucked',point,tuckFraction=TUCK_FRACTION,idleFacing}){
 if(!mask||!bounds||!point||!['left','right'].includes(side)||!Number.isFinite(point.x)||!Number.isFinite(point.y)||bounds.width<=0||bounds.height<=0)return false;
 if(!['tucked','peeked'].includes(mode)||point.x<bounds.x||point.x>=bounds.x+bounds.width||point.y<bounds.y||point.y>=bounds.y+bounds.height)return false;
 if(mode==='peeked'&&!idleFacing&&containsSpriteEdgeInk(mask,{bounds,side,mode:'tucked',point,tuckFraction,idleFacing}))return true;
 const { width, height } = spriteInkSize(mask, bounds);
 const shift=mode==='tucked'?(side==='left'?-1:1)*bounds.width*tuckFraction:0;
 const left=(bounds.width-width)/2+shift,top=(bounds.height-height)/2;
 let u=(point.x-bounds.x-left)/width;const v=(point.y-bounds.y-top)/height;
 if (idleFacing ? side === idleFacing : side === 'right') u = 1 - u;
 if(u<0||u>=1||v<0||v>=1)return false;
 const x=Math.floor(u*COLUMNS),y=Math.floor(v*ROWS),nibble=parseInt(mask.rows[y][Math.floor(x/4)],16);
 return Boolean(nibble&(1<<(3-x%4)));
}
module.exports={COLUMNS,ROWS,TUCK_FRACTION,XIAOBAI_TUCK_FRACTION,DIRECTIONAL_TUCK_FRACTION,normalizeSpriteEdgeInk,spriteHalfTuckFraction,containsSpriteEdgeInk};
