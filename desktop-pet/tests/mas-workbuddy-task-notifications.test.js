'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMasWorkBuddyTaskNotifications}=require('../lib/mas-workbuddy-task-notifications');
const turn=event=>({version:1,sessionId:'test-session',generationId:'test-turn',event,
  phase:{UserPromptSubmit:'submitted',PreToolUse:'tool-started',FinalStop:'final-stop-observed'}[event],
  ...(event==='FinalStop'?{finalStopReason:'completed'}:{})});
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,options={}){
 let account='a'.repeat(64),saved=null,callback,installCount=0,restoreCount=0,closedCount=0;
 const alerts=[],calls=[];
 const installer={ensure:async()=>({status:'stored'}),install:async()=>{installCount++;return{status:'installed',requiresNewSession:true};},
  restore:async()=>{restoreCount++;return{status:'installed'};},uninstall:async()=>calls.push('uninstall'),revoke:async()=>calls.push('revoke'),close(){},...options.installer};
 const storage={load:async()=>saved,save:async(_,value)=>{saved=structuredClone(value);},remove:async()=>{saved=null;},...options.storage};
 const {installer:ignoredInstaller,storage:ignoredStorage,...controllerOptions}=options;
 const port=createMasWorkBuddyTaskNotifications({installer,storage,getAccountKey:()=>account,onAlert:e=>alerts.push(e),
  createBridge:({onEvent})=>{callback=onEvent;return{start:async input=>({endpoint:'http://127.0.0.1:43121/workbuddy/events',token:input?.token||'t'.repeat(43)}),close:async()=>{closedCount++;}};},...controllerOptions});
 t.after(()=>port.close());return{port,alerts,calls,emit:e=>callback(e),setAccount:v=>{account=v;},get saved(){return saved;},get installCount(){return installCount;},get restoreCount(){return restoreCount;},get closedCount(){return closedCount;}};
}
test('source event is checked against current local account before processing and completion',async t=>{
 const verified=[];const f=fixture(t,{verifyAccount:async expected=>{verified.push(expected);return{accountKey:expected};}});
 assert.equal((await f.port.enable()).status,'ready');f.emit(turn('UserPromptSubmit'));await settle();
 assert.equal(f.port.getState().activeCount,1);f.emit(turn('FinalStop'));await settle();
 assert.deepEqual(f.alerts.map(e=>e.kind),['processing','completed']);assert.equal(verified.length,2);
 assert.equal(f.port.getState().activeCount,0);assert(!JSON.stringify(f.port.getState()).includes('t'.repeat(43)));
});
test('disable during directory selection cannot install or briefly enable a stale request',async t=>{
 let release,selected;const selectedNow=new Promise(r=>selected=r);const f=fixture(t,{installer:{ensure:()=>{selected();return new Promise(r=>release=r);}}});
 const enabling=f.port.enable();await selectedNow;const disabling=f.port.disable();release({status:'stored'});
 assert.equal((await enabling).status,'cancelled');await disabling;assert.equal(f.installCount,0);assert.equal(f.port.getState().enabled,false);assert.equal(f.saved,null);
});
test('close during saved pairing load cannot resurrect enabled state',async t=>{
 let release;const f=fixture(t,{storage:{load:()=>new Promise(r=>release=r)}});const restoring=f.port.restore();await settle();f.port.close();
 release({version:1,accountKey:'a'.repeat(64),port:43121,endpoint:'http://127.0.0.1:43121/workbuddy/events',token:'t'.repeat(43)});
 await restoring;assert.equal(f.port.getState().enabled,false);assert.equal(f.restoreCount,0);
});
test('revoke invalidates an identity check already in flight and blocks its late animation',async t=>{
 let release;const f=fixture(t,{verifyAccount:()=>new Promise(r=>release=r)});await f.port.enable();
 f.emit(turn('UserPromptSubmit'));await settle();const disabling=f.port.disable();release({accountKey:'a'.repeat(64)});await disabling;await settle();
 assert.equal(f.alerts.length,0);assert.equal(f.port.getState().activeCount,0);assert.equal(f.port.getState().connected,false);
});
test('fresh source account mismatch stops reception without borrowing a cached balance identity',async t=>{
 const f=fixture(t,{verifyAccount:async()=>({accountKey:'b'.repeat(64)})});await f.port.enable();f.emit(turn('UserPromptSubmit'));await settle();
 assert.equal(f.port.getState().status,'account-changed');assert.equal(f.port.getState().connected,false);assert.equal(f.alerts.length,0);
});
test('restoring a saved source cannot install a missing hook or replay old completion',async t=>{
 const f=fixture(t);await f.port.enable();const saved=structuredClone(f.saved);f.port.close();
 const restored=fixture(t,{storage:{load:async()=>saved},installer:{restore:async()=>({status:'not-installed'})}});
 await restored.port.restore();assert.equal(restored.installCount,0);assert.equal(restored.port.getState().connected,false);assert.equal(restored.alerts.length,0);
});
test('local pairing cleanup failure still uninstalls source hook and revokes its grant',async t=>{
 const f=fixture(t,{storage:{remove:async()=>{throw Error('disk unavailable');}}});await f.port.enable();
 assert.equal((await f.port.disable()).status,'cleanup-pending');assert.deepEqual(f.calls,['uninstall','revoke']);
 assert.equal(f.port.getState().connected,false);
});
test('close immediately closes a listening bridge even while source restore is pending',async t=>{
 let release;const saved={version:1,accountKey:'a'.repeat(64),port:43121,endpoint:'http://127.0.0.1:43121/workbuddy/events',token:'t'.repeat(43)};
 const f=fixture(t,{storage:{load:async()=>saved},installer:{restore:()=>new Promise(r=>release=r)}});
 const restoring=f.port.restore();await settle();assert.equal(f.closedCount,0);await f.port.close();assert.equal(f.closedCount,1);
 release({status:'installed'});await restoring;assert.equal(f.port.getState().enabled,false);
});
