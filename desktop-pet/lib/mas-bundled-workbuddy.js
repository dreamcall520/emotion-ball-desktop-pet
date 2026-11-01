'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {createHash,randomBytes}=require('node:crypto');
const VERSION='2.179.0',ENTRY='node_modules/@tencent-ai/codebuddy-code/bin/codebuddy';
const fail=code=>Object.assign(new Error(code),{code});
const absolute=x=>typeof x==='string'&&path.isAbsolute(x)&&!x.includes('\0');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sha(file){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW}))hash.update(chunk);return hash.digest('hex');}
async function resolveBundledWorkBuddy({resourcesPath}={}){
 if(!absolute(resourcesPath))throw fail('INVALID_INPUT');
 const directory=path.join(resourcesPath,'qiuqiu-workbuddy');
 try{
  for(const dir of [resourcesPath,directory]){const s=await fs.promises.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw fail('BUNDLED_RUNTIME_INVALID');}
  const manifestPath=path.join(directory,'manifest.json'),ms=await fs.promises.lstat(manifestPath);
  if(!ms.isFile()||ms.isSymbolicLink()||ms.size>2*1024*1024)throw fail('BUNDLED_RUNTIME_INVALID');
  const manifest=JSON.parse(await fs.promises.readFile(manifestPath,'utf8')),files=manifest.files;
  if(manifest.schemaVersion!==1||manifest.provider!=='workbuddy-cli'||manifest.version!==VERSION||manifest.license!=='MIT'||manifest.entry!==ENTRY||!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).length>10000||!files[ENTRY]||!files['node_modules/@tencent-ai/codebuddy-code/LICENSE.txt'])throw fail('BUNDLED_RUNTIME_INVALID');
  const checked=new Set();
  for(const [relative,digest] of Object.entries(files)){
   if(!relative.startsWith('node_modules/')||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..')||!/^[-_./@%A-Za-z0-9]+$/.test(relative)||!/^([a-f0-9]{64})$/.test(digest))throw fail('BUNDLED_RUNTIME_INVALID');
   const filename=path.join(directory,relative);let parent=path.dirname(filename);
   while(parent!==directory&&!checked.has(parent)){const s=await fs.promises.lstat(parent);if(!s.isDirectory()||s.isSymbolicLink())throw fail('BUNDLED_RUNTIME_INVALID');checked.add(parent);parent=path.dirname(parent);}
   const s=await fs.promises.lstat(filename);if(!s.isFile()||s.isSymbolicLink()||s.size>256*1024*1024||await sha(filename)!==digest)throw fail('BUNDLED_RUNTIME_INVALID');
  }
  return {entry:path.join(directory,ENTRY),version:VERSION};
 }catch(error){throw fail(error.code==='ENOENT'?'BUNDLED_RUNTIME_MISSING':'BUNDLED_RUNTIME_INVALID');}
}
async function privateDirectory(dir){
 let part=path.parse(dir).root;
 for(const segment of path.relative(part,dir).split(path.sep)){
  part=path.join(part,segment);
  try{const s=await fs.promises.lstat(part);if(!s.isDirectory()||s.isSymbolicLink())throw fail('UNSAFE_CONFIG');}
  catch(e){if(e.code!=='ENOENT')throw e;await fs.promises.mkdir(part,{mode:0o700});}
 }
 await fs.promises.chmod(dir,0o700);
}
async function allocatePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function buildWorkBuddyArgs(port){return ['--serve','--host','127.0.0.1','--port',String(port),'--auth','password','--agent','cli',
 '--permission-mode','dontAsk','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','user','--settings',JSON.stringify({disableAllHooks:true,permissions:{deny:['*','mcp__*'],allow:[],disableBypassPermissionsMode:'disable',disableAutoMode:'disable'}})];}
async function startBundledWorkBuddy({resourcesPath,profileHome,workspaceDir,env=process.env,forkProcess,request=globalThis.fetch,
 reservePort=allocatePort,timeoutMs=30000,signal,onExit=()=>{}}={}){
 if(!absolute(profileHome)||!absolute(workspaceDir)||path.resolve(profileHome)===path.resolve(os.homedir())||typeof request!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw fail('INVALID_INPUT');
 if(signal?.aborted)throw fail('CANCELLED');
 const bundle=await resolveBundledWorkBuddy({resourcesPath});
 for(const dir of [profileHome,path.join(profileHome,'profile'),workspaceDir])await privateDirectory(dir);
 const port=await reservePort();if(!Number.isInteger(port)||port<1||port>65535)throw fail('INVALID_INPUT');
 const gatewayPassword=randomBytes(32).toString('base64url'),endpoint=`http://127.0.0.1:${port}`;
 const childEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!/^(CODEBUDDY_|SERVER__|ELECTRON_|ANTHROPIC_|OPENAI_|BIGMODEL_|ZAI_|GEMINI_|OTEL_|GALILEO_|CLAUDE_CODE_ENABLE_TELEMETRY$)/.test(key)&&!['HOME','NODE_OPTIONS','NODE_PATH'].includes(key)));
 Object.assign(childEnv,{HOME:profileHome,CODEBUDDY_CONFIG_DIR:path.join(profileHome,'profile'),DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',DISABLE_GALILEO:'1',CODEBUDDY_GATEWAY_AUTH:'password',CODEBUDDY_GATEWAY_PASSWORD:gatewayPassword,CODEBUDDY_DISABLE_CRON:'1',CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS:'1',CODEBUDDY_AGENT_HOME_ORCHESTRATION_ENABLED:'0',BROWSER:path.join(path.dirname(bundle.entry),'qiuqiu-browser-disabled')});
 // Electron's signed utility helper provides Node; never use external node/npm,
 // ELECTRON_RUN_AS_NODE, Terminal, shell, or installed WorkBuddy executables.
 const fork=forkProcess||((entry,args,options)=>require('electron').utilityProcess.fork(entry,args,options));
 let child,exited=false,stopFlight,stopped=false;
 const abort=()=>{void stop();};
 async function stop(){if(stopFlight)return stopFlight;stopped=true;signal?.removeEventListener('abort',abort);stopFlight=(async()=>{if(!child||exited)return;try{child.kill();}catch(_){}for(let i=0;i<40&&!exited;i++)await pause(25);})();return stopFlight;}
 try{
  if(signal?.aborted)throw fail('CANCELLED');
  child=fork(bundle.entry,buildWorkBuddyArgs(port),{cwd:workspaceDir,env:childEnv,stdio:'pipe',serviceName:'球球 WorkBuddy 连接'});
  child.stdout?.on('error',()=>{});child.stderr?.on('error',()=>{});child.stdout?.resume();child.stderr?.resume();
  child.once('exit',()=>{exited=true;signal?.removeEventListener('abort',abort);try{onExit();}catch(_){}});child.once('error',()=>{exited=true;});
  signal?.addEventListener('abort',abort,{once:true});
  const deadline=Date.now()+timeoutMs;let ready=false;
  while(!stopped&&!exited&&Date.now()<deadline){
   try{const r=await request(endpoint+'/api/v1/auth/status',{headers:{Authorization:'Bearer '+gatewayPassword,'X-CodeBuddy-Request':'1'},redirect:'error',signal:AbortSignal.timeout(Math.min(1500,Math.max(1,deadline-Date.now())))});
    if(r.status===200&&!r.redirected){const text=await r.text();if(text.length<4096){const x=JSON.parse(text);ready=x.authEnabled===true&&x.authenticated===true;}}
    else await r.body?.cancel();
   }catch(_){}
   if(ready)break;await pause(100);
  }
  if(stopped||signal?.aborted)throw fail('CANCELLED');
  if(!ready||exited)throw fail(exited?'BUNDLED_RUNTIME_EXITED':'BUNDLED_RUNTIME_TIMEOUT');
  // Private main-process handle. The password must never enter a public snapshot.
  return {endpoint,gatewayPassword,workspaceDir,cliVersion:VERSION,stop,gatewayAuthenticated:true,vendorAccountVerified:false};
 }catch(error){await stop();throw fail(['CANCELLED','BUNDLED_RUNTIME_EXITED','BUNDLED_RUNTIME_TIMEOUT'].includes(error.code)?error.code:'BUNDLED_RUNTIME_START_FAILED');}
}
module.exports={resolveBundledWorkBuddy,startBundledWorkBuddy,buildWorkBuddyArgs,VERSION};
