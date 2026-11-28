'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createNativeWidgetSync } = require('../lib/native-widget-sync');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceNames = ['notes-todos.json', 'weather.json', 'weather.json.cache'];
const helperSource = `#!/usr/bin/env node
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(__filename + '.json', 'utf8'));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => input += value);
process.stdin.on('end', () => {
  const packet = JSON.parse(input);
  fs.appendFileSync(config.log, JSON.stringify({ packet, pid: process.pid }) + '\\n');
  const reply = () => {
    if (config.mode === 'hang') return;
    if (config.mode === 'private') return process.stdout.end('PRIVATE SOURCE TITLE /private/profile');
    const ok = config.mode !== 'invalid';
    process.stdout.end(JSON.stringify({ok,state:ok?'ready':'invalid',changed:true,
      todo:{state:'ready',count:0,revision:1,changed:true},
      weather:{state:'ready',count:0,changed:true}}));
  };
  if (config.mode === 'hang') setInterval(() => {}, 1000);
  else setTimeout(reply, config.delay || 0);
});
`;

async function fixture(t, overrides = {}, options = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'native-widget-sync-'));
  const resourcesPath = path.join(root, 'Test Widget.app/Contents/Resources');
  const helper = path.resolve(resourcesPath, '../Helpers/QiuqiuWidgetBridge');
  const userData = path.join(root, 'private-profile');
  const log = path.join(root, 'helper-log.jsonl');
  await Promise.all([fs.promises.mkdir(resourcesPath, { recursive: true }),
    fs.promises.mkdir(path.dirname(helper), { recursive: true }), fs.promises.mkdir(userData)]);
  await fs.promises.writeFile(helper, helperSource, { mode: 0o755 });
  const setConfig = async config => fs.promises.writeFile(`${helper}.json`, JSON.stringify({
    group: 'test.group', widgetExtensionID: 'test.widgets', log, ...config
  }));
  await setConfig({});
  const write = async (name, value) => fs.promises.writeFile(path.join(userData, name), JSON.stringify(value));
  await Promise.all(sourceNames.map((name, revision) => write(name, { revision })));
  const errors = [];
  const children = [];
  let running = 0;
  let peak = 0;
  const instance = createNativeWidgetSync({ userData, resourcesPath, onError: error => errors.push(error), ...options }, {
    platform: 'darwin', release: '23.6.0', debounceMs: 20, pollMs: 10000,
    spawn: (...args) => {
      assert.equal(args[2].shell, false);
      assert.deepEqual(args[1], ['--sync']);
      const child = spawn(...args);
      children.push(child);
      peak = Math.max(peak, ++running);
      child.on('close', () => running--);
      return child;
    },
    ...overrides
  });
  const records = async () => {
    try { return (await fs.promises.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  t.after(async () => {
    instance.dispose();
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null)
      .map(child => new Promise(resolve => child.once('close', resolve))));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  return { root, resourcesPath, userData, helper, log, instance, errors, children, setConfig, write, records,
    peak: () => peak };
}

async function until(predicate, message, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

test('unsupported systems, development resources and missing helpers/configs are quiet no-ops', async t => {
  const f = await fixture(t);
  for (const override of [
    { platform: 'linux', release: '23.0.0' }, { platform: 'darwin', release: '22.6.0' },
    { platform: 'darwin', release: '21.6.0' }, { platform: 'darwin', release: 'invalid' }
  ]) {
    const instance = createNativeWidgetSync({ userData: '/missing/private', resourcesPath: f.resourcesPath,
      onError: () => assert.fail('no-op reported an error') }, { ...override, spawn: () => assert.fail('spawned') });
    await instance.start(); await instance.refresh(); instance.dispose();
  }
  const dev = createNativeWidgetSync({ userData: f.userData, resourcesPath: f.root }, {
    platform: 'darwin', release: '23.0.0', spawn: () => assert.fail('development spawned')
  });
  await dev.start(); dev.dispose();
  await fs.promises.unlink(`${f.helper}.json`);
  await f.instance.start(); await f.instance.refresh();
  assert.equal((await f.records()).length, 0);
  assert.equal(f.errors.length, 0);
});

test('initial snapshot hashes canonical profile, preserves source bytes and skips acknowledged input', async t => {
  const f = await fixture(t);
  const before = await Promise.all(sourceNames.map(name => fs.promises.readFile(path.join(f.userData, name))));
  await f.instance.start();
  const records = await f.records();
  assert.equal(records.length, 1);
  const packet = records[0].packet;
  assert.deepEqual(Object.keys(packet).sort(), ['schema', 'sourceID', 'todo', 'weatherCache', 'weatherConfig']);
  assert.equal(packet.sourceID, digest(await fs.promises.realpath(f.userData)));
  assert.equal(packet.schema, 1);
  assert.deepEqual(packet.todo, { state: 'data', value: { revision: 0 } });
  assert.equal(JSON.stringify(packet).includes(f.userData), false);
  await Promise.all([f.instance.refresh(), f.instance.refresh()]);
  assert.equal((await f.records()).length, 1);
  const after = await Promise.all(sourceNames.map(name => fs.promises.readFile(path.join(f.userData, name))));
  assert.deepEqual(after, before);
  assert.deepEqual(f.errors, []);
});

test('directory watch observes atomic saves and serializes the latest source change', async t => {
  const f = await fixture(t);
  await f.instance.start();
  const temporary = path.join(f.userData, 'atomic-save.tmp');
  await fs.promises.writeFile(temporary, JSON.stringify({ revision: 77 }));
  await fs.promises.rename(temporary, path.join(f.userData, sourceNames[0]));
  await until(async () => (await f.records()).at(-1)?.packet.todo.value?.revision === 77, 'atomic save not synchronized');
  assert.equal(f.peak(), 1);
});

test('missing, invalid root JSON and recovery publish explicit states without changing source', async t => {
  const f = await fixture(t);
  await f.instance.start();
  await fs.promises.unlink(path.join(f.userData, sourceNames[0]));
  await fs.promises.writeFile(path.join(f.userData, sourceNames[1]), '{bad json');
  await f.write(sourceNames[2], []);
  await f.instance.refresh();
  let packet = (await f.records()).at(-1).packet;
  assert.deepEqual(packet.todo, { state: 'missing' });
  assert.deepEqual(packet.weatherConfig, { state: 'error' });
  assert.deepEqual(packet.weatherCache, { state: 'error' });
  assert.equal(await fs.promises.readFile(path.join(f.userData, sourceNames[1]), 'utf8'), '{bad json');
  await Promise.all(sourceNames.map(name => f.write(name, { restored: true })));
  await f.instance.refresh();
  packet = (await f.records()).at(-1).packet;
  for (const key of ['todo', 'weatherConfig', 'weatherCache']) assert.equal(packet[key].state, 'data');
});

test('rejects symlinks/directories and enforces exact 4 MiB source boundary', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'must-not-read.json');
  await fs.promises.writeFile(outside, '{"secret":"DO NOT EXPORT"}');
  await fs.promises.unlink(path.join(f.userData, sourceNames[0]));
  await fs.promises.symlink(outside, path.join(f.userData, sourceNames[0]));
  await fs.promises.unlink(path.join(f.userData, sourceNames[1]));
  await fs.promises.mkdir(path.join(f.userData, sourceNames[1]));
  const exact = '{"x":"' + 'x'.repeat(4 * 1024 * 1024 - 8) + '"}';
  assert.equal(Buffer.byteLength(exact), 4 * 1024 * 1024);
  await fs.promises.writeFile(path.join(f.userData, sourceNames[2]), exact);
  await f.instance.start();
  let packet = (await f.records()).at(-1).packet;
  assert.deepEqual(packet.todo, { state: 'error' });
  assert.deepEqual(packet.weatherConfig, { state: 'error' });
  assert.equal(packet.weatherCache.state, 'data');
  assert.equal(JSON.stringify(packet).includes('DO NOT EXPORT'), false);
  await fs.promises.appendFile(path.join(f.userData, sourceNames[2]), ' ');
  await f.instance.refresh();
  packet = (await f.records()).at(-1).packet;
  assert.deepEqual(packet.weatherCache, { state: 'error' });
  assert.equal(await fs.promises.readFile(outside, 'utf8'), '{"secret":"DO NOT EXPORT"}');
});

test('realpath failure publishes only errors under temporary ID and recovers canonical ID', async t => {
  const f = await fixture(t);
  await fs.promises.rm(f.userData, { recursive: true });
  await f.instance.start();
  let packet = (await f.records()).at(-1).packet;
  assert.equal(packet.sourceID, digest(`unavailable\0${path.resolve(f.userData)}`));
  for (const key of ['todo', 'weatherConfig', 'weatherCache']) assert.deepEqual(packet[key], { state: 'error' });
  await fs.promises.mkdir(f.userData);
  await f.write(sourceNames[0], { revision: 1 });
  await f.instance.refresh();
  packet = (await f.records()).at(-1).packet;
  const canonicalID = digest(await fs.promises.realpath(f.userData));
  assert.equal(packet.sourceID, canonicalID);
  assert.equal(packet.todo.state, 'data');
  await fs.promises.rename(f.userData, `${f.userData}.moved`);
  await f.instance.refresh();
  packet = (await f.records()).at(-1).packet;
  assert.equal(packet.sourceID, canonicalID);
  for (const key of ['todo', 'weatherConfig', 'weatherCache']) assert.deepEqual(packet[key], { state: 'error' });
  await fs.promises.rename(`${f.userData}.moved`, f.userData);
  await f.instance.refresh();
  assert.equal((await f.records()).at(-1).packet.todo.state, 'data');
});

test('failed helper retries unchanged source and errors expose fixed metadata only', async t => {
  const f = await fixture(t);
  await f.setConfig({ mode: 'private' });
  await f.instance.start();
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].code, 'HELPER_RESULT');
  const errorText = JSON.stringify(f.errors.map(error => ({ ...error, message: error.message, stack: error.stack })));
  assert.equal(errorText.includes('PRIVATE'), false);
  assert.equal(errorText.includes(f.root), false);
  await f.setConfig({ mode: 'invalid' });
  await f.instance.refresh();
  assert.equal((await f.records()).length, 2);
  await f.setConfig({});
  await f.instance.refresh();
  assert.equal((await f.records()).length, 3);
  await f.instance.refresh();
  assert.equal((await f.records()).length, 3);
});

test('changes while helper runs are coalesced with one active child and final state retained', async t => {
  const f = await fixture(t);
  await f.setConfig({ delay: 140 });
  const starting = f.instance.start();
  await until(async () => (await f.records()).length === 1, 'initial helper did not start');
  await f.write(sourceNames[0], { revision: 2 });
  const refresh2 = f.instance.refresh();
  await f.write(sourceNames[0], { revision: 3 });
  const refresh3 = f.instance.refresh();
  await Promise.all([starting, refresh2, refresh3]);
  assert.equal(f.peak(), 1);
  assert.equal((await f.records()).at(-1).packet.todo.value.revision, 3);
  assert.equal((await f.records()).length, 2);
});

test('timeout kills only its own child and does not acknowledge the failed input', async t => {
  const f = await fixture(t, { helperTimeoutMs: 120 });
  await f.setConfig({ mode: 'hang' });
  await f.instance.start();
  assert.equal(f.errors[0]?.code, 'HELPER_TIMEOUT');
  assert.equal(f.children[0].signalCode, 'SIGKILL');
  await f.setConfig({});
  await f.instance.refresh();
  assert.equal((await f.records()).length, 2);
  assert.equal(f.peak(), 1);
});

test('dispose during publication kills child and ignores late responses and queued refreshes', async t => {
  const f = await fixture(t);
  await f.setConfig({ delay: 350 });
  const starting = f.instance.start();
  await until(async () => (await f.records()).length === 1, 'helper did not start');
  const queued = f.instance.refresh();
  f.instance.dispose();
  f.children[0].emit('error', new Error('PRIVATE SOURCE TITLE /private/profile'));
  f.children[0].stdout.emit('data', Buffer.from('{"ok":true,"state":"ready"}'));
  await Promise.all([starting, queued]);
  await f.write(sourceNames[0], { revision: 900 });
  await f.instance.refresh();
  await delay(70);
  assert.equal(f.children.length, 1);
  assert.equal(f.errors.length, 0);
  assert.equal(f.children[0].signalCode, 'SIGKILL');
});

test('fallback poll catches changes when watcher has no events and does not respawn unchanged inputs', async t => {
  const f = await fixture(t, { pollMs: 35, watch: () => {
    const watcher = new EventEmitter(); watcher.close = () => {}; return watcher;
  } });
  await f.instance.start();
  await delay(110);
  assert.equal((await f.records()).length, 1);
  await f.write(sourceNames[0], { revision: 8 });
  await until(async () => (await f.records()).at(-1)?.packet.todo.value?.revision === 8, 'poll missed source change');
  await delay(80);
  assert.equal((await f.records()).length, 2);
});

test('unserializable deeply nested JSON fails closed rather than preserving another snapshot', async t => {
  const f = await fixture(t);
  await fs.promises.writeFile(path.join(f.userData, sourceNames[0]), '{"todos":' +
    '{"x":'.repeat(15000) + '0' + '}'.repeat(15000) + '}');
  await f.instance.start();
  const packet = (await f.records()).at(-1).packet;
  for (const key of ['todo', 'weatherConfig', 'weatherCache']) assert.deepEqual(packet[key], { state: 'error' });
  assert.equal(f.errors[0]?.code, 'SOURCE_ENCODING');
  assert.equal(packet.sourceID, digest(await fs.promises.realpath(f.userData)));
});

test('projects model fields and excludes notes, task bodies and hourly weather without mutating source', async t => {
  const f = await fixture(t);
  const todo = { schema: 1, revision: 7, notes: [{ body: 'PRIVATE NOTE BODY' }], unrelated: 'UNUSED ROOT',
    todos: [{ id: '1', title: 'Synthetic task', dueDate: '2026-11-28', completed: false,
      archived: false, reminderAt: null, reminderState: 'pending', createdAt: 1, updatedAt: 2,
      occurrenceId: 'r1', completedAt: null, deletedAt: null, body: 'PRIVATE TASK BODY', extra: 'UNUSED ROW' },
      null, 5, 'invalid-row', []] };
  const weather = { enabled: true, city: { name: 'Test city', latitude: 1, longitude: 2 },
    privateUnused: 'UNUSED CONFIG' };
  const cache = { city: weather.city, current: { temperature: 20 }, updatedAt: 123, daily: [],
    timezone: 'Asia/Shanghai', utcOffsetSeconds: 28800, hourly: ['PRIVATE HOURLY'], extra: 'UNUSED CACHE' };
  await Promise.all([f.write(sourceNames[0], todo), f.write(sourceNames[1], weather), f.write(sourceNames[2], cache)]);
  await f.instance.start();
  const packet = (await f.records()).at(-1).packet;
  assert.deepEqual(Object.keys(packet.todo.value).sort(), ['revision', 'schema', 'todos']);
  assert.deepEqual(Object.keys(packet.todo.value.todos[0]).sort(),
    ['id', 'title', 'dueDate', 'completed', 'archived', 'reminderAt', 'reminderState',
      'createdAt', 'updatedAt', 'occurrenceId', 'completedAt', 'deletedAt'].sort());
  assert.deepEqual(packet.todo.value.todos.slice(1), [null, 5, 'invalid-row', []]);
  assert.deepEqual(packet.weatherConfig.value, { enabled: true, city: weather.city });
  assert.deepEqual(Object.keys(packet.weatherCache.value).sort(),
    ['city', 'current', 'updatedAt', 'daily', 'timezone', 'utcOffsetSeconds'].sort());
  assert.equal(JSON.stringify(packet).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(packet).includes('UNUSED'), false);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(f.userData, sourceNames[0]), 'utf8')), todo);
});

test('successful report callback runs once after acknowledgement and never after dispose', async t => {
  const reports = [];
  const f = await fixture(t, {}, { onPublished(result) {
    reports.push(result);
    throw new Error('PRIVATE CALLBACK TITLE /private/profile');
  } });
  await f.instance.start();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].ok, true);
  assert.equal(reports[0].state, 'ready');
  assert.equal(reports[0].todo.changed, true);
  assert.equal(reports[0].weather.changed, true);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].code, 'PUBLISHED_CALLBACK');
  assert.equal(f.errors[0].stack.includes('PRIVATE'), false);
  await f.instance.refresh();
  assert.equal((await f.records()).length, 1);
  assert.equal(reports.length, 1);
  await f.setConfig({ delay: 250 });
  await f.write(sourceNames[0], { revision: 2 });
  const refresh = f.instance.refresh();
  await until(async () => (await f.records()).length === 2, 'second helper did not start');
  f.instance.dispose();
  f.children.at(-1).stdout.emit('data', Buffer.from('{"ok":true,"state":"ready"}'));
  await refresh;
  await delay(30);
  assert.equal(reports.length, 1);
  assert.equal(f.errors.length, 1);
});
