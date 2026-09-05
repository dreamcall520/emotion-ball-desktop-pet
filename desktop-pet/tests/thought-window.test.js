const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { placement, createThoughtWindow } = require('../lib/thought-window');

test('光迹在左右半屏和负坐标副屏留在可见工作区，靠顶边改为侧面起点', () => {
  for (const origin of [0, -1920]) for (const size of [60, 80, 120, 180, 260]) {
    const area = { x: origin, y: -300, width: 1920, height: 1080 };
    for (const side of ['left', 'right']) for (const topEdge of [true, false]) {
      const pet = { x: side === 'left' ? origin + 1920 - size : origin,
        y: area.y + (topEdge ? 0 : 480), width: size, height: size };
      const result = placement(pet, area, side);
      assert.ok(result, JSON.stringify({ size, side, topEdge }));
      const b = result.bounds;
      assert.ok(b.x >= area.x && b.y >= area.y && b.x+b.width <= area.x+area.width && b.y+b.height <= area.y+area.height);
      if (topEdge) assert.equal(result.rotation, side === 'left' ? -60 : 60);
      else assert.ok(b.y+b.height <= pet.y+size*.05, '正常起点在球体头顶外侧');
    }
  }
});

test('文字气泡占用顶部时光迹改走侧面，且不压到下方额度标签', () => {
  const pet = {x:900,y:400,width:80,height:80};
  const area = {x:0,y:0,width:1920,height:1080};
  const text = {x:836,y:308,width:208,height:95};
  for (const side of ['left','right']) {
    const result = placement(pet, area, side, text);
    assert.ok(result.rotation !== 0);
    assert.ok(result.bounds.y >= text.y+text.height);
    assert.ok(result.bounds.y+result.bounds.height < pet.y+pet.height);
  }
});

function fixture() {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.dead = false; this.messages = [];
      this.webContents = new EventEmitter(); this.webContents.send = (channel, data) => this.messages.push({channel,data}); windows.push(this); }
    isDestroyed() { return this.dead; }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setVisibleOnAllWorkspaces() {}
    loadFile() { return Promise.resolve(); }
    setBounds(bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.dead = true; this.emit('closed'); }
    setAlwaysOnTop() {}
  }
  const pet = { isDestroyed: () => false, isVisible: () => true,
    getBounds: () => ({ x: 900, y: 300, width: 80, height: 80 }) };
  const controller = createThoughtWindow({ BrowserWindow: Window, getPetWindow: () => pet,
    screen: { getDisplayMatching: () => ({ workArea: {x:0,y:0,width:1200,height:800} }) } });
  return { controller, windows };
}

test('图层加载期间取消后不可迟到弹出；每轮复用窗口且销毁不残留', () => {
  const {controller, windows} = fixture();
  controller.show({visible:true,side:'left'});
  const win = windows[0];
  assert.equal(win.options.focusable, false);
  assert.equal(win.ignoresMouse, true);
  controller.hide();
  win.webContents.emit('did-finish-load');
  assert.equal(win.visible, false);
  controller.show({visible:true,side:'left'});
  assert.equal(windows.length, 1);
  assert.equal(win.visible, true);
  assert.equal(win.messages.at(-1).data.side, 'left');
  controller.hide();
  assert.equal(win.messages.at(-1).data.visible, false);
  controller.destroy();
  assert.equal(controller.getWindow(), null);
  assert.equal(win.dead, true);
});

test('崩溃图层下轮重建，旧窗口迟到回调不得隐藏新窗口', () => {
  const {controller, windows} = fixture();
  controller.show({visible:true,side:'left'});
  const old = windows[0]; old.webContents.emit('did-finish-load');
  old.webContents.emit('render-process-gone');
  assert.equal(old.dead,true);
  controller.show({visible:true,side:'right'});
  const next = windows[1]; next.webContents.emit('did-finish-load');
  old.webContents.emit('render-process-gone');
  old.webContents.emit('did-finish-load');
  assert.equal(next.visible,true);
  assert.equal(next.messages.at(-1).data.side,'right');
  controller.destroy();
});
