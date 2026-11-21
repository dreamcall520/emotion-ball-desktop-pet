const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../docs/mac-app-store/workbuddy-desktop-hook-draft');
const script=path.join(root,'plugins/qiuqiu-task-events/scripts/emit-metadata.sh');
function run(input,env={QIUQIU_HOOK_DRY_RUN:'1'}){return new Promise((resolve,reject)=>{const child=spawn('/bin/sh',[script],{env:{PATH:'/usr/bin:/bin',...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(typeof input==='string'?input:JSON.stringify(input));});}
function payloadWithoutClock(raw){const value=typeof raw==='string'?JSON.parse(raw):{...raw};assert.equal(Number.isSafeInteger(value.occurredAt),true);assert.ok(Math.abs(Date.now()-value.occurredAt)<10000);delete value.occurredAt;return value;}
test('source filter only emits fixed lifecycle metadata, never prompt/body/path/token/title', {skip:process.platform!=='darwin'},async()=>{
 const input={session_id:'session-1',generation_id:'generation-1',hook_event_name:'UserPromptSubmit',prompt:'PRIVATE_PROMPT_MARKER',last_assistant_message:'PRIVATE_REPLY_MARKER',transcript_path:'/not/read/private-transcript',cwd:'/not/forwarded',accessToken:'PRIVATE_TOKEN_MARKER',session:{secret:'INTERNAL_SESSION'},title:'PRIVATE_TITLE',tool_input:{x:'PRIVATE_ARGUMENT'}};
 const result=await run(input);assert.equal(result.code,0);assert.equal(result.stderr,'');assert.deepEqual(payloadWithoutClock(result.stdout),{version:1,sessionId:'session-1',generationId:'generation-1',event:'UserPromptSubmit',phase:'submitted'});assert.equal(/PRIVATE_|transcript|cwd|title|prompt/.test(result.stdout),false);
});
test('Stop is only stop-observed, missing/null generation stays uncorrelated, never completed', {skip:process.platform!=='darwin'},async()=>{
 for(const generation_id of [undefined,null]){const result=await run({session_id:'s1',generation_id,hook_event_name:'Stop',last_assistant_message:'PRIVATE_REPLY'});assert.deepEqual(payloadWithoutClock(result.stdout),{version:1,sessionId:'s1',event:'Stop',phase:'stop-observed'});assert.equal(result.stdout.includes('completed'),false);}
});
test('malformed/oversized input, unknown events or unsafe identifiers emit nothing and do not block original task', {skip:process.platform!=='darwin'},async()=>{
 for(const input of ['{broken',' '.repeat(262145),{session_id:'../../elsewhere',hook_event_name:'Stop'},{session_id:3,hook_event_name:'Stop'},{session_id:'valid',generation_id:'$(something)',hook_event_name:'Stop'},{session_id:'valid',hook_event_name:'UnknownEvent'}]){const result=await run(input);assert.deepEqual(result,{code:0,stdout:'',stderr:''});}
});
test('draft is disabled without an App-generated receiver capability; schema has no direct raw HTTP hooks', {skip:process.platform!=='darwin'},async()=>{
 const hooks=JSON.parse(fs.readFileSync(path.join(root,'plugins/qiuqiu-task-events/hooks/hooks.json'),'utf8')).hooks;
 for(const rows of Object.values(hooks))for(const row of rows)for(const hook of row.hooks){assert.equal(hook.type,'command');assert.equal(hook.command.includes('emit-metadata.sh'),true);assert.equal(hook.timeout,2);}
 const result=await run({session_id:'s',hook_event_name:'Stop'},{CODEBUDDY_PLUGIN_ROOT:path.join(root,'plugins/qiuqiu-task-events')});assert.deepEqual(result,{code:0,stdout:'',stderr:''});
});
test('App receiver receives only metadata over authenticated loopback, capability is not an argv/URL parameter', {skip:process.platform!=='darwin'},async t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-hook-draft-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));let received=null;
 const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{received={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const token='synthetic_local_capability_12345678901234567890';fs.writeFileSync(path.join(temp,'receiver.json'),JSON.stringify({version:1,enabled:true,endpoint:`http://127.0.0.1:${server.address().port}/workbuddy/events`,token}),{mode:0o600});
 const result=await run({session_id:'owned',generation_id:'own-turn',hook_event_name:'Stop',last_assistant_message:'NEVER_SEND_THIS'},{CODEBUDDY_PLUGIN_ROOT:temp});assert.deepEqual(result,{code:0,stdout:'',stderr:''});assert.equal(received.auth,'Bearer '+token);assert.equal(received.url,'/workbuddy/events');assert.deepEqual(payloadWithoutClock(received.body),{version:1,sessionId:'owned',generationId:'own-turn',event:'Stop',phase:'stop-observed'});
 const source=fs.readFileSync(script,'utf8');assert.equal(source.includes('Authorization: Bearer %s'),true);assert.equal(source.includes('curl --disable --config - --noproxy'),true);assert.equal(source.includes('transcript_path'),false);
});
test('FinalStop forwards only fixed final reason; recovery/unknown reasons never imply completion', {skip:process.platform!=='darwin'},async()=>{
 for(const reason of ['completed','cancelled','interrupted','failed']){const out=await run({session_id:'own',generation_id:'own-turn',hook_event_name:'FinalStop',final_stop_reason:reason,prompt:'PRIVATE',last_assistant_message:'PRIVATE'});assert.deepEqual(payloadWithoutClock(out.stdout),{version:1,sessionId:'own',generationId:'own-turn',event:'FinalStop',phase:'final-stop-observed',finalStopReason:reason});}
 for(const input of [{final_stop_reason:'ARBITRARY_PRIVATE_ERROR'},{final_stop_reason:'completed',is_truncation_recovery:true},{}]){const out=await run({session_id:'own',generation_id:'own-turn',hook_event_name:'FinalStop',...input});const value=payloadWithoutClock(out.stdout);assert.equal(value.finalStopReason,undefined);assert.equal(value.phase,'final-stop-observed');assert.equal(out.stdout.includes('ARBITRARY_PRIVATE'),false);}
});
test('source activity includes a unique heartbeat and strict continuation/recovery flags without tool content', {skip:process.platform!=='darwin'},async()=>{
 for(const [event,phase]of[['PreToolUse','tool-started'],['PostToolUse','tool-finished'],['PostToolUseFailure','tool-failed'],['PermissionRequest','permission-requested'],['PermissionDenied','permission-denied']]){
  const input={session_id:'session-a',generation_id:'turn-a',hook_event_name:event,tool_name:'PRIVATE_TOOL',tool_input:{content:'PRIVATE_BODY'},is_truncation_recovery:false};
  const first=payloadWithoutClock((await run(input)).stdout),second=payloadWithoutClock((await run(input)).stdout);
  assert.equal(first.phase,phase);assert.match(first.eventId,/^[A-Za-z0-9_-]{1,160}$/);assert.notEqual(first.eventId,second.eventId);assert.equal(first.isTruncationRecovery,false);assert.equal(JSON.stringify(first).includes('PRIVATE_'),false);
 }
 const continuation=payloadWithoutClock((await run({session_id:'session-a',generation_id:'turn-a',hook_event_name:'UserPromptSubmit',is_internal_continuation:true})).stdout);assert.equal(continuation.isInternalContinuation,true);
 const recovery=payloadWithoutClock((await run({session_id:'session-a',generation_id:'turn-a',hook_event_name:'FinalStop',final_stop_reason:'completed',is_truncation_recovery:true})).stdout);assert.equal(recovery.isTruncationRecovery,true);assert.equal(recovery.finalStopReason,undefined);
 const malformed=await run({session_id:'session-a',hook_event_name:'FinalStop',final_stop_reason:'completed',is_truncation_recovery:'false'});assert.equal(malformed.stdout,'');
});
test('direct global-hook source root takes precedence over an unrelated plugin directory', {skip:process.platform!=='darwin'},async t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-direct-hook-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));let received=null;
 const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{received=JSON.parse(body);res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 fs.writeFileSync(path.join(temp,'receiver.json'),JSON.stringify({version:1,enabled:true,endpoint:`http://127.0.0.1:${server.address().port}/workbuddy/events`,token:'synthetic_direct_hook_capability_123456789012345'}),{mode:0o600});
 const result=await run({session_id:'session-a',generation_id:'turn-a',hook_event_name:'UserPromptSubmit'},{QIUQIU_METADATA_ROOT:temp,CODEBUDDY_PLUGIN_ROOT:'/not-used'});
 assert.deepEqual(result,{code:0,stdout:'',stderr:''});assert.equal(received.event,'UserPromptSubmit');
 const assetScript=path.resolve(__dirname,'../assets/workbuddy-desktop-hook/plugins/qiuqiu-task-events/scripts/emit-metadata.sh');assert.equal(fs.readFileSync(assetScript,'utf8'),fs.readFileSync(script,'utf8'));
 const configured=JSON.parse(fs.readFileSync(path.join(root,'plugins/qiuqiu-task-events/hooks/hooks.json'),'utf8')).hooks;
 for(const name of ['UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied','Stop','StopFailure','FinalStop','SessionEnd'])assert.ok(configured[name]);
});
