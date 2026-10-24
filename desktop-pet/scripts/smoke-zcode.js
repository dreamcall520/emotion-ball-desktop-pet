// Isolated native renderer acceptance; never loads the application main or its settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const outputDirectory = process.env.PET_ZCODE_SMOKE_OUT || '/Users/allan/Documents/ChatGPT/F03｜球球桌面宠物/验收记录/ZCode联动-20261024/native-ui';
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-zcode-ui-'));
  const env = { ...process.env, PET_ZCODE_SMOKE_USER_DATA: userData, PET_ZCODE_SMOKE_OUT: outputDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [`--user-data-dir=${userData}`, __filename], {
    cwd: path.resolve(__dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const capture = data => { output += data.toString(); process.stdout.write(data); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const timeout = setTimeout(() => child.kill('SIGTERM'), 75000);
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('close', code => {
    clearTimeout(timeout); fs.rmSync(userData, { recursive: true, force: true });
    process.exitCode = code === 0 && output.includes('PET_ZCODE_UI_SMOKE_OK')
      && !/Uncaught|ERR_FILE_NOT_FOUND|did-fail-load/.test(output) ? 0 : 1;
  });
} else {
  const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
  if (!process.env.PET_ZCODE_SMOKE_USER_DATA) throw new Error('Run through node to isolate Electron user data.');
  app.setPath('userData', process.env.PET_ZCODE_SMOKE_USER_DATA);
  app.setActivationPolicy('accessory');
  const fatal = error => { console.error(error?.stack || error); app.exit(1); };
  process.on('uncaughtException', fatal); process.on('unhandledRejection', fatal);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const { createQuotaLabelWindow } = require('../lib/quota-label-window');
  const { createCodexDetailsWindow } = require('../lib/codex-details-window');
  const { buildQuotaLabelModel } = require('../lib/codex-quota-view');
  const { buildZcodeQuotaLabelModel, buildZcodeDetailsModel } = require('../lib/zcode-quota-view');
  const { readZcodeAccount } = require('../lib/zcode-account');
  const { fetchZcodeUsage } = require('../lib/zcode-usage');
  const { createZcodeQuotaHistory } = require('../lib/zcode-quota-history');
  app.whenReady().then(async () => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const report = { ok: false, at: new Date().toISOString(), electron: process.versions.electron,
      isolatedUserData: true, appMainLoaded: false, userSettingsWritten: false, actualModelCalls: 0,
      actualQuotaRead: false, taskFixturesOnly: true, checks: [], screenshots: [], rendererErrors: [] };
    const errors = [], handlers = [], listeners = [];
    let zcode, codex, details, snapshot, appearance = 'light';
    const js = (surface, code) => surface.getWindow().webContents.executeJavaScript(code, true);
    const waitFor = async (surface, code, label) => {
      for (let i = 0; i < 80; i++) { if (surface.getWindow() && await js(surface, code)) return; await delay(40); }
      throw new Error(`Native UI did not reach: ${label}`);
    };
    const capture = async (surface, name) => {
      await delay(120); const file = path.join(outputDirectory, `${name}.png`);
      const image = await surface.getWindow().webContents.capturePage();
      assert.equal(image.isEmpty(), false); fs.writeFileSync(file, image.toPNG()); report.screenshots.push(file);
    };
    const pointer = async (surface, selector, inset = false) => {
      const point = await js(surface, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing pointer target'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + ${inset ? '12' : 'r.width / 2'}), y: Math.round(r.y + ${inset ? '12' : 'r.height / 2'}) }; })()`);
      const web = surface.getWindow().webContents;
      web.sendInputEvent({ type: 'mouseMove', ...point }); await delay(30);
      web.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      web.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await delay(60);
    };
    const observe = surface => {
      const web = surface.getWindow().webContents;
      web.on('console-message', (_event, level, message) => { if (level >= 3) report.rendererErrors.push(message); });
      web.on('did-fail-load', (_event, code, description) => errors.push(`${code} ${description}`));
      web.on('render-process-gone', (_event, details) => errors.push(`renderer ${details.reason}`));
    };
    function on(channel, callback) { ipcMain.on(channel, callback); listeners.push([channel, callback]); }
    const ownsLabel = event => event.sender === zcode.getWindow()?.webContents
      && event.senderFrame === event.sender.mainFrame
      && event.sender.getURL() === pathToFileURL(path.resolve(__dirname, '../quota-label.html')).href;
    const openDetails = (action, bucketId) => {
      const value = buildZcodeDetailsModel(snapshot, { action, bucketId, appearance }, Date.now());
      assert.equal(details.open(value), true); return value;
    };
    try {
      const account = readZcodeAccount(); const usage = await fetchZcodeUsage(account); const now = Date.now();
      assert.equal(usage.state, 'connected'); assert.equal(usage.buckets.length, 4, 'This acceptance requires the four real local balance buckets.');
      report.actualQuotaRead = true;
      report.buckets = usage.buckets.map(({ bucketId, label, planName, total, remainingUnits, remaining, periodKind }) => ({ bucketId, label, planName, total, remainingUnits, remaining, periodKind }));
      const history = createZcodeQuotaHistory({ now: () => now }); history.setAccount(account.accountKey);
      snapshot = { sourceId: 'zcode', enabled: true, generation: 7, quota: { state: 'connected', stale: false, updatedAt: now, windows: usage.buckets },
        tasks: { state: 'unknown', items: [], results: [] }, history: { available: true, windows: [], results: [] } };
      history.record(snapshot); snapshot.history = history.getState(); history.close();
      assert.equal(snapshot.history.windows.length, 4); assert.ok(snapshot.history.windows.every(row => row.samples.length === 1));
      report.checks.push('真实只读 GET 四桶；每桶仅记录本次一条真实采样，无补造历史');
      const area = screen.getPrimaryDisplay().workArea;
      const anchor = { x: Math.round(area.x + area.width * 0.45), y: Math.round(area.y + 110), width: 80, height: 80 };
      const fakePet = bounds => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => bounds });
      nativeTheme.themeSource = 'light';
      zcode = createQuotaLabelWindow({ BrowserWindow, screen, sourceId: 'zcode', getPetWindow: () => fakePet(anchor),
        getAppearance: () => appearance, onError: error => errors.push(error.message), alwaysOnTop: true });
      codex = createQuotaLabelWindow({ BrowserWindow, screen, getPetWindow: () => fakePet({ ...anchor, x: anchor.x - 310 }),
        getAppearance: () => 'light', onError: error => errors.push(error.message), alwaysOnTop: true });
      details = createCodexDetailsWindow({ BrowserWindow, screen, sourceId: 'zcode', getAnchor: () => ({ ...anchor, x: anchor.x + 260 }),
        onError: error => errors.push(error.message) });
      on('pet:zcode-quota-label-detail', (event, action, bucketId) => { assert.equal(ownsLabel(event), true); openDetails(action, bucketId); });
      on('pet:zcode-details-open', (event, action, bucketId) => { assert.equal(details.owns(event), true); openDetails(action, bucketId); });
      on('pet:zcode-details-resize', (event, height) => { assert.equal(details.owns(event), true); details.resize(height); });
      on('pet:zcode-details-close', event => { assert.equal(details.owns(event), true); details.close(); });
      on('pet:zcode-details-thread', event => { assert.equal(details.owns(event), true); });
      ipcMain.handle('pet:zcode-details-read-all', event => { assert.equal(details.owns(event), true); return true; }); handlers.push('pet:zcode-details-read-all');
      const codexModel = buildQuotaLabelModel({ enabled: true, quota: { state: 'connected', stale: false, updatedAt: now,
        windows: [{ id: 'codex:five', label: 'Codex', windowMinutes: 300, remaining: 64, resetsAt: now + 7200000 },
          { id: 'codex:week', label: 'Codex', windowMinutes: 10080, remaining: 87, resetsAt: now + 172800000 }] } }, {}, now);
      zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now)); codex.show(codexModel);
      observe(zcode); observe(codex);
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '4' && document.querySelector('#quota-label').dataset.expanded === 'false'", 'four collapsed buckets');
      await waitFor(codex, "document.querySelector('#quota-label').dataset.source === 'codex'", 'independent Codex card');
      const originalCodex = await js(codex, "document.querySelector('#quota-label').outerHTML");
      assert.equal(await js(zcode, "document.querySelector('#quota-label').dataset.source"), 'zcode');
      const collapsedRows = await js(zcode, `Array.from(document.querySelectorAll('#items li'), row => { const name = row.querySelector('.quota-name'), badge = row.querySelector('.quota-period'), value = row.querySelector('.quota-value'); return { name: name.textContent, badge: badge.textContent, nameWidth: name.clientWidth, nameScrollWidth: name.scrollWidth, nameRight: name.getBoundingClientRect().right, badgeLeft: badge.getBoundingClientRect().left, badgeRight: badge.getBoundingClientRect().right, valueLeft: value.getBoundingClientRect().left, valueRight: value.getBoundingClientRect().right, rowRight: row.getBoundingClientRect().right }; })`);
      report.collapsedRows = collapsedRows;
      assert.equal(new Set(collapsedRows.map(row => `${row.badge}:${row.name}`)).size, 4);
      assert.ok(collapsedRows.every(row => row.nameRight <= row.badgeLeft && row.badgeRight <= row.valueLeft), 'Collapsed model/source/percent must not overlap.');
      assert.ok(collapsedRows.every(row => row.valueRight <= row.rowRight), 'Collapsed percentages must remain inside each row.');
      assert.ok(collapsedRows.every(row => row.nameScrollWidth <= row.nameWidth), 'Collapsed model names must remain readable.');
      await capture(zcode, '01-zcode-collapsed-light');
      await pointer(zcode, '#quota-label', true);
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.expanded === 'true' && document.querySelectorAll('.v20-period').length === 4", 'expanded four buckets');
      const bucketText = await js(zcode, "[...document.querySelectorAll('.v20-period')].map(el => el.innerText)");
      assert.ok(bucketText.every(value => /GLM-5\.3/.test(value)));
      assert.equal(new Set(bucketText).size, 4, 'Same-model entitlements must remain visually distinguishable.');
      const expandedBounds = await js(zcode, `(() => { const footer = document.querySelector('.v20-links').getBoundingClientRect(); const label = document.querySelector('#quota-label').getBoundingClientRect(); return { innerWidth, innerHeight, footer: footer.toJSON(), label: label.toJSON() }; })()`);
      report.expandedBounds = expandedBounds;
      assert.ok(expandedBounds.footer.bottom <= expandedBounds.innerHeight - 1, 'Expanded task/trend links must fit inside the native window.');
      assert.ok(expandedBounds.footer.right <= expandedBounds.innerWidth, 'Expanded footer must not overflow horizontally.');
      report.expandedBucketText = bucketText;
      await capture(zcode, '02-zcode-expanded-light');
      zcode.show(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, windows: usage.buckets.slice(0, 2) } }, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '2' && document.querySelector('#quota-label').dataset.expanded === 'true'", 'two bucket expanded fixture');
      const dualBounds = await js(zcode, `(() => { const footer = document.querySelector('.v20-links').getBoundingClientRect(); return { innerWidth, innerHeight, footer: footer.toJSON() }; })()`);
      report.twoBucketFixtureBounds = dualBounds;
      assert.ok(dualBounds.footer.bottom <= dualBounds.innerHeight - 1, 'Two-bucket ZCode footer must also fit.');
      await capture(zcode, '09-zcode-two-bucket-fixture-light');
      const single = { ...usage.buckets[1], planName: `${usage.buckets[1].planName} · 超长套餐名称验收夹具`.repeat(3) };
      zcode.show(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, windows: [single] } }, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '1' && document.querySelector('#quota-label').dataset.expanded === 'true'", 'single bucket long title fixture');
      const singleBounds = await js(zcode, `(() => { const brand = document.querySelector('.v20-brand').getBoundingClientRect(), pill = document.querySelector('.v20-brand .period-pill').getBoundingClientRect(), tools = document.querySelector('.v20-header-tools').getBoundingClientRect(), footer = document.querySelector('.v20-links').getBoundingClientRect(); return { innerWidth, innerHeight, brand: brand.toJSON(), pill: pill.toJSON(), tools: tools.toJSON(), footer: footer.toJSON() }; })()`);
      report.singleBucketFixtureBounds = singleBounds;
      assert.ok(singleBounds.pill.right <= singleBounds.tools.left, 'Single-bucket plan pill must shrink inside its header.');
      assert.ok(singleBounds.brand.right <= singleBounds.tools.left, 'Single-bucket plan header must not overlap controls.');
      assert.ok(singleBounds.tools.right <= singleBounds.innerWidth && singleBounds.footer.bottom < singleBounds.innerHeight, 'Single-bucket header and footer must remain inside native bounds.');
      await capture(zcode, '10-zcode-single-long-title-fixture-light');
      zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '4'", 'restore real four buckets');
      report.checks.push('原生指针点击折叠/展开；四桶保留且同名模型来源可区分');
      await pointer(zcode, '[data-action="quota"]');
      await waitFor(details, "document.querySelectorAll('.zcode-quota-bucket').length === 4 && document.querySelector('#details-panel').dataset.source === 'zcode'", 'four quota details');
      observe(details);
      const detailsText = await js(details, "document.querySelector('#details-content').innerText");
      for (const row of usage.buckets) assert.ok(detailsText.includes(row.total.toLocaleString('en-US')));
      assert.ok(detailsText.includes('到期') && detailsText.includes('刷新'));
      assert.equal(details.owns({ sender: codex.getWindow().webContents, senderFrame: codex.getWindow().webContents.mainFrame }), false);
      await capture(details, '03-zcode-quota-details-light');
      report.checks.push('同源 IPC 打开额度明细；四份真实总量及到期/刷新分别显示；错误窗口身份不被拥有');
      await pointer(details, '.zcode-quota-bucket .reset-link');
      await waitFor(details, "document.querySelectorAll('.trend-tabs button').length === 4", 'four bucket trend tabs');
      const tabs = await js(details, "[...document.querySelectorAll('.trend-tabs button')].map(el => ({ id: el.dataset.period, text: el.innerText }))");
      assert.equal(new Set(tabs.map(row => row.id)).size, 4); assert.equal(new Set(tabs.map(row => row.text)).size, 4);
      report.trendTabs = tabs;
      for (const tab of tabs) {
        await pointer(details, `.trend-tabs button[data-period=${JSON.stringify(tab.id)}]`);
        await waitFor(details, `document.querySelector('.trend-tabs [aria-pressed="true"]')?.dataset.period === ${JSON.stringify(tab.id)}`, 'selected bucket trend');
        assert.equal(details.getPeriod(), tab.id);
      }
      await capture(details, '04-zcode-trend-last-bucket-light');
      report.checks.push('四桶趋势逐一通过原生指针切换；bucketId 独立且只画真实采样');
      openDetails('tasks', usage.buckets[0].id);
      await waitFor(details, "document.querySelector('.empty-state')?.textContent === '暂未提供'", 'unknown task state');
      await capture(details, '05-zcode-tasks-unknown');
      snapshot = { ...snapshot, tasks: { state: 'connected', items: [{ id: 'fixture-active', title: '验收夹具：进行中任务', state: 'active', updatedAt: now }], results: [] } };
      appearance = 'dark'; nativeTheme.themeSource = 'dark';
      zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
      openDetails('tasks', usage.buckets[0].id);
      await waitFor(details, "document.querySelector('.activity-item b')?.textContent === '验收夹具：进行中任务'", 'active task fixture');
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.appearance === 'dark' || document.documentElement.dataset.appearance === 'dark'", 'dark appearance');
      await capture(details, '06-zcode-tasks-active-fixture-dark');
      await capture(zcode, '07-zcode-expanded-dark');
      snapshot = { ...snapshot, tasks: { state: 'connected', items: [], results: [] } };
      openDetails('tasks', usage.buckets[0].id);
      await waitFor(details, "document.querySelector('.empty-state')?.textContent === '暂无进行中任务'", 'known empty task fixture');
      report.checks.push('任务 unknown 明确暂未提供；active/已知空态用显式夹具验证；浅色和深色原生渲染');
      const before = await js(zcode, "document.querySelector('#quota-label').outerHTML");
      zcode.getWindow().webContents.send('pet:quota-label', { state: 'ready', items: [{ label: 'WRONG_SOURCE', remaining: 1, windowMinutes: 300 }] });
      codex.getWindow().webContents.send('pet:zcode-quota-label', { sourceId: 'zcode', state: 'ready', items: [] });
      details.getWindow().webContents.send('pet:codex-details', { action: 'tasks', tasks: [{ id: 'wrong', title: 'WRONG_SOURCE', state: 'active' }] });
      await delay(100);
      assert.equal(await js(zcode, "document.querySelector('#quota-label').outerHTML"), before);
      assert.equal(await js(codex, "document.querySelector('#quota-label').outerHTML"), originalCodex);
      assert.equal(await js(details, "document.body.innerText.includes('WRONG_SOURCE')"), false);
      assert.equal(await js(zcode, "typeof require"), 'undefined');
      await capture(codex, '08-codex-card-unchanged');
      report.checks.push('真实 preload 忽略另一来源频道；隔离 renderer 无 require；ZCode 操作全过程 Codex 卡内容不变');
      assert.deepEqual(errors, []); assert.deepEqual(report.rendererErrors, []);
      report.ok = true;
      for (const name of ['failure-zcode.png', 'failure-details.png']) {
        try { fs.unlinkSync(path.join(outputDirectory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`PET_ZCODE_UI_SMOKE_OK ${JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, report: path.join(outputDirectory, 'report.json') })}`);
    } catch (error) {
      report.error = error?.stack || String(error); report.errors = errors;
      for (const [name, surface] of [['failure-zcode', zcode], ['failure-details', details]]) if (surface?.getWindow()) {
        try { await capture(surface, name); } catch (_ignored) {}
      }
      fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      throw error;
    } finally {
      for (const [channel, callback] of listeners) ipcMain.removeListener(channel, callback);
      handlers.forEach(channel => ipcMain.removeHandler(channel));
      details?.destroy(); zcode?.destroy(); codex?.destroy();
    }
    app.quit();
  }).catch(fatal);
}
