const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createWorkBuddyDetailsWindow } = require('../lib/workbuddy-details-window');
function fixture(onVisibilityChange = () => {}) {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.messages = []; this.visible = false;
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send: (channel, value) => this.messages.push({ channel, value }), getURL: () => pathToFileURL(path.join(__dirname, '../workbuddy-details.html')).href, setWindowOpenHandler() {} }); windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); } setAlwaysOnTop(value) { this.top = value; }
    loadFile() { return Promise.resolve(); } setBounds(value) { this.bounds = value; }
    hide() { this.visible = false; } show() { this.visible = true; } destroy() { this.destroyed = true; }
  }
  const area = { x: 0, y: 0, width: 1200, height: 800 }, anchor = { x: 400, y: 200, width: 100, height: 100 };
  const details = createWorkBuddyDetailsWindow({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area }) }, getAnchor: () => anchor, onVisibilityChange });
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
  for (const value of [119, 701, 200.5, '220']) win.webContents.emit('ipc-message', own, 'pet:workbuddy-details-resize', value);
  assert.equal(win.bounds.height, 360);
  win.webContents.emit('ipc-message', { ...own, senderFrame: {} }, 'pet:workbuddy-details-resize', 220); assert.equal(win.bounds.height, 360);
  win.webContents.emit('ipc-message', own, 'pet:workbuddy-details-resize', 220); assert.equal(win.bounds.height, 220);
  win.webContents.emit('ipc-message', own, 'pet:workbuddy-details-close'); assert.equal(details.isVisible(), false);
  details.open({ history: [] }); assert.equal(windows.length, 1); details.setAlwaysOnTop(false); assert.equal(win.top, false);
  details.destroy(); assert.equal(details.getWindow(), null);
});
test('first visibility notification observes an owned live details window before hiding other cards', () => {
  const observed = [];
  let details;
  const f = fixture(visible => observed.push({ visible, isVisible: details.isVisible(), window: details.getWindow() }));
  details = f.details;
  assert.equal(details.open({ report: { total: 7400 } }), true);
  assert.deepEqual(observed.map(({ visible, isVisible }) => ({ visible, isVisible })), [{ visible: true, isVisible: true }]);
  assert.equal(observed[0].window, f.windows[0]);
  details.close();
  assert.deepEqual(observed.map(({ visible, isVisible }) => ({ visible, isVisible })), [{ visible: true, isVisible: true }, { visible: false, isVisible: false }]);
});
test('consumption failure never substitutes balance drops, fake zero, curves or forecasts', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const elements = new Map(), sizes = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
    getBoundingClientRect() { return { top: 10, bottom: 210 }; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let receive, receiveColor, close = 0;
  const now = new Date(2026, 9, 25, 12).getTime();
  const document = { documentElement: new Element(), getElementById: get, createElementNS: (_, tag) => new Element(tag), addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../workbuddy-details-renderer.js'), 'utf8'), {
    document, window: { TrendCurve: require('../quota-trend-curve'), getComputedStyle: () => ({ paddingBottom: '13px', borderBottomWidth: '1px' }), requestAnimationFrame: fn => fn(), matchMedia: () => ({ matches: false, addEventListener() {} }),
      petWorkBuddyDetails: { resize: height => sizes.push(height), onModel: fn => { receive = fn; }, onColorMode: fn => { receiveColor = fn; }, close: () => close++ } },
    Date: class extends Date { static now() { return now; } }
  });
  receive({ report: { total: 7399.91, updatedAt: now, nextRefreshAt: now + 7 * 86400000, expires: [{ at: now + 2 * 86400000, amount: 99.91 }] }, history: [{ at: now - 300000, total: 7500 }, { at: now, total: 7399.91 }] });
  assert.equal(get('balance').textContent, '7,399.91'); assert.equal(get('change').textContent, '—');
  assert.equal(get('hint').textContent, '消耗统计暂不可用'); assert.equal(get('unavailable-note').textContent, '暂未取得 WorkBuddy 官方消耗记录');
  assert.equal(get('expiry-block').dataset.warning,'true');
  assert.match(get('expiry-note').textContent, /99.91 积分/); assert.match(get('refresh-note').textContent, /刷新/);
  receive({report:null});assert.equal(get('expiry-block').dataset.warning,'false');assert.equal(get('expiry-note').textContent,'暂未取得积分余额');assert.equal(get('refresh-note').textContent,'刷新时间暂未知');
  receive({report:{total:0,expires:[]}});assert.equal(get('expiry-note').textContent,'暂无已知即将到期积分');assert.equal(get('refresh-note').textContent,'刷新时间暂未知');
  get('view-daily').listeners.click(); get('week').listeners.click();
  assert.equal(get('change-label').textContent, '近7天消耗'); assert.equal(get('change').textContent, '—');
  assert.equal(get('hint').textContent, '消耗统计暂不可用'); assert.equal(get('view-daily').attrs['aria-selected'], 'true');
  receive({ report: { total: 0 }, history: [] }); assert.equal(get('balance').textContent, '0'); assert.equal(get('change').textContent, '—');
  receive({ usage: { busy: true, report: null } }); assert.equal(get('hint').textContent, '正在同步消耗记录…');
  const usage = { source: 'official-request-usage', timezone: 'Asia/Shanghai', complete: true, days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, credits: i === 6 ? .09 : 0 })), todayRecords: [{ at: now - 600000, credits: .04 }, { at: now - 300000, credits: .05 }], endDate: '2026-10-25', totalCredits: .09, todayCredits: .09, updatedAt: now };
  get('today').listeners.click(); get('view-records').listeners.click();
  receive({ usage: { report: usage } }); assert.equal(get('change').textContent, '0.09'); assert.equal(get('usage-empty').hidden, true);
  assert.match(get('usage-plot').children[0].attrs['aria-label'], /请求时间累计消耗/);
  const todaySvg = get('usage-plot').children[0], todayDots = todaySvg.children.filter(n => n.tag === 'circle');
  assert.equal(todayDots.length, 3); assert.equal(todayDots[0].attrs.cx, 62); assert.equal(todayDots[0].attrs.cy, 108); assert.equal(todayDots.at(-1).attrs.cx, 338);
  const times = todaySvg.children.filter(n => n.tag === 'text' && n.attrs.y === 132).map(n => n.textContent);
  assert.deepEqual(times, ['00:00', '11:55']);
  assert.ok(todaySvg.children.find(n => n.attrs.class === 'observed-line').attrs.d.startsWith('M62 108L'));
  get('week').listeners.click(); assert.equal(get('usage-plot').children[0].children.filter(n => n.tag === 'circle').length, 7);
  get('view-daily').listeners.click();
  assert.equal(get('usage-plot').children[0].children.filter(n => n.tag === 'rect').length, 7);
  assert.equal(get('period-switch').hidden, true); assert.equal(get('change-label').textContent, '近7天消耗');
  const zero = { ...usage, days: usage.days.map(d => ({ ...d, credits: 0 })), todayRecords: [], totalCredits: 0, todayCredits: 0 };
  receive({ usage: { report: zero } }); assert.equal(get('change').textContent, '0'); assert.equal(get('usage-empty').hidden, true);
  const axes = get('usage-plot').children[0].children.filter(n => n.attrs.class === 'axis'); assert.equal(axes.length, 1);
  receive({ usage: { error: 'failed', report: null } }); assert.equal(get('change').textContent, '—'); assert.equal(get('usage-plot').children.length, 0);
  assert.equal(get('usage-empty').hidden, false); assert.equal(get('hint').textContent, '消耗统计暂不可用');
  receiveColor('standard', 'dark', 'blue'); assert.equal(document.documentElement.dataset.resolvedAppearance, 'dark');
  receiveColor('accessible', 'light', 'green'); assert.equal(document.documentElement.dataset.resolvedAppearance, 'light');
  assert.equal(sizes.at(-1), 214); get('details-close').listeners.click(); assert.equal(close, 1);
  const html = fs.readFileSync(path.join(__dirname, '../workbuddy-details.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../workbuddy-details-renderer.js'), 'utf8');
  assert.equal((html.match(/class="chart-meta"/g) || []).length, 1);
  assert.match(html, /<h1 id="details-title">消耗趋势/); assert.match(html, /2–3小时/);
  assert.doesNotMatch(html, /forecast-note|观察减少|400|usage-caption/);
  assert.match(html, /chart-help-body"><ul><li>/);
  assert.doesNotMatch(renderer, /reductionSeries|analyze\(/);
});
