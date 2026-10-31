#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
const run=async(command,args,timeout=60000)=>(await execute(command,args,{timeout,maxBuffer:1024*1024})).stdout;
(async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'qiuqiu-plugin-lifecycle-'));
 const bundle=path.join(scratch,'LifecycleProbe.app'),target=path.join(scratch,'LifecycleFixture.app'),contents=path.join(bundle,'Contents'),binary=path.join(contents,'MacOS/probe'),helper=path.join(contents,'Helpers/lifecycle-helper'),targetBin=path.join(target,'Contents/MacOS/fixture');
 const plist=(id,name,exec)=>'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>'+id+'</string><key>CFBundleName</key><string>'+name+'</string><key>CFBundleExecutable</key><string>'+exec+'</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>';
 await fs.mkdir(path.dirname(binary),{recursive:true});await fs.mkdir(path.dirname(helper),{recursive:true});await fs.mkdir(path.dirname(targetBin),{recursive:true});
 await fs.writeFile(path.join(contents,'Info.plist'),plist('local.xiaokun.emotionball.lifecycleprobe','QiuqiuLifecycleProbe','probe'));
 await fs.writeFile(path.join(target,'Contents/Info.plist'),plist('local.xiaokun.emotionball.lifecyclefixture','QiuqiuLifecycleFixture','fixture'));
 await run('xcrun',['swiftc',path.join(__dirname,'PluginInstallerAppLifecycleProbe.swift'),'-o',binary]);await fs.copyFile(binary,helper);await fs.copyFile(binary,targetBin);
 // The synthetic target always runs its inert fixture branch, including workspace relaunch.
 const launcher=path.join(target,'Contents/MacOS/fixture-launcher');await fs.writeFile(launcher,'#!/bin/sh\nexec "$(dirname "$0")/fixture" fixture\n',{mode:0o700});
 await fs.writeFile(path.join(target,'Contents/Info.plist'),plist('local.xiaokun.emotionball.lifecyclefixture','QiuqiuLifecycleFixture','fixture-launcher'));
 await run('codesign',['--force','--sign','-','--timestamp=none',target]);
 const cleanupExecutables=[await fs.realpath(targetBin),await fs.realpath(launcher)];
 const fixture=spawn(targetBin,['fixture'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,500));
 try{
   const baseline=JSON.parse(await run(binary,[target],30000));
   // Wait for launch to settle before running the sandbox comparator.
   await new Promise(r=>setTimeout(r,500));
   const ent=path.join(scratch,'sandbox.plist');await fs.writeFile(ent,'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.files.user-selected.read-write</key><true/><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>');
   await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',path.join(__dirname,'inherit.entitlements.plist'),helper]);await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',ent,bundle]);await run('codesign',['--verify','--deep','--strict',bundle]);
   const sandbox=JSON.parse(await run(binary,[target],30000));
   // Termination was denied in the sandbox comparator. Only clean our inert
   // fixture from the unsandboxed harness, then separately test sandbox launch.
   const beforeLaunch=await run('ps',['-axo','pid=,comm=']);for(const line of beforeLaunch.split('\n')){const m=line.trim().match(/^(\d+) (.+)$/);if(m&&cleanupExecutables.includes(m[2]))try{process.kill(Number(m[1]),'SIGTERM');}catch{}}
   await new Promise(r=>setTimeout(r,500));
   const sandboxLaunchOnly=JSON.parse(await run(binary,[target,'launch-only'],30000));
   process.stdout.write(JSON.stringify({diagnostic:'native ad-hoc sandbox plus inherited helper; only fixed self-created synthetic App lifecycle; not Electron MAS acceptance',baseline,sandbox,sandboxLaunchOnly,realToolsTouched:false,automationEntitlement:false,accessibilityPermission:false,scratchRetainedForEvidence:true},null,2)+'\n');
 }finally{
   // Only the exact inert fixture executable created above is cleanup-eligible.
   const ps=await run('ps',['-axo','pid=,comm=']);for(const line of ps.split('\n')){const m=line.trim().match(/^(\d+) (.+)$/);if(m&&cleanupExecutables.includes(m[2]))try{process.kill(Number(m[1]),'SIGTERM');}catch{}}
 }
})().catch(error=>{process.stderr.write(JSON.stringify({status:'failed',message:error.message})+'\n');process.exitCode=1;});
