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
    async function freezeBlink(state) {
      await page.waitForFunction(expected => {
        if (document.querySelector('.scene-material').dataset.blink !== expected) return false;
        document.querySelector('[data-motion-control]').click(); return true;
      }, state, {polling:'raf'});
      await page.waitForTimeout(120);
    }
    async function sourceClip(x, y, width, height) {
      return page.evaluate(rect => {
        const image=document.querySelector('.scene-image'), box=image.getBoundingClientRect();
        const scale=Math.max(box.width/image.naturalWidth,box.height/image.naturalHeight);
        const position=getComputedStyle(image).objectPosition.split(' ').map(v=>parseFloat(v)/100);
        const left=Math.max(0,Math.floor(box.left-(image.naturalWidth*scale-box.width)*position[0]+rect.x*scale));
        const top=Math.max(0,Math.floor(box.top-(image.naturalHeight*scale-box.height)*position[1]+rect.y*scale));
        return {x:left,y:top,width:Math.min(innerWidth-left,Math.ceil(rect.width*scale)),height:Math.min(innerHeight-top,Math.ceil(rect.height*scale))};
      },{x,y,width,height});
    }
    const automatic = [];
    for (const width of [1440, 390]) for (const scheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await page.goto(base);
      await page.waitForFunction(() => document.querySelector('.scene-material').dataset.state === 'running');
      const clip = width === 1440 ? {x:70,y:610,width:330,height:150} :
        {x:275,y:scheme === 'dark' ? 470 : 100,width:90,height:70};
      const faceClip = await sourceClip(1305,735,60,30); // Skin below both eyes, within the protected body.
      const first = await page.screenshot({clip});
      const face = await page.screenshot({clip:faceClip});
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-0.png`)});
      await page.waitForTimeout(1600);
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-1.png`)});
      await page.waitForTimeout(1600);
      assert.notDeepEqual(await page.screenshot({clip}), first, `${width}/${scheme}: glass visibly changes without mouse input`);
      assert.ok((await page.screenshot({clip:faceClip})).equals(face), `${width}/${scheme}: face remains stable`);
      assert.equal(await page.locator('.scene-material').getAttribute('data-waves'), '0');
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-2.png`)});
      const eyeClip = await sourceClip(1220,scheme==='dark'?600:542,275,160);
      await freezeBlink('open');
      const openEyes = await page.screenshot({clip:eyeClip});
      await page.locator('[data-motion-control]').click();
      await freezeBlink('closed');
      assert.notDeepEqual(await page.screenshot({clip:eyeClip}), openEyes, `${width}/${scheme}: eyes close`);
      await page.screenshot({path:path.join(out, `blink-${width}-${scheme}-closed.png`)});
      const closed = await page.screenshot({clip:eyeClip});
      await page.waitForTimeout(350);
      const held = await page.screenshot({clip:eyeClip});
      if (!held.equals(closed)) {
        fs.writeFileSync(path.join(out, `paused-${width}-${scheme}-first.png`),closed);
        fs.writeFileSync(path.join(out, `paused-${width}-${scheme}-held.png`),held);
      }
      assert.ok(held.equals(closed), `${width}/${scheme}: pause also freezes blinking`);
      await page.locator('[data-motion-control]').click();
      await freezeBlink('open');
      assert.deepEqual(await page.screenshot({clip:eyeClip}), openEyes, `${width}/${scheme}: original open eyes return unchanged`);
      await page.locator('[data-motion-control]').click();
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-material')).display === 'none');
      await page.screenshot({path:path.join(out, `auto-${width}-${scheme}-static.png`)});
      automatic.push({width,scheme,withoutPointer:true,faceStable:true,blinkClosesAndRestores:true,blinkPause:true});
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
    for (const [x,y] of [[430,450], [800,690]]) {
      const clip = {x:x-45,y:y-45,width:90,height:90};
      const calm = await page.screenshot({clip});
      await page.mouse.move(x,y); await page.waitForTimeout(180);
      assert.notDeepEqual(await page.screenshot({clip}), calm, 'plain background outside the glass responds to the pointer');
    }
    for (let i = 0; i < 9; i++) { await page.mouse.move(270 + i * 40, 600 - i * 8); await page.waitForTimeout(150); }
    assert.ok(Number(await material.getAttribute('data-waves')) <= 3);
    assert.deepEqual(await bounds(), before);
    assert.equal(await page.locator('.water-ripple').count(), 0, 'no floating decorative rings');
    assert.ok(await material.evaluate(e => e.width * e.height <= 1303000));
    await page.screenshot({ path: path.join(out, 'material-water-desktop.png') });
    await page.waitForTimeout(2600);
    assert.equal(await material.getAttribute('data-waves'), '0');
    await page.mouse.move(645, 625); await page.waitForTimeout(2600);
    const clickClip = {x:600,y:590,width:90,height:90};
    const beforeClick = await page.screenshot({clip:clickClip});
    await page.mouse.click(645, 625);
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.waves === '1');
    assert.equal(await material.getAttribute('data-waves'), '1', 'click at a stationary pointer creates a new wave');
    await page.waitForTimeout(180);
    assert.notDeepEqual(await page.screenshot({clip:clickClip}), beforeClick, 'click visibly changes background pixels');
    for (let i=0; i<5; i++) await page.mouse.click(645,625);
    await page.waitForFunction(() => document.querySelector('.scene-material').dataset.waves === '3');
    assert.equal(await material.getAttribute('data-waves'), '3', 'repeated clicks share the existing wave budget');
    await page.screenshot({path:path.join(out,'click-water-desktop.png')});
    await page.waitForTimeout(2600);
    assert.equal(await material.getAttribute('data-waves'), '0');
    await page.locator('[data-motion-control]').click();
    assert.equal(await material.getAttribute('data-state'), 'paused');
    const paused = await page.screenshot({ clip: { x: 20, y: 90, width: 1400, height: 720 } });
    await page.mouse.move(900, 680); await page.mouse.click(900, 680); await page.waitForTimeout(350);
    assert.equal(await material.getAttribute('data-waves'), '0', 'pause also stops click ripples');
    assert.deepEqual(await page.screenshot({ clip: { x: 20, y: 90, width: 1400, height: 720 } }), paused, 'paused frame remains frozen');
    await page.locator('[data-motion-control]').click();
    await page.mouse.move(500, 600);
    await page.waitForFunction(() => Number(document.querySelector('.scene-material').dataset.waves) > 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('[data-motion-control]').disabled);
    assert.ok(await page.locator('[data-motion-control]').isDisabled());
    assert.equal(await material.getAttribute('data-waves'), '0');
    await page.mouse.click(645,625);
    assert.equal(await material.getAttribute('data-waves'), '0', 'reduced motion excludes click ripples');
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
    await sceneAsset('hero-night-v2.webp');
    assert.equal(await page.locator('[data-theme-control] use').getAttribute('href'), '#icon-moon');
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
    // Control only the RNG so both single and double blink scheduling are checked without flaky probability.
    const rhythm = await browser.newPage({viewport:{width:640,height:700}});
    await rhythm.addInitScript(() => {
      localStorage.setItem('umami.disabled','1');
      const values=[0,.1,.8,.9,.2]; let index=0;
      Math.random=()=>values[index++ % values.length];
    });
    await rhythm.goto(base);
    const closedTimes=[];
    for (let i=0;i<3;i++) {
      const time=await rhythm.waitForFunction(() => {
        const canvas=document.querySelector('.scene-material');
        if(canvas.dataset.blink!=='closed') return false;
        const gl=canvas.getContext('webgl'), program=gl.getParameter(gl.CURRENT_PROGRAM);
        return gl.getUniform(program,gl.getUniformLocation(program,'time'));
      },null,{polling:'raf'});
      closedTimes.push(await time.jsonValue());
      await rhythm.waitForFunction(()=>document.querySelector('.scene-material').dataset.blink==='open');
    }
    assert.ok(closedTimes[1]-closedTimes[0]>.4 && closedTimes[1]-closedTimes[0]<.52, 'double blink includes a brief reopening');
    assert.ok(closedTimes[2]-closedTimes[1]>2.9 && closedTimes[2]-closedTimes[1]<3.4, 'next blink uses the randomized interval');
    await rhythm.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'pointer-checks.json'), JSON.stringify({ automatic, randomAndDoubleBlink: {closedTimes}, actualPixelRefraction: true, clickPixelRefraction: true, calmCenter: true, boundedAndRemoved: true, fixedText: true, pixelBudget: true, pausedFrameFrozen: true, reducedMotion: true, touchExcluded: true, themeAssetsAndIcons: true, storedAndSystemTheme: true, contextLossAndRestore: true, noWebGLFallback: true, noScriptSavedAppearance: true, nightPetTouch: true, errors }, null, 2));
    console.log('Material pixels, pause, budgets, theme, reduced motion and fallback checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
