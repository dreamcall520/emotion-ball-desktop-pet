// Actual packaged controllers/pages, isolated settings and synthetic observations; no account/API/model access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-guard-profile-'));
  const env = { ...process.env, PET_GUARD_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, screen, ipcMain } = require('electron');
  const root = process.env.PET_GUARD_APP_ROOT || repo;
  const out = process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-guard-artifacts-'));
  const { createZcodeLink } = require(path.join(root, 'desktop-pet/lib/zcode-link'));
  const { createQuotaGuardWindow } = require(path.join(root, 'desktop-pet/lib/quota-guard-window'));
  const { createQuotaLabelWindow } = require(path.join(root, 'desktop-pet/lib/quota-label-window'));
  const { buildZcodeQuotaLabelModel } = require(path.join(root, 'desktop-pet/lib/zcode-quota-view'));
  const { petVisualBounds } = require(path.join(root, 'desktop-pet/lib/pet-visual-bounds'));
  const { normalizeSettings } = require(path.join(root, 'desktop-pet/lib/settings'));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  app.setPath('userData', process.env.PET_GUARD_USER_DATA); app.setActivationPolicy('accessory');
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true }); const report = { passed: false, root, fixture: true, noAccountOrModelAccess: true, checks: [], positions: [], screenshots: [] };
    let zcode, guard, codex;
    try {
      const area = screen.getPrimaryDisplay().workArea, bounds = { x: area.x + 400, y: area.y + 180, width: 80, height: 80 };
      const pet = { isVisible: () => true, isDestroyed: () => false, getBounds: () => bounds };
      const settings = normalizeSettings({ zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, codexEnabled: false, codexQuotaAlwaysVisible: true, codexQuotaAppearance: 'light' });
      const context = vm.createContext({ settings, quotaGuardSource: 'codex', isQuitting: false, screenLocked: false,
        shortcutWindow: null, chatWindow: null, codexDetails: null, presentationSuppressed: () => false, petWindow: pet,
        buildZcodeQuotaLabelModel, quotaLabelModel: () => ({ state: 'ready', items: [{ label: 'Codex', remaining: 64, windowMinutes: 300 }] }) });
      const main = fs.readFileSync(path.join(root, 'desktop-pet/main.js'), 'utf8');
      vm.runInContext(main.slice(main.indexOf('function canShowQuotaGuard()'), main.indexOf('\nasync function openCodexDetailThread')), context);
      const errors = [], onError = error => errors.push(String(error));
      codex = createQuotaLabelWindow({ BrowserWindow, screen, getPetWindow: () => pet, getSize: () => 'compact', getGuardEntry: () => true,
        getPresentation: () => ({ mode: 'free' }), getSuppressed: () => guard?.isVisible() === true, getAppearance: () => 'light', onError }); context.quotaLabel = codex;
      guard = createQuotaGuardWindow({ BrowserWindow, screen, getAnchor: () => bounds, getAppearance: () => 'light',
        canShow: context.canShowQuotaGuard, onError,
        onVisibilityChange: () => { codex.reposition(); zcode?.reposition(); } }); context.quotaGuard = guard;
      const now = Date.now();
      const bucket = { id: 'zcode:fixture:guard', bucketId: 'zcode:fixture:guard', label: 'GLM-5.3', model: 'GLM-5.3', planName: 'ZCode Start Plan',
        remaining: 1, remainingUnits: 50000, total: 5000000, unit: 'token', periodKind: 'daily', periodStart: now - 3600000, resetsAt: now + 3600000, windowMinutes: 120 };
      const snapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: [bucket] }, history: { available: true, windows: [], results: [] }, tasks: { state: 'unknown', items: [] } };
      zcode = createZcodeLink({ BrowserWindow, screen, ipcMain, getSettings: () => settings, save: patch => Object.assign(settings, patch), getPetWindow: () => pet,
        getPresentation: () => ({ mode: 'free', quotaBottomAligned: true, quotaStackBelow: codex.getVisibleBounds() }),
        getObstacles: () => [codex.getVisibleBounds()].filter(Boolean),
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
      const originalBounds = { ...bounds };
      for (const scene of [
        { name: 'center', x: area.x + area.width/2 - 40, y: area.y + 180 },
        { name: 'left', x: area.x, y: area.y + 180 },
        { name: 'right', x: area.x + area.width - 80, y: area.y + 180 },
        { name: 'bottom', x: area.x + area.width/2 - 40, y: area.y + area.height - 80 }
      ]) {
        Object.assign(bounds, { x: Math.round(scene.x), y: Math.round(scene.y) }); zcode.reposition(); zcode.sync();
        await poll(() => zcode.getWindow()?.webContents.executeJavaScript('window.quotaGuardEntry?.state').catch(() => null), value => value?.ready && value.visible, 'native position entry');
        const win = zcode.getWindow(); await wait(80);
        const geometry = await win.webContents.executeJavaScript(`(()=>{const body=document.body,card=document.getElementById('quota-label'),role=document.getElementById('quota-guard-entry'),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {side:body.dataset.guardSide,insetX:parseFloat(body.style.getPropertyValue('--quota-card-left'))||0,insetY:parseFloat(body.style.getPropertyValue('--quota-card-top'))||0,card:rect(card),role:rect(role)}})()`);
        const native = win.getBounds(); const face = { x:native.x+geometry.insetX, y:native.y+geometry.insetY, width:128, height:32 };
        const visual = petVisualBounds(bounds, undefined, {mode:'free',quotaAnchor:true,quotaGuard:true});
        assert.ok(native.x>=area.x && native.y>=area.y && native.x+native.width<=area.x+area.width && native.y+native.height<=area.y+area.height);
        if(scene.name!=='bottom') assert.equal(face.y,visual.y+visual.height+8,scene.name+' face below');
        else assert.ok(face.y+face.height<=visual.y || face.x+face.width<=visual.x || face.x>=visual.x+visual.width,'bottom fallback avoids pet');
        if(scene.name==='right'){assert.equal(geometry.side,'left');assert.equal(face.x+face.width,area.x+area.width);}
        report.positions.push({name:scene.name,anchor:{...bounds},native,face,geometry});
        fs.writeFileSync(path.join(out,'position-'+scene.name+'.png'),(await win.webContents.capturePage()).toPNG());
      }
      Object.assign(bounds,originalBounds);zcode.reposition();
      zcode.sync();
      await poll(() => zcode.getWindow()?.webContents.executeJavaScript('window.quotaGuardEntry?.state').catch(() => null), value => value?.ready && value.visible, 'ZCode entry ready');
      assert.equal(zcode.getWindow().isVisible(), true);
      await click(zcode.getWindow(), '#quota-label');
      await poll(() => zcode.getWindow().getBounds().height, value => value === 154, 'expanded one-bucket native height');
      await click(zcode.getWindow(), 'button[aria-label="收起额度卡片"]');
      await poll(() => zcode.getWindow().webContents.executeJavaScript('window.quotaGuardEntry?.state.visible'), Boolean, 'collapsed native guard entry returns');
      report.checks.push('native expand/collapse preserves below anchor');
      const initialCardBounds = zcode.getWindow().getBounds();
      await click(zcode.getWindow(), '#quota-guard-entry');
      await poll(() => guard.getWindow()?.webContents.executeJavaScript('window.quotaGuardView?.state').catch(() => null), value => value?.spritesReady && value.ready, 'guard opens through native pointer');
      let text = await guard.getWindow().webContents.executeJavaScript('document.body.innerText');
      assert.match(text, /ZCode/); assert.match(text, /1%/); assert.doesNotMatch(text, /自由练习|能量满满/);
      assert.equal((await state()).quota, 1, 'real first bucket, no placeholder energy');
      assert.equal((await state()).period, 120); assert.equal(zcode.getWindow().isVisible(), false, 'card hides during guard');
      await capture('zcode-guard-one-percent');
      bucket.remaining = 0; bucket.remainingUnits = 0; context.syncZcodeQuotaGuard(); await poll(state, value => value.quota === 0 && value.outcome === 'zombie', 'real zero defeats'); await capture('zcode-guard-zero');
      bucket.remaining = 99.8706; bucket.remainingUnits = 4993530; context.syncZcodeQuotaGuard(); await poll(state, value => value.quota === 99.8706 && !value.outcome, 'real precise balance');
      assert.equal(await guard.getWindow().webContents.executeJavaScript("document.getElementById('guard-number').textContent"),'99.9%'); await capture('zcode-guard-precise');
      const shots = (await state()).clickShots;
      // Auto shots share the original 120ms cooldown with pointer shots.
      for (let attempt = 0; attempt < 4 && (await state()).clickShots === shots; attempt++) {
        await wait(140); await click(guard.getWindow(), '#guard-qiuqiu');
      }
      assert.ok((await state()).clickShots > shots); await click(guard.getWindow(), '#guard-pause');
      assert.equal((await state()).paused, true); const frozen = (await state()).time; await wait(200); assert.equal((await state()).time, frozen);
      await click(guard.getWindow(), '#guard-pause'); await click(guard.getWindow(), '#guard-restart'); assert.equal((await state()).playerHits, 0);
      context.closeCodexQuotaGuard(); assert.equal(guard.isVisible(), true, 'Codex off sync cannot close guard');
      context.syncZcodeQuotaGuard(); assert.equal((await state()).quota, 99.8706); report.checks.push('native entry; source isolation; shooting; pause; restart; card suppressed');
      await click(guard.getWindow(), '#guard-close'); assert.equal(guard.isVisible(), false);
      await poll(() => zcode.getWindow().isVisible(), Boolean, 'card restored');
      assert.deepEqual(zcode.getWindow().getBounds(), initialCardBounds, 'game close restores original card geometry');
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
      await poll(() => guard.isVisible(), value => value === false, 'detail retracts guard'); zcode.hide(); zcode.sync(); report.checks.push('details retract');
      assert.equal(context.openQuotaGuard('zcode'), true); await zcode.setEnabled(false); assert.equal(guard.isVisible(), false); await zcode.setEnabled(true); report.checks.push('ZCode off retracts');
      settings.codexEnabled = true; codex.show(context.quotaLabelModel());
      await poll(() => codex.isGuardEntryVisible(), Boolean, 'Codex visible entry'); zcode.sync();
      const stacked = zcode.getWindow().getBounds(), codexFace = codex.getVisibleBounds();
      assert.equal(stacked.y, codexFace.y + codexFace.height + 8, 'ZCode stacks below the existing Codex card');
      report.stack = { codexFace, zcodeNative: stacked };
      assert.equal(context.openQuotaGuard('zcode'), false, 'visible Codex entry takes priority');
      const entry = await zcode.getWindow().webContents.executeJavaScript('window.quotaGuardEntry.state.visible'); assert.equal(entry, false);
      report.corners = [];
      for (const [name, x, y] of [
        ['top-left', area.x, area.y], ['top-right', area.x + area.width - 80, area.y],
        ['bottom-left', area.x, area.y + area.height - 80], ['bottom-right', area.x + area.width - 80, area.y + area.height - 80]
      ]) {
        Object.assign(bounds, { x, y }); codex.reposition(); await wait(40);
        const originalCodexNative = codex.getWindow().getBounds();
        zcode.reposition(); zcode.sync(); await wait(100);
        const first = codex.getVisibleBounds(), second = zcode.getWindow().getBounds();
        assert.equal(second.x + second.width/2, first.x + first.width/2, name + ' shared center');
        const gap = second.y >= first.y + first.height ? second.y - first.y - first.height : first.y - second.y - second.height;
        assert.equal(gap, 8, name + ' adjacent gap');
        for (const rectangle of [first, second]) assert.ok(rectangle.x >= area.x && rectangle.y >= area.y
          && rectangle.x + rectangle.width <= area.x + area.width && rectangle.y + rectangle.height <= area.y + area.height);
        assert.deepEqual(codex.getWindow().getBounds(), originalCodexNative, 'ZCode never moves the Codex card');
        const file = 'corner-' + name;
        fs.writeFileSync(path.join(out, file + '-codex.png'), (await codex.getWindow().webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(out, file + '-zcode.png'), (await zcode.getWindow().webContents.capturePage()).toPNG());
        const region = { x: Math.min(originalCodexNative.x, second.x), y: Math.min(originalCodexNative.y, second.y),
          right: Math.max(originalCodexNative.x + originalCodexNative.width, second.x + second.width),
          bottom: Math.max(originalCodexNative.y + originalCodexNative.height, second.y + second.height) };
        let pairCapture = null;
        try {
          pairCapture = file + '-pair.png';
          require('node:child_process').execFileSync('/usr/sbin/screencapture', ['-x', '-R',
            `${region.x},${region.y},${region.right-region.x},${region.bottom-region.y}`, path.join(out, pairCapture)], { timeout: 5000 });
        } catch (_) { pairCapture = null; }
        report.corners.push({ name, anchor: { ...bounds }, codexFace: first, zcodeFace: second, gap, file, pairCapture });
      }
      Object.assign(bounds, originalBounds); codex.reposition(); zcode.reposition();
      report.checks.push('four native corners retain adjacent vertically aligned cards without moving Codex');
      assert.equal(context.openQuotaGuard(), true); await poll(state, value => value?.ready && value.period === 300, 'original Codex game');
      text = await guard.getWindow().webContents.executeJavaScript('document.body.innerText'); assert.match(text, /64%/); assert.doesNotMatch(text, /自由练习/);
      await capture('codex-original-game'); guard.close(); report.checks.push('dual-source priority; original Codex real-quota game');
      assert.equal(errors.length, 0); report.passed = true;
      zcode.close(); guard.destroy(); codex.destroy();
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log('ZCODE_GUARD_NATIVE_OK', JSON.stringify({ checks: report.checks.length, out })); app.exit(0);
    } catch (error) {
      report.error = error.stack; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      zcode?.close(); guard?.destroy(); codex?.destroy(); console.error(error.stack); app.exit(1);
    }
  }).catch(error => { console.error(error.stack); app.exit(1); });
}
