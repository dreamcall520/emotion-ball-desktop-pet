'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createMasZcodeChatConnection } = require('../lib/mas-zcode-chat-connection');
const key='a'.repeat(64), other='b'.repeat(64);
function fixture() {
 let saved=null, current=key, disables=0, write;
 const storage={load:async provider=>{assert.equal(provider,'zcode');return saved;},save:async(provider,value)=>{assert.equal(provider,'zcode');saved=value;if(write)await write();},remove:async()=>{saved=null;}};
 const controller=createMasZcodeChatConnection({storage,getAccountKey:()=>current,onDisable:()=>disables++});
 return {controller,setAccount:value=>{current=value;},saved:()=>saved,disables:()=>disables,holdWrite:fn=>{write=fn;},seed:value=>{saved=value;}};
}
test('ZCode chat cannot inherit quota-only or another provider consent, and restores only matching official account',async()=>{
 const f=fixture();f.seed({version:1,purpose:'zcode-quota-device-tasks-v1',enabled:true,accountKey:key});
 assert.equal((await f.controller.restore()).authorized,false);
 assert.equal((await f.controller.enable()).authorized,true);assert.equal(f.saved().purpose,'zcode-installed-official-chat-v1');
 assert.equal((await f.controller.restore()).authorized,true);
 f.setAccount(other);assert.equal(f.controller.getState().authorized,false);assert.equal(f.controller.getAuthorizedAccountKey(),null);
 await f.controller.refreshAccount();assert.equal(f.saved(),null);
});
test('disconnect during consent save invalidates late authority; transient identity loss revokes active generation',async()=>{
 const f=fixture();let entered,release;const ready=new Promise(resolve=>{entered=resolve;});
 f.holdWrite(()=>{entered();return new Promise(resolve=>{release=resolve;});});
 const enabling=f.controller.enable();await ready;const disabling=f.controller.disable();release();await enabling;await disabling;
 assert.equal(f.controller.getState().authorized,false);assert.equal(f.saved(),null);
 f.holdWrite(null);await f.controller.enable();const generation=f.controller.getGeneration();
 f.setAccount(null);assert.equal(f.controller.getAuthorizedAccountKey(),null);assert(f.controller.getGeneration()>generation);
 f.setAccount(key);await f.controller.refreshAccount();assert.equal(f.controller.getState().authorized,true);
 await f.controller.disable();assert.equal(f.controller.getState().authorized,false);assert(f.disables()>0);
});
