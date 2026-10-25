// Actual packaged controllers/pages, isolated settings and synthetic observations; no account/API/model access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-practice-profile-'));
  const env = { ...process.env, PET_PRACTICE_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, screen, ipcMain } = require('electron');
  const root = process.env.PET_PRACTICE_APP_ROOT || repo;
  const out = process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-practice-artifacts-'));
  const { createZcodeLink } = require(path.join(root, 'desktop-pet/lib/zcode-link'));
  const { createQuotaGuardWindow } = require(path.join(root, 'desktop-pet/lib/quota-guard-window'));
  const { createQuotaLabelWindow } = require(path.join(root, 'desktop-pet/lib/quota-label-window'));
  const { normalizeSettings } = require(path.join(root, 'desktop-pet/lib/settings'));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  app.setPath('userData', process.env.PET_PRACTICE_USER_DATA); app.setActivationPolicy('accessory');
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true }); const report = { passed: false, root, fixture: true, noAccountOrModelAccess: true, checks: [], screenshots: [] };
    let zcode, guard, codex;
    try {
      const area = screen.getPrimaryDisplay().workArea, bounds = { x: area.x + 400, y: area.y + 180, width: 80, height: 80 };
      const pet = { isVisible: () => true, isDestroyed: () => false, getBounds: () => bounds };
      const settings = normalizeSettings({ zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, codexEnabled: false, codexQuotaAlwaysVisible: true, codexQuotaAppearance: 'light' });
      const context = vm.createContext({ settings, quotaGuardSource: 'codex', isQuitting: false, screenLocked: false,
        shortcutWindow: null, chatWindow: null, codexDetails: null, presentationSuppressed: () => false, petWindow: pet,
        quotaLabelModel: () => ({ state: 'ready', items: [{ label: 'Codex', remaining: 64, windowMinutes: 300 }] }) });
      const main = fs.readFileSync(path.join(root, 'desktop-pet/main.js'), 'utf8');
      vm.runInContext(main.slice(main.indexOf('function canShowQuotaGuard()'), main.indexOf('\nasync function openCodexDetailThread')), context);
      const errors = [], onError = error => errors.push(String(error));
      codex = createQuotaLabelWindow({ BrowserWindow, screen, getPetWindow: () => pet, getSize: () => 'compact', getGuardEntry: () => true,
        getSuppressed: () => guard?.isVisible() === true, getAppearance: () => 'light', onError }); context.quotaLabel = codex;
      guard = createQuotaGuardWindow({ BrowserWindow, screen, getAnchor: () => bounds, getAppearance: () => 'light',
        canShow: context.canShowQuotaGuard, onError,
        onVisibilityChange: () => { codex.reposition(); zcode?.reposition(); } }); context.quotaGuard = guard;
      const now = Date.now();
      const bucket = { id: 'zcode:fixture:practice', bucketId: 'zcode:fixture:practice', label: 'GLM-5.3', model: 'GLM-5.3', planName: 'ZCode Start Plan',
        remaining: 1, remainingUnits: 50000, total: 5000000, unit: 'token', periodKind: 'daily', periodStart: now - 3600000, resetsAt: now + 3600000, windowMinutes: 120 };
      const snapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: [bucket] }, history: { available: true, windows: [], results: [] }, tasks: { state: 'unknown', items: [] } };
      zcode = createZcodeLink({ BrowserWindow, screen, ipcMain, getSettings: () => settings, save: patch => Object.assign(settings, patch), getPetWindow: () => pet,
        getPresentation: () => ({ mode: 'free', quotaBottomAligned: true }),
        getSuppressed: () => context.screenLocked || context.isQuitting || context.chatWindow?.isVisible() || Boolean(context.shortcutWindow?.isPresenting()),
        getCardSuppressed: () => guard.isVisible(), getGuardEntry: context.zcodeGuardEntryAvailable,
        onOpenGuard: () => context.openQuotaGuard('zcode'), onChange: () => context.syncZcodeQuotaGuard(), onError,
        createCompanion: () => ({ getSnapshot: () => snapshot, setEnabled: async () => {}, refresh: async () => {}, close() {} }) }); context.zcodeLink = zcode;
      ipcMain.on('pet:quota-guard-close', event => { if (guard.owns(event)) guard.close(); });
      const poll = async (read, check, label) => {
        const until = Date.now() + 7000; let value;
        do { value = await read(); if (check(value)) return value; await wait(30); } while (Date.now() < until);
        throw new Error(`${label}: ${JSON.stringify(value)}`);
      };
      const state = () => guard.getWindow().webContents.executeJavaScript('window.quotaGuardView?.state');
      const click = async (win, selector) => {
        const point = await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(e.hidden||e.disabled)throw Error('disabled target');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await wait(80);
      };
      const capture = async name => {
        const win = guard.getWindow();
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await wait(250);
        win.webContents.invalidate(); await wait(120);
        const text = await win.webContents.executeJavaScript('document.body.innerText');
        fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
        report.screenshots.push({ name, text, state: await state() });
      };
      zcode.sync();
      await poll(() => zcode.getWindow()?.webContents.executeJavaScript('window.quotaGuardEntry?.state').catch(() => null), value => value?.ready && value.visible, 'ZCode entry ready');
      assert.equal(zcode.getWindow().isVisible(), true);
      await click(zcode.getWindow(), '#quota-guard-entry');
      await poll(() => guard.getWindow()?.webContents.executeJavaScript('window.quotaGuardView?.state').catch(() => null), value => value?.spritesReady && value.ready, 'practice opens through native pointer');
      let text = await guard.getWindow().webContents.executeJavaScript('document.body.innerText');
      assert.match(text, /自由练习/); assert.match(text, /独立小游戏，不消耗账户额度/); assert.doesNotMatch(text, /1%|100%|120 分钟/);
      assert.equal((await state()).quota, 100, 'internal practice energy, deliberately independent of fixture 1%');
      assert.equal((await state()).period, null); assert.equal(zcode.getWindow().isVisible(), false, 'card hides during practice');
      await capture('zcode-practice-open');
      const shots = (await state()).clickShots;
      // Auto shots share the original 120ms cooldown with pointer shots.
      for (let attempt = 0; attempt < 4 && (await state()).clickShots === shots; attempt++) {
        await wait(140); await click(guard.getWindow(), '#guard-qiuqiu');
      }
      assert.ok((await state()).clickShots > shots); await click(guard.getWindow(), '#guard-pause');
      assert.equal((await state()).paused, true); const frozen = (await state()).time; await wait(200); assert.equal((await state()).time, frozen);
      await click(guard.getWindow(), '#guard-pause'); await click(guard.getWindow(), '#guard-restart'); assert.equal((await state()).playerHits, 0);
      context.closeCodexQuotaGuard(); assert.equal(guard.isVisible(), true, 'Codex off sync cannot close practice');
      context.syncZcodeQuotaGuard(); assert.equal((await state()).quota, 100); report.checks.push('native entry; source isolation; shooting; pause; restart; card suppressed');
      await click(guard.getWindow(), '#guard-close'); assert.equal(guard.isVisible(), false);
      await poll(() => zcode.getWindow().isVisible(), Boolean, 'card restored');
      for (const [name, trigger, restore] of [
        ['fun-off', () => zcode.setPreference('zcodeQuotaFunEnabled', false), () => zcode.setPreference('zcodeQuotaFunEnabled', true)],
        ['card-off', () => zcode.setPreference('zcodeQuotaAlwaysVisible', false), () => zcode.setPreference('zcodeQuotaAlwaysVisible', true)],
        ['lock', () => { context.screenLocked = true; context.syncZcodeQuotaGuard(); }, () => { context.screenLocked = false; }],
        ['chat', () => { context.chatWindow = { isVisible: () => true }; context.syncZcodeQuotaGuard(); }, () => { context.chatWindow = null; }],
        ['shortcut', () => { context.shortcutWindow = { isPresenting: () => true }; context.syncZcodeQuotaGuard(); }, () => { context.shortcutWindow = null; }]
      ]) {
        assert.equal(context.openQuotaGuard('zcode'), true); trigger(); assert.equal(guard.isVisible(), false, name); restore(); zcode.sync(); report.checks.push(name + ' retracts');
      }
      assert.equal(context.openQuotaGuard('zcode'), true); zcode.openDetails('quota', bucket.id);
      await poll(() => guard.isVisible(), value => value === false, 'detail retracts practice'); zcode.hide(); zcode.sync(); report.checks.push('details retract');
      assert.equal(context.openQuotaGuard('zcode'), true); await zcode.setEnabled(false); assert.equal(guard.isVisible(), false); await zcode.setEnabled(true); report.checks.push('ZCode off retracts');
      settings.codexEnabled = true; codex.show(context.quotaLabelModel());
      await poll(() => codex.isGuardEntryVisible(), Boolean, 'Codex visible entry'); zcode.sync();
      assert.equal(context.openQuotaGuard('zcode'), false, 'visible Codex entry takes priority');
      const entry = await zcode.getWindow().webContents.executeJavaScript('window.quotaGuardEntry.state.visible'); assert.equal(entry, false);
      assert.equal(context.openQuotaGuard(), true); await poll(state, value => value?.ready && value.period === 300, 'original Codex game');
      text = await guard.getWindow().webContents.executeJavaScript('document.body.innerText'); assert.match(text, /64%/); assert.doesNotMatch(text, /自由练习/);
      await capture('codex-original-game'); guard.close(); report.checks.push('dual-source priority; original Codex real-quota game');
      assert.equal(errors.length, 0); report.passed = true;
      zcode.close(); guard.destroy(); codex.destroy();
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log('ZCODE_PRACTICE_NATIVE_OK', JSON.stringify({ checks: report.checks.length, out })); app.exit(0);
    } catch (error) {
      report.error = error.stack; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      zcode?.close(); guard?.destroy(); codex?.destroy(); console.error(error.stack); app.exit(1);
    }
  }).catch(error => { console.error(error.stack); app.exit(1); });
}
