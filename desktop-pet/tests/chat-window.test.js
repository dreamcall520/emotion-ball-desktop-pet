const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { setTimeout: sleep } = require('node:timers/promises');
const { chatBounds, createChatWindow } = require('../lib/chat-window');

test('聊天面板朝屏幕内侧展开，给球球留出十二像素间隔', () => {
  const area = { x: 0, y: 25, width: 1512, height: 900 };
  const left = chatBounds({ x: -40, y: 350, width: 80, height: 80 }, area);
  const right = chatBounds({ x: 1472, y: 350, width: 80, height: 80 }, area);
  assert.deepEqual(left, { x: 52, y: 150, width: 360, height: 480 });
  assert.deepEqual(right, { x: 1100, y: 150, width: 360, height: 480 });
});

test('多屏负坐标、屏幕四角与部分藏到屏外的位置均不遮挡菜单栏或 Dock', () => {
  for (const area of [
    { x: 0, y: 25, width: 1512, height: 900 },
    { x: -1920, y: -1055, width: 1920, height: 1000 }
  ]) {
    for (const x of [area.x - 40, area.x, area.x + area.width - 40]) {
      for (const y of [area.y, area.y + area.height / 2, area.y + area.height - 80]) {
        const bounds = chatBounds({ x, y, width: 80, height: 80 }, area);
        assert.ok(bounds.x >= area.x + 12);
        assert.ok(bounds.y >= area.y + 12);
        assert.ok(bounds.x + bounds.width <= area.x + area.width - 12);
        assert.ok(bounds.y + bounds.height <= area.y + area.height - 12);
      }
    }
  }
});

test('小工作区会缩小聊天窗口，极端尺寸仍保持正尺寸且完全在屏内', () => {
  for (const area of [
    { x: -200, y: -100, width: 280, height: 320 },
    { x: 0, y: 0, width: 1, height: 1 }
  ]) {
    const bounds = chatBounds({ x: area.x, y: area.y, width: 80, height: 80 }, area);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y + bounds.height <= area.y + area.height);
  }
});

function fixture(load = () => Promise.resolve(), getAppearance = () => null, getAvatarImage = async () => null) {
  const windows = [], errors = [], visibility = [], moves = [];
  const petBounds = { x: 1300, y: 350, width: 80, height: 80 };
  const pet = new EventEmitter();
  pet.isDestroyed = () => false;
  pet.getBounds = () => ({ ...petBounds });
  pet.setPosition = (x, y) => {
    petBounds.x = x;
    petBounds.y = y;
    pet.emit('move');
  };
  class NativeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.focusCount = 0;
      this.messages = [];
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
      this.webContents.send = (...args) => this.messages.push(args);
      windows.push(this);
    }
    setAlwaysOnTop(value) { this.topmost = value; }
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return { ...this.bounds }; }
    setPosition(x, y) {
      this.bounds = { ...this.bounds, x, y };
      this.emit('move');
    }
    loadFile() { return load(windows.length); }
    show() { this.visible = true; this.emit('show'); }
    focus() { this.focusCount += 1; }
    hide() { this.visible = false; this.emit('hide'); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const chat = createChatWindow({
    BrowserWindow: NativeWindow,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 25, width: 1512, height: 900 } }) },
    getPetWindow: () => pet,
    getAppearance,
    getAvatarImage,
    onMoveEnd: () => moves.push({ ...petBounds }),
    onError: error => errors.push(error),
    onVisibilityChange: visible => visibility.push(visible)
  });
  pet.on('move', () => chat.reposition());
  return { chat, pet, windows, errors, visibility, moves };
}

test('拖动聊天标题栏时球球跟随，独立拖动球球时聊天窗仍重排', async t => {
  const f = fixture();
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  await flush();
  const win = f.windows[0];
  const before = win.getBounds();
  const next = { ...before, x: before.x - 70, y: before.y + 35 };
  win.emit('will-move', {}, next);
  assert.deepEqual(f.pet.getBounds(), { x: 1230, y: 385, width: 80, height: 80 });
  assert.deepEqual(win.getBounds(), before, 'macOS 原生窗口移动前，球球已预先跟随');
  win.setPosition(next.x, next.y);
  assert.deepEqual(win.getBounds(), next);
  f.pet.setPosition(450, 450);
  assert.deepEqual(win.getBounds(), chatBounds(f.pet.getBounds(), { x: 0, y: 25, width: 1512, height: 900 }));
});

test('松开聊天窗后，窗口与球球一起留在工作区内', async t => {
  const f = fixture();
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  await flush();
  const win = f.windows[0];
  const before = win.getBounds();
  win.setPosition(before.x + 500, before.y - 300);
  win.emit('moved');
  assert.equal(f.moves.length, 0, 'macOS 的 moved 是 move 别名，拖动中不得落盘');
  await sleep(250);
  assert.deepEqual(f.moves, [f.pet.getBounds()], '原生拖动结束时持久化球球最终位置一次');
  const chat = win.getBounds();
  const pet = f.pet.getBounds();
  assert.equal(pet.x - chat.x, 372);
  assert.equal(pet.y - chat.y, 200);
  assert.ok(chat.x >= 12 && chat.x + chat.width <= 1500);
  assert.ok(pet.x >= 12 && pet.x + pet.width <= 1500);
  assert.ok(chat.y >= 37 && chat.y + chat.height <= 913);
  assert.ok(pet.y >= 37 && pet.y + pet.height <= 913);
});

test('聊天头像收到当前外观，保存外观后同步；重复状态更新不反复发送', async t => {
  let appearance = { shape: 'blob', bodyColor: '#EEEBE4' };
  const f = fixture(() => Promise.resolve(), () => appearance);
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  await flush();
  const win = f.windows[0];
  assert.deepEqual(win.messages.filter(([channel]) => channel === 'pet:chat-appearance'),
    [['pet:chat-appearance', appearance]]);
  f.chat.update({ messages: [{ id: 1, text: '你好' }] });
  assert.equal(win.messages.filter(([channel]) => channel === 'pet:chat-appearance').length, 1);
  appearance = { shape: 'aurora-cloud', bodyColor: '#5B3BC7' };
  f.chat.syncAppearance();
  assert.deepEqual(win.messages.filter(([channel]) => channel === 'pet:chat-appearance').at(-1),
    ['pet:chat-appearance', appearance]);
  assert.equal(win.focusCount, 1);
  f.chat.destroy();
  f.chat.show({ messages: [] });
  await flush();
  assert.deepEqual(f.windows[1].messages.filter(([channel]) => channel === 'pet:chat-appearance'),
    [['pet:chat-appearance', appearance]]);
});

test('幻彩云头像取实际画面，旧外观的异步截图不会覆盖新外观', async t => {
  let appearance = { shape: 'aurora-cloud', bodyColor: '#5B3BC7' };
  let finishOld;
  const f = fixture(() => Promise.resolve(), () => appearance,
    value => value.bodyColor === '#5B3BC7' ? new Promise(resolve => { finishOld = resolve; }) :
      Promise.resolve('data:image/png;base64,new'));
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  await flush();
  await flush();
  appearance = { shape: 'aurora-cloud', bodyColor: '#8B72D8' };
  f.chat.syncAppearance();
  await flush();
  finishOld('data:image/png;base64,old');
  await flush();
  assert.deepEqual(f.windows[0].messages.filter(([channel, , image]) =>
    channel === 'pet:chat-appearance' && image).map(([, , image]) => image),
  ['data:image/png;base64,new']);
});

test('仅主动打开时聚焦；流式状态更新不会弹出关闭的聊天或抢焦点', async t => {
  const f = fixture();
  t.after(() => f.chat.destroy());
  f.chat.update({ messages: [], busy: false });
  assert.equal(f.windows.length, 0);
  f.chat.show({ messages: [], busy: false });
  await flush();
  const win = f.windows[0];
  assert.equal(win.focusCount, 1);
  f.chat.update({ messages: [{ id: 1, text: '你好' }], busy: true });
  assert.equal(win.focusCount, 1);
  f.chat.hide();
  f.chat.update({ messages: [{ id: 1, text: '你好呀' }], busy: false });
  assert.equal(f.chat.isVisible(), false);
  assert.equal(win.isDestroyed(), false);
  assert.equal(win.focusCount, 1);
  f.chat.show({ messages: [{ id: 1, text: '你好呀' }], busy: false });
  assert.equal(f.windows.length, 1);
  assert.equal(win.focusCount, 2);
  assert.deepEqual(f.visibility, [true, false, true]);
  f.chat.destroy();
  assert.deepEqual(f.visibility, [true, false, true, false]);
});

test('加载中关闭，加载完成后也不会自己弹出；再次打开复用同一面板', async t => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [], busy: false });
  f.chat.hide();
  resolve();
  await flush();
  assert.equal(f.windows[0].visible, false);
  f.chat.show({ messages: [], busy: false });
  assert.equal(f.windows.length, 1);
  assert.equal(f.chat.isVisible(), true);
});

test('系统关闭只隐藏并保留渲染器；外部窗口与导航都被拦截', async t => {
  const f = fixture();
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  await flush();
  const win = f.windows[0];
  let prevented = 0;
  win.emit('close', { preventDefault() { prevented += 1; } });
  win.webContents.emit('will-navigate', { preventDefault() { prevented += 1; } });
  win.webContents.emit('will-attach-webview', { preventDefault() { prevented += 1; } });
  assert.equal(prevented, 3);
  assert.equal(win.isDestroyed(), false);
  assert.equal(win.isVisible(), false);
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
});

test('渲染进程失败后下次可重建，旧窗口迟到的失败不能销毁新窗口', async t => {
  let rejectOld;
  const f = fixture(index => index === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve());
  t.after(() => f.chat.destroy());
  f.chat.show({ messages: [] });
  f.chat.destroy();
  f.chat.show({ messages: [] });
  await flush();
  rejectOld(new Error('old failed'));
  await flush();
  assert.equal(f.chat.isVisible(), true);
  assert.equal(f.errors.length, 0);
  f.windows[1].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.chat.getWindow(), null);
  assert.equal(f.errors.length, 1);
  f.chat.show({ messages: [] });
  await flush();
  assert.equal(f.windows.length, 3);
  assert.equal(f.chat.isVisible(), true);
});
