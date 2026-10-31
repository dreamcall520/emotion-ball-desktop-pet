const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../docs/mac-app-store/zcode-desktop-hook-draft');
const script=path.join(root,'plugins/qiuqiu-zcode-task-events/scripts/emit-metadata.sh');
function run(input,env={QIUQIU_HOOK_DRY_RUN:'1'}){return new Promise((resolve,reject)=>{const child=spawn('/bin/sh',[script],{env:{PATH:'/usr/bin:/bin',...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(typeof input==='string'?input:JSON.stringify(input));});}
test('source filter only emits fixed lifecycle metadata, never prompt/body/path/token/title', {skip:process.platform!=='darwin'},async()=>{
 const input={sessionId:'session-1',turnId:'turn-1',hookEventName:'UserPromptSubmit',prompt:'PRIVATE_PROMPT_MARKER',last_assistant_message:'PRIVATE_REPLY_MARKER',transcript_path:'/not/read/private-transcript',cwd:'/not/forwarded',accessToken:'PRIVATE_TOKEN_MARKER',session:{secret:'INTERNAL_SESSION'},title:'PRIVATE_TITLE',tool_input:{x:'PRIVATE_ARGUMENT'}};
 const result=await run(input);assert.equal(result.code,0);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{version:1,sessionId:'session-1',turnId:'turn-1',event:'UserPromptSubmit',phase:'submitted'});assert.equal(/PRIVATE_|transcript|cwd|title|prompt/.test(result.stdout),false);
});
test('Stop is only stop-observed, missing/null turn stays uncorrelated, never completed', {skip:process.platform!=='darwin'},async()=>{
 for(const turnId of [undefined,null]){const result=await run({sessionId:'s1',turnId,hookEventName:'Stop',last_assistant_message:'PRIVATE_REPLY'});assert.deepEqual(JSON.parse(result.stdout),{version:1,sessionId:'s1',event:'Stop',phase:'stop-observed'});assert.equal(result.stdout.includes('completed'),false);}
});
test('malformed/oversized input, unknown events or unsafe identifiers emit nothing and do not block original task', {skip:process.platform!=='darwin'},async()=>{
 for(const input of ['{broken',' '.repeat(262145),{sessionId:'../../elsewhere',hookEventName:'Stop'},{sessionId:3,hookEventName:'Stop'},{sessionId:'valid',turnId:'$(something)',hookEventName:'Stop'},{sessionId:'valid',hookEventName:'UnknownEvent'}]){const result=await run(input);assert.deepEqual(result,{code:0,stdout:'',stderr:''});}
});
test('draft is disabled without an App-generated receiver capability; schema has no direct raw HTTP hooks', {skip:process.platform!=='darwin'},async()=>{
 const hooks=JSON.parse(fs.readFileSync(path.join(root,'plugins/qiuqiu-zcode-task-events/hooks/hooks.json'),'utf8')).hooks;
 for(const rows of Object.values(hooks))for(const row of rows)for(const hook of row.hooks){assert.equal(hook.type,'command');assert.equal(hook.command.includes('emit-metadata.sh'),true);assert.equal(hook.timeout,2);}
 const result=await run({sessionId:'s',hookEventName:'Stop'},{ZCODE_PLUGIN_ROOT:path.join(root,'plugins/qiuqiu-zcode-task-events')});assert.deepEqual(result,{code:0,stdout:'',stderr:''});
});
test('App receiver receives only metadata over authenticated loopback, capability is not an argv/URL parameter', {skip:process.platform!=='darwin'},async t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-hook-draft-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));let received=null;
 const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{received={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const token='synthetic_local_capability_12345678901234567890';fs.writeFileSync(path.join(temp,'receiver.json'),JSON.stringify({version:1,enabled:true,endpoint:`http://127.0.0.1:${server.address().port}/zcode/events`,token}),{mode:0o600});
 const result=await run({sessionId:'owned',turnId:'own-turn',hookEventName:'Stop',last_assistant_message:'NEVER_SEND_THIS'},{ZCODE_PLUGIN_ROOT:temp});assert.deepEqual(result,{code:0,stdout:'',stderr:''});assert.equal(received.auth,'Bearer '+token);assert.equal(received.url,'/zcode/events');assert.deepEqual(received.body,{version:1,sessionId:'owned',turnId:'own-turn',event:'Stop',phase:'stop-observed'});
 const source=fs.readFileSync(script,'utf8');assert.equal(source.includes('Authorization: Bearer %s'),true);assert.equal(source.includes('curl --disable --config - --noproxy'),true);assert.equal(source.includes('transcript_path'),false);
});
test('ZCode uses documented native camelCase fields and only the three reviewed events', {skip:process.platform!=='darwin'},async()=>{
 for(const hookEventName of ['SessionStart','UserPromptSubmit','Stop']){const out=await run({sessionId:'s',turnId:'t',hookEventName});assert.equal(JSON.parse(out.stdout).event,hookEventName);}
 for(const hookEventName of ['SessionEnd','FinalStop','StopFailure'])assert.equal((await run({sessionId:'s',turnId:'t',hookEventName})).stdout,'');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'plugins/qiuqiu-zcode-task-events/.zcode-plugin/plugin.json')));assert.equal(manifest.hooks,undefined);
 const hooks=JSON.parse(fs.readFileSync(path.join(root,'plugins/qiuqiu-zcode-task-events/hooks/hooks.json'))).hooks;assert.deepEqual(Object.keys(hooks),['SessionStart','UserPromptSubmit','Stop']);
 for(const rows of Object.values(hooks))assert.match(rows[0].hooks[0].command,/ZCODE_PLUGIN_ROOT/);
});
