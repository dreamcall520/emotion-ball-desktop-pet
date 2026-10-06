const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const out = process.env.QIUQIU_QA_OUTPUT || path.resolve(__dirname, '../../验收记录/官网-QQ风格正式发布-20261006/local/home');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const base = process.env.QIUQIU_SITE_URL || 'http://127.0.0.1:4187/';
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('umami.disabled', '1'));
    const automatic = [];
    for (const width of [1440, 390]) for (const scheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await page.goto(base);
      await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'running');
      const clip = width === 1440 ? {x:70,y:610,width:330,height:150} :
        {x:275,y:scheme === 'dark' ? 470 : 100,width:90,height:70};
      const faceClip = width === 1440 ? {x:1160,y:560,width:120,height:120} :
        {x:180,y:scheme === 'dark' ? 650 : 520,width:80,height:70};
      const first = await page.screenshot({clip});
      const face = await page.screenshot({clip:faceClip});
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-0.png`)});
      await page.waitForTimeout(1600);
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-1.png`)});
      await page.waitForTimeout(1600);
      assert.notDeepEqual(await page.screenshot({clip}), first, `${width}/${scheme}: glass visibly changes without mouse input`);
      assert.deepEqual(await page.screenshot({clip:faceClip}), face, `${width}/${scheme}: face remains stable`);
      assert.equal(await page.locator('.scene-material').getAttribute('data-waves'), '0');
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-2.png`)});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-material')).display === 'none');
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-static.png`)});
      automatic.push({width,scheme,withoutPointer:true,faceStable:true});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
    await page.goto(base);
    const material = page.locator('.scene-material');
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'running');
    const bounds = () => page.locator('.hero-copy').evaluate(e => e.getBoundingClientRect().toJSON());
    const before = await bounds();
    const still = await page.screenshot({ clip: { x: 600, y: 590, width: 90, height: 90 } });
    await page.waitForTimeout(250);
    assert.deepEqual(await page.screenshot({ clip: { x: 600, y: 590, width: 90, height: 90 } }), still, 'central background stays calm without input');
    await page.mouse.move(645, 625);
    await page.waitForFunction(() => Number(document.querySelector('.scene-material').dataset.waves) > 0);
    await page.waitForTimeout(180);
    assert.notDeepEqual(await page.screenshot({ clip: { x: 600, y: 590, width: 90, height: 90 } }), still, 'pointer must visibly refract actual image pixels');
    for (let i = 0; i < 9; i++) { await page.mouse.move(270 + i * 40, 600 - i * 8); await page.waitForTimeout(150); }
    assert.ok(Number(await material.getAttribute('data-waves')) <= 3);
    assert.deepEqual(await bounds(), before);
    assert.equal(await page.locator('.water-ripple').count(), 0, 'no floating decorative rings');
    assert.ok(await material.evaluate(e => e.width * e.height <= 1303000));
    await page.screenshot({ path: path.join(out, 'material-water-desktop.png') });
    await page.waitForTimeout(2600);
    assert.equal(await material.getAttribute('data-waves'), '0');
    await page.locator('[data-motion-control]').click();
    assert.equal(await material.getAttribute('data-state'), 'paused');
    const paused = await page.screenshot({ clip: { x: 20, y: 90, width: 1400, height: 720 } });
    await page.mouse.move(900, 680); await page.waitForTimeout(350);
    assert.deepEqual(await page.screenshot({ clip: { x: 20, y: 90, width: 1400, height: 720 } }), paused, 'paused frame remains frozen');
    await page.locator('[data-motion-control]').click();
    await page.mouse.move(500, 600);
    await page.waitForFunction(() => Number(document.querySelector('.scene-material').dataset.waves) > 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('[data-motion-control]').disabled);
    assert.ok(await page.locator('[data-motion-control]').isDisabled());
    assert.equal(await material.getAttribute('data-waves'), '0');
    assert.equal(await material.evaluate(e => getComputedStyle(e).display), 'none');
    async function sceneAsset(name) {
      await page.waitForFunction(expected => {
        const image = document.querySelector('.scene-image');
        return image.complete && image.naturalWidth > 0 && image.currentSrc.endsWith(expected);
      }, name);
    }
    await page.locator('[data-theme-control]').click();
    assert.equal(await page.locator('[data-theme-control] use').getAttribute('href'), '#icon-sun');
    await page.locator('[data-theme-control]').click();
    assert.equal(await page.locator('[data-theme-control] use').getAttribute('href'), '#icon-moon');
    await sceneAsset('hero-night-v2.webp');
    await page.reload(); await sceneAsset('hero-night-v2.webp');
    await page.locator('[data-theme-control]').click(); await sceneAsset('hero-silver-v2.webp');
    await page.emulateMedia({ colorScheme: 'dark' }); await sceneAsset('hero-night-v2.webp');
    await page.locator('[data-theme-control]').click(); await sceneAsset('hero-silver-v2.webp');
    await page.locator('[data-theme-control]').click(); await sceneAsset('hero-night-v2.webp');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'running');
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#0d172a');
    await page.evaluate(() => {
      const extension = document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
      extension.loseContext(); setTimeout(() => extension.restoreContext(), 600);
    });
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'static');
    assert.equal(await material.evaluate(e => getComputedStyle(e).opacity), '0');
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'running');
    const mobile = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    await mobile.addInitScript(() => localStorage.setItem('umami.disabled', '1'));
    await mobile.goto(base);
    await mobile.touchscreen.tap(180, 190);
    assert.equal(await mobile.locator('.scene-material').getAttribute('data-waves'), '0');
    await mobile.emulateMedia({ colorScheme: 'dark' });
    await mobile.waitForFunction(() => document.querySelector('.scene-image').currentSrc.endsWith('hero-night-v2.webp'));
    await mobile.touchscreen.tap(214, 465);
    assert.equal(await mobile.getByRole('status').innerText(), '你忙，我陪着。');
    // Cold-page fallback: no WebGL still renders the selected image and all content.
    const fallback = await browser.newPage({ colorScheme: 'light' });
    await fallback.addInitScript(() => {
      localStorage.setItem('umami.disabled', '1');
      localStorage.setItem('emotion-ball-site-theme', 'dark');
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl' ? null : original.call(this, type, ...args); };
    });
    await fallback.goto(base);
    await fallback.waitForFunction(() => document.documentElement.dataset.sceneState === 'ready');
    assert.equal(await fallback.locator('.scene-material').getAttribute('data-state'), 'static');
    assert.ok(await fallback.locator('[data-motion-control]').isDisabled());
    assert.ok(await fallback.locator('.download-button').isVisible());
    await fallback.route('**/home.js*', route => route.abort());
    await fallback.reload();
    assert.equal(await fallback.locator('.scene-image').evaluate(e => e.currentSrc.split('/').pop()), 'hero-night-v2.webp', 'saved dark asset is correct before home.js');
    assert.equal(await fallback.locator('html').getAttribute('data-theme'), 'dark');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'pointer-checks.json'), JSON.stringify({ automatic, actualPixelRefraction: true, calmCenter: true, boundedAndRemoved: true, fixedText: true, pixelBudget: true, pausedFrameFrozen: true, reducedMotion: true, touchExcluded: true, themeAssetsAndIcons: true, storedAndSystemTheme: true, contextLossAndRestore: true, noWebGLFallback: true, noScriptSavedAppearance: true, nightPetTouch: true, errors }, null, 2));
    console.log('Material pixels, pause, budgets, theme, reduced motion and fallback checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
