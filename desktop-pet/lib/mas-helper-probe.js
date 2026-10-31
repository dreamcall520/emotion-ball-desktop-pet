'use strict';
// Development-only MAS bootstrap probe. Fresh profiles, no login/model/session calls.
const fs=require('node:fs'),path=require('node:path');
async function probeTaskMetadataTransport({scratch,request=globalThis.fetch,
 createWorkbuddyIntegration,createZcodeIntegration}={}){
 const result={workbuddy:{started:false,unauthenticatedRejected:false,authenticatedEventReceived:false,stopNotFinal:false,finalStopMainReplyOnly:false,revoked:false,receiverClosed:false,errorCode:null},
  zcode:{started:false,unauthenticatedRejected:false,authenticatedEventReceived:false,stopNotFinal:false,revoked:false,receiverClosed:false,errorCode:null},
  syntheticMetadataOnly:true,originalPluginConfigurationChanged:false,passed:false,errorCode:null};
 if(typeof scratch!=='string'||!path.isAbsolute(scratch)||!path.basename(scratch).startsWith('mas-helper-probe-')||typeof request!=='function'){result.errorCode='MAS_METADATA_PROBE_INVALID_INPUT';return result;}
 try{const stat=await fs.promises.lstat(scratch);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();}catch(_){result.errorCode='MAS_METADATA_PROBE_INVALID_SCRATCH';return result;}
 const factories={workbuddy:createWorkbuddyIntegration||require('./workbuddy-desktop-integration').createWorkBuddyDesktopIntegration,
  zcode:createZcodeIntegration||require('./zcode-desktop-integration').createZcodeDesktopIntegration};
 for(const provider of ['workbuddy','zcode']){
  const state=result[provider],root=path.join(scratch,provider+'-synthetic-events');let integration,config;
  async function send(metadata,authenticated){
   const response=await request(config.endpoint,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+config.token}:{})},body:JSON.stringify(metadata),redirect:'error',signal:AbortSignal.timeout(1500)});
   await response.body?.cancel();return response.status;
  }
  try{
   // Never restore/read an existing receiver or a main-application grant.
   try{await fs.promises.lstat(root);throw Error('already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
   integration=factories[provider]({root,assetRoot:path.join(__dirname,'../assets/'+provider+'-desktop-hook')});
   await integration.prepare();state.started=integration.getState().enabled===true;
   config=JSON.parse(await fs.promises.readFile(path.join(root,'grant.json'),'utf8'));
   const endpoint=new URL(config.endpoint);
   if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'+provider+'/events'||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||typeof config.token!=='string')throw Error();
   const correlation=provider==='workbuddy'?{generationId:'mas-probe-turn'}:{turnId:'mas-probe-turn'};
   const submitted={version:1,sessionId:'mas-probe-session',...correlation,event:'UserPromptSubmit',phase:'submitted'};
   state.unauthenticatedRejected=await send(submitted,false)===401&&integration.getState().observations.length===0;
   state.authenticatedEventReceived=await send(submitted,true)===202&&integration.getState().observations.some(row=>row.phase==='submitted');
   const stop={...submitted,event:'Stop',phase:'stop-observed'};
   const stopped=await send(stop,true),afterStop=integration.getState();
   state.stopNotFinal=stopped===202&&afterStop.observations.some(row=>row.phase==='stop-observed')&&afterStop.observations.every(row=>row.terminalConfirmed===false&&row.terminalKind===null)&&afterStop.mainReplyTerminalVerified===false&&afterStop.overallTaskVerified===false;
   if(provider==='workbuddy'){
    const final=await send({...submitted,event:'FinalStop',phase:'final-stop-observed',finalStopReason:'completed'},true),afterFinal=integration.getState();
    state.finalStopMainReplyOnly=final===202&&afterFinal.mainReplyTerminalVerified===true&&afterFinal.observations.some(row=>row.terminalConfirmed===true&&row.terminalKind==='main-reply'&&row.state==='completed')&&afterFinal.overallTaskVerified===false&&afterFinal.terminalTaskStateVerified===false;
   }
  }catch(_){state.errorCode='MAS_METADATA_PROBE_'+provider.toUpperCase()+'_FAILED';}
  finally{
   if(integration){
    try{
     await integration.revoke();state.revoked=integration.getState().enabled===false;
     for(const name of ['grant.json','installation-observed.json']){try{await fs.promises.lstat(path.join(root,name));state.revoked=false;}catch(error){if(error.code!=='ENOENT')throw error;}}
     if(config){try{await send({version:1,sessionId:'mas-probe-revoked',event:'Stop',phase:'stop-observed'},true);}catch(_){state.receiverClosed=true;}}
    }catch(_){state.errorCode='MAS_METADATA_PROBE_'+provider.toUpperCase()+'_REVOKE_FAILED';}
    try{await integration.close();}catch(_){state.errorCode='MAS_METADATA_PROBE_'+provider.toUpperCase()+'_CLOSE_FAILED';}
   }
  }
 }
 result.passed=!result.errorCode&&Object.values({workbuddy:result.workbuddy,zcode:result.zcode}).every(state=>state.started&&state.unauthenticatedRejected&&state.authenticatedEventReceived&&state.stopNotFinal&&state.revoked&&state.receiverClosed&&!state.errorCode)&&result.workbuddy.finalStopMainReplyOnly;
 return result;
}
async function probeManagedHelpers({userData,resourcesPath,createCodexRpc,startWorkbuddyHost,metadataProbe=probeTaskMetadataTransport,io=fs.promises}={}){
 const result={isolatedProfileCreated:false,isolatedProfileRemoved:false,
  codex:{initialized:false,unauthenticatedAccountConfirmed:false,closed:false,errorCode:null},
  workbuddy:{gatewayAuthenticated:false,vendorAccountVerified:false,vendorAccountAuthenticationTested:false,stopCompleted:false,processExitVerified:false,errorCode:null},
  metadataTransport:null,modelRequestsSent:false,originalCredentialsRead:false,passed:false,errorCode:null};
 if(typeof userData!=='string'||!path.isAbsolute(userData)||userData.includes('\0')||typeof resourcesPath!=='string'||!path.isAbsolute(resourcesPath)||typeof createCodexRpc!=='function'||typeof startWorkbuddyHost!=='function'){
  result.errorCode='MAS_HELPER_PROBE_INVALID_INPUT';return result;
 }
 let scratch,rpc,host,childEnv;
 try{
  const stat=await io.lstat(userData);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();
  scratch=await io.mkdtemp(path.join(userData,'mas-helper-probe-'));await io.chmod(scratch,0o700);const tempDir=path.join(scratch,'tmp');await io.mkdir(tempDir,{mode:0o700});childEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:tempDir};result.isolatedProfileCreated=true;
 }catch(_){result.errorCode='MAS_HELPER_PROBE_PROFILE_FAILED';if(scratch){try{await io.rm(scratch,{recursive:true,force:true});result.isolatedProfileRemoved=true;}catch(_){result.errorCode='MAS_HELPER_PROBE_CLEANUP_FAILED';}}return result;}
 try{
  try{
   rpc=await createCodexRpc({resourcesPath,env:{...childEnv},profileHome:path.join(scratch,'codex-profile'),workspaceDir:path.join(scratch,'codex-workspace'),timeoutMs:15000});
   await rpc.start();result.codex.initialized=true;
   const account=await rpc.readAccount();
   if(account?.authenticated!==false){result.codex.errorCode='MAS_HELPER_PROBE_CODEX_ACCOUNT_UNEXPECTED';}
   else result.codex.unauthenticatedAccountConfirmed=true;
  }catch(_){result.codex.errorCode='MAS_HELPER_PROBE_CODEX_INITIALIZATION_FAILED';}
  finally{if(rpc){try{await rpc.close();result.codex.closed=true;}catch(_){result.codex.errorCode='MAS_HELPER_PROBE_CODEX_CLOSE_FAILED';}}}
  try{
   host=await startWorkbuddyHost({resourcesPath,env:{...childEnv},profileHome:path.join(scratch,'workbuddy-profile'),workspaceDir:path.join(scratch,'workbuddy-workspace'),timeoutMs:30000});
   result.workbuddy.gatewayAuthenticated=host.gatewayAuthenticated===true;result.workbuddy.vendorAccountVerified=host.vendorAccountVerified===true;
   if(!result.workbuddy.gatewayAuthenticated||host.vendorAccountVerified!==false)result.workbuddy.errorCode='MAS_HELPER_PROBE_WORKBUDDY_STATE_UNEXPECTED';
  }catch(_){result.workbuddy.errorCode='MAS_HELPER_PROBE_WORKBUDDY_INITIALIZATION_FAILED';}
  finally{if(host){try{await host.stop();result.workbuddy.stopCompleted=true;}catch(_){result.workbuddy.errorCode='MAS_HELPER_PROBE_WORKBUDDY_STOP_FAILED';}}}
  try{result.metadataTransport=await metadataProbe({scratch});}catch(_){result.metadataTransport={passed:false,errorCode:'MAS_METADATA_PROBE_FAILED'};}
 }finally{
  try{await io.rm(scratch,{recursive:true,force:true});result.isolatedProfileRemoved=true;}
  catch(_){result.errorCode='MAS_HELPER_PROBE_CLEANUP_FAILED';}
 }
 result.passed=result.isolatedProfileCreated&&result.isolatedProfileRemoved&&!result.errorCode&&result.codex.initialized&&result.codex.unauthenticatedAccountConfirmed&&result.codex.closed&&!result.codex.errorCode&&result.workbuddy.gatewayAuthenticated&&result.workbuddy.stopCompleted&&!result.workbuddy.errorCode&&result.metadataTransport?.passed===true;
 return result;
}
module.exports={probeManagedHelpers,probeTaskMetadataTransport};
