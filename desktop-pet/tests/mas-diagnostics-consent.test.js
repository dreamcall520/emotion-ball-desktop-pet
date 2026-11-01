'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createFeedbackReporting,automaticReportingEnabled,AUTOMATIC_REPORT_CONSENT_VERSION,ENDPOINT}=require('../lib/feedback-reporting');
const {normalizeSettings,saveSettings,loadSettings}=require('../lib/settings');
const {settingsForFirstRelease}=require('../lib/mas-first-release');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
function fixture(t,{raw={autoReportErrors:true},firstRelease=true,fetch,holdPrompt=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mas-diagnostics-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'settings.json'),directory=path.join(root,'diagnostics'),calls=[],prompts=[],timers=new Map();let visible=true,answer=0,finishPrompt,serial=0,time=100000;
 saveSettings(file,raw);
 const original=loadSettings(file),settings=firstRelease?settingsForFirstRelease(original):original;
 const reporting=createFeedbackReporting({directory,version:'0.4.12',enabled:automaticReportingEnabled(settings,firstRelease),requireExplicitAutomaticConsent:firstRelease,automaticConsentVersion:settings.autoReportErrorsConsentVersion,
  now:()=>time,schedule:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},cancel:id=>timers.delete(id),
  fetch:fetch|| (async(url,args)=>{calls.push({url,body:JSON.parse(args.body)});return{ok:true,json:async()=>({id:JSON.parse(args.body).submissionId})};})});
 t.after(()=>reporting.dispose());
 const webContents={mainFrame:{}},owner={webContents,isDestroyed:()=>false,isVisible:()=>visible};let handler;
 const sandbox={FIRST_RELEASE:firstRelease,feedbackReporting:reporting,feedbackConsentFlight:false,feedbackConsentEpoch:0,globalSettingsWindow:owner,screenLocked:false,isQuitting:false,
  settings,settingsFile:file,saveSettings,automaticReportingEnabled,AUTOMATIC_REPORT_CONSENT_VERSION,FEEDBACK_ENDPOINT:ENDPOINT,
  ipcMain:{handle:(name,fn)=>{assert.equal(name,'pet:feedback-auto-report');handler=fn;}},
  dialog:{showMessageBox:async(win,info)=>{assert.equal(win,owner);prompts.push(info);return holdPrompt?new Promise(resolve=>finishPrompt=()=>resolve({response:answer})):{response:answer};}}};
 const trust=source.slice(source.indexOf('function fromGlobalSettings('),source.indexOf('function openGlobalSettings('));
 const ipcStart=source.indexOf("  ipcMain.handle('pet:feedback-auto-report',"),ipcEnd=source.indexOf("  ipcMain.handle('pet:global-quota-cards-save'",ipcStart);
 vm.runInNewContext(trust+source.slice(ipcStart,ipcEnd),sandbox);
 const event={sender:webContents,senderFrame:webContents.mainFrame};
 return{root,file,directory,calls,prompts,reporting,sandbox,timers,event,run:(value,eventOverride=event)=>handler(eventOverride,value),answer:value=>answer=value,hide:()=>visible=false,finish:()=>finishPrompt(),advance:async()=>{time+=3000;await reporting.flush();}};
}

test('MAS first release rejects old true without explicit consent; website remains enabled by default',()=>{
 for(const raw of [{},{autoReportErrors:true},{autoReportErrors:true,autoReportErrorsConsentVersion:'old-version'}]){
  const normalized=normalizeSettings(raw);assert.equal(normalized.autoReportErrors,true);
  assert.equal(settingsForFirstRelease(normalized).autoReportErrors,false);assert.equal(automaticReportingEnabled(normalized,true),false);
  assert.equal(automaticReportingEnabled(normalized,false),true);
 }
 const opted=normalizeSettings({autoReportErrors:true,autoReportErrorsConsentVersion:AUTOMATIC_REPORT_CONSENT_VERSION});
 assert.equal(settingsForFirstRelease(opted).autoReportErrors,true);
});

test('real main IPC denial stays off; approval discloses destination/fields then persists consent and survives reload',async t=>{
 const f=fixture(t);assert.equal(f.reporting.getState().enabled,false);assert.equal(f.reporting.capture('天气',new Error('secret')),false);await f.advance();assert.equal(f.calls.length,0);
 assert.equal((await f.run(true)).ok,true);assert.equal(f.reporting.getState().enabled,false);assert.equal(loadSettings(f.file).autoReportErrorsConsentVersion,'');
 const disclosure=f.prompts[0];assert.equal(disclosure.defaultId,0);assert.equal(disclosure.cancelId,0);assert.match(disclosure.detail,/排查运行异常.*改善稳定性/);assert.ok(disclosure.detail.includes(ENDPOINT));
 for(const field of ['应用版本','操作系统','设备架构','异常模块','错误类型','错误码','发生时间','发生次数','错误指纹','提交编号'])assert.ok(disclosure.detail.includes(field),field);
 f.answer(1);assert.equal((await f.run(true)).state.enabled,true);
 const saved=loadSettings(f.file);assert.equal(saved.autoReportErrorsConsentVersion,AUTOMATIC_REPORT_CONSENT_VERSION);assert.equal(automaticReportingEnabled(saved,true),true);
 const reopened=createFeedbackReporting({directory:f.directory,version:'0.4.12',enabled:automaticReportingEnabled(saved,true),requireExplicitAutomaticConsent:true,automaticConsentVersion:saved.autoReportErrorsConsentVersion,fetch:async()=>assert.fail('no unscheduled request')});
 assert.equal(reopened.getState().enabled,true);reopened.dispose();
 f.reporting.capture('天气',Object.assign(new Error('secret private path'),{code:'EIO'}));await f.advance();assert.equal(f.calls.length,1);assert.equal(JSON.stringify(f.calls).includes('secret private path'),false);
 assert.equal((await f.run(false)).state.enabled,false);assert.equal(loadSettings(f.file).autoReportErrorsConsentVersion,'');assert.equal(f.reporting.capture('天气',new Error('after optout')),false);await f.advance();assert.equal(f.calls.length,1);
});

test('main IPC refuses foreign frames, hidden/locked settings and late approval after opt-out',async t=>{
 for(const kind of ['foreign','hidden','locked']){
  const f=fixture(t);if(kind==='hidden')f.hide();if(kind==='locked')f.sandbox.screenLocked=true;
  const event=kind==='foreign'?{...f.event,senderFrame:{}}:f.event;
  assert.equal((await f.run(true,event)).ok,false);assert.equal(f.prompts.length,0);assert.equal(f.reporting.getState().enabled,false);
 }
 const f=fixture(t,{holdPrompt:true});f.answer(1);const enabling=f.run(true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.run(true)).ok,false,'duplicate IPC cannot open another confirmation');assert.equal(f.prompts.length,1);
 await f.run(false);f.finish();assert.equal((await enabling).ok,false);assert.equal(f.reporting.getState().enabled,false);assert.equal(loadSettings(f.file).autoReportErrorsConsentVersion,'');
 const hidden=fixture(t,{holdPrompt:true});hidden.answer(1);const pending=hidden.run(true);await new Promise(resolve=>setImmediate(resolve));hidden.hide();hidden.finish();assert.equal((await pending).ok,false);assert.equal(hidden.reporting.getState().enabled,false);
});

test('unconsented legacy outbox is discarded without reading/transmitting it, not replayed after opt-in',async t=>{
 const f=fixture(t);const legacy=createFeedbackReporting({directory:f.directory,version:'0.4.12',enabled:true,now:()=>100000,schedule:()=>1,cancel:()=>{},fetch:async()=>assert.fail('legacy must not send')});
 legacy.capture('天气',Object.assign(new Error('legacy error'),{code:'EIO'}));legacy.dispose();const file=path.join(f.directory,'feedback-outbox.json');assert.equal(fs.existsSync(file),true);
 const calls=[];let now=200000;const blocked=createFeedbackReporting({directory:f.directory,version:'0.4.12',enabled:true,requireExplicitAutomaticConsent:true,now:()=>now,schedule:()=>1,cancel:()=>{},fetch:async(_,args)=>{calls.push(JSON.parse(args.body));return{ok:true,json:async()=>({id:JSON.parse(args.body).submissionId})};}});
 assert.equal(blocked.getState().enabled,false);assert.equal(fs.existsSync(file),false);await blocked.flush();assert.equal(calls.length,0);
 blocked.setEnabled(true);assert.equal(blocked.getState().enabled,false);
 blocked.setEnabled(true,{consentVersion:AUTOMATIC_REPORT_CONSENT_VERSION});await blocked.flush();assert.equal(calls.length,0);
 blocked.capture('窗口崩溃',Object.assign(new Error('new'),{code:'RENDER_PROCESS_GONE'}));now+=3000;await blocked.flush();assert.equal(calls.length,1);assert.equal(calls[0].title,'[自动异常] 窗口崩溃');blocked.dispose();
});

test('opt-out aborts in-flight automatic delivery and pending queue cannot return after restart',async t=>{
 let requestSignal,started;const begun=new Promise(resolve=>started=resolve);
 const f=fixture(t,{fetch:async(_url,args)=>{requestSignal=args.signal;started();return new Promise((_,reject)=>args.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 f.answer(1);await f.run(true);f.reporting.capture('天气',Object.assign(new Error('fixture'),{code:'EIO'}));const flushing=f.advance();await begun;
 assert.equal(requestSignal.aborted,false);await f.run(false);assert.equal(requestSignal.aborted,true);await flushing;
 assert.equal(f.reporting.getState().pending,0);assert.equal(fs.existsSync(path.join(f.directory,'feedback-outbox.json')),false);
 const saved=loadSettings(f.file);assert.equal(automaticReportingEnabled(saved,true),false);
});

test('website toggle preserves existing behavior without MAS consent dialog',async t=>{
 const f=fixture(t,{firstRelease:false,raw:{autoReportErrors:false}});assert.equal((await f.run(true)).state.enabled,true);assert.equal(f.prompts.length,0);assert.equal(loadSettings(f.file).autoReportErrors,true);
});

test('actual main bootstrap wires both explicit-consent gates before legacy automatic reporting can start',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mas-diagnostics-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let captured,reporter;
 const start=source.indexOf('  feedbackReporting = createFeedbackReporting({ directory:'),end=source.indexOf('\n  if(ACCEPTANCE_KIND',start);
 assert.ok(start>0&&end>start);
 vm.runInNewContext(source.slice(start,end),{path,app:{getPath:()=>root,getVersion:()=> '0.4.12'},FIRST_RELEASE:true,IS_SMOKE_TEST:false,settings:{autoReportErrors:true},automaticReportingEnabled,
  net:{fetch:async()=>assert.fail('bootstrap must not transmit unconsented data')},createFeedbackReporting:options=>{captured=options;return reporter=createFeedbackReporting(options);}});
 assert.equal(captured.enabled,false);assert.equal(captured.requireExplicitAutomaticConsent,true);assert.equal(reporter.getState().enabled,false);
 assert.equal(reporter.capture('应用启动失败',new Error('synthetic only')),false);reporter.dispose();
});

test('late consent after lock, destroyed window or owner replacement never enables reporting',async t=>{
 for(const kind of ['lock','closed','replaced']){
  const f=fixture(t,{holdPrompt:true});f.answer(1);const enabling=f.run(true);await new Promise(resolve=>setImmediate(resolve));
  if(kind==='lock')f.sandbox.screenLocked=true;
  if(kind==='closed')f.sandbox.globalSettingsWindow.isDestroyed=()=>true;
  if(kind==='replaced')f.sandbox.globalSettingsWindow={...f.sandbox.globalSettingsWindow};
  f.finish();assert.equal((await enabling).ok,false);assert.equal(f.reporting.getState().enabled,false);
  assert.equal(loadSettings(f.file).autoReportErrorsConsentVersion,'');assert.equal(f.calls.length,0);
 }
});

test('approval with settings-save or diagnostic-directory failure never starts sending or records active consent',async t=>{
 const saveFailure=fixture(t);saveFailure.answer(1);saveFailure.sandbox.saveSettings=()=>{throw Error('synthetic disk failure');};
 assert.equal((await saveFailure.run(true)).ok,false);assert.equal(saveFailure.reporting.getState().enabled,false);
 assert.equal(loadSettings(saveFailure.file).autoReportErrorsConsentVersion,'');assert.equal(saveFailure.calls.length,0);
 const directoryFailure=fixture(t);directoryFailure.answer(1);fs.writeFileSync(directoryFailure.directory,'not a directory');
 assert.equal((await directoryFailure.run(true)).ok,false);assert.equal(directoryFailure.reporting.getState().enabled,false);
 assert.equal(loadSettings(directoryFailure.file).autoReportErrors,false);assert.equal(loadSettings(directoryFailure.file).autoReportErrorsConsentVersion,'');
 assert.equal(directoryFailure.reporting.capture('天气',new Error('must not capture')),false);assert.equal(directoryFailure.calls.length,0);
});
