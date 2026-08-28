const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIZES } = require('../lib/window-placement');

const {
  MOTIONS,
  getMotion,
  chooseMotion,
  sampleMotion,
  positionForMotion
} = require('../lib/interaction-motion');

test('交互动作数学模块文件存在', () => {
  const modulePath = path.join(__dirname, '..', 'lib', 'interaction-motion.js');
  assert.equal(fs.existsSync(modulePath), true);
});

test('动作目录按合同顺序和权重提供六个动作', () => {
  assert.deepEqual(MOTIONS, [
    { id: 'hop', durationMs: 1800, weight: 2, emotion: '10' },
    { id: 'jelly', durationMs: 1600, weight: 2, emotion: '03' },
    { id: 'sway', durationMs: 1800, weight: 2, emotion: '19' },
    { id: 'peek', durationMs: 1900, weight: 2, emotion: '03' },
    { id: 'bow', durationMs: 1600, weight: 2, emotion: '14' },
    { id: 'spin', durationMs: 1600, weight: 1, emotion: '10' }
  ]);
});

test('getMotion只接受动作目录自身的id', () => {
  assert.equal(getMotion('hop'), MOTIONS[0]);
  assert.equal(getMotion('toString'), null);
  assert.equal(getMotion('__proto__'), null);
  assert.equal(getMotion('missing'), null);
});

test('chooseMotion按归一化随机数加权并排除上次动作', () => {
  assert.equal(chooseMotion(0, null).id, 'hop');
  assert.equal(chooseMotion(0.18, null).id, 'hop');
  assert.equal(chooseMotion(0.2, null).id, 'jelly');
  assert.equal(chooseMotion(0.92, null).id, 'spin');
  assert.equal(chooseMotion(1, null).id, 'spin');
  assert.notEqual(chooseMotion(0, 'hop').id, 'hop');
  assert.equal(chooseMotion(Number.NaN, null).id, 'hop');
  assert.equal(chooseMotion('0.9', null).id, 'hop');
  assert.equal(chooseMotion(-5, null).id, 'hop');
  assert.equal(chooseMotion(Infinity, null).id, 'hop');
  const seen = new Set();
  for (let i = 0; i < 6; i += 1) seen.add(chooseMotion(i / 6, 'hop').id);
  assert.equal(seen.has('hop'), false);
});

const neutral = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  yaw: 0
};

test('未知采样返回null，异常时间安全回到未完成起始帧', () => {
  assert.equal(sampleMotion('missing', 0), null);
  assert.deepEqual(sampleMotion('hop', Number.NaN), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: false
  });
  assert.deepEqual(sampleMotion('hop', -1), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: false
  });
});

test('采样起止精确中性并在分段内平滑插值', () => {
  assert.deepEqual(sampleMotion('hop', 0), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: false
  });
  assert.deepEqual(sampleMotion('hop', 1800), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: true
  });
  assert.deepEqual(sampleMotion('hop', 1801), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: true
  });
  const middle = sampleMotion('hop', 90);
  assert(middle.body.scaleX > 1 && middle.body.scaleX < 1.06);
  assert(middle.body.scaleY < 1 && middle.body.scaleY > 0.78);
  assert(middle.body.y > 0 && middle.body.y < 14);
  assert.equal(middle.done, false);
  assert.equal(sampleMotion('spin', 1320).body.yaw, Math.PI * 2);
  assert.equal(sampleMotion('bow', 260).body.y, 18);
  assert.equal(sampleMotion('bow', 260).body.yaw, 0);
});

test('五种全身动作的关键轨迹和hop两次离地落地形变存在', () => {
  const hop = [180, 350, 540, 760, 940, 1120, 1330, 1550].map((t) => sampleMotion('hop', t));
  assert(hop[0].body.y > 0 && hop[0].body.scaleY < 1);
  assert(hop[1].window.y < 0 && hop[2].window.y < 0);
  assert(hop[3].body.y > 0 && hop[3].body.scaleY < 1);
  assert(hop[4].window.y < 0 && hop[5].window.y < 0);
  assert.notEqual(sampleMotion('jelly', 220).body.scaleY, 1);
  assert(sampleMotion('sway', 250).body.rotate < 0);
  assert(sampleMotion('sway', 520).body.rotate > 0);
  assert(sampleMotion('peek', 260).gaze.x < 0);
  assert(sampleMotion('peek', 1180).gaze.x > 0);
  assert(sampleMotion('bow', 260).body.y > 0);
  assert(sampleMotion('spin', 1320).body.yaw > 6);
});

test('每16ms采样全部动作均为有限值且外包络位于安全范围', () => {
  const min = -7;
  const max = 236;
  const radius = 114.3;
  const center = 114.2705;
  for (const motion of MOTIONS) {
    for (let elapsed = 0; elapsed <= motion.durationMs; elapsed += 16) {
      const sample = sampleMotion(motion.id, elapsed);
      for (const value of Object.values(sample.body)) assert(Number.isFinite(value));
      for (const value of Object.values(sample.window)) assert(Number.isFinite(value));
      for (const value of Object.values(sample.gaze)) assert(Number.isFinite(value));
      const angle = sample.body.rotate * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = radius * Math.sqrt((sample.body.scaleX * cos) ** 2 + (sample.body.scaleY * sin) ** 2);
      const ry = radius * Math.sqrt((sample.body.scaleX * sin) ** 2 + (sample.body.scaleY * cos) ** 2);
      assert(center + sample.body.x - rx >= min - 1e-9);
      assert(center + sample.body.x + rx <= max + 1e-9);
      assert(center + sample.body.y - ry >= min - 1e-9);
      assert(center + sample.body.y + ry <= max + 1e-9);
    }
  }
});

test('positionForMotion按259基准缩放偏移并夹在不同尺寸工作区', () => {
  for (const size of Object.values(SIZES).map(size => size.width)) {
    const bounds = { x: 100, y: 200, width: size, height: size };
    const area = { x: 0, y: 0, width: 500, height: 400 };
    assert.deepEqual(positionForMotion(bounds, area, { x: 13, y: -26 }), {
      x: Math.min(500 - size, 100 + Math.round(13 * size / 259)),
      y: Math.max(0, Math.min(400 - size, 200 - Math.round(26 * size / 259)))
    });
  }
  assert.deepEqual(positionForMotion(
    { x: -100, y: -80, width: 180, height: 180 },
    { x: -500, y: -400, width: 800, height: 700 },
    { x: -1000, y: 1000 }
  ), { x: -500, y: 120 });
  assert.deepEqual(positionForMotion(
    { x: 1000, y: 800, ...SIZES.large },
    { x: 0, y: 0, width: 500, height: 400 },
    { x: 1000, y: -1000 }
  ), { x: 500 - SIZES.large.width, y: 0 });
});

test('positionForMotion拒绝无穷字段、非正尺寸和放不下的窗口', () => {
  const bounds = { x: 0, y: 0, width: 180, height: 180 };
  const area = { x: 0, y: 0, width: 500, height: 400 };
  assert.equal(positionForMotion({ ...bounds, x: Infinity }, area, { x: 0, y: 0 }), null);
  assert.equal(positionForMotion(bounds, { ...area, width: 0 }, { x: 0, y: 0 }), null);
  assert.equal(positionForMotion({ ...bounds, width: -1 }, area, { x: 0, y: 0 }), null);
  assert.equal(positionForMotion(bounds, area, { x: Number.NaN, y: 0 }), null);
  assert.equal(positionForMotion(bounds, { x: 0, y: 0, width: 100, height: 400 }, { x: 0, y: 0 }), null);
  assert.equal(positionForMotion(bounds, { x: 0, y: 0, width: 500, height: 100 }, { x: 0, y: 0 }), null);
  assert.equal(positionForMotion(bounds, area, null), null);
});

test('六个动作的起止帧都中性、done正确且采样结果不共享可变对象', () => {
  for (const motion of MOTIONS) {
    const start = sampleMotion(motion.id, 0);
    const end = sampleMotion(motion.id, motion.durationMs);
    const after = sampleMotion(motion.id, motion.durationMs + 1);
    for (const sample of [start, end, after]) {
      assert.deepEqual(sample.body, neutral);
      assert.deepEqual(sample.window, { x: 0, y: 0 });
      assert.deepEqual(sample.gaze, { x: 0, y: 0 });
    }
    assert.equal(start.done, false);
    assert.equal(end.done, true);
    assert.equal(after.done, true);
    assert.notStrictEqual(start.body, end.body);
    assert.notStrictEqual(start.window, end.window);
    assert.notStrictEqual(start.gaze, end.gaze);
    assert.notStrictEqual(end.body, after.body);
    assert.notStrictEqual(end.window, after.window);
    assert.notStrictEqual(end.gaze, after.gaze);
    start.body.x = 99;
    start.window.x = 99;
    start.gaze.x = 99;
    assert.equal(end.body.x, 0);
    assert.equal(end.window.x, 0);
    assert.equal(end.gaze.x, 0);
  }
});

test('所有previousId都不会再次选中同一个动作', () => {
  for (const motion of MOTIONS) {
    for (const random of [0, 0.37, 0.99]) {
      assert.notEqual(chooseMotion(random, motion.id).id, motion.id);
    }
  }
});

test('hop第二次落地关键帧也有压扁形变', () => {
  const secondLanding = sampleMotion('hop', 1330);
  assert.deepEqual(secondLanding.body, {
    x: 0,
    y: 9,
    scaleX: 1.04,
    scaleY: 0.86,
    rotate: 0,
    yaw: 0
  });
  assert.deepEqual(secondLanding.window, { x: 0, y: 0 });
});

test('五种身体轨迹互异，peek停顿、bow两次点头和sway左右交替明确', () => {
  const ids = ['hop', 'jelly', 'sway', 'peek', 'bow'];
  const trajectorySignatures = ids.map((id) => JSON.stringify(
    [100, 300, 700, 1000, 1300].map((elapsed) => sampleMotion(id, elapsed).body)
  ));
  assert.equal(new Set(trajectorySignatures).size, ids.length);

  assert.deepEqual(sampleMotion('peek', 260), sampleMotion('peek', 600));
  assert.deepEqual(sampleMotion('peek', 1180), sampleMotion('peek', 1540));
  assert.notDeepEqual(sampleMotion('peek', 259), sampleMotion('peek', 260));
  assert.notDeepEqual(sampleMotion('peek', 1540), sampleMotion('peek', 1541));

  assert.deepEqual(sampleMotion('bow', 260), sampleMotion('bow', 440));
  assert.deepEqual(sampleMotion('bow', 900), sampleMotion('bow', 1100));
  assert.notDeepEqual(sampleMotion('bow', 260), sampleMotion('bow', 900));
  assert.deepEqual(sampleMotion('bow', 650), {
    body: neutral,
    window: { x: 0, y: 0 },
    gaze: { x: 0, y: 0 },
    done: false
  });

  assert.equal(sampleMotion('sway', 250).body.rotate, -14);
  assert.equal(sampleMotion('sway', 520).body.rotate, 14);
  assert.equal(sampleMotion('sway', 790).body.rotate, -12);
  assert.equal(sampleMotion('sway', 1100).body.rotate, 12);
  assert(sampleMotion('sway', 250).window.x < 0);
  assert(sampleMotion('sway', 520).window.x > 0);
  assert(sampleMotion('sway', 790).window.x < 0);
  assert(sampleMotion('sway', 1100).window.x > 0);
});

test('非中点采样使用smoothstep而非线性插值', () => {
  const quarter = sampleMotion('hop', 45);
  const eased = 0.15625;
  assert(Math.abs(quarter.body.scaleX - (1 + 0.06 * eased)) < 1e-12);
  assert(Math.abs(quarter.body.scaleY - (1 - 0.22 * eased)) < 1e-12);
  assert(Math.abs(quarter.body.y - 14 * eased) < 1e-12);
});

test('1ms采样全部动作始终有限且保持旋转椭圆安全包络', () => {
  const min = -7;
  const max = 236;
  const radius = 114.3;
  const center = 114.2705;
  for (const motion of MOTIONS) {
    for (let elapsed = 0; elapsed <= motion.durationMs; elapsed += 1) {
      const sample = sampleMotion(motion.id, elapsed);
      const body = sample.body;
      for (const value of Object.values(body)) assert(Number.isFinite(value));
      const angle = body.rotate * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = radius * Math.sqrt((body.scaleX * cos) ** 2 + (body.scaleY * sin) ** 2);
      const ry = radius * Math.sqrt((body.scaleX * sin) ** 2 + (body.scaleY * cos) ** 2);
      assert(center + body.x - rx >= min - 1e-9);
      assert(center + body.x + rx <= max + 1e-9);
      assert(center + body.y - ry >= min - 1e-9);
      assert(center + body.y + ry <= max + 1e-9);
    }
  }
});

test('产品全部实际尺寸在正负工作区四角均正确clamp位置', () => {
  const sizes = Object.values(SIZES).map(size => size.width);
  const workAreas = [
    { x: 100, y: 80, width: 1200, height: 900 },
    { x: -1300, y: -900, width: 1200, height: 900 }
  ];
  const corners = [
    { x: -10000, y: -10000, horizontal: 'left', vertical: 'top' },
    { x: 10000, y: -10000, horizontal: 'right', vertical: 'top' },
    { x: -10000, y: 10000, horizontal: 'left', vertical: 'bottom' },
    { x: 10000, y: 10000, horizontal: 'right', vertical: 'bottom' }
  ];
  for (const area of workAreas) {
    for (const size of sizes) {
      const bounds = {
        x: area.x + 500,
        y: area.y + 300,
        width: size,
        height: size
      };
      for (const corner of corners) {
        const expectedX = corner.horizontal === 'left'
          ? area.x
          : area.x + area.width - size;
        const expectedY = corner.vertical === 'top'
          ? area.y
          : area.y + area.height - size;
        assert.deepEqual(positionForMotion(bounds, area, corner), {
          x: expectedX,
          y: expectedY
        });
      }
    }
  }
});
