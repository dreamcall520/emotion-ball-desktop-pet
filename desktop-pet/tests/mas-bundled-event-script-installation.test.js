"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sha=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const sources={workbuddy:{module:'mas-workbuddy-event-installation',factory:'createMasWorkBuddyEventInstallation',plugin:'qiuqiu-task-events',environment:'QIUQIU_METADATA_ROOT',setting:'settings.json'},
 zcode:{module:'mas-zcode-event-installation',factory:'createMasZcodeEventInstallation',plugin:'qiuqiu-zcode-task-events',environment:'ZCODE_PLUGIN_ROOT',setting:'cli/config.json'}};
function fixture(t,provider,{failSettings=false}={}){
 const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-bundled-events-')),spec=sources[provider],root=path.join(base,'.'+provider),owned=path.join(root,'.qiuqiu-animation-reminders');
 fs.mkdirSync(path.dirname(path.join(root,spec.setting)),{recursive:true});t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const sourceRoot=path.resolve(__dirname,'../assets',provider+'-desktop-hook'),writes=[];let grant=null,fail=false,pickers=0;
 const storage={load:async()=>grant,save:async(_id,v)=>{grant=v;},remove:async()=>{grant=null;}};
 const io=new Proxy(fs,{get(target,key){
  if(key==='writeFileSync')return(file,...args)=>{writes.push(String(file));assert.equal(String(file).endsWith('.sh'),false,'no external executable source write');assert.ok(!args[1]?.mode||(args[1].mode&0o111)===0,'no executable file modes');return fs.writeFileSync(file,...args);};
  if(key==='renameSync')return(from,to)=>{if(fail&&to===path.join(root,spec.setting)){fail=false;throw Object.assign(Error('synthetic final JSON commit failure'),{code:'EIO'});}return fs.renameSync(from,to);};
  return target[key];
 }});
 function create(assetRoot=sourceRoot){return require('../lib/'+spec.module)[spec.factory]({app:{startAccessingSecurityScopedResource:()=>()=>{}},dialog:{showOpenDialog:async()=>{pickers++;return{filePaths:[root],bookmarks:['synthetic-bookmark']};}},storage,assetRoot,mas:true,home:()=>base,io});}
 const receiver={endpoint:`http://127.0.0.1:45678/${provider}/events`,token:'synthetic_local_capability_not_real_0123456789'},settings=path.join(root,spec.setting),script=path.join(owned,'scripts/emit-metadata.sh'),manifest=path.join(owned,'installation.json');
 function copyAssets(name){const dest=path.join(base,name,provider+'-desktop-hook');fs.cpSync(sourceRoot,dest,{recursive:true});return dest;}
 function read(){return JSON.parse(fs.readFileSync(settings));}
 function events(value){return provider==='zcode'?value.hooks.events:value.hooks;}
 function seedLegacy(){
  const bytes=fs.readFileSync(path.join(sourceRoot,'plugins',spec.plugin,'scripts/emit-metadata.sh')),hookSource=JSON.parse(fs.readFileSync(path.join(sourceRoot,'plugins',spec.plugin,'hooks/hooks.json'))).hooks,eventNames=Object.keys(hookSource);
  const command=['/usr/bin/env',quote(spec.environment+'='+owned),'/bin/sh',quote(script)].join(' '),entry={hooks:[{type:'command',command,timeout:2}]};
  const eventRows=Object.fromEntries(eventNames.map(event=>[event,[entry]]));eventRows.Stop.unshift({hooks:[{type:'command',command:'echo preserve user'}]});
  const value={keep:'original',hooks:provider==='zcode'?{enabled:true,events:eventRows}:eventRows};fs.writeFileSync(settings,JSON.stringify(value)+'\n');
  fs.mkdirSync(path.dirname(script),{recursive:true});fs.writeFileSync(script,bytes,{mode:0o700});const pairing=Buffer.from(JSON.stringify({version:1,enabled:true,...receiver})+'\n');fs.writeFileSync(path.join(owned,'receiver.json'),pairing,{mode:0o600});
  const record={kind:`qiuqiu-${provider}-animation-reminders-v1`,version:1,command,events:eventNames,scriptSha256:sha(bytes),receiverSha256:sha(pairing),hooksOriginallyAbsent:false,originalEventKeys:['Stop']};
  if(provider==='zcode')Object.assign(record,{eventsOriginallyAbsent:false,enabledOriginallyAbsent:false,settingsOriginallyAbsent:false,originalEnabled:true});
  fs.writeFileSync(manifest,JSON.stringify(record)+'\n');return{bytes,record,settings:fs.readFileSync(settings),manifest:fs.readFileSync(manifest)};
 }
 return{base,spec,sourceRoot,root,owned,storage,create,copyAssets,receiver,settings,script,manifest,read,events,writes,seedLegacy,setFail(){fail=failSettings;},get pickers(){return pickers;}};
}
for(const provider of Object.keys(sources)){
 test(`${provider}: external registration writes only JSON and runs the current bundled filter`,async t=>{
  const f=fixture(t,provider),installer=f.create();await installer.ensure({interactive:true});await installer.install({receiver:f.receiver});
  assert.equal(fs.existsSync(f.script),false);assert.deepEqual(fs.readdirSync(f.owned).sort(),['installation.json','receiver.json']);
  const record=JSON.parse(fs.readFileSync(f.manifest));assert.equal(record.version,2);assert.equal(record.scriptPath,path.join(f.sourceRoot,'plugins',f.spec.plugin,'scripts/emit-metadata.sh'));assert.ok(record.command.includes(quote(record.scriptPath)));assert.equal(record.command.includes(quote(f.script)),false);
  const input=provider==='zcode'?{sessionId:'safe_session',turnId:'safe_turn',hookEventName:'Stop',prompt:'private never forward'}:{session_id:'safe_session',generation_id:'safe_turn',hook_event_name:'FinalStop',final_stop_reason:'completed',prompt:'private never forward'};
  const output=execFileSync('/bin/sh',['-c',record.command],{input:JSON.stringify(input),env:{...process.env,QIUQIU_HOOK_DRY_RUN:'1'},encoding:'utf8'});assert.ok(!output.includes('private'));assert.equal(JSON.parse(output).sessionId,'safe_session');
  for(let i=0;i<2;i++){await installer.ensure({interactive:true});await installer.install({receiver:f.receiver});await installer.restore({receiver:f.receiver});}
  assert.equal(f.pickers,1);assert.equal(f.events(f.read()).UserPromptSubmit.length,1);assert.ok(f.writes.every(file=>file.includes('.json')));
 });
 test(`${provider}: existing v1 registration migrates without copying code and preserves unrelated hooks`,async t=>{
  const f=fixture(t,provider),legacy=f.seedLegacy(),installer=f.create();await installer.ensure({interactive:true});
  assert.equal((await installer.restore({receiver:f.receiver})).status,'installed');const record=JSON.parse(fs.readFileSync(f.manifest));assert.equal(record.version,2);assert.notEqual(record.command,legacy.record.command);assert.equal(fs.existsSync(f.script),false);
  assert.equal(f.events(f.read()).Stop[0].hooks[0].command,'echo preserve user');assert.ok(!JSON.stringify(f.read()).includes(legacy.record.command));
  await installer.uninstall();await installer.revoke();assert.equal(f.pickers,1);assert.equal(f.events(f.read()).Stop[0].hooks[0].command,'echo preserve user');
 });
 test(`${provider}: failed migration rolls back only JSON and never rewrites or removes the legacy program`,async t=>{
  const f=fixture(t,provider,{failSettings:true}),legacy=f.seedLegacy(),installer=f.create();await installer.ensure({interactive:true});f.setFail();
  await assert.rejects(installer.restore({receiver:f.receiver}));assert.deepEqual(fs.readFileSync(f.settings),legacy.settings);assert.deepEqual(fs.readFileSync(f.manifest),legacy.manifest);assert.deepEqual(fs.readFileSync(f.script),legacy.bytes);
 });
 test(`${provider}: modified legacy code blocks migration but uninstall preserves it and removes only our command`,async t=>{
  const f=fixture(t,provider),legacy=f.seedLegacy(),installer=f.create();fs.appendFileSync(f.script,'\n# user-owned addition\n');const changed=fs.readFileSync(f.script);await installer.ensure({interactive:true});
  const restored=await installer.restore({receiver:f.receiver});assert.equal(restored.status,'not-installed');assert.deepEqual(fs.readFileSync(f.settings),legacy.settings);assert.deepEqual(fs.readFileSync(f.script),changed);
  const removed=await installer.uninstall();assert.equal(removed.retainedModifiedFiles,true);assert.deepEqual(fs.readFileSync(f.script),changed);assert.equal(f.events(f.read()).Stop[0].hooks[0].command,'echo preserve user');
 });
 test(`${provider}: moved App resources are rebound by saved owned command, without reading the old bundle`,async t=>{
  const f=fixture(t,provider),first=f.copyAssets('First.app/Contents/Resources'),installer=f.create(first);await installer.ensure({interactive:true});await installer.install({receiver:f.receiver});const old=JSON.parse(fs.readFileSync(f.manifest));
  const next=f.copyAssets('Moved.app/Contents/Resources');fs.rmSync(path.join(f.base,'First.app'),{recursive:true,force:true});const moved=f.create(next);assert.equal((await moved.ensure()).status,'stored');
  assert.equal((await moved.restore({receiver:f.receiver})).status,'installed');const now=JSON.parse(fs.readFileSync(f.manifest));assert.notEqual(now.command,old.command);assert.ok(now.scriptPath.startsWith(next));
  assert.equal(f.events(f.read()).UserPromptSubmit.length,1);assert.ok(!JSON.stringify(f.read()).includes(old.command));assert.equal(f.pickers,1);await moved.uninstall();assert.equal(fs.existsSync(f.owned),false);
 });
 test(`${provider}: a modified hook row is not overwritten during migration or App movement`,async t=>{
  const f=fixture(t,provider),legacy=f.seedLegacy(),installer=f.create();const settings=f.read();f.events(settings).UserPromptSubmit[0].matcher='user choice';fs.writeFileSync(f.settings,JSON.stringify(settings));const before=fs.readFileSync(f.settings);await installer.ensure({interactive:true});
  assert.equal((await installer.restore({receiver:f.receiver})).status,'not-installed');await assert.rejects(installer.install({receiver:f.receiver}),{code:'INSTALL_CONFLICT'});assert.deepEqual(fs.readFileSync(f.settings),before);assert.deepEqual(fs.readFileSync(f.script),legacy.bytes);
 });
 test(`${provider}: ASAR commands resolve to the physical signed filter and reject a symlinked unpack root`,async t=>{
  const f=fixture(t,provider),virtual=f.copyAssets('Signed.app/Contents/Resources/app.asar/desktop-pet/assets'),physical=f.copyAssets('Signed.app/Contents/Resources/app.asar.unpacked/desktop-pet/assets'),installer=f.create(virtual);
  await installer.ensure({interactive:true});await installer.install({receiver:f.receiver});const record=JSON.parse(fs.readFileSync(f.manifest));assert.equal(record.scriptPath,path.join(physical,'plugins',f.spec.plugin,'scripts/emit-metadata.sh'));
  await installer.uninstall();const unpack=path.join(f.base,'Signed.app/Contents/Resources/app.asar.unpacked'),outside=path.join(f.base,'outside-unpacked');fs.renameSync(unpack,outside);fs.symlinkSync(outside,unpack);
  const before=fs.existsSync(f.settings)?fs.readFileSync(f.settings):null;await assert.rejects(installer.install({receiver:f.receiver}),{code:'INSTALL_CONFLICT'});assert.deepEqual(fs.existsSync(f.settings)?fs.readFileSync(f.settings):null,before);assert.equal(fs.existsSync(f.manifest),false);
 });
 test(`${provider}: mismatched physical ASAR bytes and script symlinks fail before configuration changes`,async t=>{
  const f=fixture(t,provider),virtual=f.copyAssets('Signed.app/Contents/Resources/app.asar/desktop-pet/assets'),physical=f.copyAssets('Signed.app/Contents/Resources/app.asar.unpacked/desktop-pet/assets'),installer=f.create(virtual);
  await installer.ensure({interactive:true});const script=path.join(physical,'plugins',f.spec.plugin,'scripts/emit-metadata.sh');fs.appendFileSync(script,'\n# unexpected extra code\n');
  await assert.rejects(installer.install({receiver:f.receiver}),{code:'INSTALL_CONFLICT'});assert.equal(fs.existsSync(f.settings),false);assert.equal(fs.existsSync(f.owned),false);
  fs.unlinkSync(script);fs.symlinkSync(path.join(virtual,'plugins',f.spec.plugin,'scripts/emit-metadata.sh'),script);await assert.rejects(installer.install({receiver:f.receiver}),{code:'INSTALL_CONFLICT'});assert.equal(fs.existsSync(f.settings),false);
 });
 test(`${provider}: unknown or malformed manifest paths never trigger arbitrary reads or writes`,async t=>{
  const f=fixture(t,provider),installer=f.create();await installer.ensure({interactive:true});await installer.install({receiver:f.receiver});const manifest=JSON.parse(fs.readFileSync(f.manifest));manifest.scriptPath='/tmp/not-our-program';fs.writeFileSync(f.manifest,JSON.stringify(manifest));const before=fs.readFileSync(f.settings);
  await assert.rejects(installer.restore({receiver:f.receiver}),{code:'INSTALL_CONFLICT'});assert.deepEqual(fs.readFileSync(f.settings),before);
 });
}
