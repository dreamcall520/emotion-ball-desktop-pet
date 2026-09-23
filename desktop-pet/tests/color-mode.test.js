const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { normalizeSettings, saveSettings, loadSettings } = require('../lib/settings');
const os = require('node:os');

test('色弱友好配置保持旧版默认，白名单持久化并保留原有外观选择', t => {
  assert.equal(normalizeSettings({}).colorMode, 'standard');
  for (const value of ['bad', null, {}, true]) assert.equal(normalizeSettings({ colorMode: value }).colorMode, 'standard');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-colors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  saveSettings(file, { colorMode: 'accessible', codexQuotaAppearance: 'light', codexEnabled: false });
  assert.equal(loadSettings(file).colorMode, 'accessible');
  assert.equal(loadSettings(file).codexQuotaAppearance, 'light');
  assert.equal(loadSettings(file).codexEnabled, false);
});

test('全局配色覆盖已打开、延迟创建和重载窗口，关闭窗口不会收到迟到更新', () => {
  const { createColorModeManager } = require('../lib/color-mode');
  let mode = 'accessible';
  const manager = createColorModeManager({ getMode: () => mode });
  const make = () => {
    const window = new EventEmitter();
    window.destroyed = false;
    window.isDestroyed = () => window.destroyed;
    window.sent = [];
    window.webContents = new EventEmitter();
    window.webContents.send = (...packet) => window.sent.push(packet);
    manager.track(window);
    return window;
  };
  const first = make();
  first.webContents.emit('did-finish-load');
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'accessible']);
  mode = 'standard'; manager.sync();
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'standard']);
  const late = make(); late.webContents.emit('did-finish-load');
  assert.deepEqual(late.sent.at(-1), ['pet:color-mode', 'standard']);
  mode = 'accessible'; first.webContents.emit('did-finish-load');
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'accessible']);
  first.destroyed = true; first.emit('closed'); const count = first.sent.length;
  manager.sync(); first.webContents.emit('did-finish-load');
  assert.equal(first.sent.length, count);
  assert.equal(first.webContents.listenerCount('did-finish-load'), 0);
  assert.deepEqual(late.sent.at(-1), ['pet:color-mode', 'accessible']);
});

test('真实窗口closed之后不可再访问webContents，清理使用已捕获的监听对象', () => {
  const { createColorModeManager } = require('../lib/color-mode');
  const manager = createColorModeManager({ getMode: () => 'accessible' });
  const win = new EventEmitter();
  const contents = new EventEmitter(); contents.send = () => {};
  let destroyed = false;
  win.isDestroyed = () => destroyed;
  Object.defineProperty(win, 'webContents', { get() {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return contents;
  } });
  manager.track(win);
  destroyed = true;
  assert.doesNotThrow(() => win.emit('closed'));
  assert.equal(contents.listenerCount('did-finish-load'), 0);
  assert.doesNotThrow(() => manager.sync());
});

for (const [preload, apiName] of [['preload.js', 'petDesktop'], ['quota-label-preload.js', 'petQuotaLabel'],
  ['chat-preload.js', 'qiuqiuChat'], ['bubble-preload.js', 'petBubble'], ['edge-notice-preload.js', 'edgeNotice'], ['thought-preload.js', 'petThought']]) {
  test(`${preload} 只接收配色枚举，可注销且没有改变设置权限`, () => {
    const ipc = new EventEmitter(); let api; const sends = [];
    ipc.send = (...args) => sends.push(args);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', preload), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, apiName); api = value; } }, ipcRenderer: ipc })
    });
    assert.equal(typeof api.onColorMode, 'function');
    const seen = []; const close = api.onColorMode(value => seen.push(value));
    ipc.emit('pet:color-mode', {}, 'accessible'); ipc.emit('pet:color-mode', {}, { injected: true });
    assert.deepEqual(seen, ['accessible', 'standard']);
    close(); ipc.emit('pet:color-mode', {}, 'accessible');
    assert.equal(seen.length, 2); assert.deepEqual(sends, []);
  });
}

test('公共页面配色即时生效，销毁时清理监听，不覆盖各页面原数据属性', () => {
  const root = { dataset: { appearance: 'light' } }; let update; let closed = 0; let unload;
  const window = { petBubble: { onColorMode: callback => { update = callback; return () => closed++; } },
    addEventListener: (name, callback) => { assert.equal(name, 'beforeunload'); unload = callback; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../color-mode.js'), 'utf8'), { window, document: { documentElement: root } });
  update('accessible'); assert.equal(root.dataset.colorMode, 'accessible'); assert.equal(root.dataset.appearance, 'light');
  update('invalid'); assert.equal(root.dataset.colorMode, 'standard');
  unload(); assert.equal(closed, 1);
});
