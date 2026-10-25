const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {setImmediate:flush}=require('node:timers/promises');
const {createQuotaLabelWindow}=require('../lib/quota-label-window'),{createApiUsageLabelWindow}=require('../lib/api-usage-label-window'),{createWorkBuddyLabelWindow}=require('../lib/workbuddy-label-window');
function fixture(source){
 const windows=[];const pet={bounds:{x:500,y:300,width:80,height:80},isDestroyed:()=>false,isVisible:()=>true,getBounds(){return {...this.bounds}}};
 class Window extends EventEmitter{
  constructor(options){super();this.bounds={x:0,y:0,width:options.width,height:options.height};this.visible=false;this.dead=false;this.messages=[];this.showCount=0;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{routingId:1,processId:1},isDestroyed:()=>false,isLoading:()=>false,getURL:()=>this.url,setWindowOpenHandler(){},send:(...args)=>this.messages.push(args),executeJavaScript:async()=>true,capturePage:async()=>({toPNG:()=>Buffer.from('fixture-png'),isEmpty:()=>false})});windows.push(this);}
  loadFile(file){this.url=pathToFileURL(path.resolve(file)).href;return Promise.resolve();}isDestroyed(){return this.dead;}isVisible(){return this.visible;}getBounds(){return {...this.bounds}}setBounds(value){this.bounds={...value}}showInactive(){this.visible=true;this.showCount++}hide(){this.visible=false}destroy(){this.dead=true;this.emit('closed')}setIgnoreMouseEvents(value){this.ignored=value}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}setHiddenInMissionControl(){}
 }
 const presentation={mode:'free'};
 const options={BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1440,height:900}})},getPetWindow:()=>pet,getPresentation:()=>presentation,getSize:()=> 'compact',getGuardEntry:()=>true};
 const controller=source==='codex'?createQuotaLabelWindow(options):source==='api'?createApiUsageLabelWindow(options):createWorkBuddyLabelWindow(options);
 const state=source==='codex'?{state:'ready',items:[{label:'5小时',remaining:80,windowMinutes:300}]}:source==='api'?{connected:true,report:{month:'2026-10',costs:{month:[{currency:'USD',value:1}],today:[]},usage:{inputTokens:1,outputTokens:1,requests:1}}}:{enabled:true,report:{total:100,basic:100,reward:0,purchased:0}};
 return {controller,state,windows,pet,presentation};
}
for(const source of ['codex','api','workbuddy'])test(`${source}: hold freezes, stage paints hidden, masked freezes, resume and safety hide`,async()=>{
 const f=fixture(source),c=f.controller;c.show(f.state);await flush();const w=c.getWindow();assert(w.isVisible());const before=w.getBounds(),messages=w.messages.length;
 c.setGroupTransitionMode('hold');f.pet.bounds.x+=200;c.show(f.state);c.reposition();assert.deepEqual(w.getBounds(),before);assert.equal(w.messages.length,messages);assert.equal(w.ignored,true);assert(w.isVisible());
 const held=await c.captureGroupTransitionFrames();assert.equal(held.length,source==='workbuddy'?2:1);assert.deepEqual(held[0].bounds,before);assert(Buffer.isBuffer(held[0].png));
 c.setGroupTransitionMode('stage');assert(!w.isVisible());assert.notDeepEqual(w.getBounds(),before);assert(w.messages.length>messages);assert(c.getVisibleBounds(),'stage keeps logical obstacle bounds');const count=w.showCount;c.show(f.state);assert.equal(w.showCount,count,'stage cannot flash a native host');
 const staged=await c.captureGroupTransitionFrames();assert.equal(staged.length,source==='workbuddy'?2:1);assert(f.windows.every(win=>!win.isVisible()),'WB guard is staged hidden too');
 c.setGroupTransitionMode('masked');const masked=w.getBounds();f.pet.bounds.x+=100;c.reposition();assert.deepEqual(w.getBounds(),masked);assert(!w.isVisible());
 c.setGroupTransitionMode(null);assert(w.isVisible());c.setGroupTransitionMode('hold');c.hide();assert(f.windows.every(win=>!win.isVisible()),'safety hide bypasses hold including guard');c.destroy();
});
for(const source of ['codex','api','workbuddy'])test(`${source}: stale capture rejects after safety hide or native bounds mutation`,async()=>{
 const f=fixture(source),c=f.controller;c.show(f.state);await flush();c.setGroupTransitionMode('hold');const w=c.getWindow();let resolve;w.webContents.capturePage=()=>new Promise(done=>resolve=done);
 const pending=c.captureGroupTransitionFrames();await flush();c.hide();resolve({toPNG:()=>Buffer.from('old-png')});await assert.rejects(pending,/stale/);c.destroy();
});
const {captureQuotaGroupFrames}=require('../lib/quota-group-capture');
test('capture helper refuses bounds/page changes between paint and capture',async()=>{
 const f=fixture('api');f.controller.show(f.state);await flush();const w=f.controller.getWindow();w.webContents.executeJavaScript=async()=>{w.bounds.x++;return true;};await assert.rejects(captureQuotaGroupFrames({getTargets:()=>[w],isReady:()=>true,isCurrent:()=>true}),/stale/);f.controller.destroy();
});
test('WB multi-host capture rejects a guard move while the card frame is being captured',async()=>{
 const f=fixture('workbuddy');f.controller.show(f.state);await flush();f.controller.setGroupTransitionMode('hold');const w=f.controller.getWindow(),guard=f.controller.getGuardWindow();w.webContents.capturePage=async()=>{guard.bounds.x++;return {toPNG:()=>Buffer.from('stale')};};await assert.rejects(f.controller.captureGroupTransitionFrames(),/stale/);f.controller.destroy();
});
test('capture temporarily disables hidden-page throttling and restores it after success and rejection',async()=>{
 for(const fails of [false,true]){
  const f=fixture('api');f.controller.show(f.state);await flush();const wc=f.controller.getWindow().webContents;let throttled=true;const calls=[];
  wc.getLastWebPreferences=()=>({backgroundThrottling:throttled});wc.setBackgroundThrottling=value=>{throttled=value;calls.push(value)};
  wc.executeJavaScript=async()=>{assert.equal(throttled,false);if(fails)throw Error('paint failed');return true};
  if(fails)await assert.rejects(f.controller.captureGroupTransitionFrames(),/paint failed/);else await f.controller.captureGroupTransitionFrames();
  assert.deepEqual(calls,[false,true]);assert.equal(throttled,true);f.controller.destroy();
 }
});

for(const source of ['codex','api','workbuddy'])test(`${source}: hidden stage layout cannot resurrect an old frame, hold exit remains capturable`,async()=>{
 const f=fixture(source),c=f.controller;c.show(f.state);await flush();c.setGroupTransitionMode('hold');f.presentation.quotaGroupHidden=true;
 assert((await c.captureGroupTransitionFrames()).length>0,'hidden group flag is normal during exit hold');
 c.setGroupTransitionMode('stage');c.reposition();await assert.rejects(c.captureGroupTransitionFrames(),/stage has no visible layout/);c.destroy();
});
