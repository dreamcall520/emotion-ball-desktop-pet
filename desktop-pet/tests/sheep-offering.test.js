const test = require('node:test');
const assert = require('node:assert/strict');
const Offering = require('../lib/sheep-offering');
function fixture(theme = 'halloween', size = 180) {
  let now = 0, sequence = 0, accepted = true, interactions = 0, approaches = 0;
  const timers = new Map(), calls = [], nodes = [];
  class Node {
    constructor() { this.events = new Map(); this.dataset = {}; this.hidden = false; this.attrs = {}; this.styles = new Map(); this.classes = new Set();
      this.style = { setProperty: (k,v) => this.styles.set(k,v), removeProperty: k => this.styles.delete(k) };
      this.classList = { add: k => this.classes.add(k), remove: k => this.classes.delete(k) };
    }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type,new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    emit(type, values = {}) { const e = { button:0,isPrimary:true,pointerId:7,clientX:13,clientY:130,detail:1,stopped:false,prevented:false,
      stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;},...values }; for(const fn of this.events.get(type)||[]) fn(e); return e; }
    appendChild(child) { nodes.push(child); }
    setAttribute(k,v) { this.attrs[k]=v; }
    getAttribute(k) { return k === 'src' ? this.src : this.attrs[k]; }
    setPointerCapture(id) { this.capture=id; }
    hasPointerCapture(id) { return this.capture===id; }
    releasePointerCapture(id) { if(this.capture===id) { this.capture=null; this.emit('lostpointercapture',{pointerId:id}); } }
    getBoundingClientRect() { return {left:(this.dataset.side==='right'?view.innerWidth-30:6)+parseFloat(this.styles.get('--offering-x')||0),top:view.innerHeight-30+parseFloat(this.styles.get('--offering-y')||0),width:24,height:24}; }
    remove() { this.removed=true; }
  }
  const view = new Node(); view.innerWidth=view.innerHeight=size;
  view.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{at:now+ms,fn});return id;};view.clearTimeout=id=>timers.delete(id);
  const doc=new Node();doc.defaultView=view;doc.body=new Node();doc.createElement=()=>new Node();doc.hidden=false;
  const target=new Node();target.ownerDocument=doc;target.dataset.facing='left';target.getBoundingClientRect=()=>({left:0,top:0,width:size,height:size});
  const state={theme,eligible:true};
  const controller=Offering.create({target,getState:()=>({...state,eligible:state.eligible&&!doc.hidden}),onReceive:kind=>{calls.push(['receive',kind]);return accepted;},onCancel:()=>calls.push(['cancel']),onInteract:()=>{interactions++;},onApproach:()=>{approaches++;}});
  const button=nodes.at(-1);
  return {controller,button,target,view,doc,state,timers,calls,interactions:()=>interactions,approaches:()=>approaches,setAccepted:v=>{accepted=v;},
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now&&timers.has(id)){timers.delete(id);t.fn();}}};
}
test('近身拖糖命中后立即移除源道具，使用同一接收入口且事件不冒泡到宿主拖动',()=>{
  const h=fixture();assert.equal(h.button.hidden,false);
  const e=h.button.emit('pointerdown');assert.ok(e.stopped&&e.prevented);assert.ok(h.controller.isDragging());
  h.button.emit('pointermove',{clientX:90,clientY:90});assert.equal(h.button.styles.get('--offering-x'),'77px');
  h.button.emit('pointerup',{clientX:90,clientY:90});assert.deepEqual(h.calls,[['receive','candy']]);
  assert.equal(h.button.hidden,true);assert.equal(h.button.dataset.receiving,'candy');assert.equal(h.controller.isPlaying(),true);assert.equal(h.controller.isDragging(),false);
  h.controller.update();assert.equal(h.button.hidden,true,'接收过程中活动采样不能显露旧糖');
  h.controller.cancel(false);h.controller.update();assert.equal(h.button.hidden,false);assert.equal(h.button.styles.size,0);h.controller.destroy();
});

test('糖果和礼物跟随真实朝向放在面前，多尺寸保持近身、视口内且不占中央身体区',()=>{
  for(const theme of ['halloween','christmas']) for(const size of [60,80,108,120,180,240]) for(const side of ['left','right']) {
    const h=fixture(theme,size);h.target.dataset.facing=side;h.controller.update();
    assert.equal(h.button.dataset.side,side);assert.equal(h.button.hidden,size<108);
    const r=h.button.getBoundingClientRect();assert.ok(r.left>=0&&r.top>=0&&r.left+r.width<=size&&r.top+r.height<=size);
    if(size>=108) {
      assert.ok(side==='left'?r.left+r.width<size/2:r.left>size/2,'front lower corner leaves central body clear');
      assert.equal(side==='left'?r.left:size-r.left-r.width,6,'safe front-edge inset avoids native rounded corner');
    }
    h.controller.destroy();
  }
});

test('拖动中保持入口锚点，朝向更新不让道具跳边，拖出视口会钳在边缘',()=>{
  for(const theme of ['halloween','christmas']) for(const side of ['left','right']) {
    const h=fixture(theme,108);h.target.dataset.facing=side;h.controller.update();
    h.button.emit('pointerdown');h.target.dataset.facing=side==='left'?'right':'left';h.controller.update();
    assert.equal(h.button.dataset.side,side,'facing changes cannot move a captured source anchor');
    for(const [x,y] of [[-1000,-1000],[1000,1000]]) {
      h.button.emit('pointermove',{clientX:x,clientY:y});const r=h.button.getBoundingClientRect();
      assert.ok(r.left>=0&&r.top>=0&&r.left+r.width<=108&&r.top+r.height<=108);
    }
    h.button.emit('pointercancel');assert.equal(h.button.dataset.side,h.target.dataset.facing);assert.equal(h.button.styles.size,0);h.controller.destroy();
  }
});
test('拖放未命中、取消和丢失捕获不发送；复位不残影，原生按钮支持Enter/Space辅助激活',()=>{
  const h=fixture('christmas');h.button.emit('pointerdown');h.button.emit('pointerup');assert.equal(h.calls.length,0);assert.equal(h.button.styles.size,0);
  for(const event of ['pointercancel','lostpointercapture']) {h.button.emit('pointerdown');h.button.emit(event);assert.equal(h.controller.isDragging(),false);}
  h.button.emit('click',{detail:1});assert.equal(h.calls.length,0,'指针click不能绕过目标判定');
  h.button.emit('click',{detail:0});assert.deepEqual(h.calls,[['receive','gift']]);h.controller.destroy();
});
test('忙碌/睡眠/隐藏/锁屏等统一eligible限制、主题更换、失焦与销毁撤销接收和计时',()=>{
  for(const reason of ['blocked','theme','blur','hidden','destroy']) {
    const h=fixture();assert.equal(h.controller.offer('gift'),false);h.controller.offer('candy');
    if(reason==='blocked'){h.state.eligible=false;h.controller.update();}
    else if(reason==='theme'){h.state.theme='christmas';h.controller.update();}
    else if(reason==='blur')h.view.emit('blur');
    else if(reason==='hidden'){h.doc.hidden=true;h.doc.emit('visibilitychange');}
    else h.controller.destroy();
    assert.equal(h.controller.isPlaying(),false,reason);assert.equal(h.calls.filter(c=>c[0]==='cancel').length,1,reason);
    h.controller.destroy();assert.equal(h.timers.size,0);assert.ok(h.button.removed);
  }
});
test('2700ms仅一次静态小箭头，不在工作状态计时；60/80尺寸只留菜单同接收入口',()=>{
  const h=fixture();h.advance(2699);assert.equal(h.button.dataset.hint,undefined);h.advance(1);assert.equal(h.button.dataset.hint,'true');h.advance(1800);assert.equal(h.button.dataset.hint,undefined);
  h.controller.update();assert.equal(h.timers.size,0);h.state.eligible=false;h.controller.update();h.advance(10000);assert.equal(h.button.dataset.hint,undefined);h.controller.destroy();
  for(const size of [60,80]){const x=fixture('christmas',size);assert.equal(x.button.hidden,true);assert.equal(x.timers.size,0);assert.equal(x.controller.offer('gift'),true);assert.deepEqual(x.calls,[['receive','gift']]);x.controller.destroy();}
});
test('拒收与其它主题不进入播放；椭圆拒绝透明角落和非法坐标',()=>{
  const h=fixture();h.setAccepted(false);assert.equal(h.controller.offer(),false);assert.equal(h.button.hidden,false);assert.equal(h.controller.isPlaying(),false);
  h.state.theme='none';h.controller.update();assert.equal(h.button.hidden,true);assert.equal(h.controller.offer('candy'),false);h.controller.destroy();
  const r={left:0,top:0,width:180,height:180};assert.equal(Offering.hitTarget({x:90,y:100},r),true);for(const point of [{x:0,y:0},{x:NaN,y:50},{x:180,y:180}])assert.equal(Offering.hitTarget(point,r),false);
});

test('只有可用道具的真实主指针按下重置互动时间，自动更新与键盘送出不伪造pointer互动',()=>{
  const h=fixture();h.controller.update();h.advance(3000);assert.equal(h.interactions(),0);
  h.button.emit('pointerdown',{button:2});h.button.emit('pointerdown',{isPrimary:false});assert.equal(h.interactions(),0);
  h.button.emit('pointerdown');assert.equal(h.interactions(),1);assert.equal(h.controller.isDragging(),true);
  h.button.emit('pointermove',{clientX:30,clientY:40});h.button.emit('pointerdown');assert.equal(h.interactions(),1);
  h.button.emit('pointercancel');h.state.eligible=false;h.button.emit('pointerdown');assert.equal(h.interactions(),1);
  h.state.eligible=true;h.button.emit('click',{detail:0});assert.equal(h.interactions(),1);assert.equal(h.controller.isPlaying(),true);h.controller.destroy();
});


test('鼠标从羊身经过到道具并停留时阻止延迟问好，普通远处经过仍可问候',()=>{
 for(const theme of ['halloween','christmas'])for(const side of ['left','right']){
  const h=fixture(theme,180);h.target.dataset.facing=side;h.controller.update();
  h.view.emit('pointermove',{clientX:90,clientY:50});assert.equal(h.approaches(),0);
  const r=h.button.getBoundingClientRect();h.view.emit('pointermove',{clientX:r.left+r.width/2,clientY:r.top-12});
  assert.equal(h.approaches(),1);assert.ok(h.controller.blocksHover());assert.equal(h.button.hidden,false);
  h.button.emit('pointerenter',{clientX:r.left+12,clientY:r.top+12});h.advance(1200);
  assert.equal(h.button.hidden,false);assert.equal(h.calls.length,0);assert.equal(h.interactions(),0,'hover is not pointerdown or a fake human interaction clock reset');
  h.button.emit('pointerdown',{clientX:r.left+12,clientY:r.top+12});assert.ok(h.controller.isDragging());h.controller.destroy();
 }
});

test('独立窗口桥复用原接收/guard，拖动让自动动作让行，接收起步不闪回源按钮',()=>{
 for(const [theme,kind]of[['halloween','candy'],['christmas','gift']]) {
  const h=fixture(theme,80),updates=[],calls=[];h.controller.destroy();let pointer,controller;
  const external={update:v=>updates.push(v),onPointer:fn=>{pointer=fn;return()=>calls.push('unsubscribe');}};
  controller=Offering.create({target:h.target,getState:()=>h.state,external,onInteract:()=>calls.push('interact'),onApproach:()=>calls.push('approach'),onCancel:()=>calls.push('cancel'),onReceive:v=>{calls.push(v);controller.cancel(false);return true;}});
  assert.equal(h.doc.body.children,undefined,'external mode does not require a local draggable source');
  pointer({type:'approach'});assert.ok(controller.blocksHover());assert.equal(calls.filter(x=>x==='interact').length,0);
  pointer({type:'begin'});assert.ok(controller.isDragging());assert.equal(calls.filter(x=>x==='interact').length,1);
  const before=updates.length;pointer({type:'drop',kind,accepted:true});assert.ok(controller.isPlaying());assert.equal(controller.isDragging(),false);
  assert.equal(updates.length,before+1,'clearAction inside real onReceive cannot briefly republish the old source');assert.equal(updates.at(-1).playing,true);assert.ok(calls.includes(kind));
  controller.cancel(false);assert.equal(controller.isPlaying(),false);h.state.eligible=false;controller.update();assert.equal(updates.at(-1).eligible,false);
  controller.destroy();assert.equal(updates.at(-1).eligible,false);assert.ok(calls.includes('unsubscribe'));
 }
});

test('真实羊alpha轮廓映射保留地面道具，按contain和CSS缩放而非整窗作为间距基准',()=>{
 const w=8,data=new Uint8ClampedArray(w*w*4);for(let y=1;y<7;y++)for(let x=2;x<6;x++)data[(y*w+x)*4+3]=255;data[(7*w)*4+3]=255;
 let reads=0;const source={width:w,height:w,dataset:{ready:'true',theme:'christmas',facing:'right',action:'idle',frame:'0'},getContext:()=>({getImageData:()=>{reads++;return{data};}}),getBoundingClientRect:()=>({left:30,top:10,width:80,height:80})};
 const target={querySelector:()=>source,getBoundingClientRect:()=>({left:0,top:0,width:140,height:100})};
 const a=Offering.measureInk(target);assert.deepEqual(a,{x:30/140,y:.2,width:60/140,height:.7});
 Offering.measureInk(target);assert.equal(reads,1,'unchanged pixel frame is cached');source.dataset.action='greet';Offering.measureInk(target);assert.equal(reads,2,'same frame number of a new action must rescan');
});
