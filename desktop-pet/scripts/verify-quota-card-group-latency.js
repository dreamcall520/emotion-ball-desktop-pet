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
  const windows = [], errors = [], timings=[];
  // Controllers observe logical visibility; native show methods are never called.
  class HiddenWindow extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false });
      this.logicalVisible = false;
      this.nativeVisible = NativeWindow.prototype.isVisible.bind(this);
      windows.push(this);
      const originalLoad=this.loadFile.bind(this);this.loadFile=(...args)=>{const started=Date.now();return Promise.resolve(originalLoad(...args)).finally(()=>timings.push({method:'loadFile',url:String(args[0]).split('/').pop(),duration:Date.now()-started}));};
      for(const method of ['executeJavaScript','capturePage']){const original=this.webContents[method].bind(this.webContents);this.webContents[method]=async(...args)=>{const started=Date.now();try{return await original(...args)}finally{timings.push({method,url:this.webContents.getURL().split('/').pop(),duration:Date.now()-started})}};}
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
    let codex, api, zcode, workbuddy, transition; let groupState={visible:[]};
    try {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      const originalArea = nativeScreen.getPrimaryDisplay().workArea;
      let area = originalArea, presentation = { mode: 'free', shape }, bubble = null;
      const screen = { getDisplayMatching: () => ({ workArea: area }), getCursorScreenPoint: () => ({ x: -10000, y: -10000 }) };
      const pet = new HiddenWindow({ x: area.x + 400, y: area.y + 100, width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<body></body>'); pet.logicalVisible = true;
      const settings = normalizeSettings({ quotaCardOrder: fixtureCardConfig.order, quotaCardPinned: fixtureCardConfig.pinned, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaLabelSize: 'compact', codexEnabled: true, customization: { appearance: { shape } } });
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
      workbuddy = createWorkBuddyLabelWindow({ BrowserWindow: HiddenWindow, screen, getGuardEntry: () => !codex.isGuardEntryVisible({includeStaged:true}), getPetWindow: () => pet, getBubbleBounds: () => bubble,
        getStackAnchor: () => zcode.getVisibleBounds() || api.getVisibleBounds() || codex.getVisibleBounds(), getPresentation: () => presentationFor('workbuddy'),
        getObstacles: () => [codex.getVisibleBounds(), api.getVisibleBounds(), zcode.getVisibleBounds(), bubble].filter(Boolean), onLayout: () => sync(), onError });
      // Execute the owning main helper so a fixture cannot silently use a different plan.
      const main = fs.readFileSync(path.join(sourceRoot, 'desktop-pet/main.js'), 'utf8');
      const scope = { quotaLabel: codex, apiUsageLabel: api, zcodeLink: zcode, workbuddyLabel: workbuddy, petWindow: pet, screen, settings, SheepTheme, PetFacing,
        quotaExpandedStackPlan:()=>null,currentSheepCapsuleInk:()=>null,quotaCardGroup:{getState:()=>({eligible:['codex','api','zcode','workbuddy']})},quotaCardConfig:()=>({order:config.order,pinned:config.pinned}),quotaCardCollected:id=>!groupState.visible.includes(id),quotaCardGroupWindow:null,showQuotaCardBar:()=>{},quotaLayoutPresentation:()=>presentation,sheepBarInk:null,sheepQuotaInk: null, quotaFreeStackBounds, edgeTuck: { getPresentation: () => presentation }, quotaDisplayConfig: () => ({ style: 'card' }), quotaObstacleBounds: () => bubble, safelyInvokeWindow: (_name, fn) => fn() };
      Function('scope', 'with(scope){' + main.slice(main.indexOf('let quotaFreeStackKey ='), main.indexOf('\nfunction reportQuotaError')) + ';scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;}')(scope);
      plan = scope.plan; sync = scope.sync; stack = scope.stack;
      const controllers = { codex, api, zcode, workbuddy };
      const apiState = { connected: true, report: { month: '2026-10', updatedAt: now, costs: { month: [{ currency: 'USD', value: 1 }], today: [{ currency: 'USD', value: 0.1 }] }, usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: null, requests: 2 } } };
      const showAll = () => { codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] }); api.show(apiState); zcode.sync(); workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } }); };


      const {createQuotaCardGroupTransition}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group-transition'));
      const {createQuotaCardTransitionWindow}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-transition-window'));
      let overlay,phase='idle',requestAt=0,shownAt=0;const samples=[];
      const update=()=>{for(const c of Object.values(controllers))c.reposition();sync();};
      transition=createQuotaCardGroupTransition({screen,createOverlay:()=>{
        overlay=createQuotaCardTransitionWindow({BrowserWindow:HiddenWindow,ipcMain});
        const prepare=overlay.prepare,show=overlay.show,animate=overlay.animate;
        overlay.prepare=async payload=>{const start=Date.now();try{return await prepare(payload)}finally{timings.push({method:'overlay.prepare',duration:Date.now()-start})}};
        overlay.show=()=>{shownAt=Date.now();timings.push({method:'request-to-overlay',phase,duration:shownAt-requestAt});return show()};
        overlay.animate=async payload=>{const start=Date.now();const wc=overlay.getWindow().webContents;await wc.executeJavaScript('window.__latencyFrames=[];window.__latencyStart=performance.now();window.__latencyUntil=window.__latencyStart+260;requestAnimationFrame(function track(t){window.__latencyFrames.push(t);if(t<window.__latencyUntil)requestAnimationFrame(track)});void 0');try{return await animate(payload)}finally{timings.push({method:'overlay.animate',duration:Date.now()-start});const frameStats=await wc.executeJavaScript('({frames:window.__latencyFrames,start:window.__latencyStart})');const frames=frameStats.frames;timings.push({method:'overlay.rafGaps',firstFrameDelay:frames[0]-frameStats.start,gaps:frames.slice(1).map((time,index)=>time-frames[index])});}};
        return overlay;
      },isContextCurrent:()=>true,onError:error=>errors.push(error.message),onSettled:()=>update()});
      await transition.warm();showAll();
      const deadline=Date.now()+5000;while(!Object.values(controllers).every(c=>c.getWindow()&&!c.getWindow().webContents.isLoading())){if(Date.now()>deadline)throw Error('card load deadline: '+errors.join('; '));await wait(16)}
      presentation={mode:'free',side:'left',shape};pet.setBounds({x:area.x+200,y:area.y+80,width:80,height:80});
      for(const [id,c]of Object.entries(controllers)){const original=c.captureGroupTransitionFrames;c.captureGroupTransitionFrames=async()=>{const start=Date.now();try{return await original()}finally{timings.push({method:'controller.capture',source:id,duration:Date.now()-start})}};}
      const cards=Object.entries(controllers).map(([id,controller])=>({id,controller})),anchor={x:area.x+225,y:area.y+154,width:26,height:7};
      for(let cycle=0;cycle<3;cycle++){
        groupState={visible:[],expanded:false,bar:true};update();await wait(cycle===0?1600:300);
        phase='entry-'+cycle;const from=timings.length;requestAt=Date.now();groupState={visible:['codex','api','zcode','workbuddy'],expanded:true,bar:true};
        const result=await transition.request({expanded:true,cards,anchor,contextKey:'same',prepare:update});samples.push({cycle,result,total:Date.now()-requestAt,toOverlay:shownAt-requestAt,timings:timings.slice(from)});
        phase='exit-'+cycle;requestAt=Date.now();groupState={visible:[],expanded:false,bar:true};await transition.request({expanded:false,cards,anchor,contextKey:'same',prepare:update});
      }
      assert(samples.every(sample=>sample.result.ok),'all timed expansions complete');
      assert.equal(workbuddy.getGuardWindow(),null,'staged Codex priority does not cold-create a duplicate WB guard');
      assert(windows.every(win=>win.isDestroyed()||!win.nativeVisible()),'latency fixture never reveals native hosts');
      const output={samples,errors};fs.writeFileSync(path.join(out,'latency.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));report.passed=errors.length===0;
    }catch(error){console.error(error.stack);}
    finally{transition?.destroy();zcode?.close();api?.destroy();codex?.destroy();workbuddy?.destroy();for(const win of windows)if(!win.isDestroyed())win.destroy();app.exit(report.passed?0:1);}
  });
}
