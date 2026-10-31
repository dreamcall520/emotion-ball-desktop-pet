'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {resolveBundledWorkBuddy,startBundledWorkBuddy,buildWorkBuddyArgs}=require('../lib/mas-bundled-workbuddy');
async function fixture(t){
 const root=await fs.promises.mkdtemp(path.join(await fs.promises.realpath(os.tmpdir()),'qiuqiu-wb-bundle-test-'));
 t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));const resourcesPath=path.join(root,'Resources'),dir=path.join(resourcesPath,'qiuqiu-workbuddy'),entry='node_modules/@tencent-ai/codebuddy-code/bin/codebuddy',license='node_modules/@tencent-ai/codebuddy-code/LICENSE.txt';
 const files={};for(const [name,text]of [[entry,'// not executed'],[license,'MIT license']]){await fs.promises.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.promises.writeFile(path.join(dir,name),text);files[name]=createHash('sha256').update(text).digest('hex');}
 await fs.promises.writeFile(path.join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,provider:'workbuddy-cli',version:'2.179.0',license:'MIT',entry,files}));
 return {root,resourcesPath,dir,entry,profileHome:path.join(root,'profile'),workspaceDir:path.join(root,'profile/workspace')};
}
test('只运行随包JS入口、校验完整摘要，不从外部App或PATH找CLI',async t=>{
 const f=await fixture(t);const result=await resolveBundledWorkBuddy(f);assert.equal(result.entry,path.join(f.dir,f.entry));
 await fs.promises.appendFile(result.entry,'modified');await assert.rejects(resolveBundledWorkBuddy(f),{code:'BUNDLED_RUNTIME_INVALID'});
});
test('受管理Electron Node仅loopback且禁工具/hook，独立profile，不生成配对文件或vendor已登录假结论',async t=>{
 const f=await fixture(t);let launched,child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};
 const service=await startBundledWorkBuddy({...f,reservePort:async()=>48711,env:{HOME:'/original-home',CODEBUDDY_CONFIG_DIR:'/original',OPENAI_API_KEY:'SECRET',NODE_OPTIONS:'unsafe',PATH:'/usr/bin'},
  forkProcess:(...args)=>{launched=args;return child;},request:async(url,options)=>{assert.equal(url,'http://127.0.0.1:48711/api/v1/auth/status');assert.equal(options.redirect,'error');assert.ok(options.headers.Authorization.startsWith('Bearer '));return Response.json({authEnabled:true,authenticated:true});}});
 assert.equal(launched[0],path.join(f.dir,f.entry));assert.deepEqual(launched[1],buildWorkBuddyArgs(48711));
 const env=launched[2].env;assert.equal(env.HOME,f.profileHome);assert.equal(env.CODEBUDDY_CONFIG_DIR,path.join(f.profileHome,'profile'));assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.BROWSER.endsWith('qiuqiu-browser-disabled'),true);
 assert.equal(service.gatewayAuthenticated,true);assert.equal(service.vendorAccountVerified,false);assert.ok(!('pairingPath'in service));
 assert.equal((await fs.promises.stat(f.profileHome)).mode&0o777,0o700);await service.stop();await service.stop();
});
test('软链profile被拒绝，不读取/写入原工具目录',async t=>{
 const f=await fixture(t),target=path.join(f.root,'outside');await fs.promises.mkdir(target);await fs.promises.symlink(target,f.profileHome);
 await assert.rejects(startBundledWorkBuddy({...f,forkProcess:()=>assert.fail('spawned')}),{code:'UNSAFE_CONFIG'});assert.deepEqual(await fs.promises.readdir(target),[]);
});
