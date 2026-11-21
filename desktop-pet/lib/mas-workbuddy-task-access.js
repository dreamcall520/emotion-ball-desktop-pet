'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const PURPOSE='workbuddy-task-metadata-v1';
const fail=code=>Object.assign(new Error(code),{code});

// Task metadata has its own consent and bookmark; account-client grants never
// supply this authority. No source database is opened by the authorization port.
function createMasWorkBuddyTaskAccess({app,dialog,storage,mas=process.mas===true,
 home=()=>process.mas===true?os.userInfo().homedir:app.getPath('home')}={}){
 if(!app||!dialog||!storage)throw new TypeError('app, dialog and storage required');
 const supported=mas===true&&typeof app.startAccessingSecurityScopedResource==='function';
 let pending=Promise.resolve(),epoch=0,selectionEpoch=0,closed=false;
 const valid=g=>g?.purpose===PURPOSE&&typeof g.directory==='string'&&path.isAbsolute(g.directory)&&
   !g.directory.includes('\0')&&path.basename(g.directory)==='.workbuddy'&&typeof g.bookmark==='string'&&g.bookmark.length>0;
 async function lease(grant){
  if(!supported||closed||!valid(grant))throw fail('DIRECTORY_ACCESS_REQUIRED');
  const owner=epoch;let stop,released=false;
  try{stop=app.startAccessingSecurityScopedResource(grant.bookmark);}catch{throw fail('DIRECTORY_ACCESS_REQUIRED');}
  if(typeof stop!=='function')throw fail('DIRECTORY_ACCESS_REQUIRED');
  const release=()=>{if(!released){released=true;try{stop();}catch{}}};
  try{
   const stat=await fs.lstat(grant.directory);
   if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(grant.directory)!==path.resolve(grant.directory))throw fail('DIRECTORY_ACCESS_REQUIRED');
   if(owner!==epoch||closed)throw fail('CANCELLED');
  }catch(error){release();throw fail(error.code==='CANCELLED'?'CANCELLED':'DIRECTORY_ACCESS_REQUIRED');}
  return{directory:grant.directory,release,isCurrent:()=>owner===epoch&&!closed};
 }
 function ensure({interactive=false,signal}={}){
  const requested=selectionEpoch;
  const current=pending.catch(()=>{}).then(async()=>{
   const check=()=>{if(closed||signal?.aborted||requested!==selectionEpoch)throw fail('CANCELLED');};check();
   if(!supported)return{status:'unavailable'};
   const before=await storage.load('workbuddy');check();
   try{const currentLease=await lease(before);currentLease.release();check();return{status:'stored'};}catch(error){if(error.code==='CANCELLED')throw error;}
   if(!interactive)return{status:'needs-authorization'};
   const picked=await dialog.showOpenDialog({title:'授权 WorkBuddy 任务目录',buttonLabel:'允许读取任务',
    defaultPath:path.join(home(),'.workbuddy'),
    properties:['openDirectory','showHiddenFiles'],securityScopedBookmarks:true});check();
   if(picked?.canceled)return{status:'cancelled'};
   if(picked?.filePaths?.length!==1||picked?.bookmarks?.length!==1)throw fail('DIRECTORY_ACCESS_REQUIRED');
   const grant={purpose:PURPOSE,directory:picked.filePaths[0],bookmark:picked.bookmarks[0]};
   try{const verification=await lease(grant);verification.release();}catch(error){if(error.code==='CANCELLED')throw error;return{status:'invalid-directory'};}
   check();await storage.save('workbuddy',grant);
   try{check();}catch(error){if(before)await storage.save('workbuddy',before);else await storage.remove('workbuddy');throw error;}
   epoch++;return{status:'stored'};
  });
  pending=current.then(()=>{},()=>{});return current;
 }
 return{ensure,
  async acquire(provider){
   if(provider!=='workbuddy')throw fail('INVALID_PROVIDER');const owner=epoch;await pending;
   if(owner!==epoch||closed)throw fail('CANCELLED');return lease(await storage.load('workbuddy'));
  },
  revoke(){epoch++;selectionEpoch++;const current=pending.catch(()=>{}).then(async()=>{await storage.remove('workbuddy');return{status:'needs-authorization'};});pending=current.then(()=>{},()=>{});return current;},
  clearPending(){selectionEpoch++;},
  close(){closed=true;epoch++;selectionEpoch++;}
 };
}
module.exports={createMasWorkBuddyTaskAccess};
