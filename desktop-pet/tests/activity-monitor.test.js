const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function createGuard() {
  const { createPowerGuard } = require('../lib/activity-monitor');
  assert.equal(typeof createPowerGuard, 'function', '需要独立维护锁屏与系统睡眠的暂停守卫');
  const calls = [];
  const guard = createPowerGuard({ pause: () => calls.push('pause'), resume: () => calls.push('resume') });
  return { guard, calls };
}

test('暂停守卫初始清醒且重复清除状态没有副作用', () => {
  const { guard, calls } = createGuard();
  assert.equal(guard.isPaused(), false);
  guard.setLocked(false);
  guard.setSuspended(false);
  assert.equal(guard.isPaused(), false);
  assert.deepEqual(calls, []);
});

for (const method of ['setLocked', 'setSuspended']) {
  test(`${method} 独立暂停恢复且重复事件幂等`, () => {
    const { guard, calls } = createGuard();
    guard[method](true);
    guard[method](true);
    assert.equal(guard.isPaused(), true);
    assert.deepEqual(calls, ['pause']);
    guard[method](false);
    guard[method](false);
    assert.equal(guard.isPaused(), false);
    assert.deepEqual(calls, ['pause', 'resume']);
  });
}

for (const first of ['setLocked', 'setSuspended']) {
  const second = first === 'setLocked' ? 'setSuspended' : 'setLocked';
  for (const clearFirst of [first, second]) {
    const clearLast = clearFirst === first ? second : first;
    test(`${first}→${second} 后先解除 ${clearFirst} 仍保持暂停`, () => {
      const { guard, calls } = createGuard();
      guard[first](true);
      guard[second](true);
      assert.equal(guard.isPaused(), true);
      assert.deepEqual(calls, ['pause']);
      guard[clearFirst](false);
      guard[clearFirst](false);
      assert.equal(guard.isPaused(), true);
      assert.deepEqual(calls, ['pause']);
      guard[clearLast](false);
      guard[clearLast](false);
      assert.equal(guard.isPaused(), false);
      assert.deepEqual(calls, ['pause', 'resume']);
    });
  }
}

test('完整恢复后下一轮锁屏仍会再次暂停', () => {
  const { guard, calls } = createGuard();
  for (let round = 0; round < 2; round += 1) {
    guard.setLocked(true);
    guard.setSuspended(true);
    guard.setSuspended(false);
    guard.setLocked(false);
  }
  assert.equal(guard.isPaused(), false);
  assert.deepEqual(calls, ['pause', 'resume', 'pause', 'resume']);
});

test('活动采样只包含坐标、空闲时长和屏幕，不包含输入内容', () => {
  const file = path.resolve(__dirname, '../lib/activity-monitor.js');
  assert.ok(fs.existsSync(file), '需要系统活动采样器');
  const { createActivityMonitor } = require(file);
  let tick = 0;
  let idleReads = 0;
  const packets = [];
  const monitor = createActivityMonitor({
    clock: () => tick,
    screen: {
      getCursorScreenPoint: () => ({ x: 10, y: 30 }),
      getDisplayNearestPoint: () => ({ id: 1 }),
      getDisplayMatching: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1000, height: 700 } })
    },
    powerMonitor: { getSystemIdleTime: () => { idleReads++; return 42; } },
    getWindow: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 80, height: 80 }) }),
    onSample: packet => packets.push(packet)
  });
  monitor.sampleNow();
  tick = 125;
  monitor.sampleNow();
  assert.equal(idleReads, 1);
  assert.deepEqual(Object.keys(packets[0]).sort(), ['cursor', 'idleSeconds', 'locked', 'petBounds', 'sameDisplay', 'workArea']);
  assert.deepEqual(packets[0].workArea, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(packets[0].idleSeconds, 42);
  monitor.pause();
  assert.equal(packets.at(-1).locked, true);
  monitor.sampleNow();
  assert.equal(idleReads, 1);
  monitor.resume();
  assert.equal(packets.at(-1).locked, false);
  monitor.stop();
});

test('空闲检测失败时用未知值，不误判长时间离开', () => {
  const file = path.resolve(__dirname, '../lib/activity-monitor.js');
  assert.ok(fs.existsSync(file), '需要系统活动采样器');
  const { createActivityMonitor } = require(file);
  let packet;
  const monitor = createActivityMonitor({
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1 }),
      getDisplayMatching: () => ({ id: 2, workArea: { x: -500, y: 0, width: 500, height: 600 } }) },
    powerMonitor: { getSystemIdleTime: () => { throw new Error('not available'); } },
    getWindow: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 20, y: 20, width: 80, height: 80 }) }),
    onSample: value => { packet = value; }
  });
  monitor.sampleNow();
  assert.equal(packet.idleSeconds, null);
  assert.equal(packet.sameDisplay, false);
  assert.deepEqual(packet.workArea, { x: -500, y: 0, width: 500, height: 600 });
});
