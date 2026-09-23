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
