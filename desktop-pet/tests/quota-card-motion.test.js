const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--motion-child')){
 const {app,BrowserWindow,session}=require('electron');app.setPath('userData',process.env.PET_MOTION_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  const root=process.env.PET_QUOTA_GROUP_SOURCE_ROOT||path.resolve(__dirname,'../..');
  win=new BrowserWindow({width:196,height:144,show:false,frame:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
  win.webContents.on('console-message',(_event,_level,message)=>console.log(message));
  await win.loadURL('data:text/html,'+encodeURIComponent('<style>body{margin:0}#card{width:128px;height:32px;background:lightblue;transform-origin:center bottom}</style><div id="card"></div>'));
  const run=async code=>{try{return await win.webContents.executeJavaScript('try{'+code+'}catch(error){console.log(error.stack);throw error}')}catch(error){throw Error(code.slice(0,180)+' => '+error.message)}};
  const source=fs.readFileSync(path.join(root,'desktop-pet/quota-card-motion.js'),'utf8').replace("if(typeof window==='undefined')return;","window.createQuotaCardMotion=createQuotaCardMotion;if(typeof window==='undefined')return;");
  await run(source);await run("window.media={matches:false,addEventListener(t,f){this.change=f},removeEventListener(){}};window.motion=createQuotaCardMotion(document.getElementById('card'),media);motion.update({visible:false,animate:false});motion.update({visible:true,animate:true,index:3});");
  assert.equal(await run('document.getAnimations()[0].effect.getTiming().delay'),24);
  await run('document.getAnimations()[0].pause();document.getAnimations()[0].currentTime=75');
  const middle=await run("(()=>{const r=document.getElementById('card').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,transform:getComputedStyle(document.getElementById('card')).transform}})()");
  assert(middle.width>124&&middle.width<128);assert(middle.x>=0&&middle.y>=0&&middle.y+middle.height<=32);
  await run('motion.update({visible:false,animate:true,index:3});document.getAnimations()[0].pause();document.getAnimations()[0].currentTime=50');
  const before=await run("getComputedStyle(document.getElementById('card')).transform");
  await run('motion.update({visible:true,animate:true,index:0});document.getAnimations()[0].pause();document.getAnimations()[0].currentTime=0');
  assert.equal(await run("getComputedStyle(document.getElementById('card')).transform"),before,'reentry begins at current frame');
  assert.equal(await run('document.getAnimations().length'),1,'old exit cancelled');
  await run('media.matches=true;media.change()');assert.equal(await run('document.getAnimations().length'),0);
  await run('motion.update({visible:false,animate:false});motion.update({visible:true,animate:true,index:3})');assert.equal(await run('document.getAnimations().length'),0,'reduced motion stays immediate');
  await run('media.matches=false;motion.update({visible:false,animate:false});motion.update({visible:true,animate:true,index:0});motion.destroy()');assert.equal(await run('document.getAnimations().length'),0);
  const out=process.env.PET_MOTION_ARTIFACT_DIR||'/tmp/qiuqiu-r8-card-motion';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'mid-frame.json'),JSON.stringify(middle,null,2));
  assert.equal(win.isVisible(),false);win.destroy();console.log('PASS motion middle frame / in-frame / interruption / reduced / disposal');app.exit(0);
 }catch(error){console.error(error);win?.destroy();app.exit(1);}});
}else test('shared card WAAPI motion stays inside native geometry and cancels safely',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-motion-'));try{const env={...process.env,PET_MOTION_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--motion-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}
});

if(!process.versions.electron)test('motion host sends bounded presentation only and reduced motion bypasses native fade',()=>{
 const {sendQuotaCardMotion}=require('../lib/quota-card-motion');const messages=[],target={webContents:{send:(channel,payload)=>messages.push({channel,payload})}};
 assert.equal(sendQuotaCardMotion(target,true,{},false),false);assert.equal(messages.length,0);
 assert.equal(sendQuotaCardMotion(target,true,{quotaGroupAnimate:true,quotaGroupIndex:99},true),true);
 assert.deepEqual(messages.at(-1),{channel:'pet:quota-card-motion',payload:{visible:true,animate:true,index:3}});
 assert.equal(sendQuotaCardMotion(target,false,{quotaGroupAnimate:true,quotaReducedMotion:true},true),false);
 assert.equal(messages.at(-1).payload.animate,false);
 sendQuotaCardMotion(target,false,{},false);assert.equal(messages.at(-1).payload.animate,false,'safety hide clears active renderer motion');
});
