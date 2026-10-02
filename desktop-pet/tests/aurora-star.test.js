const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class SvgNode {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.style = {};
    this.children = [];
    this.listeners = {};
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() {}
}

const descendants = node => [node, ...node.children.flatMap(descendants)];

function fixture(customColors = false, auroraStyle = 'dimensional') {
  let now = 0;
  let reducedMotion = false;
  let frames = 0;
  const angles = [];
  class Canvas {
    getContext() { return {
      drawImage() {}, clearRect() {}, save() {}, restore() {}, translate() {},
      rotate(value) { angles.push(value); }, scale() {},
      getImageData() { return { data: new Uint8ClampedArray(229 * 229 * 4) }; },
      createImageData() { return { data: new Uint8ClampedArray(229 * 229 * 4) }; },
      putImageData() {}
    }; }
    toDataURL() { return 'data:image/png;base64,' + ++frames; }
  }
  class Image { set src(_value) { this.onload(); } }
  const browser = {
    window: { matchMedia: () => ({ get matches() { return reducedMotion; } }) },
    document: { createElementNS: (_namespace, tag) => new SvgNode(tag), createElement: () => new Canvas() },
    performance: { now: () => now }, Image, console
  };
  for (const file of ['rings.js', 'custom-shapes.js', 'ball.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../emotion-ball/js', file), 'utf8'), browser);
  }
  const { EB_RINGS: rings, EB_CUSTOM_SHAPES: shapes, EmotionBall } = browser.window;
  const container = new SvgNode('div');
  let hovered = false;
  container.matches = selector => selector === ':hover' && hovered;
  const bodyColor = customColors ? '#6745BB' : '#5B3BC7';
  const ball = EmotionBall.createBall(container, {
    shape: 'aurora-cloud', customShape: shapes.createShape({ shape: 'aurora-cloud' }),
    auroraStyle,
    auroraBodyTexture: null,
    glowPinkColor: customColors ? '#CB78D4' : '#D05ED6',
    glowGoldColor: customColors ? '#E1AC76' : '#D0AD8A',
    lite: true, liveAuroraEyes: true
  });
  const nodes = descendants(container);
  const material = nodes.find(node => node.attrs.class === 'eb-aurora-material');
  const fallback = nodes.find(node => node.attrs.class === 'eb-aurora-fallback-star');
  const texture = material.children.find(node => node.tag === 'image');
  const eye = nodes.find(node => node.attrs.class === 'eb-eye');
  nodes.filter(node => node.tag === 'image').forEach(node => node.listeners.load());
  function render(time, sketch = 0) {
    now = time;
    angles.length = 0;
    const eyePose = ring => ({ ring, open: 1, scaleX: 1, scaleY: 1,
      x: 0, y: 0, lookX: 0, lookY: 0, rotate: 0, color: '#FFFFFF' });
    ball.applyPose({
      body: { x: 0, y: 0, rotate: 0, scale: 1, color: bodyColor, yaw: 0, sketch },
      left: eyePose(rings.EXPRESSIONS[0][0]),
      right: eyePose(rings.EXPRESSIONS[0][1])
    });
    return { transform: fallback?.attrs.transform, display: fallback?.attrs.display,
      href: texture?.attrs.href, angle: angles[0] };
  }
  return { ball, material, fallback, texture, eye, render,
    hover: enabled => { hovered = enabled; },
    reduceMotion: enabled => { reducedMotion = enabled; } };
}

test('简色幻彩云只保留渐变云体和清晰白眼', () => {
  const cloud = fixture(false, 'simple');
  cloud.render(0);
  const nodes = descendants(cloud.material);
  assert.equal(cloud.texture, undefined, '简色不绘制参考贴图');
  assert.equal(cloud.fallback, undefined, '简色不绘制立体版内光');
  assert.equal(nodes.filter(node => node.tag === 'path').length, 1, '云体只有一个填充轮廓');
  assert.equal(cloud.eye.attrs.filter, undefined, '白眼没有立体版的发光滤镜');
  const svg = cloud.material.parentNode.parentNode;
  const gradient = descendants(svg).find(node => node.tag === 'linearGradient');
  assert.deepEqual(gradient.children.map(node => node.attrs['stop-color']),
    ['#A98BFF', '#8B72FF', '#675EFF', '#5757ED']);
  cloud.ball.destroy();
});

test('自定义配色无参考贴图时仅显示一条备用菱形内光', () => {
  const cloud = fixture(true);
  const fallback = descendants(cloud.material).filter(node => node.attrs.class === 'eb-aurora-fallback-star');
  assert.equal(cloud.texture, undefined, '自定义配色不加载参考贴图');
  assert.equal(fallback.length, 1, '备用内光只有一条可见路径');
  assert.equal(fallback[0].tag, 'path');
  assert.ok(fallback[0].attrs.d.includes('64 0'), '备用内光沿用同一四角轮廓');
  const start = cloud.render(0);
  const later = cloud.render(1400);
  assert.equal(fallback[0].attrs.transform, later.transform, '备用内光跟随待机呼吸运动');
  assert.notEqual(start.transform, later.transform);
  cloud.render(1500, 1);
  assert.equal(fallback[0].attrs.display, 'none', '线稿模式隐藏备用彩色内光');
  cloud.ball.destroy();
});

test('降低动态效果后菱形内光保持稳定', () => {
  const cloud = fixture();
  cloud.reduceMotion(true);
  const start = cloud.render(0);
  const later = cloud.render(5000);
  assert.equal(start.transform, later.transform);
  cloud.ball.destroy();
});

test('悬停时内光缓慢转动，离开后回到待机呼吸', () => {
  const cloud = fixture();
  cloud.render(0);
  cloud.hover(true);
  let frame;
  for (let time = 100; time <= 4000; time += 100) frame = cloud.render(time);
  const hoveredAngle = Number(frame.transform.match(/rotate\((-?[\d.]+)/)[1]);
  assert.ok(hoveredAngle > 18 && hoveredAngle < 40, '4 秒悬停只缓慢转过部分角度');
  cloud.hover(false);
  for (let time = 4100; time <= 9000; time += 100) frame = cloud.render(time);
  const settledAngle = Number(frame.transform.match(/rotate\((-?[\d.]+)/)[1]);
  assert.ok(Math.abs(settledAngle) < 4, '离开后恢复轻微呼吸角度');
  cloud.ball.destroy();
});
