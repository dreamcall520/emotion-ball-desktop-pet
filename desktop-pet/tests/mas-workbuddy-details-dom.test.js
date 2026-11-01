const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (process.versions.electron && process.argv.includes('--details-child')) {
  const { app, BrowserWindow, session } = require('electron'); app.setPath('userData', process.env.PET_DETAILS_SCRATCH); app.setActivationPolicy('accessory');
  app.whenReady().then(async () => { let win; try {
    session.defaultSession.webRequest.onBeforeRequest((d, done) => done({ cancel: /^https?:/.test(d.url) || /\/workbuddy-details-renderer\.js$/.test(d.url) }));
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    await win.loadFile(path.join(__dirname, '../workbuddy-details.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run("window.petWorkBuddyDetails={onModel:c=>window.receive=c,onColorMode(){},close(){},resize(){}};void 0");
    await run(fs.readFileSync(path.join(__dirname, '../workbuddy-details-renderer.js'), 'utf8'));
    const { createMasWorkBuddyDetailsState } = require('../lib/mas-workbuddy-details');
    const state = createMasWorkBuddyDetailsState({ action: 'tasks', desktopTasks: { report: { source: 'workbuddy-session-cache', scope: 'authorized-device-cache',
      items: [{ id: 'opaque_cache_id', title: '设备历史标题', state: 'last-completed', updatedAt: 100 }] } },
      desktopIntegration: { source: 'workbuddy-desktop-hook', scope: 'authorized-original-workbuddy-hook-metadata', enabled: true,
        observations: [{ id: 'a'.repeat(32), phase: 'stop-observed', observedAt: 100, realtime: true }] } });
    await run(`receive(${JSON.stringify(state)})`);
    const result = await run("({text:document.getElementById('task-view').textContent,buttons:document.getElementById('task-view').querySelectorAll('button').length})");
    assert.match(result.text, /账号归属未核实/); assert.match(result.text, /完成待确认/); assert.match(result.text, /设备历史标题/);
    assert.doesNotMatch(result.text, /opaque_cache_id|aaaaaaaa/); assert.equal(result.buttons, 0);
    const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, credits: i === 6 ? 2 : 0 }));
    const at = Date.parse('2026-11-07T12:00:00+08:00');
    const trend = createMasWorkBuddyDetailsState({ quota: { summary: { scope: 'website-summary', credits: { remaining: 9 }, updatedAt: at } },
      usage: { report: { source: 'website-usage', scope: 'website-request-usage', timezone: 'Asia/Shanghai', complete: true, days,
        startDate: days[0].date, endDate: days.at(-1).date, todayRecords: [{ at, credits: 2 }], todayCredits: 2, totalCredits: 2, requestCount: 1, updatedAt: at } } });
    await run(`receive(${JSON.stringify(trend)})`);
    assert.equal(await run("document.getElementById('change').textContent"), '2');
    assert.equal(await run("document.getElementById('usage-empty').hidden"), true);
    assert.match(await run("document.getElementById('updated').title"), /网站消耗记录/);
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error.stack); win?.destroy(); app.exit(1); } });
} else require('node:test')('MAS website curve and separate device/live detail render in Chromium without task-open actions', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-details-dom-'));
  try { const env = { ...process.env, PET_DETAILS_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => { const child = require('node:child_process').spawn(require('electron'), [__filename, '--details-child'], { env });
      let output = ''; child.stdout.on('data', v => output += v); child.stderr.on('data', v => output += v);
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(output))); });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
