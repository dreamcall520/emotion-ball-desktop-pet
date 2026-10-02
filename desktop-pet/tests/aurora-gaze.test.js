const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sampleMotion } = require('../lib/interaction-motion');

class SvgNode {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.style = {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; }
    };
    this.children = [];
    this.listeners = {};
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() {}
}

const descendants = node => [node, ...node.children.flatMap(descendants)];
const eyeX = eye => Number(eye.attrs.transform.match(/translate\(([-\d.]+) ([-\d.]+)\)/)[1]);
const eyeHeightScale = eye => Number(eye.attrs.transform.match(/scale\(([-\d.]+) ([-\d.]+)\)/)[2]);
const eyeWidthScale = eye => Number(eye.attrs.transform.match(/scale\(([-\d.]+) ([-\d.]+)\)/)[1]);
const eyeRotation = eye => Number(eye.attrs.transform.match(/rotate\(([-\d.]+)\)/)?.[1] || 0);
const eyePoints = eye => [...eye.attrs.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]
  .map(([, x, y]) => [Number(x), Number(y)]);

function fixture(liveAuroraEyes, auroraTransparency = 24) {
  const browser = { window: {}, document: { createElementNS: (_ns, tag) => new SvgNode(tag) },
    performance: { now: () => 1 }, console };
  for (const file of ['rings.js', 'custom-shapes.js', 'ball.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../emotion-ball/js', file), 'utf8'), browser);
  }
  const { EB_RINGS: rings, EB_CUSTOM_SHAPES: shapes, EmotionBall } = browser.window;
  const container = new SvgNode('div');
  const ball = EmotionBall.createBall(container, {
    shape: 'aurora-cloud', customShape: shapes.createShape({ shape: 'aurora-cloud' }),
    lite: true, liveAuroraEyes, auroraTransparency,
    auroraTurnRing: ring => ring,
    auroraBodyTexture: {
      baseSrc: 'eyeless.png', x: 0, y: 0, width: 229, height: 229,
      bakedEyesEligible: false
    }
  });
  const nodes = descendants(container);
  const images = nodes.filter(node => node.tag === 'image');
  const material = nodes.find(node => node.attrs.class === 'eb-aurora-material');
  images.forEach(node => node.listeners.load());
  const eyes = nodes.filter(node => node.attrs.class === 'eb-eye');
  const eyeGroup = nodes.find(node => node.tag === 'g' && node.children.includes(eyes[0]));
  const render = (lookX = 0, open = 1, expression = 0, turnMorph = 0) => {
    const eyePose = ring => ({ ring, open, scaleX: 1, scaleY: 1,
      x: 0, y: 0, lookX, lookY: 0, rotate: 0, color: '#FFFFFF' });
    ball.applyPose({ body: { x: 0, y: 0, rotate: 0, scale: 1, color: '#5B3BC7', yaw: 0,
      turnMorph },
      left: eyePose(rings.EXPRESSIONS[expression][0]),
      right: eyePose(rings.EXPRESSIONS[expression][1]) });
    return eyes.map(eyeX).reduce((sum, x) => sum + x, 0) / eyes.length;
  };
  return { ball, container, images, material, eyeGroup, render, rings,
    eyeWidthScales: () => eyes.map(eyeWidthScale),
    eyeHeightScales: () => eyes.map(eyeHeightScale),
    eyeRotations: () => eyes.map(eyeRotation),
    eyePoints: () => eyes.map(eyePoints) };
}

test('幻彩云桌面眼睛始终可动，左右屏幕和鼠标方向都能改变注视', () => {
  const live = fixture(true);
  assert.equal(live.container.children[0].attrs.viewBox, '-3 -3 235 235');
  const rightScreen = live.render();
  assert.ok(live.eyeWidthScales().every(value => value < 0),
    '屏幕右侧的球球向左看时，眼线也要弯向左');
  assert.equal(live.images.length, 1, '主材质是无眼 RGBA 图，无需叠加眼部修复图');
  assert.equal(live.images[0].attrs.opacity, '1', '无眼参考素材的体色仍可见');
  assert.equal(live.images[0].attrs.transform, undefined);
  assert.equal(live.material.attrs.transform,
    'translate(0 -2.29) scale(1 1.02) rotate(3.2 114.2705 114.2705)',
    '向左看时右下云瓣更饱满');
  assert.equal(live.material.attrs.opacity, '0.76', '云体作为单个透明材质层合成');
  assert.ok(!live.material.children.includes(live.eyeGroup), '白色眼睛不随云体一起变透明');
  assert.notEqual(live.eyeGroup.attrs.display, 'none', '默认状态也要显示动态眼');
  const restingEyes = live.eyePoints();
  const slopes = restingEyes.map(points => {
    const half = points.length / 2;
    const widthAt = index => points[index][0] - points[points.length - 1 - index][0];
    const centerAt = index =>
      (points[index][0] + points[points.length - 1 - index][0]) / 2;
    assert.ok(Math.abs(widthAt(0)) < 0.1 && Math.abs(widthAt(half - 1)) < 0.1,
      '眼线两端闭合为圆头');
    assert.ok(widthAt(4) > widthAt(11) * 0.7 && widthAt(19) > widthAt(11) * 0.7,
      '眼线两端保持饱满，不再收成泪滴尖尾');
    assert.ok(widthAt(11) > 16 && widthAt(11) < 21,
      '眼线中段与原版一样有稳定宽度');
    return centerAt(20) - centerAt(3);
  });
  assert.ok(Math.abs(slopes[0] - slopes[1]) < 1,
    '两条眼线向同一方向轻弯，不会像括号或泪滴一样分叉');
  restingEyes.forEach((points, side) => {
    const renderedHeight = (Math.max(...points.map(([, y]) => y)) -
      Math.min(...points.map(([, y]) => y))) * live.eyeHeightScales()[side];
    assert.ok(renderedHeight > 55 && renderedHeight <= 61,
      '眼线相对云朵达到参考长度，仍在安全的可视高度内');
  });
  const lookingRight = live.render(20);
  const rightTurns = live.eyeRotations();
  const lookingLeft = live.render(-20);
  const leftTurns = live.eyeRotations();
  assert.ok(rightTurns.every(value => value < -3.5 && value >= -4.5) &&
    leftTurns.every(value => value > 3.5 && value <= 4.5),
    '左右注视会改变两条弧线的整体倾角，而非只平移固定斜线');
  assert.ok(lookingRight > rightScreen + 7 && lookingRight < rightScreen + 15,
    '鼠标移到右侧时双眼温和地向右看');
  assert.ok(lookingLeft < rightScreen - 7 && lookingLeft > rightScreen - 15,
    '鼠标移到左侧时双眼温和地向左看');
  for (const center of [rightScreen, lookingRight, lookingLeft]) {
    assert.ok(Math.abs(center - 114.2705) < 35, '注视时双眼仍留在幻彩云面部中上方');
  }
  live.ball.setFacing('left');
  const leftScreen = live.render();
  assert.equal(live.material.attrs.transform,
    'translate(228.541 0) scale(-1 1) translate(0 -2.29) scale(1 1.02) rotate(3.2 114.2705 114.2705)',
    '向右看时整体镜像，左下云瓣和星光一起换边');
  assert.ok(live.eyeWidthScales().every(value => value > 0),
    '屏幕左侧的球球向右看时，眼线也要镜像弯向右');
  assert.ok(leftScreen > rightScreen + 6 && leftScreen < rightScreen + 30,
    `左右朝向仍有区别，但不会把眼睛推到云边缘 (${rightScreen} → ${leftScreen})`);
  const openEyeScales = live.eyeHeightScales();
  live.render(0, 0.12);
  assert.ok(live.eyeHeightScales().every((value, index) => value < openEyeScales[index] * 0.2),
    '眨眼时两只动态眼睛确实闭合');
  live.render(0, 1, 4);
  live.eyePoints().forEach((points, side) => {
    const original = live.rings.EXPRESSIONS[4][side];
    assert.ok(points.every((point, index) =>
      Math.abs(point[0] - original[index][0]) < 0.011 &&
      Math.abs(point[1] - original[index][1]) < 0.011),
    '其他表情的眼环保持原有轮廓');
  });
  live.ball.destroy();

  const preview = fixture(false);
  preview.render();
  assert.notEqual(preview.eyeGroup.attrs.display, 'none', '预览也使用动态眼，不显示旧素材的固定白眼');
  preview.ball.destroy();

  for (const [transparency, expectedOpacity] of [[0, '1'], [42, '0.58'], [60, '0.4']]) {
    const selected = fixture(true, transparency);
    selected.render();
    assert.equal(selected.material.attrs.opacity, expectedOpacity);
    assert.ok(!selected.material.children.includes(selected.eyeGroup), '调整透明度时眼睛依旧清晰');
    selected.ball.destroy();
  }
});

test('幻彩云转身起始帧的备用球体平滑显现，不闪出硬边', () => {
  const preview = fixture(true);
  const head = descendants(preview.container).find(node => node.attrs.class === 'eb-head');
  preview.render();
  assert.equal(head.attrs.opacity, '0');
  preview.render(0, 1, 0, 0.01);
  assert.ok(Number(head.attrs.opacity) > 0 && Number(head.attrs.opacity) < 1);
  preview.render(0, 1, 0, 0.04);
  assert.equal(head.attrs.opacity, '1');
  preview.ball.destroy();
});

test('点击眩晕只临时换成大螺旋眼，转身和结束时恢复常规眼', () => {
  const browser = {
    window: { getComputedStyle: () => ({ position: 'relative' }) },
    document: { createElement: tag => new SvgNode(tag),
      createElementNS: (_ns, tag) => new SvgNode(tag) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/aurora-click-visual.js'), 'utf8'), browser);
  const container = new SvgNode('div');
  const visual = browser.window.AuroraClickVisual.create(container);
  const nodes = descendants(container);
  const layer = nodes.find(node => node.className === 'aurora-click-visual');
  const spiral = nodes.find(node => node.attrs.class === 'aurora-click-visual__spiral');
  const turn = nodes.find(node => node.attrs.class === 'aurora-click-visual__turn');
  const eyes = spiral.parentNode.parentNode.children;
  const dizzy = spiral.parentNode.parentNode.parentNode;
  const xs = [...spiral.attrs.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(match => Number(match[1]));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 28, '螺旋眼在桌面尺寸仍足够醒目');
  assert.equal(layer.style.visibility, 'hidden', '常规表情不显示点击眼');
  const frame = { body: { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1 } };
  visual.set('dizzy', 0.25, frame, 'right');
  const firstRotation = eyes[0].attrs.transform;
  visual.set('dizzy', 0.5, frame, 'right');
  assert.notEqual(eyes[0].attrs.transform, firstRotation, '两只螺旋眼会持续旋转');
  assert.equal(layer.style.visibility, 'visible');
  visual.set('turn', 0.5, frame, 'right');
  assert.equal(dizzy.style.display, 'none');
  const eyeOpacity = [];
  for (const [elapsed, opacity] of [[0, '0'], [400, '1'], [650, '0'], [900, '1']]) {
    const turnFrame = sampleMotion('turn', elapsed);
    visual.set('turn', turnFrame.progress, turnFrame, 'right');
    assert.equal(turn.style.opacity, opacity, `${elapsed}ms 彩光只在两次侧影显现`);
    eyeOpacity.push(Number(container.style['--aurora-click-eye-opacity']));
  }
  assert(eyeOpacity[0] > 0.9 && eyeOpacity[1] < 0.2 && eyeOpacity[2] === 0,
    '眼睛应随正面转向侧面再转至背面逐渐隐去');
  const returning = sampleMotion('turn', 1299);
  visual.set('turn', returning.progress, returning, 'right');
  assert(Number(container.style['--aurora-click-eye-opacity']) > 0.9, '转回正面时眼睛重新出现');
  visual.clear();
  assert.equal(layer.style.visibility, 'hidden');
  assert.equal(container.style['--aurora-click-eye-opacity'], undefined);
});
