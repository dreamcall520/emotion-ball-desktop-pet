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
    let zcode, codex, details, snapshot, appearance = 'light', size = 'standard', sameAnchor = false, stackEnabled = false;
    const js = (surface, code) => surface.getWindow().webContents.executeJavaScript(code, true);
    const waitFor = async (surface, code, label) => {
      for (let i = 0; i < 80; i++) { if (surface.getWindow() && surface.isVisible?.() !== false && await js(surface, code)) return; await delay(40); }
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
        getAppearance: () => appearance, getSize: () => size,
        getObstacle: () => stackEnabled ? codex?.getVisibleBounds() : null,
        getPresentation: () => ({ quotaBottomAligned: true, quotaStackBelow: stackEnabled ? codex?.getVisibleBounds() : null, quotaObstacles: stackEnabled ? [codex?.getVisibleBounds()].filter(Boolean) : [] }), onError: error => errors.push(error.message), alwaysOnTop: true });
      codex = createQuotaLabelWindow({ BrowserWindow, screen, getPetWindow: () => fakePet(sameAnchor ? anchor : { ...anchor, x: anchor.x - 310 }),
        getAppearance: () => 'light', getSize: () => size, onError: error => errors.push(error.message), alwaysOnTop: true });
      details = createCodexDetailsWindow({ BrowserWindow, screen, sourceId: 'zcode', getAnchor: () => ({ ...anchor, x: anchor.x + 260 }),
        onError: error => errors.push(error.message) });
      on('pet:zcode-quota-label-detail', (event, action, bucketId) => { assert.equal(ownsLabel(event), true); (report.detailIpc ||= []).push({action,bucketId}); openDetails(action, bucketId); });
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
      if (process.env.PET_ZCODE_SMOKE_COMPACT_ONLY === '1') {
        size = 'compact'; report.compactMatrix = []; report.visualValueFixturesOnly = true;
        const measure = () => js(zcode, `(() => { const summary=document.querySelector('#summary'),badge=summary.querySelector('.summary-badge'),label=summary.querySelector('.summary-period-label'),value=summary.querySelector('.summary-value'); return {innerWidth,innerHeight,summary:summary.getBoundingClientRect().toJSON(),badge:{text:badge.textContent,rect:badge.getBoundingClientRect().toJSON()},label:{text:label.textContent,width:label.clientWidth,scrollWidth:label.scrollWidth,font:parseFloat(getComputedStyle(label).fontSize),rect:label.getBoundingClientRect().toJSON()},value:{text:value.textContent,width:value.clientWidth,scrollWidth:value.scrollWidth,font:parseFloat(getComputedStyle(value).fontSize),rect:value.getBoundingClientRect().toJSON()}}; })()`);
        for(const [remaining,expected] of [[100,'100%'],[99.9,'99.9%'],[99.99,'<100%'],[.01,'<0.1%']]) for(const theme of ['light','dark']) {
          appearance=theme; nativeTheme.themeSource=theme;
          const fixture={...snapshot,quota:{...snapshot.quota,windows:snapshot.quota.windows.map((row,i)=>i===0?{...row,remaining}:row)}};
          zcode.show(buildZcodeQuotaLabelModel(fixture,{},now));
          await waitFor(zcode,`document.querySelector('#quota-label').dataset.size === 'compact' && document.querySelector('.summary-value').textContent === ${JSON.stringify(expected)} && document.documentElement.dataset.appearance === '${theme}'`,'compact percentage matrix');
          const value=await measure();
          assert.equal(value.innerWidth,128); assert.equal(value.label.text,'额度'); assert.equal(value.badge.text,'Z'); assert.equal(value.value.text,expected);
          assert.ok(value.label.font>=10 && value.value.font>=14,'Keep the label readable and percentage near the established size.');
          assert.ok(value.label.width>=20 && value.label.scrollWidth<=value.label.width,'Both visible quota-label characters must fit without ellipsis.');
          assert.ok(value.value.scrollWidth<=value.value.width && value.value.rect.right<=value.summary.right,'Entire percentage must remain inside its native card.');
          assert.ok(value.badge.rect.right<=value.label.rect.left && value.label.rect.right<=value.value.rect.left,'Badge, quota label and percent must not overlap.');
          report.compactMatrix.push({remaining,theme,...value}); await capture(zcode,`compact-${String(remaining).replace('.','p')}-${theme}`);
        }
        sameAnchor=true;stackEnabled=true;appearance='light';nativeTheme.themeSource='light';
        anchor.x=area.x+area.width-82;anchor.y=area.y+area.height-82;
        codex.show(codexModel);codex.reposition();
        zcode.show(buildZcodeQuotaLabelModel({...snapshot,quota:{...snapshot.quota,windows:snapshot.quota.windows.map((row,i)=>i===0?{...row,remaining:99.9}:row)}},{},now));zcode.reposition(); await delay(100);
        const z=zcode.getVisibleBounds(),c=codex.getVisibleBounds(),overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
        assert.ok(z.x>=area.x && z.y>=area.y && z.x+z.width<=area.x+area.width && z.y+z.height<=area.y+area.height);assert.equal(overlap(z,c),false);assert.equal(overlap(z,anchor),false);
        const corner=await measure();assert.equal(corner.label.width,corner.label.scrollWidth);assert.equal(corner.value.text,'99.9%');
        report.compactCorner={zcode:z,codex:c,geometry:corner};await capture(zcode,'corner-bottom-right-zcode');
        assert.deepEqual(errors,[]);assert.deepEqual(report.rendererErrors,[]);report.ok=true;
        report.checks.push('128px真实窗口×100/99.9/<100/<0.1浅深8组：Z/额度/百分比完整可见、不重叠；右下双卡不遮挡且可见');
        for(const name of ['failure-zcode.png','failure-details.png']) {try {fs.unlinkSync(path.join(outputDirectory,name));} catch(error) {if(error.code!=='ENOENT') throw error;}}
        fs.writeFileSync(path.join(outputDirectory,'report.json'),`${JSON.stringify(report,null,2)}\n`);console.log(`PET_ZCODE_UI_SMOKE_OK ${JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,report:path.join(outputDirectory,'report.json')})}`);app.quit();return;
      }
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
      const checkTimeLabels = async theme => {
        const rows = await js(zcode, `[...document.querySelectorAll('.v20-reset')].map(el => { const text = el.querySelector('span'); return { text:text.textContent, title:el.title, clientWidth:text.clientWidth, scrollWidth:text.scrollWidth }; })`);
        assert.equal(rows.length, 4);
        assert.ok(rows.every(row => row.clientWidth > 0 && row.scrollWidth <= row.clientWidth), 'Every visible deadline label must fit without ellipsis.');
        assert.ok(rows.every(row => /(?:到期|刷新)$/.test(row.text)), 'Visible labels must preserve expiry/refresh semantics.');
        assert.ok(rows.every(row => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(row.title)), 'Hover title must retain the exact local date and time.');
        (report.timeLabels ||= {})[theme] = rows;
      };
      await checkTimeLabels('light');
      if (process.env.PET_ZCODE_SMOKE_SOURCE_ONLY === '1' || process.env.PET_ZCODE_SMOKE_GROUP_ONLY === '1') {
        report.sourceMatrix = [];
        for(const count of (process.env.PET_ZCODE_SMOKE_GROUP_ONLY === '1' ? [4] : [1,2,4])) for(const theme of ['light','dark']) {
          appearance = theme; nativeTheme.themeSource = theme;
          const buckets = usage.buckets.slice(0,count);
          zcode.show(buildZcodeQuotaLabelModel({...snapshot,quota:{...snapshot.quota,windows:buckets}}, {}, now));
          await waitFor(zcode, `document.querySelector('#quota-label').dataset.itemCount === '${count}' && document.documentElement.dataset.appearance === '${theme}'`, 'source row matrix');
          const rows = await js(zcode, `[...document.querySelectorAll('.v20-period')].map(el => { const source=el.querySelector('.v20-plan-name'), model=el.querySelector('.v20-cell-label .period-pill'), time=el.querySelector('.v20-reset > span'), value=el.querySelector('.v20-value'), heading=el.querySelector('.v20-cell-label'); return { bucketId:el.dataset.period, source:source.textContent, sourceHeight:source.clientHeight, sourceScrollHeight:source.scrollHeight, sourceWidth:source.clientWidth, sourceScrollWidth:source.scrollWidth, sourceRect:source.getBoundingClientRect().toJSON(), sourceLineHeight:parseFloat(getComputedStyle(source).lineHeight), model:model.textContent, modelRect:model.getBoundingClientRect().toJSON(), headingRect:heading.getBoundingClientRect().toJSON(), valueRect:value.getBoundingClientRect().toJSON(), value:value.textContent, valueWidth:value.clientWidth,valueScrollWidth:value.scrollWidth,time:time.textContent,timeWidth:time.clientWidth,timeScrollWidth:time.scrollWidth }; })`);
          assert.equal(rows.length,count);
          if(count === 4) {
            assert.deepEqual(rows.map(row=>row.source),['每日体验','每日体验','1024活动','1024活动']);
            assert.deepEqual(rows.map(row=>row.model),['GLM-5.3','GLM-5.3-Flash','GLM-5.3','GLM-5.3-Flash']);
            assert.deepEqual(report.collapsedRows.map(row=>row.badge),rows.map(row=>row.source),'Collapsed and expanded source groups must match.');
            for(const index of [1,3]) {
              const before=report.detailIpc?.length || 0;
              await pointer(zcode, `.v20-periods > button.v20-period:nth-child(${index+1})`);
              await waitFor(details, `document.querySelector('.zcode-bucket-button[aria-pressed="true"]')?.dataset.bucketOption === ${JSON.stringify(rows[index].bucketId)}`, 'grouped bucket trend IPC');
              assert.equal(report.detailIpc.length,before+1,'One pointer click must send exactly one detail IPC.');
              assert.deepEqual(report.detailIpc.at(-1),{action:'trend',bucketId:rows[index].bucketId});
              assert.equal(details.getPeriod(),rows[index].bucketId); details.close();
            }
          }

          for(const row of rows) {
            assert.ok(['每日体验','1024活动'].includes(row.source), 'Known local plans must use complete Chinese source labels.');
            assert.ok(row.sourceScrollHeight <= row.sourceHeight && row.sourceHeight >= row.sourceLineHeight, 'Source line must retain its complete line height.');
            assert.ok(row.sourceScrollWidth <= row.sourceWidth, 'Source label must not ellipsize.');
            assert.ok(count === 1 ? row.sourceRect.right <= row.modelRect.left : row.sourceRect.bottom <= row.modelRect.top, 'Source and model labels must not overlap.');
            assert.ok(row.headingRect.bottom <= row.valueRect.top, 'Heading must not collide with the percentage.');
            assert.ok(row.timeScrollWidth <= row.timeWidth && /(?:到期|刷新)$/.test(row.time), 'Deadline remains complete.');
            assert.ok(row.valueScrollWidth <= row.valueWidth, 'Percentage must remain complete.');
          }
          const footer = await js(zcode, `(() => {const entry=document.querySelector('.v20-quota-entry'),shared=document.querySelector('.v20-shared'),links=document.querySelector('.v20-links');return {text:entry.textContent,entry:entry.getBoundingClientRect().toJSON(),shared:shared.getBoundingClientRect().toJSON(),links:links.getBoundingClientRect().toJSON(),height:innerHeight};})()`);
          assert.equal(footer.text,'查看额度明细›'); assert.ok(footer.entry.width >= footer.shared.width-1);
          assert.ok(footer.links.bottom < footer.height, 'Independent footer actions stay inside the card.');
          await capture(zcode, `card-${count}-${theme}`);
          await pointer(zcode,'.v20-quota-entry');
          await waitFor(details, `document.querySelectorAll('button.zcode-quota-row').length === ${usage.buckets.length}`, 'quota entry IPC');
          assert.equal(details.getAction(),'quota'); assert.deepEqual(report.detailIpc.at(-1),{action:'quota',bucketId:buckets[0].bucketId});
          assert.equal(await js(zcode, "document.querySelector('#quota-label').dataset.expanded"),'true'); details.close();
          report.sourceMatrix.push({count,theme,rows,footer,quotaIpc:true});
        }
        assert.equal(await js(codex, "document.querySelector('#quota-label').outerHTML"),originalCodex);
        assert.deepEqual(errors, []); assert.deepEqual(report.rendererErrors, []);
        report.ok = true; report.sourceOnly = true; report.groupOnly = process.env.PET_ZCODE_SMOKE_GROUP_ONLY === '1';
        for (const name of ['failure-zcode.png','failure-details.png']) {try {fs.unlinkSync(path.join(outputDirectory,name));} catch(error) {if(error.code !== 'ENOENT') throw error;}}
        report.checks.push('1/2/4桶浅深来源行完整、与模型/百分比不重叠；短时间到期/刷新完整；整行查看额度明细真实IPC打开quota；Codex不变');
        fs.writeFileSync(path.join(outputDirectory,'report.json'), `${JSON.stringify(report,null,2)}\n`);
        console.log(`PET_ZCODE_UI_SMOKE_OK ${JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,report:path.join(outputDirectory,'report.json')})}`);
        app.quit(); return;
      }
      if (process.env.PET_ZCODE_SMOKE_TIME_ONLY === '1') {
        appearance = 'dark'; nativeTheme.themeSource = 'dark';
        zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
        await waitFor(zcode, "document.documentElement.dataset.appearance === 'dark'", 'short time dark appearance');
        await checkTimeLabels('dark'); await capture(zcode, '07-zcode-expanded-dark');
        assert.equal(await js(codex, "document.querySelector('#quota-label').outerHTML"), originalCodex);
        assert.deepEqual(errors, []); assert.deepEqual(report.rendererErrors, []);
        report.ok = true; report.timeOnly = true;
        report.checks.push('四桶展开浅深：可见时间全部无截断且保留刷新/到期结尾，title完整本机年月日时分；Codex内容不变');
        fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        console.log(`PET_ZCODE_UI_SMOKE_OK ${JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,report:path.join(outputDirectory,'report.json')})}`);
        app.quit(); return;
      }

      zcode.show(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, windows: usage.buckets.slice(0, 2) } }, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '2' && document.querySelector('#quota-label').dataset.expanded === 'true'", 'two bucket expanded fixture');
      const dualBounds = await js(zcode, `(() => { const footer = document.querySelector('.v20-links').getBoundingClientRect(); return { innerWidth, innerHeight, footer: footer.toJSON() }; })()`);
      report.twoBucketFixtureBounds = dualBounds;
      assert.ok(dualBounds.footer.bottom <= dualBounds.innerHeight - 1, 'Two-bucket ZCode footer must also fit.');
      await capture(zcode, '09-zcode-two-bucket-fixture-light');
      const single = { ...usage.buckets[1], planName: `${usage.buckets[1].planName} · 超长套餐名称验收夹具`.repeat(3) };
      zcode.show(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, windows: [single] } }, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '1' && document.querySelector('#quota-label').dataset.expanded === 'true'", 'single bucket long title fixture');
      const singleBounds = await js(zcode, `(() => { const brand = document.querySelector('.v20-brand').getBoundingClientRect(), pill = document.querySelector('.v20-cell-label .period-pill').getBoundingClientRect(), tools = document.querySelector('.v20-header-tools').getBoundingClientRect(), footer = document.querySelector('.v20-links').getBoundingClientRect(); return { innerWidth, innerHeight, brand: brand.toJSON(), pill: pill.toJSON(), tools: tools.toJSON(), footer: footer.toJSON() }; })()`);
      report.singleBucketFixtureBounds = singleBounds;
      assert.ok(singleBounds.pill.right <= singleBounds.innerWidth - 12, 'Single-bucket model pill must remain inside its own row.');
      assert.ok(singleBounds.brand.right <= singleBounds.tools.left, 'Single-bucket plan header must not overlap controls.');
      assert.ok(singleBounds.tools.right <= singleBounds.innerWidth && singleBounds.footer.bottom < singleBounds.innerHeight, 'Single-bucket header and footer must remain inside native bounds.');
      await capture(zcode, '10-zcode-single-long-title-fixture-light');
      zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '4'", 'restore real four buckets');
      report.checks.push('原生指针点击折叠/展开；四桶保留且同名模型来源可区分');
      await pointer(zcode, '[data-action="quota"]');
      await waitFor(details, "document.querySelectorAll('button.zcode-quota-row[data-bucket-id]').length === 4 && document.querySelector('#details-panel').dataset.source === 'zcode'", 'four quota details');
      observe(details);
      const detailsText = await js(details, "document.querySelector('#details-content').innerText");
      const exactTitles = await js(details, "[...document.querySelectorAll('.zcode-quota-values')].map(el => el.title).join(' ')");
      for (const row of usage.buckets) assert.ok(exactTitles.includes(row.total.toLocaleString('en-US')));
      assert.ok(detailsText.includes('到期') && detailsText.includes('刷新'));
      assert.equal(details.owns({ sender: codex.getWindow().webContents, senderFrame: codex.getWindow().webContents.mainFrame }), false);
      await capture(details, '03-zcode-quota-details-light');
      report.checks.push('同源 IPC 打开额度明细；四份真实总量及到期/刷新分别显示；错误窗口身份不被拥有');
      await pointer(details, 'button.zcode-quota-row');
      await waitFor(details, "document.querySelectorAll('.zcode-bucket-button[data-bucket-option]').length === 4", 'four bucket selector options');
      const tabs = await js(details, "[...document.querySelectorAll('.zcode-bucket-button[data-bucket-option]')].map(el => ({ id: el.dataset.bucketOption, text: el.innerText }))");
      assert.equal(new Set(tabs.map(row => row.id)).size, 4); assert.equal(new Set(tabs.map(row => row.text)).size, 4);
      report.trendTabs = tabs;
      for (const tab of tabs) {
        await pointer(details, `.zcode-bucket-button[data-bucket-option=${JSON.stringify(tab.id)}]`);
        await waitFor(details, `document.querySelector('.zcode-bucket-button[data-bucket-option][aria-pressed="true"]')?.dataset.bucketOption === ${JSON.stringify(tab.id)}`, 'selected bucket trend');
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
      report.bucketInteractions = []; report.keyboardFocusProvidedByHarness = false; report.keyboard = {state:'not_run', reason:'existing non-focusing native card policy; temporary focus key injection did not activate a button reliably'};
      for (const count of [1, 2, 4]) for (const nextSize of ['standard', 'compact']) for (const nextAppearance of ['light', 'dark']) {
        size = nextSize; appearance = nextAppearance;
        nativeTheme.themeSource = appearance;
        zcode.show(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, windows: usage.buckets.slice(0, count) } }, {}, now));
        await waitFor(zcode, `document.querySelector('#quota-label').dataset.itemCount === '${count}'`, 'bucket interaction matrix');
        if (await js(zcode, "document.querySelector('#quota-label').dataset.expanded !== 'true'")) await pointer(zcode, '#quota-label', true);
        await waitFor(zcode, "document.querySelector('#quota-label').dataset.expanded === 'true'", 'matrix expanded card');
        const indexes = [...new Set([Math.min(1, count - 1), count - 1])];
        for (const index of indexes) {
          const selector = `.v20-periods > button.v20-period:nth-child(${index + 1})`;
          const key = usage.buckets[index].bucketId;
          assert.equal(await js(zcode, `document.querySelector(${JSON.stringify(selector)})?.type`), 'button');
          await pointer(zcode, selector);
          await waitFor(details, `document.querySelector('.zcode-bucket-button[data-bucket-option][aria-pressed="true"]')?.dataset.bucketOption === ${JSON.stringify(key)}`, 'clicked bucket selection');
          assert.equal(details.getPeriod(), key);
          assert.equal(await js(zcode, "document.querySelector('#quota-label').dataset.expanded"), 'true');
          details.close();
          // This card intentionally keeps the existing non-focusing native window policy.
          // Pointer behavior is exercised here; semantic keyboard defaults are covered by native buttons,
          // while OS keyboard routing is not claimed as verified by this isolated harness.
          report.bucketInteractions.push({ count, size, appearance, bucketId: key, pointer: true, keyboard: 'not_run_non_focusing_window' });
        }
        if (count === 4 && (size === 'compact' && appearance === 'dark' || size === 'standard' && appearance === 'light')) {
          await capture(zcode, `11-bucket-buttons-${size}-${appearance}`);
        }
      }
      size = 'standard'; appearance = 'dark';
      zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
      await waitFor(zcode, "document.querySelector('#quota-label').dataset.itemCount === '4'", 'restore actual buckets after matrix');
      report.checks.push('1/2/4桶、128/标准、浅深：第2/末桶整格真实点击直达对应趋势且不收起；键盘原生路由未通过，保持不抢焦点产品策略');
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
      report.placementMatrix = [];
      sameAnchor = true; details.close();
      const overlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
      for (const sample of [{ edge: 'left', size: 'standard', expanded: false }, { edge: 'right', size: 'compact', expanded: true }, { edge: 'bottom', size: 'standard', expanded: true }]) {
        size = sample.size;
        anchor.x = sample.edge === 'left' ? area.x + 2 : sample.edge === 'right' ? area.x + area.width - 82 : Math.round(area.x + area.width / 2 - 40);
        anchor.y = sample.edge === 'bottom' ? area.y + area.height - 82 : area.y + 120;
        for (const together of [false, true]) {
          stackEnabled = together;
          if (together) { codex.show(codexModel); if (codex.isExpanded?.() !== sample.expanded) { const actual = await js(codex, "document.querySelector('#quota-label').dataset.expanded === 'true'"); if (actual !== sample.expanded) await pointer(codex, actual ? '.v20-collapse' : '#quota-label', !actual); } codex.reposition(); }
          else codex.hide();
          zcode.show(buildZcodeQuotaLabelModel(snapshot, {}, now));
          const zExpanded = await js(zcode, "document.querySelector('#quota-label').dataset.expanded === 'true'");
          if (zExpanded !== sample.expanded) await pointer(zcode, zExpanded ? '.v20-collapse' : '#quota-label', !zExpanded);
          zcode.reposition(); await delay(100);
          const z = zcode.getVisibleBounds(), c = together ? codex.getVisibleBounds() : null;
          assert.ok(z && z.x >= area.x && z.y >= area.y && z.x+z.width <= area.x+area.width && z.y+z.height <= area.y+area.height);
          assert.equal(overlap(z, anchor), false, 'ZCode must not cover the pet');
          if(c) assert.equal(overlap(z,c),false,'ZCode must not cover Codex');
          if(sample.edge !== 'bottom' && together) { assert.equal(z.y,c.y+c.height+8); assert.equal(z.x+z.width/2,c.x+c.width/2); }
          if(sample.expanded) {
            const foot = await js(zcode, "({bottom: document.querySelector('.v20-links').getBoundingClientRect().bottom, height: innerHeight})");
            assert.ok(foot.bottom < foot.height);
          }
          report.placementMatrix.push({ ...sample, together, zcode: z, codex: c });
          if(together) await capture(zcode, `12-placement-${sample.edge}-${sample.size}`);
        }
      }
      report.checks.push('原生窗口仅ZCode/双卡：左边标准收起、右边小巧展开、底边标准展开，完整可见不重叠；有空间时下方同中心');
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
