const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWeatherDiagnostic, normalizeDiagnostic: generalDiagnostic } = require('../lib/error-diagnostics');
const normalizeDiagnostic = normalizeWeatherDiagnostic || generalDiagnostic;

test('weather diagnostics keep only finite stage/status and native location facts', () => {
  const result = normalizeDiagnostic('天气', { code: 'LOCATION_NO_FIX', message: 'private', stack: 'private' }, {
    stage: 'weather-location', httpStatus: 503, locationAuthorization: 'granted', locationMainThread: true,
    locationStarted: true, locationCallbacks: 0, locationUnknownFailures: 1, locationSamplesRejected: 0,
    latitude: 12.34567, longitude: 23.45678, city: 'private-city', response: 'private-response', source: '/private/path', userId: 'private-id'
  });
  assert.deepEqual(result, { code: 'LOCATION_NO_FIX', context: { stage: 'weather-location', httpStatus: 503,
    locationAuthorization: 'granted', locationMainThread: true, locationStarted: true, locationCallbacks: 0,
    locationUnknownFailures: 1, locationSamplesRejected: 0 } });
  assert.doesNotMatch(JSON.stringify(result), /private|latitude|longitude/);
});

test('weather diagnostics reject malformed values, unknown codes and property getters', () => {
  const context = { stage: 'private-stage', httpStatus: 600, locationAuthorization: 'private-auth', locationMainThread: 1,
    locationStarted: 'true', locationCallbacks: -1, locationUnknownFailures: 1.5, locationSamplesRejected: 1000001 };
  Object.defineProperty(context, 'latitude', { get() { assert.fail('unknown property getter must not run'); } });
  const error = {}; Object.defineProperty(error, 'code', { get() { assert.fail('code getter must not run'); } });
  assert.deepEqual(normalizeDiagnostic('天气', error, context), { context: {} });
  assert.deepEqual(normalizeDiagnostic('天气', { code: 'PRIVATE_CODE' }, {}), { context: {} });
  assert.deepEqual(normalizeDiagnostic('天气', null, null), { context: {} });
});

test('weather fields never expand diagnostics for other modules', () => {
  assert.deepEqual(normalizeDiagnostic('聊天面板', { code: 'TIMEOUT' }, { stage: 'weather-refresh', httpStatus: 503 }), { context: {} });
});

test('native phase diagnostics retain only fixed phases and bounded monotonic timings', () => {
  const context = { stage: 'weather-location', locationAppActive: false, locationAuthorizationCallbacks: 2,
    locationPhase: 'acquisition', locationElapsedMs: 15123, locationPhaseElapsedMs: 15001,
    city: 'private-city', url: 'https://private.invalid/', requestId: 'private-id' };
  assert.deepEqual(normalizeDiagnostic('天气', { code: 'LOCATION_NO_FIX' }, context), {
    code: 'LOCATION_NO_FIX', context: { stage: 'weather-location', locationAppActive: false,
      locationAuthorizationCallbacks: 2, locationPhase: 'acquisition', locationElapsedMs: 15123, locationPhaseElapsedMs: 15001 }
  });
  for (const phase of ['authorization', 'acquisition', 'geocode']) assert.equal(normalizeDiagnostic('天气', {}, { locationPhase: phase }).context.locationPhase, phase);
  assert.deepEqual(normalizeDiagnostic('天气', {}, { locationPhase: 'private-phase', locationAppActive: 'true',
    locationAuthorizationCallbacks: 1000001, locationElapsedMs: Infinity, locationPhaseElapsedMs: -1 }), { context: {} });
  assert.deepEqual(normalizeDiagnostic('天气', {}, { locationElapsedMs: 3600001, locationPhaseElapsedMs: 1.1 }), { context: {} });
});

test('weather recovery and request diagnostics retain safe tokens and reject malformed or private fields', () => {
  const safe = { locationRecoveryAttempted: true, locationRecoveryAfterMs: 3001,
    weatherSelectionMode: 'manual', weatherRequestPhase: 'body', weatherTransportCode: 'ECONNRESET',
    weatherAttempts: 2, weatherElapsedMs: 16001 };
  assert.deepEqual(normalizeDiagnostic('天气', { code: 'TIMEOUT' }, { ...safe,
    latitude: 12, city: 'private', url: 'https://private.invalid/' }), { code: 'TIMEOUT', context: safe });
  assert.deepEqual(normalizeDiagnostic('天气', {}, { locationRecoveryAttempted: 'true', locationRecoveryAfterMs: -1,
    weatherSelectionMode: 'private', weatherRequestPhase: 'private', weatherTransportCode: 'private',
    weatherAttempts: 3, weatherElapsedMs: 3600001 }), { context: {} });
});
