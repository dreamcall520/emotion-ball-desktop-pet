const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { setImmediate: flush } = require('node:timers/promises');
const { createQuotaGuardWindow, guardModel, CHANNEL } = require('../lib/quota-guard-window');
const { createQuotaLabelWindow } = require('../lib/quota-label-window');
const { quotaLabelBounds, quotaLabelSize } = require('../lib/quota-label-placement');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

const AREA = { x: 0, y: 24, width: 1440, height: 876 };
const model = (remaining = 64, windowMinutes = 300) => ({ state: 'ready', items: [
  { label: 'Codex', remaining, windowMinutes, resetsAt: 2000000000000, secret: 'PRIVATE' }
], secret: 'PRIVATE', overflow: 0 });
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function fixture() {
  const windows = [], errors = [], visibility = [];
  let anchor = { x: 600, y: 300, width: 80, height: 80 }, allowed = true, size = 'standard', appearance = 'light';
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x || 0, y: options.y || 0, width: options.width, height: options.height };
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url;
      this.webContents.isDestroyed = () => this.destroyed === true;
      this.sent = [];
      this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = fn => { this.popup = fn; };
      windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; this.loadCalls = (this.loadCalls || 0) + 1; return Promise.resolve(); }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; }
    isDestroyed() { return this.destroyed === true; }
    isVisible() { return this.visible === true; }
    setAlwaysOnTop(...args) { this.topmost = args; }
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setIgnoreMouseEvents(...args) { this.ignore = args; }
    show() { this.visible = true; this.shows = (this.shows || 0) + 1; }
    showInactive() { this.visible = true; }
    focus() { this.focuses = (this.focuses || 0) + 1; }
    hide() { this.visible = false; }
    close() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', event); if (!event.prevented) this.destroy(); return event; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const screen = { getDisplayMatching: bounds => ({ workArea: bounds.x < 0 ? { x: -1280, y: -100, width: 1280, height: 900 } : AREA }), getPrimaryDisplay: () => ({ workArea: AREA }) };
  const guard = createQuotaGuardWindow({ BrowserWindow: Window, screen,
    getAnchor: () => anchor, canShow: () => allowed, getSize: () => size, getAppearance: () => appearance,
    onError: error => errors.push(error), onVisibilityChange: value => visibility.push(value) });
  return { guard, windows, errors, visibility, Window, screen, get anchor() { return anchor; }, set anchor(value) { anchor = value; },
    set allowed(value) { allowed = value; }, set size(value) { size = value; }, set appearance(value) { appearance = value; } };
}

test('右侧角色仅扩原生承载区域，保持卡面尺寸及横向中心，展开尺寸不变', () => {
  for (const [size, cardWidth, cardHeight, width, height] of [['compact', 128, 32, 200, 50], ['standard', 168, 58, 240, 64]]) {
    assert.deepEqual(quotaLabelSize(size, false, 1, false, true), { width, height });
    const pet = { x: 600, y: 300, width: 80, height: 80 };
    const result = quotaLabelBounds(pet, AREA, null, size, false, 1, null, false, true);
    assert.equal(result.x + cardWidth / 2, pet.x + pet.width / 2);
    assert.equal(result.width, width); assert.equal(result.height, height);
    assert.equal(result.y + result.height - cardHeight >= pet.y + pet.height + 8, true);
    for (const count of [1, 2]) assert.deepEqual(quotaLabelSize(size, true, count, false, true), quotaLabelSize(size, true, count));
  }
});

test('80/180/260px 球体、真实云轮廓及负坐标屏幕均不与完整角色承载区域相交', () => {
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    for (const width of [80, 180, 260]) for (const size of ['compact', 'standard']) for (const shape of ['sphere', 'aurora-cloud']) {
      for (const [x, y] of [[area.x + 500, area.y + 240], [area.x, area.y], [area.x + area.width - width, area.y + area.height - width]]) {
        const pet = { x, y, width, height: width }, presentation = { shape, mode: 'free' };
        const result = quotaLabelBounds(pet, area, null, size, false, 1, presentation, false, true);
        assert(result.x >= area.x && result.x + result.width <= area.x + area.width);
        assert(result.y >= area.y && result.y + result.height <= area.y + area.height);
        assert.equal(intersects(result, petVisualBounds(pet, shape, presentation)), false, JSON.stringify({ result, pet, shape, size }));
      }
    }
  }
});

test('额度标签 ready 折叠才为角色扩窗，stale/unknown 还原原卡，展开保留原行为', async () => {
  const f = fixture();
  const label = createQuotaLabelWindow({ BrowserWindow: f.Window, screen: f.screen,
    getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => f.anchor }),
    getSize: () => 'compact', getGuardEntry: () => true });
  label.show(model()); await flush();
  const win = f.windows[0];
  assert.equal(win.bounds.width, 200); assert.equal(win.bounds.height, 50);
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  assert.equal(win.bounds.width, 196); assert.equal(win.bounds.height, 131);
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  assert.equal(win.bounds.width, 200);
  label.show({ ...model(), state: 'stale' });
  assert.equal(win.bounds.width, 128); assert.equal(win.bounds.height, 32);
  label.show({ state: 'reset-wait', items: [] });
  assert.equal(win.bounds.width, 128); assert.equal(win.bounds.height, 32);
  label.destroy();
});

test('守护战为安全单实例，手动关闭隐藏并发暂停，重复打开聚焦且不重载同局', () => {
  const f = fixture();
  assert.equal(f.guard.open(model()), true);
  const win = f.windows[0];
  assert.equal(win.visible, undefined, '页面载入前不闪现');
  win.webContents.emit('did-finish-load');
  assert.equal(win.visible, true);
  assert.equal(win.sent.at(-1)[0], CHANNEL); assert.equal(win.sent.at(-1)[1].visible, true);
  assert.equal(JSON.stringify(win.sent).includes('PRIVATE'), false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.deepEqual(win.popup(), { action: 'deny' });
  let prevented = false; win.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  f.guard.update(model(64));
  f.guard.update(model(50, 10080));
  assert.equal(win.sent.at(-1)[1].items[0].windowMinutes, 10080);
  assert.equal(win.loadCalls, 1);
  const close = win.close();
  assert.equal(close.prevented, true); assert.equal(win.destroyed, undefined);
  assert.equal(win.visible, false); assert.equal(win.sent.at(-1)[1].visible, false);
  f.guard.open(model(50, 10080));
  assert.equal(f.windows.length, 1); assert.equal(win.loadCalls, 1); assert.equal(win.focuses, 2);
  assert.equal(win.sent.at(-1)[1].visible, true);
  assert.deepEqual(f.visibility, [true, false, true]);
  f.guard.setAlwaysOnTop(false); assert.deepEqual(win.topmost, [false, 'floating']);
  f.guard.destroy(); assert.equal(win.destroyed, true); assert.equal(f.guard.getWindow(), null);
});

test('关闭或全局隐藏发生于载入中时不会复活，隐藏后更新仍保持暂停', () => {
  const f = fixture();
  f.guard.open(model()); const win = f.windows[0];
  f.guard.close(); win.webContents.emit('did-finish-load');
  assert.equal(win.visible, false); assert.equal(win.sent.at(-1)[1].visible, false);
  f.guard.update(model(40)); assert.equal(win.sent.at(-1)[1].visible, false);
  f.guard.open(model(40)); assert.equal(win.visible, true);
  f.allowed = false; f.guard.update(model(30));
  assert.equal(f.guard.isVisible(), false); assert.equal(win.sent.at(-1)[1].visible, false);
  assert.equal(f.guard.open(model()), false);
  f.guard.destroy();
});

test('未知与过期不能新开游戏，已开窗口持续接收新状态、周期、主题且不篡改源模型', () => {
  const f = fixture();
  assert.equal(f.guard.open({ ...model(), state: 'stale' }), false);
  assert.equal(f.guard.open({ state: 'empty', items: [] }), false);
  f.guard.open(model()); const win = f.windows[0]; win.webContents.emit('did-finish-load');
  const source = model(18, 10080), before = JSON.stringify(source);
  f.size = 'compact'; f.appearance = 'dark'; f.guard.update(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(win.sent.at(-1)[1].size, 'compact'); assert.equal(win.sent.at(-1)[1].appearance, 'dark');
  f.guard.update({ state: 'reset-wait', items: source.items });
  assert.deepEqual(win.sent.at(-1)[1].items, []); assert.equal(win.sent.at(-1)[1].state, 'reset-wait');
  f.guard.update({ ...source, state: 'stale' }); assert.equal(win.sent.at(-1)[1].state, 'stale');
  f.guard.destroy();
});

test('守护战只接受本页主frame消息，换屏重排不会抢焦点，渲染崩溃可重建', () => {
  const f = fixture(); f.guard.open(model()); const win = f.windows[0]; win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(f.guard.owns(event), true);
  assert.equal(f.guard.owns({ ...event, senderFrame: {} }), false);
  assert.equal(f.guard.owns({ ...event, sender: {} }), false);
  win.url += '#spoof'; assert.equal(f.guard.owns(event), false); win.url = win.url.slice(0, -6);
  const focuses = win.focuses, shows = win.shows;
  f.anchor = { x: -600, y: 100, width: 180, height: 180 }; f.guard.reposition();
  assert(win.bounds.x >= -1280 && win.bounds.x + win.bounds.width <= 0);
  assert.equal(intersects(win.bounds, f.anchor), false);
  assert.equal(win.focuses, focuses); assert.equal(win.shows, shows);
  win.webContents.emit('render-process-gone'); assert.equal(f.guard.getWindow(), null);
  assert.equal(f.guard.isVisible(), false); f.guard.open(model()); assert.equal(f.windows.length, 2);
  f.guard.destroy();
});

test('两个 preload 只有固定打开/关闭及白名单可退订数据接口', () => {
  for (const name of ['quota-label', 'quota-guard']) {
    let api;
    const sent = [], listeners = new Map();
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../' + name + '-preload.js'), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
        ipcRenderer: { send: (...args) => sent.push(args), on: (key, callback) => listeners.set(key, callback), removeListener: key => listeners.delete(key) } })
    });
    if (name === 'quota-label') { api.openGuard('ignored'); assert.deepEqual(sent, [['pet:quota-guard-open']]); continue; }
    assert.deepEqual(Object.keys(api).sort(), ['close', 'onColorMode', 'onModel']);
    let received, colors;
    const unsubscribe = api.onModel(value => { received = value; });
    listeners.get(CHANNEL)({}, { ...model(), visible: true, expanded: true, size: 'compact', appearance: 'dark' });
    assert.equal(received.visible, true); assert.equal(received.expanded, false);
    assert.equal(received.items[0].remaining, 64); assert.equal(JSON.stringify(received).includes('PRIVATE'), false);
    listeners.get(CHANNEL)({}, { state: 'ready', items: [], visible: 'true' }); assert.equal(received.visible, false);
    const removeColor = api.onColorMode((...args) => { colors = args; });
    listeners.get('pet:color-mode')({}, 'accessible', 'dark', 'blue'); assert.deepEqual(colors, ['accessible', 'dark', 'blue']);
    api.close('ignored'); assert.deepEqual(sent, [['pet:quota-guard-close']]);
    unsubscribe(); removeColor(); assert.equal(listeners.size, 0);
  }
});

test('主进程打开入口验证原额度卡 webContents、主frame、精确fileURL及可见性', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const from = source.slice(source.indexOf('function fromQuotaLabel(event)'), source.indexOf('function canShowQuotaGuard()'));
  const handlers = source.slice(source.indexOf('function registerIpc()'), source.indexOf('function registerDisplayRecovery()'));
  const listener = new Map(); let opened = 0, visible = true;
  const contents = { mainFrame: {}, getURL: () => pathToFileURL(path.resolve(__dirname, '../quota-label.html')).href };
  const context = { path, pathToFileURL, __dirname: path.resolve(__dirname, '..'), quotaLabel: { getWindow: () => ({ webContents: contents, isVisible: () => visible }) },
    openQuotaGuard: () => opened++, ipcMain: { on: (key, fn) => listener.set(key, fn), handle() {} } };
  vm.runInNewContext(from + '\n' + handlers + '\nregisterIpc();', context);
  const open = listener.get('pet:quota-guard-open');
  const event = { sender: contents, senderFrame: contents.mainFrame };
  open(event); assert.equal(opened, 1);
  open({ ...event, senderFrame: {} }); open({ ...event, sender: {} }); assert.equal(opened, 1);
  const originalURL = contents.getURL; contents.getURL = () => originalURL() + '#spoof'; open(event); assert.equal(opened, 1);
  contents.getURL = originalURL; visible = false; open(event); assert.equal(opened, 1);
});
