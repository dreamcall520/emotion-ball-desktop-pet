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
// Keep installed-client quota, task metadata and the separately approved
// animation hook and explicit chat consent separate from legacy website and bundled CLI capabilities. Report projections
// below contain no provider I/O and are shared with the website channel.
const WORKBUDDY_FILES = new Set([
  'desktop-pet/workbuddy-label.html', 'desktop-pet/workbuddy-label.css',
  'desktop-pet/workbuddy-label-preload.js', 'desktop-pet/workbuddy-label-renderer.js',
  'desktop-pet/workbuddy-details.html', 'desktop-pet/workbuddy-details.css',
  'desktop-pet/workbuddy-details-preload.js', 'desktop-pet/workbuddy-details-renderer.js',
  'desktop-pet/lib/mas-installed-workbuddy-access.js', 'desktop-pet/lib/mas-installed-workbuddy.js',
  'desktop-pet/lib/mas-workbuddy-chat-connection.js', 'desktop-pet/lib/workbuddy-chat.js',
  'desktop-pet/lib/workbuddy-client.js', 'desktop-pet/lib/workbuddy-helper.cjs',
  'desktop-pet/lib/workbuddy-quota.js', 'desktop-pet/lib/workbuddy-quota-status.js',
  'desktop-pet/lib/workbuddy-auth-watch.js', 'desktop-pet/lib/workbuddy-usage.js',
  'desktop-pet/lib/workbuddy-usage-reader.js', 'desktop-pet/lib/workbuddy-label-window.js',
  'desktop-pet/lib/workbuddy-details-window.js', 'desktop-pet/lib/workbuddy-website-summary.js',
  'desktop-pet/lib/mas-workbuddy-details.js', 'desktop-pet/lib/mas-workbuddy-quota-connection.js',
  'desktop-pet/lib/mas-workbuddy-task-access.js', 'desktop-pet/lib/workbuddy-tasks-reader.js',
  'desktop-pet/lib/workbuddy-tasks.js', 'desktop-pet/workbuddy-tasks-renderer.js',
  'desktop-pet/lib/mas-workbuddy-event-installation.js', 'desktop-pet/lib/mas-workbuddy-task-notifications.js',
  'desktop-pet/lib/workbuddy-desktop-task-state.js', 'desktop-pet/lib/workbuddy-desktop-event-bridge.js',
  'desktop-pet/lib/workbuddy-guard-entry-window.js', 'desktop-pet/workbuddy-guard-entry.html',
  'desktop-pet/workbuddy-guard-entry.css', 'desktop-pet/workbuddy-guard-entry-preload.js',
  'desktop-pet/assets/integrations/workbuddy.png'
]);
function trimStaging(staging, config, io = fs) {
  if (!isFirstRelease(config)) return [];
  const removed = [
    'desktop-pet/store-connections.html',
    'desktop-pet/store-connections.css',
    'desktop-pet/store-connections-renderer.js',
    'desktop-pet/store-connections-preload.js',
    'desktop-pet/assets/workbuddy-desktop-hook/.codebuddy-plugin',
    'desktop-pet/assets/workbuddy-desktop-hook/plugins/qiuqiu-task-events/.codebuddy-plugin',
    'desktop-pet/assets/zcode-desktop-hook',
    'desktop-pet/vendor/workbuddy-cli',
    'desktop-pet/lib/mas-plugin-install-probe.js',
    'desktop-pet/lib/mas-helper-probe.js'
  ];
  for (const directory of ['desktop-pet', 'desktop-pet/lib', 'desktop-pet/scripts', 'desktop-pet/assets/integrations']) {
    const full = path.join(staging, directory);
    if (!io.existsSync(full)) continue;
    for (const name of io.readdirSync(full)) {
      const relative = path.posix.join(directory, name);
      if (/^(?:mas-(?:(?:bundled|installed)-)?)?workbuddy(?:[-.]|$)|^(?:verify|prepare-mas)-workbuddy-/i.test(name) &&
          !WORKBUDDY_FILES.has(relative)) {
        removed.push(relative);
      }
    }
  }
  // Global hooks need only the reviewed filter script and event declarations;
  // no marketplace/plugin registration assets or arbitrary sibling files ship.
  const hookRoot = 'desktop-pet/assets/workbuddy-desktop-hook';
  const hookFiles = ['plugins/qiuqiu-task-events/scripts/emit-metadata.sh', 'plugins/qiuqiu-task-events/hooks/hooks.json'];
  function trimHook(directory, prefix = '') {
    const full = path.join(staging, directory); if (!io.existsSync(full)) return;
    for (const name of io.readdirSync(full)) {
      const relative = prefix + name, target = path.posix.join(directory, name);
      if (hookFiles.includes(relative)) continue;
      if (hookFiles.some(file => file.startsWith(relative + '/'))) trimHook(target, relative + '/');
      else removed.push(target);
    }
  }
  trimHook(hookRoot);
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
