// standalone-redirect
{
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../product/index.html');
const html = fs.readFileSync(file, 'utf8');
const source = html.match(/<script data-standalone-redirect>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'Standalone redirect script exists');

function load(hash) {
  const calls = [];
  const listeners = {};
  const location = {
    href: `http://127.0.0.1:8860/product/?v=review${hash}`,
    search: '?v=review',
    hash,
    replace: url => calls.push(url),
  };
  vm.runInNewContext(source, { URL, location, window: {
    addEventListener: (event, handler) => { listeners[event] = handler; },
  } });
  return { calls, location, listeners };
}

for (const [hash, destination] of [['#privacy', 'privacy'], ['#updates', 'updates']]) {
  const initial = load(hash);
  assert.deepEqual(initial.calls, [`http://127.0.0.1:8860/${destination}/?v=review`]);
  const changed = load('#features');
  assert.deepEqual(changed.calls, []);
  changed.location.hash = hash;
  changed.listeners.hashchange();
  assert.deepEqual(changed.calls, [`http://127.0.0.1:8860/${destination}/?v=review`]);
}
for (const hash of ['', '#features', '#download', '#unknown']) {
  const page = load(hash);
  page.listeners.hashchange();
  assert.deepEqual(page.calls, []);
}
console.log('PASS: initial and changed privacy/updates anchors preserve query; ordinary anchors stay on product.');
}

// demo-theme
{
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../demo-embed.js');
const source = fs.readFileSync(file, 'utf8');
const themeSource = source.match(/function theme\(frame\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(themeSource, 'Shared frame theme function exists');
const system = { matches: false };
const document = { documentElement: { dataset: { theme: 'light' } } };
const theme = vm.runInNewContext(`(${themeSource})`, { system, document });
const frame = preview => ({ closest: () => preview });
const regular = frame(null);
const preview = { dataset: { look: 'light', mode: 'standard' } };
const controlled = frame(preview);
const packet = target => JSON.parse(JSON.stringify(theme(target)));

for (const pageTheme of ['light', 'dark', undefined]) {
  document.documentElement.dataset.theme = pageTheme;
  for (const systemDark of [false, true]) {
    system.matches = systemDark;
    assert.deepEqual(packet(regular), {
      type: 'qiuqiu-demo-theme', appearance: 'light', colorMode: 'standard', uiTheme: 'blue',
    });
    for (const look of ['light', 'dark', 'system']) {
      for (const mode of ['standard', 'accessible']) {
        for (const uiTheme of ['green', 'blue', undefined, 'invalid']) {
          Object.assign(preview.dataset, { look, mode, uiTheme });
          assert.deepEqual(packet(controlled), {
            type: 'qiuqiu-demo-theme',
            appearance: look === 'system' ? (systemDark ? 'dark' : 'light') : look,
            colorMode: mode,
            uiTheme: uiTheme === 'green' ? 'green' : 'blue',
          });
        }
      }
    }
  }
}
assert.ok(!source.includes("observe(document.documentElement"), 'Page theme no longer triggers frame sync');
assert.ok(source.includes("attributeFilter: ['data-look', 'data-mode', 'data-ui-theme']"), 'Manual controls still sync');
assert.ok(source.includes("system.addEventListener('change', sync)"), 'Preview system choice still syncs');
console.log('PASS: ordinary frames stay light/blue; preview theme, appearance and contrast stay independent.');
}

// notes-scope
{
// Source/VM check only; browser navigation timing is verified separately.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const candidate = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(candidate, 'demos/notes/embed.js'), 'utf8');
const html = fs.readFileSync(path.join(candidate, 'product/index.html'), 'utf8');
const tags = [...html.matchAll(/<iframe\b[^>]*data-notes-frame="(?:panel|desktop)"[^>]*>/g)].map(match => Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]])));
assert.equal(tags.length, 2, 'Both notes frames must exist');
tags.forEach(attrs => { assert.ok(attrs['data-src']); assert.equal(attrs.src, undefined, 'HTML must not launch an unscoped notes URL'); });
const location = { href: 'https://qiuqiu.pet/product/', origin: 'https://qiuqiu.pet' };
function element() { return { hidden: false, textContent: '', handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } }; }
function frame(attrs, legacy) {
  attrs = { ...attrs };
  if (legacy) { attrs.src = attrs['data-src']; delete attrs['data-src']; }
  const result = { ...element(), attrs, writes: 0, sent: [], style: {}, getAttribute(name) { return this.attrs[name] ?? null; } };
  result.contentWindow = { postMessage(packet, origin) { result.sent.push({ packet, origin }); } };
  Object.defineProperty(result, 'src', {
    get() { return attrs.src ? new URL(attrs.src, location.href).href : ''; },
    set(value) { attrs.src = String(value); result.writes++; }
  });
  return result;
}
function check(legacy) {
  const panel = frame(tags.find(attrs => attrs['data-notes-frame'] === 'panel'), legacy);
  const desktop = frame(tags.find(attrs => attrs['data-notes-frame'] === 'desktop'), legacy);
  const status = element(), reset = element(), reminder = element(), reopen = element(), reopenPanel = element();
  const items = new Map([
    ['iframe[data-notes-frame="panel"]', panel], ['iframe[data-notes-frame="desktop"]', desktop],
    ['[data-notes-native-status]', status], ['[data-notes-demo-reset]', reset],
    ['[data-notes-demo-reminder]', reminder], ['[data-notes-reopen-note]', reopen], ['[data-notes-reopen-panel]', reopenPanel]
  ]);
  let onMessage;
  vm.runInNewContext(code, {
    document: { querySelectorAll(selector) { assert.equal(selector, '[data-notes-native-demo]'); return [{ querySelector: selector => items.get(selector) }]; } },
    window: { addEventListener(name, fn) { assert.equal(name, 'message'); onMessage = fn; } },
    location, URL, crypto: { randomUUID }
  }, { filename: path.join(candidate, 'demos/notes/embed.js'), timeout: 1000 });
  const scopeOf = target => new URL(target.src).searchParams.get('demoScope');
  const initial = scopeOf(panel);
  assert.ok(initial); assert.equal(scopeOf(desktop), initial);
  assert.equal(new URL(panel.src).pathname, '/demos/notes/panel.html');
  assert.equal(new URL(desktop.src).pathname, '/demos/notes/desktop.html');
  assert.equal(new URL(panel.src).searchParams.get('v'), new URL(tags.find(attrs => attrs['data-notes-frame'] === 'panel')['data-src'], location.href).searchParams.get('v'));
  assert.equal(panel.writes, 1); assert.equal(desktop.writes, 1);
  const packet = { type: 'qiuqiu-notes-demo', scope: initial, from: 'desktop', kind: 'request', method: 'load', requestId: 'probe' };
  onMessage({ origin: location.origin, source: desktop.contentWindow, data: packet });
  assert.equal(panel.sent.length, 1, 'Valid desktop load must reach panel');
  assert.equal(panel.sent[0].packet.requestId, 'probe');
  assert.equal(panel.sent[0].origin, location.origin);
  const snapshot = () => JSON.stringify([panel.src, desktop.src, panel.writes, desktop.writes, panel.sent, desktop.sent, status.textContent, panel.hidden, desktop.hidden]);
  const before = snapshot();
  for (const event of [
    { origin: 'https://stranger.example', source: desktop.contentWindow, data: packet },
    { origin: location.origin, source: {}, data: packet },
    { origin: location.origin, source: desktop.contentWindow, data: { ...packet, scope: 'stranger' } },
    { origin: location.origin, source: desktop.contentWindow, data: { ...packet, from: 'panel' } },
    { origin: location.origin, source: desktop.contentWindow, data: { ...packet, type: 'stranger' } }
  ]) { onMessage(event); assert.equal(snapshot(), before, 'Untrusted packet must have no effect'); }
  reset.handlers.click();
  const next = scopeOf(panel);
  assert.notEqual(next, initial); assert.equal(scopeOf(desktop), next);
  assert.equal(panel.writes, 2); assert.equal(desktop.writes, 2);
  const afterReset = snapshot();
  onMessage({ origin: location.origin, source: desktop.contentWindow, data: packet });
  assert.equal(snapshot(), afterReset, 'Previous scope must be rejected after reset');
}
check(false);
check(true);
console.log('PASS: data-src single scoped initialization, legacy src fallback, reset rotation, valid relay and untrusted-message rejection');
}

// license-controller
{
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.resolve(__dirname, '../product/index.html'), 'utf8');
const code = page.match(/<script data-license-controller>([\s\S]*?)<\/script>/)[1];
const handlers = {};
const dialog = {
  open: false,
  showModal() { this.open = true; },
  close() { this.open = false; },
  getBoundingClientRect() { return { left: 100, right: 300, top: 100, bottom: 240 }; },
  addEventListener(type, fn) { handlers[`dialog:${type}`] = fn; }
};
const button = { addEventListener(type, fn) { handlers[`button:${type}`] = fn; } };
vm.runInNewContext(code, { document: { querySelector(selector) {
  assert.ok(['#license-dialog', '[data-license-open]'].includes(selector));
  return selector === '#license-dialog' ? dialog : button;
} } });

handlers['button:click']();
assert.equal(dialog.open, true, 'license entry opens modal');
for (const [x, y] of [[150, 150], [100, 100], [300, 240]]) {
  handlers['dialog:click']({ target: dialog, clientX: x, clientY: y });
  assert.equal(dialog.open, true, 'inside and edge clicks keep modal open');
}
handlers['dialog:click']({ target: {}, clientX: 0, clientY: 0 });
assert.equal(dialog.open, true, 'child click does not dismiss modal');
for (const [x, y] of [[99, 150], [301, 150], [150, 99], [150, 241]]) {
  handlers['dialog:click']({ target: dialog, clientX: x, clientY: y });
  assert.equal(dialog.open, false, 'backdrop click dismisses modal');
  handlers['button:click']();
}
console.log('PASS: controller syntax, open, inside, edge, child and four backdrop directions. Native Esc, form close and focus behavior require browser verification.');
}

// Homepage and .html compatibility URLs keep queries and destination anchors.
{
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const home = fs.readFileSync(path.join(__dirname, '../home.js'), 'utf8');
const source = home.slice(home.indexOf('  const oldSections ='), home.indexOf('  const image ='));
const legacy = fs.readFileSync(path.join(__dirname, '../product.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
for (const hash of ['#privacy', '#updates', '#download', '#install', '#unknown', '']) {
  for (const compatibility of [false, true]) {
    const calls = [], listeners = {};
    const location = { href: `https://qiuqiu.pet/${compatibility ? 'product.html' : ''}?v=check${hash}`, search: '?v=check', hash,
      replace: value => calls.push(new URL(value, location.href).href) };
    vm.runInNewContext(compatibility ? legacy : source, { URL, location, window: { addEventListener: (name, fn) => { listeners[name] = fn; } } });
    const standalone = { '#privacy': 'privacy/', '#updates': 'updates/' }[hash];
    const ordinary = ['#download', '#install'].includes(hash);
    const expected = standalone ? `https://qiuqiu.pet/${standalone}?v=check` : compatibility || ordinary ? `https://qiuqiu.pet/product/?v=check${hash}` : null;
    assert.deepEqual(calls, expected ? [expected] : []);
    if (!compatibility) {
      calls.length = 0;
      location.hash = '#privacy';
      listeners.hashchange();
      assert.deepEqual(calls, ['https://qiuqiu.pet/privacy/?v=check']);
    }
  }
}
console.log('PASS: homepage and .html legacy links preserve queries and ordinary section anchors.');
}
