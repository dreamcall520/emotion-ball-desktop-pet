const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../home.js'), 'utf8');
const controller = source.slice(source.indexOf('  function stopped()'), source.indexOf('  function setTheme('));
assert.ok(controller.includes('function reconcile()'));
const handlers = {}, attributes = {}, icon = {};
const root = { classList: { toggle: (name, value) => { root[name] = value; } } };
const reduced = { matches: false, addEventListener: (name, fn) => { handlers.media = fn; } };
const document = { hidden: false, addEventListener: (name, fn) => { handlers[name] = fn; } };
const motionButton = {
  addEventListener: (name, fn) => { handlers[name] = fn; },
  setAttribute: (name, value) => { attributes[name] = value; },
  querySelector: () => ({ setAttribute: (name, value) => { icon[name] = value; } }),
};
// No WebGL or background image: the independent CSS border must still pause.
vm.runInNewContext(controller + '\nreconcile();', {
  root, reduced, document, motionButton, canvas: { dataset: {} },
  image: { complete: true, naturalWidth: 0 }, gl: null, texture: null,
  paused: false, frame: 0, lastFrame: 0, waves: [], cancelAnimationFrame() {},
});
assert.equal(motionButton.disabled, false);
assert.equal(attributes['aria-label'], '暂停动效');
handlers.click();
assert.equal(root['motion-paused'], true);
assert.equal(attributes['aria-pressed'], 'true');
assert.equal(attributes['aria-label'], '继续动效');
assert.equal(icon.href, '#icon-play');
handlers.click();
assert.equal(root['motion-paused'], false);
document.hidden = true;
handlers.visibilitychange();
assert.equal(root['motion-paused'], true);
document.hidden = false;
reduced.matches = true;
handlers.media();
assert.equal(root['motion-paused'], true);
assert.equal(motionButton.disabled, true);
assert.equal(attributes['aria-label'], '已减少动态');
reduced.matches = false;
handlers.media();
assert.equal(root['motion-paused'], false);
assert.equal(motionButton.disabled, false);
console.log('PASS: CSS border pause/resume, hidden page and reduced motion survive static background fallback.');
