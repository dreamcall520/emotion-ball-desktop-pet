// Native fixture acceptance of the shared renderer; no app main, account or model requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = process.env.PET_ZCODE_SELECTOR_OUT || '/Users/allan/Documents/ChatGPT/F03｜球球桌面宠物/验收记录/ZCode联动-20261025/trend-selector';
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-selector-'));
  const env = {...process.env,PET_ZCODE_SELECTOR_PROFILE:profile,PET_ZCODE_SELECTOR_OUT:output}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'),[`--user-data-dir=${profile}`,__filename],{env,stdio:'inherit'});
  const deadline = setTimeout(()=>child.kill('SIGTERM'),60000);
  child.once('close',code=>{clearTimeout(deadline);fs.rmSync(profile,{recursive:true,force:true});process.exitCode=code || 0;});
} else {
  const {app,BrowserWindow,ipcMain,nativeTheme,screen}=require('electron');
  assert.ok(process.env.PET_ZCODE_SELECTOR_PROFILE);app.setPath('userData',process.env.PET_ZCODE_SELECTOR_PROFILE);app.setActivationPolicy('accessory');app.on('window-all-closed',()=>{});
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const page=(win,code)=>win.webContents.executeJavaScript(code,true);
  async function poll(read,accept,label){for(let i=0;i<100;i++){const value=await read();if(accept(value))return value;await wait(30);}throw new Error(label);}
  async function pointer(win,selector){const p=await page(win,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('missing target');const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);win.focus();for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(50);}
  async function key(win,keyCode){win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await wait(50);}
  app.whenReady().then(async()=>{
    fs.mkdirSync(output,{recursive:true});const report={ok:false,fixtureOnly:true,actualModelCalls:0,scenarios:[],screenshots:[]};
    const now=Date.now(),plans=['ZCode 1024 Dev Day 活动套餐：不同模型分别计量','ZCode Start Plan 体验额度：每天刷新且不合并','另一个名称很长的活动套餐：仅验证长标题和关闭按钮不会发生重叠','名称很长的体验套餐，用来验证四个完整选项在窄窗口内可阅读'];
    const zitems=plans.map((planName,i)=>({bucketId:`zcode:fixture-${i}`,label:i%2?'GLM-5.3-Flash':'GLM-5.3',planName,windowMinutes:1440,periodStart:now-3600000,resetsAt:now+82800000,remaining:84-i*4,periodKind:i%2?'daily':'one_time',pace:{state:'unknown',remainingTimePercent:null}}));
    try {
      for(const source of ['zcode','codex'])for(const width of [320,404])for(const appearance of ['light','dark']){
        nativeTheme.themeSource=appearance;const prefix=`pet:${source}-details`,items=source==='zcode'?zitems:[{windowMinutes:300,remaining:64,resetsAt:now+7200000},{windowMinutes:10080,remaining:77,resetsAt:now+604800000}];
        const win=new BrowserWindow({width,height:520,show:false,frame:false,transparent:true,useContentSize:true,webPreferences:{preload:path.resolve(__dirname,'../codex-details-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,...(source==='zcode'?{additionalArguments:['--pet-source=zcode']}: {})}});
        let selected=source==='zcode'?items[0].bucketId:300,closed=0;const calls=[];
        const model=()=>({sourceId:source,action:'trend',items,bucketId:source==='zcode'?selected:null,period:source==='codex'?selected:1440,appearance,state:'ready',quotaUpdatedAt:now,trend:{windowMinutes:1440,resetsAt:now+82800000,samples:[{at:now-120000,remaining:90},{at:now-60000,remaining:87},{at:now,remaining:84}]}});
        const owns=e=>e.sender===win.webContents&&e.senderFrame===e.sender.mainFrame&&e.sender.getURL()===pathToFileURL(path.resolve(__dirname,'../codex-details.html')).href;
        const open=(event,action,id)=>{assert.ok(owns(event));assert.equal(action,'trend');assert.ok(items.some(item=>source==='zcode'?item.bucketId===id:item.windowMinutes===id));calls.push(id);selected=id;win.webContents.send(prefix,model());};
        const close=event=>{assert.ok(owns(event));closed++;};
        const resize=(event,height)=>{assert.ok(owns(event));win.setContentSize(width,Math.min(700,screen.getPrimaryDisplay().workArea.height-20,Math.max(120,height)));};
        ipcMain.on(`${prefix}-open`,open);ipcMain.on(`${prefix}-close`,close);ipcMain.on(`${prefix}-resize`,resize);
        try {
          await win.loadFile(path.resolve(__dirname,'../codex-details.html'));win.webContents.send(prefix,model());win.showInactive();
          await poll(()=>page(win,"document.querySelector('.title-product')?.textContent"),value=>value===source.toUpperCase(),'initial renderer');await wait(100);
          const geometry=await page(win,`(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return{width:innerWidth,scrollWidth:document.body.scrollWidth,header:r('.panel-header'),close:r('#details-close'),selector:r('.zcode-bucket-selector'),trigger:r('.zcode-bucket-trigger'),description:r('.zcode-bucket-description'),headerTabs:document.querySelectorAll('.panel-header .trend-tabs').length};})()`);
          assert.equal(geometry.width,width);assert.ok(geometry.scrollWidth<=width);assert.ok(geometry.close.right<=width&&geometry.close.left>=0);
          const scenario={source,width,appearance,geometry};report.scenarios.push(scenario);
          const capture=async suffix=>{await wait(80);const file=path.join(output,`${source}-${width}-${appearance}-${suffix}.png`);const image=await win.webContents.capturePage();assert.ok(!image.isEmpty());fs.writeFileSync(file,image.toPNG());report.screenshots.push(file);};
          if(source==='zcode'){
            assert.equal(geometry.headerTabs,0);assert.ok(geometry.selector.top>=geometry.header.bottom);assert.ok(geometry.trigger.right<=width-12&&geometry.description.right<=width-12);
            await capture('closed');await pointer(win,'.zcode-bucket-trigger');
            await poll(()=>page(win,"document.querySelector('.zcode-bucket-menu').hidden"),value=>value===false,'menu open');
            scenario.menu=await page(win,`(()=>{const m=document.querySelector('.zcode-bucket-menu'),r=m.getBoundingClientRect(),c=document.querySelector('#details-close').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:m.scrollWidth,clientWidth:m.clientWidth,count:document.querySelectorAll('.zcode-bucket-option').length,closeHit:Boolean(document.elementFromPoint(c.left+c.width/2,c.top+c.height/2)?.closest('#details-close'))};})()`);
            assert.equal(scenario.menu.count,4);assert.ok(scenario.menu.left>=0&&scenario.menu.right<=width&&scenario.menu.bottom<=scenario.menu.height);assert.ok(scenario.menu.scrollWidth<=scenario.menu.clientWidth);assert.ok(scenario.menu.closeHit,'menu cannot intercept close');await capture('open');
            await key(win,'End');await key(win,'Enter');await poll(()=>selected,value=>value===zitems[3].bucketId,'actual bucket IPC');
            assert.equal(calls.length,1);await poll(()=>page(win,"document.querySelector('.zcode-bucket-description').textContent"),value=>value===`${zitems[3].planName} · ${zitems[3].label}`,'selected description');
            await pointer(win,'.zcode-bucket-trigger');await key(win,'Escape');assert.equal(closed,0);assert.equal(await page(win,"document.querySelector('.zcode-bucket-menu').hidden"),true);
            await pointer(win,'.zcode-bucket-trigger');await pointer(win,'.panel-header');assert.equal(await page(win,"document.querySelector('.zcode-bucket-menu').hidden"),true);assert.equal(calls.length,1,'outside click must not select a covered option');assert.equal(selected,zitems[3].bucketId);
            await capture('selected');scenario.actualBucketChanges=calls.length;
          } else {assert.equal(geometry.headerTabs,1);assert.equal(await page(win,"document.querySelectorAll('.trend-tabs button').length"),2);assert.equal(await page(win,"document.querySelectorAll('.zcode-bucket-selector').length"),0);await capture('unchanged');}
          await pointer(win,'#details-close');assert.equal(closed,1,'close remains reachable');
        } finally {ipcMain.removeListener(`${prefix}-open`,open);ipcMain.removeListener(`${prefix}-close`,close);ipcMain.removeListener(`${prefix}-resize`,resize);win.destroy();}
      }
      report.ok=true;console.log('PET_ZCODE_SELECTOR_NATIVE_OK');
    } finally {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
    app.exit(0);
  }).catch(error=>{console.error(error.stack||error);app.exit(1);});
}
