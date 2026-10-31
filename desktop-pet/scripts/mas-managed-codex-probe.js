#!/usr/bin/env node
'use strict';
// Native inherited-helper boundary probe. Does not replace Electron MAS acceptance.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-managed-sandbox-'));
function run(file,args){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});if(r.status!==0||r.error)throw Object.assign(new Error('PROBE_TOOL_FAILED'),{tool:path.basename(file),status:r.status});return r.stdout;}
try{
 const bundle=path.join(temp,'QiuqiuManagedCodexProbe.app'),contents=path.join(bundle,'Contents'),binary=path.join(contents,'MacOS/probe'),helper=path.join(contents,'Helpers/codex');
 fs.mkdirSync(path.dirname(binary),{recursive:true});fs.mkdirSync(path.dirname(helper),{recursive:true});
 fs.writeFileSync(path.join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.managedsandboxprobe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
 const original=path.join(root,'desktop-pet/build/qiuqiu-codex/darwin-arm64/codex'),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=digest(original);
 fs.copyFileSync(original,helper,fs.constants.COPYFILE_FICLONE);fs.chmodSync(helper,0o700);
 const fixture=path.join(temp,'synthetic-only.txt');fs.writeFileSync(fixture,'synthetic fixture only');
 run('xcrun',['swiftc','-swift-version','5',path.join(root,'docs/mac-app-store/probe/ManagedCodexProbe.swift'),'-o',binary]);
 run('codesign',['--force','--sign','-','--timestamp=none',helper]);
 const baseline=JSON.parse(run(binary,[fixture]));
 run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',path.join(root,'desktop-pet/packaging/mas/child.entitlements.plist'),helper]);
 const entitlements=server=>'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/>'+(server?'<key>com.apple.security.network.server</key><true/>':'')+'</dict></plist>';
 const reports={};for(const server of [false,true]){const entitlement=path.join(temp,'main-'+server+'.plist');fs.writeFileSync(entitlement,entitlements(server));run('codesign',['--force','--sign','-','--timestamp=none','--entitlements',entitlement,bundle]);run('codesign',['--verify','--deep','--strict',bundle]);reports[server?'withNetworkServer':'withoutNetworkServer']=JSON.parse(run(binary,[fixture]));}
 const record={diagnostic:'native App Sandbox inherited official Codex helper; not Electron MAS acceptance',baseline,...reports,originalHelperUnchanged:before===digest(original),modelRequests:0,originalCredentialsRead:false};
 record.expectedBoundaryObserved=baseline.syntheticExternalFileReadable===true&&baseline.initializeReply===true&&reports.withoutNetworkServer.syntheticExternalFileReadable===false&&reports.withoutNetworkServer.initializeReply===true&&reports.withoutNetworkServer.loopbackBindAllowed===false&&reports.withNetworkServer.loopbackBindAllowed===true&&reports.withNetworkServer.accountReply===true&&record.originalHelperUnchanged;
 process.stdout.write(JSON.stringify(record,null,2)+'\n');if(!record.expectedBoundaryObserved)process.exitCode=2;
}catch(e){process.stdout.write(JSON.stringify({status:'failed',code:e.message,tool:e.tool,statusCode:e.status})+'\n');process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});}
