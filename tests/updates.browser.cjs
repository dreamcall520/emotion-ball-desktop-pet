/* Use existing Playwright and Chrome; no network package downloads or App access. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.QIUQIU_UPDATES_URL || 'http://127.0.0.1:4187/updates/';
const out = process.env.QIUQIU_QA_OUTPUT || '/tmp/qiuqiu-updates';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], failed = [];
  const report = { url: base, layouts: [], checks: [], errors, failed };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => { localStorage.setItem('umami.disabled', '1'); if (!localStorage.getItem('emotion-ball-site-theme')) localStorage.setItem('emotion-ball-site-theme', 'light'); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => failed.push(`${request.failure()?.errorText} ${request.url()}`));
    await page.goto(base);
    assert.equal(await page.title(), '球球桌宠 · 更新日志');
    assert.equal(await page.locator('[data-release-panel]:visible').count(), 1);
    assert.equal(await page.locator('[data-release-panel]').count(), 13);
    const entries = await page.locator('[data-release-link]').evaluateAll(links => links.map(link => ({ hash: link.hash, title: link.querySelector('span').textContent })));
    for (const entry of entries) {
      await page.locator(`.versions-list a[href="${entry.hash}"]`).click();
      assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), entry.title);
      assert.equal(new URL(page.url()).hash, entry.hash);
    }
    report.checks.push('13 versions selectable; exact original titles and matching shareable hash');
    await page.locator(`.versions-list a[href="${entries[0].hash}"]`).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), entries[0].title);
    await page.goBack();
    assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), entries[12].title);
    await page.goForward();
    assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), entries[0].title);
    report.checks.push('keyboard Enter, Back and Forward restore selection');
    await page.goto(base + '?view=share#v0.3.13-intel');
    assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), '0.3.13 Intel x64 候选');
    assert.equal(await page.locator('[data-release-panel]:visible .release-download').count(), 2);
    assert.ok((await page.locator('[data-release-panel]:visible .release-download').evaluateAll(links => links.map(l => l.href))).every(url => url.includes('x64')));
    report.checks.push('direct Intel-version hash preserves query and architecture');
    for (const theme of ['light', 'dark']) {
      for (const [width, height] of [[1440,900], [1080,800], [390,844], [320,568]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(theme => { localStorage.setItem('emotion-ball-site-theme', theme); location.hash = 'v0.4.00-apple'; }, theme);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('[data-release-panel]:not([hidden])').id === 'v0.4.00-apple');
        const metrics = await page.evaluate(() => {
          const panel = document.querySelector('[data-release-panel]:not([hidden])');
          const headerBottom = document.querySelector('.site-header').getBoundingClientRect().bottom;
          const title = panel.querySelector('h3').getBoundingClientRect();
          const downloads = [...panel.querySelectorAll('.release-download')].map(e => { const r = e.getBoundingClientRect(); return { x:r.x, right:r.right, height:r.height }; });
          return { width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth, titleTop:title.top, headerBottom, downloads };
        });
        assert.equal(metrics.overflow, false);
        assert.ok(metrics.titleTop >= metrics.headerBottom && metrics.titleTop < height, 'version title visible below navigation');
        assert.ok(metrics.downloads.every(d => d.x >= 0 && d.right <= width && d.height >= 44), 'download controls fit and are touch-sized');
        if (width <= 680) {
          assert.equal(await page.locator('[data-release-select]').isVisible(), true);
          await page.locator('[data-release-select]').selectOption('v0.3.10-hotfix');
          assert.equal(await page.locator('[data-release-panel]:visible h3').innerText(), '0.3.10 Apple 热修复');
          assert.equal(await page.locator('[data-release-panel]:visible .release-download').count(), 1);
          await page.locator('[data-release-select]').selectOption('v0.4.00-apple');
        }
        await page.screenshot({ path:path.join(out, `updates-${width}x${height}-${theme}.png`), fullPage:true });
        report.layouts.push({ theme, width, height, ...metrics });
      }
    }
    report.checks.push('8 light/dark layouts, 320px minimum and native mobile version picker');
    await page.setViewportSize({ width:390, height:844 });
    await page.evaluate(() => localStorage.setItem('emotion-ball-site-theme', 'light'));
    await page.reload();
    await page.getByRole('button', { name:'更多', exact:true }).click();
    const menu = page.locator('#site-nav');
    assert.equal(await menu.getByRole('link', { name:'安装指南', exact:true }).isVisible(), true);
    const [installation] = await Promise.all([context.waitForEvent('page'), menu.getByRole('link', { name:'安装指南', exact:true }).click()]);
    await installation.waitForLoadState('domcontentloaded');
    assert.match(installation.url(), /\/product\/#install$/);
    await installation.close();
    await page.getByRole('button', { name:'更多', exact:true }).click();
    await menu.locator('[data-theme-toggle]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), null);
    await menu.locator('[data-theme-toggle]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    report.checks.push('mobile full navigation, installation in a new tab, theme control and Escape');
    for (const route of ['../product.html?legacy=1#updates', '../product/?legacy=2#updates']) {
      await page.goto(new URL(route, base).href);
      await page.waitForURL('**/updates/?legacy=*');
      assert.equal(new URL(page.url()).pathname, '/updates/');
    }
    report.checks.push('old HTML and clean-product update fragments preserve query and reach logs');
    const noJS = await browser.newContext({ javaScriptEnabled:false, viewport:{ width:390, height:844 } });
    const staticPage = await noJS.newPage();
    await staticPage.goto(base);
    assert.equal(await staticPage.locator('[data-release-panel]:visible').count(), 13);
    assert.equal(await staticPage.locator('.release-download').count(), 27);
    assert.equal(await staticPage.locator('[data-release-select]').isVisible(), false);
    report.checks.push('without JavaScript, all 13 original records and 27 real downloads remain readable');
    await noJS.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    fs.writeFileSync(path.join(out, 'updates-browser-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ layouts:report.layouts.length, checks:report.checks, errors, failed }, null, 2));
    await context.close();
  } catch (error) {
    report.failure = error.stack || error.message;
    fs.writeFileSync(path.join(out, 'updates-browser-verification.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
