'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHash}=require('node:crypto');
const {BUNDLE_ID,discoverDistributionEnvironment:discover,runFirstDistribution}=require('../scripts/package-mas-first-distribution');
// Public synthetic certificates only; no private keys.
const fixtures={"application": "MIICNDCCAdmgAwIBAgIUe/xT7KtwZikQH0JJSVDtrgD5W/UwCgYIKoZIzj0EAwIwbzE6MDgGA1UEAwwxQXBwbGUgRGlzdHJpYnV0aW9uOiBTeW50aGV0aWMgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKQUJDREVGMTIzNDEcMBoGA1UECgwTU3ludGhldGljIFRlc3QgT25seTAeFw0yNjExMDEwMDQ3NDNaFw0zNjEwMjkwMDQ3NDNaMG8xOjA4BgNVBAMMMUFwcGxlIERpc3RyaWJ1dGlvbjogU3ludGhldGljIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMCkFCQ0RFRjEyMzQxHDAaBgNVBAoME1N5bnRoZXRpYyBUZXN0IE9ubHkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQG3nrvgYSNOipVtqhwNYuyEoqJR0ctIk1YMy62wGv1p/f43Ew+k+BsSuvQojwHlZY5elSxAn1KwsDsdurGIA4Do1MwUTAdBgNVHQ4EFgQUCvB7qipLJbH3SGhhBAAhR6YZ0eowHwYDVR0jBBgwFoAUCvB7qipLJbH3SGhhBAAhR6YZ0eowDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAxRw8YoFBSfwGg8gcl0PxpxRPPkJDEUKR9KwH/nilzSYCIQC9/dfWMvhb4weO8aOHTuivHbjHDmtjoz9xcHipeBlG2g==", "installer": "MIICQzCCAemgAwIBAgIUc/COihdyvXHn3S9IZr1iwCWlotwwCgYIKoZIzj0EAwIwdzFCMEAGA1UEAww5TWFjIEluc3RhbGxlciBEaXN0cmlidXRpb246IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MB4XDTI2MTEwMTAwNDc0M1oXDTM2MTAyOTAwNDc0M1owdzFCMEAGA1UEAww5TWFjIEluc3RhbGxlciBEaXN0cmlidXRpb246IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUhsfdChXMmQrAXXsC/GwOF804k7qvcMlMO/jPudzZH0oxF8yzRKJ4IhpinlE9F0pN3tYnywmipeuxiQLQw1zyaNTMFEwHQYDVR0OBBYEFO4+IIJf6WaqiIZSKWD6OZVJRIcvMB8GA1UdIwQYMBaAFO4+IIJf6WaqiIZSKWD6OZVJRIcvMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgGuC5cjnnRW69nHar02m5R6RW2aEbjcOerfihJT7kU9wCIQCI1pue92pUaElxFFWoomYggzf2/vKLyWsWvp42uaAEJA==", "wrongTeam": "MIICMzCCAdmgAwIBAgIUfBa4k6jeqVlBZxFU2R92xfntA0cwCgYIKoZIzj0EAwIwbzE6MDgGA1UEAwwxQXBwbGUgRGlzdHJpYnV0aW9uOiBTeW50aGV0aWMgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKWlpaWlpaOTk5OTEcMBoGA1UECgwTU3ludGhldGljIFRlc3QgT25seTAeFw0yNjExMDEwMDQ3NDNaFw0zNjEwMjkwMDQ3NDNaMG8xOjA4BgNVBAMMMUFwcGxlIERpc3RyaWJ1dGlvbjogU3ludGhldGljIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMClpaWlpaWjk5OTkxHDAaBgNVBAoME1N5bnRoZXRpYyBUZXN0IE9ubHkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQxfiuGfVE0gA6KtA9fQfw53z7VQAnRD4Vw326LjcHAS4fvOIjCupK7PaEIerDLkFsMmoVtUlUPKsqU1Ah0oyDho1MwUTAdBgNVHQ4EFgQUhqvTVyUCO03K/YwsS8Ngu4jwzqUwHwYDVR0jBBgwFoAUhqvTVyUCO03K/YwsS8Ngu4jwzqUwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBv3iySLmIoipZEtmUmBqBXiqzZAZeGSWl5Wg8FsKB2vAIhAJzryg8Giir5VIpgfJcEw07X0G4L7auP6/ImQTZ0jVrN", "development": "MIICMTCCAdegAwIBAgIUL9KMlU6de645mWZxD2C2JUBqjTUwCgYIKoZIzj0EAwIwbjE5MDcGA1UEAwwwQXBwbGUgRGV2ZWxvcG1lbnQ6IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MB4XDTI2MTEwMTAwNDc0M1oXDTM2MTAyOTAwNDc0M1owbjE5MDcGA1UEAwwwQXBwbGUgRGV2ZWxvcG1lbnQ6IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMl0koXGsx6FpbaQB+nO6J8idQNkYWfs9bFgWRWUYvGWwmRqubJy472hQAh5yj2oOQ03+/jV2moASADqW7/qiMKNTMFEwHQYDVR0OBBYEFM4KqaMeZ+Nm7I0ZrLZu/q5iQ0RNMB8GA1UdIwQYMBaAFM4KqaMeZ+Nm7I0ZrLZu/q5iQ0RNMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAMKRkwYG6RNpIvF5SGw/pytgGN0dpXTX+7jDpn0Io/JuAiAQR/YEKUKCNR/Hovt4E19Xxvw3oGl5BxaFBsvHWWEwoQ=="};
const cert=Buffer.from(fixtures.application,'base64'),installerCert=Buffer.from(fixtures.installer,'base64');
const fp=data=>createHash('sha1').update(data).digest('hex').toUpperCase();
const appName='Apple Distribution: Synthetic Person (PERSON9999)',installerName='Mac Installer Distribution: Synthetic Person (PERSON9999)';
const pkg={version:'0.4.10',qiuqiuReleaseProfile:'mas-first',devDependencies:{electron:'43.4.1'}};
const base='/fixture/Library/Developer/Xcode/UserData/Provisioning Profiles',cache='/fixture/Library/Caches/electron',zip='electron-v43.4.1-mas-arm64.zip';
const profile=()=>({ExpirationDate:new Date('2030-01-01'),Platform:['OSX'],TeamIdentifier:['ABCDEF1234'],Entitlements:{'com.apple.developer.team-identifier':'ABCDEF1234','com.apple.application-identifier':'ABCDEF1234.'+BUNDLE_ID,'com.apple.security.application-groups':['ABCDEF1234.'+BUNDLE_ID]},DeveloperCertificates:[cert]});
function fixture(){
 const profiles=new Map([['store.provisionprofile',profile()]]),events=[];
 const files=new Set([path.join(cache,'cache-a',zip)]),dirs=new Set([base,cache,path.join(cache,'cache-a')]);
 const symlinks=new Set();
 const io={existsSync:f=>dirs.has(f)||files.has(f)||f.startsWith(base+'/')&&profiles.has(path.basename(f)),readdirSync:f=>f===base?[...profiles.keys()]:f===cache?['cache-a']:[],lstatSync:f=>({isFile:()=>!dirs.has(f),isDirectory:()=>dirs.has(f),isSymbolicLink:()=>symlinks.has(f),size:100})};
 const opts={home:'/fixture',arch:'arm64',buildVersion:'25',now:Date.parse('2026-11-01'),io,parse:name=>profiles.get(name),validateCache:config=>{events.push(['cache',config]);return{validated:true};},run(cmd,args){events.push([cmd,args]);if(args[0]==='find-identity')return args.at(-1)==='codesigning'?` 1) ${fp(cert)} "${appName}"`:` 1) ${fp(installerCert)} "${installerName}"`;if(args[0]==='cms')return path.basename(args.at(-1));if(args[0]==='find-certificate')return '-----BEGIN CERTIFICATE-----\n'+fixtures.installer+'\n-----END CERTIFICATE-----';throw Error('Unexpected command');}};
 return{profiles,events,files,dirs,symlinks,opts};
}
test('发现精确球球正式bundle且证书由profile公钥匹配；只返回内部构建env',()=>{
 const f=fixture(),env=discover(f.opts);assert.equal(env.MAS_BUNDLE_ID,BUNDLE_ID);assert.equal(env.MAS_TEAM_ID,'ABCDEF1234');assert.equal(env.MAS_SIGN_IDENTITY,appName);assert.equal(env.MAS_INSTALLER_IDENTITY,installerName);assert.equal(env.MAS_BUILD_VERSION,'25');assert.equal(env.MAS_ELECTRON_ZIP_DIR,path.join(cache,'cache-a'));assert.ok(f.events.every(([cmd])=>['security','cache'].includes(cmd)));
});
test('拒绝其他bundle、开发profile、过期profile与符号链接文件',()=>{
 for(const mutate of [f=>f.profiles.get('store.provisionprofile').Entitlements['com.apple.application-identifier']='ABCDEF1234.com.other.app',f=>f.profiles.get('store.provisionprofile').ProvisionedDevices=['a-device'],f=>f.profiles.get('store.provisionprofile').ExpirationDate=new Date('2000-01-01'),f=>f.symlinks.add(path.join(base,'store.provisionprofile'))]){const f=fixture();mutate(f);assert.throws(()=>discover(f.opts),{code:'MAS_FIRST_DISTRIBUTION_PROFILE_UNAVAILABLE'});}
});
test('不能以相似名字或其他团队证书代替profile精确公钥；缺installer也不降级',()=>{
 const f=fixture();f.profiles.get('store.provisionprofile').DeveloperCertificates=[Buffer.from(fixtures.wrongTeam,'base64')];assert.throws(()=>discover(f.opts),{code:'MAS_FIRST_DISTRIBUTION_PROFILE_UNAVAILABLE'});
 const g=fixture(),run=g.opts.run;g.opts.run=(cmd,args)=>args[0]==='find-identity'&&args.at(-1)==='basic'?'':run(cmd,args);assert.throws(()=>discover(g.opts),{code:'MAS_FIRST_DISTRIBUTION_PROFILE_UNAVAILABLE'});
 const h=fixture(),runH=h.opts.run;h.opts.run=(cmd,args)=>args[0]==='find-certificate'?'-----BEGIN CERTIFICATE-----\n'+fixtures.wrongTeam+'\n-----END CERTIFICATE-----':runH(cmd,args);assert.throws(()=>discover(h.opts),{code:'MAS_FIRST_DISTRIBUTION_PROFILE_UNAVAILABLE'});
});
test('重复profile按同一团队和签名身份去重，选较新到期版本',()=>{
 const f=fixture();const newer=profile();newer.ExpirationDate=new Date('2031-01-01');f.profiles.set('newer.provisionprofile',newer);assert.equal(discover(f.opts).MAS_PROFILE,path.join(base,'newer.provisionprofile'));
});
test('发现缓存仍调用固定SHA验证，错误不得默许；仅Darwin缓存不算MAS缓存',()=>{
 const f=fixture();f.opts.validateCache=()=>{throw Object.assign(Error(),{code:'MAS_RUNTIME_CACHE_SHA256_MISMATCH'});};assert.throws(()=>discover(f.opts),{code:'MAS_RUNTIME_CACHE_SHA256_MISMATCH'});
 const g=fixture();g.files.clear();g.files.add(path.join(cache,'cache-a','electron-v43.4.1-darwin-arm64.zip'));assert.throws(()=>discover(g.opts),{code:'MAS_FIRST_CACHED_RUNTIME_UNAVAILABLE'});
});
test('默认与显式plan仅发现和输出脱敏计划，不构建或提供权属保证',async()=>{
 const f=fixture(),env=discover(f.opts);let builds=0;const deps={root:'/root',io:{readFileSync:()=>JSON.stringify(pkg)},discover:()=>env,build:async()=>{builds++;}};
 for(const argv of [[],['--plan']]){const value=await runFirstDistribution(argv,deps);assert.equal(value.configurationReady,true);assert.equal(value.submissionReady,false);assert.equal(value.profileValidated,false);assert.equal(value.publicProfileAndCertificatesValidated,true);assert.equal(value.pinnedRuntimeCacheValidated,true);assert.ok(!JSON.stringify(value).includes(appName));assert.ok(!JSON.stringify(value).includes('/fixture'));}
 assert.equal(builds,0);
});
test('只有显式build调用既有严格MAS分发流水线；无upload等旁路',async()=>{
 const f=fixture(),env=discover(f.opts);let calls=0;const deps={root:'/root',io:{readFileSync:()=>JSON.stringify(pkg)},discover:()=>env,build:async args=>{calls++;assert.deepEqual(args,{root:'/root',env});return{signedDistributionPackage:true,submissionReady:false};}};
 assert.equal((await runFirstDistribution(['--build'],deps)).signedDistributionPackage,true);assert.equal(calls,1);
 for(const argv of [['--upload'],['--build','--plan'],['--plan','--plan']])await assert.rejects(runFirstDistribution(argv,deps),{code:'MAS_FIRST_ARGUMENT_INVALID'});assert.equal(calls,1);
 await assert.rejects(runFirstDistribution([],{...deps,io:{readFileSync:()=>JSON.stringify({...pkg,qiuqiuReleaseProfile:undefined})}}),{code:'MAS_FIRST_PROFILE_REQUIRED'});
});
