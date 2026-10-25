const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createZcodeConsentWindow } = require('../lib/zcode-consent-window');
function fixture() {
  const handlers = new Map(), windows = [];
  let blocked = false, timeout;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, getURL: () => this.url,
        setWindowOpenHandler() {}, send: (...args) => { this.sent = args; } }); windows.push(this); }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    show() { this.visible = true; } focus() {} destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const controller = createZcodeConsentWindow({ BrowserWindow: Window,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    getInfo: () => ({ appearance: { shape: 'blob' } }), isBlocked: () => blocked,
    position: () => {}, getAppearance: () => 'light',
    schedule: fn => { timeout = fn; return 1; }, cancel: () => {} });
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  return { controller, windows, handlers, event, block: () => { blocked = true; }, expire: () => timeout() };
}
test('ZCode shares the Codex page but accepts only its visible main-frame boolean answer', async () => {
  const f = fixture(), pending = f.controller.open(), win = f.windows[0];
  assert.equal(win.options.width, 460); assert.equal(win.options.height, 656);
  assert.deepEqual(win.options.webPreferences.additionalArguments, ['--pet-source=zcode']);
  const get = f.handlers.get('pet:zcode-consent-get'), answer = f.handlers.get('pet:zcode-consent-answer');
  assert.equal(get(f.event(win)), null);
  win.emit('ready-to-show');
  assert.equal(get(f.event(win)).sourceId, 'zcode');
  assert.equal(get({ ...f.event(win), senderFrame: {} }), null);
  assert.equal(answer(f.event(win), 'true'), false);
  assert.equal(answer({ ...f.event(win), sender: {} }, true), false);
  assert.equal(answer(f.event(win), true), true); assert.equal(await pending, true);
  assert.equal(answer(f.event(win), true), false); assert.equal(win.destroyed, true);
  f.controller.close(); assert.equal(f.handlers.size, 0);
});
test('cancellation, timeout, hide and lock close only the pending ZCode prompt', async () => {
  for (const reason of ['cancel', 'timeout', 'hide', 'lock']) {
    const f = fixture(), pending = f.controller.open(), win = f.windows[0];
    assert.equal(await f.controller.open(), false, 'duplicate opening leaves the original request valid');
    if (reason === 'cancel') f.controller.cancel();
    else if (reason === 'timeout') f.expire();
    else if (reason === 'hide') win.emit('hide');
    else { f.block(); win.emit('ready-to-show'); }
    assert.equal(await pending, false, reason); assert.equal(win.destroyed, true); f.controller.close();
  }
});
