// Actual API/shortcut native windows and main pin/gating code; disposable profile, no network.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'api-shortcuts-')),env={...process.env,PET_SHORTCUT_API_USER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'});
  child.on('exit',code=>{fs.rmSync(data,{recursive:true,force:true});process.exitCode=code??1;});
}else{
  const {app,BrowserWindow,screen,ipcMain}=require('electron'),root=process.env.PET_SHORTCUT_API_APP_ROOT||path.resolve(__dirname,'../..');
  const {createApiUsageLabelWindow}=require(path.join(root,'desktop-pet/lib/api-usage-label-window'));
  const {createShortcutWindow}=require(path.join(root,'desktop-pet/lib/shortcut-window'));
  const {normalizeSettings}=require(path.join(root,'desktop-pet/lib/settings'));
  const {capturePaintedWindow}=require(path.join(root,'desktop-pet/scripts/verify-codex-companion'));
  const out=process.env.PET_SMOKE_ARTIFACT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'api-shortcuts-artifacts-')),wait=ms=>new Promise(r=>setTimeout(r,ms));
  app.setPath('userData',process.env.PET_SHORTCUT_API_USER_DATA);app.setActivationPolicy('accessory');app.on('window-all-closed',()=>{});
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true});const report={passed:false,fixture:true,noExternalAccess:true,cases:[]};let pet,api,scope;
    try{
      const area=screen.getPrimaryDisplay().workArea,errors=[],settings=normalizeSettings({openaiApiAlwaysVisible:true}),state={connected:false,busy:false,report:null,config:{}};
      pet=new BrowserWindow({x:area.x+Math.round(area.width/2)-40,y:area.y+240,width:80,height:80,frame:false,show:false,focusable:false,skipTaskbar:true});
      await pet.loadURL('data:text/html,<body style="margin:0;background:%23eee9e1;text-align:center;font:24px sans-serif">•ᴗ•</body>');pet.showInactive();
      const testScreen={getDisplayMatching:b=>screen.getDisplayMatching(b),getCursorScreenPoint:()=>({x:pet.getBounds().x+40,y:pet.getBounds().y+40})};
      api=createApiUsageLabelWindow({BrowserWindow,screen:testScreen,getPetWindow:()=>pet,onError:e=>errors.push(String(e))});
      scope={app,BrowserWindow,ipcMain,screen:testScreen,settings,petWindow:pet,shortcutWindow:null,shortcutRegistrar:null,apiUsageLabel:api,
        apiUsage:{getState:()=>state,refresh:async()=>{}},isQuitting:false,screenLocked:false,chatWindow:null,dragState:null,hostMotion:null,
        apiRefreshTimer:null,apiLastAttemptAt:Date.now(),API_REFRESH_MS:120000,globalShortcut:{},codexCompanion:null,quotaGuard:null,
        edgeTuck:{getPresentation:()=>({mode:'free'}),pin(){}},dialogue:{dismiss(){}},pomodoroWindows:{sync(){}},bubble:{reposition(){}},
        createShortcutWindow,createShortcutRegistrar:()=>({start(){},getConfig:()=>settings.shortcutSettings,getErrors:()=>[],setRecording(){}}),
        openShortcutAction(){},saveShortcutConfig(){},hideBubble(){},dismissCodexPresentation(){},presentationSuppressed:()=>false,
        shortcutDialogueSuppressed:()=>scope.shortcutWindow?.isPresenting(),safelyInvokeWindow:(_s,fn)=>fn(),writeError:(_s,e)=>errors.push(String(e)),
        syncQuotaLabel:()=>scope.syncAPI()};
      const main=fs.readFileSync(path.join(root,'desktop-pet/main.js'),'utf8');
      Function('scope','with(scope){\n'+main.slice(main.indexOf('function syncApiUsageLabel()'),main.indexOf('\nfunction setApiUsageVisible('))+'\n'
        +main.slice(main.indexOf('function initializeShortcuts()'),main.indexOf('\nfunction syncPomodoro('))+'\nscope.syncAPI=syncApiUsageLabel;initializeShortcuts();}')(scope);
      const poll=async(read,accept,label)=>{let value;const end=Date.now()+6000;do{value=await read();if(accept(value))return value;await wait(30);}while(Date.now()<end);throw Error(label+': '+JSON.stringify(value));};
      for(const connected of [false,true])for(const shape of ['floating','list']){
        state.connected=connected;state.busy=false;settings.openaiApiAlwaysVisible=true;settings.shortcutSettings={...settings.shortcutSettings,shape};
        scope.syncAPI();await poll(()=>api.getWindow()?.isVisible(),Boolean,'API visible');
        scope.shortcutWindow.open({focus:false});assert.equal(api.getWindow().isVisible(),false,'onPin hides API before the shortcut finishes loading');
        await poll(()=>scope.shortcutWindow.getWindow()?.isVisible(),Boolean,'shortcut visible');
        scope.syncAPI();state.busy=true;scope.syncAPI();assert.equal(api.getWindow().isVisible(),false,'refresh cannot reappear');
        if(!connected&&shape==='floating')await capturePaintedWindow({win:scope.shortcutWindow.getWindow(),artifactPath:path.join(out,'shortcuts-api-hidden.png')});
        scope.shortcutWindow.close();assert.equal(scope.shortcutWindow.isPresenting(),true);scope.syncAPI();assert.equal(api.getWindow().isVisible(),false);
        await wait(60);assert.equal(api.getWindow().isVisible(),false,'closing animation remains clear');
        await poll(()=>api.getWindow().isVisible(),Boolean,'API restored');
        scope.shortcutWindow.open({focus:false});settings.openaiApiAlwaysVisible=false;scope.syncAPI();scope.shortcutWindow.close();await wait(220);assert.equal(api.getWindow().isVisible(),false);
        settings.openaiApiAlwaysVisible=true;scope.syncAPI();scope.shortcutWindow.open({focus:false});scope.screenLocked=true;scope.shortcutWindow.interrupt();scope.syncAPI();assert.equal(api.getWindow().isVisible(),false);
        scope.screenLocked=false;scope.syncAPI();await poll(()=>api.getWindow().isVisible(),Boolean,'unlock restore');
        scope.shortcutWindow.open({focus:false});scope.chatWindow={isVisible:()=>true};scope.shortcutWindow.close();await wait(220);scope.syncAPI();assert.equal(api.getWindow().isVisible(),false);
        scope.chatWindow=null;scope.syncAPI();await poll(()=>api.getWindow().isVisible(),Boolean,'chat closed restore');
        api.destroy();scope.syncAPI();scope.shortcutWindow.open({focus:false});await wait(200);assert.equal(api.getWindow().isVisible(),false,'late native load cannot restore hidden API');scope.shortcutWindow.close();await poll(()=>api.getWindow().isVisible(),Boolean,'late load closing restore');
        report.cases.push({connected,shape,openHidden:true,refreshHidden:true,closingHidden:true,restored:true,offRespected:true,lockRespected:true,chatRespected:true,lateLoadRespected:true});
      }
      assert.deepEqual(errors,[]);report.passed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));scope.shortcutWindow.dispose();api.destroy();pet.destroy();clearTimeout(scope.apiRefreshTimer);console.log('API_SHORTCUTS_NATIVE_OK',JSON.stringify({cases:report.cases.length,out}));app.exit(0);
    }catch(error){report.error=error.stack;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));scope?.shortcutWindow?.dispose();api?.destroy();pet?.destroy();console.error(error.stack);app.exit(1);}
  });
}
