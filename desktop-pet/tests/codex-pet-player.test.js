const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../lib/codex-pet-player');

const descriptor = { id: 'imported-hash', name: '测试宠物', version: 1, rows: 9, imageURL: 'file:///tmp/test-sprite.webp' };
function harness() {
  let now = 0, sequence = 0;
  const requests = new Map(), images = [], draws = [], listeners = new Map(), changes = new Set();
  const media = { matches: false,
    addEventListener(_name, fn) { changes.add(fn); }, removeEventListener(_name, fn) { changes.delete(fn); } };
  const view = {
    requestAnimationFrame(fn) { const id = ++sequence; requests.set(id, fn); return id; },
    cancelAnimationFrame(id) { requests.delete(id); }, matchMedia: () => media,
    Image: class { constructor() { images.push(this); } }
  };
  const document = { defaultView: view, hidden: false,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    createElement() { return { width: 0, height: 0, style: {}, dataset: {}, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      getContext: () => ({ clearRect() {}, drawImage(...args) { draws.push(args); } }),
      remove() { container.children = container.children.filter(child => child !== this); } }; }
  };
  const container = { ownerDocument: document, children: [], appendChild(child) { this.children.push(child); } };
  return { container, document, media, requests, listeners, changes, images, draws,
    load(rows = 9) { const image = images.at(-1); image.naturalWidth = 1536; image.naturalHeight = rows * 208; image.onload?.(); },
    step(ms) { now += ms; const callbacks = [...requests.values()]; requests.clear(); callbacks.forEach(fn => fn(now)); },
    hidden(value) { document.hidden = value; listeners.get('visibilitychange')?.(); },
    reduce(value) { media.matches = value; changes.forEach(fn => fn()); }
  };
}

test('nine original actions crop their real rows, skip unused columns, and retain per-frame timing', () => {
  const h = harness(), player = Player.create(h.container, { descriptor, size: 120, opacity: 0.58 });
  assert.equal(player.element.dataset.codexReady, 'loading');
  assert.equal(h.requests.size, 0);
  h.load();
  assert.equal(player.element.style.height, '120px');
  assert.equal(parseFloat(player.element.style.width), 120 * 192 / 208);
  assert.equal(player.element.style.opacity, '0.58');
  assert.equal(player.element.attributes['aria-label'], '测试宠物');
  for (const action of Player.ACTIONS) {
    player.setAction(action.id); h.step(0);
    assert.equal(player.element.dataset.codexAction, action.id);
    for (let frame = 0; frame < action.frameDurations.length; frame++) {
      const crop = h.draws.at(-1).slice(1);
      assert.deepEqual(crop, [frame * 192, action.row * 208, 192, 208, 0, 0, 192, 208]);
      h.step(action.frameDurations[frame] - 1);
      assert.equal(Number(player.element.dataset.codexFrame), frame);
      h.step(1);
      assert.equal(Number(player.element.dataset.codexFrame), (frame + 1) % action.frameDurations.length);
    }
  }
  player.destroy(); assert.equal(h.requests.size, 0);
});

test('Codex idle takes 6.6 seconds while the wave retains its 700ms cycle', () => {
  const h = harness(), player = Player.create(h.container, { descriptor });
  h.load(); h.step(0);
  // At the old 1.1s loop boundary Codex must still hold the first idle pose.
  h.step(1100); assert.equal(player.element.dataset.codexFrame, '0');
  h.step(579); assert.equal(player.element.dataset.codexFrame, '0');
  h.step(1); assert.equal(player.element.dataset.codexFrame, '1');
  for (const [ms, frame] of [[660,2],[660,3],[840,4],[840,5],[1919,5],[1,0]]) {
    h.step(ms); assert.equal(Number(player.element.dataset.codexFrame), frame);
  }
  player.setAction('wave'); h.step(0);
  h.step(699); assert.equal(player.element.dataset.codexFrame, '3');
  h.step(1); assert.equal(player.element.dataset.codexFrame, '0');
  player.destroy();
});

test('pause, hidden, reduced motion and destroy cancel scheduling without restarting paused frames', () => {
  const h = harness(), player = Player.create(h.container, { descriptor });
  h.load(); h.step(0); h.step(1680);
  assert.equal(player.element.dataset.codexFrame, '1');
  player.setAction('idle');
  assert.equal(player.element.dataset.codexFrame, '1', 'repeated state updates do not restart the animation');
  player.pause(); assert.equal(h.requests.size, 0);
  h.step(50000); assert.equal(player.element.dataset.codexFrame, '1');
  player.pause(false); assert.equal(h.requests.size, 1);
  h.step(0); h.step(660); assert.equal(player.element.dataset.codexFrame, '2');
  h.hidden(true); assert.equal(h.requests.size, 0);
  h.hidden(false); assert.equal(h.requests.size, 1);
  h.reduce(true); assert.equal(h.requests.size, 0); assert.equal(player.element.dataset.codexFrame, '0');
  player.setAction('wave'); assert.equal(h.requests.size, 0);
  h.reduce(false); assert.equal(h.requests.size, 1);
  const lateLoad = h.images.at(-1).onload, count = h.draws.length;
  player.destroy(); lateLoad(); h.step(50000);
  assert.equal(h.draws.length, count); assert.equal(h.requests.size, 0);
  assert.equal(h.listeners.size, 0); assert.equal(h.changes.size, 0); assert.equal(h.container.children.length, 0);
});

test('descriptor and dimensions reject remote images, inconsistent versions and wrong grids; v2 reload works', () => {
  for (const change of [{ imageURL: 'https://example.com/sprite.webp' }, { imageURL: 'file://server/sprite.webp' },
    { version: 2, rows: 9 }, { rows: 100 }]) {
    assert.equal(Player.validDescriptor({ ...descriptor, ...change }), false);
    assert.throws(() => Player.create(harness().container, { descriptor: { ...descriptor, ...change } }), TypeError);
  }
  assert.equal(Player.validDescriptor({ ...descriptor, imageURL: 'data:image/png;base64,AA==' }), true);
  const h = harness(), failures = [];
  const player = Player.create(h.container, { descriptor, onError: error => failures.push(error) });
  h.load(11); assert.equal(failures.length, 1); assert.equal(h.requests.size, 0);
  assert.equal(player.element.dataset.codexReady, 'error');
  const oldLoad = h.images.at(-1).onload;
  player.setPet({ ...descriptor, id: 'second', version: 2, rows: 11 }); oldLoad();
  assert.equal(player.element.dataset.codexReady, 'loading', 'old image completion cannot replace the new sprite');
  h.load(11); assert.equal(player.element.dataset.codexReady, 'ready');
  assert.equal(player.setAction(8), true); assert.equal(player.element.dataset.codexAction, 'checking');
  assert.equal(player.setAction('unknown'), false); assert.equal(player.setSize(-1), false);
  assert.equal(player.setOpacity(2), false); player.destroy();
});
