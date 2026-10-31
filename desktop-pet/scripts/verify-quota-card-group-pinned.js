// Native, isolated four-card verification. No real account, settings, or native desktop UI is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-pinned-group-'));
  const env = { ...process.env, PET_PINNED_GROUP_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error); fs.rmSync(data, { recursive: true, force: true }); process.exitCode = 1; });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow: NativeWindow, screen: nativeScreen, ipcMain, session } = require('electron');
  const sourceRoot = path.resolve(process.env.PET_QUOTA_GROUP_SOURCE_ROOT || path.join(__dirname, '../..'));
  const output = path.resolve(process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-pinned-group-artifacts-')));
  const root = name => path.join(sourceRoot, 'desktop-pet', name);
  const { createQuotaLabelWindow } = require(root('lib/quota-label-window'));
  const { createZcodeLink } = require(root('lib/zcode-link'));
  const { createWorkBuddyLabelWindow } = require(root('lib/workbuddy-label-window'));
  const { createApiBalanceLabelWindow } = require(root('lib/api-balance-label-window'));
  const { normalizeSettings } = require(root('lib/settings'));
  const { normalizeQuotaCards, createQuotaCardGroup } = require(root('lib/quota-card-group'));
  const { createQuotaCardGroupWindow } = require(root('lib/quota-card-group-window'));
  const { createQuotaCardGroupTransition } = require(root('lib/quota-card-group-transition'));
  const { createQuotaCardTransitionWindow } = require(root('lib/quota-card-transition-window'));
  const { quotaFreeStackBounds } = require(root('lib/quota-label-placement'));
  const PetFacing = require(root('lib/pet-facing')), SheepTheme = require(root('lib/sheep-theme'));
  const windows = [], errors = [], timings = [], stages = [], requests = [];
  let barPayload = null, barWindow = null, active = null, scope = null, controllers = {}, finishing = false;
  const report = { passed: false, fixture: true, noRealAccountsOrNetwork: true, nativeHostsHidden: true, userVisualAcceptance: false, sourceRoot,
    timingEnvironment: 'HiddenWindow sets backgroundThrottling=false. Durations are isolated verification samples, not a guarantee for the installed app.',
    configuration: { order: ['codex', 'workbuddy', 'zcode', 'api', 'balance'], pinned: ['codex', 'balance'], apiEnabled: false, zcodeQuotaWindows: 0 }, rounds: [], errors, timings, stages };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, label, timeout = 7000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await wait(16); } };
  const record = (stage, extra = {}) => {
    const fixed = Object.fromEntries(['codex', 'balance'].map(id => [id, controllers[id]?.getWindow()?.getBounds()]));
    const value = { stage, round: active?.round, expanded: active?.expanded, elapsed: active ? Date.now() - active.at : null,
      fixed, bar: barPayload && { ...barPayload }, barBounds: scope?.quotaCardGroupWindow?.getBounds(), ...extra };
    stages.push(value);
    if (active && ['capture.begin', 'capture.end', 'overlay.prepare.begin', 'overlay.prepare.end', 'overlay.show.before', 'overlay.animate.end'].includes(stage)) {
      // Entry fixed cards release only when the overlay is shown; exit fixed cards hold until all snapshots retire.
      if (!active.expanded || stage !== 'overlay.animate.end') assert.deepEqual(fixed, active.fixed, stage + ': fixed cards stay at their pre-transition bounds');
      assert.equal(barPayload?.transitioning, true, stage + ': capsule remains hidden during transition');
    }
    return value;
  };
  class HiddenWindow extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } });
      windows.push(this); this.logicalVisible = false; this.nativeVisible = NativeWindow.prototype.isVisible.bind(this);
      const send = this.webContents.send.bind(this.webContents);
      this.webContents.send = (channel, ...args) => { if (channel === 'pet:quota-card-group-state') { barWindow = this; barPayload = { ...args[0] }; } return send(channel, ...args); };
      const load = this.loadFile.bind(this);
      this.loadFile = async (...args) => { const at = Date.now(); try { return await load(...args); } finally { timings.push({ method: 'loadFile', file: path.basename(args[0]), duration: Date.now() - at }); } };
    }
    show() { this.logicalVisible = true; }
    showInactive() { this.logicalVisible = true; }
    hide() { this.logicalVisible = false; super.hide(); }
    isVisible() { return this.logicalVisible; }
  }
  app.setPath('userData', process.env.PET_PINNED_GROUP_USER_DATA);
  app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  const finish = error => {
    if (finishing) return; finishing = true;
    if (error) errors.push(String(error.stack || error));
    active = null;
    scope?.quotaCardGroup?.close(); scope?.quotaCardGroupTransition?.destroy(); scope?.quotaCardGroupWindow?.destroy();
    controllers.zcode?.close(); controllers.codex?.destroy(); controllers.workbuddy?.destroy(); controllers.balance?.destroy();
    for (const win of windows) if (!win.isDestroyed()) { if (win.nativeVisible()) report.nativeHostsHidden = false; win.destroy(); }
    report.cleanup = { allFixtureWindowsDestroyed: windows.every(win => win.isDestroyed()) };
    report.passed = !errors.length && report.rounds.length === 3 && report.nativeHostsHidden && report.cleanup.allFixtureWindowsDestroyed;
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, rounds: report.rounds, errors, output }));
    app.exit(report.passed ? 0 : 1);
  };
  process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
  app.whenReady().then(async () => {
    try {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      const area = nativeScreen.getPrimaryDisplay().workArea;
      const screen = { getDisplayMatching: () => ({ workArea: area, scaleFactor: nativeScreen.getPrimaryDisplay().scaleFactor }), getCursorScreenPoint: () => ({ x: -10000, y: -10000 }) };
      const presentation = { mode: 'free', side: 'left', shape: 'blob' };
      const pet = new HiddenWindow({ x: area.x + 200, y: area.y + 80, width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<title>Isolated pinned quota fixture</title>'); pet.logicalVisible = true;
      const settings = normalizeSettings({ quotaCardOrder: report.configuration.order, quotaCardPinned: report.configuration.pinned,
        codexEnabled: true, codexQuotaAlwaysVisible: true, codexQuotaLabelSize: 'compact', openaiApiAlwaysVisible: false,
        zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaLabelSize: 'compact', workbuddyEnabled: true, workbuddyQuotaAlwaysVisible: true,
        apiBalanceEnabled: true, apiBalanceAlwaysVisible: true, customization: { appearance: { shape: 'blob' } } });
      scope = { settings, petWindow: pet, screen, BrowserWindow: HiddenWindow, ipcMain, normalizeQuotaCards, quotaFreeStackBounds, SheepTheme, PetFacing,
        quotaLabel: null, apiUsageLabel: null, zcodeLink: null, workbuddyLabel: null, apiBalanceLabel: null, weatherWindow: null,
        quotaCardGroup: null, quotaCardGroupWindow: null, quotaCardGroupTransition: null, quotaGroupLastActive: false, quotaGroupWasExpanded: false, quotaTransitionContext: null, quotaCardBarTransitioning: false,
        dragState: null, isQuitting: false, screenLocked: false, pomodoroQuiet: false, shortcutWindow: null, chatWindow: null, apiUsageWindow: null, codexDetails: null, workbuddyDetails: null, apiBalanceDetails: null, quotaGuard: null,
        codexPageEpoch: 0, sheepQuotaInk: null, systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
        edgeTuck: { getPresentation: () => presentation, pin() {} }, presentationSuppressed: () => false,
        quotaDisplayConfig: () => ({ style: 'card', showNumbers: true }), quotaObstacleBounds: () => null,
        currentSheepCapsuleInk: () => null, currentSheepSettledInk: () => null, refreshSheepCapsuleInk() {},
        safelyInvokeWindow: (_label, fn) => fn(), reportQuotaError: (_label, error) => errors.push(String(error.stack || error)),
        codexCompanion: { getSnapshot: () => null }, syncQuotaLabel: () => showAll(),
        createQuotaCardGroup, createQuotaCardGroupWindow,
        createQuotaCardGroupTransition: options => {
          const transition = createQuotaCardGroupTransition({ ...options, createOverlay: () => {
            const overlay = createQuotaCardTransitionWindow(options);
            for (const method of ['prepare', 'animate']) {
              const original = overlay[method];
              overlay[method] = async value => {
                const at = Date.now();
                const beforeDom = method === 'animate' ? await readBar() : null;
                if (beforeDom) assert.equal(beforeDom.visibility, 'hidden', 'real capsule renderer is hidden before animation');
                record('overlay.' + method + '.begin', beforeDom ? { dom: beforeDom } : {});
                try {
                  const result = await original(value);
                  if (method === 'prepare') {
                    const dom = await readBar();
                    assert.equal(dom.visibility, 'hidden', 'real capsule renderer is hidden after overlay preparation');
                    record('overlay.prepare.dom', { dom });
                  }
                  return result;
                } finally {
                  timings.push({ method: 'overlay.' + method, round: active?.round, expanded: active?.expanded, duration: Date.now() - at });
                  record('overlay.' + method + '.end');
                }
              };
            }
            const show = overlay.show; overlay.show = () => { record('overlay.show.before'); return show(); };
            return overlay;
          }});
          const request = transition.request;
          transition.request = input => { const promise = request(input); requests.push(promise); return promise; };
          return transition;
        }
      };
      const main = fs.readFileSync(root('main.js'), 'utf8');
      const helperStart = main.indexOf('function quotaExpandedStackPlan()'), helperEnd = main.indexOf('\nfunction reportQuotaError', helperStart);
      const bootstrapStart = main.indexOf('  quotaCardGroupWindow = createQuotaCardGroupWindow('), bootstrapEnd = main.indexOf('\n  initializeShortcuts();', bootstrapStart);
      assert(helperStart >= 0 && helperEnd > helperStart && bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'owning main source markers exist');
      Function('scope', 'with(scope){' + main.slice(helperStart, helperEnd) + '\n' +
        'scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;scope.collected=quotaCardCollected;scope.syncGroup=syncQuotaCardGroup;' +
        'scope.bootstrap=()=>{' + main.slice(bootstrapStart, bootstrapEnd) + '};}')(scope);
      const forCard = id => { const plan = scope.plan(); return { ...presentation, quotaGroupAnimate: false, quotaAnimateHide: false,
        quotaGroupIndex: settings.quotaCardOrder.indexOf(id), quotaGroupLayout: plan?.cards[id], quotaGroupHidden: scope.collected(id) || plan?.hidden?.includes(id) }; };
      const onLayout = () => scope.sync(), onError = error => errors.push(String(error.stack || error));
      controllers.codex = scope.quotaLabel = createQuotaLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getSize: () => 'compact', getGuardEntry: () => false,
        getPresentation: () => forCard('codex'), onLayout, onError });
      const now = Date.now(), zcodeSnapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: [] }, history: { available: true, windows: [], results: [] }, tasks: { state: 'unknown', items: [] } };
      controllers.zcode = scope.zcodeLink = createZcodeLink({ BrowserWindow: HiddenWindow, screen, ipcMain, getPetWindow: () => pet, getSettings: () => settings, save: patch => Object.assign(settings, patch),
        getSuppressed: () => false, getPresentation: () => ({ ...forCard('zcode'), quotaBottomAligned: true, quotaStackBelow: scope.stack() }),
        getObstacles: () => [], onLayout, createCompanion: () => ({ getSnapshot: () => zcodeSnapshot, setEnabled: async () => {}, refresh: async () => {}, close() {} }), onError });
      controllers.workbuddy = scope.workbuddyLabel = createWorkBuddyLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getGuardEntry: () => false,
        getStackAnchor: () => controllers.zcode.getVisibleBounds() || controllers.codex.getVisibleBounds(), getPresentation: () => forCard('workbuddy'), getObstacles: () => [], onLayout, onError });
      controllers.balance = scope.apiBalanceLabel = createApiBalanceLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet,
        getPresentation: () => forCard('balance'), getStackAnchor: () => controllers.workbuddy.getVisibleBounds(), getObstacles: () => [], onLayout, onError });
      const balanceReport = { available: 44.24, cash: 44.24, voucher: 0, currency: 'CNY', updatedAt: now }, accountId = 'a'.repeat(64);
      function showAll() {
        controllers.codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] });
        controllers.zcode.sync();
        controllers.workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } });
        controllers.balance.show({ enabled: true, status: 'ready', busy: false, accounts: [{ id: accountId, name: '验收账户', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report: balanceReport }], selectedAccountId: accountId, report: balanceReport, history: [], stale: false });
      }
      showAll();
      await until(() => Object.values(controllers).every(c => c.getWindow() && !c.getWindow().webContents.isLoading()), 'four native card renderers loaded');
      scope.bootstrap();
      await scope.quotaCardGroupTransition.warm();
      await until(() => barWindow && !barWindow.webContents.isLoading(), 'capsule renderer loaded');
      scope.syncGroup(); scope.sync();
      await wait(150);
      const readBar = () => barWindow.webContents.executeJavaScript("(()=>{const b=document.getElementById('toggle');return {expanded:b.getAttribute('aria-expanded'),transitioning:b.dataset.transitioning,visibility:getComputedStyle(document.querySelector('.capsule')).visibility}})()");
      for (const [id, controller] of Object.entries(controllers)) {
        const capture = controller.captureGroupTransitionFrames;
        controller.captureGroupTransitionFrames = async () => { const at = Date.now(); record('capture.begin', { id }); try { const frames = await capture(); assert(frames.length > 0); return frames; } finally { timings.push({ method: 'capture', id, round: active?.round, expanded: active?.expanded, duration: Date.now() - at }); record('capture.end', { id }); } };
      }
      assert.deepEqual(scope.quotaCardGroup.getState().eligible, ['codex', 'workbuddy', 'zcode', 'balance']);
      assert.deepEqual(scope.quotaCardGroup.getState().visible, ['codex', 'balance']);
      assert.equal(scope.apiUsageLabel, null);
      for (let round = 1; round <= 3; round++) {
        const result = { round };
        for (const expanded of [true, false]) {
          active = { round, expanded, at: Date.now(), fixed: Object.fromEntries(['codex', 'balance'].map(id => [id, controllers[id].getWindow().getBounds()])) };
          const offset = timings.length, requestOffset = requests.length;
          if (expanded) await barWindow.webContents.executeJavaScript("document.getElementById('toggle').click()");
          else await barWindow.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
          await until(() => requests.length > requestOffset, 'real capsule action requests transition');
          const transitionResult = await requests[requestOffset];
          const duration = Date.now() - active.at;
          assert.equal(transitionResult.ok, true, 'native transition completes');
          assert.equal(scope.quotaCardGroupTransition.isActive(), false);
          await until(async () => { const bar = await readBar(); return bar.expanded === String(expanded) && bar.transitioning === 'false'; }, 'capsule DOM settles');
          const bar = await readBar(); assert.equal(bar.visibility, expanded ? 'hidden' : 'visible');
          assert.deepEqual(scope.quotaCardGroup.getState().visible, expanded ? ['codex', 'workbuddy', 'zcode', 'balance'] : ['codex', 'balance']);
          if (!expanded) {
            const bounds = scope.quotaCardGroupWindow.getBounds(), capsule = { x: bounds.x + 11, y: bounds.y + 6.5, width: 26, height: 7 };
            const faces = ['codex', 'balance'].map(id => controllers[id].getVisibleBounds());
            for (const face of faces) assert(!(capsule.x < face.x + face.width && capsule.x + capsule.width > face.x && capsule.y < face.y + face.height && capsule.y + capsule.height > face.y), 'settled capsule does not overlap fixed cards');
            result.capsule = capsule; result.fixedFaces = faces;
            assert.equal(controllers.zcode.getVisibleBounds(), null); assert.equal(controllers.workbuddy.getVisibleBounds(), null);
          }
          result[expanded ? 'entry' : 'exit'] = { duration, result: transitionResult, bar, timings: timings.slice(offset) };
          active = null; await wait(100);
        }
        report.rounds.push(result);
        console.log('PINNED_GROUP_ROUND_OK ' + JSON.stringify({ round, entry: result.entry.duration, exit: result.exit.duration }));
      }
      finish();
    } catch (error) { finish(error); }
  });
}
