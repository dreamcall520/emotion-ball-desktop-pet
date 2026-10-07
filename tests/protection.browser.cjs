// NODE_PATH=<bundled node_modules> node tests/protection.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.QIUQIU_QA_OUTPUT;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
let site, foreign;
function serve(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const fixtures = {
    '/__test/same': `<iframe src="${site}/demos/quota/index.html"></iframe>`,
    '/__test/direct': `<iframe referrerpolicy="no-referrer" src="${site}/product/"></iframe>`,
    '/__test/nested': `<iframe src="${site}/__test/same"></iframe>`,
    '/__test/mixed': `<iframe src="${foreign}/__test/direct"></iframe>`,
    '/__test/sandbox': `<iframe sandbox="allow-scripts" src="${site}/demos/chat/index.html"></iframe>`,
  };
  if (fixtures[pathname]) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fixtures[pathname]);
    return;
  }
  let file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(root + path.sep) && file !== root) return response.writeHead(403).end();
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
}
(async () => {
  const servers = [http.createServer(serve), http.createServer(serve)];
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  [site, foreign] = servers.map(server => `http://127.0.0.1:${server.address().port}`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const width of [1440, 390, 320]) for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      for (const route of ['/', '/product/']) {
        await page.goto(site + route);
        await page.locator('[data-license-open]').click();
        const dialog = page.getByRole('dialog', { name: '署名与许可' });
        assert.ok(await dialog.isVisible());
        assert.match(await dialog.innerText(), /免费下载，无需付费激活/);
        assert.equal(await dialog.getByRole('link', { name: 'qiuqiu.pet', exact: true }).getAttribute('href'), 'https://qiuqiu.pet/');
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
        if (output && width === 390 && route === '/') {
          fs.mkdirSync(output, { recursive: true });
          await page.screenshot({ path: path.join(output, `license-${colorScheme}.png`) });
        }
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        const protection = await page.evaluate(() => {
          function copy(element, target = element) {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return !target.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
          }
          const image = document.querySelector('img');
          const result = {
            bodyCopyBlocked: copy(document.querySelector('main h1')),
            focusedLinkDoesNotBypassBodyRestriction: copy(document.querySelector('main h1'), document.querySelector('main a')),
            linkCopyAllowed: !copy(document.querySelector('main a')),
            licenseCopyAllowed: !copy(document.querySelector('#license-details')),
            imageMenuBlocked: !image.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
            imageDragBlocked: !image.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })),
            linkMenuAllowed: document.querySelector('main a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
          };
          getSelection().removeAllRanges();
          return result;
        });
        assert.ok(Object.values(protection).every(Boolean), JSON.stringify(protection));
      }
      checks.push(`license dialog, media/body restrictions and allowed links fit ${width}px/${colorScheme}`);
    }
    for (const route of ['/updates/', '/privacy/', '/product.html']) {
      await page.goto(site + route);
      assert.ok(!page.url().includes('embed-blocked'));
    }
    await page.goto(site + '/demos/chat/index.html');
    const input = page.locator('textarea').first();
    await input.fill('正常输入与复制');
    await input.selectText();
    assert.equal(await input.inputValue(), '正常输入与复制');
    assert.equal(await input.evaluate(element => element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }))), true);
    await page.goto(site + '/privacy/');
    assert.equal(await page.locator('main').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
    }), true);
    checks.push('top-level pages, compatibility route and chat input remain usable');
    await page.goto(site + '/__test/same');
    await page.waitForFunction(() => {
      const quota = document.querySelector('iframe').contentDocument;
      return quota && quota.querySelectorAll('iframe').length >= 4 &&
        [...quota.querySelectorAll('iframe')].every(frame => frame.contentDocument?.body.children.length);
    });
    assert.ok(page.frames().length >= 6);
    assert.ok(page.frames().every(frame => !frame.url().includes('embed-blocked')));
    checks.push('same-origin quota demo and four nested child frames load');
    for (const [origin, fixture] of [[foreign, 'direct'], [foreign, 'nested'], [site, 'mixed'], [foreign, 'sandbox']]) {
      const redirected = page.waitForEvent('framenavigated', { predicate: frame => frame.url().endsWith('/embed-blocked.html') });
      await page.goto(`${origin}/__test/${fixture}`);
      await redirected;
      const blocked = page.frames().find(frame => frame.url().endsWith('/embed-blocked.html'));
      assert.equal(await blocked.getByRole('link').getAttribute('href'), 'https://qiuqiu.pet/');
      checks.push(`external embedding redirects to official-source notice: ${fixture}`);
    }
    assert.deepEqual(errors, []);
    const result = { checks, errors };
    if (output) fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    for (const server of servers) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
