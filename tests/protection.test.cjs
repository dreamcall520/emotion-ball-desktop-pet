const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'site-protection.js'), 'utf8');

test('embedding checks every ancestor and leaves normal navigation and local demos available', () => {
  for (const origins of [[], ['https://qiuqiu.pet'], ['https://qiuqiu.pet', 'https://qiuqiu.pet'],
    ['http://127.0.0.1:8890'], ['https://elsewhere.example'], [null],
    ['https://qiuqiu.pet', null], [null, 'https://qiuqiu.pet']]) {
    const origin = origins[0]?.startsWith('http://127.') ? origins[0] : 'https://qiuqiu.pet';
    const calls = [];
    const window = { location: { origin, replace: url => calls.push(url) } };
    let previous = window;
    for (const value of origins) {
      const ancestor = {};
      Object.defineProperty(ancestor, 'location', { get() {
        if (value === null) throw new Error('cross-origin access denied');
        return { origin: value };
      }});
      previous.parent = ancestor;
      previous = ancestor;
    }
    previous.parent = previous;
    vm.runInNewContext(code, { window, location: window.location, URL,
      document: { currentScript: { src: `${origin}/site-protection.js?v=1` }, addEventListener() {} } });
    assert.deepEqual(calls, origins.some(value => value !== origin) ? [`${origin}/embed-blocked.html`] : []);
  }

  const pages = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html'));
  for (const file of pages) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    if (!html.includes('<head>') || file === 'embed-blocked.html') continue;
    const src = html.match(/<script src="([^"]*site-protection\.js)[^"]*"><\/script>/)?.[1];
    assert.ok(src, `${file} has an embedding guard`);
    assert.equal(path.resolve(root, path.dirname(file), src), path.join(root, 'site-protection.js'));
    assert.ok(html.indexOf('site-protection.js') < html.indexOf('<body'), `${file} checks before rendering`);
  }
});
