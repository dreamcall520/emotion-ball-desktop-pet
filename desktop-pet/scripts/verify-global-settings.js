// Run with Electron; all preference writes go to a disposable directory.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-settings-verify-'));
app.setPath('userData', userData);
process.argv.push('--settings-preview');
require('../main');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Global settings verification timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  try {
    let win;
    for (let attempt = 0; attempt < 100; attempt++) {
      win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/global-settings.html'));
      if (win && !win.webContents.isLoading()) break;
      await sleep(50);
    }
    assert.ok(win, 'settings window opens');
    const evaluate = code => win.webContents.executeJavaScript(code);
    for (let attempt = 0; attempt < 100 && !await evaluate('document.querySelectorAll(".row").length'); attempt++) await sleep(50);
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '常用设置');
    assert.equal(await evaluate('document.querySelectorAll("select").length'), 3);
    await evaluate('document.querySelector("[aria-label=互动气泡]").click()');
    await sleep(150);
    assert.equal(await evaluate('document.querySelector("[aria-label=互动气泡]").getAttribute("aria-checked")'), 'false');
    const stored = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.equal(stored.bubblesEnabled, false, 'switch persists via existing application setter');
    await evaluate(`document.querySelector('#appearance-switch button[aria-label="界面外观：深色"]').click()`);
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.dataset.appearance'), 'dark');
    assert.equal(await evaluate(`document.querySelector('#appearance-switch [aria-pressed=true]').textContent`), '深色');
    await evaluate(`document.querySelector('[data-view=quick]').click()`);
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '功能入口');
    await evaluate(`document.querySelector('[data-view=common]').click()`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="外观（所有窗口）"] option:checked').textContent`), '深色');
    await evaluate(`(() => { const input = document.querySelector('#search'); input.value = '额度'; input.dispatchEvent(new Event('input')); })()`);
    assert.ok(await evaluate('document.querySelectorAll(".row").length > 0'));
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '搜索结果');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === '显示 Codex 额度').disabled`), true);
    await evaluate(`(() => { const input = document.querySelector('#search'); input.value = '不存在的设置xyz'; input.dispatchEvent(new Event('input')); })()`);
    assert.equal(await evaluate('document.querySelector("#empty").hidden'), false);
    await evaluate(`document.querySelector('[data-view=common]').click()`);
    win.setSize(620, 520);
    await sleep(100);
    assert.equal(await evaluate('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'), true);
    console.log('GLOBAL_SETTINGS_UI_OK: search, disabled dependencies, persistence, theme and compact layout');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
