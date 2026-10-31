'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {probeManagedHelpers,probeTaskMetadataTransport}=require('../lib/mas-helper-probe');
function fixture(t,options={}){
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-helper-fixture-'));t.after(()=>fs.rmSync(userData,{recursive:true,force:true}));
 const calls=[],roots=[];let root;
 const create=(provider,args)=>{calls.push(provider+'-create');root=path.dirname(args.profileHome);assert.deepEqual(Object.keys(args.env).sort(),['LANG','PATH','TMPDIR']);assert.equal(args.env.TMPDIR,path.join(root,'tmp'));assert.equal(fs.statSync(args.env.TMPDIR).mode&0o777,0o700);roots.push(root);assert.equal(path.dirname(root),userData);assert.equal(fs.statSync(root).mode&0o777,0o700);fs.mkdirSync(args.profileHome,{mode:0o700});fs.mkdirSync(args.workspaceDir,{mode:0o700});fs.writeFileSync(path.join(args.profileHome,'synthetic-only'),'fixture');};
 const proxy=allowed=>new Proxy(allowed,{get(object,key){if(key==='then')return undefined;if(!Object.hasOwn(object,key))throw new Error('FORBIDDEN '+String(key));return object[key];}});
 return{userData,resourcesPath:'/synthetic/resources',calls,roots,get root(){return root;},metadataProbe:async({scratch})=>{assert.equal(scratch,root);return{passed:!options.metadataFail,errorCode:options.metadataFail?'MAS_METADATA_PROBE_FAILED':null};},
  createCodexRpc:async args=>{create('codex',args);assert.equal(args.timeoutMs,15000);return proxy({start:async()=>{calls.push('codex-start');if(options.codexFail)throw new Error('SECRET-RAW-ERROR');},readAccount:async()=>{calls.push('codex-account');return{authenticated:options.authenticated===true,accountKey:'PRIVATE-KEY-DO-NOT-EMIT'};},close:async()=>{calls.push('codex-close');if(options.closeFail)throw new Error('PRIVATE-CLOSE');}});},
  startWorkbuddyHost:async args=>{create('workbuddy',args);assert.equal(args.timeoutMs,30000);if(options.workbuddyFail)throw new Error('PRIVATE-WB-ERROR');return proxy({gatewayAuthenticated:true,vendorAccountVerified:options.vendorVerified===true,gatewayPassword:'PRIVATE-PASSWORD',stop:async()=>{calls.push('workbuddy-stop');}});}
 };
}
test('fresh700 profiles verify Codex initialization+unauthenticated account and WB gateway only; cleanup and no model/login methods',async t=>{
 const f=fixture(t),result=await probeManagedHelpers(f);assert.equal(result.passed,true);assert.deepEqual(f.calls,['codex-create','codex-start','codex-account','codex-close','workbuddy-create','workbuddy-stop']);assert.equal(f.roots[0],f.roots[1]);assert.equal(fs.existsSync(f.root),false);assert.equal(result.isolatedProfileRemoved,true);assert.equal(result.codex.unauthenticatedAccountConfirmed,true);assert.equal(result.workbuddy.vendorAccountVerified,false);assert.equal(result.workbuddy.vendorAccountAuthenticationTested,false);assert.equal(result.modelRequestsSent,false);assert.equal(result.originalCredentialsRead,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|synthetic|fixture-|PASSWORD/);
});
test('Codex error closes child, WB still probes, safe code only and own fixtures removed',async t=>{
 const f=fixture(t,{codexFail:true}),result=await probeManagedHelpers(f);assert.equal(result.passed,false);assert.equal(result.codex.errorCode,'MAS_HELPER_PROBE_CODEX_INITIALIZATION_FAILED');assert.equal(result.codex.closed,true);assert.equal(result.workbuddy.gatewayAuthenticated,true);assert.equal(fs.existsSync(f.root),false);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE/);
});
test('unexpected preauthenticated account never passes fresh-profile probe; WB vendor status is not called authenticated',async t=>{
 const f=fixture(t,{authenticated:true,vendorVerified:true}),result=await probeManagedHelpers(f);assert.equal(result.passed,false);assert.equal(result.codex.unauthenticatedAccountConfirmed,false);assert.equal(result.codex.errorCode,'MAS_HELPER_PROBE_CODEX_ACCOUNT_UNEXPECTED');assert.equal(result.workbuddy.vendorAccountVerified,true);assert.equal(result.workbuddy.vendorAccountAuthenticationTested,false);assert.equal(result.workbuddy.errorCode,'MAS_HELPER_PROBE_WORKBUDDY_STATE_UNEXPECTED');assert.equal(result.workbuddy.stopCompleted,true);
});
test('WB startup failure and close failure cannot pass or expose raw diagnostics',async t=>{
 const f=fixture(t,{workbuddyFail:true,closeFail:true}),result=await probeManagedHelpers(f);assert.equal(result.passed,false);assert.equal(result.codex.errorCode,'MAS_HELPER_PROBE_CODEX_CLOSE_FAILED');assert.equal(result.workbuddy.errorCode,'MAS_HELPER_PROBE_WORKBUDDY_INITIALIZATION_FAILED');assert.equal(result.isolatedProfileRemoved,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('unsafe/symlink profile root never launches helpers and does not remove user root',async t=>{
 const f=fixture(t),link=path.join(f.userData,'link');fs.symlinkSync(f.userData,link);const result=await probeManagedHelpers({...f,userData:link});assert.equal(result.errorCode,'MAS_HELPER_PROBE_PROFILE_FAILED');assert.deepEqual(f.calls,[]);assert.equal(fs.existsSync(f.userData),true);
});
test('cleanup failure is explicit and cannot be recorded as passed',async t=>{
 const f=fixture(t),result=await probeManagedHelpers({...f,io:{...fs.promises,rm:async()=>{throw Error('PRIVATE-PATH');}}});assert.equal(result.passed,false);assert.equal(result.isolatedProfileRemoved,false);assert.equal(result.errorCode,'MAS_HELPER_PROBE_CLEANUP_FAILED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('isolated synthetic metadata HTTP roundtrips verify both receiver auth and terminal boundaries, then revoke',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-metadata-fixture-')),scratch=fs.mkdtempSync(path.join(base,'mas-helper-probe-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const record=await probeTaskMetadataTransport({scratch});assert.equal(record.passed,true);for(const provider of ['workbuddy','zcode']){const row=record[provider];for(const key of ['started','unauthenticatedRejected','authenticatedEventReceived','stopNotFinal','revoked','receiverClosed'])assert.equal(row[key],true,provider+' '+key);assert.equal(fs.existsSync(path.join(scratch,provider+'-synthetic-events','grant.json')),false);assert.equal(fs.existsSync(path.join(scratch,provider+'-synthetic-events','installation-observed.json')),false);}assert.equal(record.workbuddy.finalStopMainReplyOnly,true);assert.equal(record.syntheticMetadataOnly,true);assert.equal(record.originalPluginConfigurationChanged,false);assert.doesNotMatch(JSON.stringify(record),/127\.0\.0\.1|Bearer|mas-probe-session|mas-probe-turn|fixture-|endpoint|token/);
});
test('existing receiver root is not restored or read; probe fails closed without modifying it',async t=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mas-helper-probe-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));const root=path.join(scratch,'workbuddy-synthetic-events');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'grant.json'),'must-not-read-or-modify');let calls=0;
 const result=await probeTaskMetadataTransport({scratch,createWorkbuddyIntegration:()=>{calls++;throw Error('must-not-run');},createZcodeIntegration:()=>{throw Error('synthetic failure');}});assert.equal(result.passed,false);assert.equal(calls,0);assert.equal(fs.readFileSync(path.join(root,'grant.json'),'utf8'),'must-not-read-or-modify');assert.equal(result.workbuddy.errorCode,'MAS_METADATA_PROBE_WORKBUDDY_FAILED');assert.doesNotMatch(JSON.stringify(result),/must-not-read/);
});
test('managed helper acceptance requires metadata probe success and still cleans its scratch on failure',async t=>{const f=fixture(t,{metadataFail:true}),result=await probeManagedHelpers(f);assert.equal(result.passed,false);assert.equal(result.metadataTransport.passed,false);assert.equal(result.isolatedProfileRemoved,true);assert.equal(fs.existsSync(f.root),false);});

test('real synthetic metadata transport remains inside managed scratch and is deleted after helper probe',async t=>{const f=fixture(t),record=await probeManagedHelpers({...f,metadataProbe:probeTaskMetadataTransport});assert.equal(record.passed,true);assert.equal(record.metadataTransport.passed,true);assert.equal(record.isolatedProfileRemoved,true);assert.equal(fs.existsSync(f.root),false);assert.deepEqual(fs.readdirSync(f.userData),[]);});
