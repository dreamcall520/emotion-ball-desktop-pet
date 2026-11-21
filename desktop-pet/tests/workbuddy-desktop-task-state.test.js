'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkBuddyDesktopTaskState}=require('../lib/workbuddy-desktop-task-state');
const binding={accountKey:'a'.repeat(64),epoch:1};
const phases={UserPromptSubmit:'submitted',PreToolUse:'tool-started',PostToolUse:'tool-finished',PostToolUseFailure:'tool-failed',PermissionRequest:'permission-requested',PermissionDenied:'permission-denied',Stop:'stop-observed',StopFailure:'failure-observed',FinalStop:'final-stop-observed',SessionEnd:'session-ended'};
function event(name,extra={}){return{version:1,sessionId:'session-a',generationId:'turn-a',event:name,phase:phases[name],...extra};}
function fixture(options={}){let time=10000;const timers=new Set(),alerts=[],changes=[],clears=[];
 const state=createWorkBuddyDesktopTaskState({now:()=>time,schedule:(fn,delay)=>{const timer={fn,at:time+delay};timers.add(timer);return timer;},cancel:timer=>timers.delete(timer),inactivityMs:2000,onAlert:x=>alerts.push(x),onChange:x=>changes.push(x),onClear:x=>clears.push(x),...options});
 const advance=ms=>{const until=time+ms;for(;;){const due=[...timers].sort((a,b)=>a.at-b.at)[0];if(!due||due.at>until)break;timers.delete(due);time=due.at;due.fn();}time=until;};
 state.bind(binding);return{state,alerts,changes,clears,advance,get now(){return time;}};
}
test('submitted is processing only; real tool activity and permission events drive working/waiting',()=>{
 const f=fixture();assert.equal(f.state.getState().status,'idle');assert.equal(f.state.accept(event('UserPromptSubmit'),binding),true);
 assert.equal(f.state.getState().status,'processing');assert.equal(f.state.getState().task.running,null);assert.equal(f.alerts[0].kind,'processing');assert.equal(Number.isSafeInteger(f.alerts[0].id),true);assert.ok(f.alerts[0].id>0);assert.equal(f.state.getState().generation,binding.epoch);
 f.state.accept(event('PreToolUse',{eventId:'tool-1'}),binding);assert.equal(f.state.getState().status,'working');assert.equal(f.state.getState().task.running,true);
 f.state.accept(event('PermissionRequest',{eventId:'permission-1'}),binding);assert.equal(f.state.getState().status,'waiting');assert.equal(f.state.getState().activeCount,0);
 f.state.accept(event('PostToolUse',{eventId:'tool-2'}),binding);assert.equal(f.state.getState().status,'working');assert.equal(f.state.getState().activeCount,1);
});
test('Stop is not completion; only correlated final completed ends a previously observed current turn',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.state.accept(event('Stop'),binding);assert.equal(f.alerts.some(x=>x.kind==='completed'),false);
 assert.equal(f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding),true);assert.equal(f.state.getState().status,'idle');assert.equal(f.state.getState().task.state,'completed');assert.equal(f.alerts.at(-1).kind,'completed');
 assert.equal(f.state.getState().task.overallTaskVerified,false);
});
test('cancelled failed interrupted remain distinct and never use the success kind',()=>{
 for(const reason of ['cancelled','failed','interrupted']){const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.state.accept(event('FinalStop',{finalStopReason:reason}),binding);assert.equal(f.alerts.at(-1).kind,reason);assert.equal(f.state.getState().task.state,reason);assert.ok(!f.alerts.some(x=>x.kind==='completed'));}
});
test('missing generation, unknown terminal reason and truncated recovery never report success',()=>{
 const f=fixture();const missing=event('UserPromptSubmit');delete missing.generationId;assert.equal(f.state.accept(missing,binding),false);
 f.state.accept(event('UserPromptSubmit'),binding);
 for(const extra of [{},{finalStopReason:'other'},{finalStopReason:'completed',isTruncationRecovery:true}])f.state.accept(event('FinalStop',extra),binding);
 assert.ok(!f.alerts.some(x=>x.kind==='completed'));assert.equal(f.state.getState().activeCount,1);
});
test('internal continuation does not start a new task or repeat the start notification',()=>{
 const f=fixture();assert.equal(f.state.accept(event('UserPromptSubmit',{isInternalContinuation:true}),binding),false);assert.equal(f.alerts.length,0);
 f.state.accept(event('UserPromptSubmit'),binding);f.state.accept(event('UserPromptSubmit',{isInternalContinuation:true}),binding);assert.equal(f.alerts.length,1);
});
test('inactivity stops thinking as unknown; distinct real activities renew the deadline',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.advance(1500);f.state.accept(event('PreToolUse',{eventId:'activity-1'}),binding);f.advance(1500);assert.equal(f.state.getState().status,'working');
 f.advance(600);assert.equal(f.state.getState().status,'unknown');assert.equal(f.state.getState().activeCount,0);assert.equal(f.state.getState().task.running,null);assert.equal(f.clears.at(-1).reason,'inactivity');assert.ok(!f.alerts.some(x=>x.kind==='completed'));
});
test('duplicate activity does not indefinitely extend liveness; duplicate terminal never emits twice',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.state.accept(event('PreToolUse',{eventId:'activity'}),binding);f.advance(1500);assert.equal(f.state.accept(event('PreToolUse',{eventId:'activity'}),binding),false);f.advance(501);assert.equal(f.state.getState().status,'unknown');
 f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding);f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding);assert.equal(f.alerts.filter(x=>x.kind==='completed').length,1);
});
test('out of order final before submit and historical completion after restart do not create reminders',()=>{
 const f=fixture();assert.equal(f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding),false);assert.equal(f.state.accept(event('UserPromptSubmit'),binding),false);assert.equal(f.alerts.length,0);
 f.state.reset();f.state.bind({...binding,epoch:2});assert.equal(f.state.accept(event('FinalStop',{finalStopReason:'completed'}),{...binding,epoch:2}),false);assert.equal(f.alerts.length,0);
});
test('late nonterminal events cannot reopen a terminal round or replace a newer session generation',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit',{occurredAt:10000}),binding);f.advance(1000);f.state.accept(event('UserPromptSubmit',{generationId:'turn-b',occurredAt:11000}),binding);
 assert.equal(f.state.accept(event('UserPromptSubmit',{generationId:'turn-c',occurredAt:10000}),binding),false);
 assert.equal(f.state.accept(event('FinalStop',{generationId:'turn-a',occurredAt:10000,finalStopReason:'completed'}),binding),false);
 f.state.accept(event('FinalStop',{generationId:'turn-b',finalStopReason:'completed',occurredAt:11000}),binding);assert.equal(f.state.accept(event('PreToolUse',{generationId:'turn-b',eventId:'late'}),binding),false);
 assert.equal(f.alerts.filter(x=>x.kind==='completed').length,1);
});
test('revoke, close and account/epoch changes clear active state and reject delayed foreign events',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.state.bind({accountKey:'b'.repeat(64),epoch:2});assert.equal(f.state.getState().status,'idle');
 assert.equal(f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding),false);f.state.reset();assert.equal(f.state.getState().enabled,false);assert.equal(f.state.accept(event('UserPromptSubmit'),binding),false);f.state.close();assert.equal(f.state.bind(binding),false);
});
test('independent observed sessions do not clear another active task when one completes',()=>{
 const f=fixture();f.state.accept(event('UserPromptSubmit'),binding);f.state.accept(event('UserPromptSubmit',{sessionId:'session-b',generationId:'turn-b'}),binding);assert.equal(f.state.getState().activeCount,2);
 f.state.accept(event('FinalStop',{finalStopReason:'completed'}),binding);assert.equal(f.state.getState().activeCount,1);assert.equal(f.state.getState().task.sessionId,'session-b');
 assert.equal(f.clears.some(x=>x.reason==='terminal'),false);
});
test('state contains no arbitrary provider fields, refuses invalid inputs and returns independent snapshots',()=>{
 const f=fixture();assert.equal(f.state.accept(event('UserPromptSubmit',{prompt:'private'}),binding),false);assert.equal(f.state.accept(event('UserPromptSubmit'),{...binding,epoch:0}),false);
 f.state.accept(event('UserPromptSubmit'),binding);const first=f.state.getState();first.task.state='completed';assert.equal(f.state.getState().task.state,'processing');assert.ok(!JSON.stringify(f.state.getState()).includes('private'));
});
test('revoking or switching accounts from a notification callback cannot emit an old task under new authority',()=>{
 for(const switchAccount of [false,true]){let controller;const alerts=[];controller=createWorkBuddyDesktopTaskState({onAlert:x=>alerts.push(x),onChange:snapshot=>{if(snapshot.status==='processing'){if(switchAccount)controller.bind({accountKey:'b'.repeat(64),epoch:2});else controller.reset();}}});
  controller.bind(binding);assert.equal(controller.accept(event('UserPromptSubmit'),binding),false);assert.equal(alerts.length,0);controller.close();}
});
test('source-side filter through authenticated loopback drives only the current main-reply lifecycle', {skip:process.platform!=='darwin'}, async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
 const {createWorkBuddyDesktopEventBridge}=require('../lib/workbuddy-desktop-event-bridge');
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-task-lifecycle-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const alerts=[],state=createWorkBuddyDesktopTaskState({onAlert:value=>alerts.push(value)});state.bind(binding);t.after(()=>state.close());
 const bridge=createWorkBuddyDesktopEventBridge({onEvent:value=>state.accept(value,binding)}),config=await bridge.start();t.after(()=>bridge.close());
 fs.writeFileSync(path.join(directory,'receiver.json'),JSON.stringify(config),{mode:0o600});
 const source=path.resolve(__dirname,'../assets/workbuddy-desktop-hook/plugins/qiuqiu-task-events/scripts/emit-metadata.sh');
 const send=(hook,extra={})=>new Promise((resolve,reject)=>{
  const child=spawn('/bin/sh',[source],{env:{PATH:'/usr/bin:/bin',QIUQIU_METADATA_ROOT:directory},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('error',reject);child.on('close',code=>{try{assert.deepEqual({code,stdout,stderr},{code:0,stdout:'',stderr:''});resolve();}catch(error){reject(error);}});
  child.stdin.end(JSON.stringify({session_id:'synthetic-session',generation_id:'synthetic-turn',hook_event_name:hook,prompt:'SYNTHETIC_PRIVATE_INPUT',tool_input:{body:'SYNTHETIC_PRIVATE_BODY'},...extra}));
 });
 await send('UserPromptSubmit',{is_internal_continuation:false});assert.equal(state.getState().status,'processing');
 await send('PreToolUse');assert.equal(state.getState().status,'working');
 await send('PermissionRequest');assert.equal(state.getState().status,'waiting');
 await send('PostToolUse');assert.equal(state.getState().status,'working');
 await send('Stop');assert.equal(alerts.some(value=>value.kind==='completed'),false);
 await send('FinalStop',{final_stop_reason:'completed',is_truncation_recovery:false});assert.equal(alerts.filter(value=>value.kind==='completed').length,1);assert.equal(state.getState().activeCount,0);
 assert.equal(JSON.stringify([...alerts,state.getState()]).includes('SYNTHETIC_PRIVATE'),false);
});
