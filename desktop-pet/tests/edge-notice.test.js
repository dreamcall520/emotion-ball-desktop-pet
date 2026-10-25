const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeNotice, PHRASES } = require('../lib/edge-notice');
const { edgeNoticeBounds } = require('../lib/edge-notice-window');

function fixture() {
  let now = 0;
  const changes = [];
  const state = { presentation: { mode: 'tucked', side: 'left' }, visible: true,
    bubblesEnabled: true, quotaEnabled: true, appearance: 'light',
    quotaModel: { state: 'ready', items: [{ windowMinutes: 300, remaining: 83 }] } };
  const notice = createEdgeNotice({ now: () => now, random: () => 0, onChange: value => changes.push(value) });
  return { state, changes, notice, tick(time) { now = time; notice.tick(state); return changes.at(-1); } };
}

test('first quota, later phrase, expiry and shared gap do not overlap or extend on refresh', () => {
  const f = fixture();
  assert.equal(f.tick(0), undefined);
  assert.equal(f.tick(29999), undefined);
  assert.equal(f.tick(30000).kind, 'quota');
  assert.equal(f.tick(33000).expiresAt, 36000);
  f.state.quotaModel.items[0].remaining = 79;
  assert.equal(f.tick(34000).remaining, 79);
  assert.equal(f.tick(34000).expiresAt, 36000);
  assert.equal(f.tick(36000), null);
  assert.equal(f.tick(60000), null);
  assert.equal(f.tick(120000).kind, 'text');
  assert.ok(PHRASES.includes(f.changes.at(-1).text));
  f.tick(124500);
  const previous = f.changes.at(-2).text;
  assert.notEqual(f.tick(300000).text, previous, 'successive text never repeats');
});

test('settings, stale quota, missing period and disabled connectivity never leak percentages', () => {
  for (const state of ['stale', 'reset-wait', 'period-missing', 'disconnected', 'disabled']) {
    const f = fixture(); f.state.bubblesEnabled = false; f.tick(0);
    f.state.quotaModel.state = state;
    assert.equal(f.tick(60000), undefined);
    f.state.quotaModel.state = 'ready';
    assert.equal(f.tick(61000).kind, 'quota');
    f.state.quotaEnabled = false;
    assert.equal(f.tick(61100), null);
  }
});

test('text is independently available with Codex off and stops when bubbles disabled', () => {
  const f = fixture(); f.state.quotaEnabled = false; f.tick(0);
  assert.equal(f.tick(60000).kind, 'text');
  f.state.bubblesEnabled = false;
  assert.equal(f.tick(60100), null);
  assert.equal(f.tick(900000), null);
});

test('peek, drag, hide, pause, lock, close and reload clear active notices', () => {
  for (const mutate of [
    s => { s.presentation.mode = 'peeked'; }, s => { s.presentation.dragging = true; },
    s => { s.presentation.mode = 'hidden'; }, s => { s.presentation.paused = true; },
    s => { s.locked = true; }, s => { s.visible = false; }, s => { s.presentation.side = null; }
  ]) {
    const f = fixture(); f.tick(0); assert.equal(f.tick(30000).kind, 'quota');
    mutate(f.state); assert.equal(f.tick(30100), null);
    assert.equal(f.tick(900000), null);
  }
  const f = fixture(); f.tick(0); f.tick(30000); f.notice.reset();
  assert.equal(f.changes.at(-1), null);
});

test('repeated hover and docking never replay the old notice or bypass shared cooldown', () => {
  const f = fixture(); f.tick(0); f.tick(30000);
  f.state.presentation.mode = 'peeked'; f.tick(31000);
  f.state.presentation.mode = 'tucked'; assert.equal(f.tick(32000), null);
  f.state.presentation.side = null; f.tick(33000);
  f.state.presentation.side = 'right'; f.tick(34000);
  assert.equal(f.tick(64000), null);
  assert.equal(f.tick(120000).side, 'right');
});

test('quota only displays the selected primary period and zero is a valid balance', () => {
  const f = fixture(); f.state.quotaModel.items = [{ windowMinutes: 10080, remaining: 0 }, { windowMinutes: 300, remaining: 83 }];
  f.tick(0); const shown = f.tick(30000);
  assert.equal(shown.period, '周额度'); assert.equal(shown.remaining, 0);
  assert.equal(shown.statusLabel, '已用尽');
});

test('quota state matches the main card at raw balance boundaries before display rounding', () => {
  for (const [remaining, statusLabel] of [
    [100, ''], [20.4, ''], [20.01, ''], [20, '偏低'], [10.4, '偏低'], [10.01, '偏低'],
    [10, '紧张'], [0.4, '紧张'], [0.01, '紧张'], [0, '已用尽']
  ]) for (const windowMinutes of [300, 10080]) {
    const f = fixture();
    f.state.quotaModel.items = [{ windowMinutes, remaining }, { windowMinutes: 300, remaining: 0 }];
    f.tick(0);
    const shown = f.tick(30000);
    assert.equal(shown.statusLabel, statusLabel, `raw balance ${remaining}, period ${windowMinutes}`);
    assert.equal(shown.remaining, Math.round(remaining));
    assert.equal(shown.expiresAt, 36000);
  }
});

test('live quota state changes without replaying the capsule or extending its display time', () => {
  const f = fixture(); f.tick(0);
  const first = f.tick(30000);
  for (const [remaining, statusLabel] of [[20, '偏低'], [10, '紧张'], [0, '已用尽'], [21, '']]) {
    f.state.quotaModel.items[0].remaining = remaining;
    const updated = f.tick(31000);
    assert.equal(updated.statusLabel, statusLabel);
    assert.equal(updated.id, first.id);
    assert.equal(updated.expiresAt, first.expiresAt);
  }
  assert.equal(f.tick(36000), null);
});

test('capsule stays inside negative-coordinate work area for both edges and all pet sizes', () => {
  const area = { x: -3008, y: -1692, width: 3008, height: 1692 };
  for (const size of [60, 80, 120, 180, 260]) for (const side of ['left', 'right']) for (const y of [area.y, -size]) for (const kind of ['text', 'quota']) {
    const pet = { x: side === 'left' ? area.x : -size, y, width: size, height: size };
    const b = edgeNoticeBounds(pet, area, side, kind);
    assert.equal(b.width, kind === 'quota' ? 284 : 244);
    assert.ok(b.x >= area.x && b.x + b.width <= 0 && b.y >= area.y && b.y + b.height <= 0);
    if (side === 'left') assert.ok(b.x >= pet.x + size / 2);
    else assert.ok(b.x + b.width <= pet.x + size / 2);
  }
});

test('quota capsule respects a work area smaller than the preferred dimensions', () => {
  const area = { x: -80, y: -40, width: 200, height: 30 };
  for (const side of ['left', 'right']) {
    assert.deepEqual(edgeNoticeBounds({ x: -80, y: -40, width: 80, height: 80 }, area, side, 'quota'),
      { x: -80, y: -40, width: 200, height: 30 });
  }
});

function enableZcode(f) {
  f.state.zcodeQuotaEnabled = true;
  f.state.zcodeQuotaModel = { sourceId: 'zcode', state: 'ready', items: [
    { id: 'zcode:actual:bucket', bucketId: 'zcode:actual:bucket', model: 'GLM-5.3-Flash', remaining: 64.4, periodKind: 'one_time', windowMinutes: 2195.35 }
  ] };
}
test('fresh providers alternate within the existing quota schedule and shared cooldown', () => {
  const f = fixture(); f.state.bubblesEnabled = false; enableZcode(f);
  f.tick(0); assert.equal(f.tick(30000).sourceId, 'codex');
  f.tick(36000); assert.equal(f.tick(120000), null, 'ZCode adds no extra quota opportunity');
  const zcode = f.tick(330000); assert.equal(zcode.sourceId, 'zcode');
  assert.equal(zcode.period, '5.3 Flash'); assert.equal(zcode.model, 'GLM-5.3-Flash');
  assert.equal(zcode.remaining, 64); assert.equal(zcode.bucketId, 'zcode:actual:bucket');
  f.state.zcodeQuotaModel.items[0].remaining = 20;
  const updated = f.tick(331000); assert.equal(updated.id, zcode.id); assert.equal(updated.statusLabel, '偏低');
  assert.equal(updated.expiresAt, zcode.expiresAt);
  f.tick(336000); assert.equal(f.tick(630000).sourceId, 'codex');
});
test('ZCode alone uses true bucket percentages without requiring a Codex period', () => {
  const f = fixture(); f.state.quotaEnabled = false; f.state.bubblesEnabled = false; enableZcode(f);
  f.state.zcodeQuotaModel.items[0].remaining = 0;
  f.tick(0); const shown = f.tick(30000);
  assert.equal(shown.sourceId, 'zcode'); assert.equal(shown.remaining, 0); assert.equal(shown.statusLabel, '已用尽');
  assert.doesNotMatch(JSON.stringify(shown), /积分/);
});
test('disabled, stale, removed or invalid ZCode buckets cancel their active notice and never reuse its balance', () => {
  for (const mutate of [
    s => { s.zcodeQuotaEnabled = false; }, s => { s.zcodeQuotaModel.state = 'stale'; },
    s => { s.zcodeQuotaModel.state = 'disabled'; }, s => { s.zcodeQuotaModel.items = []; },
    s => { s.zcodeQuotaModel.items = {}; },
    s => { s.zcodeQuotaModel.items[0].remaining = NaN; },
    s => { s.zcodeQuotaModel.items[0].id = s.zcodeQuotaModel.items[0].bucketId = 'zcode:replacement'; }
  ]) {
    const f = fixture(); f.state.bubblesEnabled = false; enableZcode(f);
    f.state.quotaEnabled = false; f.tick(0); assert.equal(f.tick(30000).sourceId, 'zcode');
    mutate(f.state); assert.equal(f.tick(30100), null);
  }
  for (const mutate of [s => { s.visible = false; }, s => { s.locked = true; }]) {
    const f = fixture(); enableZcode(f); f.state.quotaEnabled = false; f.tick(0); f.tick(30000);
    mutate(f.state); assert.equal(f.tick(30100), null); assert.equal(f.tick(900000), null);
  }
});
test('unavailable providers are skipped while the other keeps its existing schedule', () => {
  for (const invalid of ['codex', 'zcode']) {
    const f = fixture(); f.state.bubblesEnabled = false; enableZcode(f);
    (invalid === 'codex' ? f.state.quotaModel : f.state.zcodeQuotaModel).state = 'stale';
    f.tick(0); assert.equal(f.tick(30000).sourceId, invalid === 'codex' ? 'zcode' : 'codex');
    f.tick(36000); assert.equal(f.tick(330000).sourceId, invalid === 'codex' ? 'zcode' : 'codex');
  }
});

function workBuddyFixture() {
  let time = 0;
  const base = Date.parse('2026-10-25T00:00:00+08:00'), changes = [];
  const state = { visible: true, presentation: { mode: 'tucked', side: 'left' }, workbuddyEnabled: true,
    bubblesEnabled: false, quotaEnabled: false, workbuddyState: { enabled: true, busy: false, stale: false, error: null,
      report: { total: 7399.91, updatedAt: base, expires: [{ amount: 99.91, at: Date.parse('2026-10-28T12:05:57+08:00') }] } } };
  const notice = createEdgeNotice({ now: () => time, wallNow: () => base + time, random: () => 0, onChange: value => changes.push(value) });
  return { state, changes, notice, tick(value) { time = value; notice.tick(state); return changes.at(-1); },
    refresh(value) { state.workbuddyState.report.updatedAt = base + value; } };
}
test('WorkBuddy uses the quota slot, exact credits and expiry without requiring Codex or a new timer', () => {
  const f = workBuddyFixture(); f.tick(0);
  const balance = f.tick(30000); assert.equal(balance.kind, 'workbuddy'); assert.equal(balance.text, '还剩7,399.91积分');
  assert.equal(balance.remaining, undefined); assert.equal(balance.statusLabel, undefined);
  assert.equal(f.tick(36000), null); f.refresh(330000);
  const expiry = f.tick(330000); assert.equal(expiry.kind, 'workbuddy'); assert.equal(expiry.text, '99.91积分将于10/28到期');
  f.state.workbuddyEnabled = false; assert.equal(f.tick(330001), null);
});
test('Codex and WorkBuddy rotate in the existing quota slot and share the text cooldown', () => {
  const f = workBuddyFixture(); f.state.quotaEnabled = true; f.state.bubblesEnabled = true;
  f.state.quotaModel = { state: 'ready', items: [{ windowMinutes: 300, remaining: 83 }] };
  f.tick(0); assert.equal(f.tick(30000).kind, 'quota'); f.tick(36000);
  assert.equal(f.tick(120000).kind, 'text'); f.tick(124500);
  assert.equal(f.tick(300000).kind, 'text'); f.tick(304500);
  f.refresh(390000); assert.equal(f.tick(390000).kind, 'workbuddy'); f.tick(396000);
  f.state.bubblesEnabled = false; f.refresh(690000); assert.equal(f.tick(690000).kind, 'quota');
});
test('WorkBuddy rejects busy, stale, error, missing, future and expired snapshots on every sample', () => {
  for (const mutate of [s => { s.busy = true; }, s => { s.stale = true; }, s => { s.error = 'failed'; },
    s => { s.enabled = false; }, s => { s.report = null; }, s => { s.report.total = NaN; },
    s => { s.report.updatedAt = Date.parse('2027-01-01'); }, s => { s.report.updatedAt -= 11 * 60000; }]) {
    const f = workBuddyFixture(); f.tick(0); assert.equal(f.tick(30000).kind, 'workbuddy');
    mutate(f.state.workbuddyState); assert.equal(f.tick(31000), null); assert.equal(f.tick(900000), null);
  }
  const f = workBuddyFixture(); f.state.workbuddyState.report.total = 0; f.tick(0);
  assert.equal(f.tick(30000).text, '还剩0积分');
});
test('WorkBuddy wider amount capsules remain inside small and negative-coordinate work areas', () => {
  for (const area of [{ x: -3008, y: -1692, width: 3008, height: 1692 }, { x: -80, y: -40, width: 200, height: 30 }]) {
    for (const side of ['left', 'right']) {
      const result = edgeNoticeBounds({ x: area.x, y: area.y, width: 80, height: 80 }, area, side, 'workbuddy');
      assert.equal(result.width, Math.min(360, area.width));
      assert(result.x >= area.x && result.x + result.width <= area.x + area.width);
      assert(result.y >= area.y && result.y + result.height <= area.y + area.height);
    }
  }
});

test('WorkBuddy同一时刻到期的积分批次合并提醒', () => {
 const f=workBuddyFixture();const at=f.state.workbuddyState.report.expires[0].at;
 f.state.workbuddyState.report.expires.push({at,amount:50});f.tick(0);f.tick(30000);f.tick(36000);f.refresh(330000);
 assert.equal(f.tick(330000).text,'149.91积分将于10/28到期');
});


test('Codex, ZCode and WorkBuddy round-robin one quota slot without increasing frequency', () => {
  const f = workBuddyFixture(); enableZcode(f);
  f.state.quotaEnabled = true;
  f.state.quotaModel = { state: 'ready', items: [{ remaining: 50, windowMinutes: 300 }] };
  f.tick(0);
  assert.equal(f.tick(30000).sourceId, 'codex');
  f.tick(36000); assert.equal(f.tick(120000), null);
  f.refresh(330000); assert.equal(f.tick(330000).sourceId, 'zcode');
  f.tick(336000); assert.equal(f.tick(420000), null);
  f.refresh(630000); assert.equal(f.tick(630000).sourceId, 'workbuddy');
  f.tick(636000); f.refresh(930000); assert.equal(f.tick(930000).sourceId, 'codex');
});
