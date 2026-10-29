const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocationBridge } = require('../lib/weather-location');
const binding = overrides => ({ status: () => ({ status: 'not-determined', servicesEnabled: true }),
  locate: async () => ({ latitude: 40, longitude: 116, accuracy: 1000 }), ...overrides });

test('native status is read without requesting location', () => {
  let requests = 0;
  const bridge = createLocationBridge({ platform: 'darwin', native: binding({ locate: () => { requests++; } }) });
  assert.deepEqual(bridge.status(), { status: 'not-determined', servicesEnabled: true });
  assert.equal(requests, 0);
});
test('in-process location requests are deduplicated and return only validated coordinates', async () => {
  let requests = 0, resolve;
  const bridge = createLocationBridge({ platform: 'darwin', native: binding({ locate() { requests++; return new Promise(done => { resolve = done; }); } }) });
  const first = bridge.locate(), second = bridge.locate();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(requests, 1);
  resolve({ latitude: 0, longitude: 0, accuracy: 0, ignored: 'not exposed' });
  assert.deepEqual(await first, { latitude: 0, longitude: 0, accuracy: 0 });
  const third = bridge.locate(); await Promise.resolve();
  assert.equal(requests, 2); resolve({ latitude: -33.8, longitude: 151.2, accuracy: 200 }); await third;
});
test('unsupported platforms and missing bindings provide safe errors', async () => {
  const unsupported = createLocationBridge({ platform: 'linux', native: binding() });
  assert.throws(() => unsupported.status(), { code: 'LOCATION_UNSUPPORTED' });
  await assert.rejects(unsupported.locate(), { code: 'LOCATION_UNSUPPORTED' });
  await assert.rejects(createLocationBridge({ platform: 'darwin', native: null }).locate(), { code: 'LOCATION_NATIVE_UNAVAILABLE' });
});
test('native permission and timeout errors are explicit, unknown failures are sanitized', async () => {
  for (const code of ['LOCATION_DENIED', 'LOCATION_RESTRICTED', 'LOCATION_SERVICES_DISABLED', 'LOCATION_TIMEOUT']) {
    const bridge = createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => { throw Object.assign(new Error('native internal detail'), { code }); } }) });
    await assert.rejects(bridge.locate(), error => error.code === code && !error.message.includes('native internal detail'));
  }
  const bridge = createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => { throw new Error('private detail'); } }) });
  await assert.rejects(bridge.locate(), error => error.code === 'LOCATION_UNAVAILABLE' && !error.message.includes('private detail'));
});
test('invalid native payloads are rejected at the wrapper boundary', async () => {
  for (const invalid of [null, { latitude: NaN, longitude: 10, accuracy: 20 }, { latitude: 91, longitude: 10, accuracy: 20 },
    { latitude: 20, longitude: 181, accuracy: 20 }, { latitude: 20, longitude: 10, accuracy: -1 }]) {
    await assert.rejects(createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => invalid }) }).locate(), { code: 'LOCATION_UNAVAILABLE' });
  }
  assert.throws(() => createLocationBridge({ platform: 'darwin', native: binding({ status: () => ({ status: 'surprise' }) }) }).status(), { code: 'LOCATION_UNAVAILABLE' });
});

test('optional real city labels are validated without discarding valid coordinates', async () => {
  const coords = { latitude: 40, longitude: 116, accuracy: 1000 };
  const bridge = value => createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => ({ ...coords, ...value }) }) });
  assert.deepEqual(await bridge({ name: ' 北京市 ', locationLabel: '北京市 · 朝阳区' }).locate(),
    { ...coords, name: '北京市', locationLabel: '北京市 · 朝阳区' });
  assert.deepEqual(await bridge({ name: null, locationLabel: { invalid: true } }).locate(), coords);
  assert.deepEqual(await bridge({ name: 'x'.repeat(81), locationLabel: '' }).locate(), coords);
  assert.deepEqual(await bridge({ name: '北京\n市', locationLabel: '\0' }).locate(), { ...coords, name: '北京 市' });
});
