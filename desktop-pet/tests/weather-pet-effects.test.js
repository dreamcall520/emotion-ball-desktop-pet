const test = require('node:test');
const assert = require('node:assert/strict');
const { describe, pollutionLevel, MAX_AGE } = require('../lib/weather-pet-effects');
const now = Date.now();
const weather = (weatherCode, extra = {}) => ({ updatedAt: now, current: { weatherCode, isDay: true, ...extra } });

test('weather ornaments distinguish fog, rain, snow, wind and night', () => {
  assert.equal(describe(weather(45), now).kind, 'fog');
  assert.equal(describe(weather(61), now).kind, 'rain');
  assert.equal(describe(weather(71), now).kind, 'snow');
  assert.equal(describe(weather(2, { windSpeed: 30 }), now).kind, 'wind');
  assert.equal(describe(weather(0, { isDay: false }), now).kind, 'night');
  assert.equal(describe(weather(2), now).kind, 'sun');
});

test('pollution uses declared AQI standard and does not infer pollution from fog', () => {
  assert.equal(pollutionLevel({ aqi: 70, standard: 'european' }), 1);
  assert.equal(pollutionLevel({ aqi: 90, standard: 'european' }), 2);
  assert.equal(pollutionLevel({ aqi: 110, standard: 'european' }), 3);
  assert.equal(pollutionLevel({ aqi: 70, standard: 'us' }), 0);
  assert.equal(pollutionLevel({ aqi: 101, standard: 'cn' }), 1);
  assert.equal(pollutionLevel({ aqi: 151, standard: 'us' }), 2);
  assert.equal(pollutionLevel({ aqi: 201, standard: 'cn' }), 3);
  assert.equal(pollutionLevel({ aqi: 400, standard: 'unknown' }), 0);
  assert.equal(pollutionLevel({ aqi: null, standard: 'cn' }), 0);
  assert.equal(describe(weather(45), now).pollution, 0);
});

test('stale, missing and future weather never affect the cloud', () => {
  for (const packet of [null, {}, { ...weather(61), updatedAt: now - MAX_AGE - 1 },
    { ...weather(61), updatedAt: now + 120000 }]) assert.deepEqual(describe(packet, now), { kind: 'none', pollution: 0 });
  assert.equal(describe({ ...weather(61), updatedAt: new Date(now).toISOString() }, now).kind, 'rain');
});

test('disabled weather never affects the cloud, even with fresh pollution data', () => {
  assert.deepEqual(describe({ ...weather(61), enabled: false, airQuality: { aqi: 200, standard: 'us' } }, now), { kind: 'none', pollution: 0 });
});

test('ornaments yield to motion, sleep, edge presentation and other shapes', () => {
  const { ornamentsAllowed } = require('../lib/weather-pet-effects');
  const idle = { shape: 'cloud', visible: true };
  assert.equal(ornamentsAllowed(idle), true);
  for (const state of [{ ...idle, sleeping: true }, { ...idle, busy: true }, { ...idle, atEdge: true },
    { ...idle, visible: false }, { ...idle, shape: 'aurora-cloud' }]) assert.equal(ornamentsAllowed(state), false);
});

test('small eye shadows stay below the white eyes even while blinking', () => {
  const { eyeShadow } = require('../lib/weather-pet-effects');
  const bounds = { left: 0, top: 0, width: 120, height: 120 };
  const open = { left: 45, top: 42, width: 7, height: 18 };
  const blink = { left: 45, top: 49, width: 7, height: 4 };
  const a = eyeShadow(open, bounds, 18), b = eyeShadow(blink, bounds, 18);
  assert(a.top > (open.top + open.height) / 120 * 100);
  assert.equal(a.top, b.top);
  assert(a.height < open.height / 120 * 100 * .2);
  assert(a.width < open.width / 120 * 100 * 1.3);
  assert.equal(eyeShadow(null, bounds, 18), null);
});

test('active precipitation cancels immediately when an existing pet action takes priority', () => {
  const { create } = require('../lib/weather-pet-effects');
  let frame = null, cancelled = 0, context = { shape: 'cloud', visible: true };
  const view = { requestAnimationFrame(callback) { frame = callback; return 1; }, cancelAnimationFrame() { frame = null; } };
  const document = { defaultView: view, createElement() { return { style: {}, dataset: {}, children: [],
    setAttribute() {}, appendChild(child) { child.parentElement = this; this.children.push(child); this.firstChild = this.children[0]; },
    animate() { return { cancel() { cancelled++; } }; }, remove() {} }; } };
  const target = document.createElement();
  target.ownerDocument = document;
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120 });
  target.querySelector = () => null;
  target.querySelectorAll = () => [];
  const effects = create(target, () => context);
  try {
    effects.update(weather(61));
    assert(frame);
    assert.equal(target.children[0].hidden, false);
    assert.equal(target.children[0].children.at(-1).children.length, 4);
    context = { ...context, busy: true };
    const callback = frame; frame = null; callback();
    assert.equal(target.children[0].hidden, true);
    assert.equal(cancelled, 4);
    assert.equal(frame, null);
    context = { ...context, busy: false, reducedMotion: true };
    effects.sync();
    assert.equal(target.children[0].hidden, true);
  } finally { effects.destroy(); }
});


test('weather particle choreography is bounded, visible and scales with real pet size', () => {
  const { ornamentMotion } = require('../lib/weather-pet-effects');
  for (const kind of ['rain', 'snow', 'sun', 'night']) {
    for (let i = 0; i < (['rain', 'snow'].includes(kind) ? 4 : 2); i++) {
      const motion = ornamentMotion(kind, i, 120);
      assert.equal(motion.options.iterations, kind === 'rain' ? 3 : kind === 'snow' ? 2 : 1);
      assert(motion.options.iterations * motion.options.duration + motion.options.delay <= (['rain', 'snow'].includes(kind) ? 7600 : 4400));
      assert.equal(motion.keyframes[0].opacity, 0);
      assert.equal(motion.keyframes.at(-1).opacity, 0);
      assert(motion.keyframes.every(frame => Number.isFinite(frame.opacity) && frame.opacity <= .95));
    }
  }
  assert.notEqual(ornamentMotion('snow', 0, 120).keyframes.at(-1).transform,
    ornamentMotion('snow', 0, 260).keyframes.at(-1).transform);
  assert.equal(ornamentMotion('sun', 2), null);
  assert.equal(ornamentMotion('wind', 0), null);
  assert.equal(ornamentMotion('fog', 0), null);
});


test('four rain and snow particles remain within the short burst and fade to transparent', () => {
  const { ornamentMotion } = require('../lib/weather-pet-effects');
  const starts = { rain: [71, 76, 74, 70], snow: [25, 19, 42, 48] };
  for (const kind of ['rain', 'snow']) {
    for (const size of [60, 80, 120, 260]) {
      for (let i = 0; i < 4; i++) {
        const motion = ornamentMotion(kind, i, size);
        assert(motion);
        assert(motion.keyframes.some(frame => frame.opacity >= .9));
        const final = motion.keyframes.at(-1);
        assert.equal(final.opacity, 0);
        assert(motion.options.iterations * motion.options.duration + motion.options.delay <= 7600);
        const fall = Number(final.transform.match(/translate\([^,]+, ([0-9.]+)px\)/)[1]);
        const particleHeight = kind === 'rain' ? Math.max(6, size * .068) : Math.max(8, size * .055);
        assert(starts[kind][i] / 100 * size + fall + particleHeight <= size, `${kind} ${size}px particle ${i} clipped`);
      }
    }
    assert.equal(ornamentMotion(kind, 4), null);
  }
});
