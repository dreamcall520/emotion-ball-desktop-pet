'use strict';

const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const PURPOSE='workbuddy-animation-hook-install-v1',KIND='qiuqiu-workbuddy-animation-reminders-v1';
const EVENTS=new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied','Stop','StopFailure','FinalStop','SessionEnd']);
const fail=code=>Object.assign(new Error(code),{code});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const stable=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

// This is a separate installation purpose. Read-only task-cache grants cannot
// authorize its writes. It only changes our standard global command-hook rows;
// no marketplace, installed-plugin registry, vendor executable or account file.
function createMasWorkBuddyEventInstallation({app,dialog,storage,assetRoot,mas=process.mas===true,
 home=()=>process.mas===true?os.userInfo().homedir:app.getPath('home'),io=fs}={}){
 if(!app||!dialog||!storage||!path.isAbsolute(assetRoot||''))throw new TypeError('app, dialog, dedicated storage and assetRoot required');
 const supported=mas===true&&typeof app.startAccessingSecurityScopedResource==='function';
 let pending=Promise.resolve(),epoch=0,selectionEpoch=0,closed=false;
 let state={authorized:false,installed:false,status:'idle',requiresNewSession:true,eventVerified:false};
 const getState=()=>({...state});
 function queue(operation){const current=pending.catch(()=>{}).then(operation);pending=current.then(()=>{},()=>{});return current;}
 function check(signal,owner){if(closed||signal?.aborted||owner!==epoch)throw fail('CANCELLED');}
 const valid=grant=>grant?.purpose===PURPOSE&&typeof grant.directory==='string'&&path.isAbsolute(grant.directory)&&
  !grant.directory.includes('\0')&&path.basename(grant.directory)==='.workbuddy'&&typeof grant.bookmark==='string'&&grant.bookmark.length>0;
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
 function locations(root){const own=path.join(root,'.qiuqiu-animation-reminders');return{root,own,settings:path.join(root,'settings.json'),script:path.join(own,'scripts/emit-metadata.sh'),receiver:path.join(own,'receiver.json'),manifest:path.join(own,'installation.json'),backups:path.join(root,'.qiuqiu-animation-backups')};}
 function receiverBytes(raw){
  let address;try{address=new URL(raw?.endpoint);}catch{throw fail('INVALID_RECEIVER');}
  if(address.protocol!=='http:'||address.hostname!=='127.0.0.1'||address.pathname!=='/workbuddy/events'||address.username||address.password||address.search||address.hash||Number(address.port)<1024||Number(address.port)>65535||
   typeof raw.token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(raw.token))throw fail('INVALID_RECEIVER');
  return Buffer.from(JSON.stringify({version:1,enabled:true,endpoint:address.href,token:raw.token})+'\n');
 }
 function commandFor(loc){return ['/usr/bin/env',quote('QIUQIU_METADATA_ROOT='+loc.own),'/bin/sh',quote(loc.script)].join(' ');}
 function entryFor(command){return{hooks:[{type:'command',command,timeout:2}]};}
 function hasCommand(entry,command){return object(entry)&&Array.isArray(entry.hooks)&&entry.hooks.some(hook=>hook?.command===command);}
 function settingsSnapshot(loc){const snap=snapshot(loc.root,loc.settings),value=json(snap.bytes);if(value.hooks!==undefined&&!object(value.hooks))throw fail('UNSUPPORTED_SETTINGS');return{...snap,value};}
 function hooksAllowed(settings){if(settings.value.disableAllHooks===true||settings.value.allowManagedHooksOnly===true)throw fail('HOOKS_DISABLED_BY_POLICY');}
 function manifestSnapshot(loc){const snap=snapshot(loc.root,loc.manifest,32768);if(!snap.bytes)return{...snap,value:null};const value=json(snap.bytes);
  if(value.kind!==KIND||value.command!==commandFor(loc)||!Array.isArray(value.events)||!value.events.length||value.events.some(event=>!EVENTS.has(event))||!Array.isArray(value.originalEventKeys)||typeof value.hooksOriginallyAbsent!=='boolean'||
   !/^[a-f0-9]{64}$/.test(value.scriptSha256||'')||!/^[a-f0-9]{64}$/.test(value.receiverSha256||''))throw fail('INSTALL_CONFLICT');return{...snap,value};
 }
 function assets(){
  const base=path.join(assetRoot,'plugins/qiuqiu-task-events'),script=snapshot(assetRoot,path.join(base,'scripts/emit-metadata.sh'),256*1024),hooks=json(snapshot(assetRoot,path.join(base,'hooks/hooks.json'),32768).bytes).hooks;
  if(!script.bytes||!object(hooks))throw fail('INSTALL_CONFLICT');const events=Object.keys(hooks);
  if(!events.includes('UserPromptSubmit')||!events.includes('FinalStop')||events.some(event=>!EVENTS.has(event)||!Array.isArray(hooks[event])))throw fail('INSTALL_CONFLICT');
  return{script:script.bytes,events};
 }
 function backupSettings(loc,before){if(!before)return;mkdir(loc.root,loc.backups);const file=path.join(loc.backups,'settings-before-'+randomUUID()+'.json');io.writeFileSync(file,before,{mode:0o600,flag:'wx'});}
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
  if(!manifest.value)return false;const value=manifest.value,script=snapshot(loc.root,loc.script,256*1024),receiver=snapshot(loc.root,loc.receiver,8192),entry=entryFor(value.command);
  if(!script.bytes||digest(script.bytes)!==value.scriptSha256||!receiver.bytes||digest(receiver.bytes)!==value.receiverSha256)return false;
  return value.events.every(event=>Array.isArray(settings.value.hooks?.[event])&&settings.value.hooks[event].filter(row=>stable(row)===stable(entry)).length===1);
 }
 async function operation(signal,run){
  const owner=epoch;check(signal,owner);const grant=await storage.load('workbuddy');check(signal,owner);const scope=await lease(grant);
  try{check(signal,owner);return run(locations(scope.directory),owner);}finally{scope.release();}
 }
 function ensure({interactive=false,signal}={}){const selection=selectionEpoch;return queue(async()=>{
  const owner=epoch;const current=()=>{check(signal,owner);if(selection!==selectionEpoch)throw fail('CANCELLED');};current();if(!supported)return{status:'unavailable'};
  const before=await storage.load('workbuddy');current();try{const scope=await lease(before);scope.release();current();state.authorized=true;return{status:'stored'};}catch(error){if(error.code==='CANCELLED')throw error;}
  state.authorized=false;if(!interactive)return{status:'needs-authorization'};
  const picked=await dialog.showOpenDialog({title:'允许安装 WorkBuddy 动画提醒',buttonLabel:'允许安装提醒',defaultPath:path.join(home(),'.workbuddy'),
   message:'仅在此目录注册球球的动画提醒 Hook、过滤脚本和本机连接信息。脚本在本机过滤原 Hook 输入，只向球球发送任务标识与阶段，不保存或发送聊天正文。不更改其他插件、账号或会话；可随时停用并移除球球配置。',properties:['openDirectory','showHiddenFiles'],securityScopedBookmarks:true});current();
  if(picked?.canceled)return{status:'cancelled'};
  if(picked?.filePaths?.length!==1||picked?.bookmarks?.length!==1)throw fail('DIRECTORY_ACCESS_REQUIRED');
  const grant={purpose:PURPOSE,directory:picked.filePaths[0],bookmark:picked.bookmarks[0]};try{const scope=await lease(grant);scope.release();}catch(error){if(error.code==='CANCELLED')throw error;return{status:'invalid-directory'};}current();
  await storage.save('workbuddy',grant);try{current();}catch(error){if(before)await storage.save('workbuddy',before);else await storage.remove('workbuddy');throw error;}
  epoch++;state.authorized=true;return{status:'stored'};
 });}
 function install({receiver,signal}={}){return queue(()=>operation(signal,(loc,owner)=>{
  const source=assets(),settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc),command=commandFor(loc),entry=entryFor(command),next=structuredClone(settings.value);
  hooksAllowed(settings);
  if(manifest.value&&!intact(loc,manifest,settings))throw fail('INSTALL_CONFLICT');
  if(!manifest.value&&(snapshot(loc.root,loc.script).bytes||snapshot(loc.root,loc.receiver).bytes))throw fail('INSTALL_CONFLICT');
  next.hooks=next.hooks||{};for(const event of source.events){const rows=next.hooks[event]??[];if(!Array.isArray(rows))throw fail('UNSUPPORTED_SETTINGS');const own=rows.filter(row=>hasCommand(row,command));if(own.some(row=>stable(row)!==stable(entry))||own.length>1||(!manifest.value&&own.length))throw fail('INSTALL_CONFLICT');next.hooks[event]=own.length?rows:[...rows,entry];}
  const privateReceiver=receiverBytes(receiver),record={kind:KIND,version:1,command,events:source.events,scriptSha256:digest(source.script),receiverSha256:digest(privateReceiver),hooksOriginallyAbsent:manifest.value?.hooksOriginallyAbsent??settings.value.hooks===undefined,originalEventKeys:manifest.value?.originalEventKeys||Object.keys(settings.value.hooks||{})};
  transact(loc,[{file:loc.script,before:snapshot(loc.root,loc.script),after:source.script,mode:0o700},{file:loc.receiver,before:snapshot(loc.root,loc.receiver),after:privateReceiver,mode:0o600},{file:loc.manifest,before:manifest,after:Buffer.from(JSON.stringify(record)+'\n'),mode:0o600},{file:loc.settings,before:settings,after:Buffer.from(JSON.stringify(next,null,2)+'\n')}],signal,owner);
  state={...state,authorized:true,installed:true,status:'installed'};return{status:'installed',requiresNewSession:true};
 }));}
 function restore({receiver,signal}={}){return queue(()=>operation(signal,(loc,owner)=>{
  const settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc);hooksAllowed(settings);if(!intact(loc,manifest,settings)){state.installed=false;return{status:'not-installed'};}
  const privateReceiver=receiverBytes(receiver),record={...manifest.value,receiverSha256:digest(privateReceiver)};
  transact(loc,[{file:loc.receiver,before:snapshot(loc.root,loc.receiver),after:privateReceiver,mode:0o600},{file:loc.manifest,before:manifest,after:Buffer.from(JSON.stringify(record)+'\n'),mode:0o600}],signal,owner);
  state={...state,authorized:true,installed:true,status:'installed'};return{status:'installed',requiresNewSession:true};
 }));}
 function uninstall({signal}={}){return queue(()=>operation(signal,(loc,owner)=>{
  const settings=settingsSnapshot(loc),manifest=manifestSnapshot(loc);if(!manifest.value){state.installed=false;return{status:'uninstalled'};}
  const record=manifest.value,next=structuredClone(settings.value);let retainedModifiedFiles=false;
  for(const event of record.events){const rows=next.hooks?.[event];if(rows===undefined)continue;if(!Array.isArray(rows))throw fail('UNSUPPORTED_SETTINGS');
   next.hooks[event]=rows.flatMap(row=>{if(!object(row)||!Array.isArray(row.hooks))return[row];const hooks=row.hooks.filter(hook=>!(hook?.type==='command'&&hook.command===record.command));return hooks.length===row.hooks.length?[row]:hooks.length?[{...row,hooks}]:[];});
   if(!next.hooks[event].length&&!record.originalEventKeys.includes(event))delete next.hooks[event];}
  if(record.hooksOriginallyAbsent&&next.hooks&&!Object.keys(next.hooks).length)delete next.hooks;
  const changes=[{file:loc.settings,before:settings,after:Buffer.from(JSON.stringify(next,null,2)+'\n')}];
  for(const [file,expected]of [[loc.script,record.scriptSha256],[loc.receiver,record.receiverSha256]]){const before=snapshot(loc.root,file);if(before.bytes&&digest(before.bytes)===expected)changes.push({file,before,after:null});else if(before.bytes)retainedModifiedFiles=true;}
  changes.push({file:loc.manifest,before:manifest,after:null});transact(loc,changes,signal,owner);
  for(const directory of [path.dirname(loc.script),loc.own])try{io.rmdirSync(directory);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;}
  state={...state,installed:false,status:'uninstalled'};return{status:'uninstalled',retainedModifiedFiles};
 }));}
 return{ensure,install,restore,uninstall,getState,
  revoke(){epoch++;selectionEpoch++;return queue(async()=>{await storage.remove('workbuddy');state.authorized=false;return{status:'needs-authorization'};});},
  close(){closed=true;epoch++;selectionEpoch++;},clearPending(){selectionEpoch++;}
 };
}
module.exports={createMasWorkBuddyEventInstallation};
