"use strict";
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const PLUGINS=new Set(['qiuqiu-task-events','qiuqiu-zcode-task-events']);
const fail=()=>Object.assign(new Error('INSTALL_CONFLICT'),{code:'INSTALL_CONFLICT'});
// Electron can read virtual ASAR entries, but the original tool's /bin/sh needs
// a physical signed resource. Never extract or write a program at runtime.
function resolveBundledEventScript({assetRoot,pluginName,io=fs}={}){
 if(typeof assetRoot!=='string'||!path.isAbsolute(assetRoot)||/[\r\n\0]/.test(assetRoot)||!PLUGINS.has(pluginName))throw fail();
 const parts=path.resolve(assetRoot).split(path.sep),at=parts.lastIndexOf('app.asar');
 if(at>=0)parts[at]='app.asar.unpacked';
 const root=parts.join(path.sep),relative=path.join('plugins',pluginName,'scripts','emit-metadata.sh'),file=path.join(root,relative);
 // Check every physical component below the bundle, including unpack's parents.
 const bundleAt=at>=0?parts.slice(0,at).findLastIndex(part=>part.endsWith('.app')):-1;
 const anchor=at>=0?parts.slice(0,bundleAt>=0?bundleAt+1:at).join(path.sep):root;
 let current=anchor,fd;
 try{
  for(const part of ['',...path.relative(anchor,file).split(path.sep)]){
   if(part)current=path.join(current,part);
   const stat=io.lstatSync(current);if(stat.isSymbolicLink()||(current===file?!stat.isFile():!stat.isDirectory()))throw fail();
  }
  fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=io.fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>256*1024)throw fail();const bytes=io.readFileSync(fd);
  return{path:file,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
 }catch{throw fail();}finally{if(fd!==undefined)io.closeSync(fd);}
}
module.exports={resolveBundledEventScript};
