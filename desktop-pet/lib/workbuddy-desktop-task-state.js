'use strict';
const {createHash}=require('node:crypto');
const {parseMetadata}=require('./workbuddy-desktop-event-bridge');
const WIRE_KEYS=new Set(['version','sessionId','generationId','event','phase','finalStopReason','isInternalContinuation','isTruncationRecovery','eventId','occurredAt']);
const BRIDGE_KEYS=new Set(['type','source','scope','correlated','terminalConfirmed','terminalKind','overallTaskVerified','taskState','observedAt','observationId']);
const ACTIVE=new Set(['processing','working']);
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const ACTIVITY=new Set(['PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied']);
const safeBinding=value=>value&&/^[0-9a-f]{64}$/.test(value.accountKey||'')&&Number.isSafeInteger(value.epoch)&&value.epoch>=0;

// Accept only events from the controller's authenticated source-token binding.
// No historical cache is restored, and a terminal without an observed submit is
// never a notification. The controller owns token/account attribution and UI.
function createWorkBuddyDesktopTaskState({now=Date.now,schedule=setTimeout,cancel=clearTimeout,
 onChange=()=>{},onAlert=()=>{},onClear=()=>{},inactivityMs=120000}={}){
 if(!Number.isSafeInteger(inactivityMs)||inactivityMs<20||inactivityMs>1800000)throw new TypeError('Invalid inactivity interval');
 let binding=null,boundAt=0,closed=false,timer=null,revision=0,alertId=0;
 const tasks=new Map(),tombstones=new Map(),seen=new Map(),sessionStarts=new Map();
 const clock=()=>{const value=Number(now());return Number.isFinite(value)&&value>=0?Math.trunc(value):Date.now();};
 const safeCall=(fn,value)=>{try{fn(value);}catch{}};
 const current=owner=>Boolean(binding&&safeBinding(owner)&&owner.accountKey===binding.accountKey&&owner.epoch===binding.epoch);
 function getState(){
  const list=[...tasks.values()].sort((a,b)=>b.revision-a.revision),active=list.filter(task=>ACTIVE.has(task.state));
  const task=active[0]||list.find(task=>task.state==='waiting')||list[0]||null;
  return structuredClone({enabled:Boolean(binding)&&!closed,accountKey:binding?.accountKey||null,epoch:binding?.epoch??null,generation:binding?.epoch??null,
   status:!binding||closed?'disabled':active.length?active[0].state:task?.state==='waiting'?'waiting':task?.state==='unknown'?'unknown':'idle',
   activeCount:active.length,task,tasks:list,scope:'current-authorized-workbuddy-main-replies',overallTaskVerified:false});
 }
 const notify=()=>safeCall(onChange,getState());
 function clear(reason){safeCall(onClear,{reason,epoch:binding?.epoch??null,accountKey:binding?.accountKey||null});}
 function stopTimer(){if(timer!==null)cancel(timer);timer=null;}
 function arm(){
  stopTimer();if(closed||!binding)return;
  const deadlines=[...tasks.values()].filter(task=>ACTIVE.has(task.state)||task.state==='waiting').map(task=>task.deadline);
  if(!deadlines.length)return;
  const owner={...binding};timer=schedule(()=>{
   if(closed||!current(owner))return;
   timer=null;const at=clock();let changed=false;
   for(const task of tasks.values())if((ACTIVE.has(task.state)||task.state==='waiting')&&task.deadline<=at){Object.assign(task,{state:'unknown',phase:'inactivity',running:null,realtime:false,revision:++revision});changed=true;}
   if(changed){notify();if(getState().activeCount===0)clear('inactivity');}arm();
  },Math.max(1,Math.min(...deadlines)-clock()));timer?.unref?.();
 }
 function reset(){stopTimer();clear('reset');binding=null;tasks.clear();tombstones.clear();seen.clear();sessionStarts.clear();notify();}
 function bind(value){
  if(closed)return false;if(!safeBinding(value)){reset();return false;}
  if(current(value))return true;
  reset();binding={accountKey:value.accountKey,epoch:value.epoch};boundAt=clock();notify();return true;
 }
 function emit(kind,task,owner){
  if(closed||!current(owner))return;
  alertId++;safeCall(onAlert,{id:alertId,kind,taskId:task.id,sessionId:task.sessionId,generationId:task.generationId,
   accountKey:owner.accountKey,epoch:owner.epoch,generation:owner.epoch,phase:task.phase,observedAt:clock(),
   terminal:TERMINAL.has(kind),terminalKind:TERMINAL.has(kind)?'main-reply':null,overallTaskVerified:false});
 }
 function tombstone(key){tombstones.set(key,true);while(tombstones.size>1024)tombstones.delete(tombstones.keys().next().value);}
 function accept(raw,owner){
  if(closed||!current(owner)||!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  let metadata;
  try{
   if(Object.keys(raw).some(key=>!WIRE_KEYS.has(key)&&!BRIDGE_KEYS.has(key)))return false;
   const clean=Object.fromEntries(Object.entries(raw).filter(([key])=>WIRE_KEYS.has(key)));
   metadata=parseMetadata(Buffer.from(JSON.stringify(clean)));
  }catch{return false;}
  if(!metadata.generationId)return false;
  const at=clock(),sourceAt=metadata.occurredAt??(Number.isSafeInteger(raw.observedAt)?raw.observedAt:at);
  if(sourceAt<boundAt-1000||sourceAt>at+30000)return false;
  const key=createHash('sha256').update(metadata.sessionId+'\0'+metadata.generationId).digest('hex').slice(0,32);
  if(tombstones.has(key))return false;
  const prior=tasks.get(key),sessionStart=sessionStarts.get(metadata.sessionId);
  if(sessionStart&&sessionStart.key!==key&&sourceAt<sessionStart.at)return false;
  if(prior&&sourceAt<prior.sourceAt)return false;
  const duplicate=[key,metadata.event,metadata.eventId||'',metadata.isInternalContinuation??'',metadata.isTruncationRecovery??'',metadata.finalStopReason||''].join(':');
  if(seen.has(duplicate))return false;
  if(metadata.event==='UserPromptSubmit'){
   if(metadata.isInternalContinuation===true||metadata.isTruncationRecovery===true){
    if(!prior)return false;
    Object.assign(prior,{phase:'continuing',sourceAt,lastEventAt:at,deadline:at+inactivityMs,revision:++revision});notify();arm();return current(owner);
   }
   if(prior)return false;
   for(const old of tasks.values())if(old.sessionId===metadata.sessionId&&old.id!==key&&!TERMINAL.has(old.state)){
    Object.assign(old,{state:'unknown',phase:'superseded',running:null,realtime:false,revision:++revision});tombstone(old.id);
   }
   const task={id:key,sessionId:metadata.sessionId,generationId:metadata.generationId,state:'processing',phase:'submitted',running:null,
    realtime:true,evidence:'user-input-submitted',sourceAt,startedAt:at,lastEventAt:at,deadline:at+inactivityMs,revision:++revision,overallTaskVerified:false};
   tasks.set(key,task);sessionStarts.set(metadata.sessionId,{key,at:sourceAt});seen.set(duplicate,true);notify();emit('processing',task,owner);arm();
  }else if(metadata.event==='FinalStop'){
   if(metadata.isTruncationRecovery===true||!TERMINAL.has(metadata.finalStopReason))return false;
   if(!prior){tombstone(key);return false;}
   Object.assign(prior,{state:metadata.finalStopReason,phase:'main-reply-ended',running:false,realtime:true,sourceAt,lastEventAt:at,finishedAt:at,revision:++revision});
   tombstone(key);notify();if(current(owner)&&getState().activeCount===0)clear('terminal');emit(metadata.finalStopReason,prior,owner);arm();
  }else if(ACTIVITY.has(metadata.event)){
   if(!prior)return false;
   const state=['PermissionRequest','PermissionDenied'].includes(metadata.event)?'waiting':'working',changed=prior.state!==state;
   Object.assign(prior,{state,phase:metadata.phase,running:state==='working'?true:null,realtime:true,evidence:'official-activity-hook',sourceAt,lastEventAt:at,deadline:at+inactivityMs,revision:++revision});
   seen.set(duplicate,true);notify();if(changed)emit(state,prior,owner);arm();
  }else if(['Stop','StopFailure','SessionEnd'].includes(metadata.event)){
   if(!prior)return false;
   Object.assign(prior,{phase:metadata.phase,sourceAt,lastEventAt:at,revision:++revision});seen.set(duplicate,true);notify();arm();
  }else return false;
  while(tasks.size>128){const removable=[...tasks.values()].find(task=>!ACTIVE.has(task.state)&&task.state!=='waiting')||tasks.values().next().value;tombstone(removable.id);tasks.delete(removable.id);}
  while(sessionStarts.size>256)sessionStarts.delete(sessionStarts.keys().next().value);
  while(seen.size>1024)seen.delete(seen.keys().next().value);
  return current(owner);
 }
 function close(){if(closed)return;reset();closed=true;notify();}
 return{bind,accept,reset,getState,close};
}
module.exports={createWorkBuddyDesktopTaskState};
