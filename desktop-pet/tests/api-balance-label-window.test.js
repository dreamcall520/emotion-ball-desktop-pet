const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createApiBalanceLabelWindow, apiBalanceLabelBounds, safeState } = require('../lib/api-balance-label-window');
const id = 'a'.repeat(64), other = 'b'.repeat(64);
const report = { available: 44.24, cash: 44.24, voucher: 0, currency: 'CNY', updatedAt: Date.now() };
const source = { enabled: true, status: 'ready', accounts: [{ id, name: '个人', provider: 'moonshot', supported: true, currency: 'CNY', status: 'ready', report },
  { id: other, name: '另一账户', provider: 'unknown', supported: false, status: 'unsupported' }], selectedAccountId: id, report,
  history: [{ at: report.updatedAt - 1000, available: 45 }, { at: report.updatedAt, available: 44.24 }] };
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function fixture(overrides = {}) {
  const calls = [], windows = []; let presentation = { mode: 'free' };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = this.dead = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, setWindowOpenHandler: fn => { this.open = fn; }, send: (channel, state) => this.sent.push({ channel, state }),
        getURL: () => 'file:///api-balance-label.html', capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('fixture png') }) }); windows.push(this);
    }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; } setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {}
    setIgnoreMouseEvents(value) { this.ignored = value; } setBounds(value) { this.bounds = { ...value }; } getBounds() { return { ...this.bounds }; }
    showInactive() { this.visible = true; } hide() { this.visible = false; } destroy() { this.dead = true; this.emit('closed'); } loadFile() { return Promise.resolve(); }
  }
  const controller = createApiBalanceLabelWindow({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 900 } }) },
    getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 400, y: 300, width: 80, height: 80 }) }),
    getPresentation: () => presentation, onRefresh: () => calls.push('refresh'), onTrend: () => calls.push('trend'), onSettings: () => calls.push('settings'),
    onSelectAccount: value => calls.push(value), onExpandedChange: value => calls.push(value), ...overrides });
  const send = (channel, value, event) => { const win = controller.getWindow(); win.webContents.emit('ipc-message', event || { sender: win.webContents, senderFrame: win.webContents.mainFrame }, `pet:api-balance-label-${channel}`, value); };
  return { controller, windows, calls, send, presentation: value => { presentation = value; } };
}
test('balance IPC whitelists selected/account summaries, preserves signed values and drops secrets/cross-account data', () => {
  const state = safeState({ ...source, key: 'secret', endpoint: 'secret', report: { ...report, available: -2, cash: -2, token: 'secret' },
    error: 'secret upstream error', errorCode: 'TIMEOUT', nextRetryAt: 100, history: [{ at: 2, available: 0, key: 'secret' }, { at: 1, available: 3 }, { at: 2, available: -2 }] });
  assert.equal(state.report.available, -2); assert.equal(state.report.cash, -2); assert.equal(state.accounts[0].report.available, 44.24);
  assert.deepEqual(state.history.map(point => point.available), [3, -2]); assert.doesNotMatch(JSON.stringify(state), /secret|endpoint|token/);
  assert.equal(state.errorCode, 'TIMEOUT'); assert.equal(state.nextRetryAt, 100);
  for (const status of ['unauthenticated', 'unconfigured', 'unsupported']) {
    const invalid = safeState({ ...source, status }); assert.equal(invalid.report, null); assert.deepEqual(invalid.history, []);
  }
  const unknown = safeState({ ...source, selectedAccountId: 'c'.repeat(64), errorCode: 'secret', error: 'secret', nextRetryAt: Infinity });
  assert.equal(unknown.selectedAccountId, null); assert.equal(unknown.report, null); assert.equal(unknown.errorCode, 'UPDATE_FAILED'); assert.equal(unknown.nextRetryAt, null);
  assert.equal(safeState({ ...source, report: { ...report, currency: 'USD' } }).report, null);
});
test('balance geometry matches approved dimensions and keeps coordinated group bounds and bubble priority', () => {
  const area = { x: -1000, y: -200, width: 1500, height: 1100 }, pet = { x: -500, y: 100, width: 80, height: 80 };
  for (const expanded of [false, true]) {
    const anchor = { x: -558, y: 188, width: 196, height: 120 }, bubble = { x: -558, y: 320, width: 196, height: 40 };
    const ordinary = apiBalanceLabelBounds(pet, area, [anchor], expanded, anchor);
    assert.equal(ordinary.width, expanded ? 196 : 128); assert.equal(ordinary.height, expanded ? 120 : 32); assert.equal(ordinary.y, 316);
    for (const obstacle of [pet, anchor]) assert.equal(intersects(ordinary, obstacle), false);
    assert.equal(apiBalanceLabelBounds(pet, area, [anchor, bubble], expanded, anchor, null, bubble), null);
    const coordinated = { x: -550, y: 400, width: ordinary.width, height: ordinary.height };
    assert.deepEqual(apiBalanceLabelBounds(pet, area, [], expanded, null, { mode: 'free', quotaGroupLayout: coordinated }), coordinated);
    assert.equal(apiBalanceLabelBounds(pet, area, [], expanded, null, { mode: 'free', quotaGroupHidden: true }), null);
  }
});
test('balance controller authenticates IPC, keeps account switching explicit and rejects hidden/busy actions', async t => {
  const f = fixture(); t.after(() => f.controller.destroy()); assert.equal(f.windows.length, 0);
  f.controller.show({ enabled: false }); assert.equal(f.windows.length, 0);
  f.controller.show(source); await Promise.resolve(); const win = f.controller.getWindow();
  assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.contextIsolation, true); assert.deepEqual(win.open(), { action: 'deny' });
  assert.deepEqual(f.controller.getLayoutMetrics(), { width: 128, height: 32, inset: 2 });
  f.send('select', other, { sender: {}, senderFrame: win.webContents.mainFrame }); f.send('select', other, { sender: win.webContents, senderFrame: {} });
  f.send('select', 'c'.repeat(64)); f.send('select', id); assert.equal(f.calls.length, 0);
  f.send('select', other); f.send('refresh'); f.send('trend'); f.send('settings'); assert.deepEqual(f.calls, [other, 'refresh', 'trend', 'settings']);
  assert.equal(win.sent.at(-1).state.selectedAccountId, id, 'selection waits for the backend state');
  f.send('toggle'); assert.deepEqual(f.controller.getLayoutMetrics(), { width: 196, height: 120, inset: 0 }); assert.equal(f.calls.at(-1), true);
  assert.deepEqual(f.controller.getVisibleBounds(), win.getBounds());
  f.controller.show({ ...source, busy: true }); f.send('refresh'); assert.equal(f.calls.filter(value => value === 'refresh').length, 1);
  f.controller.hide(); f.send('trend'); assert.equal(f.calls.filter(value => value === 'trend').length, 1); f.send('select', other); assert.equal(f.calls.filter(value => value === other).length, 1); assert.equal(f.controller.getLayoutMetrics(), null);
});
test('balance controller supports hold/stage/masked capture, reset and stale capture rejection', async t => {
  const f = fixture(); t.after(() => f.controller.destroy()); f.controller.show(source); await Promise.resolve();
  const win = f.controller.getWindow(); f.send('toggle'); const expanded = win.getBounds();
  f.controller.setGroupTransitionMode('hold'); f.controller.resetExpanded(); f.controller.reposition(); assert.deepEqual(win.getBounds(), expanded);
  assert.deepEqual(f.controller.getLayoutMetrics(), { width: 128, height: 32, inset: 2 });
  f.controller.setGroupTransitionMode('stage'); assert.equal(win.isVisible(), false); assert.equal(win.ignored, true); assert.equal(win.getBounds().height, 32);
  const captures = await f.controller.captureGroupTransitionFrames(); assert.equal(captures.length, 1); assert.equal(captures[0].bounds.height, 32);
  f.controller.setGroupTransitionMode('masked'); assert.equal(win.isVisible(), false); f.send('settings'); assert.equal(f.calls.includes('settings'), false);
  f.controller.setGroupTransitionMode(null); assert.equal(win.isVisible(), true); assert.equal(win.ignored, false);
  f.presentation({ mode: 'free', quotaGroupHidden: true }); f.controller.setGroupTransitionMode('stage');
  await assert.rejects(f.controller.captureGroupTransitionFrames(), /no visible layout/);
});
test('balance controller falls back to compact in limited space and never moves during tucked hide', async t => {
  const f = fixture({ screen: { getDisplayMatching: () => ({ workArea: { x: 300, y: 200, width: 250, height: 230 } }) } });
  t.after(() => f.controller.destroy()); f.controller.show(source); await Promise.resolve(); const win = f.controller.getWindow();
  f.send('toggle'); assert.equal(win.getBounds().height, 32); assert.equal(win.sent.at(-1).state.spaceError, true);
  const before = win.getBounds(); f.presentation({ mode: 'tucked', quotaAnimateHide: true }); f.controller.reposition();
  assert.deepEqual(win.getBounds(), before); assert.equal(win.ignored, true);
});
test('balance preload only emits validated account IDs and does not expose credentials or generic IPC', () => {
  let bridge; const sent = [], listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api-balance-label-preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'qiuqiuApiBalanceLabel'); bridge = value; } },
    ipcRenderer: { send: (...value) => sent.push(value), on: (name, fn) => listeners.set(name, fn), removeListener: name => listeners.delete(name) } }) });
  bridge.selectAccount('sk-secret'); bridge.selectAccount({ id }); bridge.selectAccount(id);
  assert.deepEqual(sent, [['pet:api-balance-label-select', id]]); assert.equal(bridge.send, undefined); assert.equal(bridge.readFile, undefined);
  let state; const remove = bridge.onState(value => { state = value; }); listeners.get('pet:api-balance-label')({}, { enabled: true }); assert.equal(state.enabled, true);
  remove(); assert.equal(listeners.has('pet:api-balance-label'), false);
});
