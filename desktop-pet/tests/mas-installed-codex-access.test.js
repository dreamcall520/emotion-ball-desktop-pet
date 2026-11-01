'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createMasInstalledCodexAccess}=require('../lib/mas-installed-codex-access');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'installed-access-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const appDir=path.join(root,'ChatGPT.app'),accountDir=path.join(root,'.codex');await fs.mkdir(appDir);await fs.mkdir(accountDir);
 let saved=null;const requests=[],selected=[],events=[];
 const storage={load:async()=>saved,save:async(_,value)=>{saved=structuredClone(value);},remove:async()=>{saved=null;}};
 const app={getPath:()=>root,startAccessingSecurityScopedResource:bookmark=>{if(bookmark==='expired')throw Error('expired');events.push('open:'+bookmark);return()=>events.push('stop:'+bookmark);}};
 const dialog={showOpenDialog:async options=>{requests.push(options);const next=selected.shift();assert.ok(next,'No unplanned system selection');return typeof next==='function'?next():next;}};
 const make=()=>createMasInstalledCodexAccess({app,dialog,storage,mas:true});
 const pick=(directory,bookmark)=>({canceled:false,filePaths:[directory],bookmarks:[bookmark]});
 return{root,appDir,accountDir,storage,app,dialog,make,pick,requests,selected,events,get saved(){return saved;},set saved(value){saved=value;}};
}
test('explicit two purposes, no automatic picker; restart reuses valid grants and scopes balance',async t=>{
 const f=await fixture(t),access=f.make();assert.deepEqual(await access.getStatus(),{status:'needs-authorization'});assert.equal(f.requests.length,0);
 f.selected.push(f.pick(f.appDir,'app'),f.pick(f.accountDir,'account'));assert.deepEqual(await access.ensure({interactive:true}),{status:'stored',changed:true});
 assert.equal(f.requests.length,2);assert.equal(f.saved.app.purpose,'installed-app');assert.equal(f.saved.account.purpose,'codex-account-client');
 assert.match(f.requests[1].message,/可能更新.*日志、会话或缓存/);assert.match(f.requests[1].message,/任务日志只读同步是独立授权/);
 assert.equal(f.requests[0].securityScopedBookmarks,true);assert.equal(f.requests[1].securityScopedBookmarks,true);
 const restored=f.make();assert.deepEqual(await restored.ensure({interactive:false}),{status:'stored'});assert.equal(f.requests.length,2);
 const lease=await restored.directoryAccess.acquire('codex');lease.release();lease.release();
 assert.equal(f.events.filter(x=>x.startsWith('open:')).length,f.events.filter(x=>x.startsWith('stop:')).length);
});
test('cancel second choice commits neither grant; expired replacement cancellation preserves old pair',async t=>{
 const f=await fixture(t),access=f.make();f.selected.push(f.pick(f.appDir,'app'),{canceled:true});assert.equal((await access.ensure({interactive:true})).status,'cancelled');assert.equal(f.saved,null);
 f.selected.push(f.pick(f.appDir,'app'),f.pick(f.accountDir,'account'));await access.ensure({interactive:true});f.saved.app.bookmark='expired';const before=structuredClone(f.saved);
 f.selected.push({canceled:true});assert.equal((await access.ensure({interactive:true})).status,'cancelled');assert.deepEqual(f.saved,before);
 assert.equal((await access.ensure()).status,'needs-authorization');
});
test('task-only or malformed grant cannot become account-client permission silently',async t=>{
 const f=await fixture(t);f.saved={directory:f.accountDir,bookmark:'task-bookmark',purpose:'codex-task-logs'};
 assert.equal((await f.make().ensure()).status,'needs-authorization');assert.equal(f.requests.length,0);
 await assert.rejects(f.make().directoryAccess.acquire('codex'),{code:'DIRECTORY_ACCESS_REQUIRED'});
});
test('unsupported diagnostic process does not fake scope or open picker',async t=>{
 const f=await fixture(t);delete f.app.startAccessingSecurityScopedResource;
 assert.equal((await f.make().ensure({interactive:true})).status,'unavailable');assert.equal(f.requests.length,0);
});
test('abort while native selection is pending cannot persist late grants; revoke removes only own grant',async t=>{
 const f=await fixture(t),access=f.make(),controller=new AbortController();
 f.selected.push(()=>{controller.abort();return f.pick(f.appDir,'app');});
 await assert.rejects(access.ensure({interactive:true,signal:controller.signal}),{code:'CANCELLED'});assert.equal(f.saved,null);
 f.selected.push(f.pick(f.appDir,'app'),f.pick(f.accountDir,'account'));await access.ensure({interactive:true});
 const lease=await access.installedAppAccess.acquire('codex');await access.revoke();assert.equal(f.saved,null);lease.release();
 assert.equal(f.events.filter(x=>x.startsWith('open:')).length,f.events.filter(x=>x.startsWith('stop:')).length);
});

test('ordinary Electron cannot claim native MAS authority even if API is present',async t=>{const f=await fixture(t);const access=createMasInstalledCodexAccess({app:f.app,dialog:f.dialog,storage:f.storage,mas:false});assert.equal((await access.ensure({interactive:true})).status,'unavailable');assert.equal(f.requests.length,0);assert.equal(f.events.length,0);});
