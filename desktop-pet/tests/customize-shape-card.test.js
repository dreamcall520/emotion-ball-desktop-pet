const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('四种形态卡使用实际图标，幻彩保持六瓣', async () => {
  class Node {
    constructor(name) {
      this.name = name; this.children = []; this.attributes = {}; this.dataset = {};
      this.style = { setProperty() {} }; this.className = ''; this.value = ''; this.disabled = false;
      const classes = new Set();
      this.classList = {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value)
      };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener() {}
    querySelector(name) { return this.findAll(name)[0] || null; }
    findAll(name) { return [...(this.name === name ? [this] : []), ...this.children.flatMap(child => child.findAll(name))]; }
  }
  const nodes = new Map();
  const document = {
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, new Node('div'));
      return nodes.get(id);
    },
    createElement: name => new Node(name),
    createElementNS: (_namespace, name) => new Node(name),
    createTextNode: text => new Node(`text:${text}`)
  };
  const window = { petCustomizer: { load: async () => ({ customization: null, size: 'tiny' }) }, addEventListener() {} };
  const context = vm.createContext({ window, document, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, clearTimeout() {}, setTimeout() {} });
  const renderCalls = [];
  const root = path.join(__dirname, '../..');
  for (const file of ['emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
    'desktop-pet/lib/customization.js', 'desktop-pet/customize-renderer.js']) {
    if (file === 'desktop-pet/customize-renderer.js') {
      context.PetCustomization = window.PetCustomization;
      context.EmotionBall = { create(target, options) {
        renderCalls.push(options);
        target.appendChild(new Node('svg'));
      } };
    }
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  await Promise.resolve();
  assert.equal(window.__customizerReady, true);
  const cards = nodes.get('shape-options').children;
  for (const [shape, bodyColor, eyeColor, eyeScale] of [
    ['blob', '#EEEBE4', '#1A1A1A', 1.5],
    ['cloud', '#5B3BC7', '#FFFFFF', 1],
    ['square', '#EEEBE4', '#1A1A1A', 1.5]
  ]) {
    const card = cards.find(node => node.dataset.shape === shape);
    const call = renderCalls.find(options => options.shape === shape);
    assert.ok(call, shape);
    assert.equal(call.color, bodyColor);
    assert.equal(call.eyeColor, eyeColor);
    assert.equal(call.eyeScale, eyeScale);
    assert.equal(call.facing, 'left', '与幻彩云预览保持同向');
    assert.equal(call.autostart, false);
    assert.equal(call.lite, true);
    assert.equal(card.findAll('svg')[0].attributes['aria-hidden'], 'true');
    assert.equal(shape === 'blob' ? call.customShape === null : !!call.customShape, true);
  }
  const card = cards.find(node => node.dataset.shape === 'aurora-cloud');
  const images = card.findAll('img');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, 'assets/aurora-six-lobe-icon.png');
  assert.equal(images[0].alt, '');
  assert.equal(fs.readFileSync(path.join(root, 'desktop-pet/assets/aurora-six-lobe-icon.png')).subarray(1, 4).toString(), 'PNG');
  const sixLobe = cards.find(node => node.dataset.shape === 'aurora-cloud' && node.dataset.auroraContour === 'six-lobe');
  assert.ok(sixLobe, '六瓣幻彩云有独立形态卡');
  assert.equal(sixLobe.findAll('img')[0].src, 'assets/aurora-six-lobe-icon.png');
  assert.equal(card.dataset.auroraContour, 'six-lobe');
  assert.equal(cards.filter(node => node.dataset.shape === 'aurora-cloud').length, 1);
  assert.equal(cards.length, 4);
});
