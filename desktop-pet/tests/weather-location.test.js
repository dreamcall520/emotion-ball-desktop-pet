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

test('system no-fix errors retain only bounded non-location diagnostic evidence', async () => {
  const diagnostic = { locationAuthorization: 'granted', locationMainThread: true, locationStarted: true,
    locationCallbacks: 0, locationUnknownFailures: 1, locationSamplesRejected: 0,
    latitude: 39.9, longitude: 116.4, name: 'private city', ssid: 'private network', token: 'secret' };
  const native = binding({ locate: async () => { throw Object.assign(Error('private native detail'), { code: 'LOCATION_NO_FIX', diagnostic }); } });
  const bridge = createLocationBridge({ platform: 'darwin', native });
  await assert.rejects(bridge.locate(), error => {
    assert.equal(error.code, 'LOCATION_NO_FIX');
    assert.deepEqual(error.diagnostic, { locationAuthorization: 'granted', locationMainThread: true, locationStarted: true,
      locationCallbacks: 0, locationUnknownFailures: 1, locationSamplesRejected: 0 });
    assert.match(error.message, /系统暂时无法确定/);
    assert.doesNotMatch(JSON.stringify(error), /private|secret|latitude|longitude|ssid|token/);
    return true;
  });
});
test('malformed native diagnostic fields cannot enter a location error', async () => {
  const bridge = createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => {
    throw Object.assign(Error('private'), { code: 'LOCATION_TIMEOUT', diagnostic: { locationAuthorization: '/Users/private',
      locationMainThread: 'true', locationStarted: 1, locationCallbacks: -1, locationUnknownFailures: 1000001, locationSamplesRejected: NaN } });
  } }) });
  await assert.rejects(bridge.locate(), error => error.code === 'LOCATION_TIMEOUT' && error.diagnostic === undefined);
});

test('successful native requests emit one safe diagnostic event without exposing location data', async () => {
  const diagnostic = { locationAuthorization: 'granted', locationMainThread: true, locationStarted: true,
    locationAppActive: true, locationAuthorizationCallbacks: 2, locationPhase: 'geocode',
    locationElapsedMs: 15123, locationPhaseElapsedMs: 1200, locationCallbacks: 1,
    locationUnknownFailures: 0, locationSamplesRejected: 0 };
  const events = [], native = binding({ locate: async () => ({ latitude: 40, longitude: 116, accuracy: 100,
    diagnostic: { ...diagnostic, latitude: 40, city: 'private', ssid: 'private', ip: 'private', deviceId: 'private' } }) });
  const bridge = createLocationBridge({ platform: 'darwin', native, onDiagnostic: event => events.push(event) });
  const [first, second] = await Promise.all([bridge.locate(), bridge.locate()]);
  assert.deepEqual(first.diagnostic, diagnostic); assert.deepEqual(second, first);
  assert.deepEqual(events, [{ outcome: 'success', diagnostic }]);
  assert.doesNotMatch(JSON.stringify(events), /latitude|longitude|private|city|ssid|deviceId|ip/);
});

test('failure phase and monotonic durations survive filtering and a diagnostic observer cannot affect outcomes', async () => {
  const diagnostic = { locationAppActive: false, locationAuthorizationCallbacks: 0,
    locationPhase: 'authorization', locationElapsedMs: 120034, locationPhaseElapsedMs: 120034 };
  let calls = 0;
  const onDiagnostic = event => { calls++; event.diagnostic.locationPhase = 'private'; throw Error('observer unavailable'); };
  const failed = createLocationBridge({ platform: 'darwin', onDiagnostic, native: binding({ locate: async () => {
    throw Object.assign(Error('private native data'), { code: 'LOCATION_TIMEOUT', diagnostic });
  } }) });
  await assert.rejects(failed.locate(), error => {
    assert.equal(error.code, 'LOCATION_TIMEOUT'); assert.deepEqual(error.diagnostic, diagnostic); return true;
  });
  assert.equal(calls, 1);
  const success = createLocationBridge({ platform: 'darwin', onDiagnostic,
    native: binding({ locate: async () => ({ latitude: 0, longitude: 0, accuracy: 1, diagnostic }) }) });
  assert.deepEqual(await success.locate(), { latitude: 0, longitude: 0, accuracy: 1, diagnostic });
  assert.equal(calls, 2);
});

test('native diagnostic extensions reject malformed phases, booleans, callback counts and durations', async () => {
  const diagnostic = { locationAppActive: 1, locationAuthorizationCallbacks: 1000001,
    locationPhase: 'private', locationElapsedMs: Infinity, locationPhaseElapsedMs: -1 };
  const events = [];
  const bridge = createLocationBridge({ platform: 'darwin', onDiagnostic: event => events.push(event),
    native: binding({ locate: async () => ({ latitude: 0, longitude: 0, accuracy: 1, diagnostic }) }) });
  assert.deepEqual(await bridge.locate(), { latitude: 0, longitude: 0, accuracy: 1 });
  assert.deepEqual(events, [{ outcome: 'success', diagnostic: {} }]);
  for (const locationElapsedMs of [NaN, -1, 1.5, 3600001, '15000']) {
    const rejected = createLocationBridge({ platform: 'darwin', native: binding({ locate: async () => {
      throw Object.assign(Error('native'), { code: 'LOCATION_TIMEOUT', diagnostic: { locationElapsedMs } });
    } }) });
    await assert.rejects(rejected.locate(), error => error.diagnostic === undefined);
  }
});

test('native phase instrumentation uses a monotonic clock and keeps the original location deadlines', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../native/weather-location.mm'), 'utf8');
  assert.match(source, /std::chrono::steady_clock/);
  for (const [name, seconds] of [['kAuthorizationTimeout', '120.0'], ['kRequestTimeout', '15.0'], ['kGeocodeTimeout', '1.2']]) {
    assert(source.includes(`static const NSTimeInterval ${name} = ${seconds};`));
  }
  assert.match(source, /NSApp\.isActive/);
  assert(source.includes('"locationAuthorizationCallbacks"'));
  for (const phase of ['authorization', 'acquisition', 'geocode']) assert(source.includes(`SetDiagnosticPhase("${phase}")`));
  assert(source.includes('napi_set_named_property(env, value, "diagnostic", DiagnosticValue(env, result->diagnostic))'));
  assert.equal((source.match(/if \(self.completed \|\| manager != self.manager\) return;/g) || []).length, 4, 'late or foreign delegate callbacks cannot change the current diagnostic');
});

test('native build explicitly links AppKit for its read-only application activation probe', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const calls = [], module = { exports: {} }, include = '/synthetic-node-headers';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/build-weather-location.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '../scripts'), process: { platform: 'darwin', arch: 'arm64', execPath: '/synthetic/node', env: { WEATHER_NODE_INCLUDE: include } },
    require(name) {
      if (name === 'node:fs') return { existsSync: file => file === path.join(include, 'node_api.h'), renameSync() {} };
      if (name === 'node:child_process') return { execFileSync: (compiler, args) => calls.push({ compiler, args }) };
      return require(name);
    }
  });
  module.exports.buildWeatherLocation('/synthetic/source');
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  for (const framework of ['Foundation', 'CoreLocation', 'AppKit']) {
    assert(args.some((arg, index) => arg === '-framework' && args[index + 1] === framework));
  }
});

test('cancelling before the native microtask never starts location and allows an immediate new owner', async () => {
  let calls = 0;
  const events = [];
  const bridge = createLocationBridge({ platform: 'darwin', onDiagnostic: event => events.push(event),
    native: binding({ locate: async () => { calls++; return { latitude: 0, longitude: 0, accuracy: 1 }; } }) });
  assert.equal(typeof bridge.cancel, 'function', 'the owner needs a real cancellation entry point');
  const old = bridge.locate();
  const cancelled = assert.rejects(old, { code: 'CANCELLED' });
  assert.equal(bridge.cancel(), true);
  const fresh = bridge.locate();
  await cancelled;
  assert.equal((await fresh).accuracy, 1);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.outcome), ['cancelled', 'success']);
  assert.equal(bridge.cancel(), false);
});

test('native cancellation uses the old promise token and its late finally cannot clear the fresh owner', async () => {
  const requests = [], events = [];
  const native = binding({
    locate() {
      let reject;
      const promise = new Promise((_, fail) => { reject = fail; });
      requests.push({ promise, reject }); return promise;
    },
    cancel(promise) {
      assert.equal(promise, requests[0].promise);
      requests[0].reject(Object.assign(Error('cancelled'), { code: 'CANCELLED',
        diagnostic: { locationPhase: 'acquisition', locationElapsedMs: 10000 } }));
      return true;
    }
  });
  const bridge = createLocationBridge({ platform: 'darwin', native, onDiagnostic: event => events.push(event) });
  assert.equal(typeof bridge.cancel, 'function');
  const old = bridge.locate(); await Promise.resolve();
  const cancelled = assert.rejects(old, { code: 'CANCELLED' });
  assert.equal(bridge.cancel(), true);
  const fresh = bridge.locate(); await Promise.resolve(); await cancelled;
  assert.equal(bridge.locate(), fresh, 'old completion must not clear the new pending request');
  assert.equal(requests.length, 2);
  requests[1].reject(Object.assign(Error('deadline'), { code: 'LOCATION_TIMEOUT' }));
  await assert.rejects(fresh, { code: 'LOCATION_TIMEOUT' });
  assert.deepEqual(events.map(event => event.outcome), ['cancelled', 'failure']);
  assert.equal(events[0].diagnostic.locationPhase, 'acquisition');
});

test('failed native cancellation keeps the original owner instead of risking LOCATION_BUSY', async () => {
  for (const failure of [false, Error('cancel unavailable')]) {
    let resolve;
    const bridge = createLocationBridge({ platform: 'darwin', native: binding({
      locate: () => new Promise(done => { resolve = done; }),
      cancel() { if (failure) throw failure; return false; }
    }) });
    assert.equal(typeof bridge.cancel, 'function');
    const original = bridge.locate(); await Promise.resolve();
    assert.equal(bridge.cancel(), false);
    assert.equal(bridge.locate(), original);
    resolve({ latitude: 0, longitude: 0, accuracy: 1 }); await original;
  }
});

test('native-finished but JS-unsettled requests can retire before a fresh attempt', async () => {
  const queued = [];
  let calls = 0;
  const bridge = createLocationBridge({ platform: 'darwin', native: binding({
    locate() { calls++; return new Promise((_, reject) => queued.push(() => reject(Object.assign(Error('old deadline'), { code: 'LOCATION_TIMEOUT' })))); },
    cancel() { return true; } // Native already retired its manager; only TSFN settlement remains.
  }) });
  const old = bridge.locate(); await Promise.resolve();
  const oldDone = assert.rejects(old, { code: 'CANCELLED' });
  assert.equal(bridge.cancel(), true);
  const fresh = bridge.locate(); await Promise.resolve();
  assert.notEqual(fresh, old); assert.equal(calls, 2);
  queued[0](); await oldDone;
  assert.equal(bridge.locate(), fresh);
  queued[1](); await assert.rejects(fresh, { code: 'LOCATION_TIMEOUT' });
});
