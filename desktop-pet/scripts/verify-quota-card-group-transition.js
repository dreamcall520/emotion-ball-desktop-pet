// Native Electron controllers with fixture data; every host remains hidden.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'combined-layout-data-'));
  const env = { ...process.env, PET_LAYOUT_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const sourceRoot = path.resolve(process.env.PET_QUOTA_GROUP_SOURCE_ROOT || path.resolve(__dirname, '../..'));
  const { app, BrowserWindow: NativeWindow, screen: nativeScreen, ipcMain, session } = require('electron');
  process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
  process.on('unhandledRejection', error => { console.error(error.stack); app.exit(1); });
  const { createQuotaLabelWindow } = require(path.join(sourceRoot, 'desktop-pet/lib/quota-label-window'));
  const { createApiUsageLabelWindow } = require(path.join(sourceRoot, 'desktop-pet/lib/api-usage-label-window'));
  const { createZcodeLink } = require(path.join(sourceRoot, 'desktop-pet/lib/zcode-link'));
  const { createWorkBuddyLabelWindow } = require(path.join(sourceRoot, 'desktop-pet/lib/workbuddy-label-window'));
  const { normalizeSettings } = require(path.join(sourceRoot, 'desktop-pet/lib/settings'));
  const { quotaFreeStackBounds } = require(path.join(sourceRoot, 'desktop-pet/lib/quota-label-placement'));
  const PetFacing = require(path.join(sourceRoot, 'desktop-pet/lib/pet-facing')), SheepTheme = require(path.join(sourceRoot, 'desktop-pet/lib/sheep-theme'));
  const shape = process.env.PET_LAYOUT_SHAPE || 'blob';
  const out = process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'combined-layout-artifacts-'));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const windows = [], errors = [];
  // Controllers observe logical visibility; native show methods are never called.
  class HiddenWindow extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false });
      this.logicalVisible = false;
      this.nativeVisible = NativeWindow.prototype.isVisible.bind(this);
      windows.push(this);
    }
    show() { this.logicalVisible = true; }
    showInactive() { this.logicalVisible = true; }
    hide() { this.logicalVisible = false; super.hide(); }
    isVisible() { return this.logicalVisible; }
  }
  app.setPath('userData', process.env.PET_LAYOUT_USER_DATA);
  app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const fixtureCardConfig = { order: ['codex','api','zcode','workbuddy'], pinned: ['codex','api','zcode','workbuddy'] };
    const report = { quotaCards: fixtureCardConfig, passed: false, fixture: true, nativeHostsHidden: true, noNetworkOrChat: true, sourceRoot, shape, cases: [] };
    let codex, api, zcode, workbuddy, transition; let groupState={visible:['codex','api','zcode','workbuddy']};
    try {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      const originalArea = nativeScreen.getPrimaryDisplay().workArea;
      let area = originalArea, presentation = { mode: 'free', shape }, bubble = null;
      const screen = { getDisplayMatching: () => ({ workArea: area }), getCursorScreenPoint: () => ({ x: -10000, y: -10000 }) };
      const pet = new HiddenWindow({ x: area.x + 400, y: area.y + 100, width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<body></body>'); pet.logicalVisible = true;
      const settings = normalizeSettings({ quotaCardOrder: fixtureCardConfig.order, quotaCardPinned: fixtureCardConfig.pinned, openaiApiAlwaysVisible:true,workbuddyEnabled:true,workbuddyQuotaAlwaysVisible:true,zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaLabelSize: 'compact', codexEnabled: true, customization: { appearance: { shape } } });
      assert.equal(settings.customization.appearance.shape, shape, 'fixture shape must be supported, not silently normalized');
      let config={order:['codex','api','zcode','workbuddy'],pinned:[]};
      let suppressed=false;
      let plan = () => null, sync = () => {}, stack = () => null;
      const presentationFor = id => { const group = plan(); const animate=false; return { ...presentation, quotaGroupAnimate:animate, quotaAnimateHide:animate, quotaGroupIndex:config.order.indexOf(id), quotaGroupLayout: group?.cards[id], quotaGroupHidden: !groupState.visible.includes(id) || group?.hidden?.includes(id) }; };
      const onError = error => errors.push(String(error?.stack || error));
      codex = createQuotaLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getSize: () => 'compact', getGuardEntry: () => true,
        getObstacle: () => bubble, getPresentation: () => ({ ...presentationFor('codex'), quotaGroupNeighbors: [api?.getVisibleBounds(), zcode?.getVisibleBounds(), workbuddy?.getVisibleBounds()].filter(Boolean) }), onLayout: () => sync(), onError });
      api = createApiUsageLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getQuotaWindow: () => codex.getWindow(), getQuotaBounds: () => codex.getVisibleBounds(),
        getObstacleBounds: () => bubble, getPresentation: () => presentationFor('api'), onLayout: () => sync(), onError });
      const now = Date.now(), quotaWindows = [{ id: 'zcode:fixture:0', label: 'GLM-5.3', model: 'GLM-5.3', planName: 'Fixture', remaining: 75, remainingUnits: 750, total: 1000, unit: 'token', periodKind: 'daily', periodStart: now - 3600000, resetsAt: now + 7200000, windowMinutes: 180 }];
      const snapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: quotaWindows }, history: { available: true, windows: [], results: [] }, tasks: { state: 'unknown', items: [] } };
      zcode = createZcodeLink({ BrowserWindow: HiddenWindow, screen, ipcMain, getPetWindow: () => pet, getSettings: () => settings, save: patch => Object.assign(settings, patch),
        getSuppressed: () => presentation.mode === 'tucked', getPresentation: () => ({ ...presentationFor('zcode'), quotaBottomAligned: true, quotaStackBelow: stack() }), onLayout: () => sync(),
        getObstacles: () => [codex.getVisibleBounds(), api.getVisibleBounds(), bubble].filter(Boolean),
        createCompanion: () => ({ getSnapshot: () => snapshot, setEnabled: async () => {}, refresh: async () => {}, close() {} }), onError });
      workbuddy = createWorkBuddyLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getBubbleBounds: () => bubble,
        getStackAnchor: () => zcode.getVisibleBounds() || api.getVisibleBounds() || codex.getVisibleBounds(), getPresentation: () => presentationFor('workbuddy'),
        getObstacles: () => [codex.getVisibleBounds(), api.getVisibleBounds(), zcode.getVisibleBounds(), bubble].filter(Boolean), onLayout: () => sync(), onError });
      // Execute the owning main helper so a fixture cannot silently use a different plan.
      const main = fs.readFileSync(path.join(sourceRoot, 'desktop-pet/main.js'), 'utf8');
      const scope = { quotaLabel: codex, apiUsageLabel: api, zcodeLink: zcode, workbuddyLabel: workbuddy, petWindow: pet, screen, settings, SheepTheme, PetFacing,
        currentSheepSettledInk:()=>null,currentSheepCapsuleInk:()=>shape==='new-year-sheep'?{theme:'none',facing:PetFacing.resolve(pet.getBounds(),area),ink:{x:.1,y:.2,width:.8,height:.6}}:null,quotaReducedMotion:()=>false,codexPageEpoch:1,quotaCardGroup:{getState:()=>({eligible:['codex','api','zcode','workbuddy']})},quotaCardConfig:()=>({order:config.order,pinned:config.pinned}),quotaCardCollected:id=>!groupState.visible.includes(id),quotaCardGroupWindow:null,showQuotaCardBar:()=>{},quotaLayoutPresentation:()=>presentation,sheepBarInk:null,sheepQuotaInk: null, quotaFreeStackBounds, edgeTuck: { getPresentation: () => presentation }, quotaDisplayConfig: () => ({ style: 'card' }), quotaObstacleBounds: () => bubble, safelyInvokeWindow: (_name, fn) => fn() };
      scope.quotaCardControllers=()=>({codex,api,zcode,workbuddy});
      scope.quotaCardGroupInput=()=>({config,eligible:['codex','api','zcode','workbuddy'],suppressed,dragging:false});
      Function('scope','with(scope){'+main.slice(main.indexOf('function quotaExpandedStackPlan()'),main.indexOf('function quotaLayoutPresentation()'))+';scope.quotaExpandedStackPlan=quotaExpandedStackPlan;}')(scope);
      Function('scope','with(scope){'+main.slice(main.indexOf('function quotaGroupTransitionContext()'),main.indexOf('function resetQuotaCardDetails()'))+';scope.quotaGroupTransitionContext=quotaGroupTransitionContext;}')(scope);
      Function('scope', 'with(scope){' + main.slice(main.indexOf('let quotaFreeStackKey ='), main.indexOf('\nfunction reportQuotaError')) + ';scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;}')(scope);
      plan = scope.plan; sync = scope.sync; stack = scope.stack;
      const controllers = { codex, api, zcode, workbuddy };
      const apiState = { connected: true, report: { month: '2026-10', updatedAt: now, costs: { month: [{ currency: 'USD', value: 1 }], today: [{ currency: 'USD', value: 0.1 }] }, usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: null, requests: 2 } } };
      const showAll = () => { codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] }); api.show(apiState); zcode.sync(); workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } }); };

      const {createQuotaCardGroupTransition}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group-transition'));
      const {createQuotaCardTransitionWindow}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-transition-window'));
      const {quotaCardBarBounds}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group-window'));
      let overlay,currentKey='',activeContext=true;const settled=[];
      const update=()=>{for(const c of Object.values(controllers))c.reposition();sync();};
      transition=createQuotaCardGroupTransition({screen,createOverlay:()=>overlay=createQuotaCardTransitionWindow({BrowserWindow:HiddenWindow,ipcMain}),
        isContextCurrent:key=>activeContext&&key===scope.quotaGroupTransitionContext(),onError:error=>errors.push(String(error.message)),
        onSettled:({expanded,canceled})=>{settled.push({expanded,canceled});if(!expanded&&!canceled)for(const c of Object.values(controllers))c.resetExpanded();update();}});
      await transition.warm();
      const until=async(condition,label)=>{const deadline=Date.now()+10000;while(!await condition()){if(Date.now()>deadline)throw Error('Timeout '+label);await wait(8);}};
      showAll();await until(()=>Object.values(controllers).every(c=>c.getWindow()?.isVisible()&&!c.getWindow().webContents.isLoading()&&c.getWindow().getOpacity()===1),'initial real cards ready');
      for(const mode of ['free','peeked'])for(const side of ['left','right'])for(const bottom of [false,true])for(const pinned of [null,'api']){
        config={order:['codex','api','zcode','workbuddy'],pinned:pinned?[pinned]:[]};
        presentation={mode,side,shape};pet.setBounds({x:side==='left'?area.x:area.x+area.width-80,y:bottom?area.y+area.height-80:area.y,width:80,height:80});
        groupState={visible:config.pinned,expanded:false,bar:true};update();
        assert(Object.entries(controllers).every(([id,c])=>id===pinned?c.getWindow().isVisible():!c.getWindow().isVisible()),'collapsed native cards exclude unpinned');
        const b=quotaCardBarBounds(pet.getBounds(),area,{...presentation,cardStackBounds:config.pinned.map(id=>controllers[id].getVisibleBounds()).filter(Boolean)}),anchor={x:b.x+11,y:b.y+6.5,width:26,height:7};
        const cards=config.order.filter(id=>id!==pinned).map(id=>({id,controller:controllers[id]}));currentKey=scope.quotaGroupTransitionContext();
        groupState={visible:config.order,expanded:true,bar:true};
        const entry=transition.request({expanded:true,cards,anchor,contextKey:currentKey,prepare:()=>{update();assert.equal(scope.quotaGroupTransitionContext(),currentKey,'real main context stable after stage/hold layout');}});
        await until(()=>overlay.getWindow()?.isVisible(),'entry overlay visible');
        assert(cards.every(row=>!row.controller.getWindow().isVisible()),'overlay stages all original unpinned hosts');if(pinned)assert(controllers[pinned].getWindow().isVisible(),'pin remains live outside snapshot');
        const ow=overlay.getWindow(),bounds=ow.getBounds();
        await ow.webContents.executeJavaScript('for(const a of document.getAnimations()){a.pause();a.currentTime=100}');
        const frame=await ow.webContents.executeJavaScript("(()=>{const c=document.getElementById('group'),r=c.getBoundingClientRect();return {count:document.querySelectorAll('canvas').length,transform:getComputedStyle(c).transform,x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]}})()");
        assert.equal(frame.count,1);assert(frame.x>=-.1&&frame.y>=-.1&&frame.x+frame.width<=frame.viewport[0]+.1&&frame.y+frame.height<=frame.viewport[1]+.1);assert.deepEqual(ow.getBounds(),bounds);
        await ow.webContents.executeJavaScript('for(const a of document.getAnimations())a.finish()');assert.equal((await entry).ok,true);assert(cards.every(row=>row.controller.getWindow().isVisible()),'entry hands off to original real hosts');
        groupState={visible:config.pinned,expanded:false,bar:true};
        const origins=Object.fromEntries(cards.map(row=>[row.id,row.controller.getWindow().getBounds()]));
        const exit=transition.request({expanded:false,cards,anchor,contextKey:currentKey,prepare:()=>{update();assert.equal(scope.quotaGroupTransitionContext(),currentKey,'real main context stable after stage/hold layout');}});
        assert(cards.every(row=>row.controller.getWindow().isVisible()),'exit capture holds original painted cards');
        await until(()=>overlay.getWindow().isVisible(),'exit overlay visible');assert(cards.every(row=>!row.controller.getWindow().isVisible()),'exit hides originals only after overlay ready');
        for(const row of cards)assert.deepEqual(row.controller.getWindow().getBounds(),origins[row.id],'exit preserves each native source bounds');
        await ow.webContents.executeJavaScript('for(const a of document.getAnimations()){a.pause();a.currentTime=110}');
        await ow.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        if(!pinned&&mode==='free'&&side==='left'&&!bottom)fs.writeFileSync(path.join(out,'whole-group-collapse-mid.png'),(await ow.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
        groupState={visible:config.order,expanded:true,bar:true};const reverse=transition.request({expanded:true,cards,anchor,contextKey:currentKey,prepare:()=>{update();assert.equal(scope.quotaGroupTransitionContext(),currentKey,'real main context stable after stage/hold layout');}});
        await until(()=>ow.webContents.executeJavaScript('document.getAnimations()[0]?.effect.getTiming().duration===200'),'reverse direction');await ow.webContents.executeJavaScript('for(const a of document.getAnimations())a.finish()');await Promise.all([exit,reverse]);
        assert(cards.every(row=>row.controller.getWindow().isVisible()),'reverse reveals all originals without recapture');
        groupState={visible:config.pinned,expanded:false,bar:true};const finish=transition.request({expanded:false,cards,anchor,contextKey:currentKey,prepare:()=>{update();assert.equal(scope.quotaGroupTransitionContext(),currentKey,'real main context stable after stage/hold layout');}});await until(()=>ow.isVisible(),'final exit ready');await ow.webContents.executeJavaScript('for(const a of document.getAnimations())a.finish()');await finish;
        assert(cards.every(row=>!row.controller.getWindow().isVisible()));if(pinned)assert(controllers[pinned].getWindow().isVisible());
        report.cases.push({mode,side,bottom,pinned,realMainExpandedPlan:true,realMainContextStable:true,oneCanvas:true,realCardsCaptured:true,noPrematureHide:true,reverse:true});
      }
      // Reproduce the recorded inline ZCode resize using its real renderer IPC and real main planner.
      const {createQuotaCardGroup}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group'));
      let cursor={x:-10000,y:-10000},clock=0,tick;
      config={order:['codex','api','zcode','workbuddy'],pinned:[]};presentation={mode:'free',shape};
      quotaWindows.splice(1);for(let i=1;i<4;i++)quotaWindows.push({...quotaWindows[0],id:'zcode:fixture:'+i,model:'Model '+i});
      const group=createQuotaCardGroup({getState:()=>scope.quotaCardGroupInput(),getCursor:()=>cursor,getBounds:expanded=>expanded?Object.values(controllers).map(c=>c.getVisibleBounds()).filter(Boolean):[],onChange:state=>{groupState=state;update()},schedule:fn=>(tick=fn,1),cancel(){tick=null},now:()=>clock});
      scope.quotaCardGroup=group;group.start();group.activate({keyboard:false});showAll();update();
      const zw=zcode.getWindow(),toggle=()=>zw.webContents.executeJavaScript('petQuotaLabel.toggleExpanded()');
      await toggle();await until(()=>zcode.getLayoutMetrics()?.height>60,'real four-bucket expanded ZCode');const expandedHeight=zcode.getLayoutMetrics().height;
      await toggle();await until(()=>zcode.getLayoutMetrics()?.height===32,'compact ZCode');
      const compactHeight=4*28+3*8,fullHeight=expandedHeight+3*28+3*8;
      const belowSpace=(compactHeight+fullHeight)/2,py=area.y+area.height-80-8-belowSpace;
      pet.setBounds({x:area.x+area.width/2-40,y:Math.round(py),width:80,height:80});update();assert.equal(plan().placement,'below');
      const old=plan().cards.zcode.face;cursor={x:old.x+old.width/2,y:old.y+old.height/2};
      await toggle();await until(()=>zcode.getLayoutMetrics()?.height===expandedHeight,'inline ZCode toggled');update();assert.equal(plan().placement,'above');
      for(let i=0;i<8;i++){clock+=80;tick();}assert.equal(group.getState().expanded,true,'original video click survives 640ms after flip');
      const next=plan().cards.zcode.face;cursor={x:next.x+next.width/2,y:next.y+next.height/2};clock+=80;tick();assert(group.getState().expanded);
      cursor={x:old.x+old.width/2,y:old.y+old.height/2};for(let i=0;i<5;i++){clock+=80;tick();}assert.equal(group.getState().expanded,false,'after reaching real card the old empty area no longer retains hover');
      group.close();report.inlineResize={source:'zcode',realRendererToggle:true,buckets:4,expandedHeight,from:'below',to:'above',stationaryMs:640,oldEmptyAreaReleased:true};
      assert(settled.length>=48,'entry/reverse/exit all settle');assert(settled.every(result=>result.canceled===false),'actual main context never cancels a completed animation');report.settled=settled;assert.deepEqual(errors,[]);assert(windows.every(w=>w.isDestroyed()||!w.nativeVisible()),'all native hosts remain hidden');report.passed=true;
      fs.writeFileSync(path.join(out,'group-transition-report.json'),JSON.stringify(report,null,2));console.log('GROUP_TRANSITION_NATIVE_OK',JSON.stringify({cases:report.cases.length,out}));
    }catch(error){console.error(error.stack);}
    finally{transition?.destroy();zcode?.close();api?.destroy();codex?.destroy();workbuddy?.destroy();for(const win of windows)if(!win.isDestroyed())win.destroy();app.exit(report.passed?0:1);}
  });
}
