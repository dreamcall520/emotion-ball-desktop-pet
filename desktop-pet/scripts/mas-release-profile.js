'use strict';
const fs = require('node:fs');
const path = require('node:path');
const FIRST_RELEASE = 'mas-first';
const isFirstRelease = config => config?.releaseProfile === FIRST_RELEASE;
const resourceNames = config => isFirstRelease(config) ? [] : ['qiuqiu-codex', 'qiuqiu-workbuddy'];
const providerRuntimeMetadata=config=>({codexRuntime:isFirstRelease(config)?'user-installed':'bundled',bundled:!isFirstRelease(config),installedProviderAcceptance:false});
function assertNoBundledProviders(appPath,config,io=fs){
 if(!isFirstRelease(config))return;
 for(const provider of ['qiuqiu-codex','qiuqiu-workbuddy'])if(io.existsSync(path.join(appPath,'Contents/Resources',provider)))throw Object.assign(Error('Unexpected bundled provider runtime'),{code:'MAS_FIRST_BUNDLED_RUNTIME_PRESENT'});
}
// Own native modules and native LoginItem/Electron helpers remain signed and
// verified even when no vendor executable is bundled. Never follow symlinks.
function ownSigningTargets(appPath,io=fs){
 const targets=[];
 function walk(directory){if(!io.existsSync(directory))return;for(const name of io.readdirSync(directory)){const full=path.join(directory,name),stat=io.lstatSync(full);if(stat.isSymbolicLink())continue;if(stat.isDirectory()){if(name.endsWith('.app'))targets.push({path:full,entitlements:true});walk(full);}else if(stat.isFile()&&name.endsWith('.node'))targets.push({path:full,entitlements:false});}}
 for(const child of ['Frameworks','Library/LoginItems','Resources/app.asar.unpacked'])walk(path.join(appPath,'Contents',child));
 return targets;
}
// Build-time filtering only. Runtime modules still statically imported by main
// remain until their call sites are removed; first-release startup disables them.
function trimStaging(staging, config, io = fs) {
  if (!isFirstRelease(config)) return [];
  const removed = [
    'desktop-pet/assets/workbuddy-desktop-hook',
    'desktop-pet/assets/zcode-desktop-hook',
    'desktop-pet/lib/mas-plugin-install-probe.js',
    'desktop-pet/lib/mas-helper-probe.js'
  ];
  for (const name of removed) io.rmSync(path.join(staging, name), { recursive: true, force: true });
  return removed;
}
// @electron/packager 20.3.0 has no electronLanguages option. Prune complete
// locale directories only after packaging and before any final signing.
const FIRST_RELEASE_LANGUAGES=Object.freeze(['Base','en','en_GB','en_US','zh_CN','zh_TW','zh_HK','zh_MO','zh_SG','zh_Hans','zh_Hant']);
function keepElectronLanguage(language){
 return typeof language==='string'&&FIRST_RELEASE_LANGUAGES.some(allowed=>allowed.toLowerCase()===language.replace(/-/g,'_').toLowerCase());
}
function trimElectronLocales(appPath,config,io=fs){
 if(!isFirstRelease(config))return{applied:false,removedDirectories:0,removedBytes:0,updatedPlists:0};
 const root=io.lstatSync(appPath);
 if(!path.isAbsolute(appPath)||!root.isDirectory()||root.isSymbolicLink())throw Object.assign(Error('Invalid packaged app directory'),{code:'MAS_FIRST_LOCALE_ROOT_INVALID'});
 const plist=require('plist'),report={applied:true,retainedLanguages:[...FIRST_RELEASE_LANGUAGES],removedDirectories:0,removedBytes:0,updatedPlists:0};
 function sizeOf(file){const stat=io.lstatSync(file);if(stat.isSymbolicLink())return 0;if(stat.isFile())return stat.size;if(stat.isDirectory())return io.readdirSync(file).reduce((sum,name)=>sum+sizeOf(path.join(file,name)),0);return 0;}
 function prune(directory){
  if(!io.existsSync(directory))return;
  for(const name of io.readdirSync(directory)){
   const file=path.join(directory,name),stat=io.lstatSync(file);
   if(name.endsWith('.lproj')&&!keepElectronLanguage(name.slice(0,-6))){report.removedBytes+=sizeOf(file);io.rmSync(file,{recursive:true,force:true});report.removedDirectories++;continue;}
   if(stat.isSymbolicLink())continue;
   if(stat.isDirectory()){prune(file);continue;}
   if(name!=='Info.plist'||!stat.isFile())continue;
   // Remove stale explicit localization declarations as well as locale.pak.
   // Do not invent app UI localization claims when the key is absent.
   const info=plist.parse(io.readFileSync(file,'utf8'));let changed=false;
   if(Array.isArray(info.CFBundleLocalizations)){
    const filtered=info.CFBundleLocalizations.filter(keepElectronLanguage);
    if(JSON.stringify(filtered)!==JSON.stringify(info.CFBundleLocalizations)){info.CFBundleLocalizations=filtered;changed=true;}
   }
   if(typeof info.CFBundleDevelopmentRegion==='string'&&!keepElectronLanguage(info.CFBundleDevelopmentRegion)){info.CFBundleDevelopmentRegion='en';changed=true;}
   if(changed){io.writeFileSync(file,plist.build(info));report.updatedPlists++;}
  }
 }
 // These are the packaged app and Apple's native helper resources, not a
 // user's external material library or any shared Electron runtime cache.
 prune(path.join(appPath,'Contents'));
 return report;
}

module.exports = { FIRST_RELEASE, isFirstRelease, resourceNames, providerRuntimeMetadata, assertNoBundledProviders, ownSigningTargets, trimStaging, FIRST_RELEASE_LANGUAGES, keepElectronLanguage, trimElectronLocales };
