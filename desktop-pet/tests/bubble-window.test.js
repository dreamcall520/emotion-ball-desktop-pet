const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { createBubbleWindow } = require('../lib/bubble-window');

function fixture(load) {
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
    setBounds() {}
    setIgnoreMouseEvents() {}
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
