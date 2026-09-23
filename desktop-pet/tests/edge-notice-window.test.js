const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { createEdgeNoticeWindow } = require('../lib/edge-notice-window');

function fixture() {
  const windows = [], errors = [];
  const pet = { visible: true, isDestroyed: () => false, isVisible() { return this.visible; },
    getBounds: () => ({ x: -1000, y: 100, width: 80, height: 80 }) };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, send: (...args) => this.sent.push(args) });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    hide() { this.visible = false; }
    showInactive() { this.visible = true; }
    setBounds(value) { this.bounds = value; }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setAlwaysOnTop(value) { this.topmost = value; }
    setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {}
    loadFile() { return new Promise((resolve, reject) => { this.loaded = resolve; this.failed = reject; }); }
  }
  const controller = createEdgeNoticeWindow({ BrowserWindow: Window, getPetWindow: () => pet,
    screen: { getDisplayMatching: () => ({ workArea: { x: -1000, y: 0, width: 1000, height: 800 } }) },
    onError: error => errors.push(error) });
  return { controller, windows, errors, pet };
}
const payload = { id: 1, kind: 'text', text: '你忙，我在边边陪着。', side: 'left' };

test('late load after hide, destroyed parent or disposal cannot reveal a stale capsule', async () => {
  for (const cancel of [f => f.controller.hide(), f => { f.pet.visible = false; }, f => f.controller.destroy()]) {
    const f = fixture(); f.controller.show(payload); const win = f.windows[0];
    cancel(f); win.loaded(); await flush();
    assert.equal(win.visible, false);
  }
});

test('loaded capsule uses latest payload without focus or mouse capture; can be reused', async () => {
  const f = fixture(); f.controller.show(payload);
  f.controller.show({ ...payload, id: 2, text: '最新短句' });
  const win = f.windows[0]; win.loaded(); await flush();
  assert.equal(win.sent.at(-1)[1].text, '最新短句');
  assert.equal(win.options.focusable, false); assert.equal(win.ignoresMouse, true);
  assert.equal(win.visible, true);
  f.controller.hide(); assert.equal(win.visible, false);
  f.controller.show(payload); assert.equal(win.visible, true);
  assert.equal(f.windows.length, 1);
  f.controller.setAlwaysOnTop(false); assert.equal(win.topmost, false);
});

test('only quota uses the wider capsule and both edges keep the same inward anchor', async () => {
  const f = fixture(); f.controller.show(payload);
  const win = f.windows[0]; win.loaded(); await flush();
  assert.equal(win.bounds.width, 244);
  const leftAnchor = win.bounds.x;
  f.controller.show({ ...payload, kind: 'quota', period: '周额度', remaining: 0, statusLabel: '已用尽' });
  assert.equal(win.bounds.width, 284);
  assert.equal(win.bounds.x, leftAnchor);
  f.pet.getBounds = () => ({ x: -80, y: 100, width: 80, height: 80 });
  f.controller.show({ ...payload, side: 'right', kind: 'quota', period: '周额度', remaining: 0, statusLabel: '已用尽' });
  const rightAnchor = win.bounds.x + win.bounds.width;
  f.controller.show({ ...payload, side: 'right' });
  assert.equal(win.bounds.width, 244);
  assert.equal(win.bounds.x + win.bounds.width, rightAnchor);
  assert.equal(win.bounds.height, 44);
  assert.equal(f.windows.length, 1);
});

test('old window load rejection and renderer exit cannot close replacement window', async () => {
  const f = fixture(); f.controller.show(payload); const old = f.windows[0];
  f.controller.destroy(); f.controller.show({ ...payload, id: 2 }); const current = f.windows[1];
  old.failed(new Error('old failure')); old.webContents.emit('render-process-gone', {}, { reason: 'old crash' });
  current.loaded(); await flush();
  assert.equal(current.visible, true); assert.equal(f.errors.length, 0);
  current.webContents.emit('render-process-gone', {}, { reason: 'crash' });
  assert.equal(current.visible, false); assert.equal(f.errors.length, 1);
});
