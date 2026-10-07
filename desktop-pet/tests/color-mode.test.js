const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { normalizeSettings, saveSettings, loadSettings } = require('../lib/settings');
const os = require('node:os');

test('contrast verification accepts normalized CSS srgb colors', () => {
  const { contrast } = require('../scripts/verify-ui-theme');
  assert.equal(contrast('color(srgb 0 0 0)', 'rgb(255, 255, 255)'), 21);
  assert.equal(contrast('color(srgb 0.5 0.5 0.5)', 'rgb(255, 255, 255)'),
    contrast('rgb(127.5, 127.5, 127.5)', 'rgb(255, 255, 255)'));
});

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
  let mode = 'accessible', appearance = 'light', theme = 'green';
  const manager = createColorModeManager({ getMode: () => mode, getAppearance: () => appearance, getTheme: () => theme });
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
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'accessible', 'light', 'green']);
  mode = 'standard'; manager.sync();
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'standard', 'light', 'green']);
  theme = 'blue'; manager.sync();
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'standard', 'light', 'blue']);
  appearance = 'dark'; manager.sync();
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'standard', 'dark', 'blue']);
  const late = make(); late.webContents.emit('did-finish-load');
  assert.deepEqual(late.sent.at(-1), ['pet:color-mode', 'standard', 'dark', 'blue']);
  mode = 'accessible'; first.webContents.emit('did-finish-load');
  assert.deepEqual(first.sent.at(-1), ['pet:color-mode', 'accessible', 'dark', 'blue']);
  first.destroyed = true; first.emit('closed'); const count = first.sent.length;
  theme = 'green';
  manager.sync(); first.webContents.emit('did-finish-load');
  assert.equal(first.sent.length, count);
  assert.equal(first.webContents.listenerCount('did-finish-load'), 0);
  assert.deepEqual(late.sent.at(-1), ['pet:color-mode', 'accessible', 'dark', 'green']);
  theme = {}; mode = 'invalid'; appearance = 'invalid'; manager.sync();
  assert.deepEqual(late.sent.at(-1), ['pet:color-mode', 'standard', 'system', 'green']);
  assert.equal(first.sent.length, count);
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
  ['chat-preload.js', 'qiuqiuChat'], ['about-preload.js', 'qiuqiuAbout'], ['bubble-preload.js', 'petBubble'], ['edge-notice-preload.js', 'edgeNotice'], ['thought-preload.js', 'petThought'],
  ['customize-preload.js', 'petCustomizer'], ['notes-preload.js', 'qiuNotes'], ['api-usage-preload.js', 'qiuqiuApiUsage'], ['api-usage-label-preload.js', 'qiuqiuApiUsageLabel'], ['codex-details-preload.js', 'petCodexDetails']]) {
  test(`${preload} 过滤三项配色枚举，兼容两参数回调，可注销且没有改变设置权限`, () => {
    const ipc = new EventEmitter(); let api; const sends = [];
    ipc.send = (...args) => sends.push(args);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', preload), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, apiName); api = value; } }, ipcRenderer: ipc })
    });
    assert.equal(typeof api.onColorMode, 'function');
    const seen = [], legacy = [];
    const close = api.onColorMode((value, appearance, theme) => seen.push([value, appearance, theme]));
    const closeLegacy = api.onColorMode((value, appearance) => legacy.push([value, appearance]));
    ipc.emit('pet:color-mode', {}, 'accessible', 'dark', 'blue');
    for (const theme of [undefined, null, '', 'Blue', 'blue ', { injected: true }, []]) {
      ipc.emit('pet:color-mode', {}, 'accessible', 'light', theme);
    }
    ipc.emit('pet:color-mode', {}, { injected: true }, 'invalid', 'green');
    assert.deepEqual(seen, [
      ['accessible', 'dark', 'blue'],
      ...Array.from({ length: 7 }, () => ['accessible', 'light', 'green']),
      ['standard', 'system', 'green']
    ]);
    assert.deepEqual(legacy, seen.map(([value, appearance]) => [value, appearance]));
    close(); closeLegacy(); ipc.emit('pet:color-mode', {}, 'standard', 'dark', 'blue');
    assert.equal(seen.length, 9); assert.equal(legacy.length, 9);
    assert.equal(ipc.listenerCount('pet:color-mode'), 0); assert.deepEqual(sends, []);
  });
}

for (const apiName of ['petBubble', 'qiuNotes', 'petCustomizer', 'petCodexDetails']) {
  test(`公共配色通过 ${apiName} 同步主题、外观与色弱，切换蓝色样式但保留无关数据`, () => {
    const root = { dataset: { owner: 'existing-user-data' } }, blueStyle = { disabled: false };
    let update, unload, closed = 0;
    const window = { [apiName]: { onColorMode: callback => { update = callback; return () => closed++; } },
      addEventListener: (name, callback) => { assert.equal(name, 'beforeunload'); unload = callback; } };
    const document = { documentElement: root, getElementById: id => { assert.equal(id, 'blue-style'); return blueStyle; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../color-mode.js'), 'utf8'), { window, document });
    assert.equal(root.dataset.uiTheme, 'green'); assert.equal(blueStyle.disabled, true);
    update('accessible', 'dark', 'blue');
    assert.equal(root.dataset.colorMode, 'accessible'); assert.equal(root.dataset.appearance, 'dark');
    assert.equal(root.dataset.uiTheme, 'blue'); assert.equal(blueStyle.disabled, false);
    update('standard', 'dark', 'blue');
    assert.equal(root.dataset.colorMode, 'standard'); assert.equal(root.dataset.uiTheme, 'blue');
    update('accessible', 'light', 'green');
    assert.equal(root.dataset.colorMode, 'accessible'); assert.equal(root.dataset.uiTheme, 'green');
    assert.equal(root.dataset.appearance, 'light'); assert.equal(blueStyle.disabled, true);
    update('invalid', 'light', 'blue');
    assert.equal(root.dataset.colorMode, 'standard'); assert.equal(root.dataset.uiTheme, 'blue');
    update('standard', 'light', 'invalid');
    assert.equal(root.dataset.uiTheme, 'green'); assert.equal(blueStyle.disabled, true);
    update('accessible', 'dark'); assert.equal(root.dataset.uiTheme, 'green', '旧两参数事件默认薄荷绿');
    assert.equal(root.dataset.owner, 'existing-user-data');
    unload(); assert.equal(closed, 1);
  });
}


test('配色同时携带浅深外观，新窗口与即时切换读取同一已保存值', () => {
  const { createColorModeManager } = require('../lib/color-mode');
  let appearance='light';const win=new EventEmitter();win.isDestroyed=()=>false;
  const sent=[];win.webContents=Object.assign(new EventEmitter(),{send:(...args)=>sent.push(args)});
  const manager=createColorModeManager({getMode:()=> 'accessible',getAppearance:()=>appearance});
  manager.track(win);win.webContents.emit('did-finish-load');
  assert.deepEqual(sent.at(-1),['pet:color-mode','accessible','light','green']);
  appearance='dark';manager.sync();assert.deepEqual(sent.at(-1),['pet:color-mode','accessible','dark','green']);
  appearance={};manager.sync();assert.deepEqual(sent.at(-1),['pet:color-mode','accessible','system','green']);
});

test('色弱友好浅深色及系统变化立即生效，销毁时取消系统外观监听', () => {
  const root={dataset:{appearance:'dark'}};let update,change,unload;let removes=0;
  const media={matches:false,addEventListener:(name,cb)=>{assert.equal(name,'change');change=cb;},removeEventListener:()=>removes++};
  const window={matchMedia:()=>media,petBubble:{onColorMode:cb=>{update=cb;return()=>{};}},addEventListener:(name,cb)=>{unload=cb;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../color-mode.js'),'utf8'),{window,document:{documentElement:root,getElementById:()=>null}});
  update('accessible','light','blue');assert.equal(root.dataset.accessibleAppearance,'light');assert.equal(root.dataset.appearance,'light');
  update('accessible','dark','blue');assert.equal(root.dataset.accessibleAppearance,'dark');assert.equal(root.dataset.appearance,'dark');
  update('accessible','system','blue');assert.equal(root.dataset.accessibleAppearance,'light');
  media.matches=true;change();assert.equal(root.dataset.accessibleAppearance,'dark');assert.equal(root.dataset.appearance,'dark');
  assert.equal(root.dataset.uiTheme,'blue');assert.equal(root.dataset.colorMode,'accessible');
  update('accessible','light','green');change();assert.equal(root.dataset.accessibleAppearance,'light');assert.equal(root.dataset.appearance,'light');
  assert.equal(root.dataset.uiTheme,'green');assert.equal(root.dataset.colorMode,'accessible');
  update('standard','system','blue');media.matches=false;change();
  assert.equal(root.dataset.appearance,'light');assert.equal(root.dataset.uiTheme,'blue');assert.equal(root.dataset.colorMode,'standard');
  unload();assert.equal(removes,1);
});
