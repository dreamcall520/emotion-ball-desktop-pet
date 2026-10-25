// Native Electron controllers with fixture data; every host remains hidden.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'combined-layout-data-'));
  const env = { ...process.env, PET_LAYOUT_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const sourceRoot = path.resolve(process.env.PET_LAYOUT_SOURCE_ROOT || path.resolve(__dirname, '../..'));
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
    let codex, api, zcode, workbuddy;
    try {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      const originalArea = nativeScreen.getPrimaryDisplay().workArea;
      let area = originalArea, presentation = { mode: 'free', shape }, bubble = null;
      const screen = { getDisplayMatching: () => ({ workArea: area }), getCursorScreenPoint: () => ({ x: -10000, y: -10000 }) };
      const pet = new HiddenWindow({ x: area.x + 400, y: area.y + 100, width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<body></body>'); pet.logicalVisible = true;
      const settings = normalizeSettings({ quotaCardOrder: fixtureCardConfig.order, quotaCardPinned: fixtureCardConfig.pinned, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaLabelSize: 'compact', codexEnabled: true, customization: { appearance: { shape } } });
      assert.equal(settings.customization.appearance.shape, shape, 'fixture shape must be supported, not silently normalized');
      let plan = () => null, sync = () => {}, stack = () => null;
      const presentationFor = id => { const group = plan(); return { ...presentation, quotaGroupLayout: group?.cards[id], quotaGroupHidden: group?.hidden?.includes(id) }; };
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
        quotaCardGroup:{getState:()=>({eligible:['codex','api','zcode','workbuddy']})},quotaCardConfig: () => fixtureCardConfig, quotaCardCollected: () => false, quotaCardGroupWindow: null,
        sheepQuotaInk: null, quotaFreeStackBounds, edgeTuck: { getPresentation: () => presentation }, quotaDisplayConfig: () => ({ style: 'card' }), quotaObstacleBounds: () => bubble, safelyInvokeWindow: (_name, fn) => fn() };
      Function('scope', 'with(scope){' + main.slice(main.indexOf('let quotaFreeStackKey ='), main.indexOf('\nfunction reportQuotaError')) + ';scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;}')(scope);
      plan = scope.plan; sync = scope.sync; stack = scope.stack;
      const controllers = { codex, api, zcode, workbuddy };
      const apiState = { connected: true, report: { month: '2026-10', updatedAt: now, costs: { month: [{ currency: 'USD', value: 1 }], today: [{ currency: 'USD', value: 0.1 }] }, usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: null, requests: 2 } } };
      const showAll = () => { codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] }); api.show(apiState); zcode.sync(); workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } }); };
      const settle = async () => {
        const deadline=Date.now()+10000;
        while(true) {
          sync(); Object.values(controllers).forEach(c=>c.reposition());
          const group=plan(), loaded=Object.values(controllers).every(c=>{const win=c.getWindow();return win&&!win.webContents.isLoadingMainFrame();});
          const placed=loaded && (!group || Object.entries(controllers).every(([id,c])=>{
            const actual=c.getVisibleBounds(), expected=group.cards[id]?.face;
            return group.hidden?.includes(id) ? actual===null : !expected || actual&&c.getWindow().getOpacity()===1&&['x','y','width','height'].every(key=>actual[key]===expected[key]);
          }));
          if(placed) return;
          assert(Date.now()<deadline,`layout did not settle: ${JSON.stringify({group,bounds:Object.fromEntries(Object.entries(controllers).map(([id,c])=>[id,c.getVisibleBounds()]))})}`);
          await wait(25);
        }
      };
      const toggle = async id => {
        const win = controllers[id].getWindow(); assert(win?.isVisible(), `cannot toggle hidden ${id}`);
        const before = controllers[id].getLayoutMetrics();
        const channel = { codex: 'pet:quota-label-toggle', api: 'pet:api-usage-label-toggle', zcode: 'pet:zcode-quota-label-toggle', workbuddy: 'pet:workbuddy-label-toggle' }[id];
        win.webContents.emit('ipc-message', { sender: win.webContents, senderFrame: win.webContents.mainFrame }, channel); await settle();
        const after = controllers[id].getLayoutMetrics();
        if (controllers[id].getVisibleBounds()) assert.notEqual(after.height, before.height, `${id} toggle did not resize`);
      };
      const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      const check = name => {
        const bounds = Object.fromEntries(Object.entries(controllers).map(([id, c]) => [id, c.getVisibleBounds()]));
        const visible = Object.entries(bounds).filter(([, b]) => b);
        for (const [id, b] of visible) {
          assert(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height, `${name}: outside ${id} ${JSON.stringify(b)}`);
          assert(!overlap(b, pet.getBounds()), `${name}: ${id} overlaps pet`);
          if (bubble) assert(!overlap(b, bubble), `${name}: ${id} overlaps bubble`);
        }
        for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) assert(!overlap(visible[i][1], visible[j][1]), `${name}: ${visible[i][0]} overlaps ${visible[j][0]} ${JSON.stringify(bounds)}`);
        if (visible.length === 4 && plan()?.cards) {
          const faces = visible.map(([,face])=>face);
          for (let i=1;i<faces.length;i++) assert.equal(faces[i].y-faces[i-1].y-faces[i-1].height,8,`${name}: group order/gap`);
        }
        for (const win of windows) if (!win.isDestroyed()) assert.equal(win.nativeVisible(), false, 'native host became visible');
        assert.deepEqual(errors, []);
        report.cases.push({ name, pet: pet.getBounds(), area, bounds, plan: plan() });
        return visible;
      };
      showAll();
      const readyDeadline = Date.now() + 30000;
      let initialReady;
      for (;;) {
        sync(); Object.values(controllers).forEach(controller => controller.reposition());
        initialReady = Object.fromEntries(Object.entries(controllers).map(([id, controller]) => {
          const win = controller.getWindow();
          return [id, { loaded: Boolean(win && !win.webContents.isLoadingMainFrame()), visible: Boolean(win?.isVisible()), bounds: controller.getVisibleBounds() }];
        }));
        assert.deepEqual(errors, [], 'initial controller loading failed');
        if (Object.values(initialReady).every(state => state.loaded && state.visible && state.bounds)) break;
        assert(Date.now() < readyDeadline, `four native controllers were not ready: ${JSON.stringify(initialReady)}`);
        await wait(25);
      }
      report.initialReady = initialReady;
      for (const controller of Object.values(controllers)) assert.equal(await controller.getWindow().webContents.executeJavaScript('document.readyState'), 'complete');
      const cx = area.x + Math.round(area.width / 2) - 40;
      for (const [name, x, y] of [['center', cx, area.y + 80], ['bottom', cx, area.y + area.height - 100], ['top-left', area.x, area.y], ['top-right', area.x + area.width - 80, area.y], ['bottom-left', area.x, area.y + area.height - 80], ['bottom-right', area.x + area.width - 80, area.y + area.height - 80]]) {
        pet.setBounds({ x, y, width: 80, height: 80 }, false); await settle(); assert.equal(check(name).length, 4);
        for (const id of Object.keys(controllers)) { await toggle(id); check(`${name}-${id}-expanded`); await toggle(id); assert.equal(check(`${name}-${id}-collapsed`).length, 4); }
      }
      pet.setBounds({ x: cx, y: area.y + 20, width: 80, height: 80 }, false); await settle();
      for (const id of Object.keys(controllers)) { await toggle(id); check(`cumulative-${id}-expanded`); }
      for (const id of Object.keys(controllers).reverse()) {
        if (controllers[id].getVisibleBounds()) await toggle(id);
        check(`cumulative-${id}-collapsed`);
      }
      for (const id of Object.keys(controllers)) {
        if (id === 'zcode') zcode.setPreference('zcodeQuotaAlwaysVisible', false); else controllers[id].hide();
        await settle(); assert.equal(controllers[id].getVisibleBounds(), null, `${id} stayed visible`); check(`${id}-off`);
        if (id === 'zcode') zcode.setPreference('zcodeQuotaAlwaysVisible', true);
        showAll(); await settle(); assert.equal(check(`${id}-restored`).length, 4);
      }
      // Shrink only the test display contract; no display settings are changed.
      area = { ...originalArea, height: 150 }; pet.setBounds({ x: cx, y: area.y + 30, width: 80, height: 80 }, false); await settle();
      assert.equal(check('no-room').length, 0); assert.equal(plan().hidden.length, 4);
      area = originalArea; pet.setBounds({ x: cx, y: area.y + 80, width: 80, height: 80 }, false); await settle(); assert.equal(check('space-restored').length, 4);
      const checkPeekColumn = name => {
        const visible = check(name), group = plan();
        assert(group, `${name}: missing shared group`);
        const rows = Object.entries(group.cards).filter(([id]) => controllers[id].getVisibleBounds());
        const faces = rows.map(([, row]) => row.face);
        for (const [id, row] of rows) {
          const face = controllers[id].getVisibleBounds();
          assert.deepEqual(face, row.face, `${name}: ${id} did not consume shared placement`);
          assert.equal(face.x + (presentation.side === 'right' ? face.width : 0), presentation.side === 'left' ? area.x + 2 : area.x + area.width - 2);
        }
        for (let i = 1; i < faces.length; i++) assert.equal(faces[i].y-faces[i-1].y-faces[i-1].height, 8);
        return visible;
      };
      for (const side of ['left', 'right']) for (const y of [area.y, area.y + Math.round(area.height / 2), area.y + area.height - 80]) {
        presentation = { mode: 'peeked', side, shape };
        const anchor = { x: side === 'left' ? area.x : area.x + area.width - 80, y, width: 80, height: 80 };
        pet.setBounds(anchor, false); showAll(); await settle();
        assert.equal(checkPeekColumn(`peek-${side}-${y}`).length, 4);
        for (const id of Object.keys(controllers)) {
          if (!controllers[id].getVisibleBounds()) continue;
          await toggle(id); checkPeekColumn(`peek-${side}-${y}-${id}-expanded`);
          if (controllers[id].getVisibleBounds()) { await toggle(id); assert.equal(checkPeekColumn(`peek-${side}-${y}-${id}-collapsed`).length, 4); }
        }
        assert.deepEqual(pet.getBounds(), anchor, 'peek group must not move the pet');
      }
      for (const side of ['left', 'right']) {
        presentation = { mode: 'peeked', side, shape };
        area = { ...originalArea, height: 150 };
        pet.setBounds({ x: side === 'left' ? area.x : area.x + area.width - 80, y: area.y + 30, width:80, height:80 }, false); await settle();
        assert.equal(check(`peek-${side}-no-room`).length, 0); assert.equal(plan().hidden.length, 4);
        area = originalArea; pet.setBounds({ ...pet.getBounds(), y: area.y+80 }, false); await settle();
        assert.equal(checkPeekColumn(`peek-${side}-room-restored`).length, 4);
      }
      area = { x: originalArea.x, y: originalArea.y, width: Math.min(800,originalArea.width), height: Math.min(560,originalArea.height) };
      for (const side of ['left','right']) for (const offset of [0, Math.round((area.height-80)/2), area.height-80]) {
        presentation = { mode:'peeked', side, shape };
        const anchor={x:side==='left'?area.x:area.x+area.width-80,y:area.y+offset,width:80,height:80};
        pet.setBounds(anchor,false); Object.values(controllers).forEach(c=>c.hide()); showAll(); await settle();
        assert.equal(checkPeekColumn(`small-${side}-${offset}-collapsed`).length,4);
        for(const id of Object.keys(controllers)) {
          await toggle(id);
          assert([0,4].includes(checkPeekColumn(`small-${side}-${offset}-${id}-expanded`).length),'space fallback must keep or hide the whole group');
          Object.values(controllers).forEach(c=>c.hide()); showAll(); await settle();
          assert.equal(checkPeekColumn(`small-${side}-${offset}-${id}-restored`).length,4);
        }
        assert.deepEqual(pet.getBounds(),anchor,'small-screen layout moved pet');
      }
      area = originalArea;
      presentation = { mode: 'peeked', side: 'left', shape };
      pet.setBounds({ x: area.x, y: area.y + 100, width: 80, height: 80 }, false); showAll(); await settle();
      const fadeOrigins = Object.fromEntries(Object.entries(controllers).map(([id,c])=>[id,c.getWindow().getBounds()]));
      presentation = { ...presentation, mode: 'tucked', quotaAnimateHide: true };
      for (const controller of Object.values(controllers)) controller.hide({ animate: true });
      await wait(55);
      for (const [id, controller] of Object.entries(controllers)) {
        const win = controller.getWindow(); assert(win.isVisible(), `${id} exit skipped`);
        assert.deepEqual(win.getBounds(),fadeOrigins[id],`${id} moved during fade`);
        assert(win.getOpacity() > 0 && win.getOpacity() < 1, `${id} did not interpolate opacity`);
      }
      await wait(170);
      for (const controller of Object.values(controllers)) assert.equal(controller.getWindow().isVisible(), false);
      presentation = { ...presentation, mode: 'peeked', quotaAnimateHide: false }; showAll();
      for (const [id, controller] of Object.entries(controllers)) assert(controller.getWindow().getOpacity() < 1, `${id} entry skipped`);
      await wait(55);
      for (const [id, controller] of Object.entries(controllers)) assert(controller.getWindow().getOpacity() > 0 && controller.getWindow().getOpacity() < 1, `${id} entry did not interpolate`);
      await wait(170); check('native-fade-entry-exit');
      presentation = { ...presentation, mode: 'tucked', quotaAnimateHide: true };
      for (const controller of Object.values(controllers)) controller.hide({ animate: true });
      await wait(35); presentation = { ...presentation, mode: 'peeked', quotaAnimateHide: false }; showAll(); await wait(230);
      for (const controller of Object.values(controllers)) assert.equal(controller.getWindow().isVisible(), true, 'stale exit hid a reopened card');
      check('native-fade-rapid-reopen');
      presentation = { ...presentation, mode: 'tucked', quotaAnimateHide: false };
      for (const controller of Object.values(controllers)) controller.hide();
      for (const controller of Object.values(controllers)) assert.equal(controller.getWindow().isVisible(), false, 'safety hide was delayed');
      Object.assign(scope, {
        sendPresentation() {}, stopMotion() {}, dialogue: { dismiss() {} }, bubble: { hide() {} },
        quotaGuard: { close() {}, reposition() {} }, workbuddyDetails: null,
        syncQuotaLabel: showAll, codexCompanion: { getSnapshot() {} },
        syncWorkBuddyLabel: () => presentation.mode === 'tucked'
          ? workbuddy.hide({ animate: presentation.quotaAnimateHide === true })
          : workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } }),
        tickEdgeNotice() {}, pomodoroWindows: { sync() {} }, shortcutWindow: { sync() {}, wakeFromEdge() {} }, refreshTrayMenu() {},
        reportQuotaError: (_name, error) => onError(error)
      });
      const functionSource = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
      Function('scope', 'with(scope){'
        + functionSource("let lastPresentationMode =", '\nfunction edgeRetentionBounds')
        + functionSource('function hideBubble()', '\nfunction repositionBubble')
        + functionSource('function repositionQuotaLabel()', '\nfunction syncApiUsageLabel')
        + ';scope.apply=applyPresentation;}')(scope);
      report.fadeBounds = [];
      for (const side of ['left', 'right']) for (const expanded of [false, true]) {
        presentation = { mode: 'peeked', side, shape };
        pet.setBounds({ x: side === 'left' ? area.x : area.x + area.width - 80, y: area.y + 20, width: 80, height: 80 }, false);
        scope.apply({ ...presentation, suppressed: false }); await settle();
        if (expanded) for (const id of Object.keys(controllers)) await toggle(id);
        assert.equal(check(`fade-origin-${side}-${expanded}`).length, 4);
        const frozen = Object.fromEntries(Object.entries(controllers).map(([id, controller]) => [id, controller.getWindow().getBounds()]));
        presentation = { ...presentation, mode: 'tucked', quotaAnimateHide: true };
        const previousPet = pet.getBounds();
        pet.setBounds({ ...previousPet, x: previousPet.x + (side === 'left' ? 12 : -12), y: previousPet.y + 18 }, false);
        const samples = [];
        const unchanged = stage => {
          for (const [id, controller] of Object.entries(controllers)) {
            const win = controller.getWindow();
            assert.deepEqual(win.getBounds(), frozen[id], `${side}/${expanded}/${stage}: ${id} moved before exit finished`);
            assert.equal(win.nativeVisible(), false);
          }
        };
        // Bubble dismissal and predecessor hide notifications can re-enter every controller
        // before the later cards receive their explicit hide call in main.
        scope.apply({ ...presentation, suppressed: true }); unchanged('main-apply-hideBubble-cascade');
        for (const [id, controller] of Object.entries(controllers)) { controller.reposition(); unchanged(`reposition-${id}`); }
        for (const [id, controller] of Object.entries(controllers)) { controller.hide({ animate: true }); sync(); unchanged(`hide-${id}`); }
        for (let frame = 0; frame < 14; frame++) {
          await wait(16); unchanged(`frame-${frame}`);
          samples.push(Object.fromEntries(Object.entries(controllers).map(([id, controller]) => [id, { bounds: controller.getWindow().getBounds(), visible: controller.getWindow().isVisible(), opacity: controller.getWindow().getOpacity() }])));
        }
        for (const controller of Object.values(controllers)) assert.equal(controller.getWindow().isVisible(), false);
        report.fadeBounds.push({ side, expanded, before: frozen, movedPet: pet.getBounds(), samples });
      }
      report.opacityTransition = { duration: 180, nativeInterpolation: true, realExit: true, rapidReopen: true, immediateSafetyHide: true };
      report.passed = true;
      console.log('COMBINED_LAYOUT_NATIVE_OK', JSON.stringify({ cases: report.cases.length, out }));
    } catch (error) { report.error = error.stack; console.error(error.stack); }
    finally {
      zcode?.close(); api?.destroy(); codex?.destroy(); workbuddy?.destroy();
      for (const win of windows) if (!win.isDestroyed()) win.destroy();
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      app.exit(report.passed ? 0 : 1);
    }
  });
}
