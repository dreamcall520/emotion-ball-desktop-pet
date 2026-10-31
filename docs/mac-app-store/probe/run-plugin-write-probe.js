#!/usr/bin/env node
'use strict';
// Synthetic native write-scope boundary only. No user provider/profile access.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
const run=async(command,args,timeout=60000)=>(await execute(command,args,{timeout,maxBuffer:1024*1024})).stdout;
(async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'qiuqiu-plugin-write-'));
 const bundle=path.join(scratch,'QiuqiuPluginWriteProbe.app'),contents=path.join(bundle,'Contents'),binary=path.join(contents,'MacOS/probe'),helper=path.join(contents,'Helpers/write-helper'),fixture=path.join(scratch,'synthetic-install-target');
 const probe=__dirname;
 await fs.mkdir(path.dirname(binary),{recursive:true});await fs.mkdir(path.dirname(helper),{recursive:true});await fs.mkdir(fixture);
 await fs.writeFile(path.join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.pluginwriteprobe</string><key>CFBundleName</key><string>QiuqiuPluginWriteProbe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
 await run('xcrun',['swiftc',path.join(probe,'PluginInstallWriteProbe.swift'),'-o',binary]);
 await fs.copyFile(binary,helper);
 const baseline=JSON.parse(await run(binary,['child',fixture]));
 const entitlement=path.join(scratch,'write.entitlements.plist');await fs.writeFile(entitlement,'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.files.user-selected.read-write</key><true/><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>');
 await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',path.join(probe,'inherit.entitlements.plist'),helper]);
 await run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',entitlement,bundle]);await run('codesign',['--verify','--deep','--strict',bundle]);
 const inspect=JSON.parse(await run(binary,['inspect',fixture]));
 process.stderr.write(JSON.stringify({syntheticProbeBundle:bundle,syntheticFixture:fixture,source:'PluginInstallWriteProbe.swift'})+'\n');
 const phases={};
 for(const phase of ['authorize','resume','revoke'])phases[phase]=JSON.parse(await run(binary,[phase,fixture],180000));
 const parentWrite=p=>p?.parentWrite?.written===true;
 const helperWrite=p=>p?.inheritedHelperWrite?.result?.written===true;
 const result={diagnostic:'native ad-hoc App Sandbox synthetic selected write scope; not Electron MAS acceptance',baseline,inspect,...phases,sourceBeforeAnyProviderAccess:true,providerCredentialsRead:false,modelRequests:0,parentWriteLifecycleObserved:baseline.written&&!parentWrite(inspect)&&parentWrite(phases.authorize)&&parentWrite(phases.resume)&&!parentWrite(phases.revoke),inheritedHelperWriteLifecycleObserved:!helperWrite(inspect)&&helperWrite(phases.authorize)&&helperWrite(phases.resume)&&!helperWrite(phases.revoke),scratchRetainedForEvidence:true};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.parentWriteLifecycleObserved)process.exitCode=2;
})().catch(error=>{process.stderr.write(JSON.stringify({status:'failed',message:error.message})+'\n');process.exitCode=1;});
