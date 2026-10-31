const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeSpriteEdgeInk,containsSpriteEdgeInk}=require('../lib/sprite-edge-ink');
test('sprite edge masks reject malformed or oversized hit geometry',()=>{
 for(const packet of [null,{}, {id:'a',columns:65,rows:Array(64).fill('f'.repeat(16))},{id:'a',columns:64,rows:Array(63).fill('f'.repeat(16))},{id:'a',columns:64,rows:Array(64).fill('z'.repeat(16))}])assert.equal(normalizeSpriteEdgeInk(packet),null);
});
test('mapped edge hit testing follows smaller translated mirrored alpha rather than the native half-window',()=>{
 const rows=Array.from({length:64},(_,y)=>y>=8&&y<56?'0000ffffffff0000':'0000000000000000');
 const mask=normalizeSpriteEdgeInk({id:'pet',columns:64,rows}),bounds={x:100,y:200,width:260,height:260};
 const hit=(side,x,y,mode='tucked')=>containsSpriteEdgeInk(mask,{bounds,side,mode,point:{x:bounds.x+x,y:bounds.y+y}});
 assert.equal(hit('left',10,130),true);assert.equal(hit('left',100,130),false,'old visible-half transparent area must not trigger');assert.equal(hit('left',10,5),false,'transparent top margin must not trigger');
 assert.equal(hit('right',250,130),true);assert.equal(hit('right',160,130),false);assert.equal(hit('right',250,5),false);
 assert.equal(hit('left',130,130,'peeked'),true);assert.equal(hit('right',130,130,'peeked'),true);assert.equal(hit('left',5,130,'peeked'),true,'retain the original opaque hover anchor after revealing');assert.equal(hit('left',50,130,'peeked'),false);
});


test('小白多露15个百分点只由显式几何参数启用，其他映射皮肤保持原命中', () => {
  const { TUCK_FRACTION, XIAOBAI_TUCK_FRACTION } = require('../lib/sprite-edge-ink');
  assert.equal(TUCK_FRACTION, .672);
  const mask = normalizeSpriteEdgeInk({ id: 'skin', columns: 64, rows: Array(64).fill('f'.repeat(16)) });
  const bounds = { x: 0, y: 0, width: 120, height: 120 };
  for (const side of ['left', 'right']) {
    const count = tuckFraction => Array.from({ length: 12000 }, (_, i) =>
      containsSpriteEdgeInk(mask, { bounds, side, point: { x: i / 100, y: 60 }, ...(tuckFraction ? { tuckFraction } : {}) })).filter(Boolean).length / 100;
    const extra = count(XIAOBAI_TUCK_FRACTION) - count();
    assert(Math.abs(extra - 120 * 192 / 208 * .15) < .02);
  }
});
