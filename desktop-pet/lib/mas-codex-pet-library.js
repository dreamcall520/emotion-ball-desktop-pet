'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const fail = code => Object.assign(new Error(code), {code});
function supportsMasCodexPetLibrary({app,mas=false}={}) {
  return mas===true && typeof app?.startAccessingSecurityScopedResource==='function';
}

// A separate, purpose-specific bookmark grants only the selected pet library.
// We never inspect the enclosing Codex directory or retain a native scope.
function createMasCodexPetLibrary({app,dialog,store,stateFile}={}) {
  if(!app || typeof app.startAccessingSecurityScopedResource!=='function' || !dialog || typeof dialog.showOpenDialog!=='function' || !store || typeof store.importDirectory!=='function' || !path.isAbsolute(stateFile||''))throw TypeError('Pet library dependencies required');
  let flight=null;
  function load(){
    let fd;
    try{
      fd=fs.openSync(stateFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const st=fs.fstatSync(fd);if(!st.isFile()||st.size>256*1024)throw fail('PET_LIBRARY_GRANT_INVALID');
      const grant=JSON.parse(fs.readFileSync(fd,'utf8'));
      if(grant.version!==1||!path.isAbsolute(grant.directory||'')||path.basename(grant.directory)!=='pets'||typeof grant.bookmark!=='string'||!grant.bookmark)throw fail('PET_LIBRARY_GRANT_INVALID');
      return grant;
    }catch(e){if(e.code==='ENOENT')return null;throw fail('PET_LIBRARY_GRANT_INVALID');}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function save(grant){
    fs.mkdirSync(path.dirname(stateFile),{recursive:true,mode:0o700});
    const temporary=stateFile+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,JSON.stringify(grant),{flag:'wx',mode:0o600});fs.renameSync(temporary,stateFile);}
    finally{fs.rmSync(temporary,{force:true});}
  }
  async function synchronize(grant,isCurrent){
    let release;
    try{
      release=app.startAccessingSecurityScopedResource(grant.bookmark);
      if(typeof release!=='function')throw fail('PET_LIBRARY_ACCESS_REQUIRED');
      const root=fs.lstatSync(grant.directory);
      if(!root.isDirectory()||root.isSymbolicLink())throw fail('PET_LIBRARY_ACCESS_REQUIRED');
      const entries=fs.readdirSync(grant.directory,{withFileTypes:true});
      if(entries.length>1000)throw fail('PET_LIBRARY_TOO_LARGE');
      let imported=0,skipped=0;
      for(const entry of entries){
        if(!isCurrent())throw fail('PET_LIBRARY_CANCELLED');
        // Only ordinary direct child folders are candidates; importDirectory
        // validates pet.json and declared PNG/WebP resources, rejecting links.
        if(!entry.isDirectory()||entry.isSymbolicLink()){if(entry.isSymbolicLink())skipped++;continue;}
        try{await store.importDirectory(path.join(grant.directory,entry.name));imported++;}
        catch(_){skipped++;}
      }
      return{status:'connected',imported,skipped};
    }finally{if(typeof release==='function')release();}
  }
  async function perform({interactive=false,isCurrent=()=>true}={}){
    if(!isCurrent())return{status:'cancelled'};
    let grant;
    try{grant=load();}catch(_){if(!interactive)return{status:'needs-authorization'};}
    if(!interactive){
      if(!grant)return{status:'needs-authorization'};
      try{return await synchronize(grant,isCurrent);}catch(e){return{status:e.code==='PET_LIBRARY_CANCELLED'?'cancelled':'needs-authorization'};}
    }
    // Opening the explicit connect button always permits choosing/replacing a
    // library. Normal Refresh reuses the saved grant without a system picker.
    const selected=await dialog.showOpenDialog({title:'连接 Codex 宠物目录',buttonLabel:'允许读取宠物素材',defaultPath:path.join(app.getPath('home'),'.codex','pets'),message:'只读取所选 pets 目录中的宠物素材，并复制到球球。不会读取聊天记录或登录凭据，也不会修改原目录。',properties:['openDirectory','showHiddenFiles'],securityScopedBookmarks:true});
    if(selected?.canceled||!isCurrent())return{status:'cancelled'};
    if(selected?.filePaths?.length!==1||selected?.bookmarks?.length!==1||typeof selected.bookmarks[0]!=='string'||!selected.bookmarks[0]||!path.isAbsolute(selected.filePaths[0]||'')||path.basename(selected.filePaths[0])!=='pets')return{status:'invalid-directory'};
    const next={version:1,directory:selected.filePaths[0],bookmark:selected.bookmarks[0]};
    const result=await synchronize(next,isCurrent);
    if(!isCurrent())return{status:'cancelled'};
    save(next);
    return result;
  }
  function sync(options){
    if(flight)return flight;
    flight=Promise.resolve().then(()=>perform(options)).finally(()=>{flight=null;});
    return flight;
  }
  return{sync};
}
module.exports={createMasCodexPetLibrary,supportsMasCodexPetLibrary};
