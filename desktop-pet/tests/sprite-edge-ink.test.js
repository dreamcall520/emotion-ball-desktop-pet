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


test('half tuck uses the opaque horizontal centre and matches inward mirrored hit geometry', () => {
  const { spriteHalfTuckFraction } = require('../lib/sprite-edge-ink');
  const bounds = { x: 0, y: 0, width: 120, height: 120 };
  // Deliberately off-centre artwork; half of its 48-column span must remain visible.
  const mask = normalizeSpriteEdgeInk({ id: 'directional', columns: 64,
    rows: Array(64).fill('00ffffffffffff00') });
  for (const idleFacing of ['left', 'right']) {
    const tuckFraction = spriteHalfTuckFraction(mask, idleFacing);
    for (const side of ['left', 'right']) {
      const hit = x => containsSpriteEdgeInk(mask, { bounds, side, idleFacing, tuckFraction, point: { x, y: 60 } });
      const visible = Array.from({ length: 12000 }, (_, i) => hit(i / 100)).filter(Boolean).length / 100;
      assert(Math.abs(visible - 120 * 192 / 208 * 48 / 64 / 2) < .02);
    }
  }
  const asymmetric = normalizeSpriteEdgeInk({ id: 'directional', columns: 64,
    rows: Array(64).fill('0000ffffffffffff') });
  assert(spriteHalfTuckFraction(asymmetric, 'left') < .5);
  assert(spriteHalfTuckFraction(asymmetric, 'right') > .5);
  for (const idleFacing of ['left', 'right']) for (const side of ['left', 'right']) {
    const tuckFraction = spriteHalfTuckFraction(asymmetric, idleFacing);
    const visible = Array.from({ length: 12000 }, (_, i) => containsSpriteEdgeInk(asymmetric,
      { bounds, side, idleFacing, tuckFraction, point: { x: i / 100, y: 60 } })).filter(Boolean).length / 100;
    assert(Math.abs(visible - 120 * 192 / 208 * 48 / 64 / 2) < .02);
  }
  assert.equal(spriteHalfTuckFraction(null, 'left'), .5);
});


test('wide action sheets use the fitted image dimensions for half tuck and alpha hit testing', () => {
  const { spriteHalfTuckFraction } = require('../lib/sprite-edge-ink');
  for (const aspect of [192 / 208, 300 / 208, 320 / 208]) {
    const mask = normalizeSpriteEdgeInk({ id: 'wide-sleep', columns: 64, aspect,
      rows: Array(64).fill('0000ffffffffffff') });
    assert.equal(mask?.aspect, aspect);
    for (const bounds of [{ x: 0, y: 0, width: 80, height: 80 },
      { x: 0, y: 0, width: 120, height: 120 }, { x: 0, y: 0, width: 260, height: 260 },
      { x: 0, y: 0, width: 240, height: 120 }]) {
      const paintedWidth = Math.min(Math.min(bounds.width, bounds.height) * aspect, bounds.width);
      for (const idleFacing of ['left', 'right']) for (const side of ['left', 'right']) {
        const tuckFraction = spriteHalfTuckFraction(mask, idleFacing, bounds);
        const visible = Array.from({ length: bounds.width * 100 }, (_, i) => containsSpriteEdgeInk(mask,
          { bounds, side, idleFacing, tuckFraction, point: { x: i / 100, y: bounds.height / 2 } })).filter(Boolean).length / 100;
        assert(Math.abs(visible - paintedWidth * 48 / 64 / 2) < .02);
        if (paintedWidth / aspect < bounds.height - 2) assert.equal(containsSpriteEdgeInk(mask, { bounds, side, idleFacing,
          tuckFraction, point: { x: side === 'left' ? 1 : bounds.width - 1, y: 1 } }), false,
          'letterboxed transparent top stays transparent');
      }
    }
  }
  for (const aspect of [null, '1', NaN, Infinity, .5, 2]) {
    assert.equal(normalizeSpriteEdgeInk({ id: 'invalid', columns: 64, aspect,
      rows: Array(64).fill('f'.repeat(16)) }), null);
  }
});


test('declared peeked sprites hit only current alpha while legacy skins keep their old hover union', () => {
  const mask = normalizeSpriteEdgeInk({ id: 'peek', columns: 64,
    rows: Array(64).fill('0000ffffffff0000') });
  const bounds = { x: 0, y: 0, width: 120, height: 120 };
  for (const side of ['left', 'right']) {
    const anchor = { x: side === 'left' ? 5 : 115, y: 60 };
    const geometry = { bounds, side, point: anchor, tuckFraction: .5 };
    assert.equal(containsSpriteEdgeInk(mask, { ...geometry, idleFacing: 'left' }), true);
    assert.equal(containsSpriteEdgeInk(mask, { ...geometry, mode: 'peeked', idleFacing: 'left' }), false,
      'the former hover anchor is transparent after the sprite reveals');
    assert.equal(containsSpriteEdgeInk(mask, { ...geometry, mode: 'peeked' }), true,
      'a skin without declarations retains its existing union');
    assert.equal(containsSpriteEdgeInk(mask, { ...geometry, mode: 'peeked', idleFacing: 'left',
      point: { x: 60, y: 60 } }), true);
  }
});
