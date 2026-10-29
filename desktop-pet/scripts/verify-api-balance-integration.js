// Development-only verification. All account values are fixtures; every native host stays hidden.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-balance-native-'));
  const env = { ...process.env, PET_API_BALANCE_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; fs.rmSync(data, { recursive: true, force: true }); } };
  child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow: NativeWindow, screen: nativeScreen, session } = require('electron');
  const sourceRoot = path.resolve(process.env.PET_API_BALANCE_SOURCE_ROOT || path.resolve(__dirname, '../..'));
  const output = path.resolve(process.env.PET_API_BALANCE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-balance-artifacts-')));
  const ownData = !process.env.PET_API_BALANCE_USER_DATA;
  const data = process.env.PET_API_BALANCE_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-balance-native-'));
  app.setPath('userData', data); app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  const windows = [], errors = [];
  class HiddenWindow extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } });
      this.logicalVisible = false; this.nativeVisible = NativeWindow.prototype.isVisible.bind(this); windows.push(this);
    }
    show() { this.logicalVisible = true; }
    showInactive() { this.logicalVisible = true; }
    hide() { this.logicalVisible = false; super.hide(); }
    isVisible() { return this.logicalVisible; }
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (check, label, timeout = 6000) => {
    const deadline = Date.now() + timeout;
    while (!await check()) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await wait(16); }
  };
  const intersect = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const inside = (bounds, area) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
  const cleanBounds = bounds => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, bounds[key]]));
  const report = { passed: false, fixture: true, accountValues: 'synthetic fixtures only', nativeHostsHidden: true,
    controllerVisibility: 'logical only; native show and showInactive are overridden',
    userVisualAcceptance: false, noRealAccountsOrNetwork: true, sourceRoot, cases: [], errors: [] };
  let controller, details, pet, settling = false;
  const finish = async (code, error) => {
    if (settling) return; settling = true;
    if (error) { report.errors.push(String(error.stack || error)); console.error(error.stack || error); }
    try { details?.destroy(); controller?.destroy(); } catch (cause) { report.errors.push(String(cause)); code = 1; }
    for (const win of windows) if (!win.isDestroyed()) {
      if (win.nativeVisible()) { report.nativeHostsHidden = false; code = 1; }
      win.destroy();
    }
    report.cleanup = { allFixtureWindowsDestroyed: windows.every(win => win.isDestroyed()), controllerReleased: !controller?.getWindow() };
    report.passed = code === 0 && report.cleanup.allFixtureWindowsDestroyed && report.cleanup.controllerReleased;
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (ownData) fs.rmSync(data, { recursive: true, force: true });
    if (report.passed) console.log(`PET_API_BALANCE_INTEGRATION_OK ${output}`);
    app.exit(report.passed ? 0 : 1);
  };
  process.on('uncaughtException', error => { void finish(1, error); });
  process.on('unhandledRejection', error => { void finish(1, error); });
  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(output, { recursive: true });
      const rootFile = name => path.join(sourceRoot, 'desktop-pet', name);
      const { createApiBalanceLabelWindow } = require(rootFile('lib/api-balance-label-window.js'));
      const { createApiBalanceDetailsWindow } = require(rootFile('lib/api-balance-details-window.js'));
      const { quotaFreeStackBounds, quotaLabelSize } = require(rootFile('lib/quota-label-placement.js'));
      report.sourceFiles = Object.fromEntries(['lib/api-balance-label-window.js', 'api-balance-label.html', 'api-balance-label.css', 'api-balance-label-preload.js', 'api-balance-label-renderer.js', 'lib/quota-label-placement.js', 'quota-card-motion.js', 'lib/api-balance-details-window.js', 'api-balance-details.html', 'api-balance-details.css', 'api-balance-details-preload.js', 'api-balance-details-renderer.js', 'api-balance-trend.js', 'quota-trend-curve.js'].map(name =>
        [name, createHash('sha256').update(fs.readFileSync(rootFile(name))).digest('hex')]));
      report.packageVersion = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).version;
      let blockedNetwork = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => { blockedNetwork++; done({ cancel: true }); });
      const area = nativeScreen.getPrimaryDisplay().workArea, order = ['codex', 'api', 'zcode', 'workbuddy', 'balance'];
      report.workArea = area; report.otherCards = 'production compact dimensions used as layout rectangles; their native renderers are outside this script scope';
      assert(area.width >= 400 && area.height >= 500, 'work area must fit five-card fixture without changing display settings');
      const now = Date.now(), firstId = 'a'.repeat(64), secondId = 'b'.repeat(64), unsupportedId = 'c'.repeat(64);
      const firstReport = { available: 44.24, cash: 44.24, voucher: 0, currency: 'CNY', updatedAt: now };
      const secondReport = { available: 8.42, cash: 7, voucher: 1.42, currency: 'CNY', updatedAt: now - 60000 };
      const accounts = [
        { id: firstId, name: '个人账户 · 验收数据', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report: firstReport },
        { id: secondId, name: '工作账户 · 验收数据', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report: secondReport },
        { id: unsupportedId, name: '其他供应商 · 验收数据', provider: 'unknown', supported: false, currency: null, status: 'unsupported', report: null }
      ];
      const histories = {
        [firstId]: [{ at: now - 6 * 86400000, available: 70, cash: 70, voucher: 0 }, { at: now - 3 * 86400000, available: 41, cash: 41, voucher: 0 }, { at: now - 2 * 86400000, available: 55, cash: 55, voucher: 0 }, { at: now, available: 44.24, cash: 44.24, voucher: 0 }],
        [secondId]: [{ at: now - 60000, available: 8.42, cash: 7, voucher: 1.42 }]
      };
      let state, appearance = 'light', presentation = { mode: 'free', side: 'left', shape: 'blob', quotaCardOrder: order }, syncRunning = false;
      const calls = { selections: [], refresh: 0, settings: 0, trend: 0, expanded: [] };
      const choose = id => {
        const account = accounts.find(value => value.id === id); assert(account, 'only fixture account IDs may be selected');
        state = { enabled: true, busy: false, accounts, selectedAccountId: id, status: account.supported ? 'ready' : 'unsupported',
          report: account.report, history: histories[id] || [], stale: false, error: account.supported ? null : 'fixture raw error must not cross IPC',
          errorCode: account.supported ? null : 'UNSUPPORTED_PROVIDER', nextRetryAt: null };
      };
      choose(firstId);
      pet = new HiddenWindow({ width: 80, height: 80, frame: false, transparent: true, skipTaskbar: true });
      await pet.loadURL('data:text/html,<title>Hidden API balance fixture</title>'); pet.logicalVisible = true;
      const screen = { getDisplayMatching: () => ({ workArea: area }) };
      const plan = () => quotaFreeStackBounds(pet.getBounds(), area,
        { ...Object.fromEntries(order.slice(0, 4).map(id => [id, { ...quotaLabelSize('compact'), inset: 2 }])), balance: controller?.getLayoutMetrics() || { width: 128, height: 32, inset: 2 } }, presentation);
      const sync = () => { if (syncRunning) return; syncRunning = true; try { controller?.reposition(); } finally { syncRunning = false; } };
      controller = createApiBalanceLabelWindow({ BrowserWindow: HiddenWindow, screen, getPetWindow: () => pet,
        getAppearance: () => appearance, getStackAnchor: () => plan()?.cards.workbuddy?.face,
        getObstacles: () => Object.entries(plan()?.cards || {}).filter(([id]) => id !== 'balance').map(([, bounds]) => bounds.face),
        getPresentation: () => ({ ...presentation, quotaGroupLayout: plan()?.cards.balance, quotaGroupHidden: plan()?.hidden?.includes('balance'), quotaGroupIndex: 4, quotaReducedMotion: true }),
        onLayout: sync, onExpandedChange: expanded => calls.expanded.push(expanded),
        onSelectAccount: id => { calls.selections.push(id); choose(id); controller.show(state); details.update(state); },
        onTrend: () => { calls.trend++; details.open(state); },
        onRefresh: () => { calls.refresh++; }, onSettings: () => { calls.settings++; details.close(); controller.hide(); },
        onError: error => errors.push(String(error.stack || error)) });
      details = createApiBalanceDetailsWindow({ BrowserWindow: HiddenWindow, screen, getAnchor: () => controller.getVisibleBounds() || pet.getBounds(), getAppearance: () => appearance, onError: error => errors.push(String(error.stack || error)) });
      controller.show(state);
      await until(() => controller.getWindow()?.isVisible(), 'initial API balance controller ready');
      const win = controller.getWindow(), page = code => win.webContents.executeJavaScript(code);
      await until(() => page("typeof window.qiuqiuApiBalanceLabel?.selectAccount === 'function' && document.getElementById('mini-amount').textContent === '¥44.24'"), 'real preload and renderer show fixture');
      const read = () => page(`(()=>{const $=id=>document.getElementById(id),inside=e=>{const r=e.getBoundingClientRect();return r.x>=-.1&&r.y>=-.1&&r.right<=innerWidth+.1&&r.bottom<=innerHeight+.1};return {expanded:$('quota-label').dataset.expanded,amount:$('amount').textContent,compact:$('mini-amount').textContent,health:$('health').textContent,menuHidden:$('account-menu').hidden,theme:document.documentElement.dataset.appearance,inside:inside($('quota-label'))&&($('quota-label').dataset.expanded!=='true'||inside($('full'))),trendDisabled:$('trend').disabled,options:[...$('account-list').children].map(n=>({id:n.dataset.accountId,label:n.textContent,selected:n.getAttribute('aria-selected')}))}})()`);
      // BrowserWindow.setBounds and model IPC may arrive before Chromium's resize.
      // Wait for the actual viewport; do not weaken the containment assertions.
      const paintedSize = async expanded => {
        await until(() => page(`document.getElementById('quota-label').dataset.expanded === '${expanded}' && innerWidth === ${expanded ? 196 : 128} && innerHeight === ${expanded ? 120 : 32}`), 'Chromium viewport matches native card size');
        await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      };
      const click = id => page(`document.getElementById(${JSON.stringify(id)}).click()`);
      const assertHidden = () => { for (const target of windows) if (!target.isDestroyed()) assert.equal(target.nativeVisible(), false, 'native fixture must never be shown'); };
      const inspectLayout = expanded => {
        const stack = plan(); assert(stack && !stack.hidden, 'all five fixture cards fit');
        const native = win.getBounds(), expected = stack.cards.balance, actual = controller.getVisibleBounds();
        assert.deepEqual(cleanBounds(native), cleanBounds(expected), 'real native API bounds consume production group placement');
        assert.equal(native.width, expanded ? 196 : 128); assert.equal(native.height, expanded ? 120 : 32);
        assert(inside(native, area), 'API native bounds remain inside display work area');
        const faces = order.map(id => id === 'balance' ? actual : stack.cards[id].face);
        assert(faces.every(face => inside(face, area)), 'all five visible faces remain in work area');
        for (let a = 0; a < faces.length; a++) for (let b = a + 1; b < faces.length; b++) assert.equal(intersect(faces[a], faces[b]), false, `${order[a]} and ${order[b]} do not overlap`);
        for (const face of faces) assert.equal(intersect(face, pet.getBounds()), false, 'cards do not cover fixture pet');
        assertHidden(); return { native, face: actual, placement: stack.placement, anchors: Object.fromEntries(order.slice(0, 4).map(id => [id, stack.cards[id].face])) };
      };
      const screenshot = async name => {
        let frames;
        for (let count = 0; count < 3; count++) { frames = await controller.captureGroupTransitionFrames(); await page('new Promise(resolve=>requestAnimationFrame(resolve))'); }
        assert.equal(frames.length, 1); assert(frames[0].png.length > 100); fs.writeFileSync(path.join(output, `${name}.png`), frames[0].png);
      };
      for (const mode of ['free', 'peeked']) for (const side of ['left', 'right']) for (const bottom of [false, true]) {
        presentation = { mode, side, shape: 'blob', quotaCardOrder: order, quotaPreferredPlacement: bottom ? 'above' : 'below' };
        pet.setBounds({ x: side === 'left' ? area.x : area.x + area.width - 80, y: bottom ? area.y + area.height - 80 : area.y, width: 80, height: 80 });
        appearance = 'light'; choose(firstId); controller.show(state); controller.resetExpanded(); sync();
        await until(async () => (await read()).expanded === 'false', 'compact state after group reset');
        const compact = inspectLayout(false); assert.equal(compact.placement, bottom ? 'above' : 'below');
        await click('summary'); await until(async () => (await read()).expanded === 'true', 'real expand click');
        await paintedSize(true);
        const expanded = inspectLayout(true), view = await read(); assert.equal(view.inside, true); assert.equal(view.trendDisabled, false);
        await click('trend'); await until(() => details.getWindow()?.isVisible(), 'real trend IPC opens details');
        const detailWin = details.getWindow(), detailPage = code => detailWin.webContents.executeJavaScript(code);
        const detailRead = () => detailPage(`(()=>{const $=id=>document.getElementById(id);return {balance:$('balance').textContent,net:$('net').textContent,week:$('week').getAttribute('aria-pressed'),record:$('record').textContent,points:document.querySelectorAll('#balance-chart .point').length,values:document.querySelectorAll('#balance-chart .value').length,dates:document.querySelectorAll('#balance-chart .date').length,paths:[...document.querySelectorAll('#balance-chart .observed-line')].map(n=>n.getAttribute('d')),empty:$('empty').hidden,theme:document.documentElement.dataset.resolvedAppearance,account:$('account').textContent,status:$('updated').textContent}})()`);
        await until(async () => (await detailRead()).points === 4, 'selected real snapshots enter details');
        assert.equal((await detailRead()).paths.length, 1, 'missing multi-day intervals are not connected');
        assert(inside(detailWin.getBounds(), area), 'details remain in work area');
        await detailPage("document.getElementById('balance-chart').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
        assert.match((await detailRead()).record, /44.24/);
        await detailPage("document.getElementById('today').click()"); assert.equal((await detailRead()).points, 1); assert.equal((await detailRead()).net, '—');
        const callbacksBefore = { refresh: calls.refresh, settings: calls.settings, selections: calls.selections.length };
        const validEvent = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
        win.webContents.emit('ipc-message', { ...validEvent, sender: pet.webContents }, 'pet:api-balance-label-refresh');
        win.webContents.emit('ipc-message', { ...validEvent, senderFrame: pet.webContents.mainFrame }, 'pet:api-balance-label-settings');
        await page("window.qiuqiuApiBalanceLabel.selectAccount('d'.repeat(64));window.qiuqiuApiBalanceLabel.selectAccount('sk-not-an-account');");
        await wait(25); assert.equal(calls.refresh, callbacksBefore.refresh); assert.equal(calls.settings, callbacksBefore.settings); assert.equal(calls.selections.length, callbacksBefore.selections);
        await click('account-toggle'); await until(async () => !(await read()).menuHidden, 'account menu opens');
        const menu = await read(); assert.equal(menu.options.length, 3); assert.match(menu.options[1].label, /8.42/); assert.match(menu.options[2].label, /暂无余额接口/);
        await page(`document.querySelector('[data-account-id="${secondId}"]').click()`);
        await until(async () => (await read()).amount === '8.42' && (await read()).menuHidden, 'real account selection round trip');
        assert.equal(calls.selections.at(-1), secondId);
        await until(async () => (await detailRead()).balance === '¥8.42', 'account switch updates visible details');
        const single = await detailRead(); assert.equal(single.points, 1); assert.equal(single.values, 1); assert.equal(single.dates, 7); assert.equal(single.paths.length, 0); assert.equal(single.week, 'true'); assert.doesNotMatch(single.record, /44.24/);
        details.update({ ...state, history: [] }); await until(async () => (await detailRead()).points === 0, 'empty history clears previous chart');
        assert.equal((await detailRead()).net, '—'); assert.equal((await detailRead()).record, '');
        details.update(state);
        await click('account-toggle'); await page("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        assert.equal((await read()).menuHidden, true, 'Escape closes account popup');
        await click('account-toggle'); await page(`document.querySelector('[data-account-id="${firstId}"]').click()`);
        await until(async () => (await read()).amount === '44.24', 'return to first account');
        await click('refresh'); await until(() => calls.refresh === callbacksBefore.refresh + 1, 'real refresh IPC');
        state = { ...state, busy: true, status: 'loading' }; controller.show(state);
        await page('window.qiuqiuApiBalanceLabel.refresh()'); await wait(25); assert.equal(calls.refresh, callbacksBefore.refresh + 1, 'busy request cannot duplicate refresh');
        choose(firstId); controller.show(state);
        if (mode === 'free' && side === 'left' && !bottom) {
          const captureDetails = async name => {
            await detailPage('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const image = await detailWin.webContents.capturePage(undefined, { stayHidden: true }); fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
          };
          const inspectHelp = async name => {
            await detailPage("document.getElementById('chart-help').open = true");
            const help = await detailPage(`(()=>{const e=document.querySelector('.chart-help-body'),r=e.getBoundingClientRect();const rows=[...e.querySelectorAll('li')];return {inside:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,readable:e.scrollHeight<=e.clientHeight&&rows.every(n=>n.getBoundingClientRect().bottom<=r.bottom),rowCount:rows.length,recordCountVisible:/次余额记录/.test(document.body.textContent),closeVisible:document.getElementById('details-close').getBoundingClientRect().bottom<r.top}})()`);
            assert.equal(help.inside, true, name + ' help stays inside the window');
            assert.equal(help.readable, true, name + ' both notes fit without scrolling');
            assert.equal(help.rowCount, 2, name + ' has only two help items');
            assert.equal(help.recordCountVisible, false, name + ' does not display query counts');
            assert.equal(help.closeVisible, true, name + ' close control remains exposed');
            await captureDetails(name);
            await detailPage("document.getElementById('chart-help').open = false");
          };
          // Daily fixtures exercise the approved curved view; they are never persisted or packaged as account data.
          const daily = Array.from({ length: 7 }, (_, i) => { const date = new Date(now); date.setDate(date.getDate() - 6 + i); return { at: date.getTime(), available: [50.74,49.80,48.95,47.12,46.55,45.10,44.24][i] }; });
          const intraday = daily.flatMap((point, index) => { const start = new Date(point.at); start.setHours(0, 0, 0, 0); return [{ at: Math.max(start.getTime(), point.at - 60000), available: point.available + (index === 0 ? 0 : 1) }, point]; });
          const hasEarlierToday = intraday.at(-2).at < now;
          details.update({ ...state, history: intraday }); await until(async () => (await detailRead()).points === 7, 'fourteen observations become seven daily points');
          assert.equal((await detailRead()).dates, 7, 'week displays seven calendar dates');
          await detailPage("document.getElementById('today').click()");
          assert.equal((await detailRead()).points, hasEarlierToday ? 2 : 1, 'today retains distinct intraday observations, including at midnight');
          assert.equal((await detailRead()).net, hasEarlierToday ? '−¥1.00' : '—'); await captureDetails('trend-today');
          await detailPage("document.getElementById('week').click()");
          assert.match((await detailRead()).paths[0], /C/); assert.equal((await detailRead()).net, '−¥6.50');
          const metrics = await detailPage(`(()=>{const $=id=>document.getElementById(id);const labels=[...document.querySelectorAll('#balance-chart .value')].map(n=>n.getBoundingClientRect());return {primary:getComputedStyle($('balance')).fontSize,secondary:getComputedStyle($('net')).fontSize,chart:$('balance-chart').getBoundingClientRect().height,collision:labels.some((a,i)=>labels.some((b,j)=>i<j&&a.left<b.right&&a.right>b.left))}})()`);
          assert.equal(metrics.primary, '32px'); assert.equal(metrics.secondary, '24px'); assert.equal(metrics.chart, 144); assert.equal(metrics.collision, false);
          await captureDetails('trend-light');
          const equalHistory = daily.slice(-2).map(point => ({ ...point, available: 44.24 }));
          // Exercise real focus CSS while keeping the native fixture window hidden.
          detailWin.webContents.debugger.attach('1.3');
          await detailWin.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
          details.update({ ...state, history: equalHistory });
          await until(async () => (await detailRead()).points === 2, 'two equal daily balances');
          report.interactionChecks = [];
          for (const mode of ['standard', 'accessible']) for (const theme of ['light', 'dark']) for (const width of [404, 320]) {
            detailWin.webContents.send('pet:color-mode', mode, theme, 'blue'); detailWin.setContentSize(width, 363);
            await until(() => detailPage(`innerWidth === ${width} && document.documentElement.dataset.resolvedAppearance === '${theme}'`), 'interaction viewport and theme');
            await detailPage('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const check = await detailPage(`(()=>{const svg=document.getElementById('balance-chart'),r=svg.getBoundingClientRect(),point=svg.querySelector('.point').getBoundingClientRect();
              svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));svg.focus();svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x+point.width/2,clientY:point.y+point.height/2}));
              const pointerOutline=getComputedStyle(svg).outlineWidth,record=document.getElementById('record').textContent;
              svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));const keyboardOutline=getComputedStyle(svg).outlineWidth;
              svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
              const labels=[...svg.querySelectorAll('.value')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect()}));
              return {values:labels.map(e=>e.text),dates:svg.querySelectorAll('.date').length,pointerOutline,keyboardOutline,returnedPointerOutline:getComputedStyle(svg).outlineWidth,record,inside:labels.every(e=>e.rect.left>=r.left&&e.rect.right<=r.right),collision:labels.some((a,i)=>labels.some((b,j)=>i<j&&a.rect.left<b.rect.right&&a.rect.right>b.rect.left))};})()`);
            report.interactionChecks.push({ mode, theme, width, ...check });
            await captureDetails(`equal-balances-${mode}-${theme}-${width}`);
            assert.deepEqual(check.values, ['44.24', '44.24'], 'equal daily balances must both be labelled');
            assert.equal(check.dates, 7, 'all seven dates fit in the weekly chart');
            assert.equal(check.inside, true); assert.equal(check.collision, false);
            assert.equal(check.pointerOutline, '0px', 'pointer click has no chart focus frame');
            assert.notEqual(check.keyboardOutline, '0px', 'keyboard navigation retains a visible focus indication');
            assert.equal(check.returnedPointerOutline, '0px', 'returning to pointer hides keyboard focus frame');
            assert(check.record.startsWith(new Date(equalHistory[0].at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })), 'click still selects the previous day');
          }
          detailWin.webContents.debugger.detach();
          detailWin.webContents.send('pet:color-mode', 'standard', 'light', 'blue'); detailWin.setContentSize(404, 363);
          details.update({ ...state, history: intraday }); await until(() => detailPage('innerWidth === 404'), 'restore weekly chart');
          await inspectHelp('trend-light-help');
          detailWin.setContentSize(320, 363); await until(() => detailPage('innerWidth === 320'), 'narrow details viewport');
          await detailPage('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const narrow = await detailPage(`(()=>{const $=id=>document.getElementById(id),labels=[...document.querySelectorAll('#balance-chart .value,.date')].map(n=>n.getBoundingClientRect());return {body:document.body.scrollWidth,labelsInside:labels.every(r=>r.left>=0&&r.right<=innerWidth),values:document.querySelectorAll('#balance-chart .value').length,toolbar:document.querySelector('.chart-actions').getBoundingClientRect().right}})()`);
          assert.equal(narrow.body, 320); assert.equal(narrow.labelsInside, true); assert(narrow.values <= 3); assert(narrow.toolbar <= 320);
          await inspectHelp('trend-narrow-help'); details.reposition();
          await until(() => detailPage('innerWidth === 404'), 'restore details width');
          await screenshot('light'); appearance = 'dark'; controller.show(state); win.webContents.send('pet:color-mode', 'standard', 'dark', 'blue');
          await until(async () => (await read()).theme === 'dark', 'dark theme from real channel'); await screenshot('dark');
          detailWin.webContents.send('pet:color-mode', 'standard', 'dark', 'blue'); await until(async () => (await detailRead()).theme === 'dark', 'detail dark mode'); await captureDetails('trend-dark');
          details.update({ ...state, stale: true, error: 'private error', errorCode: 'TIMEOUT', history: daily }); await until(async () => (await detailRead()).status === '待更新', 'stale keeps last result'); assert.equal((await detailRead()).balance, '¥44.24'); assert.equal((await detailRead()).points, 7);
          assert.match(await detailPage("document.getElementById('updated').title"), /保留上次成功查询/);
          await inspectHelp('trend-dark-stale-help');
          detailWin.setContentSize(320, 363); await until(() => detailPage('innerWidth === 320'), 'narrow stale details viewport');
          await inspectHelp('trend-dark-narrow-stale-help'); details.reposition();
          await until(() => detailPage('innerWidth === 404'), 'restore stale details width');
          details.update({ ...state, status: 'unauthenticated', errorCode: 'UNAUTHENTICATED' }); await until(async () => (await detailRead()).points === 0, 'invalidated credentials clear prior records'); assert.equal((await detailRead()).balance, '—');
          details.update(state);
          appearance = 'light'; controller.show(state); win.webContents.send('pet:color-mode', 'standard', 'light', 'blue');
          await click('account-toggle'); await screenshot('accounts'); await page("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        }
        await detailPage("document.getElementById('details-close').click()"); await until(() => !details.isVisible(), 'real details close IPC');
        const held = win.getBounds(); controller.setGroupTransitionMode('hold'); controller.resetExpanded(); controller.reposition();
        assert.deepEqual(win.getBounds(), held, 'hold preserves the expanded native origin');
        controller.setGroupTransitionMode('stage'); assert.equal(win.isVisible(), false); assert.equal(win.nativeVisible(), false);
        const staged = await controller.captureGroupTransitionFrames(); assert.equal(staged.length, 1); assert.equal(staged[0].bounds.height, 32);
        controller.setGroupTransitionMode('masked'); await page('window.qiuqiuApiBalanceLabel.settings()'); await wait(25);
        assert.equal(calls.settings, callbacksBefore.settings, 'masked presentation rejects settings IPC');
        controller.setGroupTransitionMode(null); assert.equal(win.isVisible(), true); inspectLayout(false);
        await click('summary'); await until(async () => (await read()).expanded === 'true', 'expand after stage release');
        await click('account-toggle'); await click('account-settings'); await until(() => calls.settings === callbacksBefore.settings + 1 && !win.isVisible(), 'settings entry delegates and card is suppressed');
        assert.equal((await read()).menuHidden, true, 'settings action closes popup before delegation');
        const beforeHidden = calls.refresh; await page('window.qiuqiuApiBalanceLabel.refresh()'); await wait(25); assert.equal(calls.refresh, beforeHidden, 'hidden card cannot invoke refresh');
        controller.show(state); await until(() => win.isVisible(), 'card restores when fixture settings close'); inspectLayout(false);
        await click('summary'); await until(async () => (await read()).expanded === 'true', 'expand before explicit collapse');
        await click('collapse'); await until(async () => (await read()).expanded === 'false', 'real collapse button'); inspectLayout(false);
        assertHidden(); assert.equal(errors.length, 0, errors.join('\n'));
        report.cases.push({ mode, side, vertical: bottom ? 'bottom' : 'top', passed: true, compact, expanded,
          realPreloadAndRenderer: true, detailPreloadAndRenderer: true, detailAccountIsolation: true, emptyAndSingle: true, safeIpc: true, accountSwitch: true, popupEscape: true, settingsDelegationAndRestore: true,
          groupTransitions: ['hold', 'stage', 'masked', 'null'], stageCaptureBytes: staged[0].png.length });
      }
      const beforeCleanup = { ...calls, selections: calls.selections.length, expanded: calls.expanded.length };
      controller.hide(); assert.equal(controller.getLayoutMetrics(), null); assert.equal(controller.getVisibleBounds(), null);
      controller.destroy(); assert.equal(controller.getWindow(), null); assert.equal(win.isDestroyed(), true);
      report.interactions = beforeCleanup; report.network = { blockedAttempts: blockedNetwork, actualRequests: 0 };
      assert.equal(blockedNetwork, 0, 'fixture UI must not try to contact any network service');
      assert.equal(report.cases.length, 8); assertHidden(); await finish(0);
    } catch (error) { await finish(1, error); }
  });
}
