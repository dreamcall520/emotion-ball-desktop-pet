#!/usr/bin/env node
'use strict';
// Build time only. npm ci uses the reviewed dependency lock; scripts and optional
// native shell/sandbox helpers are excluded. Runtime never installs anything.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const VERSION='2.179.0';
async function prepareMasWorkBuddyHelper({outputRoot=path.resolve(__dirname,'../build/qiuqiu-workbuddy'),npm=process.platform==='win32'?'npm.cmd':'npm'}={}){
 const source=path.resolve(__dirname,'../vendor/workbuddy-cli'),scratch=await fs.promises.mkdtemp(path.join(os.tmpdir(),'qiuqiu-workbuddy-build-'));
 try{
  for(const name of ['package.json','package-lock.json'])await fs.promises.copyFile(path.join(source,name),path.join(scratch,name));
  execFileSync(npm,['ci','--ignore-scripts','--omit=optional','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:scratch,stdio:'pipe',timeout:180000});
  const packageRoot=path.join(scratch,'node_modules/@tencent-ai/codebuddy-code');
  const pkg=JSON.parse(await fs.promises.readFile(path.join(packageRoot,'package.json'),'utf8'));
  const license=await fs.promises.readFile(path.join(packageRoot,'LICENSE.txt'),'utf8');
  if(pkg.name!=='@tencent-ai/codebuddy-code'||pkg.version!==VERSION||!license.includes('Copyright 2023 Tencent Cloud')||!license.includes('Permission is hereby granted, free of charge'))throw Error('LICENSE_OR_VERSION_MISMATCH');
  await fs.promises.rm(path.join(scratch,'node_modules/.bin'),{recursive:true,force:true});
  await fs.promises.mkdir(outputRoot,{recursive:true});
  await fs.promises.rm(path.join(outputRoot,'node_modules'),{recursive:true,force:true});
  await fs.promises.cp(path.join(scratch,'node_modules'),path.join(outputRoot,'node_modules'),{recursive:true,force:true});
  const bundledPackage=path.join(outputRoot,'node_modules/@tencent-ai/codebuddy-code');
  // This is a text-only connection. Do not ship unused shell/PTY/search native
  // helpers, web documentation, TypeScript source maps or declaration trees.
  for(const relative of ['dist/web-ui/docs','dist-server/types','vendor/genie-trash','vendor/ripgrep','vendor/sandbox-center-runtime-kit'])
    await fs.promises.rm(path.join(bundledPackage,relative),{recursive:true,force:true});
  for(const relative of ['openai/src','zod/src'])await fs.promises.rm(path.join(outputRoot,'node_modules',relative),{recursive:true,force:true});
  async function removeTypes(dir){for(const item of await fs.promises.readdir(dir,{withFileTypes:true})){
   const filename=path.join(dir,item.name);
   if(item.isDirectory())await removeTypes(filename);
   else if(/\.(?:d\.(?:ts|mts|cts)|map)$/.test(item.name))await fs.promises.unlink(filename);
  }}
  await removeTypes(path.join(outputRoot,'node_modules'));
  for(const name of ['package.json','package-lock.json'])await fs.promises.copyFile(path.join(source,name),path.join(outputRoot,name));
  const files={};
  async function scan(dir){for(const item of await fs.promises.readdir(dir,{withFileTypes:true})){
   const filename=path.join(dir,item.name),relative=path.relative(outputRoot,filename).split(path.sep).join('/');
   if(item.isSymbolicLink())throw Error('UNSAFE_PACKAGE_SYMLINK');
   if(item.isDirectory())await scan(filename);
   else if(item.isFile()){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(filename))hash.update(chunk);files[relative]=hash.digest('hex');}
  }}
  await scan(path.join(outputRoot,'node_modules'));
  const manifest={schemaVersion:1,provider:'workbuddy-cli',version:VERSION,entry:'node_modules/@tencent-ai/codebuddy-code/bin/codebuddy',license:'MIT',files};
  await fs.promises.writeFile(path.join(outputRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {directory:outputRoot,version:VERSION,files:Object.keys(files).length};
 }finally{await fs.promises.rm(scratch,{recursive:true,force:true});}
}
if(require.main===module)prepareMasWorkBuddyHelper().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('WORKBUDDY_PREPARE_FAILED');process.exitCode=1;});
module.exports={prepareMasWorkBuddyHelper,VERSION};
