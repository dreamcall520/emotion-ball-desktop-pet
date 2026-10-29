// Read-only About UI verification. Uses packaged UI, fixture IPC, and a hidden isolated window.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-about-native-'));
  const env = { ...process.env, PET_ABOUT_UI_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; fs.rmSync(data, { recursive: true, force: true }); } };
  child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, ipcMain, nativeTheme, session } = require('electron');
  const sourceRoot = path.resolve(process.env.PET_ABOUT_UI_SOURCE_ROOT || path.resolve(__dirname, '../..'));
  const output = path.resolve(process.env.PET_ABOUT_UI_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-about-ui-')));
  const data = process.env.PET_ABOUT_UI_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-about-native-'));
  const ownData = !process.env.PET_ABOUT_UI_USER_DATA;
  app.setPath('userData', data); app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  const report = { passed: false, fixture: true, sourceRoot, actualPreloadHtmlCssRenderer: true, nativeHidden: true,
    userVisualAcceptance: false, noExternalBrowserOrDownload: true, profile: 'isolated temporary directory',
    themeScope: 'this isolated Electron process only', portrait: 'actual renderer; native visibility and DOM visibility are recorded separately', cases: [], errors: [] };
  let win, closed = false, blockedNetwork = 0, alternativeCalls = [];
  const unexpected = { download: 0, website: 0, update: 0, windowOpen: 0 };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (check, label) => { const end = Date.now() + 6000; while (!await check()) { if (Date.now() >= end) throw new Error(`Timed out: ${label}`); await wait(16); } };
  const finish = code => {
    if (closed) return; closed = true;
    if (win && !win.isDestroyed()) { if (win.isVisible()) { report.nativeHidden = false; code = 1; } win.destroy(); }
    report.cleanup = { windowDestroyed: !win || win.isDestroyed() }; report.network = { blockedAttempts: blockedNetwork, actualRequests: 0 };
    report.actions = { alternatives: alternativeCalls, unexpected }; report.passed = code === 0;
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (ownData) fs.rmSync(data, { recursive: true, force: true });
    if (report.passed) console.log(`PET_ABOUT_DOWNLOAD_UI_OK ${output}`);
    app.exit(code);
  };
  const fail = error => { report.errors.push(String(error.stack || error)); console.error(error.stack || error); finish(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  app.whenReady().then(async () => {
    try {
      const file = name => path.join(sourceRoot, 'desktop-pet', name);
      report.sourceFiles = Object.fromEntries(['about-preload.js', 'about.html', 'about.css', 'about-renderer.js', 'lib/app-update.js'].map(name => [name, createHash('sha256').update(fs.readFileSync(file(name))).digest('hex')]));
      const packageVersion = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).version; report.packageVersion = packageVersion;
      const main = fs.readFileSync(file('main.js'), 'utf8'), aboutDefinition = main.slice(main.indexOf('function openAbout()'), main.indexOf('function fromCodexConsentWindow'));
      assert.match(aboutDefinition, /width:\s*360,\s*height:\s*512/); report.productionSize = { width: 360, height: 512 };
      const updateSource = fs.readFileSync(file('lib/app-update.js'), 'utf8');
      const messages = [...(updateSource.match(/const DOWNLOAD_MESSAGES = \{([\s\S]*?)\n\};/)?.[1] || '').matchAll(/([A-Z_]+):\s*\['[^']+',\s*'([^']+)'\]/g)].map(match => ({ code: match[1], message: match[2] }));
      assert(messages.length > 0); const longest = messages.sort((a, b) => b.message.length - a.message.length)[0];
      const longMessage = '下载安装包时连接被中断，连续两次恢复均未完成。当前安装包尚未保存成功。你可以检查网络和保存位置后重试，也可以选择浏览器下载，或通过国内下载入口打开微云分享页。请按下载页面的提示完成文件保存。';
      const longWord = '验收提示：NETWORK_CONNECTION_INTERRUPTED_WITHOUT_COMPLETED_DOWNLOAD_'.repeat(3);
      const base = { state: 'ready', hasUpdate: true, currentVersion: packageVersion, latestVersion: '99.0.1', downloadAvailable: true,
        browserDownloadAvailable: true, domesticDownloadAvailable: true };
      const owned = event => win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
      ipcMain.handle('pet:about-get', event => { assert(owned(event)); return { version: packageVersion, developer: '春野', update: base }; });
      ipcMain.handle('pet:about-download-alternative', (event, source) => {
        assert(owned(event)); assert(['browser', 'domestic'].includes(source)); alternativeCalls.push(source);
        return { ok: false, message: '验收仅记录下载入口，没有打开外部页面。' };
      });
      ipcMain.handle('pet:about-release', () => { unexpected.download++; return { state: 'cancelled', message: '验收不触发下载。' }; });
      ipcMain.handle('pet:about-website', () => { unexpected.website++; return false; });
      ipcMain.handle('pet:about-update', () => { unexpected.update++; return false; });
      ipcMain.on('pet:about-close', event => { if (owned(event)) win.close(); });
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => { blockedNetwork++; done({ cancel: true }); });
      win = new BrowserWindow({ width: 360, height: 512, resizable: false, maximizable: false, fullscreenable: false,
        title: 'Hidden About verification', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#EDF4FF', show: false,
        webPreferences: { preload: file('about-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false } });
      win.webContents.setWindowOpenHandler(() => { unexpected.windowOpen++; return { action: 'deny' }; });
      win.webContents.on('will-navigate', event => event.preventDefault()); win.webContents.on('will-attach-webview', event => event.preventDefault());
      await win.loadFile(file('about.html'));
      const page = code => win.webContents.executeJavaScript(code);
      await until(() => page("document.getElementById('about-version').textContent.startsWith('版本 ') && !document.getElementById('about-browser-download').hidden"), 'actual About preload and renderer ready');
      assert.equal(win.getBounds().height, 512); assert.equal(win.isVisible(), false);
      const snapshot = () => page(`(()=>{const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}},inside=b=>b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight;const ids=['about-check-updates','about-open-release','about-browser-download','about-domestic-download','about-status'];const elements=Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),b=rect(e),style=getComputedStyle(e),hit=b.width&&b.height?document.elementFromPoint(b.x+b.width/2,b.y+b.height/2):null;return [id,{rect:b,text:e.textContent,title:e.title,hidden:e.hidden,display:style.display,visibility:style.visibility,disabled:e.disabled===true,inside:inside(b),hitAtCenter:hit===e||e.contains(hit),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}]}));return {viewport:{width:innerWidth,height:innerHeight},documentHidden:document.hidden,portraitChildren:document.getElementById('about-portrait').childElementCount,dark:matchMedia('(prefers-color-scheme: dark)').matches,background:getComputedStyle(document.querySelector('.about-window')).backgroundColor,bodyScrollWidth:document.body.scrollWidth,documentScrollWidth:document.documentElement.scrollWidth,elements}})()`);
      const capture = async name => {
        let image;
        for (let i = 0; i < 3; i++) { image = await win.webContents.capturePage(undefined, { stayHidden: true }); await page('new Promise(resolve=>requestAnimationFrame(resolve))'); }
        assert(image.toPNG().length > 100); fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
      };
      fs.mkdirSync(output, { recursive: true });
      const cases = [{ name: 'available', update: base, production: true },
        { name: 'longest-production-error', update: { ...base, download: { state: 'error', ...longest } }, production: true },
        { name: 'long-error', update: { ...base, download: { state: 'error', code: 'FIXTURE_LONG_MESSAGE', message: longMessage } }, production: false },
        { name: 'long-unbroken-error', update: { ...base, download: { state: 'error', code: 'FIXTURE_LONG_WORD', message: longWord } }, production: false }];
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme; win.webContents.send('pet:color-mode', 'standard', theme, 'blue');
        await until(() => page(`matchMedia('(prefers-color-scheme: dark)').matches === ${theme === 'dark'}`), 'isolated process theme');
        for (const scenario of cases) {
          win.webContents.send('pet:about-update-state', scenario.update);
          await until(() => page(`document.getElementById('about-status').textContent === ${JSON.stringify(scenario.update.download?.message || '发现新版本 99.0.1')}`), 'fixture update IPC');
          await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const value = await snapshot(); report.cases.push({ theme, scenario: scenario.name, productionMessage: scenario.production, ...value });
          assert.deepEqual(value.viewport, { width: 360, height: 512 }); assert.equal(win.isVisible(), false);
          for (const id of ['about-browser-download', 'about-domestic-download']) {
            const control = value.elements[id]; assert.equal(control.hidden, false, `${theme}/${scenario.name}/${id} visible`);
            assert.equal(control.disabled, false); assert.equal(control.inside, true, `${theme}/${scenario.name}/${id} remains in viewport`);
            assert.equal(control.hitAtCenter, true, `${theme}/${scenario.name}/${id} is not covered`); assert(control.rect.width > 0 && control.rect.height > 0);
          }
          const browser = value.elements['about-browser-download'].rect, domestic = value.elements['about-domestic-download'].rect;
          assert(browser.right <= domestic.x, 'alternative actions have no horizontal overlap');
          assert(value.bodyScrollWidth <= 360 && value.documentScrollWidth <= 360, 'page has no horizontal overflow');
          assert(value.elements['about-status'].scrollWidth <= value.elements['about-status'].clientWidth, 'long error wraps without horizontal overflow');
          if (scenario.production) assert.equal(value.elements['about-status'].inside, true, 'actual production text remains fully visible');
          await capture(`${theme}-${scenario.name}`);
        }
      }
      // The actual buttons invoke their real preload; these isolated handlers only record the source.
      for (const id of ['about-browser-download', 'about-domestic-download']) {
        const before = alternativeCalls.length; await page(`document.getElementById('${id}').click()`);
        await until(() => alternativeCalls.length === before + 1, 'alternative click reaches isolated safe IPC handler');
        await until(() => page("document.getElementById('about-status').textContent === '验收仅记录下载入口，没有打开外部页面。' && !document.getElementById('about-browser-download').disabled"), 'safe fixture action completes');
      }
      assert.deepEqual(alternativeCalls, ['browser', 'domestic']); assert(Object.values(unexpected).every(value => value === 0)); assert.equal(blockedNetwork, 0);
      report.longTextLimitations = report.cases.filter(value => !value.elements['about-status'].inside).map(value => ({ theme: value.theme, scenario: value.scenario, statusRect: value.elements['about-status'].rect }));
      finish(0);
    } catch (error) { fail(error); }
  });
}
