const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../lib/edge-tuck.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};

function fixture({ size = 80, x = -600, side = null } = {}) {
  assert.equal(typeof api.createEdgeTuck, 'function', '提供可独立验证的边缘状态控制器');
  let bounds = { x, y: 100, width: size, height: size };
  let area = { x: -800, y: 0, width: 800, height: 600 };
  let now = 0, serial = 0;
  const timers = new Map(), packets = [], ignores = [];
  let retention = [];
  const win = { isDestroyed: () => false, getBounds: () => ({ ...bounds }),
    setPosition(x, y) { bounds.x = x; bounds.y = y; },
    setIgnoreMouseEvents(value) { ignores.push(value); } };
  const controller = api.createEdgeTuck({ getWindow: () => win, getWorkArea: () => area,
    getRetentionBounds: () => retention, onChange: packet => packets.push(packet),
    schedule(callback, delay) { timers.set(++serial, { callback, at: now + delay }); return serial; },
    cancel(id) { timers.delete(id); } });
  if (side) controller.dock(side);
  return { controller, win, timers, packets, ignores,
    get bounds() { return { ...bounds }; }, setBounds(next) { bounds = { ...bounds, ...next }; },
    setArea(next) { area = next; }, retain(next) { retention = next; },
    sample(x, y = 140) { controller.sampleCursor({ x, y }); },
    advance(time) { now = time; for (const [id, entry] of [...timers]) if (entry.at <= now) { timers.delete(id); entry.callback(); } }
  };
}

for (const size of [60, 80, 120, 180, 260]) for (const side of ['left', 'right']) {
  test(`${size}px ${side}收起只平移内容，原生完整方窗留在负坐标屏幕内`, () => {
    const f = fixture({ size, side });
    assert.equal(f.controller.getPresentation().mode, 'tucked');
    assert.equal(f.controller.getPresentation().side, side);
    assert.equal(f.controller.getPresentation().suppressed, true);
    assert.equal(f.bounds.x, side === 'left' ? -800 : -size);
    assert.ok(f.bounds.y >= 0 && f.bounds.y + size <= 600);
  });
}

test('离边16px的真实拖动收起，点击松手及离边17px保持自由', () => {
  const f = fixture({ x: -784 });
  f.controller.beginDrag(); f.controller.endDrag(false);
  assert.equal(f.controller.getPresentation().mode, 'free');
  f.controller.beginDrag(); f.controller.endDrag(true);
  assert.equal(f.controller.getPresentation().mode, 'tucked');
  f.controller.beginDrag(); f.setBounds({ x: -783 }); f.controller.endDrag(true);
  assert.equal(f.controller.getPresentation().mode, 'free');
  assert.equal(f.controller.getPresentation().side, null);
});

test('仅可见半球接收鼠标；进入展开、离开650ms收回，再进入取消旧回调', () => {
  const f = fixture({ side: 'left' });
  f.sample(-730); // 方窗空白的一半不能挡住桌面。
  assert.equal(f.ignores.at(-1), true);
  f.sample(-780);
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  assert.equal(f.ignores.at(-1), false);
  f.sample(-500); f.advance(649);
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  const stale = [...f.timers.values()][0].callback;
  f.sample(-730); stale();
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  f.sample(-500); f.advance(1299);
  assert.equal(f.controller.getPresentation().mode, 'tucked');
});

test('移到可见额度卡片或打开菜单时保持展开，离开后继续计时', () => {
  const f = fixture({ side: 'right' });
  f.sample(-500); f.sample(-20);
  f.retain([{ x: -220, y: 100, width: 130, height: 100 }]);
  f.sample(-180); f.advance(2000);
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  f.controller.pin(true); f.sample(-500); f.advance(4000);
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  f.controller.pin(false); f.advance(4650);
  assert.equal(f.controller.getPresentation().mode, 'tucked');
});

test('拖动期间取消收起且旧计时无效；离开边缘不再收回', () => {
  const f = fixture({ side: 'left' });
  f.sample(-500); f.sample(-780); f.sample(-500);
  const stale = [...f.timers.values()][0].callback;
  f.controller.beginDrag(); f.setBounds({ x: -400 }); stale();
  assert.equal(f.controller.getPresentation().dragging, true);
  assert.equal(f.controller.getPresentation().mode, 'peeked');
  f.controller.endDrag(true); f.advance(1000);
  assert.equal(f.controller.getPresentation().mode, 'free');
  assert.equal(f.ignores.at(-1), false);
});

for (const reason of ['hide', 'suspend', 'dispose', 'restore', 'recover']) {
  test(`${reason}取消旧悬停计时，不让旧回调改变恢复状态`, () => {
    const f = fixture({ side: 'left' });
    f.sample(-500); f.sample(-780); f.sample(-500);
    const stale = [...f.timers.values()][0].callback;
    f.controller[reason]();
    const before = f.controller.getPresentation();
    stale(); f.advance(1000);
    assert.deepEqual(f.controller.getPresentation(), before);
    assert.equal(f.timers.size, 0);
  });
}

test('隐藏恢复后自由展示，尺寸和工作区变化后恢复完整可见位置', () => {
  const f = fixture({ side: 'right' });
  f.controller.hide();
  assert.equal(f.controller.getPresentation().mode, 'hidden');
  f.controller.restore();
  assert.equal(f.controller.getPresentation().mode, 'free');
  assert.equal(f.controller.getPresentation().side, null);
  f.controller.dock('right');
  f.setBounds({ width: 260, height: 260, y: 550 });
  f.setArea({ x: 0, y: 30, width: 700, height: 500 });
  f.controller.recover();
  assert.deepEqual(f.bounds, { x: 440, y: 270, width: 260, height: 260 });
  assert.equal(f.controller.getPresentation().mode, 'tucked');
});

test('快照不能从外部篡改，恢复会解除鼠标穿透，恢复采样时不会重放旧计时', () => {
  const f = fixture({ side: 'right' });
  f.sample(-500);
  const snapshot = f.controller.getPresentation(); snapshot.mode = 'hidden';
  assert.equal(f.controller.getPresentation().mode, 'tucked');
  f.controller.suspend(); f.controller.resume();
  assert.equal(f.controller.getPresentation().suppressed, true);
  f.controller.restore();
  assert.equal(f.ignores.at(-1), false);
  assert.equal(f.controller.getPresentation().suppressed, false);
});

test('普通松手确认不取消新拖动，只有明确恢复位置才发送cancelDrag', () => {
  const f = fixture();
  f.controller.beginDrag();
  f.controller.endDrag(false);
  assert.equal(f.packets.at(-1).dragging, false);
  assert.equal(f.packets.at(-1).cancelDrag, undefined);
  f.controller.beginDrag();
  f.controller.recover();
  assert.equal(f.packets.at(-1).cancelDrag, true);
  assert.equal(f.packets.at(-1).dragging, false);
  f.controller.beginDrag();
  f.controller.restore();
  assert.equal(f.packets.at(-1).cancelDrag, true);
  f.controller.beginDrag();
  assert.equal(f.packets.at(-1).cancelDrag, undefined, '强制取消是一次通知，不保留到下一次拖动');
});

test('暂停快照显式阻止安静动画，恢复后不保留paused字段', () => {
  const f = fixture({ side: 'left' });
  assert.equal(f.controller.getPresentation().paused, undefined);
  f.controller.suspend();
  assert.equal(f.packets.at(-1).paused, true);
  assert.equal(f.controller.getPresentation().paused, true);
  assert.equal(f.controller.getPresentation().suppressed, true);
  f.controller.resume();
  assert.equal(f.packets.at(-1).paused, undefined);
  assert.equal(f.controller.getPresentation().suppressed, true, '恢复微动画仍禁止大动作');
});
