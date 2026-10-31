const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--transition-dom-child')){
 const {app,BrowserWindow,ipcMain,screen,nativeImage,session}=require('electron');app.setPath('userData',process.env.PET_TRANSITION_DATA);app.setActivationPolicy('accessory');app.on('window-all-closed',()=>{});
 class HiddenWindow extends BrowserWindow{showInactive(){this.logicalVisible=true;}hide(){this.logicalVisible=false;super.hide();}isVisible(){return this.logicalVisible===true;}}
 app.whenReady().then(async()=>{let controller;try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  const root=process.env.PET_QUOTA_GROUP_SOURCE_ROOT||path.resolve(__dirname,'../..'),out=process.env.PET_TRANSITION_ARTIFACT_DIR||'/tmp/qiuqiu-r10-group-overlay';fs.mkdirSync(out,{recursive:true});
  const {createQuotaCardTransitionWindow}=require(path.join(root,'desktop-pet/lib/quota-card-transition-window')),{createQuotaCardGroupTransition}=require(path.join(root,'desktop-pet/lib/quota-card-group-transition'));
  let overlay,prepared=0,contextValid=true;const settled=[];
  controller=createQuotaCardGroupTransition({createOverlay:()=>{overlay=createQuotaCardTransitionWindow({BrowserWindow:HiddenWindow,ipcMain});const prepare=overlay.prepare;overlay.prepare=async value=>{prepared++;return prepare(value)};return overlay;},screen,isContextCurrent:()=>contextValid,onSettled:value=>settled.push(value)});
  await controller.warm();const win=overlay.getWindow(),run=code=>win.webContents.executeJavaScript(code),until=async predicate=>{const deadline=Date.now()+3000;while(!await predicate()){if(Date.now()>deadline)throw Error('overlay condition timeout');await new Promise(resolve=>setTimeout(resolve,8));}};
  const ids=['codex','api','zcode','workbuddy'];let captures=0;
  const report={passed:false,nativeHostsHidden:true,cases:[]};
  for(const side of ['left','right'])for(const bottom of [false,true]){
    const x=side==='left'?0:1000,y=bottom?600:80,anchor={x:x+51,y:bottom?780:58,width:26,height:7};
    const cards=ids.map((id,index)=>{const bytes=Buffer.alloc(128*32*4);for(let p=0;p<bytes.length;p+=4){bytes[p]=40+index*40;bytes[p+1]=100;bytes[p+2]=210-index*30;bytes[p+3]=255;}const png=nativeImage.createFromBitmap(bytes,{width:128,height:32}).toPNG();return{id,controller:{modes:[],setGroupTransitionMode(mode){this.modes.push(mode)},async captureGroupTransitionFrames(){captures++;return[{bounds:{x,y:y+index*40,width:128,height:32},png}]}}}});
    const key=side+bottom,exit=controller.request({expanded:false,cards,anchor,contextKey:key});await until(()=>run('document.getAnimations().length===2'));
    const original=win.getBounds();await run('for(const a of document.getAnimations()){a.pause();a.currentTime=110}');
    const middle=await run("(()=>{const c=document.getElementById('group'),r=c.getBoundingClientRect();return {canvases:document.querySelectorAll('canvas').length,x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],transform:getComputedStyle(c).transform}})()");
    assert.equal(middle.canvases,1);assert(middle.width<128&&middle.width>26);assert(middle.x>=-.1&&middle.y>=-.1&&middle.x+middle.width<=middle.viewport[0]+.1&&middle.y+middle.height<=middle.viewport[1]+.1);assert.deepEqual(win.getBounds(),original);
    // All four captured rows share one canvas geometry and preserve their union until one matrix contracts it.
    assert.equal(await run("(()=>{const c=document.getElementById('group'),g=c.getContext('2d');return [...g.getImageData(0,0,c.width,c.height).data].some((n,i)=>i%4===3&&n>0)})()"),true);
    const before=middle.transform,count=captures,prepareCount=prepared;
    const reverse=controller.request({expanded:true,cards,anchor,contextKey:key});await until(()=>run('document.getAnimations()[0]?.effect.getTiming().duration===200'));
    await run('for(const a of document.getAnimations()){a.pause();a.currentTime=0}');assert.equal(await run("getComputedStyle(document.getElementById('group')).transform"),before,'reverse starts at current single-canvas frame');assert.equal(captures,count);assert.equal(prepared,prepareCount);
    await run('for(const a of document.getAnimations())a.finish()');await Promise.all([exit,reverse]);assert.equal(controller.isActive(),false);assert.equal(win.isVisible(),false);assert(cards.every(row=>row.controller.modes.at(-1)===null));
    report.cases.push({side,bottom,middle,sharedMatrix:true,reverseReusesCanvas:true});
  }
  const card={id:'codex',controller:{setGroupTransitionMode(){},captureGroupTransitionFrames(){throw Error('reduced motion captured')}}};assert.equal((await controller.request({expanded:true,cards:[card],anchor:{x:0,y:0,width:26,height:7},contextKey:'reduced',reducedMotion:true})).immediate,true);
  const solid=(width,height,color)=>{const bytes=Buffer.alloc(width*height*4);for(let i=0;i<bytes.length;i+=4){bytes[i]=color;bytes[i+1]=120;bytes[i+2]=210;bytes[i+3]=255;}return nativeImage.createFromBitmap(bytes,{width,height}).toDataURL();};
  const source={x:100,y:80,width:390,height:500},target={x:600,y:550,width:128,height:32},bounds={x:100,y:80,width:628,height:502};
  const morph={token:90001,bounds,anchor:target,layers:[{bounds:source,image:solid(390,500,60)}],expanded:false,scale:1,weatherMorph:{source,target,compactImage:solid(128,32,160)}};
  await overlay.prepare(morph);assert.equal(await run("getComputedStyle(document.getElementById('compact')).opacity"),'0','compact target must not flash during prepare');
  assert.deepEqual(await run("[document.getElementById('compact').width,document.getElementById('compact').height]"),[128,32],'compact raster allocation is target-sized, not union-sized');
  const morphHost=win.getBounds(),morphing=overlay.animate({token:morph.token,expanded:false});await until(()=>run('document.getAnimations().length===3'));
  const surfaces=[];
  for(const at of [0,55,110,165,219]){
   await run(`for(const a of document.getAnimations()){a.pause();a.currentTime=${at}}`);
   const frame=await run(`(()=>{const s=document.getElementById('group'),c=document.getElementById('compact'),m=new DOMMatrix(getComputedStyle(s).transform),r=c.getBoundingClientRect();return{opacity:Number(getComputedStyle(s).opacity)+Number(getComputedStyle(c).opacity),surface:{x:m.e+${source.x-bounds.x}*m.a,y:m.f+${source.y-bounds.y}*m.d,width:${source.width}*m.a,height:${source.height}*m.d},compact:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
   assert(frame.opacity>=.98,'source and compact never disappear together');assert.deepEqual(win.getBounds(),morphHost,'union native host stays fixed');surfaces.push(frame);
  }
  assert(surfaces[0].surface.width>surfaces[2].surface.width&&surfaces[2].surface.width>surfaces[4].surface.width,'weather width contracts continuously');
  assert(surfaces[0].surface.height>surfaces[2].surface.height&&surfaces[2].surface.height>surfaces[4].surface.height,'weather height contracts continuously');
  assert(surfaces[2].surface.x>0&&surfaces[2].surface.x<target.x-bounds.x,'weather travels continuously to the restored stack target');
  await run('for(const a of document.getAnimations())a.finish()');await morphing;
  assert.equal(await run("getComputedStyle(document.getElementById('compact')).opacity"),'1','opaque compact owns the endpoint before native handoff');
  report.weatherMorph={surfaces,unionHost:morphHost,opaqueCompactEndpoint:true};
  await overlay.prepare({...morph,token:90002,weatherMorph:undefined});assert.equal(await run("document.querySelectorAll('canvas').length"),1,'ordinary group prepare removes the weather-only compact layer');
  assert.equal(BrowserWindow.prototype.isVisible.call(win),false,'test never shows a native host');
  report.passed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));controller.destroy();console.log('PASS single canvas / union endpoint / four corners / reverse without recapture / reduced / hidden native');app.exit(0);
 }catch(error){console.error(error);controller?.destroy();app.exit(1);}});
}else test('single native overlay contracts all source cards with one canvas and reverses without recapture',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-transition-'));try{const env={...process.env,PET_TRANSITION_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--transition-dom-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}
});
