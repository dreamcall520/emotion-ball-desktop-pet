const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.QIUQIU_SITE_URL || 'http://127.0.0.1:4193/';
const out = process.env.QIUQIU_QA_OUTPUT || '/Users/allan/Documents/ChatGPT/F03｜球球桌面宠物/验收记录/意见反馈-20261011/local-web';
const endpoint = 'https://feedback.test.invalid/api/feedback';
const receipt = '36f60f54-ecb9-4c01-a281-111111111111';
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/zFEAAAAASUVORK5CYII=', 'base64');
const file = (name, buffer = png, mimeType = 'image/png') => ({ name, mimeType, buffer });
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('umami.disabled', '1');
    localStorage.setItem('emotion-ball-site-theme', 'auto');
  });
  let configured = false;
  const requests = [], errors = [], layouts = [], layoutFailures = [], checks = [];
  const responses = [
    { status: 503, body: { error: 'test-unavailable' } },
    { status: 200, body: { id: 'invalid-receipt' } },
    { status: 200, body: { id: receipt } },
    { status: 200, body: { id: receipt } }
  ];
  await context.route('**/feedback/config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.QIUQIU_FEEDBACK_CONFIG = ${JSON.stringify({ endpoint: configured ? endpoint : '' })};`
  }));
  await context.route(endpoint, async route => {
    requests.push(route.request().postDataJSON());
    const response = responses.shift();
    assert.ok(response, 'unexpected extra submission');
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.stack || error.message}`));
  page.on('dialog', dialog => dialog.accept());
  const inViewport = async locator => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  });
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
      for (const scheme of ['light', 'dark']) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.goto(new URL('feedback/', base).href);
        assert.equal(await page.title(), '意见反馈 · 球球桌宠');
        assert.ok(await page.locator('#submit').isDisabled());
        assert.match(await page.locator('#status').innerText(), /暂未开放/);
        assert.equal(await page.locator('#success').isVisible(), false);
        assert.equal(await page.locator('#version').getAttribute('autocomplete'), 'off');
        assert.equal(await page.locator('#os').getAttribute('autocomplete'), 'off');
        assert.match(await page.locator('#version').getAttribute('placeholder'), /关于球球/);
        assert.doesNotMatch(await page.locator('#version').getAttribute('placeholder'), /\d+\.\d+/);
        assert.ok(await inViewport(page.locator('header')));
        assert.ok(await inViewport(page.locator('.type-options')));
        const feedbackLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, background: getComputedStyle(document.body).backgroundColor }));
        assert.ok(feedbackLayout.scrollWidth <= width, `feedback overflow ${width}/${scheme}`);
        assert.equal(feedbackLayout.background, scheme === 'dark' ? 'rgb(17, 21, 27)' : 'rgb(251, 252, 254)');
        assert.equal(await page.locator('.feedback-entry').count(), 0);
        const brandStyle = await page.locator('.brand').evaluate(element => {
          const style = getComputedStyle(element), image = element.querySelector('img');
          return { size:style.fontSize, weight:style.fontWeight, gap:style.gap, imageWidth:image.getBoundingClientRect().width, imageLoaded:image.complete && image.naturalWidth > 0 };
        });
        assert.deepEqual(brandStyle, { size:width <= 680 ? '16px' : '19px', weight:'600', gap:width <= 680 ? '6px' : '9px', imageWidth:width <= 680 ? 27 : 32, imageLoaded:true });
        layouts.push({ page: 'feedback', height, scheme, ...feedbackLayout });
        await page.screenshot({ path: path.join(out, `feedback-${width}x${height}-${scheme}.png`), fullPage: true });

        for (const route of ['', 'product/', 'updates/', 'privacy/']) {
          await page.goto(new URL(route, base).href);
          const floating = page.locator('.feedback-entry');
          if (route) {
            assert.ok(await inViewport(floating), `${route} floating entry visible`);
            assert.equal(new URL(await floating.getAttribute('href'), page.url()).pathname, '/feedback/');
            assert.ok(await floating.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)); }), 'floating entry clickable');
          } else {
            assert.equal(await floating.count(), 0, 'home has no floating feedback entry');
          }
          if (route === 'updates/' || route === 'privacy/') {
            assert.deepEqual(await page.locator('.brand').evaluate(element => { const s=getComputedStyle(element), image=element.querySelector('img'); return {size:s.fontSize, weight:s.fontWeight, gap:s.gap, imageWidth:image.getBoundingClientRect().width, imageLoaded:image.complete && image.naturalWidth > 0}; }), brandStyle);
          }
          if (!route) {
            await page.waitForFunction(() => document.documentElement.dataset.sceneState === 'ready');
            if (width < 600) await page.locator('.mobile-nav summary').click();
          } else if (route === 'product/' || route === 'updates/') {
            await page.locator('.nav-toggle').click();
          }
          const links = page.getByRole('link', { name: '意见反馈', exact: true });
          assert.ok(await links.count() > 0, `${route || 'home'} feedback link exists`);
          const link = links.first();
          await link.scrollIntoViewIfNeeded();
          assert.ok(await inViewport(link), `${route || 'home'} feedback link fits ${width}/${scheme}`);
          assert.equal(new URL(await link.getAttribute('href'), page.url()).pathname, '/feedback/');
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(scrollWidth <= width, `${route || 'home'} overflow ${width}/${scheme}: ${scrollWidth}`);
          if (!route) {
            if (!await inViewport(page.locator('.home-footer'))) layoutFailures.push(`home footer outside ${width}x${height}/${scheme}`);
            assert.ok(await inViewport(page.locator('.home-footer a[href="feedback/"]')));
          }
          layouts.push({ page: route || 'home', width, height, scheme, scrollWidth });
          await page.screenshot({ path: path.join(out, `${route.replace('/', '') || 'home'}-feedback-link-${width}x${height}-${scheme}.png`) });
        }
      }
    }
    checks.push('30 desktop/mobile320/mobile390 light/dark layouts: no horizontal overflow; privacy, updates and feedback brands match; home retains footer feedback link without a floating entry; other floating links reach /feedback/; version input guides users to About and disables history autocomplete');
    for (const route of ['product/', 'updates/', 'privacy/']) {
      await page.goto(new URL(route, base).href);
      await page.locator('.feedback-entry').focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(new URL('feedback/', base).href);
      assert.equal(await page.title(), '意见反馈 · 球球桌宠');
    }
    checks.push('all three floating feedback entries work with keyboard Enter');
    assert.equal(requests.length, 0, 'unconfigured page never sends a feedback request');
    checks.push('unconfigured channel keeps submit disabled and never displays success');

    configured = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(new URL('feedback/', base).href);
    assert.ok(await page.locator('#submit').isEnabled());
    await page.locator('#submit').click();
    assert.equal(await page.locator('#title').evaluate(element => element.validity.valueMissing), true);
    assert.equal(requests.length, 0);
    await page.locator('#title').fill('   ');
    await page.locator('#detail').fill('   ');
    await page.locator('#submit').click();
    assert.match(await page.locator('#status').innerText(), /请填写标题和详细说明/);
    assert.equal(requests.length, 0);
    await page.locator('#title').fill('QA 测试：截图保留与重试');
    await page.locator('#detail').fill('这是本地拦截测试，不会提交真实用户数据。');
    await page.locator('input[value="feature"]').check();
    await page.locator('#contact').fill('qa@example.invalid');
    await page.locator('#version').fill('0.4.04');
    await page.locator('#os').fill('macOS test');
    const attachments = page.locator('#attachments');
    await attachments.setInputFiles(file('not-image.txt', Buffer.from('test'), 'text/plain'));
    assert.match(await page.locator('#status').innerText(), /请选择.*图片/);
    await attachments.setInputFiles(file('empty.png', Buffer.alloc(0)));
    assert.match(await page.locator('#status').innerText(), /大于 0 字节/);
    await attachments.setInputFiles(file('too-large.png', Buffer.alloc(1024 * 1024 + 1)));
    assert.match(await page.locator('#status').innerText(), /不超过 1 MB/);
    assert.equal(await page.locator('#attachment-list li').count(), 0);
    const boundary = Buffer.concat([png, Buffer.alloc(1024 * 1024 - png.length)]);
    await attachments.setInputFiles([file('boundary-1MiB.png', boundary), file('second.png'), file(`long-${'x'.repeat(100)}.png`)]);
    assert.equal(await page.locator('#attachment-list li').count(), 3);
    await page.waitForFunction(() => [...document.querySelectorAll('#attachment-list img')].every(image => image.complete && image.naturalWidth > 0));
    await attachments.setInputFiles(file('fourth.png'));
    assert.match(await page.locator('#status').innerText(), /最多选择 3 张/);
    assert.equal(await page.locator('#attachment-list li').count(), 3);
    await page.getByRole('button', { name: '移除截图 2', exact: true }).click();
    assert.equal(await page.locator('#attachment-list li').count(), 2);
    await attachments.setInputFiles(file('replacement.png'));
    assert.equal(requests.length, 0, 'choosing, previewing and removing files never uploads them');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long attachment filename wraps on mobile');
    checks.push('required/whitespace fields, supported image types, non-empty size, exact 1MiB boundary, 3-image limit and removal; files stay local before submit');

    await page.locator('#submit').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('提交失败'));
    const first = requests[0];
    assert.match(first.submissionId, uuid);
    assert.equal(first.source, 'website');
    assert.equal(first.type, 'feature');
    assert.equal(first.attachments.length, 3);
    assert.equal(Buffer.from(first.attachments[0].data, 'base64').length, 1024 * 1024);
    assert.equal(await page.locator('#title').inputValue(), first.title);
    assert.equal(await page.locator('#detail').inputValue(), first.detail);
    assert.equal(await page.locator('#attachment-list li').count(), 3);
    assert.equal(await page.locator('#success').isVisible(), false);
    await page.screenshot({ path: path.join(out, 'feedback-mobile-failed-preserved.png'), fullPage: true });
    await page.locator('#submit').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('未收到提交确认'));
    assert.equal(requests[1].submissionId, first.submissionId);
    assert.equal(await page.locator('#success').isVisible(), false, 'invalid receipt cannot show success');
    assert.equal(await page.locator('#attachment-list li').count(), 3);
    await page.locator('#submit').click();
    await page.locator('#success').waitFor({ state: 'visible' });
    assert.equal(requests[2].submissionId, first.submissionId);
    assert.equal(await page.locator('#feedback-form').isVisible(), false);
    assert.equal(await page.locator('#receipt').innerText(), `反馈编号：${receipt}`);
    await page.screenshot({ path: path.join(out, 'feedback-mobile-mock-success.png'), fullPage: true });
    checks.push('HTTP failure and invalid receipt preserve text/images; retries reuse submission UUID; only a valid UUID receipt shows success');

    await page.getByRole('button', { name: '再写一条', exact: true }).click();
    assert.equal(await page.locator('#title').inputValue(), '');
    assert.equal(await page.locator('#detail').inputValue(), '');
    assert.equal(await page.locator('#contact').inputValue(), '');
    assert.equal(await page.locator('#attachment-list li').count(), 0);
    assert.equal(await page.locator('#success').isVisible(), false);
    assert.equal(await page.locator('#title').evaluate(element => element === document.activeElement), true);
    await page.locator('#title').fill('QA 新一条');
    await page.locator('#detail').fill('清空后重新填写');
    await page.locator('#submit').click();
    await page.locator('#success').waitFor({ state: 'visible' });
    assert.notEqual(requests[3].submissionId, first.submissionId);
    assert.equal(requests[3].attachments.length, 0);
    assert.deepEqual(errors, []);
    checks.push('new feedback clears user fields and screenshots, returns focus and uses a new submission UUID');
    fs.writeFileSync(path.join(out, 'feedback-checks.json'), JSON.stringify({ base, mockOnly: true, note: 'Responses were intercepted locally; this does not verify the deployed backend or mainland connectivity.', layouts, checks, pageErrors: errors, layoutFailures, submissionCount: requests.length }, null, 2));
    assert.deepEqual(layoutFailures, []);
    console.log(`${layouts.length} layouts and ${checks.length} interaction groups passed; 4 mock submissions, no real feedback sent`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
