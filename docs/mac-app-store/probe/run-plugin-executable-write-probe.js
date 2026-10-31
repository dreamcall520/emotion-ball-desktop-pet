#!/usr/bin/env node
'use strict';
// Only self-created synthetic scripts. Never changes production entitlements.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),run=async(command,args,timeout=60000)=>(await execute(command,args,{timeout,maxBuffer:1024*1024})).stdout;
(async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'qiuqiu-plugin-executable-'));
 const compiled=path.join(scratch,'probe');await run('xcrun',['swiftc',path.join(__dirname,'PluginExecutableWriteProbe.swift'),'-o',compiled]);
 const reports={};
 for(const executable of [false,true]){
  const name=executable?'withExecutable':'withoutExecutable',base=path.join(scratch,name),bundle=path.join(base,'ExecutableProbe.app'),contents=path.join(bundle,'Contents'),binary=path.join(contents,'MacOS/probe'),helper=path.join(contents,'Helpers/script-helper'),fixture=path.join(base,'synthetic-script-target');
  await fs.mkdir(path.dirname(binary),{recursive:true});await fs.mkdir(path.dirname(helper),{recursive:true});await fs.mkdir(fixture);
  await fs.writeFile(path.join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.executableprobe.'+(executable?'enabled':'disabled')+'</string><key>CFBundleName</key><string>QiuqiuExecutableProbe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  await fs.copyFile(compiled,binary);await fs.copyFile(compiled,helper);
  const rights=path.join(base,'rights.plist');await fs.writeFile(rights,'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.files.user-selected.read-write</key><true/><key>com.apple.security.files.bookmarks.app-scope</key><true/>'+(executable?'<key>com.apple.security.files.user-selected.executable</key><true/>':'')+'</dict></plist>');
  await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',path.join(__dirname,'inherit.entitlements.plist'),helper]);await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',rights,bundle]);await run('codesign',['--verify','--deep','--strict',bundle]);
  process.stderr.write(JSON.stringify({case:name,syntheticProbeBundle:bundle,syntheticFixture:fixture})+'\n');
  const authorization=JSON.parse(await run(binary,['authorize',fixture],180000));
  const executions={};
  for(const writer of ['parent','helper']){
   const file=path.join(fixture,writer+'.sh');let mode=null,quarantine=null,executed=false,outputMatched=false,errorCode=null;
   try{mode=(await fs.stat(file)).mode&0o777;}catch{}
   try{quarantine=(await run('/usr/bin/xattr',['-p','com.apple.quarantine',file])).trim();}catch(error){quarantine=error.code===1?'absent':'unavailable';}
   try{const stdout=await run(file,[],5000);executed=true;outputMatched=stdout==='synthetic-executable-ok\n';}catch(error){errorCode=typeof error.code==='string'?error.code:Number.isSafeInteger(error.code)?error.code:'unknown';}
   executions[writer]={mode,quarantine,executed,outputMatched,errorCode};
  }
  const revoke=JSON.parse(await run(binary,['revoke',fixture]));
  reports[name]={executableEntitlement:executable,authorization,nonSandboxHostExecutions:executions,revoke};
 }
 process.stdout.write(JSON.stringify({diagnostic:'native ad-hoc App Sandbox synthetic program write plus unsandboxed synthetic-host execution; not Electron MAS or App Review',...reports,productionEntitlementsChanged:false,realToolsTouched:false,providerCredentialsRead:false,modelRequests:0,scratchRetainedForEvidence:true},null,2)+'\n');
})().catch(error=>{process.stderr.write(JSON.stringify({status:'failed',message:error.message})+'\n');process.exitCode=1;});
