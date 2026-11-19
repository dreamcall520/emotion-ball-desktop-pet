const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { normalizeDiagnostic, sourceLocation } = require('../lib/error-diagnostics');
const { createFeedbackReporting } = require('../lib/feedback-reporting');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
function fixture({ appendError, reporting, stderrError } = {}) {
  const lines = [], stderr = [], captures = [];
  const functions = ['writeLocalLogLine', 'writeError', 'writeWeatherLocationDiagnostic'].map(name =>
    main.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))?.[0]).filter(Boolean).join('\n');
  const context = vm.createContext({ normalizeDiagnostic, sourceLocation, isQuitting: false, path, Error,
    process: { stderr: { write: value => { if (stderrError) throw stderrError; stderr.push(value); } } },
    app: { getPath: () => '/synthetic-private-profile' },
    fs: { mkdirSync() {}, appendFileSync(file, line) { if (appendError) throw appendError; lines.push({ file, line }); } },
    feedbackReporting: reporting || { capture: (...args) => captures.push(args) } });
  vm.runInContext(functions, context);
  return { context, lines, stderr, captures, call: source => vm.runInContext(source, context) };
}
const payload = line => JSON.parse(line.slice(line.indexOf(': ') + 2));

test('local weather error keeps safe facts and removes raw content', () => {
  const f = fixture();
  f.context.failure = Object.assign(new Error('private city /private/url and identity'), { code: 'LOCATION_NO_FIX' });
  f.context.facts = { stage: 'weather-location', locationAuthorization: 'granted', locationStarted: true,
    locationCallbacks: 0, locationUnknownFailures: 1, locationPhase: 'acquisition', locationElapsedMs: 15101,
    locationPhaseElapsedMs: 15000, locationAppActive: false, locationAuthorizationCallbacks: 1,
    city: 'private-city', latitude: 12.3456, url: 'https://private.invalid/', userId: 'private-id' };
  f.call("writeError('天气', failure, facts)");
  assert.equal(f.lines.length, 1); assert.match(f.lines[0].line, /^\[\d{4}-\d\d-\d\dT/);
  const record = payload(f.lines[0].line);
  assert.equal(record.event, 'weather-error'); assert.equal(record.code, 'LOCATION_NO_FIX');
  assert.equal(record.context.locationPhase, 'acquisition'); assert.equal(record.context.locationAppActive, false);
  assert.equal(record.context.locationElapsedMs, 15101); assert.equal(record.context.locationCallbacks, 0);
  assert.doesNotMatch(f.lines[0].line, /private|latitude|url|userId|stack/);
  assert.equal(f.captures.length, 1, 'Existing reporter gate is still consulted for real weather errors');
});

test('real disabled automatic reporter leaves local weather facts without an outbox or request', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-local-diagnostic-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'reporter');
  const reporting = createFeedbackReporting({ directory, enabled: false,
    fetch: async () => assert.fail('local diagnostics must not send') });
  t.after(() => reporting.dispose());
  const f = fixture({ reporting });
  f.call("writeError('天气', {code:'LOCATION_NO_FIX'}, {stage:'weather-location',locationPhase:'acquisition',locationElapsedMs:15012})");
  await reporting.flush();
  assert.equal(payload(f.lines[0].line).context.locationElapsedMs, 15012);
  assert.equal(reporting.getState().enabled, false); assert.equal(reporting.getState().pending, 0);
  assert.equal(fs.existsSync(directory), false);
});

test('local location success and failure are distinct actual outcomes and never enter automatic capture', () => {
  const f = fixture();
  f.context.good = { outcome: 'success', diagnostic: { locationPhase: 'geocode', locationElapsedMs: 51,
    locationPhaseElapsedMs: 12, locationAppActive: true, locationAuthorizationCallbacks: 0, locationCallbacks: 1,
    city: 'private-city', longitude: 12.3456 } };
  f.context.bad = { outcome: 'failure', code: 'LOCATION_TIMEOUT', diagnostic: { locationPhase: 'authorization',
    locationElapsedMs: 120010, locationPhaseElapsedMs: 120010, locationAppActive: false, locationAuthorizationCallbacks: 0 } };
  f.call('writeWeatherLocationDiagnostic(good);writeWeatherLocationDiagnostic(bad)');
  const records = f.lines.map(row => payload(row.line));
  assert.deepEqual(records.map(record => record.event), ['location-success', 'location-failure']);
  assert.equal(records[0].code, undefined); assert.equal(records[1].code, 'LOCATION_TIMEOUT');
  assert.equal(records[0].context.stage, 'weather-location'); assert.equal(records[1].context.locationPhase, 'authorization');
  assert.equal(f.captures.length, 0); assert.doesNotMatch(JSON.stringify(f.lines), /private-city|longitude/);
  f.call("writeWeatherLocationDiagnostic({outcome:'failure',code:'TIMEOUT',diagnostic:{}});writeWeatherLocationDiagnostic({outcome:'private-outcome'})");
  assert.equal(payload(f.lines[2].line).code, undefined); assert.equal(f.lines.length, 3);
});

test('expected location cancellation has a local outcome without an error code or automatic capture', () => {
  const f = fixture();
  f.call("writeWeatherLocationDiagnostic({outcome:'cancelled',code:'CANCELLED',diagnostic:{locationPhase:'acquisition',locationElapsedMs:10000,latitude:123,message:'private'}})");
  assert.equal(f.lines.length, 1);
  const record = payload(f.lines[0].line);
  assert.equal(record.event, 'location-cancelled'); assert.equal(record.code, undefined);
  assert.equal(record.context.stage, 'weather-location'); assert.equal(record.context.locationElapsedMs, 10000);
  assert.equal(f.captures.length, 0); assert.doesNotMatch(f.lines[0].line, /latitude|private|CANCELLED/);
});

test('non-weather error semantics and log-write failure handling remain intact', () => {
  const f = fixture(); f.context.failure = new Error('existing non-weather message');
  f.call("writeError('聊天面板', failure)");
  assert.match(f.lines[0].line, /聊天面板: Error: existing non-weather message/); assert.equal(f.captures.length, 1);
  assert(f.lines[0].line.includes(f.context.failure.stack));
  const failed = fixture({ appendError: Error('disk unavailable /Users/private/profile') });
  failed.call("writeError('天气', {code:'TIMEOUT'}, {stage:'weather-refresh',httpStatus:503})");
  assert.equal(failed.captures.length, 1); assert(failed.stderr.some(line => /无法写入天气诊断日志/.test(line)));
  assert.doesNotMatch(failed.stderr.join(''), /private|profile/);
  const closed = fixture({ stderrError: Error('closed log sink') });
  assert.doesNotThrow(() => closed.call("writeError('天气', {code:'LOCATION_NO_FIX'}, {stage:'weather-location'})"));
  assert.equal(closed.captures.length, 1);
});

test('real location bridge contains local logger exceptions without changing success or failure', async () => {
  const { createLocationBridge } = require('../lib/weather-location');
  for (const fails of [false, true]) {
    const f = fixture({ stderrError: Error('synthetic log sink unavailable') });
    const bridge = createLocationBridge({ platform: 'darwin', native: {
      status: () => ({ status: 'granted', servicesEnabled: true }),
      locate: async () => {
        if (fails) throw Object.assign(Error('private native message'), { code: 'LOCATION_NO_FIX',
          diagnostic: { locationPhase: 'acquisition', locationElapsedMs: 15000 } });
        return { latitude: 0, longitude: 0, accuracy: 1, diagnostic: { locationPhase: 'geocode', locationElapsedMs: 23 } };
      }
    }, onDiagnostic: record => { f.context.record = record; f.call('writeWeatherLocationDiagnostic(record)'); } });
    if (fails) await assert.rejects(bridge.locate(), error => error.code === 'LOCATION_NO_FIX' && error.diagnostic.locationElapsedMs === 15000);
    else assert.equal((await bridge.locate()).diagnostic.locationElapsedMs, 23);
    assert.equal(f.captures.length, 0);
  }
});

test('website weather logging retains source precedence and the existing reporter context', () => {
  const f = fixture();
  const root = path.resolve(__dirname, '..');
  f.context.failure = { code: 'LOCATION_TIMEOUT',
    stack: `Error: private raw message\n    at location (${root}/lib/weather-location.js:61:9)` };
  f.context.facts = { stage: 'weather-location', source: 'lib/weather-window.js', line: 241, locationPhase: 'acquisition' };
  f.call("writeError('天气', failure, facts)");
  const record = payload(f.lines[0].line);
  assert.equal(record.name, 'Error'); assert.equal(record.code, 'LOCATION_TIMEOUT');
  assert.equal(record.context.process, 'main'); assert.equal(record.context.severity, 'error');
  assert.equal(record.context.source, 'lib/weather-window.js'); assert.equal(record.context.line, 241);
  assert.equal(record.context.column, 9, 'existing caller/error/context spread order stays intact');
  assert.equal(f.captures[0][2].source, 'lib/weather-window.js');
  assert.equal(f.captures[0][2].locationPhase, 'acquisition');
  assert.doesNotMatch(f.lines[0].line, /private raw|Users|stack/);
});
