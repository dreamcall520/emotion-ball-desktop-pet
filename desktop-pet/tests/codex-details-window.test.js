const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createCodexDetailsWindow } = require('../lib/codex-details-window');

test('详情窗口只接受本页主 frame，复用窗口且尺寸始终在屏幕内', () => {
  const windows = [];
  const visibility = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = options; this.webContents = new EventEmitter();
      this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = fn => { this.popup = fn; };
      this.webContents.send = (_channel, payload) => { this.model = payload; };
      this.webContents.getURL = () => this.url;
      windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    getBounds() { return this.bounds; }
    setBounds(value) { this.bounds = value; }
    isDestroyed() { return this.destroyed === true; }
    setAlwaysOnTop() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const screen = { getDisplayMatching: () => ({ workArea: { x: -320, y: 20, width: 320, height: 500 } }) };
  const controller = createCodexDetailsWindow({ BrowserWindow: Window, screen, getAnchor: () => ({ x: -80, y: 480, width: 60, height: 60 }),
    onVisibilityChange: value => visibility.push({ value, visible: controller.isVisible() }) });
  assert.equal(controller.open({ action: 'arbitrary' }), false);
  assert.equal(controller.open({ action: 'trend', period: 300 }), true);
  const win = windows[0]; win.webContents.emit('did-finish-load');
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(controller.owns(event), true);
  assert.equal(controller.owns({ ...event, senderFrame: {} }), false);
  win.url += '#spoof'; assert.equal(controller.owns(event), false); win.url = win.url.slice(0, -6);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.hasShadow, false, '详情玻璃边缘不叠加系统硬阴影');
  assert.equal(win.options.backgroundColor, '#00000000');
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.useContentSize, true);
  assert.deepEqual(win.popup(), { action: 'deny' });
  controller.resize(2000);
  assert.deepEqual(win.bounds, { x: -320, y: 20, width: 320, height: 500 });
  controller.open({ action: 'tasks', period: 300 }); assert.equal(windows.length, 1);
  controller.close(); assert.equal(controller.isVisible(), false); assert.equal(win.visible, false);
  assert.deepEqual(visibility, [{ value: true, visible: true }, { value: false, visible: false }], '首次请求立即避让；切换详情不重复恢复');
  for (const action of ['tasks', 'results', 'trend', 'opportunities', 'credits']) {
    const before = visibility.length;
    assert.equal(controller.open({ action }), true);
    controller.close();
    assert.deepEqual(visibility.slice(before), [{ value: true, visible: true }, { value: false, visible: false }]);
  }
  controller.open({ action: 'trend' });
  win.webContents.emit('render-process-gone');
  assert.deepEqual(visibility.at(-1), { value: false, visible: false }, '渲染退出也通知恢复卡片');
  controller.open({ action: 'tasks' });
  windows.at(-1).destroy();
  assert.deepEqual(visibility.at(-1), { value: false, visible: false }, '原生窗口关闭也通知恢复卡片');
  controller.destroy(); assert.equal(controller.getWindow(), null);
});
