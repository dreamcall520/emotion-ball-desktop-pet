const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { createWorkBuddyConsent } = require('../lib/workbuddy-consent-window');
const url = pathToFileURL(path.join(__dirname, '../workbuddy-consent.html')).href;
function fixture() {
  const handlers = new Map(), windows = [], timers = [];
  let allowed = true;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url };
      this.webContents.getURL = () => this.url;
      this.webContents.send = (...values) => { this.sent = values; };
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
      windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    focus() {}
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const controller = createWorkBuddyConsent({ BrowserWindow: Window,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    getInfo: () => ({ appearance: { shape: 'ball' } }), canRequest: () => allowed,
    schedule: callback => { timers.push(callback); return timers.length; }, cancelTimer: () => {} });
  const event = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  return { controller, handlers, windows, timers, event, block() { allowed = false; } };
}
test('WorkBuddy consent requires visible ready owned mainframe and exact local URL, only explicit boolean accepts', async () => {
  const f = fixture(), pending = f.controller.request(), win = f.windows[0];
  const answer = f.handlers.get('pet:workbuddy-consent-answer');
  assert.equal(f.controller.isPending(), true); assert.equal(win.options.show, false);
  assert.equal(answer(f.event(), true), false);
  win.emit('ready-to-show'); assert.equal(win.isVisible(), true);
  assert.equal(win.sent[0], 'pet:workbuddy-consent-info');
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  assert.equal(answer({ ...f.event(), sender: {} }, true), false);
  assert.equal(answer({ ...f.event(), senderFrame: { url } }, true), false);
  win.webContents.mainFrame.url = url + '?spoof'; assert.equal(answer(f.event(), true), false); win.webContents.mainFrame.url = url;
  win.url = url + '#spoof'; assert.equal(answer(f.event(), true), false); win.url = url;
  assert.equal(answer(f.event(), 'true'), false);
  assert.equal(answer(f.event(), true), true); assert.equal(await pending, true);
  assert.equal(f.controller.isPending(), false); assert.equal(f.controller.getWindow(), null); assert(win.destroyed);
  assert.equal(answer(f.event(), true), false); f.controller.close(); assert.equal(f.handlers.size, 0);
});
test('cancel, close, hide, load failure, renderer loss, timeout and lock all deny authorization', async () => {
  for (const reason of ['cancel', 'closed', 'hide', 'did-fail-load', 'render-process-gone', 'timeout', 'lock-before-ready', 'lock-after-ready']) {
    const f = fixture(), pending = f.controller.request(), win = f.windows[0];
    if (reason === 'cancel') f.controller.cancel();
    else if (reason === 'timeout') f.timers[0]();
    else if (reason === 'lock-before-ready') { f.block(); win.emit('ready-to-show'); }
    else if (reason === 'lock-after-ready') { win.emit('ready-to-show'); f.block(); assert.equal(f.handlers.get('pet:workbuddy-consent-answer')(f.event(), true), false); f.controller.cancel(); }
    else if (['did-fail-load', 'render-process-gone'].includes(reason)) win.webContents.emit(reason);
    else win.emit(reason);
    assert.equal(await pending, false, reason); assert.equal(f.controller.isPending(), false, reason);
  }
});
test('duplicate and blocked requests cannot create another authorization or resurrect a cancelled window', async () => {
  const f = fixture(), first = f.controller.request();
  assert.equal(await f.controller.request(), false); assert.equal(f.windows.length, 1);
  const old = f.windows[0]; f.controller.cancel(); assert.equal(await first, false);
  old.emit('ready-to-show'); assert.equal(old.visible, false);
  f.block(); assert.equal(await f.controller.request(), false); assert.equal(f.windows.length, 1);
});
test('independent WorkBuddy page retains Codex visual resources with explicit disclosure and default cancel', () => {
  const root = path.join(__dirname, '..'), html = fs.readFileSync(path.join(root, 'workbuddy-consent.html'), 'utf8');
  for (const text of ['本机 WorkBuddy 已登录的账户', '不向你索要 token 或密码', '仅在你主动发送聊天时', '不会自动发送消息', '随时关闭即可停止读取和请求']) assert(html.includes(text), text);
  assert.match(html, /href="codex-consent.css"/); assert.match(html, /id="consent-cancel"[^>]*autofocus/);
  assert.match(html, /id="consent-accept"[^>]*disabled/); assert.doesNotMatch(html, /https?:\/\//);
  for (const source of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert(fs.existsSync(path.resolve(root, source[1])), source[1]);
  const preload = fs.readFileSync(path.join(root, 'workbuddy-consent-preload.js'), 'utf8');
  assert(!preload.includes('pet:codex-consent')); assert(preload.includes('pet:workbuddy-consent-answer'));
  const packaging = fs.readFileSync(path.join(root, 'scripts/package-mac.js'), 'utf8');
  for (const file of ['lib/workbuddy-consent-window.js', 'workbuddy-consent.html', 'workbuddy-consent-preload.js', 'workbuddy-consent-renderer.js']) assert(packaging.includes("'desktop-pet/" + file + "'"));
});
