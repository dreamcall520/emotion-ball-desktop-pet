const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createCodexDetailsWindow, placeDetails } = require('../lib/codex-details-window');
const { assertAnchoredDetails } = require('../scripts/verify-codex-status-v20');

test('原生定位证据拒绝覆盖球球及旧锚点，允许负坐标屏幕夹边', () => {
  const area = { x: 0, y: 20, width: 1440, height: 880 };
  const anchor = { x: 970, y: 460, width: 60, height: 60 };
  const current = { x: 830, y: 528, width: 340, height: 300 };
  assert.doesNotThrow(() => assertAnchoredDetails(current, anchor, area));
  assert.throws(() => assertAnchoredDetails({ ...current, x: 360 }, anchor, area), /当前球球/);
  assert.throws(() => assertAnchoredDetails({ ...current, y: 340 }, anchor, area), /当前球球/);
  assert.doesNotThrow(() => assertAnchoredDetails({ x: -320, y: 172, width: 320, height: 300 },
    { x: -80, y: 480, width: 60, height: 60 }, { x: -320, y: 20, width: 320, height: 500 }));
  assert.throws(() => assertAnchoredDetails({ x: -320, y: 220, width: 404, height: 300 },
    { x: -80, y: 480, width: 60, height: 60 }, { x: -320, y: 20, width: 320, height: 500 }), /当前显示器/);
});

test('详情按上下左右空间避球，四边、副屏及260大球都留间距；内容增高会换侧或限高', () => {
  const area = { x: 0, y: 20, width: 1200, height: 800 };
  for (const [side, pet, size] of [
    ['below', { x: 500, y: 20, width: 120, height: 120 }, { width: 340, height: 300 }],
    ['above', { x: 500, y: 700, width: 120, height: 120 }, { width: 340, height: 300 }],
    ['right', { x: 0, y: 300, width: 120, height: 120 }, { width: 340, height: 650 }],
    ['left', { x: 1080, y: 300, width: 120, height: 120 }, { width: 340, height: 650 }]
  ]) {
    const placed = placeDetails(pet, area, size);
    assert.equal(placed.placement, side);
    assertAnchoredDetails(placed, pet, area, side);
    assert.equal(placed.width, size.width); assert.equal(placed.height, size.height);
  }
  const negative = { x: -1280, y: -100, width: 1280, height: 900 };
  const pet = { x: -1100, y: -80, width: 180, height: 180 };
  assertAnchoredDetails(placeDetails(pet, negative, { width: 404, height: 420 }), pet, negative, '负坐标副屏');

  const tight = { x: 0, y: 0, width: 1000, height: 700 }, large = { x: 370, y: 220, width: 260, height: 260 };
  const limited = placeDetails(large, tight, { width: 404, height: 600 });
  assert.equal(limited.placement, 'below'); assert.equal(limited.width, 404); assert.equal(limited.height, 212);
  assertAnchoredDetails(limited, large, tight, '大球限高');

  const center = { x: 500, y: 220, width: 120, height: 120 };
  const first = placeDetails(center, area, { width: 340, height: 300 });
  const grown = placeDetails(center, area, { width: 340, height: 700 }, first.placement);
  assert.equal(first.placement, 'below'); assert.equal(grown.placement, 'right');
  assertAnchoredDetails(grown, center, area, '自动增高换侧');
  const shrunk = placeDetails(center, area, { width: 340, height: 200 }, grown.placement);
  assert.equal(shrunk.placement, 'right', '同侧空间足够时保持方向，避免内容变小又跳回下方');
  assertAnchoredDetails(shrunk, center, area);
  assert.throws(() => placeDetails(tight, tight, { width: 340, height: 300 }), /没有可用/,
    '无任何空余区域时不能回退到球球中心');
});

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
  const leftArea = { x: -320, y: 20, width: 320, height: 500 };
  const rightArea = { x: 0, y: 0, width: 1440, height: 900 };
  let anchor = { x: -80, y: 480, width: 60, height: 60 };
  const screen = { getDisplayMatching: rect => ({ workArea: rect.x + rect.width / 2 < 0 ? leftArea : rightArea }) };
  const controller = createCodexDetailsWindow({ BrowserWindow: Window, screen, getAnchor: () => anchor,
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
  assert.deepEqual(win.bounds, { x: -320, y: 20, width: 320, height: 452 });
  assertAnchoredDetails(win.bounds, anchor, leftArea, '自动高度遵循副屏可用空间');
  controller.open({ action: 'tasks', period: 300 }); assert.equal(windows.length, 1);
  controller.close(); assert.equal(controller.isVisible(), false); assert.equal(win.visible, false);
  assert.deepEqual(visibility, [{ value: true, visible: true }, { value: false, visible: false }], '首次请求立即避让；切换详情不重复恢复');
  for (const action of ['tasks', 'results', 'trend', 'opportunities', 'credits']) {
    const before = visibility.length;
    assert.equal(controller.open({ action }), true);
    controller.close();
    assert.deepEqual(visibility.slice(before), [{ value: true, visible: true }, { value: false, visible: false }]);
  }
  for (const action of ['tasks', 'results', 'trend', 'opportunities', 'credits']) {
    anchor = { x: 500, y: 360, width: 60, height: 60 };
    controller.open({ action }); const first = { ...win.bounds }; controller.close();
    anchor = { x: 970, y: 460, width: 60, height: 60 };
    controller.open({ action });
    assert.equal(win.bounds.x + win.bounds.width / 2, 1000, action + '重开跟随球球当前横坐标');
    assertAnchoredDetails(win.bounds, anchor, rightArea, action + '重开在新球球周围留间隙');
    assert.notEqual(win.bounds.x, first.x);
    assert.equal(windows.length, 1, '重新定位仍复用详情窗口');

    controller.resize(700);
    assertAnchoredDetails(win.bounds, anchor, rightArea, action + '实际 controller 自动增高后避球');
    assert.equal(win.bounds.height, 700, '有横向空间时完整显示高内容');
    controller.resize(220);
    assertAnchoredDetails(win.bounds, anchor, rightArea, action + '自动缩短后仍留间隙');

    win.setBounds({ ...win.bounds, x: 120, y: 60 });
    anchor = { x: -220, y: 460, width: 60, height: 60 };
    controller.resize(250);
    assert.equal(win.bounds.x, 120, action + '内容resize保留用户拖动的横坐标');
    assert.equal(win.bounds.y, 60, action + '内容resize不跟着已移到另一屏的球球跳动');
    assert.equal(win.bounds.height, 250);

    win.setBounds({ ...win.bounds, x: -320, y: 90 });
    controller.resize(220);
    assert.deepEqual(win.bounds, { x: -320, y: 90, width: 320, height: 220 }, 'resize遵循用户拖到的屏幕边界');
    controller.close(); controller.open({ action });
    assert.equal(win.bounds.x, leftArea.x, action + '跨屏重开按新的球球屏幕定位');
    assert.equal(win.bounds.width, leftArea.width);
    assert.equal(win.bounds.y + win.bounds.height, anchor.y - 8, '靠近屏幕底部时改放上方，不能夹回球球中心');
    controller.close();
  }
  controller.open({ action: 'trend' });
  win.webContents.emit('render-process-gone');
  assert.deepEqual(visibility.at(-1), { value: false, visible: false }, '渲染退出也通知恢复卡片');
  controller.open({ action: 'tasks' });
  windows.at(-1).destroy();
  assert.deepEqual(visibility.at(-1), { value: false, visible: false }, '原生窗口关闭也通知恢复卡片');
  controller.destroy(); assert.equal(controller.getWindow(), null);
});
