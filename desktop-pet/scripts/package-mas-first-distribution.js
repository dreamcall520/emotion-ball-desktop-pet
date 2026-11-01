#!/usr/bin/env node
'use strict';
// Discover existing public signing metadata only. No certificate creation,
// account requests, upload, submission, or rights declarations are performed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const mas=require('./package-mas');
const ROOT=path.resolve(__dirname,'../..');
const BUNDLE_ID='local.xiaokun.emotionball.pet';
const fail=code=>Object.assign(new Error(code),{code});
function discoverDistributionEnvironment({home=os.homedir(),arch=process.arch,electronVersion='43.4.1',buildVersion=String(Math.floor(Date.now()/1000)),io=fs,
 run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}),parse=require('plist').parse,validateCache=mas.validateMasRuntimeCache,now=Date.now()}={}){
 const applications=mas.identities(run('security',['find-identity','-v','-p','codesigning'])).filter(i=>/^(Apple Distribution|3rd Party Mac Developer Application|Mac App Distribution): /.test(i.name));
 const installers=mas.identities(run('security',['find-identity','-v','-p','basic'])).filter(i=>/^(Mac Installer Distribution|3rd Party Mac Developer Installer): /.test(i.name));
 const candidates=[];
 for(const base of [path.join(home,'Library/Developer/Xcode/UserData/Provisioning Profiles'),path.join(home,'Library/MobileDevice/Provisioning Profiles')]){
  if(!io.existsSync(base))continue;
  for(const name of io.readdirSync(base).filter(n=>n.endsWith('.provisionprofile')).sort()){
   const file=path.join(base,name);let profile;
   try{const stat=io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)continue;profile=parse(run('security',['cms','-D','-i',file]));}catch{continue;}
   const rights=profile?.Entitlements,team=rights?.['com.apple.developer.team-identifier'];
   if(typeof team!=='string'||!/^[A-Z0-9]{10}$/.test(team)||(rights['com.apple.application-identifier']||rights['application-identifier'])!==`${team}.${BUNDLE_ID}`)continue;
   for(const application of applications){
    const config={bundleId:BUNDLE_ID,teamId:team,signIdentity:application.name};
    try{mas.validateProfile(profile,config,application.fingerprint,now);}catch{continue;}
    for(const installer of installers){
     try{
      const publicPem=run('security',['find-certificate','-a','-c',installer.name,'-p']);
      const certificate=mas.installerCertificate(publicPem,installer.fingerprint);
      mas.validateCertificate(certificate,installer.name,team,'installer');
     }catch{continue;}
     candidates.push({profile:file,team,application:application.name,installer:installer.name,expires:profile.ExpirationDate.getTime()});
    }
   }
  }
 }
 // Copies or renewed profiles for the same identities are equivalent; use the
 // newest expiry. Different valid teams/identities require an explicit choice.
 const unique=new Map();
 for(const candidate of candidates){const key=JSON.stringify([candidate.team,candidate.application,candidate.installer]);if(!unique.has(key)||unique.get(key).expires<candidate.expires)unique.set(key,candidate);}
 if(unique.size!==1)throw fail(unique.size?'MAS_FIRST_DISTRIBUTION_PROFILE_AMBIGUOUS':'MAS_FIRST_DISTRIBUTION_PROFILE_UNAVAILABLE');
 const chosen=[...unique.values()][0],cache=path.join(home,'Library/Caches/electron'),archive=`electron-v${electronVersion}-mas-${arch}.zip`;
 const directories=[cache,...(io.existsSync(cache)?io.readdirSync(cache).sort().map(name=>path.join(cache,name)).filter(dir=>{try{const s=io.lstatSync(dir);return s.isDirectory()&&!s.isSymbolicLink();}catch{return false;}}):[])];
 let zipDir,cacheError;
 for(const dir of directories){
  if(!io.existsSync(path.join(dir,archive)))continue;
  try{validateCache({electronVersion,arch,runtimeZipDir:dir},io);zipDir=dir;break;}catch(error){cacheError=error;}
 }
 if(!zipDir)throw cacheError||fail('MAS_FIRST_CACHED_RUNTIME_UNAVAILABLE');
 return{MAS_BUNDLE_ID:BUNDLE_ID,MAS_TEAM_ID:chosen.team,MAS_PROFILE:chosen.profile,MAS_SIGN_IDENTITY:chosen.application,MAS_INSTALLER_IDENTITY:chosen.installer,MAS_BUILD_VERSION:buildVersion,MAS_ELECTRON_ZIP_DIR:zipDir,MAS_ARCH:arch};
}
async function runFirstDistribution(argv,{root=ROOT,io=fs,discover=discoverDistributionEnvironment,build=mas.buildMas}={}){
 if(argv.some(x=>!['--plan','--build'].includes(x))||argv.length>1)throw fail('MAS_FIRST_ARGUMENT_INVALID');
 const pkg=JSON.parse(io.readFileSync(path.join(root,'package.json'),'utf8'));
 if(pkg.qiuqiuReleaseProfile!=='mas-first')throw fail('MAS_FIRST_PROFILE_REQUIRED');
 const env=discover({electronVersion:pkg.devDependencies?.electron});
 if(argv[0]==='--build')return build({root,env});
 return{...mas.planFor(pkg,env),publicDistributionConfigurationDiscovered:true,publicProfileAndCertificatesValidated:true,pinnedRuntimeCacheValidated:true,
  note:'Read-only discovery of existing public distribution certificates and exact Qiuqiu profile plus pinned MAS cache. No signing, account login, upload, submission, or ownership attestation.'};
}
function formatBuildFailure(error,fallback='MAS_FIRST_DISTRIBUTION_FAILED'){
 const value=error&&typeof error==='object'?error:{};
 const originalCode=typeof value.code==='string'?value.code.slice(0,100):typeof value.code==='number'&&Number.isFinite(value.code)?value.code:undefined;
 const code=typeof originalCode==='string'&&/^MAS_[A-Z0-9_]{1,96}$/.test(originalCode)?originalCode:fallback;
 const text=input=>Buffer.isBuffer(input)?input.subarray(Math.max(0,input.length-16384)).toString('utf8'):typeof input==='string'?input:'';
 const concise=input=>text(input)
  .split(/\r?\n/).filter(line=>!/^\s*(?:Command failed(?::| with)|(?:\/[^\s]+\/)?(?:codesign|productbuild|security|xcrun)\s)/.test(line)).join('\n')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+/gi,'$1 [REDACTED]')
  .replace(/\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1=[REDACTED]')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(-2000);
 const reason=concise(value.stderr)||concise(value.message)||concise(typeof error==='string'?error:'');
 const details={code,...(originalCode!==undefined?{originalCode}:{}),
  ...(typeof value.status==='number'&&Number.isFinite(value.status)?{status:value.status}:{}),
  ...(typeof value.signal==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(value.signal)?{signal:value.signal}:{}),
  ...(reason?{reason}:{} )};
 return JSON.stringify(details)+'\n';
}

if(require.main===module)runFirstDistribution(process.argv.slice(2)).then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(formatBuildFailure(error));process.exitCode=2;});
module.exports={BUNDLE_ID,discoverDistributionEnvironment,runFirstDistribution,formatBuildFailure};
