const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Rive activity survives pending load, visibility changes and reduced motion', async () => {
  const classes = new Set(), calls = [], svg = { isConnected: true, style: {} };
  const canvas = { dataset: {}, style: {}, setAttribute() {}, remove() {},
    classList: { add: name => classes.add(name), contains: name => classes.has(name) } };
  const container = { querySelector: () => svg, appendChild() {}, addEventListener() {},
    removeEventListener() {}, matches: () => true };
  let options, reduced = false;
  const hover = { name: 'isHover', value: false };
  const window = { BOO_ASSETS: { riv: 'AA==', wasm: 'AA==' },
    matchMedia: () => ({ matches: reduced }), addEventListener() {}, removeEventListener() {},
    rive: { RuntimeLoader: { setWasmBinary() {} }, Rive: class {
      constructor(value) { options = value; }
      resizeDrawingSurfaceToCanvas() {}
      stateMachineInputs() { return [{ name: 'clickIndex', value: 0 },
        { name: 'click', fire: () => calls.push('click') }, hover]; }
      pause() { calls.push('pause'); } play() { calls.push('play'); }
      cleanup() { calls.push('cleanup'); }
    } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/aurora-rive.js'), 'utf8'), {
    window, document: { createElement: () => canvas }, atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array, setTimeout: callback => callback(), console
  });
  const appearance = { shape: 'aurora-cloud', eyeScale: 1, eyeSpacing: 1, eyeHeight: 0,
    idleEyes: 'original', eyeColor: '#FFFFFF', auroraTransparency: 0 };
  const animation = window.AuroraRive.create(container, appearance, null, false);
  animation.setActive(false); options.onLoad(); await animation.whenReady();
  assert.equal(animation.ready(), true); assert.equal(calls.at(-1), 'pause');
  assert.equal(animation.click(), false); assert.equal(hover.value, false);
  animation.setActive(true); assert.equal(calls.at(-1), 'play'); assert.equal(hover.value, true);
  reduced = true; animation.setActive(true);
  assert.equal(calls.at(-1), 'pause'); assert.equal(animation.click(), false); assert.equal(hover.value, false);
  reduced = false; animation.setActive(true); assert.equal(animation.click(), true);
  animation.destroy(); const count = calls.length; animation.setActive(true);
  assert.equal(calls.length, count); assert.equal(calls.at(-1), 'cleanup');
});
