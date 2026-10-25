const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { createShortcutWindow } = require('../lib/shortcut-window');
const { layoutShortcuts } = require('../lib/shortcut-layout');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

function fixture({ nativePlacement = bounds => bounds } = {}) {
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
    setBounds(bounds) { this.bounds = { ...nativePlacement(bounds) }; this.boundsCalls.push({ ...bounds }); }
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
  assert.equal(f.manager.isPresenting(), true);
  assert.equal(f.layouts.at(-1), true);
  f.manager.close();
  assert.equal(f.manager.isOpen(), false);
  assert.equal(f.manager.isPresenting(), true, 'presentation remains active through the closing animation');
  assert.equal(f.win().visible, true);
  assert.equal(f.pins.at(-1), true);
  assert.deepEqual(f.win().sent.at(-1)[1].animation, { session: 1, phase: 'closing', duration: 180 });
  assert.equal(f.win().passthrough, true);
  t.mock.timers.tick(179); assert.equal(f.win().visible, true);
  t.mock.timers.tick(1); assert.equal(f.win().visible, false);
  assert.equal(f.manager.isPresenting(), false);
  assert.equal(f.pins.at(-1), false);
  assert.equal(f.layouts.at(-1), false);
});

test('送物拖动暂停快捷窗口可见性并保留会话，结束恢复；暂停期间不悬停打开新菜单', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f=fixture();t.after(()=>f.manager.dispose());
  f.manager.open({focus:false});await flush();
  const before=f.manager.getState(),win=f.win();
  f.manager.setSuspended(true);assert.equal(win.visible,false);assert.equal(f.manager.isOpen(),true);
  win.emit('blur');f.manager.sync();f.manager.sampleCursor({x:340,y:340});t.mock.timers.tick(1000);
  assert.equal(win.visible,false);assert.equal(f.manager.open({focus:false}),false);
  assert.equal(f.manager.getState().session,before.session);assert.deepEqual(f.pins,[true]);
  f.manager.setSuspended(false);await flush();
  assert.equal(win.visible,true);assert.equal(f.manager.getState().session,before.session);
  assert.equal(win.focused,false,'resume never takes focus from a drag');
  f.manager.close({immediate:true});
  f.cursor({x:0,y:0});f.manager.sampleCursor({x:0,y:0});f.cursor({x:340,y:340});f.manager.sampleCursor({x:340,y:340});
  t.mock.timers.tick(449);f.manager.setSuspended(true);t.mock.timers.tick(1);await flush();
  assert.equal(f.manager.isOpen(),false);assert.equal(win.visible,false);
  f.manager.setSuspended(false);t.mock.timers.tick(1000);assert.equal(f.manager.isOpen(),false);
});

test('送物暂停中主动关闭或锁屏不复活已关闭菜单；设置视图与位置保留',async t=>{
  const f=fixture();t.after(()=>f.manager.dispose());
  f.manager.open({settings:true,focus:false});await flush();const before=f.manager.getState();
  f.manager.setSuspended(true);f.manager.setSuspended(false);await flush();
  assert.equal(f.manager.getState().view,'settings');assert.equal(f.manager.getState().session,before.session);
  f.manager.setSuspended(true);f.manager.close({immediate:true});f.manager.setSuspended(false);
  assert.equal(f.manager.isOpen(),false);assert.equal(f.win().visible,false);
  f.manager.open({focus:false});await flush();f.manager.setSuspended(true);f.suppress(true);f.manager.setSuspended(false);
  assert.equal(f.manager.isOpen(),false);assert.equal(f.win().visible,false);
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

test('设置表单失焦保留，仍可明确关闭；快捷面板失焦收起', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush();
  f.send('shortcut:recording', true);
  f.win().emit('blur'); assert.equal(f.manager.isOpen(), true); assert.equal(f.recording.at(-1), false);
  f.send('shortcut:close'); assert.equal(f.manager.isOpen(), false);
  f.manager.open(); f.win().emit('blur'); assert.equal(f.manager.isOpen(), false);
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

test('系统裁回半露云的透明gutter后，六入口全局位置、命中与动效原点保持一致', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const areas = [{ x: 0, y: 24, width: 1440, height: 876 },
    { x: -1920, y: -1080, width: 1920, height: 1040 }, { x: 1440, y: 40, width: 1280, height: 760 }];
  for (const area of areas) for (const side of ['left', 'right']) {
    const f = fixture({ nativePlacement: bounds => ({ ...bounds,
      x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width),
      y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height) }) });
    try {
      const bounds = { x: side === 'left' ? area.x : area.x + area.width - 80,
        y: area.y + Math.round((area.height - 80) / 2), width: 80, height: 80 };
      const presentation = { mode: 'peeked', shape: 'aurora-cloud', side };
      f.petBounds(bounds); f.presentation(presentation); f.displayMatching(() => ({ workArea: area }));
      const visual = petVisualBounds(bounds, presentation.shape, presentation);
      const planned = layoutShortcuts({ petBounds: visual, workArea: area, shape: 'floating', side });
      f.manager.open({ focus: false }); await flush();
      const state = f.manager.getState(), actual = f.win().getBounds();
      assert.equal(Math.abs(actual.x - planned.bounds.x), 28, 'fixture reproduces native gutter clamping');
      assert.deepEqual(state.layout.bounds, actual);
      assert.equal(state.layout.items.length, 6);
      for (const item of state.layout.items) {
        const expected = planned.items.find(value => value.id === item.id);
        assert.equal(actual.x + item.x, planned.bounds.x + expected.x, item.id);
        assert.equal(actual.y + item.y, planned.bounds.y + expected.y, item.id);
        assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= actual.width && item.y + item.height <= actual.height,
          `${item.id} stays inside the actual native viewport`);
        f.manager.sampleCursor({ x: actual.x + item.x + item.width / 2, y: actual.y + item.y + item.height / 2 });
        assert.equal(f.win().passthrough, false, `${item.id} visible card receives the pointer`);
      }
      assert.equal(actual.x + state.origin.x, visual.x + visual.width / 2);
      assert.equal(actual.y + state.origin.y, visual.y + visual.height / 2);
      const placements = f.win().boundsCalls.length, messages = f.win().sent.length;
      for (let i = 0; i < 30; i++) f.manager.sync();
      assert.equal(f.win().boundsCalls.length, placements, 'stable native clamping is not retried on every sync');
      assert.equal(f.win().sent.length, messages);
      f.manager.close(); assert.equal(f.pins.at(-1), true);
      t.mock.timers.tick(180); assert.equal(f.win().visible, false); assert.equal(f.pins.at(-1), false);
    } finally { f.manager.dispose(); }
  }
});

test('原生显示后迟到的move裁回gutter仍修正按钮和命中，稳定sync不重新请求越界', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.petBounds({ x: 0, y: 400, width: 80, height: 80 });
  f.presentation({ mode: 'peeked', shape: 'aurora-cloud', side: 'left' });
  f.manager.open({ focus: false }); await flush();
  const planned = f.manager.getState(), win = f.win();
  assert.equal(planned.layout.bounds.x, -28);
  win.bounds = { ...win.bounds, x: 0 }; win.emit('move');
  const moved = f.manager.getState();
  assert.equal(moved.layout.bounds.x, 0);
  for (const item of moved.layout.items) {
    const expected = planned.layout.items.find(value => value.id === item.id);
    assert.equal(item.x, expected.x - 28);
    f.manager.sampleCursor({ x: item.x + item.width / 2, y: moved.layout.bounds.y + item.y + item.height / 2 });
    assert.equal(win.passthrough, false);
  }
  assert.equal(moved.origin.x, planned.origin.x - 28);
  const placements = win.boundsCalls.length;
  for (let i = 0; i < 30; i++) f.manager.sync();
  assert.equal(win.boundsCalls.length, placements);
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

test('设置跨屏跟随自身所在屏幕并clamp，窄屏缩小窗口，保存保持设置位置', async t => {
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
  f.manager.sync(); const savedPosition = f.win().getBounds();
  const reply = f.invoke('shortcut:save', { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q' });
  assert.equal(reply.ok, true); assert.equal(f.manager.getState().view, 'settings');
  assert.deepEqual(f.win().getBounds(), savedPosition);
  assert.equal(f.manager.getState().session, 1);
});

test('关闭快捷面板后取消悬停与普通展开，设置仍可打开保存且不自动弹出面板', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush();
  const before = f.win().getBounds(), session = f.manager.getState().session;
  assert.equal(f.invoke('shortcut:save', { shape: 'floating', enabled: false, launcher: 'Ctrl+Alt+Q' }).ok, true);
  assert.equal(f.manager.getState().view, 'settings');
  assert.equal(f.manager.getState().session, session);
  assert.deepEqual(f.win().getBounds(), before);
  f.manager.sampleCursor({ x: 340, y: 340 }); f.manager.sync();
  assert.equal(f.manager.isOpen(), true, 'disabled settings remain usable');
  f.manager.close({ immediate: true });
  f.cursor({ x: 100, y: 100 }); f.manager.sampleCursor({ x: 100, y: 100 });
  f.cursor({ x: 340, y: 340 }); f.manager.sampleCursor({ x: 340, y: 340 });
  t.mock.timers.tick(1000); await flush();
  assert.equal(f.manager.isOpen(), false);
  assert.equal(f.manager.open(), false);
  assert.equal(f.manager.open({ settings: true }), true);
  assert.equal(f.invoke('shortcut:save', { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q' }).ok, true);
  assert.equal(f.manager.getState().view, 'settings');
  f.manager.close({ immediate: true });
  f.manager.sampleCursor({ x: 100, y: 100 }); f.manager.sampleCursor({ x: 340, y: 340 });
  t.mock.timers.tick(450); await flush(); assert.equal(f.manager.isOpen(), true);
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

test('贴边唤醒立即优先快捷面板，闲置整2秒立即释放pin，停在球球上不反复弹出', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  const presentation = { mode: 'peeked', shape: 'blob', side: 'left' };
  f.presentation(presentation);
  const visual = petVisualBounds({ x: 300, y: 300, width: 80, height: 80 }, 'blob', presentation);
  const point = { x: visual.x + visual.width / 2, y: visual.y + visual.height / 2 };
  f.cursor(point);
  f.manager.interrupt(); // Docking interrupts the free-mode launcher before a new edge wake.
  assert.equal(f.manager.wakeFromEdge(point), true);
  assert.equal(f.manager.isOpen(), true); assert.equal(f.manager.isPresenting(), true);
  await flush(); assert.equal(f.win().visible, true); assert.equal(f.win().focused, false);
  t.mock.timers.tick(1999); assert.equal(f.manager.isOpen(), true);
  assert.equal(f.manager.wakeFromEdge(point), false, 'repeated wake never extends the deadline');
  t.mock.timers.tick(1);
  assert.equal(f.manager.isOpen(), false); assert.equal(f.win().visible, false);
  assert.equal(f.manager.isPresenting(), false); assert.equal(f.pins.at(-1), false);
  for (let i = 0; i < 3; i++) {
    f.manager.sampleCursor(point); assert.equal(f.manager.wakeFromEdge(point), false);
    t.mock.timers.tick(2000); assert.equal(f.manager.isOpen(), false);
  }
  f.cursor({ x: 0, y: 0 }); f.manager.sampleCursor({ x: 0, y: 0 });
  f.cursor(point); assert.equal(f.manager.wakeFromEdge(point), true);
});

test('贴边自动面板遇到按钮鼠标、键盘或明确手动打开后沿用原交互，不再闲置收起', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const interaction of ['button', 'keyboard', 'focus', 'manual']) {
    const f = fixture();
    try {
      const presentation = { mode: 'peeked', shape: 'blob', side: 'right' };
      f.presentation(presentation);
      const r = petVisualBounds({ x: 300, y: 300, width: 80, height: 80 }, 'blob', presentation);
      const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      f.cursor(point); assert.equal(f.manager.wakeFromEdge(point), true); await flush();
      t.mock.timers.tick(1000);
      if (interaction === 'button') {
        const layout = f.manager.getState().layout, item = layout.items[0];
        const p = { x: layout.bounds.x + item.x + item.width / 2, y: layout.bounds.y + item.y + item.height / 2 };
        f.cursor(p); f.manager.sampleCursor(p);
        assert.equal(f.win().passthrough, false);
      } else if (interaction === 'keyboard') f.win().webContents.emit('before-input-event', {}, { key: 'ArrowDown' });
      else if (interaction === 'focus') f.win().emit('focus');
      else f.manager.open({ focus: false });
      t.mock.timers.tick(5000); assert.equal(f.manager.isOpen(), true, interaction);
    } finally { f.manager.dispose(); }
  }
});

test('仅启用且可见未受抑制的贴边peeked球体可自动唤醒，手动面板不启动闲置计时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const presentation of [{ mode: 'free', shape: 'blob' }, { mode: 'tucked', side: 'left', shape: 'blob' },
    { mode: 'peeked', shape: 'blob' }, { mode: 'peeked', side: 'left', shape: 'blob', dragging: true }]) {
    const f = fixture(); f.presentation(presentation);
    assert.equal(f.manager.wakeFromEdge({ x: 340, y: 340 }), false); assert.equal(f.windows.length, 0); f.manager.dispose();
  }
  const f = fixture(); t.after(() => f.manager.dispose());
  const presentation = { mode: 'peeked', side: 'left', shape: 'blob' };
  f.presentation(presentation);
  const r = petVisualBounds({ x: 300, y: 300, width: 80, height: 80 }, 'blob', presentation);
  const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; f.cursor(p);
  assert.equal(f.manager.wakeFromEdge({ x: 0, y: 0 }), false);
  f.suppress(true); assert.equal(f.manager.wakeFromEdge(p), false); f.suppress(false);
  f.petVisible(false); assert.equal(f.manager.wakeFromEdge(p), false); f.petVisible(true);
  f.manager.setSuspended(true); assert.equal(f.manager.wakeFromEdge(p), false); f.manager.setSuspended(false);
  f.manager.open({ focus: false }); await flush();
  assert.equal(f.manager.wakeFromEdge(p), false); t.mock.timers.tick(5000); assert.equal(f.manager.isOpen(), true);
  f.manager.open({ settings: true }); await flush();
  assert.equal(f.invoke('shortcut:save', { shape: 'floating', enabled: false }).ok, true);
  f.manager.close({ immediate: true });
  assert.equal(f.manager.wakeFromEdge(p), false, 'disabled launcher never opens from the edge');
});

test('贴边闲置计时在close、interrupt、suspend和dispose时清理，旧计时不关闭后续会话', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stop of [f => f.manager.close({ immediate: true }), f => f.manager.interrupt(),
    f => { f.manager.setSuspended(true); f.manager.setSuspended(false); }, f => f.manager.dispose()]) {
    const f = fixture();
    const presentation = { mode: 'peeked', side: 'left', shape: 'blob' };
    f.presentation(presentation);
    const r = petVisualBounds({ x: 300, y: 300, width: 80, height: 80 }, 'blob', presentation);
    const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; f.cursor(p);
    assert.equal(f.manager.wakeFromEdge(p), true); await flush(); t.mock.timers.tick(1000);
    stop(f);
    if (f.manager.open({ focus: false })) {
      await flush(); t.mock.timers.tick(2000); assert.equal(f.manager.isOpen(), true);
    } else { t.mock.timers.tick(2000); assert.equal(f.manager.isOpen(), false); }
    f.manager.dispose();
  }
});


test('贴边闲置截止时回读真实光标，遗漏的按钮采样不导致正在交互的面板关闭', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  const presentation = { mode: 'peeked', shape: 'blob', side: 'left' };
  f.presentation(presentation);
  const r = petVisualBounds({ x: 300, y: 300, width: 80, height: 80 }, 'blob', presentation);
  const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; f.cursor(point);
  assert.equal(f.manager.wakeFromEdge(point), true); await flush();
  const { layout } = f.manager.getState(), item = layout.items[0];
  f.cursor({ x: layout.bounds.x + item.x + item.width / 2, y: layout.bounds.y + item.y + item.height / 2 });
  t.mock.timers.tick(2000); assert.equal(f.manager.isOpen(), true);
  t.mock.timers.tick(5000); assert.equal(f.manager.isOpen(), true);
});
