'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { resolveBundledCodex, createBundledCodexChatRpc, VERSION } = require('../lib/mas-bundled-codex');
async function fixture(t) {
  const temporary = await fs.promises.mkdtemp(path.join(await fs.promises.realpath(os.tmpdir()), 'qiuqiu-bundle-test-'));
  t.after(()=>fs.promises.rm(temporary,{recursive:true,force:true}));
  const resourcesPath=path.join(temporary,'Resources'), directory=path.join(resourcesPath,'qiuqiu-codex/darwin-arm64');
  await fs.promises.mkdir(directory,{recursive:true});
  const binaryPath=path.join(directory,'codex'), content='test-code-not-executed';
  await fs.promises.writeFile(binaryPath,content,{mode:0o755});
  const manifest={schemaVersion:1,provider:'codex',version:VERSION,platform:'darwin',arch:'arm64',license:'Apache-2.0',binary:'codex',binarySha256:createHash('sha256').update(content).digest('hex')};
  await fs.promises.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));
  for(const file of ['LICENSE','NOTICE'])await fs.promises.writeFile(path.join(directory,file),'required license');
  return {temporary,resourcesPath,directory,binaryPath,manifest,platform:'darwin',arch:'arm64'};
}
test('只解析随包固定helper、版本、摘要和许可证，无外部App/PATH或服务发现',async t=>{
 const f=await fixture(t); assert.deepEqual(await resolveBundledCodex(f),{binaryPath:f.binaryPath,version:VERSION,transport:'stdio',bundled:true});
});
test('缺失包内runtime明确受阻，不尝试外部工具',async t=>{
 const f=await fixture(t); await fs.promises.unlink(f.binaryPath);
 await assert.rejects(resolveBundledCodex(f),{code:'BUNDLED_RUNTIME_MISSING'});
 await assert.rejects(resolveBundledCodex({...f,arch:'mips'}),{code:'BUNDLED_RUNTIME_UNSUPPORTED'});
});
test('篡改、软链、错误架构或缺许可证都不能启动',async t=>{
 for(const kind of ['tamper','symlink','manifest','license']){
  const f=await fixture(t);
  if(kind==='tamper')await fs.promises.appendFile(f.binaryPath,'modified');
  if(kind==='symlink'){await fs.promises.rename(f.binaryPath,f.binaryPath+'.elsewhere');await fs.promises.symlink(f.binaryPath+'.elsewhere',f.binaryPath);}
  if(kind==='manifest')await fs.promises.writeFile(path.join(f.directory,'manifest.json'),JSON.stringify({...f.manifest,arch:'x64'}));
  if(kind==='license')await fs.promises.unlink(path.join(f.directory,'NOTICE'));
  await assert.rejects(resolveBundledCodex(f),{code:kind==='license'?'BUNDLED_RUNTIME_MISSING':'BUNDLED_RUNTIME_INVALID'});
 }
});
test('自有profile隔离原账号/模型环境，仅使用stdio包内binary，不复制原登录或配置',async t=>{
 const f=await fixture(t),profileHome=path.join(f.temporary,'app-profile'),workspaceDir=path.join(profileHome,'workspace');
 let options;const rpc={start(){}};
 assert.equal(await createBundledCodexChatRpc({...f,profileHome,workspaceDir,env:{HOME:'/real-home',CODEX_HOME:'/real-home/.codex',OPENAI_API_KEY:'SECRET',ANTHROPIC_API_KEY:'SECRET',NODE_OPTIONS:'evil',PATH:'/usr/bin',HTTPS_PROXY:'http://127.0.0.1:10808'},createRpc:o=>{options=o;return rpc;}}),rpc);
 assert.equal(options.binaryPath,f.binaryPath);assert.equal(options.webSocket,null);assert.equal(options.homedir(),profileHome);
 assert.deepEqual(options.env,{HOME:profileHome,CODEX_HOME:path.join(profileHome,'.codex'),PATH:'/usr/bin',HTTPS_PROXY:'http://127.0.0.1:10808'});
 assert.deepEqual(await fs.promises.readdir(path.join(profileHome,'.codex')),[]);
 assert.equal((await fs.promises.stat(profileHome)).mode&0o777,0o700);
});
test('拒绝profile和workspace软链，不向链接目标写入',async t=>{
 const f=await fixture(t),outside=path.join(f.temporary,'outside'),profileHome=path.join(f.temporary,'profile');
 await fs.promises.mkdir(outside);await fs.promises.symlink(outside,profileHome);
 await assert.rejects(createBundledCodexChatRpc({...f,profileHome,workspaceDir:path.join(f.temporary,'workspace')}),{code:'UNSAFE_CONFIG'});
 assert.deepEqual(await fs.promises.readdir(outside),[]);
});
