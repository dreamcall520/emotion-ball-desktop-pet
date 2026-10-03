const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { createApiUsageLabelWindow, apiLabelBounds } = require('../lib/api-usage-label-window');
const { quotaLabelBounds } = require('../lib/quota-label-placement');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

const STATE = {
  connected: true, busy: false, error: null,
  config: { projectId: 'proj-test', apiKeyId: 'key-test' },
  report: { month: '2026-10', updatedAt: 1790899200000,
    costs: { month: [{ currency: 'USD', value: 0.00000009 }], today: [{ currency: 'USD', value: 0 }] },
    usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: null, requests: 2 } }
};
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
const inside = (rect, area) => rect.x >= area.x && rect.y >= area.y &&
  rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;

function nativeObstacle(bounds, visible = true) {
  return Object.assign(new EventEmitter(), {
    bounds: { ...bounds }, visible, destroyed: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
    getBounds() { return { ...this.bounds }; }
  });
}

function fixture() {
  const windows = [], errors = [], opened = [];
  const pet = nativeObstacle({ x: 600, y: 400, width: 80, height: 80 });
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const state = { quota: null, bubble: null, appearance: 'dark', presentation: null, matches: [] };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, isDestroyed: () => false,
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        send: (...args) => { this.sent.push(args); this.onSend?.(); }
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    hide() { this.visible = false; }
    showInactive() { this.onShow?.(); this.visible = true; }
    setBounds(value) { this.bounds = { ...value }; this.onBounds?.(); }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setAlwaysOnTop(...args) { this.topmost = args; }
    setVisibleOnAllWorkspaces(...args) { this.workspaces = args; }
    setHiddenInMissionControl(value) { this.hiddenInMissionControl = value; }
    loadFile(file) { this.file = file; return new Promise((resolve, reject) => { this.loaded = resolve; this.failed = reject; }); }
  }
  const controller = createApiUsageLabelWindow({ BrowserWindow: Window, getPetWindow: () => pet,
    getQuotaWindow: () => state.quota, getObstacleBounds: () => state.bubble,
    getAppearance: () => state.appearance, getPresentation: () => state.presentation,
    screen: { getDisplayMatching: bounds => { state.matches.push(bounds); return { workArea: area }; } },
    onOpenDetails: () => opened.push(true), onError: error => errors.push(error) });
  const ipc = (win, channel, event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }) =>
    win.webContents.emit('ipc-message', event, channel);
  const ready = async () => { windows.at(-1).loaded(); await flush(); return windows.at(-1); };
  return { controller, windows, errors, opened, pet, area, state, ipc, ready };
}

test('API card stays inside the display without covering pet, visible Codex card or bubble', () => {
  const cases = [
    { area: { x: 0, y: 0, width: 1440, height: 900 }, pet: { x: 600, y: 400, width: 80, height: 80 } },
    { area: { x: 0, y: 32, width: 1512, height: 950 }, pet: { x: 1408, y: 878, width: 80, height: 80 },
      bubble: { x: 1280, y: 784, width: 224, height: 86 } },
    { area: { x: -1920, y: -180, width: 1920, height: 1080 }, pet: { x: -1900, y: -160, width: 80, height: 80 } },
    { area: { x: 0, y: 0, width: 1440, height: 900 }, pet: { x: 0, y: 800, width: 80, height: 80 } },
    { area: { x: 0, y: 0, width: 1440, height: 900 }, pet: { x: 1360, y: 0, width: 80, height: 80 } }
  ];
  for (const { pet, area, bubble = null } of cases) for (const quotaExpanded of [false, true]) {
    const presentation = { shape: 'aurora-cloud', mode: 'peeked',
      side: pet.x < area.x + area.width / 2 ? 'left' : 'right' };
    const quota = quotaLabelBounds(pet, area, bubble, 'compact', quotaExpanded, 2, presentation);
    for (const expanded of [false, true]) {
      const bounds = apiLabelBounds(pet, area, quota, bubble, expanded, presentation);
      assert.equal(bounds.width, expanded ? 196 : 128);
      assert.equal(bounds.height, expanded ? 128 : 32);
      assert.ok(inside(bounds, area), JSON.stringify({ bounds, area }));
      for (const obstacle of [petVisualBounds(pet, presentation.shape, presentation), quota, bubble].filter(Boolean)) {
        assert.equal(overlaps(bounds, obstacle), false, JSON.stringify({ bounds, obstacle }));
      }
    }
  }
  assert.deepEqual(apiLabelBounds(cases[0].pet, cases[0].area, null, null),
    { x: 576, y: 488, width: 128, height: 32, placement: 'below' });
  const presentation = { shape: 'aurora-cloud', mode: 'peeked', side: 'right' };
  assert.deepEqual(apiLabelBounds(cases[0].pet, cases[0].area, null, null, false, presentation),
    quotaLabelBounds(cases[0].pet, cases[0].area, null, 'compact', false, 2, presentation));
});

test('peeked edge cards share an inward edge and an 8px gap across sizes and expansions', () => {
  const area = { x: -1440, y: 32, width: 1440, height: 1000 };
  for (const side of ['left', 'right']) for (const size of [60, 80, 108, 180, 260]) {
    const pet = { x: side === 'left' ? area.x : area.x + area.width - size,
      y: 400, width: size, height: size };
    const presentation = { shape: 'aurora-cloud', mode: 'peeked', side };
    for (const sizeName of ['compact', 'standard']) for (const quotaExpanded of [false, true]) {
      const quota = quotaLabelBounds(pet, area, null, sizeName, quotaExpanded, 2, presentation, true);
      for (const expanded of [false, true]) {
        const bounds = apiLabelBounds(pet, area, quota, null, expanded, presentation);
        assert.equal(side === 'right' ? bounds.x + bounds.width : bounds.x,
          side === 'right' ? quota.x + quota.width : quota.x,
          JSON.stringify({ side, size, quotaExpanded, expanded, bounds, quota }));
        assert.equal(bounds.y, quota.y + quota.height + 8);
        assert.ok(inside(bounds, area));
        assert.equal(overlaps(bounds, quota), false);
      }
    }
  }
});

test('lazy native window has safe flags, local resources, denied navigation and a dark safe report', async () => {
  const f = fixture();
  assert.equal(f.controller.getWindow(), null);
  const source = structuredClone(STATE);
  source.key = 'secret'; source.report.costs.month[0].key = 'secret'; source.config.key = 'secret';
  f.controller.show(source);
  const win = f.windows[0];
  assert.equal(win.visible, false);
  assert.equal(win.options.frame, false); assert.equal(win.options.focusable, false);
  assert.equal(win.options.transparent, true); assert.equal(win.options.show, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.ok(win.options.webPreferences.preload.endsWith('/api-usage-label-preload.js'));
  assert.ok(win.file.endsWith('/api-usage-label.html'));
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  for (const event of ['will-navigate', 'will-attach-webview']) {
    let prevented = false;
    win.webContents.emit(event, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  source.report.costs.month[0].value = 200;
  await f.ready();
  assert.equal(win.visible, true); assert.equal(win.ignoresMouse, false);
  assert.deepEqual(win.sent.at(-1), ['pet:api-usage-label', { ...STATE, expanded: false, appearance: 'dark' }]);
  assert.deepEqual(f.state.matches[0], f.pet.bounds);
  f.state.appearance = 'light'; f.controller.reposition();
  assert.equal(win.sent.at(-1)[1].appearance, 'light');
  f.controller.setAlwaysOnTop(false);
  assert.deepEqual(win.topmost, [false, 'floating']);
  assert.equal(f.errors.length, 0);
});

test('trusted visible IPC toggles report while open and empty report lead to details', async () => {
  const f = fixture(); f.controller.show(STATE);
  const win = f.windows[0];
  f.ipc(win, 'pet:api-usage-label-toggle'); assert.equal(f.opened.length, 0);
  await f.ready();
  f.ipc(win, 'pet:api-usage-label-toggle', { sender: {}, senderFrame: win.webContents.mainFrame });
  f.ipc(win, 'pet:api-usage-label-toggle', { sender: win.webContents, senderFrame: {} });
  f.ipc(win, 'pet:quota-label-toggle');
  assert.equal(win.sent.at(-1)[1].expanded, false);
  f.ipc(win, 'pet:api-usage-label-toggle');
  assert.equal(win.sent.at(-1)[1].expanded, true); assert.equal(win.bounds.height, 128);
  f.ipc(win, 'pet:api-usage-label-open');
  assert.equal(f.opened.length, 1); assert.equal(win.sent.at(-1)[1].expanded, true);
  win.visible = false; f.ipc(win, 'pet:api-usage-label-open'); assert.equal(f.opened.length, 1);
  f.controller.hide(); f.ipc(win, 'pet:api-usage-label-toggle'); assert.equal(f.opened.length, 1);
  f.controller.show({ ...STATE, report: null });
  assert.equal(win.sent.at(-1)[1].expanded, false);
  f.ipc(win, 'pet:api-usage-label-toggle'); assert.equal(f.opened.length, 2);
  f.controller.show({ connected: false });
  f.ipc(win, 'pet:api-usage-label-toggle'); assert.equal(f.opened.length, 3);
});

test('late load cannot restore a hidden, disposed or pet-hidden card; hide resets expansion', async () => {
  for (const cancel of [f => f.controller.hide(), f => f.controller.destroy(), f => { f.pet.visible = false; }]) {
    const f = fixture(); f.controller.show(STATE); const win = f.windows[0];
    cancel(f); win.loaded(); await flush(); assert.equal(win.visible, false);
  }
  const f = fixture(); f.controller.show(STATE); const win = await f.ready();
  f.ipc(win, 'pet:api-usage-label-toggle'); f.controller.hide(); f.controller.show(STATE);
  assert.equal(win.sent.at(-1)[1].expanded, false); assert.equal(win.visible, true);
  assert.equal(f.windows.length, 1);
  f.controller.destroy(); assert.equal(f.controller.getWindow(), null);
  f.controller.show(STATE); const next = await f.ready();
  f.ipc(win, 'pet:api-usage-label-open'); assert.equal(f.opened.length, 0);
  assert.equal(next.visible, true);
  next.destroyed = true; next.visible = false;
  f.controller.show(STATE); const rebuilt = await f.ready();
  assert.equal(f.windows.length, 3); assert.equal(rebuilt.visible, true);
  assert.deepEqual(rebuilt.sent.at(-1)[1].report, STATE.report);
});

test('quota events update the union and obsolete listeners are removed on replacement, hide and destroy', async () => {
  const f = fixture();
  const old = nativeObstacle(quotaLabelBounds(f.pet.bounds, f.area, null, 'compact'));
  f.state.quota = old; f.controller.show(STATE); const win = await f.ready();
  assert.equal(win.bounds.y, old.bounds.y + old.bounds.height + 8);
  for (const event of ['move', 'resize', 'show', 'hide', 'closed']) assert.equal(old.listenerCount(event), 1);
  old.bounds.height = 128; old.emit('resize'); await flush();
  assert.equal(win.bounds.y, old.bounds.y + old.bounds.height + 8);
  old.visible = false; old.emit('hide'); await flush(); assert.equal(win.bounds.y, 488);
  old.visible = true; old.emit('show'); await flush(); assert.equal(win.bounds.y, 624);
  const next = nativeObstacle({ x: 576, y: 312, width: 128, height: 32 });
  f.state.quota = next; f.controller.reposition();
  for (const event of ['move', 'resize', 'show', 'hide', 'closed']) {
    assert.equal(old.listenerCount(event), 0); assert.equal(next.listenerCount(event), 1);
  }
  const sends = win.sent.length; old.emit('move'); await flush(); assert.equal(win.sent.length, sends);
  next.destroyed = true; next.emit('closed'); await flush();
  assert.equal(next.listenerCount('move'), 0);
  f.state.quota = old; f.controller.reposition(); f.controller.hide();
  assert.equal(old.listenerCount('move'), 0);
  f.controller.show(STATE); f.controller.destroy(); assert.equal(old.listenerCount('move'), 0);
});

test('quota events read settled native visibility and bounds once, and stale queued bindings stay inert', async () => {
  const f = fixture();
  const quota = nativeObstacle(quotaLabelBounds(f.pet.bounds, f.area, null, 'compact'), false);
  f.state.quota = quota; f.controller.show(STATE); const win = await f.ready();
  assert.equal(win.bounds.y, quota.bounds.y);
  const sends = win.sent.length;
  quota.emit('show');
  quota.visible = true;
  quota.emit('resize');
  quota.bounds.height = 128;
  quota.emit('move');
  await flush();
  assert.equal(win.sent.length, sends + 1);
  assert.equal(win.bounds.y, quota.bounds.y + quota.bounds.height + 8);
  assert.equal(overlaps(win.bounds, quota.bounds), false);
  quota.emit('resize');
  f.controller.hide(); f.controller.show(STATE);
  const afterRebind = win.sent.length;
  await flush();
  assert.equal(win.sent.length, afterRebind, 'a queued event from an obsolete binding cannot affect a reused window');
  quota.emit('move'); f.controller.destroy();
  await flush(); assert.equal(f.controller.getWindow(), null);
});

test('reentrant updates use the newest state and hiding during native show stays hidden', async () => {
  const f = fixture(); f.controller.show(STATE); const win = await f.ready();
  win.onSend = () => {
    win.onSend = null;
    f.controller.show({ ...STATE, busy: true });
  };
  f.controller.reposition();
  assert.equal(win.sent.at(-1)[1].busy, true); assert.equal(win.visible, true);
  win.onShow = () => { win.onShow = null; f.controller.hide(); };
  f.controller.reposition(); assert.equal(win.visible, false);
  assert.equal(win.ignoresMouse, true); assert.equal(f.errors.length, 0);
});

test('old load failure and renderer exit cannot affect a replacement window', async () => {
  const f = fixture(); f.controller.show(STATE); const old = f.windows[0];
  f.controller.destroy(); f.controller.show(STATE); const win = await f.ready();
  old.failed(new Error('old failure'));
  old.webContents.emit('render-process-gone', {}, { reason: 'old crash' }); await flush();
  assert.equal(win.visible, true); assert.equal(f.errors.length, 0);
  win.webContents.emit('render-process-gone', {}, { reason: 'crash' });
  assert.equal(win.visible, false); assert.equal(f.controller.getWindow(), null);
  assert.equal(f.errors.length, 1);
});

test('unknown or invalid amounts remain without a report while a valid zero is retained', async () => {
  const f = fixture(); f.controller.show({ ...STATE, report: { ...STATE.report,
    costs: { month: [{ currency: 'USD', value: NaN }], today: [] } } });
  const win = await f.ready(); assert.equal(win.sent.at(-1)[1].report, null);
  f.controller.show({ ...STATE, report: { ...STATE.report,
    costs: { month: [{ currency: 'USD', value: 0 }], today: [{ currency: 'USD', value: 0 }] } } });
  assert.equal(win.sent.at(-1)[1].report.costs.month[0].value, 0);
  f.controller.show({ ...STATE, busy: true, error: '未更新' });
  assert.equal(win.sent.at(-1)[1].report.costs.month[0].value, STATE.report.costs.month[0].value);
});
