const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { createBubbleWindow } = require('../lib/bubble-window');

function fixture(load, getObstacles = () => []) {
  const windows = [];
  const errors = [];
  class NativeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setIgnoreMouseEvents(value) { this.ignored = value; }
    loadFile() { return load(windows.length); }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const bubble = createBubbleWindow({
    BrowserWindow: NativeWindow,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1512, height: 982 } }) },
    getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 300, y: 300, width: 80, height: 80 }) }),
    getObstacles,
    onError: error => errors.push(error)
  });
  const show = id => bubble.show({ id, text: '我在呢。', actions: [], durationMs: 4000 });
  return { bubble, windows, errors, show };
}

test('气泡加载失败会销毁坏窗口，下次互动能重新加载', async t => {
  const f = fixture(index => index === 1 ? Promise.reject(new Error('load failed')) : Promise.resolve());
  t.after(() => f.bubble.destroy());
  f.show(1);
  await flush();
  assert.equal(f.windows[0].isDestroyed(), true);
  f.show(2);
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
  assert.equal(f.errors.length, 1);
});

test('气泡渲染崩溃后可在下一次互动恢复', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.bubble.destroy());
  f.show(1);
  await flush();
  f.windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.windows[0].isDestroyed(), true);
  f.show(2);
  await flush();
  assert.equal(f.windows[1].visible, true);
  assert.equal(f.errors.length, 1);
});

test('旧窗口迟到的加载失败不能关闭新窗口', async t => {
  let rejectOld;
  const f = fixture(index => index === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve());
  t.after(() => f.bubble.destroy());
  f.show(1);
  f.bubble.destroy();
  f.show(2);
  await flush();
  rejectOld(new Error('old failed'));
  await flush();
  assert.equal(f.windows[1].visible, true);
  assert.equal(f.errors.length, 0);
});

test('加载过程中收起气泡，加载完成也不再弹出', async t => {
  let finishLoad;
  const f = fixture(() => new Promise(resolve => { finishLoad = resolve; }));
  t.after(() => f.bubble.destroy());
  f.show(1);
  f.bubble.hide();
  finishLoad();
  await flush();
  assert.equal(f.windows[0].visible, false);
});

test('渲染层测得长文案高度后只调整当前气泡', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.bubble.destroy());
  f.show(1);
  await flush();
  assert.equal(f.windows[0].bounds.height, 86);
  assert.equal(f.bubble.resize({ id: 1, height: 146 }), true);
  assert.equal(f.windows[0].bounds.height, 146);
  assert.equal(f.bubble.resize({ id: 0, height: 180 }), false);
  assert.equal(f.windows[0].bounds.height, 146);
});

test('快捷布局与长文案变化即时避让，仍保留互动鼠标与原四秒隐藏计时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let obstacles = [];
  const f = fixture(() => Promise.resolve(), () => obstacles); t.after(() => f.bubble.destroy());
  f.bubble.show({ id: 1, text: '我在呢。', actions: [{ id: 'rest', label: '歇会儿' }], durationMs: 4000 });
  await flush();
  const win = f.windows[0], initial = { ...win.bounds };
  assert.equal(win.ignored, false, 'interactive dialogue remains clickable');
  obstacles = [initial]; f.bubble.reposition();
  const intersects = b => b.x < initial.x + initial.width && b.x + b.width > initial.x && b.y < initial.y + initial.height && b.y + b.height > initial.y;
  assert.equal(intersects(win.bounds), false);
  f.bubble.resize({ id: 1, height: 146 });
  assert.equal(intersects(win.bounds), false, 'measured text height uses the same obstacles');
  t.mock.timers.tick(3999); assert.equal(win.visible, true);
  t.mock.timers.tick(1); assert.equal(win.visible, false, 'reposition does not restart the original lifetime');
  assert.equal(win.ignored, true);
});
