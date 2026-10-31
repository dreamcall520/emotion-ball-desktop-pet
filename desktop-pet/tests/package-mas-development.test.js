'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),plist=require('plist');
const api=require('../scripts/package-mas-development');
const pkg={version:'0.4.09',devDependencies:{electron:'43.4.1'}};
const env={MAS_DEV_BUNDLE_ID:'com.example.qiuqiu.masdevelopment',MAS_DEV_TEAM_ID:'ABCDEF1234',MAS_DEV_PROFILE:'/synthetic/dev.provisionprofile',MAS_DEV_SIGN_IDENTITY:'Apple Development: Fixture Person (ABCDEF1234)',MAS_DEV_BUILD_VERSION:'1',MAS_DEV_ELECTRON_ZIP_DIR:'/synthetic/mas-cache'};
const cert=Buffer.from('development-certificate-fixture'),fingerprint=createHash('sha1').update(cert).digest('hex').toUpperCase(),device='00006000-SYNTHETICDEVICE';
const cfg=api.configFor(pkg,env,'arm64').config;
function profile(){return{ExpirationDate:new Date('2030-01-01'),CreationDate:new Date('2020-01-01'),Platform:['OSX'],TeamIdentifier:[cfg.teamId],ProvisionedDevices:[device],DeveloperCertificates:[cert],Entitlements:{'com.apple.developer.team-identifier':cfg.teamId,'com.apple.application-identifier':cfg.teamId+'.'+cfg.bundleId,'get-task-allow':true,'com.apple.security.application-groups':[cfg.teamId+'.'+cfg.bundleId]}};}
function temp(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'mas-development-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function resourceFixture(app,arch='arm64'){
 const resources=path.join(app,'Contents/Resources'),codex=path.join(resources,'qiuqiu-codex',`darwin-${arch}`),wb=path.join(resources,'qiuqiu-workbuddy');
 fs.mkdirSync(codex,{recursive:true});fs.mkdirSync(path.join(wb,'node_modules/fixture'),{recursive:true});fs.writeFileSync(path.join(codex,'codex'),'before-sign');fs.writeFileSync(path.join(codex,'manifest.json'),JSON.stringify({provider:'codex',binary:'codex',binarySha256:'old'}));
 fs.writeFileSync(path.join(wb,'node_modules/fixture/index.js'),'fixture');fs.writeFileSync(path.join(wb,'manifest.json'),JSON.stringify({provider:'workbuddy-cli',files:{'node_modules/fixture/index.js':'old'}}));return{codex,wb};
}
test('默认plan明确开发目的，缺配置不读profile/keychain/device/cache且不泄露具体身份',()=>{
 const p=api.planFor(pkg,{},'arm64');assert.equal(p.platform,'mas');assert.equal(p.missingConfiguration.length,6);assert.equal(p.configurationReady,false);assert.equal(p.runtimeSandboxValidated,false);
 const configured=api.planFor(pkg,env,'arm64');assert.equal(configured.configurationReady,true);assert.equal(configured.identityValidated,false);assert.equal(configured.currentDeviceRegistered,false);assert.equal(JSON.stringify(configured).includes('Fixture Person'),false);assert.equal(JSON.stringify(configured).includes('/synthetic'),false);
 const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/package-mas-development.js'),'--plan'],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});assert.equal(run.status,0);assert.equal(JSON.parse(run.stdout).profileValidated,false);assert.equal(run.stderr,'');
});
test('不接受普通Bundle/adhoc/DeveloperID/分发证书、相对路径或无效构建号',()=>{
 for(const identity of ['-','Developer ID Application: Fixture Person (ABCDEF1234)','Apple Distribution: Fixture Person (ABCDEF1234)','Apple Development: Fixture Person (OTHER12345)'])assert.ok(api.configFor(pkg,{...env,MAS_DEV_SIGN_IDENTITY:identity}).errors.includes('MAS_DEV_APPLE_DEVELOPMENT_IDENTITY_REQUIRED'));
 assert.ok(api.configFor(pkg,{...env,MAS_DEV_BUNDLE_ID:'local.xiaokun.emotionball.pet'}).errors.includes('MAS_DEV_ISOLATED_BUNDLE_ID_REQUIRED'));
 assert.ok(api.configFor(pkg,{...env,MAS_DEV_PROFILE:'relative'}).errors.includes('MAS_DEV_PROFILE_PATH_INVALID'));
 assert.ok(api.configFor(pkg,{...env,MAS_DEV_ELECTRON_ZIP_DIR:'relative'}).errors.includes('MAS_DEV_ZIP_DIR_INVALID'));
 assert.ok(api.configFor(pkg,{...env,MAS_DEV_BUILD_VERSION:'0'}).errors.includes('MAS_DEV_BUILD_VERSION_INVALID'));
});
test('development profile核验期限、Mac平台、团队/AppID、开发属性、本机注册、证书和group',()=>{
 assert.deepEqual(api.validateDevelopmentProfile(profile(),cfg,fingerprint,device,Date.parse('2026-10-31')),{profileValidated:true,currentDeviceRegistered:true});
 const cases=[[p=>p.ExpirationDate=new Date('2000-01-01'),'MAS_DEV_PROFILE_EXPIRED'],[p=>p.CreationDate=new Date('2040-01-01'),'MAS_DEV_PROFILE_NOT_YET_VALID'],[p=>p.Platform=['iOS'],'MAS_DEV_PROFILE_PLATFORM_MISMATCH'],[p=>p.TeamIdentifier=['OTHER12345'],'MAS_DEV_PROFILE_TEAM_MISMATCH'],[p=>p.Entitlements['com.apple.application-identifier']='ABCDEF1234.com.example.*','MAS_DEV_PROFILE_APP_ID_MISMATCH'],[p=>p.Entitlements['get-task-allow']=false,'MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED'],[p=>p.ProvisionsAllDevices=true,'MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED'],[p=>p.ProvisionedDevices=['different-device'],'MAS_DEV_CURRENT_DEVICE_NOT_REGISTERED'],[p=>p.DeveloperCertificates=[Buffer.from('other')],'MAS_DEV_PROFILE_CERTIFICATE_MISMATCH'],[p=>p.Entitlements['com.apple.security.application-groups']=[],'MAS_DEV_PROFILE_APP_GROUP_MISMATCH']];
 for(const [change,code]of cases){const p=profile();change(p);assert.throws(()=>api.validateDevelopmentProfile(p,cfg,fingerprint,device,Date.parse('2026-10-31')),{code});}
});
test('设备读取只接受Provisioning UDID，不把hardware UUID误当注册设备，不回显设备资料',()=>{
 assert.equal(api.readCurrentDeviceId(()=>JSON.stringify({SPHardwareDataType:[{provisioning_UDID:device,serial_number:'must-not-output'}]})),device);
 assert.throws(()=>api.readCurrentDeviceId(()=>JSON.stringify({SPHardwareDataType:[{platform_UUID:'hardware-only'}]})),{code:'MAS_DEV_DEVICE_ID_UNAVAILABLE'});
});
test('开发选项强制mas/本机缓存/独立名字，主权限含回环服务与书签，子继承不另开全局权限',()=>{
 const o=api.packagerOptions('/synthetic',cfg,'/stage','/icon',{platform:'darwin',osxNotarize:{secret:'never'}});assert.equal(o.platform,'mas');assert.equal(o.electronZipDir,env.MAS_DEV_ELECTRON_ZIP_DIR);assert.equal(o.osxSign,false);assert.equal(o.osxNotarize,undefined);assert.match(o.name,/沙盒开发候选/);assert.equal(o.extraResource.length,2);
 const rights=api.entitlementsFor(cfg);for(const key of ['com.apple.security.app-sandbox','com.apple.security.network.client','com.apple.security.network.server','com.apple.security.files.bookmarks.app-scope'])assert.equal(rights.main[key],true);
 assert.deepEqual(rights.child,{'com.apple.security.app-sandbox':true,'com.apple.security.inherit':true});assert.match(api.probeEntry(cfg.bundleId),/process\.mas!==true/);assert.match(api.probeEntry(cfg.bundleId),/ownContainer/);
});
test('nested签名后的摘要刷新且不允许manifest路径穿越或软链接',t=>{
 const app=path.join(temp(t),'App.app'),r=resourceFixture(app);fs.writeFileSync(path.join(r.codex,'codex'),'after-sign');assert.deepEqual(api.refreshBundledManifests(app),{codexFiles:1,workbuddyFiles:1});
 const cm=JSON.parse(fs.readFileSync(path.join(r.codex,'manifest.json'),'utf8'));assert.equal(cm.binarySha256,createHash('sha256').update('after-sign').digest('hex'));
 fs.writeFileSync(path.join(r.wb,'manifest.json'),JSON.stringify({provider:'workbuddy-cli',files:{'node_modules/../../../outside':'bad'}}));assert.throws(()=>api.refreshBundledManifests(app),{code:'MAS_DEV_RUNTIME_MANIFEST_INVALID'});
});
function buildFixture(t,overrides={}){
 const root=temp(t),events=[];fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));const own={...env,MAS_DEV_PROFILE:path.join(root,'dev.provisionprofile'),MAS_DEV_ELECTRON_ZIP_DIR:path.join(root,'cache')};fs.writeFileSync(own.MAS_DEV_PROFILE,'fixture profile');fs.mkdirSync(own.MAS_DEV_ELECTRON_ZIP_DIR);fs.writeFileSync(path.join(own.MAS_DEV_ELECTRON_ZIP_DIR,'electron-v43.4.1-mas-arm64.zip'),'fixture zip, not a real runtime');let options,app;
 const deps={hostPlatform:'darwin',hostArch:'arm64',now:()=>Date.parse('2026-10-31'),readDeviceId:()=>device,validateResources:async()=>events.push('validate-resources'),
  command(name,args){events.push([name,args]);if(name==='security'&&args[0]==='find-identity')return` 1) ${fingerprint} "${own.MAS_DEV_SIGN_IDENTITY}"\n 1 valid identities found`;if(name==='security'&&args[0]==='cms')return plist.build(profile());if(name==='codesign'&&args[0]==='--display')return plist.build(args.at(-1)===app?api.entitlementsFor(cfg).main:api.entitlementsFor(cfg).child);if(name.endsWith('/Contents/MacOS/球球桌宠-商店沙盒开发候选'))return JSON.stringify({mas:true,ownContainer:true});return'';},
  mac:{prepareStaging(_root,directory){events.push('staging');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(pkg));return directory;},buildPackagerOptions:()=>({platform:'darwin'})},makeIcon:()=>'/fixture/icon',buildWeatherLocation:()=>events.push('build-native'),
  async packager(value){options=value;events.push('packager');const output=path.join(root,'out');app=path.join(output,value.name+'.app');fs.mkdirSync(app,{recursive:true});resourceFixture(app);return[output];},
  signing:{async signAsync(value){events.push('sign-nested-and-app');assert.equal(value.platform,'mas');assert.equal(value.type,'development');assert.equal(value.identity,fingerprint);assert.equal(value.preAutoEntitlements,false);assert.equal(value.optionsForFile(app).entitlements.endsWith('main.entitlements.plist'),true);assert.equal(value.optionsForFile('/fixture/helper').entitlements.endsWith('child.entitlements.plist'),true);fs.writeFileSync(path.join(app,'Contents/Resources/qiuqiu-codex/darwin-arm64/codex'),'signed fixture binary');}},...overrides};return{root,env:own,deps,events,options:()=>options,app:()=>app};
}
test('缺配置、无开发证书或profile失败发生在构建/缓存/打包前；不产生降级包',async t=>{
 const root=temp(t);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));let touched=0;await assert.rejects(api.buildMasDevelopment({root,env:{}},{command(){touched++;},packager(){touched++;}}),{code:'MAS_DEV_CONFIGURATION_REQUIRED'});assert.equal(touched,0);
 const f=buildFixture(t,{command:()=>''});await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_IDENTITY_UNAVAILABLE'});assert.equal(f.events.includes('packager'),false);assert.equal(f.events.includes('build-native'),false);
 const cli=spawnSync(process.execPath,[path.join(__dirname,'../scripts/package-mas-development.js'),'--build'],{encoding:'utf8',env:{PATH:process.env.PATH}});assert.equal(cli.status,2);assert.match(cli.stderr,/MAS_DEV_CONFIGURATION_REQUIRED/);
});
test('完整synthetic流水线仅签开发App，刷新摘要后只重签最外层，并验证MAS/container及子权限',async t=>{
 const f=buildFixture(t),result=await api.buildMasDevelopment({root:f.root,env:f.env},f.deps);assert.equal(result.platform,'mas');assert.equal(result.signedDevelopmentApp,true);assert.equal(result.masRuntimeAndContainerProbePassed,true);assert.equal(result.chatAndDirectoryAcceptancePassed,false);assert.equal(result.submissionReady,false);
 const nested=f.events.indexOf('sign-nested-and-app'),outer=f.events.findIndex(x=>Array.isArray(x)&&x[0]==='codesign'&&x[1][0]==='--force');assert.ok(outer>nested);assert.equal(f.events[outer][1].includes('--deep'),false);
 const cm=JSON.parse(fs.readFileSync(path.join(f.app(),'Contents/Resources/qiuqiu-codex/darwin-arm64/manifest.json'),'utf8'));assert.equal(cm.binarySha256,createHash('sha256').update('signed fixture binary').digest('hex'));assert.equal(f.options().platform,'mas');assert.ok(fs.existsSync(path.join(f.app(),'Contents/embedded.provisionprofile')));const staged=JSON.parse(fs.readFileSync(path.join(f.options().dir,'package.json'),'utf8'));assert.equal(staged.qiuqiuAcceptance,'mas');assert.equal(staged.qiuqiuDistribution,'mas-development');
});
test('缺本机MAS缓存不下载；Darwin runtime或非独立容器probe拒绝，不能只凭签名成功',async t=>{
 const f=buildFixture(t);fs.unlinkSync(path.join(f.env.MAS_DEV_ELECTRON_ZIP_DIR,'electron-v43.4.1-mas-arm64.zip'));await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_CACHED_MAS_RUNTIME_REQUIRED'});assert.equal(f.events.includes('packager'),false);
 const g=buildFixture(t),run=g.deps.command;g.deps.command=(name,args)=>name.endsWith('/Contents/MacOS/球球桌宠-商店沙盒开发候选')?JSON.stringify({mas:false,ownContainer:true}):run(name,args);await assert.rejects(api.buildMasDevelopment({root:g.root,env:g.env},g.deps),{code:'MAS_DEV_RUNTIME_PROBE_FAILED'});
});
