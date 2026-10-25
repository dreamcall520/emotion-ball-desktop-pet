const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--local-pets-native-child')){
 const {app,BrowserWindow,nativeImage,session}=require('electron');app.setPath('userData',process.env.PET_LOCAL_NATIVE_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  const root=process.env.PET_LOCAL_SOURCE_ROOT||path.resolve(__dirname,'../..'),createCodexPetStore=require(path.join(root,'desktop-pet/lib/codex-pets')).createCodexPetStore;
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});await win.loadURL('data:text/html,<html><body></body></html>');
  const scope={localPetImportIsCurrent:()=>true,localPetStore:null,createCodexPetStore,path,app,nativeImage,customizationWindow:win,screenLocked:false,isQuitting:false};
  const source=fs.readFileSync(path.join(root,'desktop-pet/main.js'),'utf8');const start=source.indexOf('  localPetStore=createCodexPetStore('),end=source.indexOf('  apiUsage = createApiUsage(',start);assert(start>0&&end>start);
  Function('scope','with(scope){'+source.slice(start,end)+'}')(scope);
  const before=fs.existsSync(path.join(app.getPath('userData'),'settings.json'));
  for(const format of ['png','webp']){
   const dataURL=await win.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=1536;c.height=1872;const x=c.getContext('2d');x.fillStyle='#6a8';x.fillRect(0,0,1536,1872);return c.toDataURL('image/${format}')})()`);
   assert(dataURL.startsWith(`data:image/${format};base64,`));const folder=path.join(app.getPath('userData'),`source-${format}`);fs.mkdirSync(folder);
   fs.writeFileSync(path.join(folder,'pet.json'),JSON.stringify({displayName:format,spritesheetPath:`sprite.${format}`}));fs.writeFileSync(path.join(folder,`sprite.${format}`),Buffer.from(dataURL.split(',')[1],'base64'));fs.writeFileSync(path.join(folder,'run.js'),'throw Error("must never execute")');
   const pet=await scope.localPetStore.importDirectory(folder);assert.equal(pet.rows,9);assert.deepEqual(fs.readdirSync(path.dirname(pet.spritesheetPath)).sort(),['pet.json',`sprite.${format}`]);fs.rmSync(folder,{recursive:true});assert.equal(scope.localPetStore.getImported(pet.id).id,pet.id);
  }
  assert.equal(scope.localPetStore.listImported().pets.length,2);assert.equal(fs.existsSync(path.join(app.getPath('userData'),'codex-pets')),false);assert.equal(fs.existsSync(path.join(app.getPath('userData'),'settings.json')),before);
  const bad=path.join(app.getPath('userData'),'bad-webp');fs.mkdirSync(bad);fs.writeFileSync(path.join(bad,'pet.json'),JSON.stringify({displayName:'bad',spritesheetPath:'sprite.webp'}));
  const body=Buffer.alloc(18);body.write('WEBP');body.write('VP8L',4);body.writeUInt32LE(5,8);body[12]=0x2f;body.writeUInt32LE((1535|((1871)<<14))>>>0,13);const size=Buffer.alloc(4);size.writeUInt32LE(body.length);fs.writeFileSync(path.join(bad,'sprite.webp'),Buffer.concat([Buffer.from('RIFF'),size,body]));
  await assert.rejects(scope.localPetStore.importDirectory(bad));assert.equal(scope.localPetStore.listImported().pets.length,2);assert.equal(win.isVisible(),false);console.log('PASS local PNG/WebP real decode, safe atomic copies and corrupt compressed data rejection');win.destroy();app.exit(0);
 }catch(error){console.error(error);win?.destroy();app.exit(1);}});
}else test('local partner backend decodes real PNG/WebP in hidden Chromium before publishing independent copies',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-local-pets-'));try{const env={...process.env,PET_LOCAL_NATIVE_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--local-pets-native-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}
});
