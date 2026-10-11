const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { createShortcutWindow } = require('../lib/shortcut-window');

function fixture() {
  const windows = [], handlers = new Map(), listeners = new Map(), globalShortcutCalls = [];
  const pins = [], recording = [], actions = [], errors = [], layouts = [];
  let cursor = { x: 340, y: 340 }, suppressed = false;
  let presentation = { mode: 'free', shape: 'blob' }, config = { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q' };
  const pet = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 300, y: 300, width: 80, height: 80 }) };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false; this.focused = false; this.sent = [];
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url; this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; }; windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    setBounds(bounds) { this.bounds = { ...bounds }; }
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
    hide() { this.visible = false; this.focused = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const manager = createShortcutWindow({ BrowserWindow: Window, ipcMain: {
    handle: (channel, callback) => handlers.set(channel, callback), removeHandler: channel => handlers.delete(channel),
    on: (channel, callback) => listeners.set(channel, callback), removeListener: channel => listeners.delete(channel)
  }, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }), getCursorScreenPoint: () => cursor },
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
    send: (channel, ...args) => listeners.get(channel)(event(), ...args), invoke: (channel, ...args) => handlers.get(channel)(event(), ...args) };
}

test('显示与关闭立即通知伴随窗口重新避让', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ focus: false }); await flush();
  assert.equal(f.layouts.at(-1), true);
  f.manager.close();
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
  const f = fixture(); t.after(() => f.manager.dispose());
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  assert.equal(f.recording.at(-1), true); assert.equal(f.pins.at(-1), true);
  f.send('shortcut:close'); // The focused renderer handles Escape locally.
  assert.equal(f.manager.isOpen(), false); assert.equal(f.recording.at(-1), false); assert.equal(f.pins.at(-1), false);
  f.manager.open({ settings: true }); await flush(); f.send('shortcut:recording', true);
  f.win().webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.manager.isOpen(), false); assert.equal(f.win(), null); assert.equal(f.recording.at(-1), false);
  assert.equal(f.pins.at(-1), false); assert.equal(f.errors.length, 1);
  f.manager.open({ focus: false }); await flush(); f.win().emit('blur');
  assert.equal(f.manager.isOpen(), false); assert.equal(f.pins.at(-1), false);
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

test('悬停计时结束时重新检查真实轮廓，不把透明留白当成球体', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.manager.dispose());
  f.presentation({ mode: 'free', shape: 'cloud' });
  f.manager.sampleCursor({ x: 340, y: 340 }); t.mock.timers.tick(449);
  f.cursor({ x: 340, y: 301 }); // Still inside the native window, above the painted cloud.
  t.mock.timers.tick(1); await flush();
  assert.equal(f.manager.isOpen(), false);
});
