'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMasZcodeTaskNotifications}=require('../lib/mas-zcode-task-notifications');
const turn=event=>({version:1,sessionId:'test-session',turnId:'test-turn',event,
  phase:{UserPromptSubmit:'submitted',PreToolUse:'tool-started',Stop:'stop-observed'}[event],
  });
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,options={}){
 let account='a'.repeat(64),saved=null,callback,installCount=0,restoreCount=0,closedCount=0,terminal=null;
 const alerts=[],calls=[];
 const installer={ensure:async()=>({status:'stored'}),install:async()=>{installCount++;return{status:'installed',requiresNewSession:true};},
  restore:async()=>{restoreCount++;return{status:'installed'};},uninstall:async()=>calls.push('uninstall'),revoke:async()=>calls.push('revoke'),close(){},...options.installer};
 const storage={load:async()=>saved,save:async(_,value)=>{saved=structuredClone(value);},remove:async()=>{saved=null;},...options.storage};
 const {installer:ignoredInstaller,storage:ignoredStorage,...controllerOptions}=options;
 const port=createMasZcodeTaskNotifications({installer,storage,getAccountKey:()=>account,onAlert:e=>alerts.push(e),
  readTurnStatus:async input=>terminal?{...input,...terminal}:null,createBridge:({onEvent})=>{callback=onEvent;return{start:async input=>({endpoint:'http://127.0.0.1:43121/zcode/events',token:input?.token||'t'.repeat(43)}),close:async()=>{closedCount++;}};},...controllerOptions});
 t.after(()=>port.close());return{port,alerts,calls,emit:e=>callback(e),setAccount:v=>{account=v;},setTerminal:()=>{terminal={status:'completed',startedAt:0,completedAt:Date.now()};},get saved(){return saved;},get installCount(){return installCount;},get restoreCount(){return restoreCount;},get closedCount(){return closedCount;}};
}
test('source event is checked against current local account before processing and completion',async t=>{
 const verified=[];const f=fixture(t,{verifyAccount:async expected=>{verified.push(expected);return{accountKey:expected};}});
 assert.equal((await f.port.enable()).status,'ready');f.emit(turn('UserPromptSubmit'));await settle();
 assert.equal(f.port.getState().activeCount,1);f.setTerminal();f.emit(turn('Stop'));await settle();
 assert.deepEqual(f.alerts.map(e=>e.kind),['processing','completed']);assert.ok(verified.length>=2);
 assert.equal(f.port.getState().activeCount,0);assert(!JSON.stringify(f.port.getState()).includes('t'.repeat(43)));
});
test('disable during directory selection cannot install or briefly enable a stale request',async t=>{
 let release,selected;const selectedNow=new Promise(r=>selected=r);const f=fixture(t,{installer:{ensure:()=>{selected();return new Promise(r=>release=r);}}});
 const enabling=f.port.enable();await selectedNow;const disabling=f.port.disable();release({status:'stored'});
 assert.equal((await enabling).status,'cancelled');await disabling;assert.equal(f.installCount,0);assert.equal(f.port.getState().enabled,false);assert.equal(f.saved,null);
});
test('close during saved pairing load cannot resurrect enabled state',async t=>{
 let release;const f=fixture(t,{storage:{load:()=>new Promise(r=>release=r)}});const restoring=f.port.restore();await settle();f.port.close();
 release({version:1,accountKey:'a'.repeat(64),port:43121,endpoint:'http://127.0.0.1:43121/zcode/events',token:'t'.repeat(43)});
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
 let release;const saved={version:1,accountKey:'a'.repeat(64),port:43121,endpoint:'http://127.0.0.1:43121/zcode/events',token:'t'.repeat(43)};
 const f=fixture(t,{storage:{load:async()=>saved},installer:{restore:()=>new Promise(r=>release=r)}});
 const restoring=f.port.restore();await settle();assert.equal(f.closedCount,0);await f.port.close();assert.equal(f.closedCount,1);
 release({status:'installed'});await restoring;assert.equal(f.port.getState().enabled,false);
});
test('disable invalidates a precise terminal read already in flight',async t=>{
 let release;const f=fixture(t,{readTurnStatus:input=>new Promise(resolve=>{release=()=>resolve({...input,status:'completed',startedAt:0,completedAt:Date.now()});})});
 await f.port.enable();f.emit(turn('UserPromptSubmit'));await settle();assert.equal(f.port.getState().activeCount,1);
 await f.port.disable();release();await settle();assert.deepEqual(f.alerts.map(alert=>alert.kind),['processing']);assert.equal(f.port.getState().activeCount,0);
});
test('repeated enable and clean restart restore only pairing, with no old processing or completion replay',async t=>{
 const f=fixture(t);await f.port.enable();await f.port.enable();assert.equal(f.installCount,1);
 f.emit(turn('UserPromptSubmit'));await settle();const saved=structuredClone(f.saved);await f.port.close();
 const resumed=fixture(t,{storage:{load:async()=>saved}});await resumed.port.restore();
 assert.equal(resumed.restoreCount,1);assert.equal(resumed.installCount,0);assert.equal(resumed.port.getState().connected,true);
 resumed.setTerminal();resumed.emit(turn('Stop'));await settle();assert.equal(resumed.alerts.length,0);assert.equal(resumed.port.getState().activeCount,0);
 assert.equal(resumed.port.getState().accountAttributionVerified,false);assert.equal(resumed.port.getState().runningCount,null);
});
test('a fresh account mismatch while polling clears the old animation before accepting a terminal',async t=>{
 let fresh='a'.repeat(64);const f=fixture(t,{verifyAccount:async()=>fresh});await f.port.enable();f.emit(turn('UserPromptSubmit'));await settle();
 fresh='b'.repeat(64);f.setTerminal();await f.port.refresh();
 assert.equal(f.port.getState().status,'account-changed');assert.equal(f.port.getState().connected,false);assert.deepEqual(f.alerts.map(alert=>alert.kind),['processing']);
});
test('installed global source filter reaches the authenticated receiver, and Stop waits for exact SQLite terminal', {skip:process.platform!=='darwin'},async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
 const {DatabaseSync}=require('node:sqlite'),{createMasZcodeEventInstallation}=require('../lib/mas-zcode-event-installation');
 const {createMasZcodeTurnStatusReader}=require('../lib/mas-zcode-turn-status');
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-zcode-source-flow-')),root=path.join(temp,'.zcode'),config=path.join(root,'cli/config.json');
 fs.mkdirSync(path.join(root,'cli/db'),{recursive:true});const original='{"keep":900719925474099312345}\n';fs.writeFileSync(config,original);
 const db=new DatabaseSync(path.join(root,'cli/db/db.sqlite'));db.exec('CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER)');
 const grants=new Map(),pairs=new Map(),storage=map=>({load:async key=>map.get(key),save:async(key,value)=>{map.set(key,structuredClone(value));},remove:async key=>{map.delete(key);}});
 const installer=createMasZcodeEventInstallation({app:{startAccessingSecurityScopedResource:()=>()=>{}},dialog:{showOpenDialog:async()=>({filePaths:[root],bookmarks:['synthetic-bookmark']})},
   storage:storage(grants),mas:true,home:()=>temp,assetRoot:path.join(__dirname,'../assets/zcode-desktop-hook')});
 const readTurnStatus=createMasZcodeTurnStatusReader({directoryAccess:{withAccess:(_provider,run)=>run(root)}}),alerts=[];
 const port=createMasZcodeTaskNotifications({installer,storage:storage(pairs),getAccountKey:()=>'a'.repeat(64),readTurnStatus,onAlert:alert=>alerts.push(alert)});
 t.after(async()=>{await port.close();db.close();fs.rmSync(temp,{recursive:true,force:true});});
 assert.equal((await port.enable()).status,'ready');
 const command=JSON.parse(fs.readFileSync(config)).hooks.events.UserPromptSubmit[0].hooks[0].command;
 async function emit(hookEventName){return new Promise((resolve,reject)=>{
   const child=spawn('/bin/sh',['-c',command],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
   child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.on('error',reject);
   child.on('close',code=>{assert.deepEqual({code,stdout,stderr},{code:0,stdout:'',stderr:''});resolve();});
   child.stdin.end(JSON.stringify({hookEventName,sessionId:'sess_flow',turnId:'turn_flow',prompt:'SYNTHETIC_BODY_MUST_STAY_SOURCE_SIDE',last_assistant_message:'SYNTHETIC_REPLY_MUST_STAY_SOURCE_SIDE'}));
 });}
 const started=Date.now();await emit('UserPromptSubmit');await settle();assert.equal(port.getState().activeCount,1);
 await emit('Stop');await settle();await port.refresh();assert.deepEqual(alerts.map(alert=>alert.kind),['processing']);
 db.prepare('INSERT INTO turn_usage VALUES(?,?,?,?,?)').run('sess_flow','turn_flow','completed',started,Date.now());
 await port.refresh();assert.deepEqual(alerts.map(alert=>alert.kind),['processing','completed']);assert.equal(port.getState().activeCount,0);
 assert.equal(JSON.stringify(port.getState()).includes('MUST_STAY_SOURCE_SIDE'),false);
 await port.disable();assert.equal(fs.readFileSync(config,'utf8'),original);assert.equal(pairs.size,0);assert.equal(grants.size,0);
});
