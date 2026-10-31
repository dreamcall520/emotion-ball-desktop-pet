const test=require('node:test'),assert=require('node:assert/strict');
const EdgePeek=require('../lib/edge-peek'),{petVisualBounds}=require('../lib/pet-visual-bounds');

test('单眼贴边只扩展经典、咩咩与小宇，不改变上传宠物等现有策略',()=>{
 for(const shape of ['blob','new-year-sheep','soft-orb']){const s=EdgePeek.specFor(shape);assert.equal(s.delayMs,900);assert(s.tucked>s.peeked);assert(Object.isFrozen(s));}
 for(const shape of ['codex-pet','cloud','aurora-cloud','square',null]){assert.equal(EdgePeek.specFor(shape),null);assert.equal(EdgePeek.containsVisibleBody(shape,{mode:'tucked',side:'left'}),null);}
});
for(const shape of ['blob','new-year-sheep','soft-orb'])for(const size of [60,80,108,120,180,260])for(const side of ['left','right']){
 test(`${shape}/${size}/${side} 可见身体帽沿命中而透明窗角不唤醒`,()=>{
  const bounds={x:-1000,y:200,width:size,height:size},direction=side==='left'?1:-1;
  const point={x:side==='left'?bounds.x+size*.04:bounds.x+size*.96,y:bounds.y+size*.5};
  assert.equal(EdgePeek.containsVisibleBody(shape,{bounds,side,mode:'tucked',point}),true);
  assert.equal(EdgePeek.containsVisibleBody(shape,{bounds,side,mode:'peeked',point}),true,'过渡期间帽沿保留');
  assert.equal(EdgePeek.containsVisibleBody(shape,{bounds,side,mode:'tucked',point:{x:point.x,y:bounds.y+size*.02}}),false);
  assert.equal(EdgePeek.containsVisibleBody(shape,{bounds,side,mode:'tucked',point:{x:side==='left'?bounds.x+size*.9:bounds.x+size*.1,y:point.y}}),false,'画布透明内部不触发');
  assert.equal(EdgePeek.containsVisibleBody(shape,{bounds,side,mode:'tucked',point:{x:bounds.x-1,y:point.y}}),false);
  const free=petVisualBounds(bounds,shape,{mode:'free',side,quotaAnchor:true,sheepTheme:'none'}),peek=petVisualBounds(bounds,shape,{mode:'peeked',side,quotaAnchor:true,sheepTheme:'none'});
  assert.equal(peek.y,free.y);assert.equal(peek.height,free.height);assert(peek.x>=bounds.x&&peek.x+peek.width<=bounds.x+bounds.width+1e-8);
  assert(direction*(peek.x+peek.width/2-free.x-free.width/2)<0,'卡片锚点跟随身体向边缘平移');
 });
}

test('贴边水平身体包络按原生像素保守取整，不引入沿行避障的小数重叠',()=>{const b={x:1360,y:400,width:80,height:80};const v=petVisualBounds(b,'blob',{side:'right',mode:'peeked'});assert.equal(v.x,1366);assert.equal(v.x+v.width,1440);assert(Number.isInteger(v.x));assert(Number.isInteger(v.width));});
