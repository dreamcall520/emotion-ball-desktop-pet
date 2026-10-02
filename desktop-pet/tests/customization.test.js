const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeAppearance, effectiveAppearance, normalizeCustomization, applyShapeRecommendation, auroraReferenceTexture } = require('../lib/customization');

test('旧版幻彩云的待机表情归一为原版眼形，其他形态仍保留旧设置', () => {
  assert.equal(normalizeAppearance({ shape: 'aurora-cloud', idleEyes: 'sleepy' }).idleEyes, 'original');
  assert.equal(normalizeAppearance({ shape: 'cloud', idleEyes: 'sleepy' }).idleEyes, 'sleepy');
  assert.equal(applyShapeRecommendation({ idleEyes: 'sleepy' }, 'aurora-cloud').idleEyes, 'original');
});

test('幻彩云旧手调值恢复原版动效所需的五官与轮廓参数', () => {
  const tuned = { width: 1.2, height: 1.1, softness: .89, asymmetry: -.16 };
  const original = normalizeAppearance({ shape: 'aurora-cloud', eyeScale: 1.25,
    eyeSpacing: 1.03, eyeHeight: 19, shapeTuning: tuned });
  assert.deepEqual([original.eyeScale, original.eyeSpacing, original.eyeHeight], [1, 1, 0]);
  assert.deepEqual(original.shapeTuning, { width: 1, height: 1, softness: .5, asymmetry: 0 });
  const selected = applyShapeRecommendation({ ...original, eyeScale: 1.25,
    eyeSpacing: 1.03, eyeHeight: 19, shapeTuning: tuned }, 'aurora-cloud');
  assert.deepEqual([selected.eyeScale, selected.eyeSpacing, selected.eyeHeight], [1, 1, 0]);
  assert.deepEqual(selected.shapeTuning, { width: 1, height: 1, softness: .5, asymmetry: 0 });
});
const { createShape } = require('../../emotion-ball/js/custom-shapes');

test('定制配置只保存允许的外观与动作，非法值回退且时间被限制', () => {
  const normalized = normalizeCustomization({
    appearance: { shape: 'bad', bodyColor: 'red', eyeColor: '#123456', eyeScale: 99, idleEyes: 'curious', hidden: 'secret' },
    sequence: [
      { action: 'peek', pauseMs: -300, hidden: 'secret' },
      { action: '__proto__', pauseMs: 300 },
      { action: 'spin', pauseMs: 99999 }
    ],
    hidden: 'secret'
  });
  assert.deepEqual(normalized, {
    appearance: { shape: 'blob', bodyColor: '#EEEBE4', eyeColor: '#123456',
      glowPinkColor: '#D05ED6', glowGoldColor: '#D0AD8A', eyeScale: 1.25,
      eyeSpacing: 1, eyeHeight: 0, auroraTransparency: 0, auroraStyle: 'dimensional', auroraContour: 'original',
      shapeTuning: { width: 1, height: 1, softness: 0.5, asymmetry: 0 }, idleEyes: 'curious' },
    sequence: [{ action: 'peek', pauseMs: 0 }, { action: 'spin', pauseMs: 2000 }]
  });
});

test('旧外观设置保持默认球球轮廓，新手调数值按安全范围保存', () => {
  const old = normalizeAppearance({ shape: 'blob', eyeScale: 1 });
  assert.equal(createShape(old), null);
  assert.deepEqual(old.shapeTuning, { width: 1, height: 1, softness: 0.5, asymmetry: 0 });
  assert.equal(old.glowPinkColor, '#D05ED6');
  assert.equal(old.glowGoldColor, '#D0AD8A');

  const edited = normalizeAppearance({
    shape: 'cloud', eyeSpacing: 8, eyeHeight: -99,
    shapeTuning: { width: 8, height: 0, softness: -1, asymmetry: 5, hidden: 'ignored' }
  });
  assert.equal(edited.shape, 'cloud');
  assert.equal(edited.eyeSpacing, 1.3);
  assert.equal(edited.eyeHeight, -30);
  assert.equal(edited.auroraTransparency, 0);
  assert.deepEqual(edited.shapeTuning, { width: 1.25, height: 0.75, softness: 0, asymmetry: 1 });
  assert.equal(Object.hasOwn(edited.shapeTuning, 'hidden'), false);
});

test('幻彩配置归一为六瓣，保持颜色透明度和启动外观', () => {
  const appearance = { shape: 'aurora-cloud', bodyColor: '#123456', eyeColor: '#FEDCBA',
    glowPinkColor: '#ABCDEF', glowGoldColor: '#654321', auroraTransparency: 42, auroraStyle: 'simple' };
  for (const contour of [undefined, 'original', 'six-lobe', 'invalid']) {
    const normalized = normalizeAppearance({ ...appearance, auroraContour: contour });
    assert.equal(normalized.auroraContour, 'six-lobe');
    for (const [key, value] of Object.entries(appearance)) assert.equal(normalized[key], value);
    assert.deepEqual(effectiveAppearance(normalized), normalized);
    assert.equal(applyShapeRecommendation(normalized, 'aurora-cloud', contour).auroraContour, 'six-lobe');
    assert.equal(normalizeCustomization({ appearance: normalized }).appearance.auroraContour, 'six-lobe');
  }
  assert.equal(normalizeAppearance({ shape: 'cloud', auroraContour: 'six-lobe' }).auroraContour, 'original');
  const { normalizeSettings } = require('../lib/settings');
  const settings = normalizeSettings({ customization: { appearance }, startupAppearance: { shape: 'square' } });
  const reloaded = normalizeSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(reloaded.customization.appearance.auroraContour, 'six-lobe');
  assert.equal(reloaded.startupAppearance.shape, 'square');
});

test('幻彩云透明度随外观保存，并限制在可见范围', () => {
  assert.equal(normalizeAppearance({ auroraTransparency: 42 }).auroraTransparency, 42);
  assert.equal(normalizeAppearance({ auroraTransparency: -10 }).auroraTransparency, 0);
  assert.equal(normalizeAppearance({ auroraTransparency: 95 }).auroraTransparency, 60);
  assert.equal(normalizeAppearance({ auroraTransparency: '55' }).auroraTransparency, 0);
  const original = normalizeAppearance({ auroraTransparency: 42 });
  assert.equal(applyShapeRecommendation(original, 'aurora-cloud').auroraTransparency, 42);
  assert.equal(applyShapeRecommendation(original, 'blob').auroraTransparency, 42);
});

test('幻彩云样式兼容旧设置，简色渐变跳过参考贴图且保留自选透明度', () => {
  assert.equal(normalizeAppearance({ shape: 'aurora-cloud' }).auroraStyle, 'dimensional');
  assert.equal(normalizeAppearance({ auroraStyle: 'invalid' }).auroraStyle, 'dimensional');
  const simple = normalizeAppearance({ shape: 'aurora-cloud', auroraStyle: 'simple',
    bodyColor: '#5B3BC7', auroraTransparency: 42 });
  assert.equal(simple.auroraStyle, 'simple');
  assert.equal(simple.auroraTransparency, 42);
  assert.equal(auroraReferenceTexture(simple, createShape(simple)), null);
  assert.equal(applyShapeRecommendation(simple, 'blob').auroraStyle, 'simple');
  assert.equal(applyShapeRecommendation(simple, 'aurora-cloud').auroraStyle, 'simple');
  assert.equal(normalizeCustomization({ appearance: simple }).appearance.auroraStyle, 'simple');
});

test('从外观页移除的旧形态仍可读取，避免已有桌面球球升级后变形', () => {
  for (const shape of ['dumpling', 'egg', 'wedge', 'gem']) {
    assert.equal(normalizeAppearance({ shape }).shape, shape);
  }
});

test('点选四种形态带入推荐配色，幻彩云恢复固定轮廓和眼睛', () => {
  const original = normalizeAppearance({ shape: 'blob', bodyColor: '#123456', eyeColor: '#654321',
    eyeScale: 1.15, shapeTuning: { width: 1.1 } });
  const expected = [
    ['blob', '#EEEBE4', '#1A1A1A'],
    ['cloud', '#5B3BC7', '#FFFFFF'],
    ['aurora-cloud', '#5B3BC7', '#FFFFFF'],
    ['square', '#EEEBE4', '#1A1A1A']
  ];
  let current = original;
  for (const [shape, bodyColor, eyeColor] of expected) {
    current = applyShapeRecommendation(current, shape);
    assert.equal(current.shape, shape);
    assert.equal(current.bodyColor, bodyColor);
    assert.equal(current.eyeColor, eyeColor);
    assert.equal(current.eyeScale, ['aurora-cloud', 'square'].includes(shape) ? 1 : 1.15);
    assert.equal(current.shapeTuning.width, ['aurora-cloud', 'square'].includes(shape) ? 1 : 1.1);
    if (shape === 'aurora-cloud') {
      assert.equal(current.glowPinkColor, '#D05ED6');
      assert.equal(current.glowGoldColor, '#D0AD8A');
    }
    current.bodyColor = '#123456';
    assert.equal(normalizeAppearance(current).bodyColor, '#123456');
  }
  assert.equal(original.bodyColor, '#123456', '原配置不被点选操作直接修改');
  assert.deepEqual(applyShapeRecommendation(current, '__proto__'), current);
});

test('五种新形态有平滑轮廓；幻彩云固定轮廓，其他形态可手调', () => {
  for (const shape of ['dumpling', 'cloud', 'aurora-cloud', 'egg', 'square']) {
    const base = createShape(normalizeAppearance({ shape }));
    const edited = createShape(normalizeAppearance({
      shape, shapeTuning: { width: 1.25, height: 0.75, softness: 0.12, asymmetry: 0.8 }
    }));
    for (const data of [base, edited]) {
      assert.equal(data.ring.length, 96);
      assert.ok(data.ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) &&
        x >= -15 && x <= 244 && y >= -15 && y <= 244), shape);
      assert.ok(data.ring.every((point, i) => {
        const next = data.ring[(i + 1) % data.ring.length];
        return Math.hypot(point[0] - next[0], point[1] - next[1]) < 14;
      }), shape);
      assert.ok(data.face.eye > 0);
    }
    if (shape === 'aurora-cloud') assert.deepEqual(base.ring, edited.ring, shape);
    else assert.notDeepEqual(base.ring, edited.ring, shape);
  }
});

test('幻彩配色独立归一，六瓣轮廓连续且固定眼睛边界', () => {
  const appearance = normalizeAppearance({ shape: 'aurora-cloud', bodyColor: '#5b3bc7',
    eyeColor: '#ffffff', glowPinkColor: '#ec89df', glowGoldColor: 'not-a-color' });
  assert.equal(appearance.bodyColor, '#5B3BC7');
  assert.equal(appearance.eyeColor, '#FFFFFF');
  assert.equal(appearance.glowPinkColor, '#EC89DF');
  assert.equal(appearance.glowGoldColor, '#D0AD8A');
  const shape = createShape(appearance);
  assert.equal(shape.ring.length, 96);
  assert.ok(shape.ring.every((point, index) => point.every(Number.isFinite) &&
    Math.hypot(point[0] - shape.ring[(index + 1) % 96][0], point[1] - shape.ring[(index + 1) % 96][1]) < 14));
  assert.equal(auroraReferenceTexture(appearance, shape), null);
  assert.deepEqual(shape.face.eyeGuard,
    { maxWidth: 32, maxHeight: 60, minGap: 6, minTopFraction: 0.23, maxBottomFraction: 0.8 });
});

test('云形所有待机眼环在普通与放大姿态下完整落入轮廓', () => {
  class SvgNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.style = {}; this.children = []; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key]; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    remove() {}
  }
  const browser = { window: {}, document: { createElementNS: (_ns, tag) => new SvgNode(tag) },
    performance: { now: () => 1 }, console };
  for (const file of ['rings.js', 'custom-shapes.js', 'ball.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../emotion-ball/js', file), 'utf8'), browser);
  }
  const { EB_RINGS: rings, EB_CUSTOM_SHAPES: custom, EmotionBall } = browser.window;
  const shape = custom.createShape({ shape: 'cloud' });
  const container = new SvgNode('div');
  const ball = EmotionBall.createBall(container, { shape: 'cloud', customShape: shape, lite: true });
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const inside = ([x, y], polygon) => {
    let result = false;
    for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i++) {
      const a = polygon[i], b = polygon[previous];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
        result = !result;
      }
    }
    return result;
  };
  const bounds = shape.ring.reduce((result, [x, y]) => ({
    minX: Math.min(result.minX, x), maxX: Math.max(result.maxX, x),
    minY: Math.min(result.minY, y), maxY: Math.max(result.maxY, y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  for (const expression of rings.EXPRESSIONS.keys()) {
    for (const scale of [1, 1.5]) {
      const eyePose = ring => ({ ring, open: 1, scaleX: scale, scaleY: scale,
        x: 0, y: 0, lookX: 0, lookY: 0, rotate: 0, color: '#FFFFFF' });
      ball.applyPose({ body: { x: 0, y: 0, rotate: 0, scale: 1, color: '#304864', yaw: 0 },
        left: eyePose(rings.EXPRESSIONS[expression][0]),
        right: eyePose(rings.EXPRESSIONS[expression][1]) });
      const eyes = descendants(container).filter(node => node.attrs.class === 'eb-eye');
      assert.equal(eyes.length, 2);
      const eyeBounds = [];
      eyes.forEach((eye, side) => {
        const match = eye.attrs.transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)/);
        assert.ok(match, `expression ${expression}, side ${side} has an eye transform`);
        const [x, y, sx, sy, ox, oy] = match.slice(1).map(Number);
        assert.ok((y - bounds.minY) / (bounds.maxY - bounds.minY) < 0.62,
          `expression ${expression}, side ${side} stays in the upper face`);
        assert.ok((x - bounds.minX) / (bounds.maxX - bounds.minX) > 0.38 &&
          (x - bounds.minX) / (bounds.maxX - bounds.minX) < 0.82,
          `expression ${expression}, side ${side} stays near the reference eye position`);
        assert.ok(rings.EXPRESSIONS[expression][side].every(([px, py]) =>
          inside([x + (px + ox) * sx, y + (py + oy) * sy], shape.ring)),
        `expression ${expression}, side ${side}, scale ${scale} fits the cloud without clipping`);
        const xs = rings.EXPRESSIONS[expression][side].map(([px]) => x + (px + ox) * sx);
        eyeBounds[side] = [Math.min(...xs), Math.max(...xs)];
      });
      assert.ok(eyeBounds[1][0] - eyeBounds[0][1] >= 5,
        `expression ${expression}, scale ${scale} keeps both cloud eyes separate`);
    }
  }

  const darkEyePose = ring => ({ ring, open: 1, scaleX: 1, scaleY: 1,
    x: 0, y: 0, lookX: 0, lookY: 0, rotate: 0, color: '#FFFFFF' });
  ball.applyPose({ body: { x: 0, y: 0, rotate: 0, scale: 1, color: '#08090D', yaw: 0 },
    left: darkEyePose(rings.EXPRESSIONS[0][0]), right: darkEyePose(rings.EXPRESSIONS[0][1]) });
  assert.deepEqual(descendants(container).filter(node => node.tag === 'stop')
    .map(node => node.attrs['stop-color']), ['#08090D', '#08090D', '#08090D']);
  ball.applyPose({ body: { x: 0, y: 0, rotate: 0, scale: 1, color: '#304864', yaw: 0 },
    left: darkEyePose(rings.EXPRESSIONS[0][0]), right: darkEyePose(rings.EXPRESSIONS[0][1]) });
  const blueStops = descendants(container).filter(node => node.tag === 'stop')
    .map(node => node.attrs['stop-color']);
  assert.notEqual(blueStops[0], blueStops[1], 'other cloud colors retain their gradient');
  ball.destroy();

  const auroraShape = custom.createShape({ shape: 'aurora-cloud' });
  for (const facing of ['right', 'left']) {
    for (const spacing of [0.7, 1, 1.3]) {
      for (const height of [-30, 0, 30]) {
        const auroraContainer = new SvgNode('div');
        const auroraBall = EmotionBall.createBall(auroraContainer,
          { shape: 'aurora-cloud', customShape: auroraShape, lite: true,
            facing, eyeSpacing: spacing, eyeHeight: height });
        for (const expression of rings.EXPRESSIONS.keys()) {
          for (const scale of [1, 1.5, 1.875]) {
            const eyePose = ring => ({ ring, open: 1, scaleX: scale, scaleY: scale,
              x: 0, y: 0, lookX: 0, lookY: 0, rotate: 0, color: '#FFFFFF' });
            auroraBall.applyPose({ body: { x: 0, y: 0, rotate: 0, scale: 1, color: '#5B3BC7', yaw: 0 },
              left: eyePose(rings.EXPRESSIONS[expression][0]),
              right: eyePose(rings.EXPRESSIONS[expression][1]) });
            const eyeBounds = descendants(auroraContainer).filter(node => node.attrs.class === 'eb-eye')
              .map((eye, side) => {
                const match = eye.attrs.transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)/);
                assert.ok(match, `aurora ${facing}/${spacing}/${height}/${expression}/${scale} side ${side} has a transform`);
                const [x, y, sx, sy, ox, oy] = match.slice(1).map(Number);
                const renderedRing = [...eye.attrs.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]
                  .map(([, px, py]) => [Number(px), Number(py)]);
                assert.equal(renderedRing.length, rings.EXPRESSIONS[expression][side].length,
                  '验证实际弧形眼路径，不能只检测未经弯曲的原始眼环');
                const points = renderedRing.map(([px, py]) =>
                  [x + (px + ox) * sx, y + (py + oy) * sy]);
                assert.ok(points.every(point => inside(point, auroraShape.ring)),
                  `aurora ${facing}/${spacing}/${height}/${expression}/${scale} side ${side} fits the body`);
                const xs = points.map(([pointX]) => pointX);
                return [Math.min(...xs), Math.max(...xs)];
              }).sort((a, b) => a[0] - b[0]);
            assert.ok(eyeBounds[1][0] - eyeBounds[0][1] >= 5,
              `aurora ${facing}/${spacing}/${height}/${expression}/${scale} keeps both eyes separate`);
          }
        }
        auroraBall.destroy();
      }
    }
  }
});
