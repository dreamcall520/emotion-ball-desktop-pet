const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildZcodeQuotaLabelModel } = require('../lib/zcode-quota-view');

test('main gates ZCode edge balances by its independent enabled/card preferences and visible unlocked tuck', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const functionSource = source.slice(source.indexOf('function tickEdgeNotice('), source.indexOf('\nfunction applyPresentation('));
  let snapshotReads = 0, packet;
  const settings = { codexEnabled: false, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true };
  const state = { linkEnabled: true, visible: true, mode: 'tucked' };
  const context = vm.createContext({ settings, workbuddyQuota: null, lastEdgeNoticeTick: -Infinity, edgeNoticeNow: () => 0,
    edgeTuck: { getPresentation: () => ({ mode: state.mode, side: 'left' }) },
    pomodoroQuiet: false, shortcutWindow: null, isQuitting: false, chatWindow: null, codexPageReady: true,
    screenLocked: false, petWindow: { isDestroyed: () => false, isVisible: () => state.visible },
    edgeNotice: { tick: value => { packet = value; } }, buildZcodeQuotaLabelModel,
    zcodeLink: { isEnabled: () => state.linkEnabled, getSnapshot: () => { snapshotReads++; return {
      enabled: true, quota: { state: 'connected', stale: false, updatedAt: Date.now(), windows: [{ id: 'zcode:real:bucket',
        remaining: 100, periodStart: Date.now() - 3600000, resetsAt: Date.now() + 3600000, windowMinutes: 120 }] } }; } } });
  vm.runInContext(functionSource + '\nglobalThis.tick = tickEdgeNotice;', context);
  context.tick(true); assert.equal(packet.zcodeQuotaModel.state, 'ready'); assert.equal(packet.quotaModel, null);
  const mutations = [
    [() => { settings.zcodeQuotaAlwaysVisible = false; }, () => { settings.zcodeQuotaAlwaysVisible = true; }],
    [() => { settings.zcodeEnabled = false; }, () => { settings.zcodeEnabled = true; }],
    [() => { state.linkEnabled = false; }, () => { state.linkEnabled = true; }],
    [() => { state.visible = false; }, () => { state.visible = true; }],
    [() => { state.mode = 'peeked'; }, () => { state.mode = 'tucked'; }],
    [() => { context.screenLocked = true; }, () => { context.screenLocked = false; }]
  ];
  for (const [hide, restore] of mutations) {
    hide(); const before = snapshotReads; context.tick(true);
    assert.equal(packet.zcodeQuotaModel, null); assert.equal(snapshotReads, before, 'disabled/hidden path never reads old quota'); restore();
  }
});
