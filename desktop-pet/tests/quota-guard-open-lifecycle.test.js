const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('function openQuotaGuard(source =');
const end = source.indexOf('\nasync function openCodexDetailThread', start);
function fixture(openResult = true, onAcquire = () => {}) {
  let leases = 0, earlyCards = 0, allowed = true, gameVisible = false;
  const events = [], models = [];
  const context = { quotaGuardSource: 'codex', canShowQuotaGuard: () => allowed,
    zcodeGuardEntryAvailable: () => true, buildZcodeQuotaLabelModel: () => ({ state: 'ready' }),
    zcodeLink: { getSnapshot: () => ({}) }, settings: {}, quotaLabelModel: () => ({ state: 'ready' }),
    quotaPopups: { acquire() { leases++; events.push('acquire'); onAcquire(context); let done = false; return () => { assert(!done); done = true; leases--; events.push('release'); }; } },
    quotaGuard: { open(model) {
      events.push('open');
      models.push(model);
      // A reused window invokes synchronous visibility/layout callbacks before its native show.
      if (leases === 0) earlyCards++;
      if (openResult instanceof Error) throw openResult;
      gameVisible = openResult;
      return openResult;
    } }
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return { context, events, models, set allowed(value) { allowed = value; }, get earlyCards() { return earlyCards; },
    get leases() { return leases; }, get gameVisible() { return gameVisible; } };
}
test('opening keeps the clicked WorkBuddy source when hiding sibling windows resets the old presentation', () => {
  const f = fixture(true, context => { context.quotaGuardSource = 'codex'; });
  assert.equal(f.context.openQuotaGuard('workbuddy'), true);
  assert.equal(f.models[0].practice, true);
  assert.equal(f.context.quotaGuardSource, 'workbuddy');
});
test('warm guard entry suppresses cards before synchronous game visibility/layout callbacks', () => {
  for (const source of ['codex', 'workbuddy', 'zcode']) {
    const f = fixture();
    assert.equal(f.context.openQuotaGuard(source), true);
    assert.equal(f.earlyCards, 0, 'no intermediate card show before the game establishes its native popup role');
    assert.deepEqual(f.events, ['acquire', 'open', 'release']);
    assert.equal(f.leases, 0);
    assert.equal(f.gameVisible, true);
  }
});
test('failed or throwing guard opens release their own lease without retaining a false source', () => {
  const failed = fixture(false);
  assert.equal(failed.context.openQuotaGuard('workbuddy'), false);
  assert.equal(failed.context.quotaGuardSource, 'codex');
  assert.equal(failed.leases, 0);
  const error = Error('native game open failed'), throwing = fixture(error);
  assert.throws(() => throwing.context.openQuotaGuard(), error);
  assert.equal(throwing.leases, 0);
});
test('unavailable guard entry does not hide cards or acquire a lease', () => {
  const f = fixture(); f.allowed = false;
  assert.equal(f.context.openQuotaGuard('workbuddy'), false);
  assert.equal(f.context.quotaGuardSource, 'codex');
  assert.deepEqual(f.events, []);
});
