const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createSheepOfferingWindow,placement,normalizeState,handleHit,SIZE,HANDLE,INSET,APPEAR_MIN,APPEAR_MAX,STAY_MIN,STAY_MAX}=require('../lib/sheep-offering-window');
const state=(theme='halloween',facing='left')=>({eligible:true,theme,facing,ink:{x:.12,y:.04,width:.76,height:.91}});
function fixture({random=()=>0}={}){const events=[],created=[];let petBounds={x:450,y:300,width:120,height:120},visible=true,suppressed=false,theme='halloween',cursor={x:1,y:1},clock=0,serial=0;const timers=new Map();
 const advance=ms=>{const end=clock+ms;for(;;){const next=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();}clock=end;};
 class Window extends EventEmitter {constructor(options){super();this.options=options;this.bounds={x:0,y:0,width:44,height:44};this.visible=false;this.dead=false;this.webContents=new EventEmitter();this.webContents.send=(...v)=>events.push(['view',...v]);this.webContents.setWindowOpenHandler=()=>{};created.push(this);}loadFile(){return Promise.resolve();}setAlwaysOnTop(v){this.top=v;}setVisibleOnAllWorkspaces(){}setHiddenInMissionControl(){}setIgnoreMouseEvents(v){this.ignored=v;}setBounds(b){this.bounds={...b};}getBounds(){return {...this.bounds};}showInactive(){this.visible=true;}hide(){this.visible=false;}isVisible(){return this.visible;}isDestroyed(){return this.dead;}destroy(){this.dead=true;this.emit('closed');}}
 const pet={getBounds:()=>({...petBounds}),isDestroyed:()=>false,isVisible:()=>visible};
 const c=createSheepOfferingWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1400,height:1000}}),getCursorScreenPoint:()=>cursor},getPetWindow:()=>pet,getTheme:()=>theme,getSuppressed:()=>suppressed,onPointer:v=>events.push(['pointer',v]),random,now:()=>clock,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},clearTimer:id=>timers.delete(id)});
 const ready=()=>{c.update(state(theme));while(!c.getWindow())advance(APPEAR_MIN);c.getWindow().webContents.emit('did-finish-load');return c.getWindow();};
 return{c,events,created,pet,ready,advance,timers,setTheme:v=>theme=v,setSuppressed:v=>suppressed=v,setVisible:v=>visible=v,setPet:b=>petBounds=b,setCursor:p=>cursor=p};}

test('12两主题/方向/80、120、260入口在完整ink前方10px，独立窗口不改宿主尺寸位置',()=>{
 const area={x:0,y:0,width:1400,height:1000};for(const theme of['halloween','christmas'])for(const side of['left','right'])for(const size of[80,120,260]){
  const pet={x:450,y:300,width:size,height:size},before={...pet},s=state(theme,side),p=placement(pet,area,s),button={x:p.bounds.x+INSET,width:HANDLE};
  const gap=side==='left'?p.ink.x-button.x-button.width:button.x-p.ink.x-p.ink.width;
  assert.ok(gap>=9.5&&gap<=10.5);assert.equal(p.bounds.width,SIZE);assert.ok(p.bounds.x>=0&&p.bounds.x+SIZE<=area.width);assert.deepEqual(pet,before);
 }
 assert.equal(placement({x:0,y:0,width:80,height:80},area,state()),null,'no cramped-edge clamp over the body');
});
test('state只接受有限归一轮廓与当前主题，透明圆角/空白不截获桌面点击',()=>{
 for(const bad of[null,{},state('none'),{...state(),ink:{x:0,y:0,width:Infinity,height:.8}},{...state(),ink:{x:.9,y:0,width:.5,height:.8}},{...state(),facing:'rear'}])assert.equal(normalizeState(bad),null);
 assert.ok(normalizeState(state()));assert.equal(handleHit(22,22),true);for(const p of[[0,0],[5,22],[6,6],[43,43],[NaN,22]])assert.equal(handleHit(...p),false);
 const h=fixture(),w=h.ready();assert.equal(w.options.focusable,false);assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.ignored,true);
 h.c.handle({sender:w.webContents},{type:'hit',x:22,y:22});assert.equal(w.ignored,false);h.c.handle({sender:w.webContents},{type:'hit',x:1,y:1});assert.equal(w.ignored,true);h.c.destroy();
});
test('独立源窗真实生命周期与拖放协议：不发宿主移动，命中立即隐藏、未命中复位，拒绝伪造sender/坐标',()=>{
 const h=fixture(),w=h.ready(),event={sender:w.webContents},origin=w.getBounds(),petBefore=h.pet.getBounds();
 assert.equal(h.c.handle({sender:{}},{type:'begin',x:22,y:22}),false);assert.equal(h.c.handle(event,{type:'begin',x:NaN,y:22}),false);assert.deepEqual(w.getBounds(),origin);
 h.c.handle(event,{type:'begin',x:22,y:22});const target={x:petBefore.x+60,y:petBefore.y+65};h.c.handle(event,{type:'move',x:target.x-w.bounds.x,y:target.y-w.bounds.y});
 h.c.update({...state(),dragging:true});assert.notDeepEqual(w.getBounds(),origin,'state updates do not snap a captured source back');
 h.c.handle(event,{type:'end',x:22,y:22});assert.equal(w.isVisible(),false);assert.deepEqual(h.events.filter(r=>r[0]==='pointer').at(-1)[1],{type:'drop',kind:'candy',accepted:true});assert.deepEqual(h.pet.getBounds(),petBefore);
 h.c.update({...state(),playing:true});assert.equal(w.visible,false);h.c.update(state());assert.equal(w.visible,false);h.advance(APPEAR_MIN);assert.equal(w.visible,true);
 h.c.handle(event,{type:'begin',x:22,y:22});h.c.handle(event,{type:'end',x:-100,y:-100});assert.equal(h.events.filter(r=>r[0]==='pointer').at(-1)[1].accepted,false);assert.deepEqual(w.getBounds(),origin);
 h.c.destroy();assert.ok(h.events.some(v=>v[0]==='view'&&v[2]?.reset===true),'hidden source resets its pointer capture');assert.ok(w.isDestroyed());
});
test('失效状态/隐藏/屏幕限制取消拖动，主题和置顶变更不残留旧源',()=>{
 for(const reason of['busy','hidden','suppressed','theme','destroy']){const h=fixture(),w=h.ready();h.c.handle({sender:w.webContents},{type:'begin',x:22,y:22});if(reason==='busy')h.c.update({...state(),eligible:false});if(reason==='hidden'){h.setVisible(false);h.c.reposition();}if(reason==='suppressed'){h.setSuppressed(true);h.c.reposition();}if(reason==='theme'){h.setTheme('christmas');h.c.reposition();}if(reason==='destroy')h.c.destroy();assert.equal(w.visible,false);assert.ok(h.events.some(r=>r[0]==='pointer'&&r[1].type==='cancel'));h.c.destroy();}
 const h=fixture(),w=h.ready();h.c.setAlwaysOnTop(false);assert.equal(w.top,false);h.setPet({x:510,y:360,width:260,height:260});h.c.reposition();assert.notEqual(w.bounds.x,0);h.c.destroy();
});

test('轻点送物直接接收，画面礼物出现时只隐藏重复入口并可恢复',()=>{
 const h=fixture(),w=h.ready(),event={sender:w.webContents};
 h.c.handle(event,{type:'begin',x:22,y:22});h.c.handle(event,{type:'end',x:23,y:22});
 assert.deepEqual(h.events.filter(r=>r[0]==='pointer').at(-1)[1],{type:'drop',kind:'candy',accepted:true});
 h.c.update({...state(),hideSource:true});assert.equal(w.visible,false);
 assert.equal(normalizeState({...state(),hideSource:true}).eligible,true);
 assert.equal(h.c.handle(event,{type:'activate'}),false);
 h.c.update(state());assert.equal(w.visible,false);h.advance(APPEAR_MIN);assert.equal(w.visible,true);h.c.destroy();
});

test('真实cursor进入把手后轮询启用鼠标、离开透明圆角后穿透且拖动不被轮询打断',async()=>{const h=fixture(),w=h.ready(),b=w.getBounds();h.setCursor({x:b.x+22,y:b.y+22});await new Promise(r=>setTimeout(r,95));assert.equal(w.ignored,false);h.c.handle({sender:w.webContents},{type:'begin',x:22,y:22});h.setCursor({x:1,y:1});await new Promise(r=>setTimeout(r,95));assert.equal(w.ignored,false,'capture remains active outside source');h.c.handle({sender:w.webContents},{type:'cancel'});await new Promise(r=>setTimeout(r,95));assert.equal(w.ignored,true);h.c.destroy();});

test('节日随机首次出现2/5分钟与停留5/10分钟边界精确，超时后重新随机排期',()=>{
 assert.equal(APPEAR_MIN,120000);assert.equal(APPEAR_MAX,300000);assert.equal(STAY_MIN,300000);assert.equal(STAY_MAX,600000);
 for(const [random,appear,stay] of [[()=>0,APPEAR_MIN,STAY_MIN],[()=>1,APPEAR_MAX,STAY_MAX]]){
  const h=fixture({random});h.c.update(state());assert.equal(h.c.getWindow(),null);
  h.advance(appear-1);assert.equal(h.c.getWindow(),null);h.advance(1);
  const w=h.c.getWindow();w.webContents.emit('did-finish-load');assert.equal(w.visible,true);
  h.advance(stay-1);assert.equal(w.visible,true);h.advance(1);assert.equal(w.visible,false);
  h.advance(appear-1);assert.equal(w.visible,false);h.advance(1);assert.equal(w.visible,true);h.c.destroy();assert.equal(h.timers.size,0);
 }
});

test('尺寸/方向和重复state不重抽排期与停留；开始拖动跨超时仍可结束，取消过期源则排下一次',()=>{
 let draws=0;const h=fixture({random:()=>{draws++;return 0;}});h.c.update(state());
 h.advance(APPEAR_MIN-1);h.setPet({x:500,y:300,width:260,height:260});h.c.update(state('halloween','right'));h.c.reposition();assert.equal(draws,1);
 h.advance(1);const w=h.c.getWindow();w.webContents.emit('did-finish-load');assert.equal(w.visible,true);assert.equal(draws,2);
 h.advance(STAY_MIN-1);h.c.update(state('halloween','left'));h.c.reposition();assert.equal(draws,2);
 const event={sender:w.webContents};h.c.handle(event,{type:'begin',x:22,y:22});h.advance(2*STAY_MAX);
 assert.equal(w.visible,true);assert.equal(draws,2);h.c.update({...state(),dragging:true});assert.equal(w.visible,true);
 h.c.handle(event,{type:'cancel'});assert.equal(w.visible,false);assert.equal(draws,3);
 h.advance(APPEAR_MIN);assert.equal(w.visible,true);h.c.handle(event,{type:'begin',x:22,y:22});h.advance(STAY_MAX*2);
 h.c.handle(event,{type:'end',x:22,y:22});assert.equal(w.visible,false);assert.equal(h.events.filter(v=>v[0]==='pointer').at(-1)[1].accepted,true);
 h.c.destroy();
});

test('消费立即隐藏且不能重放隐藏入口；菜单playing状态不依赖入口出现并在完成后重新排期',()=>{
 const h=fixture(),w=h.ready(),event={sender:w.webContents};h.advance(123);
 assert.equal(h.c.handle(event,{type:'activate'}),true);assert.equal(w.visible,false);
 assert.equal(h.c.handle(event,{type:'activate'}),false);h.c.update(state());assert.equal(w.visible,false);
 h.advance(APPEAR_MIN-1);assert.equal(w.visible,false);h.advance(1);assert.equal(w.visible,true);
 h.c.hide();h.c.update({...state(),playing:true});h.advance(APPEAR_MAX*2);assert.equal(w.visible,false);
 h.c.update(state());h.advance(APPEAR_MIN-1);assert.equal(w.visible,false);h.advance(1);assert.equal(w.visible,true);h.c.destroy();
});

test('睡眠/工作等失效、隐藏、暂停、主题、关闭与hideSource均丢弃旧排期，恢复后完整等待',()=>{
 for(const reason of ['ineligible','playing','hidden','suppressed','theme','hide','hideSource']){
  const h=fixture();h.c.update(state());h.advance(APPEAR_MIN-1);
  if(reason==='ineligible')h.c.update({...state(),eligible:false});
  if(reason==='playing')h.c.update({...state(),playing:true});
  if(reason==='hideSource')h.c.update({...state(),hideSource:true});
  if(reason==='hidden'){h.setVisible(false);h.c.reposition();}
  if(reason==='suppressed'){h.setSuppressed(true);h.c.reposition();}
  if(reason==='theme'){h.setTheme('christmas');h.c.update(state('christmas'));}
  if(reason==='hide')h.c.hide();
  h.advance(1);assert.equal(h.c.getWindow()?.visible||false,false,reason);
  h.setVisible(true);h.setSuppressed(false);h.c.update(state(reason==='theme'?'christmas':'halloween'));
  h.advance(APPEAR_MIN-2);assert.equal(h.c.getWindow()?.visible||false,false,reason+' does not inherit old deadline');
  h.advance(2);const w=h.c.getWindow();w.webContents.emit('did-finish-load');assert.equal(w.visible,true,reason);h.c.destroy();
 }
});

test('45–75秒短动作只暂藏：等待deadline与出现后寿命都不重抽，硬暂停重排',()=>{
 for(const interval of[45000,60000,75000]){
  const h=fixture();h.c.update(state());
  for(let n=0;n<7;n++){
   h.advance(interval);h.c.update({...state(),eligible:false,transient:true,ink:null});
   assert.equal(h.c.getWindow()?.visible||false,false,'动作中入口隐藏');
   h.advance(4000);h.c.update(state());
   const w=h.c.getWindow();if(w)w.webContents.emit('did-finish-load');
   if(n===2)assert.equal(w?.visible,true,'多轮短动作不饿死随机出现');
  }
  h.c.destroy();
 }
 const h=fixture();h.c.update(state());h.advance(APPEAR_MIN-1000);
 h.c.update({...state(),eligible:false,transient:true,ink:null});h.advance(2000);
 assert.equal(h.c.getWindow(),null,'deadline落在动作中不可弹出');
 h.c.update(state());const w=h.c.getWindow();w.webContents.emit('did-finish-load');assert.equal(w.visible,true);
 h.advance(STAY_MIN-2000);h.c.update({...state(),eligible:false,transient:true});h.advance(1000);h.c.update(state());
 assert.equal(w.visible,false,'短动作不得延长原机会寿命');
 h.advance(APPEAR_MIN);assert.equal(w.visible,true);
 h.c.update({...state(),eligible:false});h.advance(APPEAR_MIN);h.c.update(state());h.advance(APPEAR_MIN-1);assert.equal(w.visible,false,'硬暂停从恢复重新排期');h.advance(1);assert.equal(w.visible,true);h.c.destroy();
});
