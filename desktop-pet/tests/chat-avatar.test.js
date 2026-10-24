const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createShape } = require('../../emotion-ball/js/custom-shapes');

function fixture() {
  class Node {
    constructor(name) { this.name = name; this.attributes = {}; this.children = []; this.dataset = {}; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    insertBefore(child) { this.children.unshift(child); }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = null; }); this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    get firstChild() { return this.children[0] || null; }
    find(name) { return this.name === name ? this : this.children.map(child => child.find(name)).find(Boolean); }
    findAll(name) { return [...(this.name === name ? [this] : []), ...this.children.flatMap(child => child.findAll(name))]; }
  }
  const document = { createElementNS: (_ns, name) => new Node(name) };
  const sheep = [], timers = new Set();
  const window = { SheepSkin: { create(target, options) {
    const canvas = new Node('canvas'); target.appendChild(canvas);
    const timer = options.sheepTheme === 'auto' ? {} : null;
    if (timer) timers.add(timer);
    const instance = { options, canvas, destroyed: false,
      destroy() { this.destroyed = true; timers.delete(timer); canvas.remove(); } };
    sheep.push(instance); return instance;
  } } };
  const context = vm.createContext({ document, window });
  for (const file of ['emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
    'desktop-pet/lib/customization.js', 'desktop-pet/lib/chat-avatar.js']) {
    const absolute = path.join(__dirname, '../..', file);
    vm.runInContext(fs.readFileSync(absolute, 'utf8'), context, { filename: file });
  }
  return { target: new Node('span'), render: window.PetChatAvatar.render, create: window.PetChatAvatar.create, sheep, timers };
}

const eyes = portrait => [...portrait.findAll('rect'), ...portrait.findAll('path')]
  .filter(node => node.attributes.class === 'avatar-eye');

test('静态小羊传递主题并复用同一实例，不重复创建自动日历定时器', () => {
  const f = fixture(), appearance = { shape: 'new-year-sheep', sheepTheme: 'auto', auroraTransparency: 23 };
  f.render(f.target, appearance);
  const first = f.sheep[0];
  assert.equal(first.options.sheepTheme, 'auto');
  assert.equal(first.options.auroraTransparency, 23);
  assert.equal(first.options.autostart, false);
  for (let index = 0; index < 5; index++) f.render(f.target, { ...appearance });
  assert.equal(f.sheep.length, 1);
  assert.equal(f.timers.size, 1);
  assert.equal(f.target.firstChild, first.canvas);
  f.render(f.target, { ...appearance, sheepTheme: 'christmas' });
  assert.equal(first.destroyed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sheep[1].options.sheepTheme, 'christmas');
  f.render(f.target, { shape: 'blob' });
  assert.equal(f.sheep[1].destroyed, true);
  assert.equal(f.target.firstChild.name, 'svg');
});

test('静态小羊子树失效会释放旧实例，切换为动态控制器也清理自动计时器', () => {
  const f = fixture(), appearance = { shape: 'new-year-sheep', sheepTheme: 'auto' };
  f.render(f.target, appearance);
  const first = f.sheep[0];
  f.target.replaceChildren();
  f.render(f.target, appearance);
  assert.equal(first.destroyed, true);
  assert.equal(f.sheep.length, 2);
  assert.equal(f.timers.size, 1, '替换后只有当前实例的计时器');
  const controller = f.create(f.target);
  assert.equal(f.sheep[1].destroyed, true);
  assert.equal(f.timers.size, 0);
  controller.destroy(); controller.destroy();
  assert.equal(f.target.children.length, 0);
});

test('相同外观的头像子树被其他渲染器替换后重新绘制，不命中失效缓存', () => {
  const { target, render } = fixture();
  render(target, { shape: 'blob' });
  const original = target.firstChild;
  target.replaceChildren();
  render(target, { shape: 'blob' });
  assert.notEqual(target.firstChild, original);
  assert.equal(eyes(target.firstChild).length, 2);
});

test('头像跟随已保存的形态、颜色和轮廓微调，重复状态不重置眨眼', () => {
  const { target, render } = fixture();
  render(target);
  const original = target.children[0];
  assert.equal(target.dataset.shape, 'blob');
  assert.equal(original.findAll('path').some(node => node.attributes.fill === '#EEEBE4'), true);
  render(target);
  assert.equal(target.children[0], original);
  render(target, { shape: 'square', bodyColor: '#28415C', eyeColor: '#F4E8C8',
    shapeTuning: { width: 1.13, height: 1, softness: .72, asymmetry: 0 } });
  const square = target.children[0];
  assert.notEqual(square, original);
  assert.equal(target.dataset.shape, 'square');
  assert.equal(square.findAll('path').some(node => node.attributes.fill === '#28415C'), true);
  assert.equal(eyes(square).length, 2);
  assert.equal(eyes(square).every(node => node.attributes.fill === '#F4E8C8'), true);
});

test('默认头像四种形态都正面平视，眼睛竖直且等高', () => {
  const { target, render } = fixture();
  for (const shape of ['blob', 'cloud', 'aurora-cloud', 'square']) {
    render(target, { shape, eyeColor: '#123456' });
    const pair = eyes(target.children[0]);
    assert.equal(pair.length, 2, shape);
    assert.equal(pair.every(node => node.name === 'rect'), true, shape);
    assert.equal(pair[0].attributes.y, pair[1].attributes.y, shape);
    assert.equal(pair[0].attributes.height, pair[1].attributes.height, shape);
    assert.equal(pair.every(node => Number(node.attributes.height) > Number(node.attributes.width) &&
      node.attributes.fill === '#123456'), true, shape);
    assert.ok(Number(pair[0].attributes.x) < Number(pair[1].attributes.x), shape);
  }
});

test('头像的眼睛尺寸、间距和高度继续遵循用户设置', () => {
  const { target, render } = fixture();
  render(target, { eyeScale: 1.2, eyeSpacing: 1.3, eyeHeight: 8 });
  const pair = eyes(target.children[0]);
  assert.equal(pair[0].attributes.width, '14.40');
  assert.equal(pair[0].attributes.y, '76.67');
  assert.equal((Number(pair[1].attributes.x) - Number(pair[0].attributes.x)).toFixed(2), '46.80');
});

test('普通形态头像同步桌面透明度', () => {
  const { target, render } = fixture();
  render(target, { shape: 'cloud', auroraTransparency: 42 });
  assert.equal(target.children[0].attributes.opacity, '0.58');
});

test('幻彩头像使用六瓣轮廓与独立可眨眼眼睛；配色和透明度生效', () => {
  const { target, render } = fixture();
  render(target, { shape: 'aurora-cloud', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF' });
  const portrait = target.children[0];
  assert.equal(target.dataset.shape, 'aurora-cloud');
  assert.equal(portrait.find('image'), undefined);
  assert.equal(portrait.findAll('radialGradient').length, 2);
  assert.equal(portrait.find('g').attributes.opacity, '1.00');
  assert.equal(eyes(portrait).length, 2);
  render(target, { shape: 'aurora-cloud', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF',
    auroraTransparency: 42 });
  assert.equal(target.children[0].findAll('g').find(node => node.attributes.class === 'avatar-material')
    .attributes.opacity, '0.58');
  render(target, { shape: 'aurora-cloud', bodyColor: '#563DA8', eyeColor: '#FFFFFF',
    glowPinkColor: '#EE83D8', glowGoldColor: '#EDC77C', auroraTransparency: 42 });
  const custom = target.children[0];
  assert.equal(custom.find('image'), undefined);
  assert.equal(custom.findAll('radialGradient').length, 2);
  assert.equal(custom.findAll('path').some(node => node.attributes.fill === '#563DA8'), true);
  assert.equal(custom.findAll('g').find(node => node.attributes.class === 'avatar-material')
    .attributes.opacity, '0.58');
});

test('简色幻彩云头像使用同色渐变，保留独立眨眼且不引用参考贴图', () => {
  const { target, render } = fixture();
  render(target, { shape: 'aurora-cloud', auroraStyle: 'simple', bodyColor: '#5B3BC7',
    eyeColor: '#FFFFFF', auroraTransparency: 42 });
  const portrait = target.children[0];
  assert.equal(portrait.find('image'), undefined);
  assert.equal(portrait.findAll('radialGradient').length, 0);
  const gradient = portrait.findAll('linearGradient')[0];
  assert.deepEqual(gradient.children.map(stop => stop.attributes['stop-color']),
    ['#A98BFF', '#8B72FF', '#675EFF', '#5757ED']);
  assert.equal(portrait.findAll('g').find(node => node.attributes.class === 'avatar-material')
    .attributes.opacity, '0.58');
  const outline = portrait.findAll('path').find(node => node.attributes.fill === 'url(#chat-avatar-simple)');
  assert.equal(outline.attributes.d, createShape({ shape: 'aurora-cloud' }).ring.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z');
  assert.equal(eyes(portrait).length, 2);
  assert.equal(eyes(portrait).every(node => node.attributes.class === 'avatar-eye'), true);
  render(target, { shape: 'aurora-cloud', auroraStyle: 'simple', bodyColor: '#5B3BC7',
    eyeColor: '#FFFFFF', auroraTransparency: 42 });
  assert.equal(target.children[0], portrait, '相同外观不重置眨眼');
  render(target, { shape: 'aurora-cloud', auroraStyle: 'simple', bodyColor: '#563DA8' });
  assert.equal(target.children[0].find('image'), undefined);
  assert.equal(target.children[0].findAll('linearGradient')[0].children[2].attributes['stop-color'], '#563DA8');
});
