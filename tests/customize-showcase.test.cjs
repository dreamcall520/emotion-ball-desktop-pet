const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor(dataset = {}) {
    this.dataset = dataset; this.children = []; this.attributes = {}; this.events = {};
    this.style = { setProperty(key, value) { this[key] = value; } };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.events[event] = handler; }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  fire(event) { this.events[event](); }
}
const names = ['ball', 'body', 'eye', 'palette', 'styles', 'sizes', 'description', 'stage',
  'opacity', 'opacity-label', 'glow-label', 'style-note', 'startup', 'startup-note'];
const nodes = Object.fromEntries(names.map(name => [name, new Element()]));
nodes.body.value = '#eeebe4'; nodes.eye.value = '#1a1a1a'; nodes.opacity.value = '0';
const groups = {
  shape: ['blob', 'cloud', 'aurora', 'square'],
  size: ['large', 'desktop'], style: ['dimensional', 'simple']
};
for (const [kind, values] of Object.entries(groups)) groups[kind] = values.map(value =>
  new Element({ ['custom' + kind[0].toUpperCase() + kind.slice(1)]: value }));
const root = {
  querySelector: selector => nodes[selector.match(/data-custom-(.+)\]/)[1]],
  querySelectorAll: selector => groups[selector.match(/data-custom-(.+)\]/)[1]]
};
let created = 0, destroyed = 0;
const source = fs.readFileSync(path.join(__dirname, '../customize-showcase.js'), 'utf8');
vm.runInNewContext(source, {
  document: { querySelector: () => root, createElementNS: () => new Element() },
  window: { EmotionBall: { create() { created++; return { renderStatic() {}, destroy() { destroyed++; } }; } } }
});
assert.equal(created, 1);
for (const [index, shape] of ['blob', 'cloud', 'aurora', 'square'].entries()) {
  groups.shape[index].fire('click');
  assert.equal(groups.shape[index].attributes['aria-pressed'], 'true');
  assert.equal(groups.shape.filter(node => node.attributes['aria-pressed'] === 'true').length, 1);
  assert.equal(nodes.ball.hidden, shape === 'aurora');
  assert.equal(nodes.palette.hidden, shape !== 'aurora');
  assert.equal(nodes.styles.hidden, shape !== 'aurora');
  if (shape === 'aurora') assert.equal(nodes.ball.children.length, 0);
  if (shape === 'square' || shape === 'cloud') assert.equal(nodes.ball.children.length, 1);
}
assert.ok(destroyed >= 1);
nodes.opacity.value = '60'; nodes.opacity.fire('input');
assert.equal(nodes.ball.style.opacity, '0.4');
assert.equal(nodes.palette.style.opacity, '0.4');
assert.equal(nodes['opacity-label'].textContent, '60%');
for (const checked of [false, true]) {
  nodes.startup.checked = checked; nodes.startup.fire('change');
  assert.match(nodes['startup-note'].textContent, checked ? /下次打开仍使用/ : /下次打开恢复/);
}
for (const kind of ['size', 'style']) {
  for (const button of groups[kind]) {
    button.fire('click');
    assert.equal(nodes.stage.dataset[kind], button.dataset[kind === 'size' ? 'customSize' : 'customStyle']);
    assert.equal(groups[kind].filter(node => node.attributes['aria-pressed'] === 'true').length, 1);
  }
}
assert.match(nodes['style-note'].textContent, /不使用粉光、金光/);
assert.doesNotMatch(source, /BOO_ASSETS|boo-binary|aurora-rive|aurora-cloud-reference|fetch\(|localStorage/);
console.log('customize showcase: shape, transparency, startup, schematic-only and switches passed');
