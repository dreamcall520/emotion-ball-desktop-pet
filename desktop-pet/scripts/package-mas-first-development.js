#!/usr/bin/env node
'use strict';
// Uses only existing local public certificates/profiles and pinned runtime cache.
// Never creates identities/profiles, opens vendor accounts, or submits anything.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {identities,validateMasRuntimeCache}=require('./package-mas');
const dev=require('./package-mas-development');
const ROOT=path.resolve(__dirname,'../..');
const fail=code=>Object.assign(new Error(code),{code});
function discoverDevelopmentEnvironment({home=os.homedir(),arch=process.arch,buildVersion=String(Math.floor(Date.now()/1000)),run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}),parse=require('plist').parse,now=Date.now()}={}){
 const available=identities(run('security',['find-identity','-v','-p','codesigning']));
 const choices=[];
 for(const base of [path.join(home,'Library/Developer/Xcode/UserData/Provisioning Profiles'),path.join(home,'Library/MobileDevice/Provisioning Profiles')]){
  if(!fs.existsSync(base))continue;
  for(const name of fs.readdirSync(base).filter(n=>n.endsWith('.provisionprofile'))){
   const file=path.join(base,name);let p;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)continue;p=parse(run('security',['cms','-D','-i',file]));}catch{continue;}
   const e=p.Entitlements,team=e?.['com.apple.developer.team-identifier'],id=e?.['com.apple.application-identifier']||e?.['application-identifier'];
   if(!(p.ExpirationDate instanceof Date)||p.ExpirationDate.getTime()<=now||!Array.isArray(p.ProvisionedDevices)||!p.ProvisionedDevices.length||typeof team!=='string'||typeof id!=='string'||!id.startsWith(team+'.')||!id.endsWith('.masdevelopment')||p.ProvisionsAllDevices===true)continue;
   const certs=(p.DeveloperCertificates||[]).map(c=>createHash('sha1').update(c).digest('hex').toUpperCase());
   for(const identity of available.filter(i=>i.name.startsWith('Apple Development: ')&&certs.includes(i.fingerprint)))choices.push({profile:file,team,bundleId:id.slice(team.length+1),identity:identity.name});
  }
 }
 const unique=[...new Map(choices.map(c=>[JSON.stringify([c.team,c.bundleId,c.identity]),c])).values()];
 if(unique.length!==1)throw fail(unique.length?'MAS_FIRST_DEVELOPMENT_PROFILE_AMBIGUOUS':'MAS_FIRST_DEVELOPMENT_PROFILE_UNAVAILABLE');
 const chosen=unique[0],cache=path.join(home,'Library/Caches/electron'),archive=`electron-v43.4.1-mas-${arch}.zip`;
 const dirs=[cache,...(fs.existsSync(cache)?fs.readdirSync(cache).map(n=>path.join(cache,n)).filter(n=>{try{return fs.lstatSync(n).isDirectory()&&!fs.lstatSync(n).isSymbolicLink();}catch{return false;}}):[])];
 const zipDir=dirs.find(d=>fs.existsSync(path.join(d,archive)));
 if(!zipDir)throw fail('MAS_FIRST_CACHED_RUNTIME_UNAVAILABLE');
 validateMasRuntimeCache({electronVersion:'43.4.1',arch,runtimeZipDir:zipDir});
 return{MAS_DEV_BUNDLE_ID:chosen.bundleId,MAS_DEV_TEAM_ID:chosen.team,MAS_DEV_PROFILE:chosen.profile,MAS_DEV_SIGN_IDENTITY:chosen.identity,MAS_DEV_BUILD_VERSION:buildVersion,MAS_DEV_ELECTRON_ZIP_DIR:zipDir,MAS_DEV_ARCH:arch};
}
async function main(argv){
 if(argv.some(x=>!['--plan','--build'].includes(x))||argv.includes('--plan')&&argv.includes('--build'))throw fail('MAS_FIRST_ARGUMENT_INVALID');
 const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
 if(pkg.qiuqiuReleaseProfile!=='mas-first')throw fail('MAS_FIRST_PROFILE_REQUIRED');
 const env=discoverDevelopmentEnvironment();
 const result=argv.includes('--build')?await dev.buildMasDevelopment({root:ROOT,env}):{...dev.planFor(pkg,env),publicDevelopmentConfigurationDiscovered:true,pinnedRuntimeCacheValidated:true,note:'Read-only plan from existing local public certificate/profile metadata and pinned runtime cache. No signing, account login, model requests, upload or submission.'};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{process.stderr.write((e.code?.startsWith('MAS_')?e.code:'MAS_FIRST_DEVELOPMENT_FAILED')+'\n');process.exitCode=2;});
module.exports={discoverDevelopmentEnvironment};
