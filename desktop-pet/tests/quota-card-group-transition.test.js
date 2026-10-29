const test=require('node:test'),assert=require('node:assert/strict');
const {createQuotaCardGroupTransition,unionBounds}=require('../lib/quota-card-group-transition');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
function fixture(){
 const trace=[],settled=[],errors=[];let active=true,pending;
 const overlay={prepares:[],animations:[],warm:async()=>{},prepare:async value=>{overlay.prepares.push(value);trace.push('prepared')},show:()=>trace.push('overlay-show'),animate:value=>{pending?.reject(Error('replaced'));pending=deferred();overlay.animations.push(value);return pending.promise},hide:()=>{trace.push('overlay-hide');pending?.reject(Error('hidden'));pending=null},destroy:()=>trace.push('destroy'),finish(){const p=pending;pending=null;p.resolve()}};
 const card=(id,x=10)=>({id,controller:{modes:[],captures:0,setGroupTransitionMode(mode){this.modes.push(mode);trace.push(id+':'+mode)},async captureGroupTransitionFrames(){this.captures++;return[{bounds:{x,y:30,width:128,height:32},png}]}}});
 const cards=[card('codex'),card('api',10)];
 const controller=createQuotaCardGroupTransition({createOverlay:()=>overlay,isContextCurrent:()=>active,onSettled:value=>settled.push(value),onError:error=>errors.push(error)});
 const request=extra=>controller.request({expanded:true,cards,anchor:{x:60,y:10,width:26,height:7},contextKey:'a',prepare:()=>trace.push('sync'),...extra});
 return{controller,overlay,cards,trace,settled,errors,request,setActive:value=>active=value};
}
test('entry stages real cards, prepares one union canvas then reveals after its one animation',async()=>{
 const f=fixture(),result=f.request();assert.deepEqual(f.trace.slice(-3),['codex:stage','api:stage','sync']);await flush();
 assert.equal(f.overlay.prepares.length,1);assert.equal(f.overlay.prepares[0].layers.length,2);assert.deepEqual(f.overlay.prepares[0].bounds,{x:10,y:10,width:128,height:52});
 assert.deepEqual(f.controller.getRetentionBounds(),[{x:10,y:10,width:128,height:52}]);assert.equal(f.controller.isActive(),true);
 assert(f.trace.indexOf('prepared')<f.trace.indexOf('codex:masked'));f.overlay.finish();assert.equal((await result).ok,true);assert.equal(f.cards[0].controller.modes.at(-1),null);assert.equal(f.controller.isActive(),false);assert.equal(f.settled[0].canceled,false);
});
test('exit holds original paint through capture; pinned cards never enter transition',async()=>{
 const f=fixture();f.cards.push({id:'workbuddy',pinned:true,controller:{setGroupTransitionMode(){throw Error('pinned touched')},captureGroupTransitionFrames(){throw Error('pinned captured')}}});
 const result=f.request({expanded:false});assert.equal(f.cards[0].controller.modes.at(-1),'hold');await flush();assert.equal(f.overlay.prepares[0].layers.length,2);f.overlay.finish();await result;assert.equal(f.settled[0].expanded,false);
});
test('rapid reverse reuses exactly the same canvas captures and cancels stale finish',async()=>{
 const f=fixture(),exit=f.request({expanded:false});await flush();const captures=f.cards.map(row=>row.controller.captures),entry=f.request({expanded:true});await flush();
 assert.equal(f.overlay.prepares.length,1);assert.deepEqual(f.cards.map(row=>row.controller.captures),captures);assert.equal(f.overlay.animations.length,2);assert.notEqual(f.overlay.animations[0].token,f.overlay.animations[1].token);
 f.overlay.finish();await Promise.all([exit,entry]);assert.equal(f.settled.length,1);assert.equal(f.settled[0].expanded,true);assert.equal(f.settled[0].canceled,false);
});
test('duplicate same-target sync does not restart capture or animation',async()=>{
 const f=fixture(),first=f.request();assert.equal((await f.request()).pending,true);await flush();assert.equal((await f.request()).pending,true);assert.equal(f.overlay.animations.length,1);f.overlay.finish();await first;
});
test('cancel during pending capture releases masks and rejects late snapshots without showing',async()=>{
 const f=fixture(),capture=deferred();f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 const work=f.request();f.controller.cancel();capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await work;
 assert.equal(f.overlay.prepares.length,0);assert.equal(f.controller.isActive(),false);assert.equal(f.cards[0].controller.modes.at(-1),null);
});
test('context invalidation during capture cannot leave hold/stage latched',async()=>{
 const f=fixture(),capture=deferred();f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 const work=f.request();f.setActive(false);capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await work;assert.equal(f.controller.isActive(),false);assert.equal(f.cards[0].controller.modes.at(-1),null);assert.equal(f.settled.at(-1).canceled,true);
});
test('reduced motion applies final state without capturing pixels or displaying overlay',async()=>{
 const f=fixture();assert.equal((await f.request({reducedMotion:true})).immediate,true);assert.equal(f.cards[0].controller.captures,0);assert.equal(f.overlay.prepares.length,0);assert.equal(f.settled.at(-1).canceled,false);
});
test('failed capture and renderer preparation fall back without frozen windows',async()=>{
 for(const failAt of ['capture','prepare']){const f=fixture();if(failAt==='capture')f.cards[0].controller.captureGroupTransitionFrames=async()=>{throw Error('bad capture')};else f.overlay.prepare=async()=>{throw Error('bad renderer')};assert.equal((await f.request()).ok,false);assert.equal(f.controller.isActive(),false);assert.equal(f.cards[0].controller.modes.at(-1),null);assert.equal(f.errors.length,1);}
});
test('destroy invalidates pending work and releases only its own windows',async()=>{
 const f=fixture(),work=f.request();await flush();f.controller.destroy();await work;assert.equal(f.controller.isActive(),false);assert.equal((await f.request()).canceled,true);assert(f.trace.includes('destroy'));
});
test('union includes the bar endpoint and rejects invalid or unbounded geometry',()=>{
 assert.deepEqual(unionBounds([{x:20,y:40,width:128,height:150},{x:70,y:12.5,width:26,height:7}]),{x:20,y:12,width:128,height:178});assert.throws(()=>unionBounds([{x:0,y:0,width:9000,height:10}]));
});
test('第五张余额卡参加同一次进出动画，固定余额卡不被捕获或遮罩',async()=>{
 for(const pinned of [false,true]) {
  const f=fixture(),modes=[];let captures=0;
  f.cards.push({id:'balance',pinned,controller:{setGroupTransitionMode:mode=>modes.push(mode),async captureGroupTransitionFrames(){captures++;return[{bounds:{x:10,y:110,width:196,height:194},png}]}}});
  const entry=f.request();await flush();assert.equal(f.overlay.prepares[0].layers.length,pinned?2:3);
  assert.equal(captures,pinned?0:1);if(!pinned)assert.equal(modes.at(-1),'masked');else assert.deepEqual(modes,[]);
  f.overlay.finish();assert.equal((await entry).ok,true);if(!pinned)assert.equal(modes.at(-1),null);
  const exit=f.request({expanded:false});await flush();f.overlay.finish();assert.equal((await exit).ok,true);
  assert.equal(captures,pinned?0:2);if(pinned)assert.deepEqual(modes,[]);else assert.equal(modes.at(-1),null);f.controller.destroy();
 }
});
test('context changes after animation started release overlay and all masks',async()=>{
 const f=fixture(),work=f.request();await flush();f.setActive(false);f.overlay.finish();await work;assert.equal(f.controller.isActive(),false);assert.equal(f.cards[0].controller.modes.at(-1),null);assert.equal(f.settled.at(-1).canceled,true);
});
test('failure to stage a native host falls back before overlay can double-paint it',async()=>{
 const f=fixture();f.cards[0].controller.setGroupTransitionMode=mode=>{if(mode==='stage')throw Error('native failure');f.cards[0].controller.modes.push(mode)};assert.equal((await f.request()).ok,false);assert.equal(f.overlay.prepares.length,0);assert.equal(f.controller.isActive(),false);assert.equal(f.settled.at(-1).canceled,false,'valid-context fallback still commits the requested final state');
});
test('reversing before overlay is prepared settles existing real state without flashing a newly captured group',async()=>{
 const f=fixture(),capture=deferred();f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 const entry=f.request({expanded:true});const exit=await f.request({expanded:false});assert.equal(exit.immediate,true);capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await entry;
 assert.equal(f.overlay.prepares.length,0);assert.equal(f.overlay.animations.length,0);assert.equal(f.controller.isActive(),false);assert.equal(f.settled.at(-1).expanded,false);assert.equal(f.settled.at(-1).canceled,false);
});
test('synchronous safety cancellation from a controller mode cannot latch remaining staged siblings',async()=>{
 const f=fixture();let interrupted=false;const original=f.cards[0].controller.setGroupTransitionMode;
 f.cards[0].controller.setGroupTransitionMode=function(mode){original.call(this,mode);if(mode==='stage'&&!interrupted){interrupted=true;f.controller.cancel()}};
 assert.equal((await f.request()).ok,false);assert.equal(f.controller.isActive(),false);assert.equal(f.overlay.prepares.length,0);assert(f.cards.every(row=>row.controller.modes.at(-1)===null));
});

test('weather takes part in the same capture/mask animation and pinned weather is excluded',async()=>{
 for(const pinned of [false,true]){
  const f=fixture(),modes=[];let captures=0;
  f.cards.push({id:'weather',pinned,controller:{setGroupTransitionMode:mode=>modes.push(mode),async captureGroupTransitionFrames(){captures++;return[{bounds:{x:10,y:110,width:128,height:32},png}]}}});
  const work=f.request();await flush();assert.equal(f.overlay.prepares[0].layers.length,pinned?2:3);assert.equal(captures,pinned?0:1);
  f.overlay.finish();assert.equal((await work).ok,true);if(pinned)assert.deepEqual(modes,[]);else assert.deepEqual(modes,['stage','masked',null]);f.controller.destroy();
 }
});
function fixedCard(id,trace=[]){
 return {id,controller:{modes:[],setGroupTransitionMode(mode){this.modes.push(mode);trace.push(`${id}:${mode}`)},captureGroupTransitionFrames(){throw Error('fixed cards must not be captured')}}};
}
test('fixed cards keep their old layout through delayed capture and preparation, then move only after the overlay is visible',async()=>{
 const f=fixture(),pin=fixedCard('balance',f.trace),capture=deferred(),prepared=deferred();let painted='collapsed',desired=painted;
 const setMode=pin.controller.setGroupTransitionMode;
 pin.controller.setGroupTransitionMode=function(mode){setMode.call(this,mode);if(mode===null)painted=desired;};
 f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 const prepare=f.overlay.prepare;f.overlay.prepare=async value=>{await prepared.promise;await prepare(value)};
 const work=f.request({pinnedCards:[pin],prepare(){desired='expanded';if(pin.controller.modes.at(-1)!=='hold')painted=desired;f.trace.push('sync')}});
 assert.equal(painted,'collapsed');assert.equal(pin.controller.modes.at(-1),'hold');
 assert(f.trace.indexOf('balance:hold')<f.trace.indexOf('sync'));
 capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await flush();
 assert.equal(painted,'collapsed');assert(!f.trace.includes('overlay-show'));
 prepared.resolve();await flush();
 assert.equal(painted,'expanded');assert(f.trace.indexOf('overlay-show')<f.trace.indexOf('balance:null'));
 assert.equal(f.overlay.prepares[0].layers.length,2);assert.deepEqual(pin.controller.modes,['hold',null]);
 f.overlay.finish();assert.equal((await work).ok,true);assert.deepEqual(pin.controller.modes,['hold',null]);
});
test('fixed cards remain held throughout exit so they cannot move into outgoing snapshots',async()=>{
 const f=fixture(),pin=fixedCard('balance',f.trace);
 const work=f.request({expanded:false,pinnedCards:[pin]});await flush();
 assert(f.trace.includes('overlay-show'));assert.deepEqual(pin.controller.modes,['hold']);
 f.overlay.finish();assert.equal((await work).ok,true);assert.deepEqual(pin.controller.modes,['hold',null]);
 assert(f.trace.indexOf('balance:null')<f.trace.lastIndexOf('overlay-hide'));
});
test('rapid reversal reuses snapshots while fixed-card holds follow the latest direction only',async()=>{
 const f=fixture(),pin=fixedCard('balance');
 const entry=f.request({pinnedCards:[pin]});await flush();assert.equal(pin.controller.modes.at(-1),null);
 const exit=f.request({expanded:false,pinnedCards:[pin]});await flush();assert.equal(pin.controller.modes.at(-1),'hold');
 const reopening=f.request({pinnedCards:[pin]});await flush();assert.equal(pin.controller.modes.at(-1),null);
 const modes=[...pin.controller.modes];assert.equal((await f.request({pinnedCards:[pin]})).pending,true);assert.deepEqual(pin.controller.modes,modes);
 assert.equal(f.overlay.prepares.length,1);assert.deepEqual(f.cards.map(row=>row.controller.captures),[1,1]);
 f.overlay.finish();await Promise.all([entry,exit,reopening]);
 assert.equal(f.settled.length,1);assert.equal(f.settled[0].expanded,true);assert.equal(pin.controller.modes.at(-1),null);
});
test('capture failure, preparation failure and cancellation all release held fixed cards',async()=>{
 for(const failure of ['capture','prepare','cancel']){
  const f=fixture(),pin=fixedCard('balance'),capture=deferred();
  if(failure==='capture')f.cards[0].controller.captureGroupTransitionFrames=async()=>{throw Error('capture failed')};
  if(failure==='prepare')f.overlay.prepare=async()=>{throw Error('prepare failed')};
  if(failure==='cancel')f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
  const work=f.request({pinnedCards:[pin]});
  if(failure==='cancel'){f.controller.cancel();capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);}
  assert.equal((await work).ok,false,failure);assert.equal(f.controller.isActive(),false);
  assert.deepEqual(pin.controller.modes,['hold',null],failure);assert(!f.trace.includes('overlay-show'));
 }
});
test('reversing during capture and reduced motion never leave fixed cards held',async()=>{
 const f=fixture(),pin=fixedCard('balance'),capture=deferred();f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 const entry=f.request({pinnedCards:[pin]});
 assert.equal((await f.request({expanded:false,pinnedCards:[pin]})).immediate,true);assert.deepEqual(pin.controller.modes,['hold',null]);
 capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await entry;assert.equal(f.overlay.prepares.length,0);
 const reduced=fixture(),fixed=fixedCard('balance');
 assert.equal((await reduced.request({reducedMotion:true,pinnedCards:[fixed]})).immediate,true);assert.deepEqual(fixed.controller.modes,[]);
});
test('cancel cleanup releases old fixed cards without releasing a replacement generation started synchronously',async()=>{
 const f=fixture(),balance=fixedCard('balance'),workbuddy=fixedCard('workbuddy'),capture=deferred();
 f.cards[0].controller.captureGroupTransitionFrames=()=>capture.promise;
 let replace=false,replacement;const setMode=f.cards[0].controller.setGroupTransitionMode;
 f.cards[0].controller.setGroupTransitionMode=function(mode){setMode.call(this,mode);if(mode===null&&replace){replace=false;replacement=f.request({cards:[f.cards[0]],pinnedCards:[balance]});}};
 const original=f.request({pinnedCards:[balance,workbuddy]});replace=true;f.controller.cancel();
 assert.equal(f.controller.isActive(),true);assert.equal(balance.controller.modes.at(-1),'hold');assert.equal(workbuddy.controller.modes.at(-1),null);
 assert.equal(f.cards[0].controller.modes.at(-1),'stage');assert.equal(f.cards[1].controller.modes.at(-1),null);
 capture.resolve([{bounds:{x:10,y:30,width:128,height:32},png}]);await flush();
 assert.equal(balance.controller.modes.at(-1),null);assert.equal(f.cards[0].controller.modes.at(-1),'masked');
 f.overlay.finish();await Promise.all([original,replacement]);assert.equal(f.controller.isActive(),false);
 assert.equal(f.cards[0].controller.modes.at(-1),null);assert.equal(f.settled.length,1);
});
