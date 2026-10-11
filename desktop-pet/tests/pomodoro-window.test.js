const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { createPomodoroWindows } = require('../lib/pomodoro-window');

function fixture() {
  const windows = [], handlers = new Map(), actions = [], errors = [];
  const state = { status: 'idle', mode: 'focus', face: 'analog', remaining: 1500, total: 1500,
    pinned: false, reminder: false, encouragement: '', durations: { focus: 25, short: 5, long: 15 } };
  let suppressed = false, obstacles = [], quota = null, presentation = { shape: 'blob' };
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const pet = { bounds: { x: 300, y: 300, width: 80, height: 80 }, visible: true,
    isDestroyed: () => false, isVisible() { return this.visible; }, getBounds() { return { ...this.bounds }; } };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.destroyed = false; this.visible = false; this.moves = 0; this.shows = 0; this.sent = [];
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url; this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    loadFile(file, options) { const url = pathToFileURL(file); url.searchParams.set('view', options.query.view); this.url = url.href; this.view = options.query.view; return Promise.resolve(); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.moves++; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setAlwaysOnTop(value) { this.topmost = value; }
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setIgnoreMouseEvents(value) { this.passthrough = value; }
    showInactive() { this.visible = true; this.shows++; }
    show() { this.visible = true; this.shows++; }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const manager = createPomodoroWindows({ BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    screen: { getDisplayMatching: () => ({ workArea: area }) }, getPetWindow: () => pet,
    getPetBounds: () => pet.getBounds(), getPetPresentation: () => presentation,
    getQuotaBounds: () => quota, getWindowObstacles: () => [...obstacles, ...(quota ? [quota] : [])],
    getSnapshot: () => state, isSuppressed: () => suppressed, onError: error => errors.push(error),
    onAction: (type, value) => { actions.push([type, value]); if (type === 'pin') state.pinned = value; return { ok: true, state: { ...state } }; } });
  const win = view => windows.findLast(item => item.view === view && !item.destroyed);
  const event = view => ({ sender: win(view).webContents, senderFrame: win(view).webContents.mainFrame });
  return { manager, state, windows, handlers, actions, errors, pet, area, win, event,
    invoke: (view, type, value) => handlers.get('pomodoro:action')(event(view), type, value),
    suppress: value => { suppressed = value; }, obstacles: value => { obstacles = value; }, quota: value => { quota = value; },
    presentation: value => { presentation = value; } };
}

test('左右贴边时小入口跟随真实额度边界，消息跟随，隐藏额度回退且贴边不隐藏番茄窗', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  f.state.status = 'paused';
  const face = win => ({ x: win.bounds.x + 6, y: win.bounds.y + 6,
    width: win.bounds.width - 12, height: win.bounds.height - 12 });
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const side of ['left', 'right']) {
    Object.assign(f.pet.bounds, { x: side === 'left' ? 0 : 1360, y: 400 });
    f.presentation({ mode: 'peeked', side, shape: 'blob' });
    let quota = { x: side === 'left' ? 88 : 1224, y: 411, width: 128, height: 32 };
    f.quota(quota); f.manager.sync(); await flush();
    const mini = f.win('mini');
    assert.equal(face(mini).x + 50, quota.x + quota.width / 2, `${side} 贴边以额度卡可见中心为锚`);
    assert.equal(quota.y - face(mini).y - face(mini).height, 8);
    assert.notEqual(mini.focused, true);
    quota = { ...quota, x: quota.x + (side === 'left' ? 12 : -12), y: quota.y + 40, width: 168, height: 58 };
    f.quota(quota); f.manager.reposition();
    assert.equal(face(mini).x + 50, quota.x + quota.width / 2, '额度移动和改变大小后重新取实际边界');
    assert.equal(quota.y - face(mini).y - face(mini).height, 8);
    f.state.encouragement = '慢慢来。'; f.manager.sync(); await flush();
    const message = f.win('message');
    assert.equal(face(mini).y - face(message).y - face(message).height, 8);
    assert.equal(message.passthrough, true); assert.notEqual(message.focused, true);
    f.state.encouragement = ''; f.state.reminder = true; f.manager.sync();
    assert.equal(face(mini).y - face(message).y - face(message).height, 8, '完成提示沿用 mini 锚');
    assert.equal(message.passthrough, false);
    f.state.reminder = false; f.quota(null); f.manager.sync();
    assert.equal(f.pet.bounds.y - face(mini).y - face(mini).height, 14, '额度隐藏或无数据时回退球锚');
    f.quota(quota); f.presentation({ mode: 'free', shape: 'blob' }); f.manager.sync();
    assert.equal(f.pet.bounds.y - face(mini).y - face(mini).height, 14, '自由态保留头顶布局');
  }
  f.presentation({ mode: 'peeked', side: 'right', shape: 'blob' });
  f.quota({ x: 1224, y: 451, width: 168, height: 58 }); f.manager.open(); await flush();
  const panel = f.win('panel'), mini = f.win('mini');
  panel.bounds = { x: 1130, y: 320, width: 320, height: 476 }; f.manager.sync();
  assert.ok(!overlaps(face(mini), panel.bounds), '邻近用户拖动后的面板时，小入口沿同一行避让');
  f.state.reminder = true; f.manager.sync();
  assert.ok(!overlaps(face(f.win('message')), panel.bounds), '完成提示避开面板');
  f.quota(null); f.presentation({ mode: 'tucked', side: 'right', shape: 'blob', suppressed: true }); f.manager.sync();
  for (const view of ['panel', 'mini', 'message']) assert.equal(f.win(view).visible, true, `贴边收起球体不隐藏 ${view}`);
  f.presentation({ mode: 'hidden', side: 'right', shape: 'blob' }); f.manager.sync();
  for (const view of ['panel', 'mini', 'message']) assert.equal(f.win(view).visible, false, `用户真正隐藏球球时隐藏 ${view}`);
  f.presentation({ mode: 'peeked', side: 'right', shape: 'blob' });
  for (const area of [{ x: -1200, y: -200, width: 1440, height: 900 }, { x: 0, y: 0, width: 700, height: 560 }]) {
    Object.assign(f.area, area); Object.assign(f.pet.bounds, { x: area.x + area.width - 80, y: area.y + 10 });
    f.quota({ x: area.x + area.width - 168, y: area.y + 4, width: 168, height: 58 }); f.manager.sync();
    for (const view of ['panel', 'mini', 'message']) {
      const b = f.win(view).bounds;
      assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height,
        `${view} 在屏幕边角保持工作区内`);
    }
  }
  assert.deepEqual(f.errors, []);
});

test('番茄窗懒创建、原尺寸、不抢焦点、拖动稳定与屏幕边缘避让', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  f.manager.sync(); assert.equal(f.windows.length, 0);
  f.manager.open(); await flush();
  const panel = f.win('panel'), mini = f.win('mini');
  assert.equal(panel.bounds.width, 320); assert.equal(panel.bounds.height, 476);
  assert.deepEqual([mini.bounds.width, mini.bounds.height], [112, 48]);
  assert.equal(f.pet.bounds.y - (mini.bounds.y + 6 + 36), 14);
  assert.equal(mini.options.focusable, false); assert.equal(mini.passthrough, false);
  assert.equal(panel.options.webPreferences.sandbox, true); assert.equal(panel.options.webPreferences.nodeIntegration, false);
  assert.equal(panel.openHandler().action, 'deny');
  assert.equal(panel.focused, true); assert.notEqual(mini.focused, true);
  f.state.encouragement = '先做一件事。'; f.state.status = 'running'; f.manager.sync(); await flush();
  const firstMessage = f.win('message');
  assert.equal((mini.bounds.y + 6) - (firstMessage.bounds.y + 42), 8, '邻近面板占住一侧时，鼓励卡沿同一行避让');
  assert.ok(firstMessage.bounds.x + firstMessage.bounds.width - 6 <= panel.bounds.x - 6);
  f.state.encouragement = ''; f.state.status = 'idle'; f.manager.sync();
  panel.bounds = { x: 800, y: 150, width: 320, height: 476 };
  const moves = panel.moves; f.state.remaining--; f.manager.sync();
  assert.equal(panel.moves, moves, '每秒更新不得把用户拖动的面板拉回球球');
  await f.invoke('panel', 'layout', { face: 'analog', settings: true });
  assert.deepEqual(panel.bounds, { x: 800, y: 150, width: 320, height: 384 });
  await f.invoke('panel', 'layout', { face: 'analog', settings: false });
  assert.equal(panel.bounds.height, 476);
  f.state.status = 'running'; f.state.encouragement = '一点点推进，也是在向前。'; f.manager.sync(); await flush();
  const message = f.win('message');
  assert.equal(message.bounds.height, 48, '单行鼓励卡原生窗口为36px卡+12px留白');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + message.bounds.height - 6), 8);
  assert.equal(message.options.focusable, false); assert.equal(message.passthrough, true);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 54 })).ok, true);
  assert.equal(message.bounds.height, 66, '双行鼓励卡原生窗口为54px卡+12px留白');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + 60), 8);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 36 })).ok, true);
  f.state.reminder = true; f.manager.sync();
  assert.equal(message.passthrough, false); assert.equal(message.bounds.width, 256);
  assert.equal(message.bounds.height, 244, '专注完成卡保留两项操作空间');
  for (const mode of ['short', 'long']) {
    f.state.mode = mode; f.manager.sync();
    assert.equal(message.bounds.height, 204, '休息完成卡收合隐藏的加时操作空间');
    await f.invoke('message', 'layout', { cardHeight: 54 });
    assert.equal(message.bounds.height, 204, '鼓励卡尺寸请求不能覆盖完成卡固定尺寸');
  }
  f.state.mode = 'focus'; f.manager.sync();
  assert.equal(message.bounds.height, 244, '切回专注完成卡恢复两项操作空间');
  await f.invoke('panel', 'pin', true); assert.equal(panel.topmost, true);
  await f.invoke('panel', 'close-panel'); assert.equal(panel.visible, false); assert.equal(mini.visible, true);
  f.suppress(true); f.manager.sync(); assert.equal(mini.visible, false); assert.equal(message.visible, false);
  f.suppress(false); f.manager.sync(); assert.equal(mini.visible, true);
  f.state.reminder = false;
  const originalMiniY = mini.bounds.y;
  f.obstacles([{ x: 270, y: 240, width: 140, height: 50 }]); f.manager.sync();
  assert.notEqual(mini.bounds.y, originalMiniY, '被现有卡片挡住时，小入口需要避让');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + message.bounds.height - 6), 8, '鼓励卡跟随避让后的小入口');
  f.obstacles([]); f.presentation({ shape: 'cloud' }); f.manager.sync();
  const paintedTop = f.pet.bounds.y + (0.17 - 0.06) * f.pet.bounds.height;
  assert.ok(Math.abs(paintedTop - (mini.bounds.y + 42) - 14) <= 0.5, '小入口按球体可见轮廓保留14px距离');
  for (const bounds of [{ x: -1200, y: -200, width: 1440, height: 900 }, { x: 0, y: 0, width: 700, height: 560 }]) {
    Object.assign(f.area, bounds); f.pet.bounds.x = bounds.x + bounds.width - 90; f.pet.bounds.y = bounds.y + 10;
    f.presentation({ shape: 'cloud' }); f.manager.reposition();
    for (const view of ['mini', 'message']) { const b = f.win(view).bounds;
      assert.ok(b.x >= bounds.x && b.y >= bounds.y && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= bounds.y + bounds.height); }
  }
  assert.deepEqual(f.errors, []);
});

test('唯一来源、主frame、按窗口动作白名单及固定布局枚举保护 IPC', async t => {
  const f = fixture(); t.after(() => f.manager.close()); f.manager.open(); await flush();
  const invoke = f.handlers.get('pomodoro:action'), load = f.handlers.get('pomodoro:load');
  assert.equal((await invoke({ sender: {}, senderFrame: {} }, 'toggle')).ok, false);
  assert.equal((await invoke({ ...f.event('panel'), senderFrame: {} }, 'toggle')).ok, false);
  assert.equal(load(f.event('panel')).ok, true);
  const old = f.win('panel').url; f.win('panel').url = old + '&extra=untrusted';
  assert.equal((await f.invoke('panel', 'toggle')).ok, false); f.win('panel').url = old;
  assert.equal((await f.invoke('mini', 'toggle')).ok, false);
  assert.equal((await f.invoke('mini', 'open')).ok, true);
  assert.equal(f.win('panel').focused, true);
  assert.equal((await f.invoke('panel', 'layout', { face: 'analog', settings: true, width: 9999 })).ok, false);
  assert.equal((await f.invoke('panel', 'layout', { face: 'unknown', settings: true })).ok, false);
  assert.equal((await f.invoke('panel', 'mode', 'anything')).ok, false);
  assert.equal((await f.invoke('panel', 'pin', 'true')).ok, false);
  assert.equal((await f.invoke('panel', 'intention', 'x'.repeat(61))).ok, false);
  assert.equal((await f.invoke('panel', 'settings', { face: 'analog', encouragementEnabled: true, durations: { focus: 0, short: 5, long: 15 } })).ok, false);
  assert.equal((await f.invoke('panel', 'settings', { face: 'minutes', encouragementEnabled: false, durations: { focus: 25, short: 5, long: 15 } })).ok, true);
  assert.deepEqual(f.actions.map(([type]) => type), ['settings']);
  f.state.status = 'complete'; f.state.reminder = true; f.manager.sync(); await flush();
  assert.equal((await f.invoke('message', 'pin', true)).ok, false);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 999 })).ok, false);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 36, width: 900 })).ok, false);
  assert.equal((await f.invoke('message', 'layout', { face: 'analog', settings: true })).ok, false);
  assert.equal((await f.invoke('message', 'dismiss')).ok, true);
  const cancelled = { prevented: false, preventDefault() { this.prevented = true; } };
  f.win('panel').emit('close', cancelled); assert.equal(cancelled.prevented, true); assert.equal(f.win('panel').visible, false);
  const actionCount = f.actions.length;
  assert.equal((await f.invoke('panel', 'toggle')).ok, false, '收起面板后迟到的按钮动作不得生效');
  assert.equal(load(f.event('panel')).ok, true, '隐藏窗口仍可加载快照');
  f.state.reminder = false; f.manager.sync();
  assert.equal((await f.invoke('message', 'rest')).ok, false, '隐藏提醒后迟到的休息动作不得生效');
  assert.equal((await f.invoke('message', 'extend')).ok, false);
  assert.equal(f.actions.length, actionCount);
  const before = f.windows.length; f.manager.close(); f.manager.sync();
  assert.equal(f.windows.length, before); assert.equal(f.handlers.size, 0); assert.ok(f.windows.every(win => win.destroyed));
});
