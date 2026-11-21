'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createMasWorkBuddyTaskAccess}=require('../lib/mas-workbuddy-task-access');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'wb-task-access-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'.workbuddy');await fs.mkdir(directory);
 let saved=null;const selections=[],requests=[],scopes=[];
 const storage={load:async()=>saved,save:async(_,value)=>{saved=structuredClone(value);},remove:async()=>{saved=null;}};
 const app={getPath:()=>root,startAccessingSecurityScopedResource:b=>{if(b==='expired')throw Error();scopes.push('open');return()=>scopes.push('close');}};
 const dialog={showOpenDialog:async options=>{requests.push(options);const value=selections.shift();assert.ok(value,'unplanned picker');return typeof value==='function'?value():value;}};
 const access=createMasWorkBuddyTaskAccess({app,dialog,storage,mas:true,home:()=>root});
 return{access,directory,selections,requests,scopes,storage,get saved(){return saved;},set saved(v){saved=v;},pick:()=>({canceled:false,filePaths:[directory],bookmarks:['task-bookmark']})};
}
test('task authority is independent, explicit and restored without background pickers',async t=>{
 const f=await fixture(t);assert.equal((await f.access.ensure()).status,'needs-authorization');assert.equal(f.requests.length,0);
 f.selections.push(f.pick());assert.equal((await f.access.ensure({interactive:true})).status,'stored');assert.equal(f.saved.purpose,'workbuddy-task-metadata-v1');
 assert.match(f.requests[0].message,/标题.*状态.*未读/);assert.match(f.requests[0].message,/不读.*正文/);
 assert.equal((await f.access.ensure()).status,'stored');assert.equal(f.requests.length,1);
 const lease=await f.access.acquire('workbuddy');assert.equal(lease.isCurrent(),true);lease.release();lease.release();
 assert.equal(f.scopes.filter(x=>x==='open').length,f.scopes.filter(x=>x==='close').length);
});
test('quota-account and stale grants cannot silently authorize task metadata',async t=>{
 const f=await fixture(t);f.saved={kind:'installed-workbuddy-quota-account-v1',directory:f.directory,bookmark:'old'};
 assert.equal((await f.access.ensure()).status,'needs-authorization');await assert.rejects(f.access.acquire('workbuddy'),{code:'DIRECTORY_ACCESS_REQUIRED'});
 f.saved={purpose:'workbuddy-task-metadata-v1',directory:f.directory,bookmark:'expired'};
 assert.equal((await f.access.ensure()).status,'needs-authorization');
});
test('cancelled or closed native selection never persists authority',async t=>{
 const f=await fixture(t),controller=new AbortController();f.selections.push(()=>{controller.abort();return f.pick();});
 await assert.rejects(f.access.ensure({interactive:true,signal:controller.signal}),{code:'CANCELLED'});assert.equal(f.saved,null);
 f.selections.push({canceled:true});assert.equal((await f.access.ensure({interactive:true})).status,'cancelled');assert.equal(f.saved,null);
});
test('revoke invalidates in-flight task leases immediately and removes only task authority',async t=>{
 const f=await fixture(t);f.selections.push(f.pick());await f.access.ensure({interactive:true});
 const lease=await f.access.acquire('workbuddy');const revoking=f.access.revoke();assert.equal(lease.isCurrent(),false);await revoking;assert.equal(f.saved,null);lease.release();
});
test('native task grant refuses another directory and ordinary Electron has no MAS authority',async t=>{
 const f=await fixture(t);f.selections.push({filePaths:[path.dirname(f.directory)],bookmarks:['bad']});
 assert.equal((await f.access.ensure({interactive:true})).status,'invalid-directory');assert.equal(f.saved,null);
 const ordinary=createMasWorkBuddyTaskAccess({app:{},dialog:{},storage:f.storage,mas:false});assert.equal((await ordinary.ensure({interactive:true})).status,'unavailable');
});
