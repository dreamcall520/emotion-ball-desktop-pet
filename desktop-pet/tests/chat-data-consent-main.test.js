const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
function fixture(t,{firstRelease=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-consent-main-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let provider='codex',visible=true,approved=false,afterPrompt=()=>{},sends=0;const prompts=[];
 const identity={accountKey:'a'.repeat(64),conversationKey:'fixture-chat',revision:1,recipientOrigin:'https://custom.invalid'};
 const state=()=>({source:provider,activeChatId:'fixture-chat',messages:[]});
 const controller={getState:state,getConsentIdentity:async()=>({...identity})};
 const makeOwner=file=>{const webContents={mainFrame:{},getURL:()=>pathToFileURL(path.join(__dirname,'..',file)).href};return{webContents,isDestroyed:()=>false,isVisible:()=>visible};};
 const chatOwner=makeOwner('chat.html'),toolsOwner=makeOwner('store-connections.html');
 const sandbox={chat:controller,IS_STORE_BUILD:true,FIRST_RELEASE:firstRelease,chatProviderChanging:false,isQuitting:false,screenLocked:false,
  chatWindow:{getWindow:()=>chatOwner,isVisible:()=>visible},storeConnectionsWindow:toolsOwner,app:{getPath:()=>root},path,pathToFileURL,URL,__dirname:path.resolve(__dirname,'..'),
  require:name=>name==='./lib/chat-data-consent'?require('../lib/chat-data-consent'):require(name),
  dialog:{showMessageBox:async(_owner,info)=>{prompts.push(info);afterPrompt();return{response:approved?1:0};}},
  storeRuntime:{getZcodeAccountSource:()=> 'configured-custom',workbuddyCli:{getState:()=>({connected:true,messages:[]}),getConsentIdentity:async()=>({...identity})},
   workbuddyOfficial:{getState:()=>({connected:true,busy:false,baseUrl:'https://relay.invalid',messages:[]}),getConsentIdentity:()=>({...identity,accountKey:null})}}
 };
 const helper=source.slice(source.indexOf('function activeChat()'),source.indexOf('function storeChatReady('));
 const api=vm.runInNewContext(helper+';({storeChatSendWithConsent,storeChatDataConsent,requestStoreNotesConsent})',sandbox);
 const run=(extra={})=>{const owner=extra.tools?toolsOwner:chatOwner;return api.storeChatSendWithConsent({event:{sender:owner.webContents,senderFrame:owner.webContents.mainFrame},provider,content:'合成测试消息，不调用模型',send:()=>{sends++;return{accepted:true};},...extra});};
 const notesRun=extra=>api.requestStoreNotesConsent({win:toolsOwner,noteId:'fixture-note',contentRevision:'c'.repeat(64),getAccountIdentity:async()=>({...identity}),isCurrent:()=>true,send:()=>{sends++;return{accepted:true};},...extra});
 return{run,notesRun,api,prompts,identity,setProvider:value=>provider=value,approve:value=>approved=value,hide:()=>visible=false,onPrompt:fn=>afterPrompt=fn,sends:()=>sends,root};
}
test('真实main helper三个商店发送入口均默认拒绝，不调用send/保存；披露使用当前来源',async t=>{
 const f=fixture(t);
 for(const [provider,extra]of [['codex',{}],['zcode',{}],['workbuddy',{tools:true}],['workbuddy',{tools:true,official:true}]]){
  f.setProvider(provider);assert.equal((await f.run(extra)).accepted,false);assert.equal(f.sends(),0);
 }
 assert.equal(f.prompts.length,4);assert.match(f.prompts[1].detail,/https:\/\/custom.invalid.*按原 API 计费/s);
 assert.match(f.prompts[3].detail,/https:\/\/relay.invalid.*转发.*共享助理/s);assert.equal(fs.existsSync(path.join(f.root,'chat-data-consent.json')),false);
});
test('真实main helper同意后再核对窗口与会话；明确同意一次后仅原scope复用',async t=>{
 const f=fixture(t);f.approve(true);assert.equal((await f.run()).accepted,true);assert.equal(f.sends(),1);
 assert.equal((await f.run()).accepted,true);assert.equal(f.prompts.length,1);assert.equal(f.sends(),2);
 f.api.storeChatDataConsent().revoke('codex');f.onPrompt(()=>{f.identity.conversationKey='another-chat';});assert.equal((await f.run()).accepted,false);assert.equal(f.sends(),2);
 const g=fixture(t);g.approve(true);g.onPrompt(()=>g.hide());assert.equal((await g.run()).accepted,false);assert.equal(g.sends(),0);
});


test('真实main便签用途不复用聊天同意，披露仅当前便签且拒绝不发送',async t=>{
 const f=fixture(t);f.approve(true);await f.run();assert.equal(f.sends(),1);f.approve(false);
 assert.equal((await f.notesRun()).accepted,false);assert.equal(f.sends(),1);assert.equal(f.prompts.length,2);
 const info=f.prompts.at(-1);assert.match(info.message,/当前这条便签的标题和正文/);assert.match(info.detail,/不会发送其他便签、待办或原工具聊天记录/);assert.match(info.detail,/可能消耗套餐额度/);assert.deepEqual(Array.from(info.buttons),['暂不整理','同意并整理']);
 f.approve(true);await f.notesRun();await f.notesRun();assert.equal(f.sends(),3);assert.equal(f.prompts.length,3,'same notes purpose can reuse its own confirmed scope');
 let current=true;f.api.storeChatDataConsent().revoke('codex');f.onPrompt(()=>current=false);assert.equal((await f.notesRun({isCurrent:()=>current})).accepted,false);assert.equal(f.sends(),3);
});


test('真实main首发helper只披露聊天用途，拒绝不发送且默认已有scope无需重问',async t=>{
 const normal=fixture(t);normal.approve(true);assert.equal((await normal.run()).accepted,true);
 assert.match(normal.prompts[0].detail,/含聊天与便签整理/);
 const normalRows=JSON.parse(fs.readFileSync(path.join(normal.root,'chat-data-consent.json'),'utf8'));
 const first=fixture(t,{firstRelease:true});
 assert.equal((await first.run()).accepted,false);assert.equal(first.sends(),0);
 assert.match(first.prompts[0].detail,/撤销聊天数据同意/);assert.doesNotMatch(first.prompts[0].detail,/便签/);
 assert.equal(fs.existsSync(path.join(first.root,'chat-data-consent.json')),false);
 first.approve(true);assert.equal((await first.run()).accepted,true);
 const firstRows=JSON.parse(fs.readFileSync(path.join(first.root,'chat-data-consent.json'),'utf8'));
 assert.deepEqual(firstRows,normalRows,'real main display flag must not change provider, version or scope');
 const reopened=fixture(t,{firstRelease:true});
 fs.writeFileSync(path.join(reopened.root,'chat-data-consent.json'),JSON.stringify(normalRows),{mode:0o600});
 assert.equal((await reopened.run()).accepted,true);assert.equal(reopened.prompts.length,0);assert.equal(reopened.sends(),1,'previous default-mode consent remains usable');
 first.approve(false);normal.approve(false);
 assert.equal((await first.notesRun()).accepted,false);assert.equal((await normal.notesRun()).accepted,false);
 assert.deepEqual(first.prompts.at(-1),normal.prompts.at(-1),'notes remain a separate unchanged purpose');
 assert.equal(first.sends(),1);assert.equal(normal.sends(),1);
});
