const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { GuardGame, primary, remainingText } = require('../quota-guard-renderer');
const { guardModel } = require('../lib/quota-guard-window');
const { normalizeSettings } = require('../lib/settings');
const { quotaLabelSize, quotaLabelBounds } = require('../lib/quota-label-placement');
const quota = (remaining = 1, windowMinutes = 2195.35) => ({ sourceId: 'zcode', state: 'ready', visible: true, items: [{
 label: 'GLM-5.3', model: 'GLM-5.3', bucketId: 'zcode:real:bucket', remaining, windowMinutes, periodStart: 1900000000000, resetsAt: 2000000000000 }] });
test('ZCode guard uses the real first bucket, fractional or unknown period and independent cycle identity', () => {
 const game = new GuardGame(); game.setModel(quota()); assert.equal(game.quota, 1); assert.equal(game.period, 2195.35);
 const first = game.round; game.setModel(quota()); assert.equal(game.round, first);
 const changed = quota(); changed.items[0].bucketId += ':other'; game.setModel(changed); assert.equal(game.round, first + 1);
 changed.items[0].resetsAt++; game.setModel(changed); assert.equal(game.round, first + 2);
 game.setModel(quota(99.8706, null)); assert.equal(game.quota, 99.8706); assert.equal(game.period, null);
 game.setModel(quota(0)); assert.equal(game.outcome, 'zombie'); assert.equal(game.quota, 0);
 for (const bad of [NaN, -1, 101, '1']) assert.equal(primary(quota(bad)), null);
 const invalid = quota(); invalid.items[0].bucketId = 'foreign'; assert.equal(primary(invalid), null);
 assert.equal(primary({ ...quota(), sourceId: 'codex' }), null, 'Codex still rejects fractional periods');
});
test('ZCode guard percent format matches the card without rounding consumed quota to 100%', () => {
 for (const [value, expected] of [[0,'0%'],[1,'1%'],[99.8706,'99.9%'],[99.99,'<100%'],[.01,'<0.1%'],[100,'100%']]) assert.equal(remainingText(value,'zcode'),expected);
 assert.equal(remainingText(99.8706,'codex'),'100%');
});
test('guard and preload preserve only the sanitized first ZCode bucket and never pass secrets', () => {
 const source = quota(); source.secret = 'DO_NOT_PASS'; source.items.push({ ...source.items[0], remaining: 90 });
 const safe = guardModel(source); assert.equal(safe.sourceId,'zcode'); assert.equal(safe.items.length,1);
 assert.equal(safe.items[0].bucketId,'zcode:real:bucket'); assert.equal(safe.items[0].model,'GLM-5.3');
 assert.equal(safe.items[0].remaining,1); assert.equal(JSON.stringify(safe).includes('DO_NOT_PASS'),false);
 let bridge; const listeners = new Map();
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../quota-guard-preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>{bridge=value;}},ipcRenderer:{on:(key,fn)=>listeners.set(key,fn),removeListener(){},send(){}}})});
 let received; bridge.onModel(value=>{received=value;}); listeners.get('pet:quota-guard-model')({},safe);
 assert.equal(received.sourceId,'zcode'); assert.equal(received.items[0].remaining,1); assert.equal(received.items[0].windowMinutes,2195.35);
 listeners.get('pet:quota-guard-model')({},guardModel(quota(99.8706,null))); assert.equal(received.items[0].windowMinutes,null);
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
test('ZCode bottom-aligned collapsed card reserves a bounded adjacent guard target', () => {
  const area = { x: -1200, y: -100, width: 1200, height: 800 };
  for (const x of [-1200, -700, -80]) for (const y of [-100, 600]) {
    const bounds = quotaLabelBounds({ x, y, width: 80, height: 80 }, area, null, 'compact', false, 4,
      { mode: 'free', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaRoleWidth: 50 }, false, true);
    assert.ok(['left','right'].includes(bounds.guardSide)); assert.ok(bounds.cardInset);
    assert.ok(bounds.width >= 192); assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
  }
});

test('main binds the shared guard to its source: Codex sync cannot close or overwrite ZCode real quota', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const functions = source.slice(source.indexOf('function canShowQuotaGuard()'), source.indexOf('\nasync function openCodexDetailThread'));
  let visible = false, available = true, codexEntry = false; const calls = [];
  const context = vm.createContext({ quotaGuardSource: 'codex', isQuitting: false, screenLocked: false,
    shortcutWindow: null, chatWindow: null, codexDetails: null, presentationSuppressed: () => false,
    petWindow: { isDestroyed: () => false, isVisible: () => true },
    settings: { codexEnabled: false, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaFunEnabled: true, codexQuotaAlwaysVisible: true },
    quotaLabel: { isGuardEntryVisible: () => codexEntry }, quotaLabelModel: () => ({ state: 'ready', items: [{ remaining: 64, windowMinutes: 300 }] }), buildZcodeQuotaLabelModel: value => value,
    zcodeLink: { isEnabled: () => true, isCardAvailable: () => available, getSnapshot: () => quota() },
    quotaGuard: { isVisible: () => visible, open: value => { visible = true; calls.push(['open', value]); return true; },
      update: value => calls.push(['update', value]), close: () => { visible = false; calls.push(['close']); } } });
  vm.runInContext(functions, context);
  assert.equal(context.openQuotaGuard('zcode'), true); assert.equal(context.quotaGuardSource, 'zcode');
  assert.equal(calls.at(-1)[1].sourceId,'zcode'); assert.equal(calls.at(-1)[1].items[0].remaining,1);
  context.closeCodexQuotaGuard(); assert.equal(visible, true);
  context.syncZcodeQuotaGuard(); assert.equal(calls.at(-1)[0], 'update'); assert.equal(calls.at(-1)[1].sourceId,'zcode');
  for (const key of ['zcodeEnabled', 'zcodeQuotaAlwaysVisible', 'zcodeQuotaFunEnabled']) {
    context.settings[key] = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false);
    assert.equal(context.openQuotaGuard('zcode'), false); context.settings[key] = true;
    assert.equal(context.openQuotaGuard('zcode'), true);
  }
  available = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false); available = true;
  codexEntry = true; assert.equal(context.openQuotaGuard('zcode'), false); codexEntry = false;
  context.settings.codexEnabled = true; assert.equal(context.openQuotaGuard(), true);
  assert.equal(context.quotaGuardSource, 'codex'); assert.equal(calls.at(-1)[1].sourceId,undefined);
  context.closeCodexQuotaGuard(); assert.equal(visible, false);
  for (const key of ['screenLocked','isQuitting']) {
    context[key] = true; assert.equal(context.openQuotaGuard('zcode'), false); context[key] = false;
  }
});

test('ZCode guard ignores transparent top gutter when choosing the default below anchor', () => {
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  const area = { x: 0, y: 24, width: 1440, height: 876 };
  const pet = { x: 600, y: 300, width: 80, height: 80 };
  const presentation = { mode: 'free', shape: 'blob', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaRoleWidth: 50 };
  const visual = petVisualBounds(pet, 'blob', { ...presentation, quotaAnchor: true, quotaGuard: true });
  for (const size of ['compact', 'standard']) {
    const result = quotaLabelBounds(pet, area, null, size, false, 1, presentation, false, true);
    assert.equal(result.placement, 'below'); assert.equal(result.y + result.cardInset.y, visual.y + visual.height + 8);
  }
  const rightPet = { ...pet, x: area.width - pet.width };
  const right = quotaLabelBounds(rightPet, area, null, 'compact', false, 1, presentation, false, true);
  assert.equal(right.guardSide, 'left'); assert.equal(right.x + right.cardInset.x + 128, area.x + area.width);
});
