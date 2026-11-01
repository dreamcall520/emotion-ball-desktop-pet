'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),plist=require('plist');
const api=require('../scripts/package-mas-development');
const pkg={version:'0.4.09',devDependencies:{electron:'43.4.1'}};
const env={MAS_DEV_BUNDLE_ID:'com.example.qiuqiu.masdevelopment',MAS_DEV_TEAM_ID:'ABCDEF1234',MAS_DEV_PROFILE:'/synthetic/dev.provisionprofile',MAS_DEV_SIGN_IDENTITY:'Apple Development: Fixture Person (PERSON9999)',MAS_DEV_BUILD_VERSION:'1',MAS_DEV_ELECTRON_ZIP_DIR:'/synthetic/mas-cache'};
const cert=Buffer.from('MIICFTCCAbugAwIBAgIUPBV7EkJlgCcd2MOSbuSZh0l/sA8wCgYIKoZIzj0EAwIwYDE3MDUGA1UEAwwuQXBwbGUgRGV2ZWxvcG1lbnQ6IEZpeHR1cmUgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKQUJDREVGMTIzNDEQMA4GA1UECgwHRml4dHVyZTAeFw0yNjEwMzExNDQ0NTVaFw0zNjEwMjgxNDQ0NTVaMGAxNzA1BgNVBAMMLkFwcGxlIERldmVsb3BtZW50OiBGaXh0dXJlIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMCkFCQ0RFRjEyMzQxEDAOBgNVBAoMB0ZpeHR1cmUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQSdeE5lMSEh8oPLeqbDheUyJ7893+8mA6rOo3wTrNRkHa7ZwOfbH/ZbSPN3Sm7SNFG9FwthkmothIsG7CrrH7do1MwUTAdBgNVHQ4EFgQUFNAVp6kS9Xr9Y9wqDu3d1rnHDV8wHwYDVR0jBBgwFoAUFNAVp6kS9Xr9Y9wqDu3d1rnHDV8wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBQc0F2wCLiiBEAbJcBiMcoSbit/+ubDSeXvLqnay+wNQIhAIVWIVtTcI0147rVHNMoZDH89iBLSYCFaPXK5LQR4dX9','base64'),wrongTeamCert=Buffer.from('MIICFjCCAbugAwIBAgIUMDBFbrK2JvXX1CGi7g915tIhuFIwCgYIKoZIzj0EAwIwYDE3MDUGA1UEAwwuQXBwbGUgRGV2ZWxvcG1lbnQ6IEZpeHR1cmUgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKWlpaWlpaOTk5OTEQMA4GA1UECgwHRml4dHVyZTAeFw0yNjEwMzExNDQ0NTVaFw0zNjEwMjgxNDQ0NTVaMGAxNzA1BgNVBAMMLkFwcGxlIERldmVsb3BtZW50OiBGaXh0dXJlIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMClpaWlpaWjk5OTkxEDAOBgNVBAoMB0ZpeHR1cmUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASngVp6ncQEoexLpmNeWXYDyXVw3noAsoJo0Fg9lrCP5LChI3dtToFP1AAdS7uGANv0AAsxV5SNxHHvzYmew9BVo1MwUTAdBgNVHQ4EFgQUeMTRkV+nyBC/uGWjPzfWaLQbee0wHwYDVR0jBBgwFoAUeMTRkV+nyBC/uGWjPzfWaLQbee0wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEA24GsF7CNt2aXKM/AdaWupTCKGwKDB+VmrceIul/TShkCIQCLci9KiSeOAn62yeH5F9HbtPEuhO0GM/WV3eQFTM0vSg==','base64'),fingerprint=createHash('sha1').update(cert).digest('hex').toUpperCase(),device='00006000-SYNTHETICDEVICE';
const distributionCert=Buffer.from('MIICFjCCAb2gAwIBAgIUOJy36V55MXqqr8ZAU+O94jCsxHQwCgYIKoZIzj0EAwIwYTE4MDYGA1UEAwwvQXBwbGUgRGlzdHJpYnV0aW9uOiBGaXh0dXJlIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMCkFCQ0RFRjEyMzQxEDAOBgNVBAoMB0ZpeHR1cmUwHhcNMjYxMDMxMTQ1NDQ2WhcNMzYxMDI4MTQ1NDQ2WjBhMTgwNgYDVQQDDC9BcHBsZSBEaXN0cmlidXRpb246IEZpeHR1cmUgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKQUJDREVGMTIzNDEQMA4GA1UECgwHRml4dHVyZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABHCIrEPg/Blu7NIj4mzIpc4HMpS6ptKiP2erKibo9V/njKU+38RlBjbWoPdHIokOoCaMuuseh8p3JaD6HINwTECjUzBRMB0GA1UdDgQWBBRo5y1xO0VGDk5fHi/qJ5EwyChqmzAfBgNVHSMEGDAWgBRo5y1xO0VGDk5fHi/qJ5EwyChqmzAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCICfoEu3wsk8hb92xTZr9qOWMhyw7tnwvjlf2CIUqk8g7AiAv/jF1vW1yS99tZfWJdTBwRUsug+KzQFzQzgu5AAycdw==','base64');
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
 for(const identity of ['-','Developer ID Application: Fixture Person (ABCDEF1234)','Apple Distribution: Fixture Person (ABCDEF1234)','Apple Development: ', 'Apple Development: Fixture\nPerson'])assert.ok(api.configFor(pkg,{...env,MAS_DEV_SIGN_IDENTITY:identity}).errors.includes('MAS_DEV_APPLE_DEVELOPMENT_IDENTITY_REQUIRED'));
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
  command(name,args){events.push([name,args]);if(name==='security'&&args[0]==='find-identity')return` 1) ${fingerprint} "${own.MAS_DEV_SIGN_IDENTITY}"\n 1 valid identities found`;if(name==='security'&&args[0]==='cms')return plist.build(profile());if(name==='codesign'&&args[0]==='--display')return plist.build(args.at(-1)===app?api.entitlementsFor(cfg).main:api.entitlementsFor(cfg).child);if(name.endsWith('/Contents/MacOS/球球桌宠-商店沙盒开发候选'))return args.includes('--qiuqiu-mas-helper-probe')?JSON.stringify({mas:true,ownContainer:true,helper:{passed:true,metadataTransport:{passed:true},modelRequestsSent:false,originalCredentialsRead:false,workbuddy:{vendorAccountVerified:false}}}):JSON.stringify({mas:true,ownContainer:true,capabilities:{known:true,sandbox:true,userSelectedReadWrite:true,userSelectedExecutable:true,appScopeBookmarks:true}});return'';},
  mac:{prepareStaging(_root,directory){events.push('staging');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(pkg));return directory;},buildPackagerOptions:()=>({platform:'darwin'})},makeIcon:()=>'/fixture/icon',buildWeatherLocation:()=>events.push('build-native'),buildPluginHost:()=>events.push('build-plugin-host'),
  async packager(value){options=value;events.push('packager');const output=path.join(root,'out');app=path.join(output,value.name+'.app');fs.mkdirSync(app,{recursive:true});if(value.extraResource.length)resourceFixture(app);else{fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});fs.mkdirSync(path.join(app,'Contents/Frameworks/Fixture Helper.app'),{recursive:true});fs.mkdirSync(path.join(app,'Contents/Library/LoginItems/Fixture Login Helper.app'),{recursive:true});const native=path.join(app,'Contents/Resources/app.asar.unpacked/desktop-pet/native');fs.mkdirSync(native,{recursive:true});fs.writeFileSync(path.join(native,'weather-location.node'),'native');}return[output];},
  signing:{async signAsync(value){events.push('sign-nested-and-app');assert.equal(value.platform,'mas');assert.equal(value.type,'development');assert.equal(value.optionsForFile(app).timestamp,'none');assert.equal(value.optionsForFile('/fixture/helper').timestamp,'none');assert.equal(value.batchCodesignCalls,true);assert.equal(value.identity,fingerprint);assert.equal(value.preAutoEntitlements,false);assert.equal(value.optionsForFile(app).entitlements.endsWith('main.entitlements.plist'),true);assert.equal(value.optionsForFile('/fixture/helper').entitlements.endsWith('child.entitlements.plist'),true);if(value.binaries.length)fs.writeFileSync(path.join(app,'Contents/Resources/qiuqiu-codex/darwin-arm64/codex'),'signed fixture binary');else{assert.deepEqual(value.binaries,[]);assert.equal(fs.existsSync(path.join(app,'Contents/Resources/qiuqiu-codex')),false);}}},...overrides};return{root,env:own,deps,events,options:()=>options,app:()=>app};
}
test('缺配置、无开发证书或profile失败发生在构建/缓存/打包前；不产生降级包',async t=>{
 const root=temp(t);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));let touched=0;await assert.rejects(api.buildMasDevelopment({root,env:{}},{command(){touched++;},packager(){touched++;}}),{code:'MAS_DEV_CONFIGURATION_REQUIRED'});assert.equal(touched,0);
 const f=buildFixture(t,{command:()=>''});await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_IDENTITY_UNAVAILABLE'});assert.equal(f.events.includes('packager'),false);assert.equal(f.events.includes('build-native'),false);
 const cli=spawnSync(process.execPath,[path.join(__dirname,'../scripts/package-mas-development.js'),'--build'],{encoding:'utf8',env:{PATH:process.env.PATH}});assert.equal(cli.status,2);assert.match(cli.stderr,/MAS_DEV_CONFIGURATION_REQUIRED/);
});
test('完整synthetic流水线仅签开发App，刷新摘要后只重签最外层，并验证MAS/container及子权限',async t=>{
 const f=buildFixture(t),result=await api.buildMasDevelopment({root:f.root,env:f.env},f.deps);assert.equal(result.platform,'mas');assert.equal(result.signedDevelopmentApp,true);assert.equal(result.masRuntimeAndContainerProbePassed,true);assert.equal(result.chatAndDirectoryAcceptancePassed,false);assert.equal(result.managedHelperInitializationProbe.passed,true);assert.equal(result.managedHelperInitializationProbe.workbuddy.vendorAccountVerified,false);assert.equal(result.submissionReady,false);
 const nested=f.events.indexOf('sign-nested-and-app'),outer=f.events.findIndex(x=>Array.isArray(x)&&x[0]==='codesign'&&x[1][0]==='--force');assert.ok(outer>nested);assert.equal(f.events[outer][1].includes('--deep'),false);
 const cm=JSON.parse(fs.readFileSync(path.join(f.app(),'Contents/Resources/qiuqiu-codex/darwin-arm64/manifest.json'),'utf8'));assert.equal(cm.binarySha256,createHash('sha256').update('signed fixture binary').digest('hex'));assert.equal(f.options().platform,'mas');assert.ok(fs.existsSync(path.join(f.app(),'Contents/embedded.provisionprofile')));const staged=JSON.parse(fs.readFileSync(path.join(f.options().dir,'package.json'),'utf8'));assert.equal(staged.qiuqiuAcceptance,'mas');assert.equal(staged.qiuqiuDistribution,'mas-development');
});
test('缺本机MAS缓存不下载；Darwin runtime或非独立容器probe拒绝，不能只凭签名成功',async t=>{
 const f=buildFixture(t);fs.unlinkSync(path.join(f.env.MAS_DEV_ELECTRON_ZIP_DIR,'electron-v43.4.1-mas-arm64.zip'));await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_CACHED_MAS_RUNTIME_REQUIRED'});assert.equal(f.events.includes('packager'),false);
 const g=buildFixture(t),run=g.deps.command;g.deps.command=(name,args)=>name.endsWith('/Contents/MacOS/球球桌宠-商店沙盒开发候选')?JSON.stringify({mas:false,ownContainer:true}):run(name,args);await assert.rejects(api.buildMasDevelopment({root:g.root,env:g.env},g.deps),{code:'MAS_DEV_RUNTIME_PROBE_FAILED'});
});

test('独立helper探针失败不能把运行容器成功当作子进程接通',async t=>{const f=buildFixture(t),run=f.deps.command;f.deps.command=(name,args,options)=>args.includes('--qiuqiu-mas-helper-probe')?JSON.stringify({mas:true,ownContainer:true,helper:{passed:false}}):run(name,args,options);await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_HELPER_PROBE_FAILED'});});
test('开发签名入口helper flag隔离于正式main，并拒绝Darwin运行',()=>{const entry=api.probeEntry(cfg.bundleId);assert.match(entry,/--qiuqiu-mas-helper-probe/);assert.match(entry,/probeManagedHelpers/);assert.match(entry,/else \{process\.qiuqiuMasDevelopmentCandidate=true;require\('\.\/desktop-pet\/main.js'\);\}/);const vm=require('node:vm'),events=[];assert.throws(()=>vm.runInNewContext(entry,{process:{mas:false,stderr:{write:s=>events.push(s)},exit:()=>{throw new Error('EXIT');}}}),/EXIT/);assert.deepEqual(events,['MAS_RUNTIME_REQUIRED\n']);});

test('Apple Development CN个人后缀不同于Team仍可用，真正归属取匹配公钥证书OU',()=>{assert.equal(api.configFor(pkg,env).errors.length,0);assert.notEqual(env.MAS_DEV_SIGN_IDENTITY.slice(-11,-1),cfg.teamId);assert.deepEqual(api.validateDevelopmentProfile(profile(),cfg,fingerprint,device,Date.parse('2026-10-31')),{profileValidated:true,currentDeviceRegistered:true});const p=profile();p.DeveloperCertificates=[wrongTeamCert];const wrongFingerprint=createHash('sha1').update(wrongTeamCert).digest('hex').toUpperCase();assert.throws(()=>api.validateDevelopmentProfile(p,cfg,wrongFingerprint,device,Date.parse('2026-10-31')),{code:'MAS_DEV_CERTIFICATE_TEAM_MISMATCH'});const invalid=Buffer.from('not a certificate');p.DeveloperCertificates=[invalid];assert.throws(()=>api.validateDevelopmentProfile(p,cfg,createHash('sha1').update(invalid).digest('hex').toUpperCase(),device,Date.parse('2026-10-31')),{code:'MAS_DEV_PROFILE_CERTIFICATE_INVALID'});});

test('macOS开发profile可缺省两个get-task-allow，但必须设备绑定及匹配AppleDevelopment公钥证书CN/OU',()=>{
 const p=profile();delete p.Entitlements['get-task-allow'];assert.deepEqual(api.validateDevelopmentProfile(p,cfg,fingerprint,device,Date.parse('2026-10-31')),{profileValidated:true,currentDeviceRegistered:true});
 for(const key of ['get-task-allow','com.apple.security.get-task-allow']){const denied=profile();delete denied.Entitlements['get-task-allow'];denied.Entitlements[key]=false;assert.throws(()=>api.validateDevelopmentProfile(denied,cfg,fingerprint,device,Date.parse('2026-10-31')),{code:'MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED'});}
 const noDevice=profile();delete noDevice.Entitlements['get-task-allow'];delete noDevice.ProvisionedDevices;assert.throws(()=>api.validateDevelopmentProfile(noDevice,cfg,fingerprint,device,Date.parse('2026-10-31')),{code:'MAS_DEV_CURRENT_DEVICE_NOT_REGISTERED'});
 const allDevices=profile();delete allDevices.Entitlements['get-task-allow'];allDevices.ProvisionsAllDevices=true;assert.throws(()=>api.validateDevelopmentProfile(allDevices,cfg,fingerprint,device,Date.parse('2026-10-31')),{code:'MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED'});
 const distribution=profile();delete distribution.Entitlements['get-task-allow'];distribution.DeveloperCertificates=[distributionCert];const fp=createHash('sha1').update(distributionCert).digest('hex').toUpperCase();assert.throws(()=>api.validateDevelopmentProfile(distribution,cfg,fp,device,Date.parse('2026-10-31')),{code:'MAS_DEV_DEVELOPMENT_CERTIFICATE_REQUIRED'});
 assert.throws(()=>api.validateDevelopmentProfile(p,{...cfg,identity:'Apple Development: Another Person (OTHER11111)'},fingerprint,device,Date.parse('2026-10-31')),{code:'MAS_DEV_CERTIFICATE_IDENTITY_MISMATCH'});
});

test('MAS helper report must independently confirm isolated metadata transport, not only generic passed',async t=>{const f=buildFixture(t),run=f.deps.command;f.deps.command=(name,args,options)=>args.includes('--qiuqiu-mas-helper-probe')?JSON.stringify({mas:true,ownContainer:true,helper:{passed:true,metadataTransport:{passed:false},modelRequestsSent:false,originalCredentialsRead:false,workbuddy:{vendorAccountVerified:false}}}):run(name,args,options);await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_HELPER_PROBE_FAILED'});});

test('MAS runtime probe rejects missing actual executable entitlement even when signed plist claims it',async t=>{const f=buildFixture(t),run=f.deps.command;f.deps.command=(name,args,options)=>args.includes('--qiuqiu-mas-runtime-probe')?JSON.stringify({mas:true,ownContainer:true,capabilities:{known:true,sandbox:true,userSelectedReadWrite:true,userSelectedExecutable:false,appScopeBookmarks:true}}):run(name,args,options);await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_DEV_RUNTIME_PROBE_FAILED'});});

test('首发profile不随包带厂商组件，明确撤销外部插件执行写权限，保留天气和导入权限',()=>{
 const first=api.configFor({...pkg,qiuqiuReleaseProfile:'mas-first'},env).config;
 const o=api.packagerOptions('/synthetic',first,'/stage','/icon');
 assert.deepEqual(o.extraResource,[]);
 const rights=api.entitlementsFor(first).main;
 assert.equal(rights['com.apple.security.files.user-selected.executable'],undefined);
 for(const k of ['com.apple.security.files.user-selected.read-write','com.apple.security.personal-information.location','com.apple.security.files.bookmarks.app-scope','com.apple.security.network.client'])assert.equal(rights[k],true);
 const entry=api.probeEntry(first.bundleId,first);
 assert.doesNotMatch(entry,/startBundledWorkBuddy|probeManagedHelpers|probePluginInstallation/);
 assert.match(entry,/MAS_FIRST_RELEASE_PLUGIN_INSTALL_DISABLED/);
 assert.doesNotMatch(entry,/createBundledCodexChatRpc|readAccount|codex-profile|scratch/);assert.match(entry,/app-sandbox-container-only/);
});
test('首发不要求任何helper清单，意外残留厂商组件则拒绝而非伪造空组件',t=>{
 const app=path.join(temp(t),'First.app'),r=resourceFixture(app);
 assert.throws(()=>api.refreshBundledManifests(app,fs,process.arch,{releaseProfile:'mas-first'}),{code:'MAS_FIRST_BUNDLED_RUNTIME_PRESENT'});
 fs.rmSync(r.wb,{recursive:true});fs.rmSync(path.dirname(r.codex),{recursive:true});
 assert.deepEqual(api.refreshBundledManifests(app,fs,process.arch,{releaseProfile:'mas-first'}),{codexFiles:0,workbuddyFiles:0});
});
test('首发构建不携带Codex且只验证自有sandbox容器，不启动外部软件或读取账号',async t=>{
 const f=buildFixture(t);fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({...pkg,qiuqiuReleaseProfile:'mas-first'}));
 const run=f.deps.command,first=api.configFor({...pkg,qiuqiuReleaseProfile:'mas-first'},f.env).config;
 f.deps.command=(name,args,opts)=>{
  if(name==='codesign'&&args[0]==='--display')return plist.build(args.at(-1)===f.app()?api.entitlementsFor(first).main:api.entitlementsFor(first).child);
  if(args.includes('--qiuqiu-mas-runtime-probe'))return JSON.stringify({mas:true,ownContainer:true,capabilities:{known:true,sandbox:true,userSelectedReadWrite:true,userSelectedExecutable:false,appScopeBookmarks:true}});
  if(args.includes('--qiuqiu-mas-helper-probe'))return JSON.stringify({mas:true,ownContainer:true,codexRuntime:'user-installed',bundled:false,installedProviderAcceptance:false,validationScope:'app-sandbox-container-only',modelRequestsSent:false,originalCredentialsRead:false});
  return run(name,args,opts);
 };
 const result=await api.buildMasDevelopment({root:f.root,env:f.env},f.deps);
 assert.equal(result.masRuntimeAndContainerProbePassed,true);assert.equal(result.bundledManifestRefresh.workbuddyFiles,0);
 assert.equal(f.options().extraResource.length,0);assert.equal(result.codexRuntime,'user-installed');assert.equal(result.bundled,false);assert.equal(result.installedProviderAcceptance,false);assert.equal(result.managedHelperInitializationProbe,null);assert.equal(f.events.includes('validate-resources'),false);assert.equal(fs.existsSync(path.join(f.app(),'Contents/Resources/qiuqiu-codex')),false);for(const name of ['Frameworks/Fixture Helper.app','Library/LoginItems/Fixture Login Helper.app','Resources/app.asar.unpacked/desktop-pet/native/weather-location.node'])assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='codesign'&&e[1][0]==='--verify'&&e[1].at(-1)===path.join(f.app(),'Contents',name)));
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.options().dir,'package.json'))).qiuqiuReleaseProfile,'mas-first');
});

test('首发helper flag只查询自有容器与原生沙盒能力，不require账号/外部组件或发起模型',async()=>{
 const vm=require('node:vm'),entry=api.probeEntry(cfg.bundleId,{releaseProfile:'mas-first'});
 for(const flag of ['--qiuqiu-mas-runtime-probe','--qiuqiu-mas-helper-probe']){
  const requires=[],output=[];let exit;
  const process={mas:true,argv:['app',flag],stdout:{write:s=>output.push(s)},stderr:{write:s=>{throw Error(s);}},exit:code=>{exit=code;}};
  const app={whenReady:()=>Promise.resolve(),getPath:name=>{assert.equal(name,'userData');return '/Users/fixture/Library/Containers/'+cfg.bundleId+'/Data/Library/Application Support/球球';},exit:code=>{exit=code;}};
  vm.runInNewContext(entry,{process,require:name=>{requires.push(name);if(name==='electron')return{app};if(name==='./desktop-pet/lib/plugin-host')return{createPluginHost:()=>({getSandboxCapabilities:()=>({known:true,sandbox:true,userSelectedReadWrite:true,appScopeBookmarks:true})})};throw Error('Unexpected require '+name);}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(exit,0);const result=JSON.parse(output.join(''));assert.equal(result.validationScope,'app-sandbox-container-only');assert.equal(result.codexRuntime,'user-installed');assert.equal(result.bundled,false);assert.equal(result.installedProviderAcceptance,false);assert.equal(result.originalCredentialsRead,false);assert.equal(result.modelRequestsSent,false);assert.deepEqual(requires,['electron','./desktop-pet/lib/plugin-host']);assert.equal(result.helper,undefined);
 }
});
test('首发打包若意外带入空helper目录也在签名前拒绝，不伪造缺省组件',async t=>{
 const f=buildFixture(t);fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({...pkg,qiuqiuReleaseProfile:'mas-first'}));const packager=f.deps.packager;f.deps.packager=async options=>{const results=await packager(options);fs.mkdirSync(path.join(f.app(),'Contents/Resources/qiuqiu-codex'));return results;};
 await assert.rejects(api.buildMasDevelopment({root:f.root,env:f.env},f.deps),{code:'MAS_FIRST_BUNDLED_RUNTIME_PRESENT'});assert.equal(f.events.includes('sign-nested-and-app'),false);
});
