const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (process.versions.electron && process.argv.includes('--brand-theme-child')) {
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', process.env.PET_BRAND_DATA);
  app.whenReady().then(async () => {
    let win;
    try {
      session.defaultSession.webRequest.onBeforeRequest((request, done) => done({ cancel: /^https?:/.test(request.url) || /\.js(?:\?|$)/.test(request.url) }));
      win = new BrowserWindow({ width: 460, height: 660, show: false, webPreferences: { backgroundThrottling: false } });
      const run = code => win.webContents.executeJavaScript(code);
      win.webContents.debugger.attach('1.3');
      let checks = 0;
      for (const page of ['about', 'codex-consent', 'workbuddy-consent']) {
        await win.loadFile(path.resolve(__dirname, '..', `${page}.html`));
        const appearances = [];
        for (const appearance of ['light', 'dark']) {
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: appearance }] });
          for (const mode of ['standard', 'accessible']) {
            let expected;
            for (const theme of ['green', 'blue', 'purple']) {
              await run(`Object.assign(document.documentElement.dataset, ${JSON.stringify({ uiTheme: theme, appearance, accessibleAppearance: appearance, colorMode: mode })});void 0`);
              const palette = await run(`(() => {
                const root = getComputedStyle(document.documentElement), panel = document.querySelector('.about-window'), heading = document.querySelector('h1');
                const text = getComputedStyle(heading), paint = getComputedStyle(panel), wash = getComputedStyle(panel, '::before');
                return { panel:paint.backgroundColor, text:paint.color, title:text.backgroundImage, titleFill:text.webkitTextFillColor, wash:wash.backgroundImage, washDisplay:wash.display, accent:root.getPropertyValue('--accent').trim(), button:document.querySelector('.consent-primary') && getComputedStyle(document.querySelector('.consent-primary')).backgroundColor };
              })()`);
              if (!expected) expected = palette;
              else assert.deepEqual(palette, expected, `${page}/${appearance}/${mode}: changing theme must not recolor brand pages`);
              if (mode === 'accessible') {
                assert.equal(palette.title, 'none');
                assert.equal(palette.washDisplay, 'none');
              }
              checks++;
            }
            if (mode === 'standard') appearances.push(expected);
          }
        }
        assert.notDeepEqual(appearances[0], appearances[1], `${page}: existing light/dark adaptation remains`);
      }
      win.destroy(); console.log(`BRAND_THEME_OK ${checks}`); app.exit(0);
    } catch (error) { console.error(error.stack); win?.destroy(); app.exit(1); }
  });
} else {
  require('node:test')('about and consent pages keep brand colors across themes while preserving light/dark and accessibility', { timeout: 20000 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiu-brand-theme-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--brand-theme-child'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PET_BRAND_DATA: dir } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /BRAND_THEME_OK 36/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
