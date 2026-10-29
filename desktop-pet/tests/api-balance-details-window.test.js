const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createApiBalanceDetailsWindow } = require('../lib/api-balance-details-window');
const { balanceTrend } = require('../api-balance-trend');
const id = 'a'.repeat(64), other = 'b'.repeat(64), now = Date.now();
const balance = { available: 44.24, cash: 44.24, voucher: 0, currency: 'CNY', updatedAt: now };
const source = { enabled: true, selectedAccountId: id, status: 'ready', report: balance, history: [{ at: now - 1000, available: 45 }, { at: now, available: 44.24 }],
  accounts: [{ id, name: '个人', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report: balance }, { id: other, name: '工作', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report: balance }] };
function fixture() {
  const changes = [], errors = [], windows = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.dead = this.visible = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => this.dead, setWindowOpenHandler: fn => { this.open = fn; }, getURL: () => this.url, send: (channel, state) => this.sent.push({ channel, state }) }); windows.push(this); }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; } setAlwaysOnTop(value) { this.top = value; }
    setBounds(value) { this.bounds = value; } show() { this.visible = true; } hide() { this.visible = false; }
    destroy() { this.dead = true; this.emit('closed'); } loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
  }
  const controller = createApiBalanceDetailsWindow({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 900 } }) },
    getAnchor: () => ({ x: 400, y: 400, width: 196, height: 120 }), onVisibilityChange: value => changes.push(value), onError: value => errors.push(value) });
  const send = (channel, value, extra = {}) => { const win = controller.getWindow(); win.webContents.emit('ipc-message', { sender: win.webContents, senderFrame: win.webContents.mainFrame, ...extra }, `pet:api-balance-details-${channel}`, value); };
  return { controller, windows, changes, errors, send };
}
test('balance details authenticate frame, visibility, file URL and resize bounds, and reopen after crash', t => {
  const f = fixture(); t.after(() => f.controller.destroy());
  assert.equal(f.controller.open({ enabled: false }), false); assert.equal(f.windows.length, 0);
  assert.equal(f.controller.open(source), true); const win = f.controller.getWindow(); f.send('close'); assert.equal(f.controller.isVisible(), true, 'not ready cannot close');
  win.webContents.emit('did-finish-load'); assert.equal(win.visible, true); assert.deepEqual(win.open(), { action: 'deny' });
  assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.nodeIntegration, false);
  f.send('close', null, { senderFrame: {} }); f.send('close', null, { sender: {} }); assert.equal(f.controller.isVisible(), true);
  const oldUrl = win.url; win.url = 'https://untrusted.invalid/'; f.send('close'); win.url = oldUrl; assert.equal(f.controller.isVisible(), true);
  const size = win.bounds.height; for (const value of [0, 299, 701, 400.1, '400', NaN]) f.send('resize', value); assert.equal(win.bounds.height, size);
  f.send('resize', 400); assert(win.bounds.height > size && win.bounds.height <= 400); const resized = win.bounds.height; f.send('close'); assert.equal(win.visible, false);
  f.send('resize', 500); assert.equal(win.bounds.height, resized, 'hidden cannot resize');
  f.controller.open(source); f.controller.setAlwaysOnTop(false); assert.equal(win.top, false);
  win.webContents.emit('render-process-gone'); assert.equal(f.controller.getWindow(), null); assert.equal(f.controller.isVisible(), false);
  assert.equal(f.controller.open(source), true); assert.equal(f.windows.length, 2); assert.equal(f.errors.length, 0);
});
test('balance details keep selected state only, preserve stale snapshots and discard invalidated authentication', t => {
  const f = fixture(); t.after(() => f.controller.destroy()); f.controller.open(source); const win = f.controller.getWindow(); win.webContents.emit('did-finish-load');
  f.controller.update({ ...source, stale: true, error: 'private token', errorCode: 'TIMEOUT' });
  assert.equal(win.sent.at(-1).state.report.available, 44.24); assert.equal(win.sent.at(-1).state.history.length, 2); assert.doesNotMatch(JSON.stringify(win.sent), /private token/);
  f.controller.update({ ...source, selectedAccountId: other, history: [{ at: now, available: 3 }], report: { ...balance, available: 3 } });
  assert.deepEqual(win.sent.at(-1).state.history.map(p => p.available), [3]);
  f.controller.update({ ...source, status: 'unauthenticated', errorCode: 'UNAUTHENTICATED' }); assert.equal(win.sent.at(-1).state.report, null); assert.deepEqual(win.sent.at(-1).state.history, []);
  f.controller.update({ ...source, enabled: false }); assert.equal(f.controller.isVisible(), false);
});
test('trend periods use observed signed balances, no zero fill or invented net for empty/single records', () => {
  const noon = new Date(2026, 9, 27, 12).getTime(), day = 86400000;
  const records = [{ at: noon - 8 * day, available: 999 }, { at: noon - 6 * day, available: 50 }, { at: noon - 4 * day, available: 20 },
    { at: noon - 3600000, available: 30 }, { at: noon - 300000, available: 0 }, { at: noon, available: -1 }, { at: noon, available: -2 }, { at: noon + 1, available: 9 }, { at: noon - 1, available: Infinity }];
  const week = balanceTrend(records, 'week', noon); assert.deepEqual(week.points.map(p => p.available), [50, 20, -2]); assert.equal(week.net, -52); assert.equal(week.segments.length, 3);
  const today = balanceTrend(records, 'today', noon); assert.deepEqual(today.points.map(p => p.available), [30, 0, -2]); assert.equal(today.net, -32); assert.equal(today.segments.length, 2);
  assert.equal(balanceTrend([], 'week', noon).net, null); assert.equal(balanceTrend([{ at: noon, available: 0 }], 'today', noon).net, null);
  assert.equal(balanceTrend([{ at: noon - 1, available: 0 }, { at: noon, available: 0 }], 'today', noon).net, 0);
});
test('week keeps the last real balance per local date, preserves timestamps and calculates net from all observations', () => {
  const at = (date, hour, minute = 0) => new Date(2026, 9, date, hour, minute).getTime();
  const records = [{ at: at(27, 12), available: 15 }, { at: at(21, 0), available: 50 }, { at: at(21, 23), available: 40 },
    { at: at(27, 9), available: 20 }, { at: at(20, 23, 59), available: 999 }, { at: at(22, 8), available: 35 }];
  const before = JSON.stringify(records), view = balanceTrend(records, 'week', at(27, 12));
  assert.deepEqual(view.days.map(date => new Date(date).getDate()), [21,22,23,24,25,26,27]);
  assert.deepEqual(view.points.map(p => [p.at, p.available]), [[at(21,23),40],[at(22,8),35],[at(27,12),15]]);
  assert.equal(view.net, -35, 'daily display must not discard the first observation when calculating period net');
  assert.equal(view.segments.length, 2); assert.equal(JSON.stringify(records), before);
  assert.deepEqual(balanceTrend(records, 'today', at(27,12)).points.map(p => p.available), [20,15]);
});
test('weekly gaps follow missing calendar dates rather than hours between daily samples', () => {
  const at = (date, hour) => new Date(2026, 9, date, hour).getTime();
  const view = balanceTrend([{ at: at(21,0),available:50 },{ at:at(22,23),available:40 },{ at:at(24,0),available:30 }], 'week', at(27,12));
  assert.deepEqual(view.segments.map(segment => segment.map(p => p.available)), [[50,40],[30]]);
});
test('daily grouping uses calendar arithmetic across daylight saving changes', () => {
  const { execFileSync } = require('node:child_process');
  for (const timezone of ['Asia/Shanghai', 'America/New_York']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', `const {balanceTrend}=require(${JSON.stringify(require.resolve('../api-balance-trend'))});
      const now=new Date(2026,10,2,12), rows=Array.from({length:7},(_,i)=>{const d=new Date(now);d.setDate(d.getDate()-6+i);return {at:d.getTime(),available:50-i}});
      const v=balanceTrend(rows,'week',+now);console.log(JSON.stringify({dates:v.days.map(at=>new Date(at).getDate()),points:v.points.length,segments:v.segments.length,net:v.net}));`], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
    assert.deepEqual(result, { dates:[27,28,29,30,31,1,2],points:7,segments:1,net:-6 }, timezone);
  }
});
test('details preload exposes only narrow validated actions and detachable listeners', () => {
  let bridge; const sent = [], listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api-balance-details-preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_, value) => { bridge = value; } },
    ipcRenderer: { send: (...args) => sent.push(args), on: (name, listener) => listeners.set(name, listener), removeListener: name => listeners.delete(name) } }) });
  for (const value of ['400', -1, 800, 400.5]) bridge.resize(value); bridge.resize(363); bridge.close();
  assert.deepEqual(sent, [['pet:api-balance-details-resize', 363], ['pet:api-balance-details-close']]); assert.equal(bridge.send, undefined);
  let model; const remove = bridge.onModel(value => { model = value; }); listeners.get('pet:api-balance-details')({}, { selectedAccountId: id }); assert.equal(model.selectedAccountId, id); remove(); assert.equal(listeners.size, 0);
});
