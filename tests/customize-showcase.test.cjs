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
const names = ['ball', 'body', 'eye', 'palette', 'artwork', 'colors', 'caption', 'styles', 'sizes', 'description', 'stage',
  'opacity', 'opacity-label', 'startup', 'startup-note'];
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
  assert.equal(nodes.ball.hidden, shape !== 'blob');
  assert.equal(nodes.palette.hidden, shape === 'blob');
  assert.equal(nodes.colors.hidden, shape !== 'blob');
  assert.equal(nodes.styles.hidden, shape !== 'aurora');
  assert.equal(nodes.ball.attributes['aria-label'], `${['经典', '云朵', '幻彩', '方糖'][index]}配色示意`);
  if (shape === 'aurora') assert.equal(nodes.ball.children.length, 0);
  if (shape === 'square' || shape === 'cloud') assert.equal(nodes.artwork.src, `assets/custom-${shape}.svg`);
}
assert.ok(destroyed >= 1);
nodes.opacity.value = '60'; nodes.opacity.fire('input');
assert.equal(nodes.ball.style.opacity, '0.4');
assert.equal(nodes.artwork.style.opacity, '0.4');
assert.equal(nodes.palette.style.opacity, undefined, 'reference captions remain readable');
assert.equal(nodes['opacity-label'].textContent, '60%');
for (const checked of [false, true]) {
  nodes.startup.checked = checked; nodes.startup.fire('change');
  assert.match(nodes['startup-note'].textContent, checked ? /下次打开仍使用/ : /下次打开恢复/);
}
groups.shape[2].fire('click');
for (const kind of ['size', 'style']) {
  for (const button of groups[kind]) {
    button.fire('click');
    assert.equal(nodes.stage.dataset[kind], button.dataset[kind === 'size' ? 'customSize' : 'customStyle']);
    assert.equal(groups[kind].filter(node => node.attributes['aria-pressed'] === 'true').length, 1);
    if (kind === 'style') assert.equal(nodes.artwork.src, button.dataset.customStyle === 'simple'
      ? 'assets/custom-aurora-simple.png' : 'assets/custom-aurora-dimensional.png');
  }
}
groups.shape[1].fire('click');
groups.shape[2].fire('click');
assert.equal(nodes.artwork.src, 'assets/custom-aurora-simple.png', 'style survives shape switch');
groups.shape[0].fire('click');
assert.equal(nodes.colors.hidden, false, 'classic palette returns');
assert.doesNotMatch(source, /BOO_ASSETS|boo-binary|aurora-rive|aurora-cloud-reference|fetch\(|localStorage/);
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const downloadLinks = [...html.matchAll(/data-download-arch="arm64"[^>]*href="([^"]+)"/g)];
assert.equal(downloadLinks.length, 2);
assert.ok(downloadLinks.every(match => match[1].endsWith('/v0.3.32/Qiuqiu-0.3.32-macOS-arm64-share.zip')));
assert.match(html, /<dt>发布日期<\/dt><dd>2026-10-04<\/dd>/);
assert.match(html, /v0\.3\.13\/Qiuqiu-0\.3\.13-macOS-x64-share\.zip/);
assert.match(html, /解压 ZIP，得到“球球桌宠\.app”/);
assert.match(fs.readFileSync(path.join(__dirname, '../quota-demo.js'), 'utf8'), /Codex 返回点数状态时/);
assert.doesNotMatch(html, /Pro 额外点数|打开里面唯一的 DMG/);
assert.doesNotMatch(html + source, /幻彩云|圆角方|新版功能预告|尚不包含此功能|新安装包暂未开放|新聊天入口仍在历史记录中/);
assert.match(html, /assets\/huancai-icon\.png/);
assert.ok(fs.existsSync(path.join(__dirname, '../assets/huancai-icon.png')));
for (const asset of ['custom-cloud.svg', 'custom-square.svg', 'custom-aurora-simple.png', 'custom-aurora-dimensional.png'])
  assert.ok(fs.existsSync(path.join(__dirname, '../assets', asset)));
assert.doesNotMatch(html, /参考图不随配色|data-custom-swatches|data-custom-glow-label/);
assert.equal((html.match(/<details class="updates-history">([\s\S]*?)<\/details>\s*<\/div>\s*<\/section>/)[1].match(/<article>/g) || []).length, 16);
console.log('customize showcase: App previews, linked styles, palette visibility, transparency, release links and history passed');
