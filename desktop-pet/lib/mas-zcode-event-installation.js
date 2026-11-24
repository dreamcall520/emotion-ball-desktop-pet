'use strict';

const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {resolveBundledEventScript}=require('./mas-bundled-event-script');
const PURPOSE='zcode-animation-hook-install-v1',KIND='qiuqiu-zcode-animation-reminders-v1';
const EVENTS=new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Stop']);
const fail=code=>Object.assign(new Error(code),{code});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const stable=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

// Replace only the top-level hooks value. Preserve every unrelated raw byte,
// including account configuration, whitespace and integers outside JS precision.
function patchHooks(bytes,hooks){
 const text=bytes?.toString('utf8')||'{}';let at=0;const props=[];
 const white=()=>{while(/\s/.test(text[at]||'!'))at++;};
 function string(){const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}throw fail('UNSUPPORTED_SETTINGS');}
 function value(){if(text[at]==='"'){string();return;}if(text[at]==='{'||text[at]==='['){const end=text[at++]==='{'?'}':']';while(at<text.length){if(text[at]==='"')string();else if(text[at]===end){at++;return;}else if(text[at]==='{'||text[at]==='[')value();else at++;}throw fail('UNSUPPORTED_SETTINGS');}while(at<text.length&&!/[,}\]\s]/.test(text[at]))at++;}
 white();if(text[at++]!=='{')throw fail('UNSUPPORTED_SETTINGS');white();
 const keys=new Set();while(text[at]!=='}'){const start=at,key=string();if(keys.has(key))throw fail('UNSUPPORTED_SETTINGS');keys.add(key);white();if(text[at++]!==':')throw fail('UNSUPPORTED_SETTINGS');white();const valueStart=at;value();const valueEnd=at;white();const end=at;props.push({key,start,valueStart,valueEnd,end});if(text[at]!==',')break;at++;white();}
 if(text[at]!=='}')throw fail('UNSUPPORTED_SETTINGS');const close=at,found=props.find(prop=>prop.key==='hooks');
 if(found){
  if(hooks!==undefined)return Buffer.from(text.slice(0,found.valueStart)+JSON.stringify(hooks,null,2)+text.slice(found.valueEnd));
  const index=props.indexOf(found),start=index?props[index-1].end:found.start,end=index?found.end:index+1<props.length?props[index+1].start:found.end;
  return Buffer.from(text.slice(0,start)+text.slice(end));
 }
 if(hooks===undefined)return bytes||Buffer.from('{}');
 return Buffer.from(text.slice(0,close)+(props.length?',':'')+'"hooks":'+JSON.stringify(hooks,null,2)+text.slice(close));
}

// This is a separate installation purpose. Read-only task-cache grants cannot
// authorize its writes. External changes are JSON configuration and pairing
// only. The fixed source-side filter remains inside the signed App bundle.
function createMasZcodeEventInstallation({app,dialog,storage,assetRoot,mas=process.mas===true,
 home=()=>process.mas===true?os.userInfo().homedir:app.getPath('home'),io=fs}={}){
 if(!app||!dialog||!storage||!path.isAbsolute(assetRoot||''))throw new TypeError('app, dialog, dedicated storage and assetRoot required');
 const supported=mas===true&&typeof app.startAccessingSecurityScopedResource==='function';
 let pending=Promise.resolve(),epoch=0,selectionEpoch=0,closed=false;
 let state={authorized:false,installed:false,status:'idle',requiresNewSession:true,eventVerified:false};
 const getState=()=>({...state});
 function queue(operation){const current=pending.catch(()=>{}).then(operation);pending=current.then(()=>{},()=>{});return current;}
 function check(signal,owner){if(closed||signal?.aborted||owner!==epoch)throw fail('CANCELLED');}
 const valid=grant=>grant?.purpose===PURPOSE&&typeof grant.directory==='string'&&path.isAbsolute(grant.directory)&&
  !grant.directory.includes('\0')&&path.basename(grant.directory)==='.zcode'&&typeof grant.bookmark==='string'&&grant.bookmark.length>0;
 async function lease(grant){
  if(!supported||closed||!valid(grant))throw fail('DIRECTORY_ACCESS_REQUIRED');
  const owner=epoch;let stop;
  try{stop=app.startAccessingSecurityScopedResource(grant.bookmark);}catch{throw fail('DIRECTORY_ACCESS_REQUIRED');}
  if(typeof stop!=='function')throw fail('DIRECTORY_ACCESS_REQUIRED');let released=false;
  const release=()=>{if(!released){released=true;try{stop();}catch{}}};
  try{const stat=io.lstatSync(grant.directory);if(!stat.isDirectory()||stat.isSymbolicLink()||io.realpathSync(grant.directory)!==path.resolve(grant.directory))throw fail('DIRECTORY_ACCESS_REQUIRED');check(null,owner);}
  catch(error){release();throw fail(error.code==='CANCELLED'?'CANCELLED':'DIRECTORY_ACCESS_REQUIRED');}
  return{directory:grant.directory,release};
 }
 function safe(root,file){
  const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw fail('UNSAFE_PATH');
  let current=root;for(const part of ['',...relative.split(path.sep).filter(Boolean)]){
   if(part)current=path.join(current,part);
   try{const stat=io.lstatSync(current);if(stat.isSymbolicLink()||(current!==file&&!stat.isDirectory()))throw fail('UNSAFE_PATH');}
   catch(error){if(error.code==='ENOENT')return;throw error;}
  }
 }
 function snapshot(root,file,max=2*1024*1024){
  safe(root,file);let fd;
  try{fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=io.fstatSync(fd);if(!stat.isFile()||stat.size>max)throw fail('UNSUPPORTED_SETTINGS');return{bytes:io.readFileSync(fd),mode:stat.mode&0o777};}
  catch(error){if(error.code==='ENOENT')return{bytes:null,mode:0o600};throw error;}
  finally{if(fd!==undefined)io.closeSync(fd);}
 }
 function json(bytes){try{const value=JSON.parse(bytes?.toString('utf8')||'{}');if(!object(value))throw Error();return value;}catch{throw fail('UNSUPPORTED_SETTINGS');}}
 function mkdir(root,directory){safe(root,directory);io.mkdirSync(directory,{recursive:true,mode:0o700});safe(root,directory);}
 function atomic(root,file,bytes,mode){
  safe(root,file);if(bytes===null){io.unlinkSync(file);return;}
  mkdir(root,path.dirname(file));const temporary=file+'.qiuqiu-'+randomUUID()+'.tmp';
  try{io.writeFileSync(temporary,bytes,{mode,flag:'wx'});io.renameSync(temporary,file);}
  finally{try{io.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 function locations(root){const own=path.join(root,'.qiuqiu-animation-reminders');return{root,own,settings:path.join(root,'cli/config.json'),script:path.join(own,'scripts/emit-metadata.sh'),receiver:path.join(own,'receiver.json'),manifest:path.join(own,'installation.json'),backups:path.join(root,'.qiuqiu-animation-backups')};}
 function receiverBytes(raw){
  let address;try{address=new URL(raw?.endpoint);}catch{throw fail('INVALID_RECEIVER');}
  if(address.protocol!=='http:'||address.hostname!=='127.0.0.1'||address.pathname!=='/zcode/events'||address.username||address.password||address.search||address.hash||Number(address.port)<1024||Number(address.port)>65535||
   typeof raw.token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(raw.token))throw fail('INVALID_RECEIVER');
  return Buffer.from(JSON.stringify({version:1,enabled:true,endpoint:address.href,token:raw.token})+'\n');
 }
 function commandFor(loc,script=loc.script){return ['/usr/bin/env',quote('ZCODE_PLUGIN_ROOT='+loc.own),'/bin/sh',quote(script)].join(' ');}
 function entryFor(command){return{hooks:[{type:'command',command,timeout:2}]};}
 function hasCommand(entry,command){return object(entry)&&Array.isArray(entry.hooks)&&entry.hooks.some(hook=>hook?.command===command);}
 function settingsSnapshot(loc){const snap=snapshot(loc.root,loc.settings),value=json(snap.bytes);if(value.hooks!==undefined&&(!object(value.hooks)||value.hooks.events!==undefined&&!object(value.hooks.events)||value.hooks.enabled!==undefined&&typeof value.hooks.enabled!=='boolean'))throw fail('UNSUPPORTED_SETTINGS');patchHooks(snap.bytes,value.hooks);return{...snap,value};}
 function hooksAllowed(settings){if(settings.value.disableAllHooks===true||settings.value.allowManagedHooksOnly===true)throw fail('HOOKS_DISABLED_BY_POLICY');}
 function manifestSnapshot(loc){const snap=snapshot(loc.root,loc.manifest,32768);if(!snap.bytes)return{...snap,value:null};const value=json(snap.bytes);
  if(value.kind!==KIND||![1,2].includes(value.version)||value.version===2&&(typeof value.scriptPath!=='string'||!path.isAbsolute(value.scriptPath)||path.resolve(value.scriptPath)!==value.scriptPath||value.scriptPath.length>8192||/[\r\n\0]/.test(value.scriptPath)||!value.scriptPath.endsWith('/plugins/qiuqiu-zcode-task-events/scripts/emit-metadata.sh'))||value.command!==commandFor(loc,value.version===2?value.scriptPath:loc.script)||value.legacyScriptSha256!==undefined&&!/^[a-f0-9]{64}$/.test(value.legacyScriptSha256)||!Array.isArray(value.events)||!value.events.length||value.events.some(event=>!EVENTS.has(event))||!Array.isArray(value.originalEventKeys)||typeof value.hooksOriginallyAbsent!=='boolean'||typeof value.eventsOriginallyAbsent!=='boolean'||typeof value.enabledOriginallyAbsent!=='boolean'||typeof value.settingsOriginallyAbsent!=='boolean'||value.originalEnabled!==null&&typeof value.originalEnabled!=='boolean'||
   !/^[a-f0-9]{64}$/.test(value.scriptSha256||'')||!/^[a-f0-9]{64}$/.test(value.receiverSha256||''))throw fail('INSTALL_CONFLICT');return{...snap,value};
 }
 function assets(){
  const base=path.join(assetRoot,'plugins/qiuqiu-zcode-task-events'),script=snapshot(assetRoot,path.join(base,'scripts/emit-metadata.sh'),256*1024),hooks=json(snapshot(assetRoot,path.join(base,'hooks/hooks.json'),32768).bytes).hooks;
  if(!script.bytes||!object(hooks))throw fail('INSTALL_CONFLICT');const events=Object.keys(hooks);
  if(!events.includes('UserPromptSubmit')||!events.includes('Stop')||events.some(event=>!EVENTS.has(event)||!Array.isArray(hooks[event])))throw fail('INSTALL_CONFLICT');
  const bundled=resolveBundledEventScript({assetRoot,pluginName:'qiuqiu-zcode-task-events',io});
  if(!bundled.bytes.equals(script.bytes))throw fail('INSTALL_CONFLICT');
  return{script:bundled.bytes,scriptPath:bundled.path,events};
 }
 function backupSettings(loc,before){if(!before)return;mkdir(loc.root,loc.backups);const file=path.join(loc.backups,'config-before-'+randomUUID()+'.json');io.writeFileSync(file,before,{mode:0o600,flag:'wx'});}
 function transact(loc,changes,signal,owner){
  const changed=changes.filter(change=>!equal(change.before.bytes,change.after));if(!changed.length)return;
  for(const change of changed){safe(loc.root,change.file);if(!equal(snapshot(loc.root,change.file).bytes,change.before.bytes))throw fail('CONCURRENT_MODIFICATION');}
  const settings=changed.find(change=>change.file===loc.settings);if(settings?.before.bytes)backupSettings(loc,settings.before.bytes);
  const committed=[];
  try{for(const change of changed){check(signal,owner);if(!equal(snapshot(loc.root,change.file).bytes,change.before.bytes))throw fail('CONCURRENT_MODIFICATION');atomic(loc.root,change.file,change.after,change.mode||change.before.mode||0o600);committed.push(change);}check(signal,owner);}
  catch(error){let incomplete=false;for(const change of committed.reverse()){
   try{if(!equal(snapshot(loc.root,change.file).bytes,change.after)){incomplete=true;continue;}atomic(loc.root,change.file,change.before.bytes,change.before.mode||0o600);}catch{incomplete=true;}
  }if(incomplete)throw fail('ROLLBACK_INCOMPLETE');throw error;}
 }
 function intact(loc,manifest,settings){
  if(!manifest.value)return false;const value=manifest.value,receiver=snapshot(loc.root,loc.receiver,8192),entry=entryFor(value.command);
  if(value.version===1){const script=snapshot(loc.root,loc.script,256*1024);if(!script.bytes||digest(script.bytes)!==value.scriptSha256)return false;}
  if(!receiver.bytes||digest(receiver.bytes)!==value.receiverSha256)return false;
  return settings.value.hooks?.enabled===true&&value.events.every(event=>Array.isArray(settings.value.hooks?.events?.[event])&&settings.value.hooks.events[event].filter(row=>stable(row)===stable(entry)).length===1);
 }
 async function operation(signal,run){
  const owner=epoch;check(signal,owner);const grant=await storage.load('zcode');check(signal,owner);const scope=await lease(grant);
  try{check(signal,owner);return run(locations(scope.directory),owner);}finally{scope.release();}
 }
 function ensure({interactive=false,signal}={}){const selection=selectionEpoch;return queue(async()=>{
  const owner=epoch;const current=()=>{check(signal,owner);if(selection!==selectionEpoch)throw fail('CANCELLED');};current();if(!supported)return{status:'unavailable'};
  const before=await storage.load('zcode');current();try{const scope=await lease(before);scope.release();current();state.authorized=true;return{status:'stored'};}catch(error){if(error.code==='CANCELLED')throw error;}
  state.authorized=false;if(!interactive)return{status:'needs-authorization'};
  const picked=await dialog.showOpenDialog({title:'允许安装 ZCode 动画提醒',buttonLabel:'允许安装提醒',defaultPath:path.join(home(),'.zcode'),
   properties:['openDirectory','showHiddenFiles'],securityScopedBookmarks:true});current();
  if(picked?.canceled)return{status:'cancelled'};
  if(picked?.filePaths?.length!==1||picked?.bookmarks?.length!==1)throw fail('DIRECTORY_ACCESS_REQUIRED');
  const grant={purpose:PURPOSE,directory:picked.filePaths[0],bookmark:picked.bookmarks[0]};try{const scope=await lease(grant);scope.release();}catch(error){if(error.code==='CANCELLED')throw error;return{status:'invalid-directory'};}current();
  await storage.save('zcode',grant);try{current();}catch(error){if(before)await storage.save('zcode',before);else await storage.remove('zcode');throw error;}
  epoch++;state.authorized=true;return{status:'stored'};
 });}
 function cleanupLegacy(loc,record){
  // Run only after JSON commits. A rollback must never write a legacy program.
  try{const before=snapshot(loc.root,loc.script,256*1024);if(!before.bytes)return false;
   const expected=record.version===1?record.scriptSha256:record.legacyScriptSha256;
   if(!expected||digest(before.bytes)!==expected)return true;safe(loc.root,loc.script);io.unlinkSync(loc.script);
   try{io.rmdirSync(path.dirname(loc.script));}catch{}return false;
  }catch{return true;}
 }
 function register(loc,owner,{source,settings,manifest,receiver,signal}){
  const command=commandFor(loc,source.scriptPath),entry=entryFor(command),next=structuredClone(settings.value);
  const previousHooks=settings.value.hooks||{},previousEvents=previousHooks.events||{};
  if(previousHooks.enabled!==true&&Object.values(previousEvents).some(rows=>!Array.isArray(rows)||rows.length))throw fail('HOOKS_DISABLED_BY_POLICY');
  next.hooks=next.hooks||{};next.hooks.events=next.hooks.events||{};next.hooks.enabled=true;
  const events=next.hooks.events;
  if(manifest.value&&manifest.value.command!==command){const previous=entryFor(manifest.value.command);
   for(const event of manifest.value.events){events[event]=events[event].filter(row=>stable(row)!==stable(previous));if(!events[event].length&&!manifest.value.originalEventKeys.includes(event)&&!source.events.includes(event))delete events[event];}
  }
  for(const event of source.events){const rows=events[event]??[];if(!Array.isArray(rows))throw fail('UNSUPPORTED_SETTINGS');const own=rows.filter(row=>hasCommand(row,command));if(own.some(row=>stable(row)!==stable(entry))||own.length>1||(!manifest.value&&own.length)||manifest.value&&manifest.value.command!==command&&own.length)throw fail('INSTALL_CONFLICT');events[event]=own.length?rows:[...rows,entry];}
  const privateReceiver=receiverBytes(receiver),record={kind:KIND,version:2,command,events:source.events,scriptPath:source.scriptPath,scriptSha256:digest(source.script),receiverSha256:digest(privateReceiver),hooksOriginallyAbsent:manifest.value?.hooksOriginallyAbsent??settings.value.hooks===undefined,eventsOriginallyAbsent:manifest.value?.eventsOriginallyAbsent??previousHooks.events===undefined,enabledOriginallyAbsent:manifest.value?.enabledOriginallyAbsent??previousHooks.enabled===undefined,originalEnabled:manifest.value?manifest.value.originalEnabled:previousHooks.enabled??null,settingsOriginallyAbsent:manifest.value?.settingsOriginallyAbsent??settings.bytes===null,originalEventKeys:manifest.value?.originalEventKeys||Object.keys(previousEvents)};
  const legacy=manifest.value?.version===1?manifest.value.scriptSha256:manifest.value?.legacyScriptSha256;if(legacy)record.legacyScriptSha256=legacy;
  const nextSettings=stable(settings.value.hooks)===stable(next.hooks)?settings.bytes:patchHooks(settings.bytes,next.hooks);
  transact(loc,[{file:loc.receiver,before:snapshot(loc.root,loc.receiver),after:privateReceiver,mode:0o600},{file:loc.manifest,before:manifest,after:Buffer.from(JSON.stringify(record)+'\n'),mode:0o600},{file:loc.settings,before:settings,after:nextSettings}],signal,owner);
  const retainedModifiedFiles=cleanupLegacy(loc,record);
  state={...state,authorized:true,installed:true,status:'installed'};return{status:'installed',requiresNewSession:true,retainedModifiedFiles};
 }
 function install({receiver,signal}={}){return queue(()=>operation(signal,(loc,owner)=>{
  const source=assets(),settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc);hooksAllowed(settings);
  if(manifest.value&&!intact(loc,manifest,settings))throw fail('INSTALL_CONFLICT');
  if(!manifest.value&&(snapshot(loc.root,loc.script).bytes||snapshot(loc.root,loc.receiver).bytes))throw fail('INSTALL_CONFLICT');
  return register(loc,owner,{source,settings,manifest,receiver,signal});
 }));}
 function restore({receiver,signal}={}){return queue(()=>operation(signal,(loc,owner)=>{
  const settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc);hooksAllowed(settings);if(!intact(loc,manifest,settings)){state.installed=false;return{status:'not-installed'};}
  return register(loc,owner,{source:assets(),settings,manifest,receiver,signal});
 }));}
 function uninstall({signal}={}){return queue(async()=>{
  const current=epoch;check(signal,current);
  // No installation grant means no source operation was authorized. Repeated
  // disable must be harmless; a present but expired grant still fails closed.
  const grant=await storage.load('zcode');check(signal,current);
  if(grant===null||grant===undefined){state={...state,authorized:false,installed:false,status:'uninstalled'};return{status:'uninstalled'};}
  return operation(signal,(loc,owner)=>{
  const settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc);if(!manifest.value){state.installed=false;return{status:'uninstalled'};}
  const record=manifest.value,next=structuredClone(settings.value);let retainedModifiedFiles=false;
  for(const event of record.events){const rows=next.hooks?.events?.[event];if(rows===undefined)continue;if(!Array.isArray(rows))throw fail('UNSUPPORTED_SETTINGS');
   next.hooks.events[event]=rows.flatMap(row=>{if(!object(row)||!Array.isArray(row.hooks))return[row];const hooks=row.hooks.filter(hook=>!(hook?.type==='command'&&hook.command===record.command));return hooks.length===row.hooks.length?[row]:hooks.length?[{...row,hooks}]:[];});
   if(!next.hooks.events[event].length&&!record.originalEventKeys.includes(event))delete next.hooks.events[event];}
  const hasOtherHooks=Object.values(next.hooks?.events||{}).some(rows=>Array.isArray(rows)&&rows.length);
  if(next.hooks?.enabled===true&&!hasOtherHooks){if(record.enabledOriginallyAbsent)delete next.hooks.enabled;else next.hooks.enabled=record.originalEnabled;}
  if(record.eventsOriginallyAbsent&&next.hooks?.events&&!Object.keys(next.hooks.events).length)delete next.hooks.events;
  if(record.hooksOriginallyAbsent&&next.hooks&&!Object.keys(next.hooks).length)delete next.hooks;
  const nextSettings=record.settingsOriginallyAbsent&&!Object.keys(next).length?null:patchHooks(settings.bytes,next.hooks);
  const changes=[{file:loc.settings,before:settings,after:nextSettings}];
  for(const [file,expected]of [[loc.receiver,record.receiverSha256]]){const before=snapshot(loc.root,file);if(before.bytes&&digest(before.bytes)===expected)changes.push({file,before,after:null});else if(before.bytes)retainedModifiedFiles=true;}
  changes.push({file:loc.manifest,before:manifest,after:null});transact(loc,changes,signal,owner);
  retainedModifiedFiles=cleanupLegacy(loc,record)||retainedModifiedFiles;
  for(const directory of [path.dirname(loc.script),loc.own])try{io.rmdirSync(directory);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;}
  state={...state,installed:false,status:'uninstalled'};return{status:'uninstalled',retainedModifiedFiles};
  });
 });}
 return{ensure,install,restore,uninstall,getState,
  revoke(){epoch++;selectionEpoch++;return queue(async()=>{await storage.remove('zcode');state.authorized=false;return{status:'needs-authorization'};});},
  close(){closed=true;epoch++;selectionEpoch++;},clearPending(){selectionEpoch++;}
 };
}
module.exports={createMasZcodeEventInstallation};
