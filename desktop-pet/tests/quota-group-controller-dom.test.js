const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
if(process.versions.electron&&process.argv.includes('--group-capture-child')){
 const {app,BrowserWindow:Native,session}=require('electron');app.setPath('userData',process.env.PET_GROUP_CAPTURE_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{const windows=[];try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
 class Hidden extends Native{constructor(options){super({...options,show:false});this.logical=false;windows.push(this)}showInactive(){this.logical=true}isVisible(){return this.logical}hide(){this.logical=false;super.hide()}}
 const pet=new Hidden({x:500,y:300,width:80,height:80,show:false,frame:false});pet.logical=true;
 const options={BrowserWindow:Hidden,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1440,height:900}})},getPetWindow:()=>pet,getPresentation:()=>({mode:'free'}),getSize:()=> 'compact',getGuardEntry:()=>true};
 const c=require('../lib/quota-label-window').createQuotaLabelWindow(options),a=require('../lib/api-usage-label-window').createApiUsageLabelWindow(options),w=require('../lib/workbuddy-label-window').createWorkBuddyLabelWindow(options);
 for(const x of [c,a,w])x.setGroupTransitionMode('stage');
 c.show({state:'ready',items:[{label:'5小时',remaining:80,windowMinutes:300}]});a.show({connected:true,report:{month:'2026-10',costs:{month:[{currency:'USD',value:1}],today:[]},usage:{inputTokens:1,outputTokens:1,requests:1}}});w.show({enabled:true,report:{total:100,basic:100,reward:0,purchased:0}});
 // Wait for the entire real multi-host fixture (including the lazily created guard),
 // rather than capturing API while sibling native hosts are still being created.
 const deadline=Date.now()+3000;
 while(!w.getGuardWindow()||windows.filter(x=>x!==pet).some(x=>!x.webContents.getURL()||x.webContents.isLoading())){if(Date.now()>deadline)throw Error('native fixture did not become ready');await new Promise(resolve=>setTimeout(resolve,16));}
 const groups=await Promise.all([c.captureGroupTransitionFrames(),a.captureGroupTransitionFrames(),w.captureGroupTransitionFrames()]);assert.deepEqual(groups.map(x=>x.length),[1,1,2]);
 for(const frame of groups.flat()){const image=require('electron').nativeImage.createFromBuffer(frame.png);assert(!image.isEmpty());const bitmap=image.getBitmap();assert(bitmap.some((value,index)=>index%4===3&&value>0),'capture has painted pixels');assert(frame.bounds.width>0&&frame.bounds.height>0);}
 for(const x of [c,a,w])x.setGroupTransitionMode(null);
 for(const x of [c,a,w])x.setGroupTransitionMode('stage');
 // Exercise a host that has logically presented before being staged, without ever showing a native fixture.
 await new Promise(resolve=>setTimeout(resolve,180));
 const started=Date.now();await Promise.all([c.captureGroupTransitionFrames(),a.captureGroupTransitionFrames(),w.captureGroupTransitionFrames()]);assert(Date.now()-started<700,'warm hidden capture remains within overlay capture budget');
 for(const x of [c,a,w]){assert(!x.getWindow().isVisible());x.setGroupTransitionMode(null);assert(x.getWindow().isVisible());x.setGroupTransitionMode('hold');const before=x.getWindow().getBounds();pet.setBounds({x:600,y:300,width:80,height:80});x.reposition();assert.deepEqual(x.getWindow().getBounds(),before);x.setGroupTransitionMode('masked');assert(!x.getWindow().isVisible());x.hide();x.destroy();}
 assert(windows.every(x=>x.isDestroyed()||!Native.prototype.isVisible.call(x)),'no real host was shown');console.log('PASS real hidden staged captures Codex/API/WB+guard and transition modes');app.exit(0);
 }catch(error){console.error(error.stack);for(const w of windows)if(!w.isDestroyed())w.destroy();app.exit(1);}});
}else require('node:test')('real hidden card pages stage and capture full frames including independent WB guard',async()=>{const data=fs.mkdtempSync(path.join(os.tmpdir(),'group-capture-dom-'));try{const env={...process.env,PET_GROUP_CAPTURE_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--group-capture-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}});
