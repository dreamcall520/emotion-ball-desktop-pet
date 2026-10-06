const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.QIUQIU_SITE_URL || 'http://127.0.0.1:4187/';
const out = process.env.QIUQIU_QA_OUTPUT || path.resolve(__dirname, '../../验收记录/官网-QQ风格正式发布-20261006/local/home');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], failures = [], checks = [], layouts = [];
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('umami.disabled', '1'));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failures.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  try {
    for (const [width, height] of [[1440,900], [1080,720], [506,794], [414,736], [390,844], [320,568], [844,390]]) {
      for (const scheme of ['light', 'dark']) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
        await page.goto(base);
        await page.waitForFunction(() => document.documentElement.dataset.sceneState === 'ready');
        await page.waitForTimeout(1500);
        assert.equal(await page.title(), '球球-陪你自在一点');
        const layout = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          imagesReady: [...document.images].every(i => i.complete && i.naturalWidth > 0),
          sceneSources: [...document.querySelectorAll('.scene-image')].map(i => i.currentSrc.split('/').pop()),
          cta: (() => { const b = document.querySelector('.download-button').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })(),
          footerVisible: [...document.querySelectorAll('.home-footer a, .home-footer button, .credit')].every(e => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; }),
          contentClear: document.querySelector('.hero-copy').getBoundingClientRect().top >= document.querySelector('.home-header').getBoundingClientRect().bottom,
          copyOpacity: getComputedStyle(document.querySelector('.hero-copy')).opacity
        }));
        assert.ok(layout.scrollWidth <= width, `horizontal overflow ${width}/${scheme}`);
        assert.ok(layout.scrollHeight <= height + 1, `not one screen ${width}x${height}/${scheme}: ${layout.scrollHeight}`);
        assert.ok(layout.imagesReady && layout.cta && layout.footerVisible && layout.contentClear);
        assert.deepEqual(layout.sceneSources, [scheme === 'dark' ? 'hero-night-v2.webp' : 'hero-silver-v2.webp']);
        assert.equal(layout.copyOpacity, '1');
        layouts.push({ ...layout, scheme });
        await page.screenshot({ path: path.join(out, `home-${width}x${height}-${scheme}.png`) });
        await page.locator('[data-license-open]').click();
        const dialog = page.getByRole('dialog', { name:'署名与许可' });
        assert.ok(await dialog.isVisible());
        assert.equal(page.url(), base);
        assert.equal(context.pages().length, 1);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, 'license prompt fits the viewport');
        assert.match(await dialog.innerText(), /免费、非商业使用。/);
        assert.match(await dialog.innerText(), /须保留署名、LICENSE 和 NOTICE。/);
        assert.equal(await dialog.getByRole('link', { name:'查看原作者 sam70361 的 GitHub 项目' }).getAttribute('href'), 'https://github.com/sam70361/aora-bot');
        assert.equal(await dialog.getByRole('link').getAttribute('target'), '_blank');
        if (width === 1440 || width === 390) await page.screenshot({ path:path.join(out, `license-${width}x${height}-${scheme}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        assert.equal(await page.locator('[data-license-open]').evaluate(e => e === document.activeElement), true);
      }
    }
    await page.locator('[data-license-open]').click();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('dialog').evaluate(e => e.matches(':modal') && (e.contains(document.activeElement) || document.activeElement === document.body)), true, 'native dialog prevents focus moving to background controls');
    await page.getByRole('button', { name:'关闭许可说明' }).click();
    assert.equal(await page.locator('[data-license-open]').evaluate(e => e === document.activeElement), true);
    await page.locator('[data-license-open]').click();
    await page.mouse.click(5, 5);
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    assert.equal(await page.locator('[data-license-open]').evaluate(e => e === document.activeElement), true);
    checks.push('license prompt stays on the current page, fits 14 layouts, traps focus and closes via Escape, close button or backdrop');
    await page.setViewportSize({ width:1440, height:900 });
    await page.emulateMedia({ colorScheme:'light' });
    await page.goto(base);
    // Pausing during entry must leave all primary content fully visible.
    await page.locator('[data-motion-control]').click();
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('.hero-copy').evaluate(e => getComputedStyle(e).opacity), '1');
    assert.equal(await page.locator('.scene-material').getAttribute('data-state'), 'paused');
    await page.getByRole('button', { name:'摸摸球球' }).click();
    assert.equal(await page.getByRole('status').innerText(), '你忙，我陪着。');
    await page.waitForTimeout(300);
    const reply = await page.getByRole('status').boundingBox();
    assert.ok(reply.x >= 0 && reply.y >= 76 && reply.x + reply.width <= 1440 && reply.y + reply.height < 330, 'reply stays in open space above the ball');
    await page.screenshot({path:path.join(out, 'reply-desktop.png')});
    await page.locator('[data-motion-control]').click();
    assert.equal(await page.locator('.scene-material').getAttribute('data-state'), 'running');
    checks.push('pause during entry, resume and pet response');
    const [product] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name:'功能介绍', exact:true }).click()]);
    await product.waitForLoadState('load');
    assert.match(product.url(), /\/product\/$/);
    assert.equal(await product.title(), '球球桌宠 · 功能介绍');
    assert.equal(await product.locator('#notes').count(), 1);
    assert.match(await product.locator('#license').innerText(), /sam70361/);
    await product.close();
    assert.equal(page.url(), base);
    checks.push('product opens in a new tab; original content and credit retained');
    await page.locator('.desktop-nav summary').click();
    assert.ok(await page.locator('.desktop-nav details').getAttribute('open') !== null);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.desktop-nav details').getAttribute('open'), null);
    checks.push('native download menu and Escape focus return');
    await page.setViewportSize({ width:390, height:844 });
    await page.locator('.mobile-nav summary').click();
    const [installation] = await Promise.all([context.waitForEvent('page'), page.locator('.mobile-nav').getByRole('link', { name:'安装指南' }).click()]);
    await installation.waitForLoadState('load');
    assert.match(installation.url(), /\/product\/#install$/);
    await installation.close();
    await page.keyboard.press('Escape');
    checks.push('mobile menu opens installation in new tab');
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.reload();
    assert.ok(await page.locator('[data-motion-control]').isDisabled());
    assert.equal(await page.locator('.scene-material').evaluate(e => getComputedStyle(e).display), 'none');
    await page.getByRole('button', { name:'摸摸球球' }).click();
    assert.equal(await page.getByRole('status').innerText(), '你忙，我陪着。');
    await page.waitForTimeout(300);
    const mobileReply = await page.getByRole('status').boundingBox(), cta = await page.locator('.download-button').boundingBox();
    assert.ok(mobileReply.y > cta.y + cta.height && mobileReply.y + mobileReply.height < 844 - 76, 'mobile reply avoids the download and footer');
    await page.screenshot({path:path.join(out, 'reply-mobile.png')});
    checks.push('reduced motion keeps static pet and response');
    await page.goto(base + '#updates');
    await page.waitForURL('**/updates/');
    await page.goto(base);
    await page.evaluate(() => location.hash = 'download');
    await page.waitForURL('**/product/#download');
    checks.push('legacy update anchor reaches logs; functionality anchors reach product sections');
    const fallback = await context.newPage();
    const fallbackErrors = [];
    fallback.on('pageerror', e => fallbackErrors.push(e.message));
    await fallback.route('**/assets/hero-silver-v2.webp', route => route.abort());
    await fallback.goto(base);
    assert.equal(await fallback.locator('html').getAttribute('data-scene-state'), 'fallback');
    assert.ok(await fallback.locator('.hero-copy').isVisible());
    assert.equal(await fallback.locator('.scene-image').evaluateAll(es => es.every(e => getComputedStyle(e).visibility === 'hidden')), true);
    assert.ok(await fallback.locator('[data-motion-control]').isDisabled());
    await fallback.getByRole('button', { name:'摸摸球球' }).click();
    assert.equal(await fallback.getByRole('status').innerText(), '你忙，我陪着。');
    assert.deepEqual(fallbackErrors, []);
    await fallback.close();
    checks.push('missing background preserves content and pet response; unavailable motion is disabled');
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    fs.writeFileSync(path.join(out, 'home-checks.json'), JSON.stringify({ base, layouts, checks, errors, failures }, null, 2));
    console.log(`${layouts.length} layouts and ${checks.length} interaction groups passed; no page errors or failed requests`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
