'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/build-calendar-events.js'), 'utf8');
function harness({ platform = 'darwin', arch = 'arm64', env = { CALENDAR_NODE_INCLUDE: '/headers' }, headers = '/headers', failure = false } = {}) {
  const calls = [], renamed = [], removed = [], module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    __dirname: path.join(__dirname, '../scripts'),
    process: { platform, arch, pid: 123, execPath: '/build/bin/node', env },
    require(name) {
      if (name === 'node:fs') return {
        existsSync: file => headers !== null && file === path.join(headers, 'node_api.h'),
        renameSync: (...args) => renamed.push(args),
        unlinkSync: file => removed.push(file)
      };
      if (name === 'node:child_process') return {
        execFileSync(command, args) {
          calls.push({ command, args: Array.from(args) });
          if (args[0] === '--show-sdk-path') return '/sdk\n';
          if (failure) throw Error('compiler failed');
          return '';
        }
      };
      return require(name);
    }
  });
  return { build: module.exports.buildCalendarEvents, calls, renamed, removed };
}

test('calendar build defaults to this Node architecture and links the EventKit bridge', () => {
  const h = harness();
  assert.equal(h.build('/source'), '/source/desktop-pet/native/calendar-events.node');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].command, '/usr/bin/xcrun');
  assert.deepEqual(h.calls[0].args, ['--show-sdk-path']);
  const args = h.calls[1].args;
  assert.equal(args[0], 'clang++');
  assert.equal(args[args.indexOf('-arch') + 1], 'arm64');
  assert.equal(args[args.indexOf('-isysroot') + 1], '/sdk');
  assert.equal(args[args.indexOf('-I') + 1], '/headers');
  for (const framework of ['Foundation', 'EventKit', 'CoreGraphics']) {
    assert(args.some((arg, i) => arg === '-framework' && args[i + 1] === framework));
  }
  assert(args.includes('-DNAPI_VERSION=8'));
  assert(args.includes('-mmacosx-version-min=12.0'));
  assert.deepEqual(h.renamed, [['/source/desktop-pet/native/calendar-events.node.tmp-123', '/source/desktop-pet/native/calendar-events.node']]);
});

test('calendar target x64 maps to clang x86_64 without changing the host Node', () => {
  const h = harness({ arch: 'arm64' });
  h.build('/source', { targetArch: 'x64' });
  const args = h.calls[1].args;
  assert.equal(args[args.indexOf('-arch') + 1], 'x86_64');
  const nativeX64 = harness({ arch: 'x64' });
  nativeX64.build('/source');
  const nativeArgs = nativeX64.calls[1].args;
  assert.equal(nativeArgs[nativeArgs.indexOf('-arch') + 1], 'x86_64');
});

test('calendar build supports the existing weather header override', () => {
  const h = harness({ env: { WEATHER_NODE_INCLUDE: '/weather-headers' }, headers: '/weather-headers' });
  h.build('/source');
  const args = h.calls[1].args;
  assert.equal(args[args.indexOf('-I') + 1], '/weather-headers');
});

test('calendar build rejects unsupported host, architecture or missing headers before compiling', () => {
  const otherHost = harness({ platform: 'win32' });
  assert.throws(() => otherHost.build('/source'), /macOS/);
  assert.equal(otherHost.calls.length, 0);
  for (const targetArch of ['ia32', 'universal', 'constructor', 'toString', null, {}]) {
    const h = harness();
    assert.throws(() => h.build('/source', { targetArch }), /arm64 and x64/);
    assert.equal(h.calls.length, 0);
  }
  const noHeaders = harness({ headers: null });
  assert.throws(() => noHeaders.build('/source'), /node_api.h/);
  assert.equal(noHeaders.calls.length, 0);
});

test('compiler failure removes only its temporary binary and does not replace an existing output', () => {
  const h = harness({ failure: true });
  assert.throws(() => h.build('/source'), /compiler failed/);
  assert.deepEqual(h.renamed, []);
  assert.deepEqual(h.removed, ['/source/desktop-pet/native/calendar-events.node.tmp-123']);
});

test('native calendar surface remains read-only and filters cancelled events before the result limit', () => {
  const native = fs.readFileSync(path.join(__dirname, '../native/calendar-events.mm'), 'utf8');
  const names = [...native.matchAll(/\{"(\w+)", nullptr,/g)].map(match => match[1]);
  assert.deepEqual(names, ['status', 'connect', 'read']);
  assert.doesNotMatch(native, /saveEvent:|removeEvent:|saveCalendar:|removeCalendar:|commit:/);
  assert(native.indexOf('event.status == EKEventStatusCanceled') < native.indexOf('eventData.count >= 2000'));
  assert.match(native, /@available\(macOS 14\.0, \*\)/);
  assert.match(native, /requestFullAccessToEventsWithCompletion:complete/);
  assert.match(native, /requestAccessToEntityType:EKEntityTypeEvent completion:complete/);
});
