const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--bar-visual-child')){
 const {app,BrowserWindow,ipcMain,session}=require('electron');app.setPath('userData',process.env.PET_BAR_VISUAL_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  const root=process.env.PET_QUOTA_GROUP_SOURCE_ROOT||path.resolve(__dirname,'../..');
  win=new BrowserWindow({width:48,height:20,show:false,frame:false,transparent:true,webPreferences:{preload:path.join(root,'desktop-pet/quota-card-group-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await win.loadFile(path.join(root,'desktop-pet/quota-card-group.html'));const run=code=>win.webContents.executeJavaScript(code);
  win.webContents.send('pet:quota-card-group-state',{expanded:false,count:4});await run('new Promise(r=>setTimeout(r,25))');
  const model=await run(`(()=>{const b=document.getElementById('toggle'),c=document.querySelector('.capsule'),r=c.getBoundingClientRect();return {hit:[b.offsetWidth,b.offsetHeight],capsule:[r.width,r.height,r.x,r.y],text:b.textContent,label:b.getAttribute('aria-label'),expanded:b.getAttribute('aria-expanded'),hidden:c.getAttribute('aria-hidden'),background:getComputedStyle(b).backgroundColor,transition:getComputedStyle(c).transitionDuration};})()`);
  assert.deepEqual(model.hit,[48,20]);assert.deepEqual(model.capsule,[26,7,11,6.5]);assert.equal(model.text,'');assert.equal(model.hidden,'true');assert.match(model.label,/展开 4 个额度卡/);assert.equal(model.background,'rgba(0, 0, 0, 0)');assert.match(model.transition,/0.18s/);
  const events=[];ipcMain.on('pet:quota-card-group-action',(event,value)=>{if(event.sender===win.webContents)events.push(value);});
  await run("document.getElementById('toggle').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.getElementById('toggle').focus()");await run('new Promise(r=>setTimeout(r,200))');
  assert.equal(await run("(()=>{const e=new PointerEvent('pointerdown',{cancelable:true});document.getElementById('toggle').dispatchEvent(e);return e.defaultPrevented})()"),true,'pointer activation cannot draw a focus outline');assert.deepEqual(events,['activate','dismiss']);assert.equal(await run("document.activeElement.id"),'toggle');
  win.webContents.send('pet:quota-card-group-state',{expanded:true,count:3});await run('new Promise(r=>setTimeout(r,25))');assert.equal(await run("document.getElementById('toggle').getAttribute('aria-expanded')"),'true');assert.match(await run("document.getElementById('toggle').getAttribute('aria-label')"),/收起 3/);assert.equal(await run("getComputedStyle(document.querySelector('.capsule')).visibility"),'hidden');win.webContents.send('pet:quota-card-group-state',{expanded:false,count:3});await run('new Promise(r=>setTimeout(r,25))');
  assert.equal(await run("getComputedStyle(document.querySelector('.capsule')).outlineStyle"),'none','collapsed capsule has no selected border even after keyboard focus');
  const out=process.env.PET_BAR_VISUAL_ARTIFACT_DIR||'/tmp/qiuqiu-bar-visual';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'capsule-focus.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
  assert.equal(win.isVisible(),false);console.log('PASS capsule 26x7 / hit 48x20 / labels / action / focus / hidden native');win.destroy();app.exit(0);
 }catch(error){console.error(error);win?.destroy();app.exit(1);}});
}else test('collection capsule keeps a small centered visual and accessible native hit area',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-bar-visual-'));try{const env={...process.env,PET_BAR_VISUAL_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--bar-visual-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}
});
