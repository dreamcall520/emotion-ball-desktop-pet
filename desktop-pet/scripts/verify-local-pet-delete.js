// Real Electron trash integration with generated temporary artwork only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-delete-native-')),env={...process.env,PET_DELETE_FIXTURE_ROOT:data};delete env.ELECTRON_RUN_AS_NODE;
 const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'});
 child.on('exit',code=>{fs.rmSync(data,{recursive:true,force:true});process.exitCode=code??1});
}else{
 const {app,shell,session}=require('electron'),{deflateSync}=require('node:zlib');
 const root=process.env.PET_DELETE_FIXTURE_ROOT;if(!root||!path.basename(root).startsWith('qiuqiu-delete-native-'))throw Error('isolated root required');
 app.setPath('userData',path.join(root,'profile'));app.setActivationPolicy('accessory');
 const sourceRoot=path.resolve(process.env.PET_CUSTOMIZE_SOURCE_ROOT||path.join(__dirname,'../..'));
 const {createCodexPetStore}=require(path.join(sourceRoot,'desktop-pet/lib/codex-pets'));
 const out=process.env.PET_SMOKE_ARTIFACT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-delete-evidence-'));fs.mkdirSync(out,{recursive:true});
 function png(width,height){
  const chunk=(name,bytes)=>{const data=Buffer.concat([Buffer.from(name),bytes]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);
 }
 app.whenReady().then(async()=>{let error,details={sourceRoot,isolatedProfile:true,realShellTrashItem:true,realSkinTouched:false};try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  const original=path.join(root,'source'),imports=path.join(root,'imports');fs.mkdirSync(original);
  const manifest=Buffer.from(JSON.stringify({id:'delete-fixture',displayName:'临时删除验收 '+path.basename(root),spritesheetPath:'sprite.png'})),image=png(1536,1872);
  fs.writeFileSync(path.join(original,'pet.json'),manifest);fs.writeFileSync(path.join(original,'sprite.png'),image);
  const store=createCodexPetStore({namespace:'local',sourceRoot:imports,importRoot:imports});const pet=await store.importDirectory(original);
  assert.equal(store.listImported().pets.length,1);let trashTarget;
  await store.trashImported(pet.id,async target=>{trashTarget=target;await shell.trashItem(target);});
  assert(!fs.existsSync(path.join(imports,pet.id)));assert.equal(store.listImported().pets.length,0);
  assert(fs.readFileSync(path.join(original,'pet.json')).equals(manifest));assert(fs.readFileSync(path.join(original,'sprite.png')).equals(image));
  const again=await store.importDirectory(original);assert.equal(again.id,pet.id);assert.equal(store.listImported().pets.length,1);
  details={...details,trashTarget,sourcePreserved:true,deletedCopyAbsent:true,listEmptyAfterTrash:true,reimportedSameId:true,id:pet.id,temporaryFixtureMayRemainInSystemTrash:true};
 }catch(e){error=e.stack;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:!error,error,...details},null,2));console.log(JSON.stringify({passed:!error,error,out}));app.exit(error?1:0);}});
}
