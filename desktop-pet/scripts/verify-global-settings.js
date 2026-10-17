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
const timeout = setTimeout(() => { console.error('Global settings verification timed out'); app.exit(1); }, 40000);
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
    assert.equal(await evaluate('document.querySelector("#search-panel").hidden'), true);
    assert.equal(await evaluate('document.querySelector(".group").getBoundingClientRect().top < 130'), true);
    assert.equal(await evaluate('document.querySelectorAll("#navigation [aria-current=page]").length'), 1);
    await evaluate('document.querySelector("[aria-label=互动气泡]").click()');
    await sleep(150);
    assert.equal(await evaluate('document.querySelector("[aria-label=互动气泡]").getAttribute("aria-checked")'), 'false');
    const stored = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.equal(stored.bubblesEnabled, false, 'switch persists via existing application setter');
    await evaluate(`document.querySelector('#appearance-switch button[aria-label="界面外观：深色"]').click()`);
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.dataset.appearance'), 'dark');
    assert.equal(await evaluate(`document.querySelector('#appearance-switch [aria-pressed=true]').textContent`), '深色');
    assert.equal(await evaluate('document.querySelector("[data-view=quick]")'), null);
    await evaluate(`document.querySelector('[data-view="/customize-open"]').click()`);
    await sleep(300);
    assert.ok(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().endsWith('/customize.html')));
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '常用设置');
    await evaluate(`document.querySelector('[data-view=shortcuts]').click()`);
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '快捷键');
    await evaluate(`(() => { const select = document.querySelector('select[aria-label="面板形态"]'); select.value = 'list'; select.dispatchEvent(new Event('change')); document.querySelector('#appearance-switch button[aria-label="界面外观：浅色"]').click(); })()`);
    await sleep(200);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="面板形态"]').value`), 'list', 'theme refresh preserves shortcut draft');
    await evaluate(`document.querySelector('[data-view=common]').click(); document.querySelector('[data-view=shortcuts]').click()`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="面板形态"]').value`), 'list', 'navigation preserves shortcut draft');
    await evaluate(`document.querySelector('[aria-label=和球球聊聊快捷键]').click(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'q', code:'KeyQ', ctrlKey:true, altKey:true, bubbles:true}))`);
    assert.ok(await evaluate(`document.querySelector('.shortcut-settings-group [role=status]').textContent.includes('已经用于')`));
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    assert.equal(await evaluate(`document.querySelector('[aria-label=和球球聊聊快捷键]').textContent`), '未设置');
    await evaluate(`document.querySelector('#appearance-switch button[aria-label="界面外观：深色"]').click()`);
    await sleep(200);
    await evaluate(`document.querySelector('[aria-label=和球球聊聊快捷键]').click(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'j', code:'KeyJ', ctrlKey:true, altKey:true, bubbles:true}))`);
    await evaluate(`(() => { const select = document.querySelector('select[aria-label="面板形态"]'); select.value = 'list'; select.dispatchEvent(new Event('change')); document.querySelector('.shortcut-footer button').click(); })()`);
    await sleep(200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).shortcutSettings.shape, 'list');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).shortcutSettings.chat, 'Ctrl+Alt+J');
    await evaluate(`document.querySelector('[data-view=common]').click()`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="外观（所有窗口）"] option:checked').textContent`), '深色');
    await evaluate(`document.querySelector('#search-toggle').click()`);
    assert.equal(await evaluate('document.querySelector("#search-panel").hidden'), false);
    await evaluate(`(() => { const input = document.querySelector('#search'); input.value = '额度'; input.dispatchEvent(new Event('input')); })()`);
    assert.ok(await evaluate('document.querySelectorAll(".row").length > 0'));
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '搜索结果');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === '显示 Codex 额度').disabled`), true);
    await evaluate(`(() => { const input = document.querySelector('#search'); input.value = '不存在的设置xyz'; input.dispatchEvent(new Event('input')); })()`);
    assert.equal(await evaluate('document.querySelector("#empty").hidden'), false);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    assert.equal(await evaluate('document.querySelector("#search-panel").hidden'), true);
    assert.equal(await evaluate('document.querySelector("#search").value'), '');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'k', metaKey:true, bubbles:true}))`);
    assert.equal(await evaluate('document.activeElement.id'), 'search');
    await evaluate(`document.querySelector('[data-view=common]').click()`);
    for (const [id, file] of [['/chat-open', 'chat.html'], ['/pomodoro-open', 'pomodoro.html'], ['/Codex%20%E4%B8%8E%20API/openai-api-menu/openai-api-usage', 'api-usage.html']]) {
      // Resolve API's encoded category from the live menu, without coupling to translated paths.
      const selector = id.includes('openai-api-usage') ? '[data-view$="/openai-api-usage"]' : `[data-view="${id}"]`;
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await sleep(300);
      assert.ok(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().split('?')[0].endsWith('/' + file)), file + ' opens independently');
    }
    await evaluate(`document.querySelector('#about-link').click()`);
    await sleep(200);
    assert.ok(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().endsWith('/about.html')));
    await evaluate(`document.querySelector('#search-toggle').click(); const input = document.querySelector('#search'); input.value = '快捷键'; input.dispatchEvent(new Event('input')); document.querySelector('[aria-label=快捷键设置]').click()`);
    assert.equal(await evaluate('document.querySelector("#section-title").textContent'), '快捷键', 'search routes to embedded shortcut editor');
    win.setSize(620, 520);
    await sleep(100);
    assert.equal(await evaluate('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'), true);
    console.log('GLOBAL_SETTINGS_UI_OK: search, disabled dependencies, persistence, theme and compact layout');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
