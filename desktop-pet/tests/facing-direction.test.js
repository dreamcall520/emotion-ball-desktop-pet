const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createNode(tag) {
  return {
    tag,
    children: [],
    attributes: {},
    style: {},
    textContent: '',
    parentNode: null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); },
    remove() { this.parentNode?.removeChild(this); }
  };
}

function createEngine(options = {}) {
  let now = 1000;
  const container = createNode('main');
  const context = vm.createContext({
    console,
    Math,
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    document: { createElementNS: (_namespace, tag) => createNode(tag) }
  });
  context.window = context;
  for (const file of ['rings.js', 'emotions.js', 'ball.js', 'engine.js']) {
    vm.runInContext(
      fs.readFileSync(path.resolve(__dirname, '../../emotion-ball/js', file), 'utf8'),
      context,
      { filename: file }
    );
  }
  const engine = context.EmotionBall.create(container, {
    emotion: '00', idle: false, autostart: false, ...options
  });
  return {
    engine,
    setNow(value) { now = value; },
    tick(value) { now = value; engine._tick(value); }
  };
}

function bodyGroup(engine) {
  return engine.ball.svg.children.find(child =>
    child.children.some(node => node.attributes.class === 'eb-eye'));
}

function eyeNodes(engine) {
  return bodyGroup(engine).children.filter(node => node.attributes.class === 'eb-eye');
}

function zzzNodes(engine) {
  const result = [];
  function visit(node) {
    if (node.tag === 'text' && node.attributes.class === 'eb-sleep-z') result.push(node);
    node.children.forEach(visit);
  }
  visit(engine.ball.svg);
  return result;
}

function firstTranslateX(node) {
  const match = /^translate\((-?[\d.]+)\s/.exec(node.attributes.transform || '');
  assert.ok(match, `缺少首个横向位移：${node.attributes.transform}`);
  return Number(match[1]);
}

function firstScaleX(node) {
  const match = /\bscale\((-?[\d.]+)\s/.exec(node.attributes.transform || '');
  assert.ok(match, `缺少横向缩放：${node.attributes.transform}`);
  return Number(match[1]);
}

function firstRotation(node) {
  const match = /\brotate\((-?[\d.]+)\)/.exec(node.attributes.transform || '');
  assert.ok(match, `缺少旋转：${node.attributes.transform}`);
  return Number(match[1]);
}

function trailGradientCount(engine) {
  const defs = engine.ball.svg.children.find(node => node.tag === 'defs');
  return defs.children.filter(node => node.tag === 'linearGradient').length;
}

test('默认朝右保持旧外观，切到左侧只镜像眼睛与 Zzz 位置', () => {
  const { engine } = createEngine({ lite: true, emotion: '02' });
  assert.equal(typeof engine.setFacing, 'function');
  const rightEyes = eyeNodes(engine).map(node => ({
    x: firstTranslateX(node), scaleX: firstScaleX(node), path: node.attributes.d
  }));
  const bodyTransform = bodyGroup(engine).attributes.transform;
  assert.ok(rightEyes.every(eye => eye.x > 114.2705), '默认朝右时两只眼睛中心都应位于球体右半侧');

  assert.equal(engine.setFacing('left'), engine);
  const leftEyes = eyeNodes(engine).map(node => ({
    x: firstTranslateX(node), scaleX: firstScaleX(node), path: node.attributes.d
  }));

  assert.ok(
    leftEyes.every(eye => eye.x < 114.2705),
    `朝左时两只眼睛中心都应完整落在球体左半侧：${leftEyes.map(eye => eye.x).join(', ')}`
  );

  for (let index = 0; index < rightEyes.length; index += 1) {
    assert.equal(Math.sign(leftEyes[index].scaleX), -Math.sign(rightEyes[index].scaleX));
    assert.equal(leftEyes[index].path, rightEyes[index].path, '眼环数据不应被破坏');
  }

  const { engine: sleeping } = createEngine({ lite: true, emotion: '00' });
  const rightZzz = zzzNodes(sleeping).map(firstTranslateX);
  sleeping.setFacing('left');
  const leftZzz = zzzNodes(sleeping).map(firstTranslateX);
  assert.ok(leftZzz.every(x => x < 114.2705), '朝左时 Zzz 应完整移到球体左上侧');
  for (let index = 0; index < rightZzz.length; index += 1) {
    assert.ok(Math.abs(leftZzz[index] - (228.541 - rightZzz[index])) < 0.02);
    assert.doesNotMatch(zzzNodes(sleeping)[index].attributes.transform, /scale\(-1/);
    assert.equal(zzzNodes(sleeping)[index].textContent, 'z');
  }

  const { engine: tilted } = createEngine({ lite: true, emotion: '34' });
  const rightRotations = eyeNodes(tilted).map(firstRotation);
  tilted.setFacing('left');
  const leftRotations = eyeNodes(tilted).map(firstRotation);
  leftRotations.forEach((rotation, index) => assert.equal(rotation, -rightRotations[index]));
  assert.equal(bodyGroup(engine).attributes.transform, bodyTransform, '球体位置与光影不能随朝向翻转');
});

test('左侧脸的注视仍使用屏幕坐标，正值始终向屏幕右侧移动', () => {
  const fixture = createEngine({ lite: true, emotion: '01' });
  const { engine } = fixture;
  engine.setFacing('left').setGaze(-1, 0);
  for (let now = 1016; now <= 1400; now += 16) fixture.tick(now);
  const negative = eyeNodes(engine).map(firstTranslateX);
  engine.setGaze(1, 0);
  for (let now = 1416; now <= 2000; now += 16) fixture.tick(now);
  const positive = eyeNodes(engine).map(firstTranslateX);
  positive.forEach((value, index) => assert.ok(
    value > negative[index],
    `眼睛 ${index} 应向屏幕右移：${negative[index]} -> ${value}`
  ));
});

test('朝左时表情过渡与 yaw 仍产生有限且可恢复的眼睛变换', () => {
  const fixture = createEngine({ lite: true, liteRibbons: true });
  const { engine } = fixture;
  engine.setFacing('left');
  engine.setEmotion('10');
  engine.setMotionFrame({
    body: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0.55 },
    gaze: { x: -8, y: 0 }
  });
  fixture.tick(1040);
  eyeNodes(engine).forEach(node => {
    assert.doesNotMatch(node.attributes.transform || '', /NaN|Infinity/);
  });
  engine.stopMotion().renderStatic();
  eyeNodes(engine).forEach(node => assert.notEqual(node.style.display, 'none'));
});

test('小尺寸彩带默认关闭，显式 liteRibbons 才启用原生彩带', () => {
  const disabled = createEngine({ lite: true });
  disabled.engine.spin(1);
  for (let now = 1016; now <= 1240; now += 16) disabled.tick(now);
  assert.equal(trailGradientCount(disabled.engine), 0);

  const enabled = createEngine({ lite: true, liteRibbons: true });
  enabled.engine.spin(1);
  for (let now = 1016; now <= 1240; now += 16) enabled.tick(now);
  assert.ok(trailGradientCount(enabled.engine) > 0);
});
