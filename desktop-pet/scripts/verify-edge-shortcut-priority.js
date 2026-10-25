// Native hidden Electron hosts, fixture quota data, and deterministic controller timers.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-shortcut-data-'));
  const env = { ...process.env, PET_EDGE_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const root = process.env.PET_EDGE_SOURCE_ROOT || path.resolve(__dirname, '../..');
  const { createRequire } = require('node:module');
  const { app, BrowserWindow: NativeWindow, screen: nativeScreen, ipcMain, session } = require('electron');
  const local = file => require(path.join(root, 'desktop-pet/lib', file));
  const out = process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'edge-shortcut-artifacts-'));
  const windows = [], errors = [], shows = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check) {
    for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await wait(25); }
    assert.fail('native hidden controller did not finish loading');
  }
  let now = 0, serial = 0;
  const timers = new Map();
  const schedule = (fn, delay = 0) => { const id = ++serial; timers.set(id, { at: now + delay, fn }); return id; };
  const cancel = id => timers.delete(id);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  }
  // Same hidden-native-host contract as verify-combined-layout: no native show/focus calls.
  class HiddenWindow extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false }); this.logicalVisible = false;
      this.nativeVisible = NativeWindow.prototype.isVisible.bind(this); windows.push(this);
    }
    show() { this.logicalVisible = true; shows.push(this); }
    showInactive() { this.show(); }
    focus() {}
    hide() { this.logicalVisible = false; super.hide(); }
    isVisible() { return this.logicalVisible; }
    isFocused() { return false; }
  }
  app.setPath('userData', process.env.PET_EDGE_USER_DATA);
  app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const report = { passed: false, fixture: true, nativeHostsHidden: true, noNetworkOrChat: true, sourceRoot: root, deterministicControllerClock: true, cases: [] };
    let shortcuts, edge, codex, api, zcode, workbuddy;
    try {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_request, done) => done({ cancel: true }));
      const shortcutFile = path.join(root, 'desktop-pet/lib/shortcut-window.js'), moduleValue = { exports: {} };
      Function('require', 'module', '__dirname', 'setTimeout', 'clearTimeout', fs.readFileSync(shortcutFile, 'utf8'))(
        createRequire(shortcutFile), moduleValue, path.dirname(shortcutFile), schedule, cancel);
      const { createShortcutWindow } = moduleValue.exports;
      const area = nativeScreen.getPrimaryDisplay().workArea;
      let cursor = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      const screen = { getDisplayMatching: () => ({ workArea: area }), getCursorScreenPoint: () => cursor };
      const pet = new HiddenWindow({ x: cursor.x, y: cursor.y, width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<body></body>'); pet.logicalVisible = true;
      const settings = local('settings').normalizeSettings({ codexEnabled: true, codexQuotaAlwaysVisible: true, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, workbuddyEnabled: true });
      const presentation = () => ({ ...edge?.getPresentation(), shape: 'blob' });
      const eligible = () => !shortcuts?.isPresenting() && !presentation().suppressed;
      const onError = error => errors.push(String(error.stack || error));
      codex = local('quota-label-window').createQuotaLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getPresentation: presentation, onError });
      api = local('api-usage-label-window').createApiUsageLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getQuotaWindow: () => codex.getWindow(), getPresentation: presentation, onError });
      const timestamp = Date.now();
      const quota = { id: 'zcode:fixture:0', label: 'Fixture', remaining: 75, remainingUnits: 750, total: 1000, unit: 'token', periodKind: 'daily', resetsAt: timestamp + 7200000, windowMinutes: 180 };
      const snapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: timestamp, windows: [quota] }, history: { available: true, windows: [], results: [] }, tasks: { state: 'unknown', items: [] } };
      zcode = local('zcode-link').createZcodeLink({ BrowserWindow: HiddenWindow, screen, ipcMain, getPetWindow: () => pet, getSettings: () => settings,
        save: patch => Object.assign(settings, patch), getPresentation: presentation, getSuppressed: () => !eligible(),
        createCompanion: () => ({ getSnapshot: () => snapshot, setEnabled: async () => {}, refresh: async () => {}, close() {} }), onError });
      workbuddy = local('workbuddy-label-window').createWorkBuddyLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet, getPresentation: presentation, onError });
      const controllers = { codex, api, zcode, workbuddy };
      const apiState = { connected: true, report: { month: '2026-10', updatedAt: timestamp, costs: { month: [{ currency: 'USD', value: 1 }], today: [{ currency: 'USD', value: .1 }] }, usage: { inputTokens: 120, outputTokens: 30, requests: 2 } } };
      function syncAll() {
        if (eligible()) {
          codex.show({ state: 'ready', items: [{ label: '5小时', remaining: 64, windowMinutes: 300 }] });
          api.show(apiState); zcode.sync(); workbuddy.show({ enabled: true, report: { total: 100, basic: 80, reward: 20, purchased: 0 } });
        } else { codex.hide(); api.hide(); zcode.hide(); workbuddy.hide(); }
      }
      const main = fs.readFileSync(path.join(root, 'desktop-pet/main.js'), 'utf8');
      const start = main.indexOf("let lastPresentationMode = 'free'"), end = main.indexOf('\nfunction edgeRetentionBounds()', start);
      assert(start >= 0 && end > start, 'main edge-priority helper must exist');
      const scope = { shortcutWindow: null, screen, quotaLabel: codex, apiUsageLabel: api, zcodeLink: zcode, quotaGuard: { close() {} },
        codexCompanion: { getSnapshot: () => snapshot }, sendPresentation() {}, stopMotion() {}, dialogue: null, hideBubble() {}, safelyInvokeWindow: (_name, fn) => fn(),
        syncQuotaLabel: syncAll, syncWorkBuddyLabel: syncAll, tickEdgeNotice() {}, pomodoroWindows: null, refreshTrayMenu() {} };
      Function('scope', 'with(scope){' + main.slice(start, end) + ';scope.apply=applyPresentation;}')(scope);
      edge = local('edge-tuck').createEdgeTuck({ getWindow: () => pet, getWorkArea: () => area, schedule, cancel,
        getRetentionBounds: () => [], onChange: packet => scope.apply(packet) });
      shortcuts = createShortcutWindow({ BrowserWindow: HiddenWindow, ipcMain, screen, getPetWindow: () => pet, getPresentation: presentation,
        getConfig: () => ({ enabled: true, shape: 'floating' }), getErrors: () => [], save: () => ({ ok: true }), onAction() {}, onRecording() {},
        onPin: value => { syncAll(); edge.pin(value, 'shortcuts'); }, onError });
      scope.shortcutWindow = shortcuts;
      await zcode.start(); syncAll();
      await waitFor(() => Object.values(controllers).every(c => c.getWindow()?.isVisible()));
      const cardVisibility = () => Object.fromEntries(Object.entries(controllers).map(([id, c]) => [id, c.getWindow()?.isVisible() === true]));
      const checkCards = expected => { for (const [id, visible] of Object.entries(cardVisibility())) assert.equal(visible, expected, `${id} visibility`); };
      const checkHidden = () => { for (const win of windows) if (!win.isDestroyed()) assert.equal(win.nativeVisible(), false, 'a native host became visible'); assert.deepEqual(errors, []); };
      const sample = point => { cursor = point; edge.sampleCursor(point); shortcuts.sampleCursor(point); };
      const overPet = side => { const r = pet.getBounds(); return { x: r.x + r.width * (side === 'left' ? .25 : .75), y: r.y + r.height / 2 }; };
      const away = { x: area.x + Math.round(area.width / 2), y: area.y + 10 };
      for (const side of ['left', 'right']) {
        shortcuts.interrupt(); sample(away); edge.dock(side); await wait(220); checkCards(false);
        const count = shows.length; sample(overPet(side));
        assert.equal(edge.getPresentation().mode, 'peeked'); assert.equal(shortcuts.isPresenting(), true);
        assert(shows.slice(count).every(win => win === shortcuts.getWindow()), 'first frame must not display a card before shortcut load'); checkCards(false);
        await waitFor(() => shortcuts.getWindow()?.isVisible()); assert.equal(shortcuts.getWindow().isVisible(), true); checkCards(false);
        advance(1999); assert.equal(shortcuts.isPresenting(), true); checkCards(false);
        advance(1); assert.equal(shortcuts.isPresenting(), false); assert.equal(shortcuts.getWindow().isVisible(), false);
        assert.equal(edge.getPresentation().mode, 'peeked'); checkCards(true);
        for (let i = 0; i < 4; i++) { sample(overPet(side)); advance(700); assert.equal(shortcuts.isPresenting(), false); }
        sample(away); advance(649); assert.equal(edge.getPresentation().mode, 'peeked');
        advance(1); assert.equal(edge.getPresentation().mode, 'tucked'); await wait(220); checkCards(false);
        report.cases.push({ name: `${side}-idle-timeout-and-no-reopen`, at: now, cards: cardVisibility() });
        sample(overPet(side)); await wait(80); assert.equal(shortcuts.isPresenting(), true);
        const { layout } = shortcuts.getState(), item = layout.items[0];
        sample({ x: layout.bounds.x + item.x + item.width / 2, y: layout.bounds.y + item.y + item.height / 2 });
        advance(2500); assert.equal(shortcuts.isPresenting(), true); checkCards(false);
        sample(away); advance(650); assert.equal(shortcuts.isOpen(), false);
        advance(180); assert.equal(shortcuts.isPresenting(), false);
        advance(650); assert.equal(edge.getPresentation().mode, 'tucked'); await wait(220); checkCards(false);
        checkHidden(); report.cases.push({ name: `${side}-button-interaction-retains-and-leave-closes`, at: now });
      }
      edge.restore(); shortcuts.interrupt(); sample(away); const free = pet.getBounds();
      const center = { x: free.x + free.width / 2, y: free.y + free.height / 2 };
      sample(center); advance(449); assert.equal(shortcuts.isOpen(), false);
      advance(1); await wait(80); assert.equal(shortcuts.isOpen(), true);
      advance(2500); assert.equal(shortcuts.isOpen(), true); checkHidden();
      report.cases.push({ name: 'free-mode-retains-450ms-hover-without-edge-timeout', at: now });
      report.passed = true; console.log('EDGE_SHORTCUT_PRIORITY_NATIVE_OK', JSON.stringify({ cases: report.cases.length, out }));
    } catch (error) { report.error = error.stack; console.error(error.stack); }
    finally {
      shortcuts?.dispose(); edge?.dispose(); zcode?.close(); api?.destroy(); codex?.destroy(); workbuddy?.destroy();
      for (const win of windows) if (!win.isDestroyed()) win.destroy();
      fs.writeFileSync(path.join(out, 'edge-shortcut-priority-report.json'), JSON.stringify(report, null, 2));
      app.exit(report.passed ? 0 : 1);
    }
  });
}
