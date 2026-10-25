const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createWorkBuddyDetailsWindow } = require('../lib/workbuddy-details-window');
const { observations } = require('../workbuddy-details-renderer');
function fixture() {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.messages = []; this.visible = false;
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send: (channel, value) => this.messages.push({ channel, value }), getURL: () => pathToFileURL(path.join(__dirname, '../workbuddy-details.html')).href, setWindowOpenHandler() {} }); windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); } setAlwaysOnTop(value) { this.top = value; }
    loadFile() { return Promise.resolve(); } setBounds(value) { this.bounds = value; }
    hide() { this.visible = false; } show() { this.visible = true; } destroy() { this.destroyed = true; }
  }
  const area = { x: 0, y: 0, width: 1200, height: 800 }, anchor = { x: 400, y: 200, width: 100, height: 100 };
  const details = createWorkBuddyDetailsWindow({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area }) }, getAnchor: () => anchor });
  return { details, windows };
}
test('trend window reuses placement, isolates state and only accepts owned main-frame close', () => {
  const { details, windows } = fixture();
  details.open({ accountKey: 'private', report: { total: 7400, secret: 'token' }, history: [{ at: 100, total: 7400, secret: 'token' }] });
  const win = windows[0]; win.webContents.emit('did-finish-load');
  assert.equal(win.bounds.width, 404); assert.equal(win.bounds.height, 360);
  assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(JSON.stringify(win.messages).includes('private'), false); assert.equal(JSON.stringify(win.messages).includes('token'), false);
  const own = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  win.webContents.emit('ipc-message', { ...own, senderFrame: {} }, 'pet:workbuddy-details-close'); assert.equal(details.isVisible(), true);
  win.webContents.emit('ipc-message', { sender: {}, senderFrame: {} }, 'pet:workbuddy-details-close'); assert.equal(details.isVisible(), true);
  win.webContents.emit('ipc-message', own, 'pet:workbuddy-details-close'); assert.equal(details.isVisible(), false);
  details.open({ history: [] }); assert.equal(windows.length, 1); details.setAlwaysOnTop(false); assert.equal(win.top, false);
  details.destroy(); assert.equal(details.getWindow(), null);
});
test('trend filters actual today/week records, sorts and deduplicates without future extensions', () => {
  const now = new Date(2026, 9, 25, 12).getTime(), hour = 3600000;
  const records = [{ at: now + 1, total: 8 }, { at: now - hour, total: 10 }, { at: now - hour, total: 9 }, { at: now - 24 * hour, total: 11 }, { at: now - 8 * 24 * hour, total: 12 }];
  assert.deepEqual(observations(records, 'today', now), [{ at: now - hour, total: 9 }]);
  assert.deepEqual(observations(records, 'week', now).map(p => p.total), [11, 9]);
  assert.deepEqual(observations([], 'week', now), []);
});
test('renderer plots real samples with gap connector and signed net change, with explicit single/empty states', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const elements = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
    setAttribute(key, value) { this.attrs[key] = value; } append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; } addEventListener(key, fn) { this.listeners[key] = fn; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); };
  let receive, receiveColor, close = 0;
  const now = new Date(2026, 9, 25, 12).getTime();
  const document = { documentElement: new Element('html'), getElementById: get, createElementNS: (_, tag) => new Element(tag), addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../workbuddy-details-renderer.js'), 'utf8'), {
    document, window: { matchMedia: () => ({ matches: false, addEventListener() {} }), TrendCurve: require('../quota-trend-curve'),
      petWorkBuddyDetails: { onModel: fn => { receive = fn; }, onColorMode: fn => { receiveColor = fn; }, close: () => close++ } },
    Date: class extends Date { static now() { return now; } }
  });
  receive({ report: { total: 7000 }, history: [] }); assert.match(get('hint').textContent, /暂无真实/); assert.equal(get('chart').children.length, 0);
  receive({ report: { total: 7000 }, history: [{ at: now - 1200000, total: 7400 }] }); assert.match(get('hint').textContent, /仅有1次/);
  receive({ report: { total: 7000 }, history: [{ at: now - 1200000, total: 7400 }, { at: now - 300000, total: 7000 }] });
  assert.equal(get('change').textContent, '-400'); assert.equal(get('balance').textContent, '7,000');
  const svg = get('chart').children[0]; assert.equal(svg.attrs.viewBox, '0 0 374 144');
  assert.equal(svg.children.filter(n => n.attrs.class === 'unrecorded-line').length, 1);
  const dots = svg.children.filter(n => n.tag === 'circle'); assert.equal(dots.length, 2); assert.equal(dots[1].attrs.cx, 352);
  assert.match(dots[0].children[0].textContent, /7,400 积分/);
  assert.equal(svg.children.filter(n => n.tag === 'text' && n.attrs.y === 132).length, 2);
  receiveColor('standard', 'dark', 'blue');
  assert.equal(document.documentElement.dataset.resolvedAppearance, 'dark');
  receiveColor('accessible', 'light', 'green'); assert.equal(document.documentElement.dataset.resolvedAppearance, 'light');
  receive({ appearance: 'dark', report: { total: 7399.91 }, history: [{ at: now - 1200000, total: 14299.82 }, { at: now - 300000, total: 7399.91 }] });
  assert.equal(document.documentElement.dataset.resolvedAppearance, 'dark');
  assert.equal(get('balance').textContent, '7,399.91'); assert.equal(get('change').textContent, '-6,899.91');
  const html = fs.readFileSync(path.join(__dirname, '../workbuddy-details.html'), 'utf8');
  assert.match(html, /id="change" class="time-value"/);
  assert.match(html, /<h1>余额趋势<small class="title-product">WorkBuddy/);
  get('details-close').listeners.click(); assert.equal(close, 1);
});
