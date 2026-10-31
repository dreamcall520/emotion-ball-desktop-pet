#!/usr/bin/env node
'use strict';
// Local MAS development build only. Never creates identities, profiles or uploads.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {marketingVersion,identities,argumentsFor}=require('./package-mas');
const ROOT=path.resolve(__dirname,'../..'),NAME='球球桌宠-商店沙盒开发候选';
const REQUIRED=['MAS_DEV_BUNDLE_ID','MAS_DEV_TEAM_ID','MAS_DEV_PROFILE','MAS_DEV_SIGN_IDENTITY','MAS_DEV_BUILD_VERSION','MAS_DEV_ELECTRON_ZIP_DIR'];
const fail=code=>Object.assign(new Error(code),{code});
function configFor(pkg,env={},arch=env.MAS_DEV_ARCH||process.arch){
 const missing=REQUIRED.filter(name=>typeof env[name]!=='string'||!env[name].trim()),errors=[];
 let version;try{version=marketingVersion(pkg.version);}catch{errors.push('MAS_DEV_VERSION_INVALID');}
 const config={arch,version,electronVersion:pkg.devDependencies?.electron,bundleId:env.MAS_DEV_BUNDLE_ID,teamId:env.MAS_DEV_TEAM_ID,profile:env.MAS_DEV_PROFILE,identity:env.MAS_DEV_SIGN_IDENTITY,buildVersion:env.MAS_DEV_BUILD_VERSION,zipDir:env.MAS_DEV_ELECTRON_ZIP_DIR};
 if(!['arm64','x64'].includes(arch))errors.push('MAS_DEV_ARCH_INVALID');
 if(!/^\d+\.\d+\.\d+$/.test(config.electronVersion||''))errors.push('MAS_DEV_ELECTRON_VERSION_INVALID');
 if(config.bundleId&&!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.masdevelopment$/.test(config.bundleId))errors.push('MAS_DEV_ISOLATED_BUNDLE_ID_REQUIRED');
 if(config.teamId&&!/^[A-Z0-9]{10}$/.test(config.teamId))errors.push('MAS_DEV_TEAM_ID_INVALID');
 for(const [key,code] of [['profile','MAS_DEV_PROFILE_PATH_INVALID'],['zipDir','MAS_DEV_ZIP_DIR_INVALID']])if(config[key]&&!path.isAbsolute(config[key]))errors.push(code);
 if(config.identity&&(!config.identity.startsWith('Apple Development: ')||!config.identity.endsWith(` (${config.teamId})`)))errors.push('MAS_DEV_APPLE_DEVELOPMENT_IDENTITY_REQUIRED');
 if(config.buildVersion&&(!/^[1-9]\d*$/.test(config.buildVersion)||!Number.isSafeInteger(Number(config.buildVersion))))errors.push('MAS_DEV_BUILD_VERSION_INVALID');
 return{config,missing,errors};
}
function planFor(pkg,env={},arch){
 const {config,missing,errors}=configFor(pkg,env,arch);
 return{mode:'plan',platform:'mas',purpose:'development-sandbox-validation',arch:config.arch,version:config.version||null,electronVersion:config.electronVersion||null,
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
 if(e['get-task-allow']!==true&&e['com.apple.security.get-task-allow']!==true||profile.ProvisionsAllDevices===true)throw fail('MAS_DEV_DEVELOPMENT_PROFILE_REQUIRED');
 if(typeof deviceId!=='string'||!deviceId||deviceId.length>128||!/^[A-Za-z0-9-]+$/.test(deviceId))throw fail('MAS_DEV_DEVICE_ID_UNAVAILABLE');
 if(!Array.isArray(profile.ProvisionedDevices)||!profile.ProvisionedDevices.includes(deviceId))throw fail('MAS_DEV_CURRENT_DEVICE_NOT_REGISTERED');
 if(!Array.isArray(profile.DeveloperCertificates)||!profile.DeveloperCertificates.some(cert=>(Buffer.isBuffer(cert)||cert instanceof Uint8Array)&&createHash('sha1').update(cert).digest('hex').toUpperCase()===fingerprint))throw fail('MAS_DEV_PROFILE_CERTIFICATE_MISMATCH');
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
 return{main:{'com.apple.security.app-sandbox':true,'com.apple.application-identifier':`${config.teamId}.${config.bundleId}`,
  'com.apple.developer.team-identifier':config.teamId,'com.apple.security.application-groups':[`${config.teamId}.${config.bundleId}`],
  'com.apple.security.get-task-allow':true,'com.apple.security.files.user-selected.read-write':true,'com.apple.security.files.bookmarks.app-scope':true,
  'com.apple.security.network.client':true,'com.apple.security.network.server':true,'com.apple.security.personal-information.location':true},
  child:{'com.apple.security.app-sandbox':true,'com.apple.security.inherit':true}};
}
function packagerOptions(root,config,staging,icon,base={}){
 const options={...base,dir:staging,out:path.join(root,'dist/mas-development',config.arch),platform:'mas',arch:config.arch,name:NAME,
  appBundleId:config.bundleId,appVersion:config.version,buildVersion:config.buildVersion,electronVersion:config.electronVersion,electronZipDir:config.zipDir,
  asar:{unpack:'**/*.node'},overwrite:true,prune:true,quiet:true,osxSign:false,
  extraResource:['qiuqiu-codex','qiuqiu-workbuddy'].map(name=>path.join(root,'desktop-pet/build',name)),
  extendInfo:{...base.extendInfo,ElectronTeamID:config.teamId}};
 delete options.osxNotarize;return options;
}
function hashFile(file,io=fs){return createHash('sha256').update(io.readFileSync(file)).digest('hex');}
function refreshBundledManifests(appPath,io=fs,arch=process.arch){
 const resources=path.join(appPath,'Contents/Resources'),codexDir=path.join(resources,'qiuqiu-codex',`darwin-${arch}`);
 const codexFile=path.join(codexDir,'manifest.json'),wbDir=path.join(resources,'qiuqiu-workbuddy'),wbFile=path.join(wbDir,'manifest.json');
 const load=file=>{const s=io.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');return JSON.parse(io.readFileSync(file,'utf8'));};
 const cm=load(codexFile),wm=load(wbFile);
 if(cm.provider!=='codex'||cm.binary!=='codex'||wm.provider!=='workbuddy-cli'||!wm.files||typeof wm.files!=='object'||Array.isArray(wm.files)||Object.keys(wm.files).length>10000)throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');
 const regular=file=>{const s=io.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');return file;};
 cm.binarySha256=hashFile(regular(path.join(codexDir,'codex')),io);
 for(const rel of Object.keys(wm.files)){
  if(!rel.startsWith('node_modules/')||rel.includes('\\')||rel.split('/').some(x=>!x||x==='.'||x==='..'))throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');
  let parent=path.dirname(path.join(wbDir,rel));while(parent!==wbDir){const s=io.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink())throw fail('MAS_DEV_RUNTIME_MANIFEST_INVALID');parent=path.dirname(parent);}
  wm.files[rel]=hashFile(regular(path.join(wbDir,rel)),io);
 }
 io.writeFileSync(codexFile,JSON.stringify(cm,null,2)+'\n');io.writeFileSync(wbFile,JSON.stringify(wm,null,2)+'\n');
 return{codexFiles:1,workbuddyFiles:Object.keys(wm.files).length};
}
function probeEntry(bundleId){return `'use strict';\nif(process.mas!==true){process.stderr.write('MAS_RUNTIME_REQUIRED\\n');process.exit(2);}\nif(process.argv.includes('--qiuqiu-mas-runtime-probe')){const {app}=require('electron');app.whenReady().then(()=>{const ownContainer=app.getPath('userData').includes('/Library/Containers/${bundleId}/Data/');process.stdout.write(JSON.stringify({mas:true,ownContainer})+'\\n');app.exit(ownContainer?0:2);}).catch(()=>app.exit(2));}else require('./desktop-pet/main.js');\n`;}
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
 await (deps.validateResources||(async()=>{const resourcesPath=path.join(root,'desktop-pet/build');await require('../lib/mas-bundled-codex').resolveBundledCodex({resourcesPath,arch:config.arch});await require('../lib/mas-bundled-workbuddy').resolveBundledWorkBuddy({resourcesPath});}))();
 run('xcodebuild',['-version']);
 const mac=deps.mac||require('./package-mac'),makeIcon=deps.makeIcon||require('./make-icon').makeIcon;
 (deps.buildWeatherLocation||require('./build-weather-location').buildWeatherLocation)(root);
 (deps.buildPluginHost||require('./build-plugin-host').buildPluginHost)(root);
 const icon=makeIcon(root),staging=mac.prepareStaging(root,path.join(root,'desktop-pet/build/mas-development-staging',config.arch),{pluginNative:true});
 const staged=JSON.parse(io.readFileSync(path.join(staging,'package.json'),'utf8'));Object.assign(staged,{version:config.version,qiuqiuAcceptance:'mas',qiuqiuDistribution:'mas-development',main:'mas-development-entry.js'});
 io.writeFileSync(path.join(staging,'package.json'),JSON.stringify(staged,null,2)+'\n');io.writeFileSync(path.join(staging,'mas-development-entry.js'),probeEntry(config.bundleId));
 const options=packagerOptions(root,config,staging,icon,mac.buildPackagerOptions(root,icon));
 const packageApp=deps.packager||(await import('@electron/packager')).packager,outputs=await packageApp(options);
 if(!Array.isArray(outputs)||outputs.length!==1)throw fail('MAS_DEV_OUTPUT_INVALID');
 const appPath=path.join(outputs[0],NAME+'.app');if(!io.existsSync(appPath))throw fail('MAS_DEV_APP_MISSING');
 const plist=deps.buildPlist||require('plist').build,rights=entitlementsFor(config),signDir=path.join(options.out,'signing');io.mkdirSync(signDir,{recursive:true,mode:0o700});
 const mainFile=path.join(signDir,'main.entitlements.plist'),childFile=path.join(signDir,'child.entitlements.plist');io.writeFileSync(mainFile,plist(rights.main));io.writeFileSync(childFile,plist(rights.child));
 io.copyFileSync(config.profile,path.join(appPath,'Contents/embedded.provisionprofile'));
 const signing=deps.signing||await import('@electron/osx-sign'),sign=signing.signAsync||signing.sign;
 if(typeof sign!=='function')throw fail('MAS_DEV_SIGN_API_UNAVAILABLE');
 await sign({app:appPath,platform:'mas',type:'development',identity:identity.fingerprint,identityValidation:true,provisioningProfile:config.profile,preEmbedProvisioningProfile:true,preAutoEntitlements:false,strictVerify:true,
  binaries:[path.join(appPath,'Contents/Resources/qiuqiu-codex',`darwin-${config.arch}`,'codex')],
  optionsForFile:file=>({entitlements:file===appPath?mainFile:childFile,hardenedRuntime:false})});
 const resources=refreshBundledManifests(appPath,io,config.arch);
 // Updating a resource invalidates only the outer seal. Preserve nested helper
 // signatures and entitlements: never deep-resign after refreshing the digests.
 run('codesign',['--force','--sign',identity.fingerprint,'--entitlements',mainFile,'--timestamp=none',appPath]);
 run('codesign',['--verify','--deep','--strict',appPath]);
 let sealed;try{sealed=parse(run('codesign',['--display','--entitlements',':-',appPath]));}catch{throw fail('MAS_DEV_ENTITLEMENTS_UNVERIFIED');}
 for(const key of ['com.apple.security.app-sandbox','com.apple.security.network.client','com.apple.security.network.server','com.apple.security.files.bookmarks.app-scope'])if(sealed[key]!==true)throw fail('MAS_DEV_ENTITLEMENTS_UNVERIFIED');
 for(const child of [path.join(appPath,'Contents/Resources/qiuqiu-codex',`darwin-${config.arch}`,'codex'),path.join(appPath,'Contents/Frameworks',NAME+' Helper.app')]){let e;try{e=parse(run('codesign',['--display','--entitlements',':-',child]));}catch{throw fail('MAS_DEV_CHILD_ENTITLEMENTS_UNVERIFIED');}if(e['com.apple.security.app-sandbox']!==true||e['com.apple.security.inherit']!==true)throw fail('MAS_DEV_CHILD_ENTITLEMENTS_UNVERIFIED');}
 let probe;try{const text=run(path.join(appPath,'Contents/MacOS',NAME),['--qiuqiu-mas-runtime-probe']);probe=JSON.parse(text.trim());}catch{throw fail('MAS_DEV_RUNTIME_PROBE_FAILED');}
 if(probe?.mas!==true||probe.ownContainer!==true)throw fail('MAS_DEV_RUNTIME_PROBE_FAILED');
 return{platform:'mas',purpose:'development-sandbox-validation',arch:config.arch,appPath,signedDevelopmentApp:true,identityValidated:true,profileValidated:true,currentDeviceRegistered:true,
  bundledManifestRefresh:resources,masRuntimeAndContainerProbePassed:true,chatAndDirectoryAcceptancePassed:false,submissionReady:false,
  note:'Local development build only. Genuine MAS runtime/container initialization is separate from login/chat/task/directory acceptance and App Store review.'};
}
if(require.main===module){(async()=>{const {mode,arch}=argumentsFor(process.argv.slice(2));const value=mode==='plan'?planFor(JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')),process.env,arch):await buildMasDevelopment({arch});process.stdout.write(JSON.stringify(value,null,2)+'\n');})().catch(e=>{process.stderr.write((e.code?.startsWith('MAS_DEV_')?e.code:'MAS_DEV_BUILD_FAILED')+'\n');process.exitCode=2;});}
module.exports={configFor,planFor,validateDevelopmentProfile,readCurrentDeviceId,entitlementsFor,packagerOptions,refreshBundledManifests,probeEntry,buildMasDevelopment};
