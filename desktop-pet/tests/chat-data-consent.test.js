const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createChatDataConsent,createChatDataConsentStore,VERSION}=require('../lib/chat-data-consent');
const account='a'.repeat(64),other='b'.repeat(64);
const base=()=>({provider:'codex',accountKey:account,channel:'codex-official',recipientOrigin:'https://chatgpt.com',billing:'使用你登录的 Codex 账号额度。',conversationKey:'local-chat-a',revision:1});
function fixture(options={}){
 let value=base(),rows=[],prompts=[],sends=0,writes=0;
 const gate=createChatDataConsent({store:{read:()=>structuredClone(rows),write:next=>{writes++;rows=structuredClone(next);}},request:async info=>{prompts.push(info);return true;},...options});
 const run=extra=>gate.run({getContext:async()=>structuredClone(value),isCurrent:()=>true,send:()=>{sends++;return{accepted:true};},...extra});
 return{gate,run,set:patch=>Object.assign(value,patch),state:()=>({rows,prompts,sends,writes})};
}
test('首次发送前明确披露内容/上下文/接收方/计费及撤销，默认取消；不含正文或身份',async()=>{
 const f=fixture();assert.equal((await f.run()).accepted,true);
 const {rows,prompts,sends}=f.state();assert.equal(sends,1);assert.equal(prompts.length,1);
 assert.match(prompts[0].message,/这条消息和当前会话上下文/);assert.match(prompts[0].detail,/https:\/\/chatgpt.com.*\n使用.*账号额度/s);
 assert.match(prompts[0].detail,/拒绝不会发送.*撤销 AI 数据同意/s);assert.equal(prompts[0].defaultId,0);assert.equal(prompts[0].cancelId,0);
 assert.deepEqual(prompts[0].buttons,['暂不发送','同意并发送']);
 assert.deepEqual(Object.keys(rows[0]).sort(),['provider','scope','version']);assert.equal(rows[0].version,VERSION);
 assert.equal(JSON.stringify({rows,prompts}).includes(account),false);assert.equal(rows[0].scope.length,64);
});
test('拒绝不保存/不发送；相同已核实工具账号来源复用同意，普通模型切换不重复',async()=>{
 let prompts=0;const f=fixture({request:async()=>{prompts++;return false;}});
 const rejected=await f.run();assert.equal(rejected.accepted,false);assert.equal(rejected.cancelled,true);assert.equal(f.state().sends,0);assert.equal(f.state().rows.length,0);
 const g=fixture();await g.run();g.set({model:'another-model-same-service'});await g.run();
 assert.equal(g.state().prompts.length,1);assert.equal(g.state().sends,2);
});
test('工具/账号/来源/自定义接收origin变化均重新确认，恢复原已确认scope不重复',async()=>{
 const f=fixture();await f.run();f.set({accountKey:other});await f.run();
 f.set({provider:'zcode',channel:'configured-custom',recipientOrigin:'https://provider.example',billing:'按原API计费。'});await f.run();
 f.set({recipientOrigin:'https://another.example'});await f.run();
 assert.equal(f.state().prompts.length,4);f.set({recipientOrigin:'https://provider.example'});await f.run();assert.equal(f.state().prompts.length,4);
});
test('未知账号只单次明确同意，不持久化、不复用旧provider级同意',async()=>{
 const f=fixture();f.set({accountKey:null});await f.run();await f.run();
 assert.equal(f.state().prompts.length,2);assert.equal(f.state().rows.length,0);assert.match(f.state().prompts[0].detail,/身份尚未核实.*不会保存/);
});
test('确认中窗口关闭/切账号/切来源/切会话/上下文变化均拒绝发送并不保存',async()=>{
 for(const patch of [{accountKey:other},{channel:'other-source'},{conversationKey:'other-chat'},{revision:2},{recipientOrigin:'https://other.example'}]){
  const f=fixture({request:async()=>{f.set(patch);return true;}});assert.equal((await f.run()).accepted,false);assert.equal(f.state().sends,0);assert.equal(f.state().rows.length,0);
 }
 let current=true;const f=fixture({request:async()=>{current=false;return true;}});
 assert.equal((await f.run({isCurrent:()=>current})).accepted,false);assert.equal(f.state().sends,0);
});
test('撤销清除所有该provider scope并使已打开的确认失效；重新发送须重新确认',async()=>{
 const f=fixture();await f.run();f.set({accountKey:other});await f.run();assert.equal(f.state().rows.length,2);
 f.gate.revoke('codex');assert.equal(f.state().rows.length,0);await f.run();assert.equal(f.state().prompts.length,3);
 const g=fixture({request:async()=>{g.gate.revoke('codex');return true;}});assert.equal((await g.run()).accepted,false);assert.equal(g.state().sends,0);assert.equal(g.state().rows.length,0);
});
test('并发点击不重复弹框或派发；关闭期间迟到同意无效',async()=>{
 let approve,started;const ready=new Promise(resolve=>started=resolve);
 const f=fixture({request:()=>{started();return new Promise(resolve=>approve=resolve);}});
 const first=f.run();await ready;assert.equal((await f.run()).accepted,false);f.gate.close();approve(true);
 assert.equal((await first).accepted,false);assert.equal(f.state().sends,0);
});
test('存储失败/坏上下文/确认异常均不发送；真实send错误不伪装为未发送或重试',async()=>{
 const f=fixture({store:{read:()=>[],write:()=>{throw new Error('disk');}}});assert.equal((await f.run()).accepted,false);assert.equal(f.state().sends,0);
 for(const recipientOrigin of ['http://example.com','https://user:secret@example.com','https://example.com/path']){
  const g=fixture();g.set({recipientOrigin});assert.equal((await g.run()).accepted,false);assert.equal(g.state().sends,0);
 }
 const g=fixture({request:async()=>{throw new Error('closed');}});assert.equal((await g.run()).accepted,false);assert.equal(g.state().sends,0);
 const h=fixture(),unknown=Object.assign(new Error('unknown'),{code:'UNKNOWN_OUTCOME'});let attempts=0;
 await assert.rejects(h.run({send:()=>{attempts++;return Promise.reject(unknown);}}),error=>error===unknown);assert.equal(attempts,1);
});
test('私有同意文件仅保存version/provider/scope，重启恢复、旧版不复用，链接拒绝',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chat-consent-test-'));try{
  const file=path.join(temp,'consent.json'),store=createChatDataConsentStore(file),row={version:VERSION,provider:'zcode',scope:'c'.repeat(64)};
  assert.deepEqual(store.read(),[]);store.write([row]);assert.deepEqual(createChatDataConsentStore(file).read(),[row]);
  assert.equal(fs.statSync(file).mode&0o777,0o600);store.write([{...row,version:'old'}, {provider:'codex',accepted:true}, {...row,token:'not-allowed'}]);assert.deepEqual(store.read(),[]);
  const link=path.join(temp,'link.json');fs.symlinkSync(file,link);assert.throws(()=>createChatDataConsentStore(link).read(),{code:'CONSENT_STORAGE'});
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('首发仅收准聊天披露，默认及便签独立用途不变，同一已存scope跨模式无需重新授权',async()=>{
 const normal=fixture(),first=fixture({chatOnlyDisclosure:true});
 await normal.run();await first.run();
 assert.match(normal.state().prompts[0].detail,/撤销 AI 数据同意（含聊天与便签整理）/);
 assert.match(first.state().prompts[0].detail,/撤销聊天数据同意/);assert.doesNotMatch(first.state().prompts[0].detail,/便签/);
 assert.deepEqual(first.state().rows,normal.state().rows,'wording-only option cannot alter consent scope or persisted version');
 const normalNotes=fixture(),firstNotes=fixture({chatOnlyDisclosure:true});
 normalNotes.set({channel:'notes-organize'});firstNotes.set({channel:'notes-organize'});
 await normalNotes.run();await firstNotes.run();assert.deepEqual(firstNotes.state().prompts,normalNotes.state().prompts);
 assert.match(firstNotes.state().prompts[0].detail,/便签整理同意与聊天同意独立/);
 assert.notEqual(firstNotes.state().rows[0].scope,first.state().rows[0].scope);
 const rows=normal.state().rows;let requests=0,sent=0;
 const reopened=createChatDataConsent({chatOnlyDisclosure:true,store:{read:()=>structuredClone(rows),write:()=>assert.fail('known consent must not rewrite')},request:async()=>{requests++;return false;}});
 assert.equal((await reopened.run({getContext:async()=>base(),send:()=>{sent++;return{accepted:true};}})).accepted,true);
 assert.equal(requests,0);assert.equal(sent,1);
 const rendererFlag=fixture();rendererFlag.set({chatOnlyDisclosure:true});await rendererFlag.run();
 assert.match(rendererFlag.state().prompts[0].detail,/含聊天与便签整理/,'context data cannot enable the main-process-only display option');
});
