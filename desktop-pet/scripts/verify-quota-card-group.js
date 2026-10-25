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
    let codex, api, zcode, workbuddy, group,bar; let groupState={visible:['codex','api','zcode','workbuddy']};
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
      let plan = () => null, sync = () => {}, stack = () => null;
      const presentationFor = id => { const group = plan(); const animate=!suppressed && groupState.bar && !config.pinned.includes(id); return { ...presentation, quotaGroupAnimate:animate, quotaAnimateHide:animate, quotaGroupIndex:config.order.indexOf(id), quotaGroupLayout: group?.cards[id], quotaGroupHidden: !groupState.visible.includes(id) || group?.hidden?.includes(id) }; };
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
        quotaCardGroup:{getState:()=>({eligible:['codex','api','zcode','workbuddy']})},quotaCardConfig:()=>({order:config.order,pinned:config.pinned}),quotaCardCollected:id=>!groupState.visible.includes(id),quotaCardGroupWindow:{getBounds:()=>bar?.getBounds()},sheepQuotaInk: null, quotaFreeStackBounds, edgeTuck: { getPresentation: () => presentation }, quotaDisplayConfig: () => ({ style: 'card' }), quotaObstacleBounds: () => bubble, safelyInvokeWindow: (_name, fn) => fn() };
      Function('scope', 'with(scope){' + main.slice(main.indexOf('let quotaFreeStackKey ='), main.indexOf('\nfunction reportQuotaError')) + ';scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;}')(scope);
      plan = scope.plan; sync = scope.sync; stack = scope.stack;
      const controllers = { codex, api, zcode, workbuddy };
      const apiState = { connected: true, report: { month: '2026-10', updatedAt: now, costs: { month: [{ currency: 'USD', value: 1 }], today: [{ currency: 'USD', value: 0.1 }] }, usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: null, requests: 2 } } };
      const showAll = () => { codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] }); api.show(apiState); zcode.sync(); workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } }); };
      const {createQuotaCardGroup}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group'));
      const {createQuotaCardGroupWindow}=require(path.join(sourceRoot,'desktop-pet/lib/quota-card-group-window'));
      let cursor={x:-10000,y:-10000},clock=0,job,suppressed=false;
      const fullyShown=async()=>{const deadline=Date.now()+10000;while(!Object.values(controllers).every(c=>c.getWindow()?.isVisible()&&c.getWindow().getOpacity()===1)){if(Date.now()>deadline)throw Error('group did not finish entry');await wait(16);}};
      const update=()=>{for(const c of Object.values(controllers))c.reposition();sync();};
      bar=createQuotaCardGroupWindow({BrowserWindow:HiddenWindow,screen,getPetWindow:()=>pet,getPresentation:()=>({...presentation,cardStackBounds:config.pinned.map(id=>controllers[id].getVisibleBounds()).filter(Boolean)}),ipcMain,onActivate:()=>group.activate(),onDismiss:()=>group.dismiss()});
      group=createQuotaCardGroup({getState:()=>({config,eligible:['codex','api','zcode','workbuddy'],suppressed}),getCursor:()=>cursor,getBounds:expanded=>[bar.getBounds(),...(expanded?Object.values(controllers).map(c=>c.getVisibleBounds()):[])].filter(Boolean),now:()=>clock,schedule:fn=>(job=fn,1),cancel(){job=null;},onChange:state=>{if(groupState.expanded&&!state.expanded)for(const c of Object.values(controllers))c.resetExpanded?.();groupState=state;if(state.bar)bar.show(state);else bar.hide();update();}});
      showAll();group.start();await wait(300);
      for(const mode of ['free','peeked'])for(const side of ['left','right'])for(const bottom of [false,true]){
        presentation={mode,side,shape};pet.setBounds({x:side==='left'?area.x:area.x+area.width-80,y:bottom?area.y+area.height-80:area.y,width:80,height:80});
        config={order:['workbuddy','api','codex','zcode'],pinned:[]};group.dismiss();group.sync();bar.show(groupState);update();{const deadline=Date.now()+10000;while(!bar.getBounds()){if(Date.now()>deadline)throw Error('bar not ready');await wait(16);}}await wait(210);
        assert(Object.values(controllers).every(c=>!c.getVisibleBounds()),'default four cards collected');assert(bar.getBounds(),'bar visible');
        const b=bar.getBounds();cursor={x:b.x+10,y:b.y+10};clock+=80;job();await fullyShown();update();
        assert(Object.values(controllers).every(c=>c.getVisibleBounds()),'hover expands actual native cards');
        const faces=config.order.map(id=>controllers[id].getVisibleBounds());for(let i=1;i<faces.length;i++)assert(faces[i].y>=faces[i-1].y+faces[i-1].height,'configured top-to-bottom order');
        cursor={x:faces[2].x+10,y:faces[2].y+10};clock+=500;job();assert(groupState.expanded,'card hover retains entire group');
        const origins=Object.fromEntries(Object.entries(controllers).map(([id,c])=>[id,c.getWindow().getBounds()]));
        cursor={x:-10000,y:-10000};clock+=80;job();clock+=220;job();await wait(50);
        for(const [id,c]of Object.entries(controllers)){assert.deepEqual(c.getWindow().getBounds(),origins[id],id+' group exit keeps origin');assert(c.getWindow().isVisible());assert(c.getWindow().getOpacity()>0&&c.getWindow().getOpacity()<1,id+' exit interpolates');const frame=await c.getWindow().webContents.executeJavaScript(`(()=>{const e=document.getElementById('quota-beam'),r=e.getBoundingClientRect();return {transform:getComputedStyle(e).transform,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);assert.notEqual(frame.transform,'none',id+' shared motion loaded');assert(frame.x>=-.1&&frame.y>=-.1&&frame.right<=frame.width+.1&&frame.bottom<=frame.height+.1,id+' middle frame remains in native viewport');if(mode==='free'&&side==='left'&&!bottom)fs.writeFileSync(path.join(out,id+'-exit-mid.png'),(await c.getWindow().webContents.capturePage(undefined,{stayHidden:true})).toPNG());}
        cursor={x:b.x+10,y:b.y+10};clock+=80;job();await fullyShown();assert(Object.values(controllers).every(c=>c.getVisibleBounds()),'rapid hover cancels pending exit');
        for(const [id,c]of Object.entries(controllers)){const channel=id==='codex'?'pet:quota-label-toggle':id==='zcode'?'pet:zcode-quota-label-toggle':id==='api'?'pet:api-usage-label-toggle':'pet:workbuddy-label-toggle';ipcMain.emit(channel,{sender:c.getWindow().webContents});}await fullyShown();
        const expandedOrigins=Object.fromEntries(Object.entries(controllers).map(([id,c])=>[id,c.getWindow().getBounds()]));
        group.dismiss();await wait(40);for(const [id,c]of Object.entries(controllers))assert.deepEqual(c.getWindow().getBounds(),expandedOrigins[id],id+' expanded exit paint stays fixed');await wait(170);group.activate();await fullyShown();for(const c of Object.values(controllers))assert.equal(c.getLayoutMetrics().height,32,'group reentry resets each individual detail');group.dismiss();await wait(210);cursor={x:b.x+10,y:b.y+10};clock+=80;job();await fullyShown();
        cursor={x:-10000,y:-10000};clock+=80;job();clock+=220;job();await wait(210);assert(Object.values(controllers).every(c=>!c.getWindow().isVisible()),'leave completes native fade');
        config.pinned=['api'];group.sync();update();await wait(250);assert(api.getVisibleBounds());assert(!codex.getVisibleBounds());bar.show(groupState);const pb=bar.getBounds(),pf=api.getVisibleBounds();assert(pb.y+6.5>=pf.y+pf.height+6||pb.y+20<=pf.y,'bar outside pinned stack');
        group.activate();await fullyShown();assert(groupState.expanded);group.dismiss();await wait(50);assert.equal(api.getWindow().getOpacity(),1,'pinned API never fades on group collection');await wait(160);group.activate();await fullyShown();suppressed=true;group.sync();bar.hide();for(const c of Object.values(controllers))c.hide();assert(Object.values(controllers).every(c=>!c.getWindow().isVisible()),'external safety hide is immediate');await wait(250);assert(!bar.getBounds());assert(Object.values(controllers).every(c=>!c.getVisibleBounds()));
        suppressed=false;showAll();group.sync();update();await wait(250);assert(api.getVisibleBounds(),'pin restores after external suppression');
        report.cases.push({mode,side,bottom,passed:true,fade:{duration:180,originPreserved:true,rapidReentry:true,pinNotFaded:true,safetyHideImmediate:true}});
      }
      group.close();bar.destroy();report.passed=true;
      assert(windows.every(w=>w.isDestroyed()||!w.nativeVisible()),'all native hosts remain hidden');assert.deepEqual(errors,[]);
      fs.writeFileSync(path.join(out,'quota-card-group-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,cases:report.cases.length,out}));
    } finally {group?.close();bar?.destroy();for(const w of windows)if(!w.isDestroyed())w.destroy();app.exit(report.passed?0:1);}
  });
}
