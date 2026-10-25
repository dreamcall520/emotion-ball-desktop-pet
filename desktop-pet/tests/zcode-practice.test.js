const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { GuardGame, primary } = require('../quota-guard-renderer');
const { guardModel } = require('../lib/quota-guard-window');
const { normalizeSettings } = require('../lib/settings');
const { quotaLabelSize, quotaLabelBounds } = require('../lib/quota-label-placement');
const practice = { sourceId: 'zcode', practice: true, state: 'ready', visible: true, items: [] };
test('ZCode practice is independent of real balances and does not invent an account period', () => {
  const game = new GuardGame(); game.setModel(practice);
  assert.equal(game.available, true); assert.equal(game.quota, 100); assert.equal(game.period, null);
  assert.equal(game.shoot(), true); game.step(200); const round = game.round;
  game.setModel({ ...practice, items: [{ remaining: 0, windowMinutes: 2195.35 }] });
  assert.equal(game.round, round); assert.equal(game.quota, 100);
  game.paused = true; const time = game.time; game.step(200); assert.equal(game.time, time);
  game.reset(); assert.equal(game.playerHits, 0);
  game.setModel({ ...practice, state: 'disabled' }); assert.equal(game.available, false);
  assert.equal(primary({ ...practice, sourceId: 'codex' }), null);
});
test('guard and preload preserve only the explicit ZCode practice identity without live quota fields', () => {
  const safe = guardModel({ ...practice, secret: 'DO_NOT_PASS', items: [{ label: 'live', remaining: 7, windowMinutes: 300 }] });
  assert.equal(safe.practice, true); assert.equal(safe.sourceId, 'zcode'); assert.deepEqual(safe.items, []);
  assert.equal(JSON.stringify(safe).includes('DO_NOT_PASS'), false);
  let bridge; const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../quota-guard-preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
      ipcRenderer: { on: (key, fn) => listeners.set(key, fn), removeListener() {}, send() {} } })
  });
  let received; bridge.onModel(value => { received = value; }); listeners.get('pet:quota-guard-model')({}, safe);
  assert.equal(received.practice, true); assert.equal(received.sourceId, 'zcode'); assert.equal(received.items.length, 0);
});
test('ZCode fun preference defaults true and normalizes independently from Codex', () => {
  assert.equal(normalizeSettings({}).zcodeQuotaFunEnabled, true);
  const settings = normalizeSettings({ zcodeQuotaFunEnabled: false, codexQuotaFunEnabled: true });
  assert.equal(settings.zcodeQuotaFunEnabled, false); assert.equal(settings.codexQuotaFunEnabled, true);
});
test('ZCode expanded one/two/four buckets reserve their complete source heading', () => {
  for (const size of ['compact', 'standard']) for (const [count, height] of [[1,154],[2,166],[4,256]]) {
    assert.equal(quotaLabelSize(size, true, count, false, false, null, 'zcode').height, height);
  }
});
test('ZCode bottom-aligned collapsed card reserves a bounded adjacent practice target', () => {
  const area = { x: -1200, y: -100, width: 1200, height: 800 };
  for (const x of [-1200, -700, -80]) for (const y of [-100, 600]) {
    const bounds = quotaLabelBounds({ x, y, width: 80, height: 80 }, area, null, 'compact', false, 4,
      { mode: 'free', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaRoleWidth: 50 }, false, true);
    assert.ok(['left','right'].includes(bounds.guardSide)); assert.ok(bounds.cardInset);
    assert.ok(bounds.width >= 192); assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
  }
});

test('main binds the shared guard to its source: Codex sync cannot close or overwrite ZCode practice', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const functions = source.slice(source.indexOf('function canShowQuotaGuard()'), source.indexOf('\nasync function openCodexDetailThread'));
  let visible = false, available = true, codexEntry = false; const calls = [];
  const context = vm.createContext({ quotaGuardSource: 'codex', isQuitting: false, screenLocked: false,
    shortcutWindow: null, chatWindow: null, codexDetails: null, presentationSuppressed: () => false,
    petWindow: { isDestroyed: () => false, isVisible: () => true },
    settings: { codexEnabled: false, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaFunEnabled: true, codexQuotaAlwaysVisible: true },
    quotaLabel: { isGuardEntryVisible: () => codexEntry }, quotaLabelModel: () => ({ state: 'ready', items: [{ remaining: 64, windowMinutes: 300 }] }),
    zcodeLink: { isEnabled: () => true, isCardAvailable: () => available },
    quotaGuard: { isVisible: () => visible, open: value => { visible = true; calls.push(['open', value]); return true; },
      update: value => calls.push(['update', value]), close: () => { visible = false; calls.push(['close']); } } });
  vm.runInContext(functions, context);
  assert.equal(context.openQuotaGuard('zcode'), true); assert.equal(context.quotaGuardSource, 'zcode');
  assert.equal(calls.at(-1)[1].practice, true); assert.equal(calls.at(-1)[1].items.length, 0);
  context.closeCodexQuotaGuard(); assert.equal(visible, true);
  context.syncZcodeQuotaGuard(); assert.equal(calls.at(-1)[0], 'update'); assert.equal(calls.at(-1)[1].practice, true);
  for (const key of ['zcodeEnabled', 'zcodeQuotaAlwaysVisible', 'zcodeQuotaFunEnabled']) {
    context.settings[key] = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false);
    assert.equal(context.openQuotaGuard('zcode'), false); context.settings[key] = true;
    assert.equal(context.openQuotaGuard('zcode'), true);
  }
  available = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false); available = true;
  codexEntry = true; assert.equal(context.openQuotaGuard('zcode'), false); codexEntry = false;
  context.settings.codexEnabled = true; assert.equal(context.openQuotaGuard(), true);
  assert.equal(context.quotaGuardSource, 'codex'); assert.equal(calls.at(-1)[1].practice, undefined);
  context.closeCodexQuotaGuard(); assert.equal(visible, false);
  for (const key of ['screenLocked','isQuitting']) {
    context[key] = true; assert.equal(context.openQuotaGuard('zcode'), false); context[key] = false;
  }
});

test('practice retains the original thirty-hit win and local zombie defeat without changing quota data', () => {
  const game = new GuardGame(); game.setModel(practice);
  for (let t = 0; t < 20000 && !game.ended; t += 130) {
    game.shoot(); for (let dt = 0; dt < 130; dt += 10) game.step(10);
  }
  assert.equal(game.outcome, 'qiuqiu'); assert.equal(game.playerHits, 30); assert.equal(game.quota, 100);
  game.reset();
  for (let t = 0; t < 20000 && !game.ended; t += 100) { game.advance(); game.step(100); }
  assert.equal(game.outcome, 'zombie'); assert.equal(game.quota, 100); assert.deepEqual(practice.items, []);
});
