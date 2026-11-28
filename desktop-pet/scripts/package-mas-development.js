#!/usr/bin/env node
'use strict';
// Local MAS development build only. Never creates identities, profiles or uploads.
const fs=require('node:fs'),path=require('node:path');
const {createHash,X509Certificate}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {marketingVersion,identities,argumentsFor,MAS_ASAR_UNPACK}=require('./package-mas');
const release=require('./mas-release-profile');
const nativeWidgets=require('./package-native-widgets');
const ROOT=path.resolve(__dirname,'../..'),NAME='球球桌宠-商店沙盒开发候选';
const REQUIRED=['MAS_DEV_BUNDLE_ID','MAS_DEV_TEAM_ID','MAS_DEV_PROFILE','MAS_DEV_SIGN_IDENTITY','MAS_DEV_BUILD_VERSION','MAS_DEV_ELECTRON_ZIP_DIR'];
const fail=code=>Object.assign(new Error(code),{code});
function configFor(pkg,env={},arch=env.MAS_DEV_ARCH||process.arch){
 const missing=REQUIRED.filter(name=>typeof env[name]!=='string'||!env[name].trim()),errors=[];
 let version;try{version=marketingVersion(pkg.version);}catch{errors.push('MAS_DEV_VERSION_INVALID');}
 const config={releaseProfile:pkg.qiuqiuReleaseProfile,arch,version,electronVersion:pkg.devDependencies?.electron,bundleId:env.MAS_DEV_BUNDLE_ID,teamId:env.MAS_DEV_TEAM_ID,profile:env.MAS_DEV_PROFILE,identity:env.MAS_DEV_SIGN_IDENTITY,buildVersion:env.MAS_DEV_BUILD_VERSION,zipDir:env.MAS_DEV_ELECTRON_ZIP_DIR};
 if(!['arm64','x64'].includes(arch))errors.push('MAS_DEV_ARCH_INVALID');
 if(!/^\d+\.\d+\.\d+$/.test(config.electronVersion||''))errors.push('MAS_DEV_ELECTRON_VERSION_INVALID');
 if(config.bundleId&&!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.masdevelopment$/.test(config.bundleId))errors.push('MAS_DEV_ISOLATED_BUNDLE_ID_REQUIRED');
 if(config.teamId&&!/^[A-Z0-9]{10}$/.test(config.teamId))errors.push('MAS_DEV_TEAM_ID_INVALID');
 for(const [key,code] of [['profile','MAS_DEV_PROFILE_PATH_INVALID'],['zipDir','MAS_DEV_ZIP_DIR_INVALID']])if(config[key]&&!path.isAbsolute(config[key]))errors.push(code);
 if(config.identity&&!/^Apple Development: [^\r\n\0]{1,200}$/.test(config.identity))errors.push('MAS_DEV_APPLE_DEVELOPMENT_IDENTITY_REQUIRED');
 if(config.buildVersion&&(!/^[1-9]\d*$/.test(config.buildVersion)||!Number.isSafeInteger(Number(config.buildVersion))))errors.push('MAS_DEV_BUILD_VERSION_INVALID');
 return{config,missing,errors};
}
function planFor(pkg,env={},arch){
 const {config,missing,errors}=configFor(pkg,env,arch);
 return{mode:'plan',platform:'mas',releaseProfile:config.releaseProfile||null,...release.providerRuntimeMetadata(config),purpose:'development-sandbox-validation',arch:config.arch,version:config.version||null,electronVersion:config.electronVersion||null,
  configured:Object.fromEntries(REQUIRED.map(name=>[name,!missing.includes(name)])),missingConfiguration:missing,configurationErrors:errors,configurationReady:!missing.length&&!errors.length,
  identityValidated:false,profileValidated:false,currentDeviceRegistered:false,cachedMasRuntimeValidated:false,runtimeSandboxValidated:false,submissionReady:false,
  note:'Plan only. No keychain/profile/device/cache read, runtime download, signing, certificate creation or upload.'};
}
function validateDevelopmentProfile(profile,config,fingerprint,deviceId,now=Date.now()){
 const e=profile?.Entitlements;
 if(!e||!(profile.ExpirationDate instanceof Date)||!Number.isFinite(profile.ExpirationDate.getTime()))throw fail('MAS_DEV_PROFILE_INVALID');
 if(profile.ExpirationDate.getTime()<=now)throw fail('MAS_DEV_PROFILE_EXPIRED');
 if(profile.CreationDate instanceof Date&&profile.CreationDate.getTime()>now)throw fail('MAS_DEV_PROFILE_NOT_YET_VALID');
 if(!Array.isArray(profile.Platform)||!profile.Platform.some(value=>['OSX','macOS'].includes(value)))throw fail('MAS_DEV_PROFILE_PLATFORM_MISMATCH');
 if(!Array.isArray(profile.TeamIdentifier)||!profile.TeamIdentifier.includes(config.teamId)||e['com.apple.developer.team-identifier']!==config.teamId)throw fail('MAS_DEV_PROFILE_TEAM_MISMATCH');
 if((e['com.apple.application-identifier']||e['application-identifier'])!==`${config.teamId}.${config.bundleId}`)throw fail('MAS_DEV_PROFILE_APP_ID_MISMATCH');
 const taskAllow=[e['get-task-allow'],e['com.apple.security.get-task-allow']];
 // macOS App Development profiles may omit both task-allow keys. Explicit false
 // or malformed values still reject; device binding and the matched public
 // Apple Development certificate below establish the development-only boundary.
 if(profile.ProvisionsAllDevices===true||taskAllow.some(value=>value!==undefined&&value!==true))throw fail('MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED');
 if(typeof deviceId!=='string'||!deviceId||deviceId.length>128||!/^[A-Za-z0-9-]+$/.test(deviceId))throw fail('MAS_DEV_DEVICE_ID_UNAVAILABLE');
 if(!Array.isArray(profile.ProvisionedDevices)||!profile.ProvisionedDevices.includes(deviceId))throw fail('MAS_DEV_CURRENT_DEVICE_NOT_REGISTERED');
 const certificate=Array.isArray(profile.DeveloperCertificates)&&profile.DeveloperCertificates.find(cert=>(Buffer.isBuffer(cert)||cert instanceof Uint8Array)&&createHash('sha1').update(cert).digest('hex').toUpperCase()===fingerprint);
 if(!certificate)throw fail('MAS_DEV_PROFILE_CERTIFICATE_MISMATCH');
 // The identity CN's parenthesized suffix is a person/certificate identifier,
 // not the Team ID. Verify the matched public certificate's OU instead.
 let certificateSubject;try{certificateSubject=new X509Certificate(certificate).toLegacyObject().subject;}catch{throw fail('MAS_DEV_PROFILE_CERTIFICATE_INVALID');}
 if(typeof certificateSubject?.OU!=='string'||certificateSubject.OU!==config.teamId)throw fail('MAS_DEV_CERTIFICATE_TEAM_MISMATCH');
 if(typeof certificateSubject.CN!=='string'||!/^Apple Development: [^\r\n\0]{1,200}$/.test(certificateSubject.CN))throw fail('MAS_DEV_DEVELOPMENT_CERTIFICATE_REQUIRED');
 if(certificateSubject.CN!==config.identity)throw fail('MAS_DEV_CERTIFICATE_IDENTITY_MISMATCH');
 const groups=e['com.apple.security.application-groups'];
 if(!Array.isArray(groups)||!groups.includes(`${config.teamId}.${config.bundleId}`)&&!groups.includes(`${config.teamId}.*`))throw fail('MAS_DEV_PROFILE_APP_GROUP_MISMATCH');
 return{profileValidated:true,currentDeviceRegistered:true};
}
function command(name,args,options={}){
 try{return execFileSync(name,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,...options});}
 catch{throw fail(`MAS_DEV_TOOL_FAILED_${path.basename(name).toUpperCase().replace(/[^A-Z0-9]/g,'_')}`);}
}
function readCurrentDeviceId(run){
 let raw;try{raw=JSON.parse(run('system_profiler',['SPHardwareDataType','-json']));}catch{throw fail('MAS_DEV_DEVICE_ID_UNAVAILABLE');}
 // Apple silicon requires Provisioning UDID, never a guessed hardware UUID.
 const id=raw?.SPHardwareDataType?.[0]?.provisioning_UDID;
 if(typeof id!=='string'||!id.trim())throw fail('MAS_DEV_DEVICE_ID_UNAVAILABLE');return id.trim();
}
function entitlementsFor(config){
 const rights={main:{'com.apple.security.app-sandbox':true,'com.apple.application-identifier':`${config.teamId}.${config.bundleId}`,
  'com.apple.developer.team-identifier':config.teamId,'com.apple.security.application-groups':[`${config.teamId}.${config.bundleId}`],
  'com.apple.security.get-task-allow':true,'com.apple.security.files.user-selected.read-write':true,'com.apple.security.files.bookmarks.app-scope':true,
  'com.apple.security.network.client':true,'com.apple.security.network.server':true,'com.apple.security.personal-information.location':true,'com.apple.security.personal-information.calendars':true},
  child:{'com.apple.security.app-sandbox':true,'com.apple.security.inherit':true}};
 // Match distribution: fixed filters remain in the bundle, external files are JSON.
 return rights;
}
function packagerOptions(root,config,staging,icon,base={}){
 const options={...base,dir:staging,out:path.join(root,'dist/mas-development',config.arch),platform:'mas',arch:config.arch,name:NAME,
  appBundleId:config.bundleId,appVersion:config.version,buildVersion:config.buildVersion,electronVersion:config.electronVersion,electronZipDir:config.zipDir,
  asar:{unpack:MAS_ASAR_UNPACK},overwrite:true,prune:true,quiet:true,osxSign:false,
  extraResource:release.resourceNames(config).map(name=>path.join(root,'desktop-pet/build',name)),
  extendInfo:{...base.extendInfo,ElectronTeamID:config.teamId}};
 delete options.osxNotarize;return options;
}
function hashFile(file,io=fs){return createHash('sha256').update(io.readFileSync(file)).digest('hex');}
function refreshBundledManifests(appPath,io=fs,arch=process.arch,config={}){
 if(release.isFirstRelease(config)){release.assertNoBundledProviders(appPath,config,io);return{codexFiles:0,workbuddyFiles:0};}
 const resources=path.join(appPath,'Contents/Resources'),codexDir=path.join(resources,'qiuqiu-codex',`darwin-${arch}`);
 const codexFile=path.join(codexDir,'manifest.json'),wbDir=path.join(resources,'qiuqiu-workbuddy'),wbFile=path.join(wbDir,'manifest.json');
 const load=file=>{const s=io.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');return JSON.parse(io.readFileSync(file,'utf8'));};
 const cm=load(codexFile),wm=release.isFirstRelease(config)?null:load(wbFile);
 if(cm.provider!=='codex'||cm.binary!=='codex'||wm&& (wm.provider!=='workbuddy-cli'||!wm.files||typeof wm.files!=='object'||Array.isArray(wm.files)||Object.keys(wm.files).length>10000))throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');
 const regular=file=>{const s=io.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');return file;};
 cm.binarySha256=hashFile(regular(path.join(codexDir,'codex')),io);
 for(const rel of Object.keys(wm?.files||{})){
  if(!rel.startsWith('node_modules/')||rel.includes('\\')||rel.split('/').some(x=>!x||x==='.'||x==='..'))throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');
  let parent=path.dirname(path.join(wbDir,rel));while(parent!==wbDir){const s=io.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink())throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');parent=path.dirname(parent);}
  wm.files[rel]=hashFile(regular(path.join(wbDir,rel)),io);
 }
 io.writeFileSync(codexFile,JSON.stringify(cm,null,2)+'\n');if(wm)io.writeFileSync(wbFile,JSON.stringify(wm,null,2)+'\n');
 return{codexFiles:1,workbuddyFiles:Object.keys(wm?.files||{}).length};
}
function probeEntry(bundleId,config={}){if(release.isFirstRelease(config))return firstReleaseProbeEntry(bundleId);return `'use strict';
if(process.mas!==true){process.stderr.write('MAS_RUNTIME_REQUIRED\\n');process.exit(2);}
const runtimeProbe=process.argv.includes('--qiuqiu-mas-runtime-probe');
const helperProbe=process.argv.includes('--qiuqiu-mas-helper-probe');
const installerProbe=process.argv.includes('--qiuqiu-mas-installer-probe');
if(runtimeProbe||helperProbe||installerProbe){const {app}=require('electron');app.whenReady().then(async()=>{
 const ownContainer=app.getPath('userData').includes('/Library/Containers/${bundleId}/Data/');
 if(!ownContainer){process.stdout.write(JSON.stringify({mas:true,ownContainer:false})+'\\n');app.exit(2);return;}
 if(installerProbe){const result=await require('./desktop-pet/lib/mas-plugin-install-probe').probePluginInstallation({app,dialog:require('electron').dialog,resourcesPath:process.resourcesPath});process.stdout.write(JSON.stringify(result)+'\\n');app.exit(result.passed?0:2);return;}
 if(runtimeProbe){const capabilities=require('./desktop-pet/lib/plugin-host').createPluginHost().getSandboxCapabilities();process.stdout.write(JSON.stringify({mas:true,ownContainer:true,capabilities})+'\\n');app.exit(0);return;}
 const {probeManagedHelpers}=require('./desktop-pet/lib/mas-helper-probe');
 const {createBundledCodexChatRpc}=require('./desktop-pet/lib/mas-bundled-codex');
 const {startBundledWorkBuddy}=require('./desktop-pet/lib/mas-bundled-workbuddy');
 const helper=await probeManagedHelpers({userData:app.getPath('userData'),resourcesPath:process.resourcesPath,createCodexRpc:createBundledCodexChatRpc,startWorkbuddyHost:startBundledWorkBuddy});
 process.stdout.write(JSON.stringify({mas:true,ownContainer:true,helper})+'\\n');app.exit(helper.passed?0:2);
}).catch(()=>{process.stdout.write(JSON.stringify({errorCode:'MAS_HELPER_PROBE_ENTRY_FAILED'})+'\\n');app.exit(2);});}else {process.qiuqiuMasDevelopmentCandidate=true;require('./desktop-pet/main.js');}
`;}

function firstReleaseProbeEntry(bundleId){return `'use strict';
if(process.mas!==true){process.stderr.write('MAS_RUNTIME_REQUIRED\\n');process.exit(2);}
const runtimeProbe=process.argv.includes('--qiuqiu-mas-runtime-probe');
const helperProbe=process.argv.includes('--qiuqiu-mas-helper-probe');
const installerProbe=process.argv.includes('--qiuqiu-mas-installer-probe');
const widgetProbe=process.argv.includes('--qiuqiu-native-widget-probe');
if(installerProbe){process.stderr.write('MAS_FIRST_RELEASE_PLUGIN_INSTALL_DISABLED\\n');process.exit(2);}
else if(widgetProbe){const {app}=require('electron');app.whenReady().then(async()=>{
 const ownContainer=app.getPath('userData').includes('/Library/Containers/${bundleId}/Data/');
 if(!ownContainer){process.stdout.write(JSON.stringify({mas:true,ownContainer:false})+'\\n');app.exit(2);return;}
 const fs=require('node:fs');fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});
 const nativeCallerBundleID=require('./desktop-pet/native/widget-center.node').bundleIdentifier();
 let report=null;const errors=[];
 const service=require('./desktop-pet/lib/native-widget-sync').createNativeWidgetSync({userData:app.getPath('userData'),resourcesPath:process.resourcesPath,onPublished:report=>require('./desktop-pet/lib/native-widget-reload').reloadNativeWidgetChanges(report),onError:error=>errors.push(error.code)},
  {spawn:(...args)=>{const child=require('node:child_process').spawn(...args);let text='';child.stdout.on('data',chunk=>{if(text.length<65536)text+=chunk.toString();});child.on('close',()=>{try{report=JSON.parse(text);}catch{}});return child;}});
 await service.start();service.dispose();
 process.stdout.write(JSON.stringify({mas:true,ownContainer,bridgeSandboxValidated:report?.ok===true&&errors.length===0&&nativeCallerBundleID==='${bundleId}',nativeCallerBundleID,report,errors})+'\\n');app.exit(report?.ok===true&&errors.length===0&&nativeCallerBundleID==='${bundleId}'?0:2);
}).catch(()=>{process.stderr.write('MAS_WIDGET_BRIDGE_PROBE_FAILED\\n');app.exit(2);});}
else if(runtimeProbe||helperProbe){const {app}=require('electron');app.whenReady().then(()=>{
 const ownContainer=app.getPath('userData').includes('/Library/Containers/${bundleId}/Data/');
 const capabilities=require('./desktop-pet/lib/plugin-host').createPluginHost().getSandboxCapabilities();
 const result={mas:true,ownContainer,capabilities,codexRuntime:'user-installed',bundled:false,installedProviderAcceptance:false,validationScope:'app-sandbox-container-only',modelRequestsSent:false,originalCredentialsRead:false};
 process.stdout.write(JSON.stringify(result)+'\\n');app.exit(ownContainer?0:2);
}).catch(()=>{process.stderr.write('MAS_FIRST_PROBE_FAILED\\n');app.exit(2);});}else{process.qiuqiuMasDevelopmentCandidate=true;require('./desktop-pet/main.js');}
`;}

async function buildMasDevelopment({root=ROOT,env=process.env,arch}={},deps={}){
 const io=deps.fs||fs,pkg=JSON.parse(io.readFileSync(path.join(root,'package.json'),'utf8')),{config,missing,errors}=configFor(pkg,env,arch);
 if(missing.length||errors.length)throw fail('MAS_DEV_CONFIGURATION_REQUIRED');
 if((deps.hostPlatform||process.platform)!=='darwin')throw fail('MAS_DEV_MACOS_HOST_REQUIRED');
 if((deps.hostArch||process.arch)!==config.arch)throw fail('MAS_DEV_MATCHING_NATIVE_HOST_REQUIRED');
 const run=deps.command||command;
 let ps;try{ps=io.lstatSync(config.profile);if(!ps.isFile()||ps.isSymbolicLink()||ps.size>4*1024*1024)throw Error();}catch{throw fail('MAS_DEV_PROFILE_UNAVAILABLE');}
 const identity=identities(run('security',['find-identity','-v','-p','codesigning'])).find(i=>i.name===config.identity);
 if(!identity)throw fail('MAS_DEV_IDENTITY_UNAVAILABLE');
 const parse=deps.parsePlist||require('plist').parse;
 let profile;try{profile=parse(run('security',['cms','-D','-i',config.profile]));}catch{throw fail('MAS_DEV_PROFILE_INVALID');}
 const deviceId=deps.readDeviceId?deps.readDeviceId():readCurrentDeviceId(run);
 validateDevelopmentProfile(profile,config,identity.fingerprint,deviceId,deps.now?.()??Date.now());
 // Cache-only build: never ask @electron/get to download a runtime or use darwin.
 const zip=path.join(config.zipDir,`electron-v${config.electronVersion}-mas-${config.arch}.zip`);
 try{const s=io.lstatSync(zip);if(!s.isFile()||s.isSymbolicLink()||s.size<1)throw Error();}catch{throw fail('MAS_DEV_CACHED_MAS_RUNTIME_REQUIRED');}
 if(!release.isFirstRelease(config))await (deps.validateResources||(async()=>{const resourcesPath=path.join(root,'desktop-pet/build');await require('../lib/mas-bundled-codex').resolveBundledCodex({resourcesPath,arch:config.arch});if(!release.isFirstRelease(config))await require('../lib/mas-bundled-workbuddy').resolveBundledWorkBuddy({resourcesPath});}))();
 (deps.validateBuildTools||require('./mas-development-tools').validateMasDevelopmentTools)({run,io});
 const mac=deps.mac||require('./package-mac'),makeIcon=deps.makeIcon||require('./make-icon').makeIcon;
 (deps.buildWeatherLocation||require('./build-weather-location').buildWeatherLocation)(root);
 (deps.buildCalendarEvents||require('./build-calendar-events').buildCalendarEvents)(root,{targetArch:config.arch});
 (deps.buildPluginHost||require('./build-plugin-host').buildPluginHost)(root);
 const widgetArtifacts=await nativeWidgets.prepareNativeWidgets(root,pkg,config,deps.buildNativeWidgets);
 const icon=makeIcon(root),staging=mac.prepareStaging(root,path.join(root,'desktop-pet/build/mas-development-staging',config.arch),{pluginNative:true});
 nativeWidgets.stageWidgetModule(staging,widgetArtifacts,io);
 const staged=JSON.parse(io.readFileSync(path.join(staging,'package.json'),'utf8'));release.trimStaging(staging,config,io);if(release.isFirstRelease(config))staged.qiuqiuReleaseProfile=release.FIRST_RELEASE;Object.assign(staged,{version:config.version,qiuqiuAcceptance:'mas',qiuqiuDistribution:'mas-development',main:'mas-development-entry.js'});
 io.writeFileSync(path.join(staging,'package.json'),JSON.stringify(staged,null,2)+'\n');io.writeFileSync(path.join(staging,'mas-development-entry.js'),probeEntry(config.bundleId,config));
 const options=packagerOptions(root,config,staging,icon,mac.buildPackagerOptions(root,icon));
 const packageApp=deps.packager||(await import('@electron/packager')).packager,outputs=await packageApp(options);
 if(!Array.isArray(outputs)||outputs.length!==1)throw fail('MAS_DEV_OUTPUT_INVALID');
 const appPath=path.join(outputs[0],NAME+'.app');if(!io.existsSync(appPath))throw fail('MAS_DEV_APP_MISSING');
 release.assertNoBundledProviders(appPath,config,io);
 const languageResources=release.trimElectronLocales(appPath,config,io);
 const plist=deps.buildPlist||require('plist').build,rights=entitlementsFor(config),signDir=path.join(options.out,'signing');io.mkdirSync(signDir,{recursive:true,mode:0o700});
 const mainFile=path.join(signDir,'main.entitlements.plist'),childFile=path.join(signDir,'child.entitlements.plist');io.writeFileSync(mainFile,plist(rights.main));io.writeFileSync(childFile,plist(rights.child));
 const embeddedWidgets=nativeWidgets.embedNativeWidgets(appPath,widgetArtifacts,signDir,io);
 if (release.isFirstRelease(config)) {
    const manifest = path.join(ROOT, 'desktop-pet/native/PrivacyInfo.xcprivacy');
    io.copyFileSync(manifest, path.join(appPath, 'Contents/Resources/PrivacyInfo.xcprivacy'));
  }
  io.copyFileSync(config.profile,path.join(appPath,'Contents/embedded.provisionprofile'));
 const signing=deps.signing||await import('@electron/osx-sign'),sign=signing.signAsync||signing.sign;
 if(typeof sign!=='function')throw fail('MAS_DEV_SIGN_API_UNAVAILABLE');
 await sign({app:appPath,platform:'mas',type:'development',batchCodesignCalls:true,identity:identity.fingerprint,identityValidation:true,provisioningProfile:config.profile,preEmbedProvisioningProfile:true,preAutoEntitlements:false,strictVerify:true,
  binaries:[...(release.isFirstRelease(config)?[]:[path.join(appPath,'Contents/Resources/qiuqiu-codex',`darwin-${config.arch}`,'codex')]),...(embeddedWidgets?[embeddedWidgets.helperPath,embeddedWidgets.extensionPath]:[])],
  optionsForFile:file=>({entitlements:nativeWidgets.entitlementFileFor(file,appPath,mainFile,childFile,embeddedWidgets),hardenedRuntime:false,timestamp:'none'})});
 const resources=refreshBundledManifests(appPath,io,config.arch,config);
 // Updating a resource invalidates only the outer seal. Preserve nested helper
 // signatures and entitlements: never deep-resign after refreshing the digests.
 run('codesign',['--force','--sign',identity.fingerprint,'--entitlements',mainFile,'--timestamp=none',appPath]);
 run('codesign',['--verify','--deep','--strict',appPath]);
 let sealed;try{sealed=parse(run('codesign',['--display','--entitlements',':-',appPath]));}catch{throw fail('MAS_DEV_ENTITLEMENTS_UNVERIFIED');}
 for(const [key,value]of Object.entries(rights.main))if(JSON.stringify(sealed[key])!==JSON.stringify(value))throw fail('MAS_DEV_ENTITLEMENTS_UNVERIFIED');
 const ownTargets=release.isFirstRelease(config)?release.ownSigningTargets(appPath,io):[];
 for(const target of ownTargets)run('codesign',['--verify','--strict',target.path]);
 for(const child of (release.isFirstRelease(config)?ownTargets.filter(t=>t.entitlements).map(t=>t.path):[path.join(appPath,'Contents/Resources/qiuqiu-codex',`darwin-${config.arch}`,'codex'),path.join(appPath,'Contents/Frameworks',NAME+' Helper.app')])){let e;try{e=parse(run('codesign',['--display','--entitlements',':-',child]));}catch{throw fail('MAS_DEV_CHILD_ENTITLEMENTS_UNVERIFIED');}if(e['com.apple.security.app-sandbox']!==true||e['com.apple.security.inherit']!==true)throw fail('MAS_DEV_CHILD_ENTITLEMENTS_UNVERIFIED');}
 const widgetSigning=nativeWidgets.verifyNativeWidgets(embeddedWidgets,run,rights.child,parse);
 let probe;try{const text=run(path.join(appPath,'Contents/MacOS',NAME),['--qiuqiu-mas-runtime-probe']);probe=JSON.parse(text.trim());}catch{throw fail('MAS_DEV_RUNTIME_PROBE_FAILED');}
 if(probe?.mas!==true||probe.ownContainer!==true||probe.capabilities?.userSelectedExecutable!==false||!['known','sandbox','userSelectedReadWrite','appScopeBookmarks'].every(k=>probe.capabilities?.[k]===true))throw fail('MAS_DEV_RUNTIME_PROBE_FAILED');
 let helperProbe;try{const text=run(path.join(appPath,'Contents/MacOS',NAME),['--qiuqiu-mas-helper-probe'],{timeout:90000});helperProbe=JSON.parse(text.trim());}catch{throw fail('MAS_DEV_HELPER_PROBE_FAILED');}
 if(release.isFirstRelease(config)){
  if(helperProbe?.mas!==true||helperProbe.ownContainer!==true||helperProbe.codexRuntime!=='user-installed'||helperProbe.bundled!==false||helperProbe.installedProviderAcceptance!==false||helperProbe.validationScope!=='app-sandbox-container-only'||helperProbe.modelRequestsSent!==false||helperProbe.originalCredentialsRead!==false)throw fail('MAS_DEV_HELPER_PROBE_FAILED');
 }else if(helperProbe?.mas!==true||helperProbe.ownContainer!==true||helperProbe.helper?.passed!==true||helperProbe.helper?.metadataTransport?.passed!==true||helperProbe.helper?.modelRequestsSent!==false||helperProbe.helper?.originalCredentialsRead!==false||helperProbe.helper?.workbuddy?.vendorAccountVerified!==false)throw fail('MAS_DEV_HELPER_PROBE_FAILED');
 let widgetBridgeProbe=null;
 if(embeddedWidgets){
  try{widgetBridgeProbe=JSON.parse(run(path.join(appPath,'Contents/MacOS',NAME),['--qiuqiu-native-widget-probe']).trim());}
  catch{throw fail('MAS_DEV_WIDGET_BRIDGE_PROBE_FAILED');}
  if(widgetBridgeProbe?.mas!==true||widgetBridgeProbe.ownContainer!==true||widgetBridgeProbe.bridgeSandboxValidated!==true||widgetBridgeProbe.report?.ok!==true)throw fail('MAS_DEV_WIDGET_BRIDGE_PROBE_FAILED');
 }
 return{platform:'mas',releaseProfile:config.releaseProfile||null,...release.providerRuntimeMetadata(config),purpose:'development-sandbox-validation',arch:config.arch,appPath,signedDevelopmentApp:true,identityValidated:true,profileValidated:true,currentDeviceRegistered:true,
  bundledManifestRefresh:resources,languageResources,nativeWidgets:widgetSigning,widgetBridgeProbe,masRuntimeAndContainerProbePassed:true,sandboxCapabilities:probe.capabilities,managedHelperInitializationProbe:release.isFirstRelease(config)?null:helperProbe.helper,...(release.isFirstRelease(config)?{applicationSandboxProbe:helperProbe}:{}),chatAndDirectoryAcceptancePassed:false,submissionReady:false,
  note:'Local development build only. Genuine MAS runtime/container initialization is separate from login/chat/task/directory acceptance and App Store review.'};
}
if(require.main===module){(async()=>{const {mode,arch}=argumentsFor(process.argv.slice(2));const value=mode==='plan'?planFor(JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')),process.env,arch):await buildMasDevelopment({arch});process.stdout.write(JSON.stringify(value,null,2)+'\n');})().catch(e=>{process.stderr.write((e.code?.startsWith('MAS_DEV_')?e.code:'MAS_DEV_BUILD_FAILED')+'\n');process.exitCode=2;});}
module.exports={configFor,planFor,validateDevelopmentProfile,readCurrentDeviceId,entitlementsFor,packagerOptions,refreshBundledManifests,probeEntry,buildMasDevelopment};
