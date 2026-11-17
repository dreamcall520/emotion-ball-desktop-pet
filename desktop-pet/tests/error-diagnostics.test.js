const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeDiagnostic, sourceLocation } = require('../lib/error-diagnostics');
const root = path.resolve(__dirname, '..');

test('safe business, transport and cause codes retain meaning without raw content', () => {
  for (const code of ['LOGIN_REQUIRED', 'ACCOUNT_CHANGED', 'UNSUPPORTED_PLATFORM', 'UNSUPPORTED_AUTH', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_QUOTA', 'RATE_LIMITED', 'TIMEOUT', 'CONNECTION_FAILED', 'SERVICE_UNAVAILABLE', 'INVALID_RESPONSE', 'ACCOUNT_RESTRICTED', 'UPDATE_FAILED', 'LOCATION_DENIED', 'DATA_OLD', 'TRANSFER_INTERRUPTED', 'EACCES', 'PRELOAD_ERROR']) {
    assert.equal(normalizeDiagnostic('天气', { code }).code, code);
  }
  const cause = Object.assign(new Error('secret token'), { code: 'ECONNRESET' });
  const error = new TypeError('private message', { cause });
  assert.deepEqual(normalizeDiagnostic('天气', error), { name: 'TypeError', code: 'ECONNRESET', context: {} });
  assert.equal(normalizeDiagnostic('', { code: 'private-code', cause }).code, 'ECONNRESET');
  assert.equal(normalizeDiagnostic('', { code: 'private-code' }).code, 'UNKNOWN_ERROR_CODE');
  assert.equal(normalizeDiagnostic('', '{"code":"LOGIN_REQUIRED","secret":"token"}').code, 'UNCLASSIFIED_ERROR');
  const cycle = {}; cycle.cause = cycle;
  assert.equal(normalizeDiagnostic('', cycle).code, 'UNCLASSIFIED_ERROR');
});

test('context rejects identities, arbitrary names, URLs, unsafe fields and ranges', () => {
  const value = normalizeDiagnostic('', { name: 'private-name', code: 'private-token' }, {
    stage: 'quota-query', page: 'workbuddy-details.html', source: 'lib/workbuddy-quota.js', line: 123, column: 9,
    reason: 'crashed', httpStatus: 503, retryable: true, retryDelayMs: 15000,
    token: 'secret-token', message: 'secret message', stack: 'private-stack', projectRoot: '/Users/private'
  });
  assert.deepEqual(value, { name: 'Error', code: 'UNKNOWN_ERROR_CODE', context: {
    stage: 'quota-query', page: 'workbuddy-details.html', source: 'lib/workbuddy-quota.js', line: 123, column: 9,
    reason: 'crashed', httpStatus: 503, retryable: true, retryDelayMs: 15000
  } });
  assert.doesNotMatch(JSON.stringify(value), /private|secret|token|message|stack|projectRoot/);
  assert.deepEqual(normalizeDiagnostic('', null, { stage: '/Users/private', page: '../index.html', source: '/Users/private/desktop-pet/main.js', line: 1, column: 1, reason: 'private', httpStatus: 600, retryable: 'true', retryDelayMs: -1 }).context, {});
  for (const value of [NaN, Infinity, 0, -1, 1.5, 10000001]) assert.equal(normalizeDiagnostic('', {}, { source: 'main.js', line: value }).context.line, undefined);
  assert.deepEqual(normalizeDiagnostic('', {}, { page: 'https://site/index.html?token=secret', source: '../main.js' }).context, {});
});

test('source locations require exact code root and real shipped code names', () => {
  const file = path.join(root, 'lib/workbuddy-quota.js');
  assert.deepEqual(sourceLocation({ stack: `Error: secret\n    at query (${file}:121:4)\n    at unrelated (/private/x.js:1:2)` }, root), { source: 'lib/workbuddy-quota.js', line: 121, column: 4 });
  assert.deepEqual(sourceLocation(`${pathToFileURL(file)}:12:3`, root), { source: 'lib/workbuddy-quota.js', line: 12, column: 3 });
  for (const source of ['/Users/secret/desktop-pet/main.js:1:2', `${root}-other/main.js:1:2`, `${root}/../main.js:1:2`, `${root}/lib/private-token.js:1:2`, `${file}?token=secret:1:2`]) assert.deepEqual(sourceLocation(source, root), {});
  assert.deepEqual(sourceLocation({ stack: `Error: ${file}:1:2` }, root), {}, 'never use message text as source');
  assert.deepEqual(sourceLocation({ stack: `Error: secret\n    at ${file}:2:5` }, root), { source: 'lib/workbuddy-quota.js', line: 2, column: 5 });
});

test('untrusted accessors are never invoked during normalization', () => {
  let invoked = 0;
  const hostile = Object.defineProperties({}, { name: { get() { invoked++; throw Error(); } }, code: { get() { invoked++; throw Error(); } }, cause: { get() { invoked++; throw Error(); } }, stack: { get() { invoked++; throw Error(); } } });
  assert.deepEqual(normalizeDiagnostic('', hostile, hostile), { name: 'Error', code: 'UNCLASSIFIED_ERROR', context: {} });
  assert.deepEqual(sourceLocation(hostile, root), {});
  assert.equal(invoked, 0);
});


test('provider stages and bounded failure/retry classifications remain useful', () => {
  for (const stage of ['quota-auth', 'quota-request', 'quota-parse', 'weather-storage', 'weather-animation', 'weather-window']) {
    assert.deepEqual(normalizeDiagnostic('', {}, { stage, severity: 'warning', expected: true, failureCount: 2, retryAfterSeconds: 30 }).context,
      { stage, severity: 'warning', expected: true, failureCount: 2, retryAfterSeconds: 30 });
  }
  assert.deepEqual(normalizeDiagnostic('', {}, { severity: 'private', expected: 'yes', failureCount: 0, retryAfterSeconds: 86401 }).context, {});
});

test('source roots may contain spaces and Chinese without admitting prefix collisions or URL queries', () => {
  const special = path.resolve('/tmp/项目 文件夹/desktop-pet');
  const file = path.join(special, 'lib/workbuddy-quota.js');
  assert.deepEqual(sourceLocation({ stack: `Error: secret\n    at query (${file}:121:4)` }, special), { source: 'lib/workbuddy-quota.js', line: 121, column: 4 });
  assert.deepEqual(sourceLocation(`${pathToFileURL(file)}:12:3`, special), { source: 'lib/workbuddy-quota.js', line: 12, column: 3 });
  for (const source of [`${special}-other/lib/workbuddy-quota.js:1:2`, `${pathToFileURL(file)}?token=private`, `${pathToFileURL(file)}#secret`]) {
    assert.deepEqual(sourceLocation(source, special), {});
  }
});


test('process/load/download diagnostics retain fixed classifications and bounded numbers', () => {
  assert.deepEqual(normalizeDiagnostic('', {}, { process: 'renderer', netErrorCode: -105, downloadStage: 'transfer', attempt: 2 }).context,
    { process: 'renderer', netErrorCode: -105, downloadStage: 'transfer', attempt: 2 });
  assert.deepEqual(normalizeDiagnostic('', {}, { process: 'private', netErrorCode: -1001, downloadStage: 'https://private', attempt: 101 }).context, {});
  for (const process of ['main', 'renderer', 'preload']) assert.equal(normalizeDiagnostic('', {}, { process }).context.process, process);
  for (const downloadStage of ['prepare', 'start', 'save', 'transfer', 'cancel']) assert.equal(normalizeDiagnostic('', {}, { downloadStage }).context.downloadStage, downloadStage);
  for (const netErrorCode of [0, 1, NaN, -1.5]) assert.equal(normalizeDiagnostic('', {}, { netErrorCode }).context.netErrorCode, undefined);
});
