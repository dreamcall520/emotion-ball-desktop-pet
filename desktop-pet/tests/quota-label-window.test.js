const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createQuotaLabelWindow } = require('../lib/quota-label-window');

const AREA = Object.freeze({ x: 0, y: 0, width: 1440, height: 900 });
const readyModel = () => ({
  state: 'ready',
  items: [{ id: 'private-id', label: 'Codex', windowMinutes: 300, remaining: 47.6, resetsAt: 99 }],
  overflow: 0
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(load = () => Promise.resolve()) {
  const windows = [];
  const errors = [];
  const matching = [];
  let pet = {
    destroyed: false,
    visible: true,
    bounds: { x: 300, y: 300, width: 80, height: 80 },
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    getBounds() { return { ...this.bounds }; }
  };
  let obstacle = null;

  class NativeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.ignoreCalls = [];
      this.boundsCalls = [];
      this.sent = [];
      this.topmostCalls = [];
      this.openHandler = null;
      this.loadedFile = null;
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    setAlwaysOnTop(...args) { this.topmostCalls.push(args); }
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setBounds(bounds) { this.boundsCalls.push({ ...bounds }); this.bounds = { ...bounds }; }
    setIgnoreMouseEvents(...args) { this.ignoreCalls.push(args); }
    loadFile(file) { this.loadedFile = file; return load(windows.length, this); }
    showInactive() { this.visible = true; this.showInactiveCalls = (this.showInactiveCalls || 0) + 1; }
    hide() { this.visible = false; this.hideCalls = (this.hideCalls || 0) + 1; }
    isDestroyed() { return this.destroyed; }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.destroyCalls = (this.destroyCalls || 0) + 1;
      this.emit('closed');
    }
  }

  const label = createQuotaLabelWindow({
    BrowserWindow: NativeWindow,
    screen: {
      getDisplayMatching(bounds) {
        matching.push({ ...bounds });
        return { workArea: AREA };
      }
    },
    getPetWindow: () => pet,
    getObstacle: () => obstacle,
    onError: error => errors.push(error)
  });
  return {
    label, windows, errors, matching,
    get pet() { return pet; },
    set pet(value) { pet = value; },
    set obstacle(value) { obstacle = value; }
  };
}

test('只在 show 时懒创建安全、透明、不聚焦的鼠标穿透窗口', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  assert.equal(f.windows.length, 0);

  f.label.hide();
  f.label.reposition();
  assert.equal(f.windows.length, 0);
  f.label.show(readyModel());
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.options.width, 176);
  assert.equal(win.options.height, 54);
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.hasShadow, false);
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.show, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.spellcheck, false);
  assert.equal(win.options.webPreferences.backgroundThrottling, false);
  assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }]);
  assert.equal(win.visible, false, '页面就绪前不能闪现');
  assert.equal(win.sent.length, 0);

  loading.resolve();
  await flush();
  assert.equal(win.visible, true);
  assert.equal(win.showInactiveCalls, 1);
});

test('getWindow 只返回当前有效窗口，销毁后不暴露旧引用', async () => {
  const f = fixture(() => Promise.resolve());
  assert.equal(f.label.getWindow(), null);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.label.getWindow(), f.windows[0]);
  f.label.destroy();
  assert.equal(f.label.getWindow(), null);
});

test('置顶开关只使用固定 floating 安全层级并作用于后续窗口', async () => {
  const f = fixture(() => Promise.resolve());
  f.label.setAlwaysOnTop(false);
  f.label.show(readyModel());
  await flush();
  assert.deepEqual(f.windows[0].topmostCalls[0], [false, 'floating']);
  f.label.setAlwaysOnTop(true);
  assert.deepEqual(f.windows[0].topmostCalls.at(-1), [true, 'floating']);
  f.label.destroy();
});

test('窗口只加载本地页面，禁止新窗口和所有导航', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.equal(win.loadedFile, path.resolve(__dirname, '../quota-label.html'));
  assert.deepEqual(win.openHandler({ url: 'https://example.invalid' }), { action: 'deny' });
  let prevented = false;
  win.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.invalid');
  assert.equal(prevented, true);
  assert.deepEqual(win.topmostCalls[0], [true, 'floating']);
});

test('按球球当前屏定位并避让气泡，只发固定通道的白名单纯标量', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.obstacle = { x: 252, y: 388, width: 176, height: 54 };
  const model = {
    state: 'ready', account: 'secret@example.com', body: '<script>bad()</script>', html: '<b>bad</b>',
    items: [
      { id: 'account-id', label: '  Codex\u0000 \u202e ', windowMinutes: 300, remaining: 9.44, resetsAt: 123, secret: {} },
      { label: 'Spark', windowMinutes: 10080, remaining: 18.6 },
      { label: '第三项', windowMinutes: 60, remaining: 50 }
    ],
    overflow: 7
  };
  f.label.show(model);
  await flush();
  const win = f.windows[0];
  assert.deepEqual(f.matching, [{ x: 300, y: 300, width: 80, height: 80 }]);
  assert.equal(win.bounds.placement, undefined);
  assert.deepEqual(win.bounds, { x: 252, y: 238, width: 176, height: 54 });
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0][0], 'pet:quota-label');
  assert.deepEqual(win.sent[0][1], {
    state: 'ready',
    items: [
      { label: 'Codex', windowMinutes: 300, remaining: 9.44 },
      { label: 'Spark', windowMinutes: 10080, remaining: 18.6 }
    ],
    overflow: 7
  });
  assert.equal('account' in win.sent[0][1], false);
  assert.equal('body' in win.sent[0][1], false);
  assert.equal('html' in win.sent[0][1], false);
});

test('reposition 复用最后安全模型，重入 show 只发送最新模型', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  f.label.show({ state: 'ready', items: [{ label: 'Newest', windowMinutes: 300, remaining: 31 }], overflow: 0 });
  loading.resolve();
  await flush();
  const win = f.windows[0];
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0][1].items[0].label, 'Newest');

  f.pet.bounds = { x: 500, y: 420, width: 120, height: 120 };
  f.label.reposition();
  assert.equal(win.sent.length, 2);
  assert.deepEqual(win.sent[1][1], win.sent[0][1]);
  assert.deepEqual(win.bounds, { x: 472, y: 548, width: 176, height: 54 });
});

test('hide 不销毁，destroy 幂等，closed 后下次 show 可重建', async () => {
  const f = fixture(() => Promise.resolve());
  f.label.show(readyModel());
  await flush();
  const first = f.windows[0];
  f.label.hide();
  assert.equal(first.visible, false);
  assert.equal(first.destroyed, false);
  first.emit('closed');
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
  f.label.destroy();
  f.label.destroy();
  assert.equal(f.windows[1].destroyCalls, 1);
});

test('加载失败销毁坏窗口并可在下次 show 重建', async t => {
  const f = fixture(index => index === 1 ? Promise.reject(new Error('load failed')) : Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.errors.length, 1);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
});

test('旧窗口迟到的加载成功、失败、closed 都不得复活或伤及新窗口', async t => {
  const oldLoad = deferred();
  const f = fixture(index => index === 1 ? oldLoad.promise : Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show({ state: 'ready', items: [{ label: 'Old', windowMinutes: 300, remaining: 1 }], overflow: 0 });
  const old = f.windows[0];
  f.label.destroy();
  f.label.show({ state: 'ready', items: [{ label: 'New', windowMinutes: 300, remaining: 99 }], overflow: 0 });
  await flush();
  const current = f.windows[1];
  assert.equal(current.visible, true);
  old.webContents.emit('did-finish-load');
  old.emit('closed');
  oldLoad.reject(new Error('old failed'));
  await flush();
  assert.equal(current.visible, true);
  assert.equal(current.destroyed, false);
  assert.equal(current.sent.at(-1)[1].items[0].label, 'New');
  assert.equal(old.sent.length, 0);
  assert.equal(f.errors.length, 0);
});

test('球球隐藏或销毁时 show/reposition 只安全隐藏，恢复后仍使用原模型', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  f.pet.visible = false;
  f.label.reposition();
  assert.equal(win.visible, false);
  f.pet.visible = true;
  f.label.reposition();
  assert.equal(win.visible, true);
  assert.equal(win.sent.at(-1)[1].items[0].label, 'Codex');
  f.pet.destroyed = true;
  f.label.show(readyModel());
  assert.equal(win.visible, false);
});

test('渲染进程退出后隐藏并在下次 show 重建', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  f.windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.errors.length, 1);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows[1].visible, true);
});

test('预加载层只接收固定通道，白名单纯标量且可取消订阅', () => {
  let api;
  let listener;
  const removed = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'petQuotaLabel'); api = value; } },
      ipcRenderer: {
        on(name, callback) { assert.equal(name, 'pet:quota-label'); listener = callback; },
        removeListener: (...args) => removed.push(args)
      }
    })
  });
  let received;
  const unsubscribe = api.onModel(model => { received = model; });
  listener({}, {
    state: 'ready', account: 'private', body: '<b>private</b>',
    items: [{ label: ' Codex\n', windowMinutes: 300, remaining: 19.55, private: {} }], overflow: 2
  });
  assert.equal(JSON.stringify(received), JSON.stringify({
    state: 'ready', items: [{ label: 'Codex', windowMinutes: 300, remaining: 19.55 }], overflow: 2
  }));
  unsubscribe();
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], 'pet:quota-label');
  assert.equal(typeof api.reply, 'undefined');
  assert.equal(typeof api.open, 'undefined');
});

test('渲染层用固定中文状态、纯文本和合理四舍五入最多展示两项', () => {
  let receive;
  const label = { dataset: {} };
  const status = {};
  const items = { children: [], replaceChildren(...children) { this.children = children; } };
  const overflow = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: {
      getElementById: id => ({ 'quota-label': label, status, items, overflow })[id],
      createElement: () => ({ dataset: {} })
    },
    window: {
      addEventListener() {},
      petQuotaLabel: { onModel(callback) { receive = callback; return () => {}; } }
    }
  });
  receive({
    state: 'ready',
    items: [
      { label: '  <b>Codex</b>\n\u202e ', windowMinutes: 300, remaining: 47.6 },
      { label: 'Spark', windowMinutes: 10080, remaining: 9.4 },
      { label: 'Hidden', windowMinutes: 60, remaining: 1 }
    ],
    overflow: 3
  });
  assert.equal(status.textContent, 'Codex 剩余额度');
  assert.deepEqual(items.children.map(item => item.textContent), [
    '<b>Codex</b> · 5 小时 · 剩余 48%',
    'Spark · 周额度 · 剩余 9%'
  ]);
  assert.equal(overflow.textContent, '另有 3 项，见菜单');
  assert.equal(label.dataset.state, 'ready');
  assert.equal(label.dataset.severity, 'urgent');
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), /innerHTML/);

  receive({ state: 'stale', items: [{ label: 'Codex', windowMinutes: 300, remaining: 8 }], overflow: 0 });
  assert.equal(status.textContent, '额度已过期');
  assert.equal(items.children[0].textContent, 'Codex · 5 小时 · 剩余 8% · 已过期');
  assert.equal(overflow.textContent, '');

  const states = {
    disabled: 'Codex 联动已关闭', connecting: '正在连接 Codex…', connected: 'Codex 已连接',
    'reset-wait': '等待额度更新', 'period-missing': '当前账号未返回所选周期', empty: '暂未返回可用额度',
    missing: '未找到 Codex', unauthenticated: 'Codex 尚未登录', unsupported: '当前 Codex 暂不支持额度读取',
    disconnected: 'Codex 未连接'
  };
  for (const [state, text] of Object.entries(states)) {
    receive({ state, items: [{ label: 'must-not-leak', windowMinutes: 300, remaining: 0 }], overflow: 9 });
    assert.equal(status.textContent, text);
    assert.equal(items.children.length, 0);
    assert.equal(overflow.textContent, '');
    assert.equal(label.dataset.severity, 'normal');
  }
});

test('静态页面无内联脚本能力，浅深背景可读、正文至少 12px 且无阴影', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../quota-label.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /quota-label-renderer\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(css, /font-size:\s*(?:12|1[3-9]|[2-9]\d)px/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /rgba\(/);
  assert.match(css, /box-shadow:\s*none/);
  assert.doesNotMatch(css, /animation|filter:\s*drop-shadow/);
});
