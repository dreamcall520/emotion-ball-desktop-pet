const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { createShortcutWindow } = require('../lib/shortcut-window');

function fixture() {
  const windows = [], handlers = new Map(), listeners = new Map(), globalShortcutCalls = [];
  const pins = [], recording = [], actions = [], errors = [], layouts = [];
  let cursor = { x: 340, y: 340 }, suppressed = false, petVisible = true;
  let petBounds = { x: 300, y: 300, width: 80, height: 80 };
  let displayMatching = () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } });
  let presentation = { mode: 'free', shape: 'blob' }, config = { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q' };
  const pet = { isDestroyed: () => false, isVisible: () => petVisible, getBounds: () => ({ ...petBounds }) };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false; this.focused = false; this.sent = [];
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height }; this.boundsCalls = []; this.hideCalls = 0;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url; this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; }; windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    setBounds(bounds) { this.bounds = { ...bounds }; this.boundsCalls.push({ ...bounds }); }
    getBounds() { return { ...this.bounds }; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isFocused() { return this.focused; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setIgnoreMouseEvents(value) { this.passthrough = value; }
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    hide() { this.visible = false; this.focused = false; this.hideCalls++; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const manager = createShortcutWindow({ BrowserWindow: Window, ipcMain: {
    handle: (channel, callback) => handlers.set(channel, callback), removeHandler: channel => handlers.delete(channel),
    on: (channel, callback) => listeners.set(channel, callback), removeListener: channel => listeners.delete(channel)
  }, screen: { getDisplayMatching: bounds => displayMatching(bounds), getCursorScreenPoint: () => cursor },
  globalShortcut: { register: key => { globalShortcutCalls.push(['register', key]); return true; },
    unregister: key => globalShortcutCalls.push(['unregister', key]) }, getPetWindow: () => pet,
  getPresentation: () => presentation, getConfig: () => config, getErrors: () => [],
  save: value => { config = value; return { ok: true }; }, onAction: id => actions.push(id), onPin: value => pins.push(value),
  onRecording: value => recording.push(value), isSuppressed: () => suppressed,
  onLayout: () => layouts.push(windows.at(-1)?.visible === true), onError: error => errors.push(error) });
  const win = () => manager.getWindow();
  const event = () => ({ sender: win().webContents, senderFrame: win().webContents.mainFrame });
  return { manager, windows, handlers, listeners, globalShortcutCalls, pins, recording, actions, errors, layouts, win, event,
    cursor: point => { cursor = point; }, suppress: value => { suppressed = value; }, presentation: value => { presentation = value; },
    petBounds: value => { petBounds = value; }, petVisible: value => { petVisible = value; },
    displayMatching: value => { displayMatching = value; },
    send: (channel, ...args) => listeners.get(channel)(event(), ...args), invoke: (channel, ...args) => handlers.get(channel)(event(), ...args) };
}

test('关闭先播180ms聚拢，保留pin与避让直到原生窗口隐藏', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ focus: false }); await flush();
  assert.equal(f.layouts.at(-1), true);
  f.manager.close();
  assert.equal(f.manager.isOpen(), false);
  assert.equal(f.win().visible, true);
  assert.equal(f.pins.at(-1), true);
  assert.deepEqual(f.win().sent.at(-1)[1].animation, { session: 1, phase: 'closing', duration: 180 });
  assert.equal(f.win().passthrough, true);
  t.mock.timers.tick(179); assert.equal(f.win().visible, true);
  t.mock.timers.tick(1); assert.equal(f.win().visible, false);
  assert.equal(f.pins.at(-1), false);
  assert.equal(f.layouts.at(-1), false);
});

test('悬停450ms才显示，不抢焦点；只接收六张按钮，球体与透明空白继续穿透', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.sampleCursor({ x: 340, y: 340 }); t.mock.timers.tick(449);
  assert.equal(f.windows.length, 0);
  t.mock.timers.tick(1); await flush();
  assert.equal(f.manager.isOpen(), true); assert.equal(f.win().visible, true); assert.equal(f.win().focused, false);
  assert.equal(f.win().options.webPreferences.sandbox, true); assert.equal(f.win().openHandler().action, 'deny');
  const layout = f.manager.getState().layout;
  for (const item of layout.items) {
    f.manager.sampleCursor({ x: layout.bounds.x + item.x + item.width / 2, y: layout.bounds.y + item.y + item.height / 2 });
    assert.equal(f.win().passthrough, false, item.id);
  }
  for (const point of [{ x: 340, y: 340 }, { x: layout.bounds.x + 1, y: layout.bounds.y + 1 }]) {
    f.manager.sampleCursor(point); assert.equal(f.win().passthrough, true);
  }
});

test('离开、点击中断、拖拽和锁屏取消待唤起；关闭后须先离开球体才能再悬停', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  for (const stop of [() => { f.cursor({ x: 100, y: 100 }); f.manager.sampleCursor({ x: 100, y: 100 }); },
    () => f.manager.interrupt(), () => { f.presentation({ mode: 'free', shape: 'blob', dragging: true }); f.manager.sampleCursor({ x: 340, y: 340 }); },
    () => { f.suppress(true); f.manager.sampleCursor({ x: 340, y: 340 }); }]) {
    f.suppress(false); f.presentation({ mode: 'free', shape: 'blob' });
    f.cursor({ x: 100, y: 100 }); f.manager.sampleCursor({ x: 100, y: 100 });
    f.cursor({ x: 340, y: 340 }); f.manager.sampleCursor({ x: 340, y: 340 });
    t.mock.timers.tick(449); stop(); t.mock.timers.tick(1); await flush();
    assert.equal(f.manager.isOpen(), false);
  }
  f.suppress(false); f.manager.close(); f.cursor({ x: 340, y: 340 }); f.manager.sampleCursor({ x: 340, y: 340 });
  t.mock.timers.tick(500); await flush(); assert.equal(f.manager.isOpen(), false);
  f.cursor({ x: 100, y: 100 }); f.manager.sampleCursor({ x: 100, y: 100 });
  f.cursor({ x: 340, y: 340 }); f.manager.sampleCursor({ x: 340, y: 340 });
  t.mock.timers.tick(450); await flush(); assert.equal(f.manager.isOpen(), true);
});

test('本地关闭与渲染崩溃清理pin和录制，不抢占全局裸Escape，销毁移除IPC', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  assert.equal(f.recording.at(-1), true); assert.equal(f.pins.at(-1), true);
  f.send('shortcut:close'); // The focused renderer handles Escape locally.
  assert.equal(f.manager.isOpen(), false); assert.equal(f.recording.at(-1), false); assert.equal(f.pins.at(-1), true);
  t.mock.timers.tick(180); assert.equal(f.pins.at(-1), false);
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  f.win().webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.manager.isOpen(), false); assert.equal(f.win(), null); assert.equal(f.recording.at(-1), false);
  assert.equal(f.pins.at(-1), false); assert.equal(f.errors.length, 1);
  f.manager.open({ focus: false }); await flush(); f.win().emit('blur');
  assert.equal(f.manager.isOpen(), false); t.mock.timers.tick(180); assert.equal(f.pins.at(-1), false);
  f.manager.dispose(); assert.equal(f.handlers.size, 0); assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.globalShortcutCalls, [], 'a hover-only panel never claims bare keys from other apps');
});

test('IPC只接受本地面板主frame；未知来源不能读取、保存、录制或执行功能', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush();
  const valid = f.event(), unknown = { sender: { mainFrame: {}, getURL: () => f.win().url }, senderFrame: {} };
  const badEvents = [unknown, { ...valid, senderFrame: {} }];
  for (const event of badEvents) {
    assert.equal(f.handlers.get('shortcut:get-state')(event), null);
    assert.equal(f.handlers.get('shortcut:save')(event, { shape: 'list' }).ok, false);
    f.listeners.get('shortcut:action')(event, 'chat'); f.listeners.get('shortcut:recording')(event, true);
    f.listeners.get('shortcut:close')(event); assert.equal(f.manager.isOpen(), true);
  }
  const url = f.win().url; f.win().url = 'https://example.com/';
  assert.equal(f.handlers.get('shortcut:get-state')(valid), null); f.win().url = url;
  assert.deepEqual(f.actions, []); assert.equal(f.recording.includes(true), false);
  f.send('shortcut:action', 'unknown'); assert.equal(f.manager.isOpen(), true);
  f.send('shortcut:action', 'chat'); assert.deepEqual(f.actions, ['chat']); assert.equal(f.manager.isOpen(), false);
});

test('实体面板不随光标采样切换穿透，标题栏和关闭按钮始终接收鼠标', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  for (const settings of [true, false]) {
    if (!settings) f.invoke('shortcut:save', { shape: 'list' });
    f.manager.open({ settings }); await flush();
    f.manager.sampleCursor({ x: -10000, y: -10000 });
    assert.equal(f.win().passthrough, false);
  }
});

test('悬停计时结束时重新检查真实轮廓，不把透明留白当成球体', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.presentation({ mode: 'free', shape: 'cloud' });
  f.manager.sampleCursor({ x: 340, y: 340 }); t.mock.timers.tick(449);
  f.cursor({ x: 340, y: 301 }); // Still inside the native window, above the painted cloud.
  t.mock.timers.tick(1); await flush();
  assert.equal(f.manager.isOpen(), false);
});

test('不变的sync不重发状态、不重设原生bounds；焦点请求只发送一次', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush();
  const win = f.win(), messages = win.sent.length, placements = win.boundsCalls.length;
  assert.equal(win.sent.at(-1)[1].focus, true);
  assert.deepEqual(win.sent.at(-1)[1].animation, { session: 1, phase: 'opening', duration: 260 });
  for (let index = 0; index < 30; index++) f.manager.sync();
  assert.equal(win.sent.length, messages);
  assert.equal(win.boundsCalls.length, placements);
  assert.equal(f.manager.getState().focus, false);
  f.manager.open({ settings: true });
  assert.equal(win.sent.length, messages + 1);
  assert.equal(win.sent.at(-1)[1].session, 2);
  assert.equal(win.sent.at(-1)[1].focus, true);
});

test('动效原点使用真实球轮廓中心，并随设置窗口拖动更新局部坐标', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.presentation({ mode: 'peeked', shape: 'aurora-cloud', side: 'left' });
  f.manager.open({ settings: true }); await flush();
  const checkOrigin = () => {
    const state = f.manager.getState();
    assert.equal(state.origin.x + state.layout.bounds.x, 312);
    assert.ok(Math.abs(state.origin.y + state.layout.bounds.y - 337.4) < 0.001);
  };
  checkOrigin();
  f.win().setBounds({ x: 700, y: 100, width: 416, height: 680 }); f.win().emit('move');
  checkOrigin();
  assert.deepEqual(f.manager.getState().layout.bounds, { x: 700, y: 100, width: 416, height: 680 });
});

test('设置拖动后sync保持用户位置；同一设置session不重新锚定球球', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush();
  const moved = { x: 800, y: 120, width: 416, height: 680 };
  f.win().setBounds(moved); f.manager.sync();
  const placements = f.win().boundsCalls.length;
  f.petBounds({ x: 50, y: 50, width: 80, height: 80 }); f.manager.sync();
  assert.deepEqual(f.win().getBounds(), moved);
  assert.deepEqual(f.manager.getState().layout.bounds, moved);
  assert.equal(f.win().boundsCalls.length, placements);
  f.manager.open({ settings: true });
  assert.notDeepEqual(f.win().getBounds(), moved, 'a new settings session starts beside the current pet');
});

test('设置跨屏跟随自身所在屏幕并clamp，窄屏缩小窗口，保存后恢复球旁布局', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.displayMatching(bounds => ({ workArea: bounds.x < 0 ?
    { x: -1000, y: -200, width: 800, height: 700 } : { x: 0, y: 0, width: 1440, height: 900 } }));
  f.manager.open({ settings: true }); await flush();
  f.win().setBounds({ x: -1100, y: -300, width: 416, height: 680 }); f.manager.sync();
  assert.deepEqual(f.win().getBounds(), { x: -1000, y: -200, width: 416, height: 680 });
  f.win().setBounds({ x: -250, y: 300, width: 416, height: 680 }); f.manager.sync();
  assert.deepEqual(f.win().getBounds(), { x: -616, y: -180, width: 416, height: 680 });
  f.displayMatching(() => ({ workArea: { x: -400, y: 20, width: 300, height: 480 } }));
  f.manager.sync();
  assert.deepEqual(f.win().getBounds(), { x: -400, y: 20, width: 300, height: 480 });
  f.displayMatching(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }));
  const reply = f.invoke('shortcut:save', { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q' });
  assert.equal(reply.ok, true); assert.equal(f.manager.getState().view, 'floating');
  assert.equal(f.manager.getState().layout.items.length, 6);
  assert.equal(f.manager.getState().session, 2);
  assert.deepEqual(f.manager.getState().animation, { session: 2, phase: 'opening', duration: 260 });
});

test('原生拖动经过屏幕接缝只回读位置，不在每个move事件中拉回旧屏', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.displayMatching(bounds => ({ workArea: bounds.x < -208 ?
    { x: -1000, y: 0, width: 1000, height: 900 } : { x: 0, y: 0, width: 1440, height: 900 } }));
  f.manager.open({ settings: true }); await flush();
  for (const x of [-100, -300, -500]) {
    const moved = { x, y: 100, width: 416, height: 680 };
    f.win().setBounds(moved); const placements = f.win().boundsCalls.length;
    f.win().emit('move');
    assert.deepEqual(f.win().getBounds(), moved);
    assert.deepEqual(f.manager.getState().layout.bounds, moved);
    assert.equal(f.win().boundsCalls.length, placements);
  }
  f.manager.sync(); assert.equal(f.win().bounds.x, -500);
});

test('重复关闭幂等，不延长动效；重新打开取消上次隐藏计时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  f.send('shortcut:close'); const closingMessages = f.win().sent.length;
  t.mock.timers.tick(90); f.send('shortcut:close'); f.win().emit('blur');
  assert.equal(f.win().sent.length, closingMessages);
  assert.deepEqual(f.recording, [true, false]);
  t.mock.timers.tick(89); assert.equal(f.win().visible, true);
  t.mock.timers.tick(1); assert.equal(f.win().hideCalls, 1); assert.deepEqual(f.pins, [true, false]);
  f.manager.open(); f.manager.close(); t.mock.timers.tick(90); f.manager.open();
  const session = f.manager.getState().session;
  t.mock.timers.tick(200);
  assert.equal(f.manager.isOpen(), true); assert.equal(f.win().visible, true); assert.equal(f.win().hideCalls, 1);
  assert.equal(f.manager.getState().session, session); assert.equal(f.manager.getState().animation.phase, 'opening');
});

test('可信页面在抑制期间仍能取消录制和关闭，不能保存或打开功能', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  f.suppress(true);
  assert.equal(f.invoke('shortcut:save', { shape: 'list' }).ok, false);
  f.send('shortcut:action', 'chat'); assert.deepEqual(f.actions, []);
  f.send('shortcut:recording', false); assert.equal(f.recording.at(-1), false);
  f.send('shortcut:close'); assert.equal(f.manager.isOpen(), false); assert.equal(f.win().visible, false);
  assert.equal(f.pins.at(-1), false);
});

test('拖动、锁屏、隐藏、interrupt与dispose打断收起动画并立即释放pin', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stops = [f => { f.presentation({ mode: 'free', shape: 'blob', dragging: true }); f.manager.sampleCursor({ x: 340, y: 340 }); },
    f => { f.suppress(true); f.manager.sync(); }, f => { f.petVisible(false); f.manager.sync(); },
    f => f.manager.interrupt(), f => f.manager.dispose()];
  for (const stop of stops) {
    const f = fixture();
    f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
    f.manager.close(); const win = f.win();
    assert.equal(win.visible, true); assert.equal(f.pins.at(-1), true);
    stop(f);
    assert.equal(win.visible, false); assert.equal(f.manager.isOpen(), false);
    assert.equal(f.pins.at(-1), false); assert.equal(f.recording.at(-1), false);
    const hides = win.hideCalls; t.mock.timers.tick(500); assert.equal(win.hideCalls, hides);
    f.manager.dispose();
  }
});

test('加载完成前关闭不会晚到显示；原生销毁清理录制与pin', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); f.manager.close(); await flush();
  assert.equal(f.win().visible, false); assert.equal(f.manager.isOpen(), false); assert.equal(f.pins.at(-1), false);
  f.manager.open({ settings: true }); f.send('shortcut:recording', true); f.win().destroy();
  assert.equal(f.win(), null); assert.equal(f.manager.isOpen(), false);
  assert.equal(f.pins.at(-1), false); assert.equal(f.recording.at(-1), false);
});
