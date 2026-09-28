const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const element = () => ({ dataset: {}, style: {}, handlers: {}, checked: false,
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
  emit(type) { (this.handlers[type] || []).forEach(fn => fn()); },
  setAttribute() {}, getBoundingClientRect: () => ({ width: 108 }) });
const root = element(), edge = element(), touch = element(), toggle = element(), area = element();
root.dataset.motionScene = 'feature';
root.querySelector = selector => ({ '[data-desktop-edge]': edge, '[data-pet-touch]': touch,
  '[data-motion-toggle]': toggle, '.motion-stage': area })[selector] || element();
root.querySelectorAll = () => [];
const ball = { renderStatic() {}, setEmotion(id) { this.emotion = id; }, setActive() {}, clearGaze() {},
  setMotionFrame(frame) { this.frame = frame; }, destroy() {} };
const flow = { stop() {}, destroy() {}, getState: () => ({}) };
const window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  EmotionBall: { config: { list: () => [], register() {}, get: () => ({ raw: { body: {} } }) }, create: () => ball },
  QiuqiuInteractionPreview: { stop() {}, durations: {} },
  QiuqiuDialoguePreview: { pick: () => null }, ThoughtFlowPreview: { create: () => flow } };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../motion-showcase.js'), 'utf8'), {
  window, ThoughtFlowPreview: window.ThoughtFlowPreview, console, setTimeout, clearTimeout,
  document: { hidden: false, querySelectorAll: () => [root], addEventListener() {} },
  IntersectionObserver: class { observe() {} disconnect() {} }
});
edge.checked = true; edge.emit('change');
assert.equal(root.dataset.edgeTucked, 'true');
assert.equal(ball.frame.body.rotate, 0);
assert.equal(ball.emotion, '55');
assert.equal(window.QiuqiuWebsiteMotion.getState()[0].autoplay, false);
assert.equal(window.QiuqiuWebsiteMotion.getState()[0].timers, 0);
touch.emit('pointerenter');
assert.equal(root.dataset.edgeTucked, 'false');
assert.equal(ball.frame.body.rotate, 0);
touch.emit('pointerleave');
assert.equal(root.dataset.edgeTucked, 'true');
touch.emit('click');
assert.equal(edge.checked, false);
assert.equal(root.dataset.edgeTucked, 'false');
edge.checked = true; edge.emit('change');
edge.checked = false; edge.emit('change');
assert.equal(root.dataset.edgeTucked, 'false');
console.log('Edge preview: inward pose, paused autoplay, hover restore and manual exit passed');
