const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../home.js'), 'utf8');

function page({ webgl = true, reduced = false, theme = 'light' } = {}) {
  const frames = new Map(), pending = [], draws = [], stored = {};
  let sequence = 0, textureImage, night;
  function element() {
    const events = {}, attributes = {};
    const icon = { setAttribute: (key, value) => { attributes[key] = value; } };
    return { events, attributes, dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener: (name, fn) => { events[name] = fn; },
      setAttribute: (key, value) => { attributes[key] = value; },
      querySelector: () => icon,
      getBoundingClientRect: () => ({ width: 1672, height: 941, left: 0, top: 0 }) };
  }
  const root = element(), motion = element(), button = element(), canvas = element();
  if (theme !== 'auto') root.dataset.theme = theme;
  const system = { matches: false, addEventListener: (_, fn) => { system.change = fn; } };
  const reduce = { matches: reduced, addEventListener() {} };
  function pictureImage(src, ready = true) {
    const item = element();
    let url = src, resolve, reject;
    const decoded = new Promise((yes, no) => { resolve = yes; reject = no; });
    Object.assign(item, { complete: ready, naturalWidth: ready ? 1672 : 0, naturalHeight: ready ? 941 : 0,
      currentSrc: src, decode: () => decoded,
      cloneNode: () => { const next = pictureImage(url, false); pending.push(next); return next; },
      replaceWith: next => { image = next; },
      finish: (ok = true) => { item.complete = true; item.naturalWidth = ok ? 1672 : 0;
        item.naturalHeight = ok ? 941 : 0; if (ok) resolve(); else reject(new Error('image unavailable')); } });
    Object.defineProperty(item, 'src', { get: () => url, set: value => { url = value; item.currentSrc = value; } });
    return item;
  }
  let image = pictureImage('assets/hero-silver-v2.webp');
  if (theme === 'dark') image.currentSrc = 'assets/hero-night-v2.webp';
  const dark = { srcset: 'assets/hero-night-v2.webp', media: 'not all' }, meta = {};
  const nodes = { '[data-motion-control]': motion, '[data-theme-control]': button,
    '[data-pet-touch]': element(), '[data-pet-reply]': element(), '.scene-material': canvas,
    '.scene-dark-source': dark, 'meta[name="theme-color"]': meta,
    '#license-dialog': element(), '[data-license-open]': element(), '.home-main': element() };
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_, name) => name,
    texImage2D: (...args) => { textureImage = args.at(-1); },
    uniform1f: (key, value) => { if (key === 'night') night = value; },
    drawArrays: () => { draws.push({ image: textureImage, night, theme: root.dataset.theme }); },
  }, { get: (target, key) => key in target ? target[key] : () => ({}) });
  canvas.parentElement = element(); canvas.getContext = () => webgl ? gl : null;
  const document = { documentElement: root, hidden: false,
    querySelector: name => name === '.scene-image' ? image : nodes[name],
    querySelectorAll: name => name === '.scene-dark-source' ? [dark] : [], addEventListener() {} };
  vm.runInNewContext(source, { document, window: { addEventListener() {} },
    location: { hash: '', search: '', replace() {} },
    matchMedia: value => value.includes('color-scheme') ? system : value.includes('reduced-motion') ? reduce : { matches: true },
    localStorage: { setItem: (key, value) => { stored[key] = value; } },
    getComputedStyle: () => ({ objectPosition: '50% 50%', getPropertyValue: () => root.dataset.theme === 'dark' ? '#0d172a' : '#f5f6f9' }),
    requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { observe() {} }, devicePixelRatio: 1, setTimeout, clearTimeout, Math });
  return { root, button, motion, canvas, pending, draws, stored, system, meta,
    image: () => image, click: () => button.events.click(),
    frame: () => { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn(100)); } };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('theme, decoded background and texture commit together without a white button transition', async () => {
  for (const options of [{}, { webgl: false }, { reduced: true }, { paused: true }]) {
    const state = page(options);
    if (options.paused) state.motion.events.click();
    const original = state.image(), originalOpacity = state.canvas.style.opacity;
    state.click(); // light -> dark, with the night image deliberately held in decoding.
    assert.equal(state.root.dataset.theme, 'light', 'keep the complete old theme while decoding');
    assert.equal(state.image(), original);
    assert.equal(state.canvas.style.opacity, originalOpacity);
    state.frame();
    assert.ok(state.draws.every(draw => draw.image.currentSrc.endsWith('silver-v2.webp') && draw.night === 0));
    state.pending.at(-1).finish(); await settle();
    assert.equal(state.root.dataset.theme, 'dark');
    assert.match(state.image().currentSrc, /hero-night-v2.webp$/);
    assert.equal(state.meta.content, '#0d172a');
    assert.equal(state.stored['emotion-ball-site-theme'], 'dark');
    assert.ok(state.draws.filter(draw => draw.theme === 'dark').every(draw => draw.image === state.image() && draw.night === 1));
    if (options.paused) assert.equal(state.canvas.dataset.state, 'paused');
    if (options.reduced) assert.equal(state.canvas.style.opacity, '0');
  }
  const rapid = page();
  rapid.click(); const stale = rapid.pending.at(-1);
  rapid.click(); // dark request -> auto/light before night finishes.
  stale.finish(); await settle();
  assert.equal(rapid.root.dataset.theme, 'light');
  assert.equal(rapid.button.dataset.choice, 'auto');
  assert.match(rapid.image().currentSrc, /hero-silver-v2.webp$/);

  const auto = page({ theme: 'auto' });
  auto.system.matches = true; auto.system.change();
  assert.equal(auto.root.dataset.theme, 'light');
  auto.pending.at(-1).finish(); await settle();
  assert.equal(auto.root.dataset.theme, 'dark');
  assert.equal(auto.button.dataset.choice, 'auto');
  assert.equal(auto.stored['emotion-ball-site-theme'], 'auto');

  const savedDark = page({ theme: 'dark' }), originalDark = savedDark.image();
  assert.equal(savedDark.root.dataset.theme, 'dark');
  assert.ok(savedDark.draws.every(draw => draw.image === originalDark && draw.night === 1));
  savedDark.click(); // dark -> auto/light uses the same decoding boundary.
  assert.equal(savedDark.root.dataset.theme, 'dark');
  savedDark.pending.at(-1).finish(); await settle();
  assert.equal(savedDark.root.dataset.theme, 'light');
  assert.match(savedDark.image().currentSrc, /hero-silver-v2.webp$/);
  assert.ok(savedDark.draws.filter(draw => draw.theme === 'light').every(draw => draw.image === savedDark.image() && draw.night === 0));

  const fixedLight = page(); fixedLight.system.matches = true; fixedLight.system.change();
  assert.equal(fixedLight.root.dataset.theme, 'light');
  assert.equal(fixedLight.pending.length, 0, 'system changes do not override a manual selection');

  const failed = page(); failed.click(); failed.pending.at(-1).finish(false); await settle();
  assert.equal(failed.root.dataset.theme, 'dark');
  assert.equal(failed.root.dataset.sceneState, 'fallback');
  assert.equal(failed.canvas.style.opacity, '0');
  assert.ok(failed.draws.every(draw => draw.theme !== 'dark'), 'never draw the old light texture after a failed dark image');

  const css = fs.readFileSync(path.join(__dirname, '../home.css'), 'utf8');
  const buttonRule = css.match(/\.download-button \{([^}]+)\}/)[1];
  assert.doesNotMatch(buttonRule.match(/transition:([^;]+)/)[1], /background/);
});
