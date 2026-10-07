const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const site = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(site, file), 'utf8');
const origin = 'https://qiuqiu.pet';

// Published palette bytes and every native document use the shared adapter.
for (const file of JSON.parse(read('demos/theme-source-manifest.json')).files) {
  assert.equal(crypto.createHash('sha256').update(read(`demos/${file.target}`)).digest('hex'), file.sha256);
}
for (const folder of ['chat', 'notes', 'customize', 'quota']) {
  for (const file of fs.readdirSync(path.join(site, 'demos', folder)).filter(file => file.endsWith('.html') && !(folder === 'quota' && file === 'index.html'))) {
    const html = read(`demos/${folder}/${file}`);
    if (!html.startsWith('<!doctype html>')) continue;
    assert.match(html, /data-ui-theme="blue"/);
    assert.match(html, /src="..\/ui-theme.js/);
    assert.match(html, /href="..\/ui-theme-blue.css(?:\?[^\"]*)?"/);
  }
}
const parent = { postMessage() {} }, handlers = {}, root = { dataset: {} };
vm.runInNewContext(read('demos/ui-theme.js'), {
  document: { documentElement: root }, parent, location: { origin },
  window: { addEventListener: (name, fn) => { handlers[name] = fn; } },
});
assert.equal(root.dataset.uiTheme, 'blue');
const theme = { type: 'qiuqiu-demo-theme', appearance: 'dark', colorMode: 'accessible', uiTheme: 'green' };
for (const event of [{ source: {}, origin, data: theme }, { source: parent, origin: 'https://foreign.test', data: theme }, { source: parent, origin, data: { ...theme, uiTheme: 'invalid' } }]) handlers.message(event);
assert.equal(root.dataset.uiTheme, 'blue', 'Untrusted and invalid palette messages are ignored');
handlers.message({ source: parent, origin, data: theme });
assert.equal(root.dataset.uiTheme, 'green');
handlers.message({ source: parent, origin, data: { ...theme, uiTheme: 'blue' } });
assert.equal(root.dataset.uiTheme, 'blue');

// Execute the composite quota frame: palette reaches children on ready/reload.
const nodes = new Map(), quotaHandlers = {};
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    dataset: {}, style: {}, clientWidth: 196, parentElement: { style: {} }, sent: [],
    addEventListener() {}, setAttribute() {}, getBoundingClientRect: () => ({ height: 500 }),
  });
  const item = nodes.get(id);
  item.contentWindow ||= { postMessage: (packet, targetOrigin) => item.sent.push({ packet, targetOrigin }) };
  return item;
}
vm.runInNewContext(read('demos/quota/demo.js'), {
  document: { documentElement: { dataset: {} }, getElementById: node, querySelector: node, querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener: (name, fn) => { quotaHandlers[name] = fn; } },
  parent, location: { origin, search: '?appearanceDemo=1' }, URLSearchParams,
  requestAnimationFrame() {}, ResizeObserver: class { observe() {} },
});
const child = node('api-report-frame');
const ready = () => quotaHandlers.message({ origin, source: child.contentWindow, data: { type: 'qiuqiu-quota-action', kind: 'api-report', action: 'ready' } });
const lastTheme = () => child.sent.filter(row => row.packet.type === 'qiuqiu-demo-theme').at(-1);
ready();
assert.equal(lastTheme().packet.uiTheme, 'blue');
quotaHandlers.message({ origin, source: parent, data: theme });
assert.equal(lastTheme().packet.uiTheme, 'green');
assert.equal(lastTheme().packet.appearance, 'dark');
assert.equal(lastTheme().packet.colorMode, 'accessible');
ready();
assert.equal(lastTheme().packet.uiTheme, 'green', 'Reloaded child retains the chosen theme');
quotaHandlers.message({ origin, source: parent, data: { ...theme, uiTheme: 'invalid' } });
assert.equal(lastTheme().packet.uiTheme, 'green');
quotaHandlers.message({ origin, source: {}, data: { ...theme, uiTheme: 'blue' } });
quotaHandlers.message({ origin: 'https://foreign.test', source: parent, data: { ...theme, uiTheme: 'blue' } });
assert.equal(lastTheme().packet.uiTheme, 'green');
assert.equal(lastTheme().targetOrigin, origin);

// Controls expose the active theme independently of appearance and contrast.
const button = value => ({ dataset: { apTheme: value }, setAttribute(name, value) { this[name] = value; } });
const contrast = { checked: false, matches: selector => selector === '[data-ap-contrast]' };
const buttons = [button('blue'), button('green')], controls = { dataset: { uiTheme: 'blue', look: 'light', mode: 'standard' }, contains: value => buttons.includes(value), querySelector: () => contrast, querySelectorAll: selector => selector === '[data-ap-theme]' ? buttons : [], addEventListener: (name, fn) => { handlers[name] = fn; } };
vm.runInNewContext(read('appearance-showcase.js'), { document: { querySelector: () => controls } });
assert.equal(buttons[0]['aria-pressed'], 'true');
handlers.click({ target: { closest: () => buttons[1] } });
assert.equal(buttons[1]['aria-pressed'], 'true');
assert.deepEqual(controls.dataset, { uiTheme: 'green', look: 'light', mode: 'standard' });
contrast.checked = true;
handlers.change({ target: contrast });
assert.deepEqual(controls.dataset, { uiTheme: 'green', look: 'light', mode: 'accessible' });
contrast.checked = false;
handlers.change({ target: contrast });
assert.equal(controls.dataset.mode, 'standard');
console.log('PASS: published palette hashes, trusted theme changes, nested reload sync and independent controls.');
