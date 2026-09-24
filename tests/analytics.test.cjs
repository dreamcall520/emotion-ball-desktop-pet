const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const code = readFileSync(new URL('../analytics.js', `file://${__filename}`), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';

function page(overrides = {}) {
  const scripts = [];
  const listeners = {};
  const calls = [];
  const trackerEvents = {};
  const window = { umami: { track: (...args) => calls.push(args) } };
  const context = {
    URL, Promise, window,
    navigator: {},
    location: { protocol: 'https:', hostname: 'qiuqiu.pet' },
    localStorage: { getItem: () => null },
    document: {
      currentScript: { dataset: { websiteId: id } },
      createElement: () => ({ dataset: {}, addEventListener: (name, fn) => { trackerEvents[name] = fn; } }),
      head: { appendChild: script => scripts.push(script) },
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
  };
  overrides.configure?.(context);
  vm.runInNewContext(code, context);
  return { scripts, listeners, calls, trackerEvents, window };
}

test('missing ID, non-production origins, DNT and owner opt-out send nothing', () => {
  const disabled = [
    c => { c.document.currentScript.dataset.websiteId = ''; },
    c => { c.document.currentScript.dataset.websiteId = 'placeholder'; },
    c => { c.location.hostname = 'localhost'; },
    c => { c.location.hostname = 'dreamcall520.github.io'; },
    c => { c.location.protocol = 'http:'; },
    c => { c.navigator.doNotTrack = '1'; },
    c => { c.window.doNotTrack = 'yes'; },
    c => { c.localStorage.getItem = () => '1'; },
  ];
  for (const configure of disabled) {
    const state = page({ configure });
    assert.equal(state.scripts.length, 0);
    assert.equal(Object.keys(state.listeners).length, 0);
  }
});

test('PV payload removes private URLs, arbitrary data and identity fields', () => {
  const state = page();
  const clean = state.window.qiuqiuAnalyticsBeforeSend('event', {
    website: id, url: '/?email=private@example.test#secret', title: 'private draft',
    referrer: 'https://source.example/private?token=secret#section',
    language: 'zh-CN', screen: '1920x1080', id: 'private-id',
    data: { email: 'private@example.test' }, tag: 'secret', timestamp: 1,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), {
    website: id, hostname: 'qiuqiu.pet', url: '/',
    title: '球球桌宠 - 免费的 macOS 桌面伙伴',
    referrer: 'https://source.example', language: 'zh-CN', screen: '1920x1080',
  });
  assert.equal(state.window.qiuqiuAnalyticsBeforeSend('identify', { website: id }), false);
  assert.equal(state.window.qiuqiuAnalyticsBeforeSend('event', { website: 'another-id' }), false);
  for (const referrer of ['file:///private/local', 'https://qiuqiu.pet/?secret=1', 'invalid']) {
    assert.equal(state.window.qiuqiuAnalyticsBeforeSend('event', { website: id, referrer }).referrer, '');
  }
});

test('only download dimensions are retained; other events are blocked', () => {
  const state = page();
  const beforeSend = state.window.qiuqiuAnalyticsBeforeSend;
  const clean = beforeSend('event', {
    website: id, name: 'download',
    data: { architecture: 'arm64', position: 'hero', text: 'private message' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(clean.data)), { architecture: 'arm64', position: 'hero' });
  assert.equal(beforeSend('event', { website: id, name: 'chat', data: { text: 'secret' } }), false);
  assert.equal(beforeSend('event', { website: id, name: 'download', data: { architecture: 'unknown' } }), false);
});

test('one manual PV; download navigation survives unavailable and rejected trackers', async () => {
  const state = page();
  assert.equal(state.scripts.length, 1);
  assert.equal(state.scripts[0].dataset.autoTrack, 'false');
  assert.equal(state.calls.length, 0);
  state.trackerEvents.load();
  assert.equal(state.calls.length, 1);

  const link = {
    href: 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.24/Qiuqiu-0.3.24-macOS-arm64-share.zip',
    dataset: { downloadArch: 'arm64', downloadPosition: 'hero' },
  };
  let prevented = false;
  const event = { type: 'click', button: 0, target: { closest: () => link }, preventDefault: () => { prevented = true; } };
  state.listeners.click(event);
  assert.equal(state.calls[1][0], 'download');
  assert.equal(state.calls[1][1].architecture, 'arm64');
  state.window.umami = undefined;
  assert.doesNotThrow(() => state.listeners.click(event));
  state.window.umami = { track: () => { throw Error('blocked'); } };
  assert.doesNotThrow(() => state.listeners.click(event));
  state.window.umami = { track: () => Promise.reject(Error('offline')) };
  state.listeners.click(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, false);
});

test('only real release links are counted, middle clicks count once and right clicks do not', () => {
  const state = page();
  const link = {
    href: 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.13/Qiuqiu-0.3.13-macOS-x64-share.zip',
    dataset: { downloadArch: 'x64', downloadPosition: 'download' },
  };
  const event = { type: 'auxclick', button: 1, target: { closest: () => link } };
  state.listeners.auxclick(event);
  assert.equal(state.calls.length, 1);
  event.button = 2;
  state.listeners.auxclick(event);
  link.href = 'https://unrelated.example/file.zip';
  event.type = 'click';
  state.listeners.click(event);
  assert.equal(state.calls.length, 1);
});
