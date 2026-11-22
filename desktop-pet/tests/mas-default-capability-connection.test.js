'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),key='a'.repeat(64);
function fixture(provider,{settings={},tasks='stored',reminders='ready',failTask=false,failReminder=false}={}){
 const name=provider==='zcode'?'Zcode':'WorkBuddy',start=source.indexOf('async function completeStore'+name+'Connection(');
 const end=source.indexOf(provider==='zcode'?'function syncWorkBuddyChatConnection(':'async function completeStoreZcodeConnection(',start);
 assert(start>0&&end>start);const calls=[],grant={accountKey:key,family:'bigmodel'},signal=new AbortController().signal;
 let taskAuthorized=false,chatAuthorized=false;
 const quota={connect:async()=>{calls.push('connect');return{connected:true};},getAccountKey:()=>key,getState:()=>({tasks:{authorized:taskAuthorized}}),
  authorizeTasks:async()=>{calls.push('tasks');if(failTask)throw Error('synthetic task failure');taskAuthorized=['stored','ready','authorized'].includes(tasks);return{status:tasks};}};
 const chat={enable:async()=>{calls.push('chat-consent');chatAuthorized=true;return{authorized:true,status:'ready'};},getAuthorizedAccountKey:()=>chatAuthorized?key:null,
  disable:async()=>{calls.push('disable-chat');chatAuthorized=false;}};
 const notifications={enable:async()=>{calls.push('reminders');if(failReminder)throw Error('synthetic reminder failure');return{status:reminders};}};
 const context={settings:{...settings},settingsFile:'/unused',saveSettings:(_file,value)=>{calls.push('save-preference');return value;},
  chat:{connectSource:async()=>calls.push('chat-models')},storeChatDataConsent:()=>({grantZcodeLink:()=>calls.push('data-consent'),grantWorkBuddyLink:()=>calls.push('data-consent'),revoke:()=>calls.push('revoke-data')}),
  zcodeQuotaConnection:quota,workbuddyQuotaConnection:quota,zcodeChatConnection:chat,workbuddyChatConnection:chat,
  zcodeNotifications:notifications,workbuddyNotifications:notifications,zcodeRun:async()=>grant,workbuddyRun:async()=>grant,
  workbuddyVerifiedAccountKey:null};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.complete=completeStore'+name+'Connection;',context);
 return{context,calls,complete:()=>context.complete(signal),chatAuthorized:()=>chatAuthorized};
}
for(const provider of ['zcode','workbuddy']){
 test(provider+' new connection defaults to independent task and reminder grants after main chat consent',async()=>{
  const f=fixture(provider);const result=await f.complete();assert.equal(result.authorized,true);assert.equal(result.status,'ready');
  assert.deepEqual(f.calls,['connect','chat-consent','data-consent','chat-models','tasks','reminders']);
 });
 test(provider+' default native cancellation preserves the successful main connection and never loops on reconnect',async()=>{
  const f=fixture(provider,{tasks:'cancelled',reminders:'cancelled'}),result=await f.complete();
  assert.equal(result.status,'partial');assert.equal(result.authorized,true);assert.equal(f.chatAuthorized(),true);assert.match(result.message,/未完成/);
  assert.equal(f.context.settings[provider+'TasksEnabled'],false);assert.equal(f.context.settings[provider+'NotificationsEnabled'],false);
  f.calls.length=0;await f.complete();assert.equal(f.calls.includes('tasks'),false);assert.equal(f.calls.includes('reminders'),false);assert.equal(f.calls.includes('disable-chat'),false);
 });
 test(provider+' respects saved task/reminder revocations and failed default capabilities do not break chat',async()=>{
  const off=fixture(provider,{settings:{[provider+'TasksEnabled']:false,[provider+'NotificationsEnabled']:false}});await off.complete();
  assert.equal(off.calls.includes('tasks'),false);assert.equal(off.calls.includes('reminders'),false);
  const failing=fixture(provider,{failTask:true,failReminder:true}),result=await failing.complete();
  assert.equal(result.status,'partial');assert.equal(failing.chatAuthorized(),true);assert.equal(failing.calls.includes('disable-chat'),false);
 });
}

for(const provider of ['zcode','workbuddy'])test(provider+' individual revoke/disable saves opt-out and explicit enable restores only successful capability',async()=>{
 const {EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
 const start=source.indexOf("  ipcMain.handle('pet:global-"+provider+"-connection'");
 const end=source.indexOf("  ipcMain.handle('pet:global-"+(provider==='zcode'?'codex':'zcode')+"-connection'",start);
 assert(start>0&&end>start);let handler,outcome='stored';const owner=new EventEmitter(),changes=[];
 const quota={authorizeTasks:async()=>({status:outcome}),revokeTasks:async()=>{changes.push('tasks-off');return{status:'revoked'};}};
 const reminders={enable:async()=>({status:outcome==='stored'?'ready':outcome}),disable:async()=>{changes.push('reminders-off');return{status:'disabled'};}};
 const context={FIRST_RELEASE:true,ipcMain:{handle:(_name,value)=>{handler=value;}},fromGlobalSettings:()=>true,
  path,pathToFileURL,__dirname:path.join(__dirname,'..'),globalSettingsWindow:owner,globalSettingsBusy:false,AbortController,
  zcodeQuotaConnection:quota,workbuddyQuotaConnection:quota,zcodeNotifications:reminders,workbuddyNotifications:reminders,
  settings:{},settingsFile:'/unused',saveSettings:(_file,value)=>value,globalSettingsSnapshot:()=>({}),writeError(){},
  require:name=>require(name.replace('./lib/','../lib/'))};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const event={sender:{getURL:()=>pathToFileURL(path.join(__dirname,'../global-settings.html')).href}};
 await handler(event,'tasks-revoke');await handler(event,'notifications-disable');
 assert.equal(context.settings[provider+'TasksEnabled'],false);assert.equal(context.settings[provider+'NotificationsEnabled'],false);
 assert.deepEqual(changes,['tasks-off','reminders-off']);
 await handler(event,'tasks-authorize');await handler(event,'notifications-enable');
 assert.equal(context.settings[provider+'TasksEnabled'],true);assert.equal(context.settings[provider+'NotificationsEnabled'],true);
 outcome='cancelled';await handler(event,'tasks-authorize');await handler(event,'notifications-enable');
 assert.equal(context.settings[provider+'TasksEnabled'],false);assert.equal(context.settings[provider+'NotificationsEnabled'],false);
 assert.equal(owner.listenerCount('hide'),0);assert.equal(owner.listenerCount('closed'),0);
});

for(const provider of ['zcode','workbuddy'])test(provider+' actual startup respects false preferences despite residual purpose, native grant and reminder pairing',async t=>{
 const {normalizeSettings}=require('../lib/settings');
 const {createMasZcodeQuotaConnection}=require('../lib/mas-zcode-quota-connection');
 const {createMasWorkBuddyQuotaConnection}=require('../lib/mas-workbuddy-quota-connection');
 const {createMasZcodeTaskNotifications}=require('../lib/mas-zcode-task-notifications');
 const {createMasWorkBuddyTaskNotifications}=require('../lib/mas-workbuddy-task-notifications');
 let taskReads=0,pairingReads=0,bridgeStarts=0,chatRefreshes=0;
 const settings=normalizeSettings({[provider+'Enabled']:true,[provider+'TasksEnabled']:false,[provider+'NotificationsEnabled']:false});
 const quota=provider==='zcode'?createMasZcodeQuotaConnection({
  access:{ensure:async()=>({status:'stored'}),clearPendingApp(){}},readAccount:async()=>({accountKey:key}),
  storage:{load:async()=>({purpose:'zcode-quota-device-tasks-v1',version:1,accountKey:key,tasks:true})},
  link:{getSnapshot:()=>({quota:{updatedAt:1}}),setEnabled:async()=>true,suspend(){}},
 }):createMasWorkBuddyQuotaConnection({
  access:{ensure:async()=>({status:'stored'}),clearPendingApp(){}},quota:{setEnabled(){},getState:()=>({report:{total:1}})},usage:{setEnabled(){}},saveEnabled(){},
  taskAccess:{ensure:async()=>({status:'stored'})},tasks:{setEnabled(){},getState:()=>({}),refresh:async()=>{taskReads++;}}
 });
 const createNotifications=provider==='zcode'?createMasZcodeTaskNotifications:createMasWorkBuddyTaskNotifications;
 const reminder=createNotifications({getAccountKey:()=>key,installer:{ensure:async()=>({status:'stored'}),restore:async()=>({status:'installed'}),close(){}},
  storage:{load:async()=>{pairingReads++;return{version:1,accountKey:key,port:43121,token:'t'.repeat(43),endpoint:`http://127.0.0.1:43121/${provider}/events`};}},
  createBridge:()=>({start:async()=>{bridgeStarts++;},close:async()=>{}})
 });
 t.after(()=>reminder.close());
 const context={settings,zcodeQuotaConnection:quota,workbuddyQuotaConnection:quota,zcodeNotifications:reminder,workbuddyNotifications:reminder,
  zcodeChatConnection:{restore:async()=>{},refreshAccount:async()=>{chatRefreshes++;}},
  workbuddyChatConnection:{refreshAccount:async()=>{chatRefreshes++;}},restoreWorkBuddyChat:Promise.resolve(),
  workbuddyRun:async()=>({accountKey:key}),isQuitting:false,workbuddyVerifiedAccountKey:null,writeError(){}};
 vm.createContext(context);
 if(provider==='zcode'){
  const start=source.indexOf('    await zcodeChatConnection.restore();'),end=source.indexOf('  })().catch(',start);
  assert(start>0&&end>start);await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
 }else{
  const guardStart=source.indexOf('    if (settings.workbuddyNotificationsEnabled !== false) void workbuddyNotifications.restore()');
  assert(guardStart>0);vm.runInContext(source.slice(guardStart,source.indexOf('\n',guardStart)),context);
  const start=source.indexOf('        await restoreWorkBuddyChat;'),end=source.indexOf('      } catch { writeError(',start);
  assert(start>0&&end>start);await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
 }
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(quota.getState().connected,true);assert.equal(quota.getState().tasks.authorized,false);
 assert.equal(taskReads,0);assert.equal(pairingReads,0);assert.equal(bridgeStarts,0);
 assert.equal(reminder.getState().enabled,false);assert.equal(chatRefreshes,1);
});
