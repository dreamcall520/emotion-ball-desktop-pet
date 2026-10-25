// Real settings/consent pages and controllers; mock observations, disposable profile, no network.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'zcode-settings-'));
  const env={...process.env,PET_SETTINGS_USER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'});
  child.on('exit',code=>{fs.rmSync(data,{recursive:true,force:true});process.exitCode=code??1;});
}else{
  const {app,BrowserWindow,ipcMain,screen}=require('electron');
  const root=process.env.PET_SETTINGS_APP_ROOT||path.resolve(__dirname,'../..');
  const {settingsEntries,findSettingsAction}=require(path.join(root,'desktop-pet/lib/global-settings'));
  const {normalizeSettings}=require(path.join(root,'desktop-pet/lib/settings'));
  const {createZcodeLink}=require(path.join(root,'desktop-pet/lib/zcode-link'));
  const {createZcodeConsentWindow}=require(path.join(root,'desktop-pet/lib/zcode-consent-window'));
  const {capturePaintedWindow}=require(path.join(root,'desktop-pet/scripts/verify-codex-companion'));
  const out=process.env.PET_SMOKE_ARTIFACT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'zcode-settings-artifacts-'));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  app.setPath('userData',process.env.PET_SETTINGS_USER_DATA);app.setActivationPolicy('accessory');app.on('window-all-closed',()=>{});
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true});const report={passed:false,fixture:true,noAccountApiOrModelAccess:true,root,checks:[],screenshots:[]};
    let win,link,consent;
    try{
      const settings=normalizeSettings({codexEnabled:false,codexQuotaAlwaysVisible:true,codexQuotaLabelSize:'compact'}),writes=[],serviceEvents=[],cardEvents=[],errors=[];
      const history={available:true,windows:[],results:[{id:'fixture-result',turnId:'fixture-turn',state:'completed',updatedAt:Date.now(),readAt:null}]};
      const snapshot={enabled:false,quota:{state:'disabled',windows:[]},history,tasks:{state:'unknown',items:[]}};
      const main=fs.readFileSync(path.join(root,'desktop-pet/main.js'),'utf8');
      const context={app,ipcMain,settings,settingsEntries,findSettingsAction,isQuitting:false,screenLocked:false,globalSettingsBusy:false,
        globalSettingsInitialView:'common',shortcutRegistrar:null,edgeTuck:{getPresentation:()=>({mode:'free'})},apiUsage:{getState:()=>({connected:false})},
        setCodexEnabled:()=>{throw Error('ZCode settings must never invoke Codex authorization');}};
      const area=screen.getPrimaryDisplay().workArea;
      consent=createZcodeConsentWindow({BrowserWindow,ipcMain,getInfo:()=>({appearance:settings.customization.appearance,colorMode:'standard'}),
        position:w=>w.setPosition(area.x+Math.round((area.width-460)/2),area.y+Math.round((area.height-656)/2),false),
        isBlocked:()=>context.screenLocked||context.isQuitting,getAppearance:()=>settings.codexQuotaAppearance,onError:e=>errors.push(String(e))});
      link=createZcodeLink({BrowserWindow,screen,ipcMain,getSettings:()=>settings,save:patch=>{Object.assign(settings,patch);writes.push(patch);},
        getPetWindow:()=>({isVisible:()=>true,isDestroyed:()=>false}),getSuppressed:()=>context.screenLocked,
        requestConsent:()=>consent.open(),cancelConsent:()=>consent.cancel(),
        createCard:()=>({show:()=>cardEvents.push('show'),hide:()=>cardEvents.push('hide'),destroy:()=>cardEvents.push('destroy'),reposition(){},setAlwaysOnTop(){},getWindow:()=>null,getVisibleBounds:()=>null}),
        createDetails:()=>({isVisible:()=>false,close(){},destroy(){},setAlwaysOnTop(){}}),
        createCompanion:()=>({getSnapshot:()=>snapshot,setEnabled:async value=>{snapshot.enabled=value;serviceEvents.push(value);},close(){}})});
      context.zcodeLink=link;
      context.menuTemplate=()=>[
        {id:'codex-menu',label:'Codex 与 API',submenu:[{id:'codex-enabled',label:'启用 Codex 联动',type:'checkbox',checked:settings.codexEnabled,click(){throw Error('Codex action unexpected');}}]},
        link.menu(),{id:'color-mode',label:'界面配色',submenu:[{id:'color-appearance',label:'外观（所有窗口）',submenu:['system','light','dark'].map(value=>({id:'appearance-'+value,label:{system:'跟随系统',light:'浅色',dark:'深色'}[value],type:'radio',checked:settings.codexQuotaAppearance===value,click:()=>{settings.codexQuotaAppearance=value;win.webContents.send('pet:color-mode','standard',value,'blue');}}))}]}];
      // Keep Electron's native objects in their own realm while loading the actual main handlers.
      Function('scope','with(scope){\n'+main.slice(main.indexOf('function globalSettingsSnapshot()'),main.indexOf('\nfunction openGlobalSettings('))+'\n'
        +main.slice(main.indexOf("  ipcMain.handle('pet:global-settings-get'"),main.indexOf("  ipcMain.handle('pet:codex-consent-get'"))+'\n}')(context);
      win=new BrowserWindow({width:980,height:760,minWidth:620,minHeight:480,show:false,title:'球球 · 设置中心',webPreferences:{preload:path.join(root,'desktop-pet/global-settings-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      context.globalSettingsWindow=win;await win.loadFile(path.join(root,'desktop-pet/global-settings.html'));win.showInactive();
      const page=code=>win.webContents.executeJavaScript(code);
      const poll=async(read,accept,label)=>{let value;const end=Date.now()+8000;do{value=await read();if(accept(value))return value;await wait(40);}while(Date.now()<end);throw Error(label+': '+JSON.stringify(value));};
      const click=async(w,selector)=>{const p=await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(e.disabled)throw Error('disabled');return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await wait(50);};
      const toggle='[aria-label="启用 ZCode 联动"]';
      await poll(()=>page('Boolean(document.querySelector(\'[data-view="/zcode-menu"]\'))'),Boolean,'ZCode navigation');
      await click(win,'[data-view="/zcode-menu"]');
      assert.equal(await page('document.getElementById("section-title").textContent'),'ZCode 联动');
      assert.equal(await page('document.querySelector(\'[aria-label="显示 ZCode 额度"]\').disabled'),true);
      assert.match(await page('document.getElementById("content").innerText'),/请先开启「启用 ZCode 联动」/);
      report.checks.push('ZCode sits beside Codex in settings; off dependent options explain activation');
      await click(win,toggle);await poll(()=>consent.getWindow()?.isVisible(),Boolean,'existing authorization');
      assert.equal(await page('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-checked")'),'false');
      assert.equal(serviceEvents.includes(true),false);await click(consent.getWindow(),'#consent-cancel');
      await poll(()=>page('!document.querySelector('+JSON.stringify(toggle)+').disabled'),Boolean,'cancel settles');
      assert.equal(link.isEnabled(),false);assert.equal(writes.some(p=>p.zcodeEnabled===true),false);
      assert.match(await page('document.getElementById("feedback").textContent'),/未更改/);
      report.checks.push('cancel leaves switch off; pending consent cannot report success or write true');
      await click(win,toggle);await poll(()=>consent.getWindow()?.isVisible(),Boolean,'authorization again');
      await poll(()=>consent.getWindow().webContents.executeJavaScript('!document.querySelector("#consent-accept").disabled'),Boolean,'authorization ready');
      await click(consent.getWindow(),'#consent-accept');
      await poll(()=>page('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-checked")'),value=>value==='true','enabled snapshot');
      assert.equal(link.isEnabled(),true);assert.equal(settings.codexEnabled,false);
      await click(win,'[aria-label="显示 ZCode 额度"]');assert.equal(settings.zcodeQuotaAlwaysVisible,false);assert.equal(snapshot.enabled,true);
      await click(win,'[aria-label="额度趣味互动"]');assert.equal(settings.zcodeQuotaFunEnabled,false);
      await page(`(()=>{const s=document.querySelector('select[aria-label="额度卡片大小"]');s.value='/zcode-menu/zcode-quota-size/zcode-size-standard';s.dispatchEvent(new Event('change'));})()`);
      await poll(()=>settings.zcodeQuotaLabelSize,value=>value==='standard','size save');
      assert.equal(settings.codexQuotaLabelSize,'compact');assert.equal(settings.codexQuotaAlwaysVisible,true);
      await click(win,'[aria-label="显示 ZCode 额度"]');assert.equal(settings.zcodeQuotaAlwaysVisible,true);assert.ok(cardEvents.includes('hide'));
      report.checks.push('accepted existing consent; card/size/game use independent persisted menu preferences');
      for(const mode of ['light','dark']){
        await click(win,`[aria-label="界面外观：${mode==='light'?'浅色':'深色'}"]`);
        await poll(()=>page('document.documentElement.dataset.appearance'),value=>value===mode,'theme');
        const file=`settings-zcode-${mode}.png`;await capturePaintedWindow({win,artifactPath:path.join(out,file)});report.screenshots.push(file);
      }
      await click(win,toggle);await poll(()=>link.isEnabled(),value=>value===false,'disable');assert.equal(serviceEvents.at(-1),false);assert.ok(cardEvents.includes('destroy'));assert.equal(snapshot.history,history);assert.equal(history.results.length,1);
      report.checks.push('disable retracts connection/card without deleting existing history');
      await click(win,toggle);await poll(()=>consent.getWindow()?.isVisible(),Boolean,'pending lock');
      context.screenLocked=true;consent.cancel();link.hide();win.hide();await wait(100);assert.equal(link.isEnabled(),false);
      assert.equal(await page('window.qiuqiuSettings.get()'),null,'locked settings read is unavailable');
      context.screenLocked=false;win.showInactive();await page('window.dispatchEvent(new Event("focus"))');
      await poll(()=>page('!document.querySelector('+JSON.stringify(toggle)+').disabled'),Boolean,'unlock snapshot');
      assert.equal(await page('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-checked")'),'false');
      report.checks.push('lock cancels pending consent; unlock reads actual disabled state');
      win.setSize(620,520);await wait(100);assert.equal(await page('document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'),true);
      const compact='settings-zcode-620.png';await capturePaintedWindow({win,artifactPath:path.join(out,compact)});report.screenshots.push(compact);
      assert.deepEqual(errors,[]);report.passed=true;report.preferenceWrites=writes;report.serviceEvents=serviceEvents;
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));consent.close();link.close();win.destroy();console.log('ZCODE_SETTINGS_NATIVE_OK',JSON.stringify({checks:report.checks.length,out}));app.exit(0);
    }catch(error){report.error=error.stack;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));consent?.close();link?.close();win?.destroy();console.error(error.stack);app.exit(1);}
  });
}
