const test=require('node:test'),assert=require('node:assert/strict');
const {createFlow}=require('../lib/provider-authorization-flow');
const guide=(state,p)=>({steps:state[p]||[]});
const auth=id=>({id,status:'needs-authorization',action:'enable-provider'});
test('selected tools alone run in stable serial order, ready and optional steps never authorize',()=>{
 const f=createFlow(guide);f.start(['workbuddy','codex','evil']);const state={codex:[{id:'ready',status:'ready'},auth('chat')],zcode:[auth('chat')],workbuddy:[{...auth('quota'),optional:true},auth('tasks')]};
 let n=f.next(state);assert.equal(n.provider,'codex');f.attempted(n.provider,n.step);n=f.next(state);assert.equal(n.provider,'workbuddy');assert.equal(n.step.id,'tasks');f.attempted(n.provider,n.step);assert.equal(f.next(state),null);assert.equal(f.active,false);
});
test('pending user confirmation pauses serial queue and stopping prevents late state from starting another authorization',()=>{
 const f=createFlow(guide);f.start(['codex','zcode']);assert.deepEqual(f.next({codex:[{id:'chat',status:'working'}],zcode:[auth('chat')]}),{provider:'codex',waiting:true});f.stop();assert.equal(f.next({zcode:[auth('chat')]}),null);
});
test('cancelled provider defers its remaining steps while other selected tool may continue; no retry loop',()=>{
 const f=createFlow(guide);const s={codex:[auth('chat'),auth('data')],zcode:[auth('chat')]};f.start(['codex','zcode']);const n=f.next(s);f.attempted(n.provider,n.step);f.defer('codex');assert.equal(f.next(s).provider,'zcode');f.defer('zcode');assert.equal(f.next(s),null);
});
test('unsupported, empty and waiting for first event never trigger automatic action',()=>{
 const f=createFlow(guide);f.start(['zcode']);assert.equal(f.next({zcode:[{id:'chat',status:'unavailable',action:'enable-provider'},{id:'tasks',status:'ready'},{id:'task-verification',status:'unknown'}]}),null);
});
