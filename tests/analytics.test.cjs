const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = readFileSync(new URL('../analytics.js', `file://${__filename}`), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const ga4Id = 'G-TEST123456';

function page(overrides = {}) {
  const scripts = [];
  const listeners = {};
  const calls = [];
  const trackerEvents = {};
  const window = { umami: { track: (...args) => calls.push(args) } };
  const context = {
    URL, URLSearchParams, Promise, window,
    navigator: {},
    location: { protocol: 'https:', hostname: 'qiuqiu.pet', pathname: '/', search: '' },
    localStorage: { getItem: () => null },
    document: {
      currentScript: { dataset: { websiteId: id, ga4Id: '' } },
      createElement: () => ({ dataset: {}, addEventListener: (name, fn) => { trackerEvents[name] = fn; } }),
      head: { appendChild: script => scripts.push(script) },
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
  };
  overrides.configure?.(context);
  vm.runInNewContext(code, context);
  return { scripts, listeners, calls, trackerEvents, window, context,
    gaCommands: () => (window.dataLayer || []).map(args => Array.from(args)) };
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
    href: 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/Qiuqiu-0.4.04-macOS-arm64.dmg',
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
  assert.equal(state.calls.length, 1);
  link.href = 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/Qiuqiu-0.4.04-macOS-arm64.dmg';
  link.dataset.downloadArch = 'arm64';
  event.type = 'click';
  event.button = 0;
  state.listeners.click(event);
  assert.equal(state.calls.length, 2);
  event.type = 'auxclick';
  event.button = 1;
  state.listeners.auxclick(event);
  assert.equal(state.calls.length, 3);
  link.dataset.downloadArch = 'x64';
  event.type = 'click';
  event.button = 0;
  state.listeners.click(event);
  for (const href of ['https://unrelated.example/file.dmg',
    'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/unknown.dmg']) {
    link.href = href;
    state.listeners.click(event);
  }
  assert.equal(state.calls.length, 3);
});

test('GA4 works independently; production, DNT, both opt-out keys and page allowlist gate both providers', () => {
  const googleOnly = page({ configure(c) {
    c.document.currentScript.dataset = { websiteId: '', ga4Id };
  } });
  assert.equal(googleOnly.scripts.length, 1);
  assert.equal(googleOnly.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${ga4Id}`);
  assert.equal(googleOnly.scripts[0].referrerPolicy, 'origin');
  const disabled = [
    c => { c.location.hostname = 'localhost'; },
    c => { c.location.hostname = 'dreamcall520.github.io'; },
    c => { c.location.protocol = 'http:'; },
    c => { c.navigator.doNotTrack = '1'; },
    c => { c.window.doNotTrack = 'yes'; },
    c => { c.navigator.msDoNotTrack = '1'; },
    c => { c.localStorage.getItem = key => key === 'qiuqiu.analytics.disabled' ? '1' : null; },
    c => { c.localStorage.getItem = key => key === 'umami.disabled' ? '1' : null; },
    ...['/demos/chat/', '/tests/example.html', '/google-test.html', '/private/'].map(pathname => c => { c.location.pathname = pathname; }),
  ];
  for (const configure of disabled) {
    const state = page({ configure(c) { c.document.currentScript.dataset.ga4Id = ga4Id; configure(c); } });
    assert.equal(state.scripts.length, 0);
    assert.equal(state.gaCommands().length, 0);
    assert.equal(Object.keys(state.listeners).length, 0);
  }
});

test('GA4 sends one sanitized page view and only a known source/medium pair, even if included twice', () => {
  const state = page({ configure(c) {
    c.document.currentScript.dataset.ga4Id = ga4Id;
    c.location.pathname = '/product/index.html';
    c.location.search = '?utm_source=wechat&utm_medium=social&utm_campaign=private-email@example.test&token=secret&utm_content=private-id';
    c.location.hash = '#private-chat';
    c.document.referrer = 'https://source.example/private?email=private-email@example.test#secret';
    c.document.title = 'private draft';
  } });
  vm.runInNewContext(code, state.context);
  const commands = state.gaCommands();
  assert.equal(state.scripts.length, 2);
  assert.equal(commands.filter(args => args[0] === 'event' && args[1] === 'page_view').length, 1);
  const config = commands.find(args => args[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.page_location, 'https://qiuqiu.pet/product/');
  assert.equal(config.page_referrer, 'https://source.example');
  assert.equal(config.page_title, '球球官网');
  assert.equal(config.campaign_source, 'wechat');
  assert.equal(config.campaign_medium, 'social');
  assert.equal(config.campaign_name, '');
  assert.doesNotMatch(JSON.stringify(commands), /private|secret|token|utm_|@example/);
  for (const query of ['?utm_source=private-id&utm_medium=social', '?utm_source=google&utm_medium=private-id', '?utm_source=google']) {
    const invalid = page({ configure(c) {
      c.document.currentScript.dataset.ga4Id = ga4Id;
      c.location.search = query;
    } }).gaCommands().find(args => args[0] === 'config')[2];
    assert.equal(invalid.campaign_source, '');
    assert.equal(invalid.campaign_medium, '');
  }
});

test('current downloads reach GA4 without changing Umami; history, arbitrary links and failures never block navigation', async () => {
  const state = page({ configure(c) { c.document.currentScript.dataset.ga4Id = ga4Id; } });
  const link = { href: 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.5/Qiuqiu-0.4.05-macOS-arm64.dmg',
    dataset: { downloadArch: 'arm64', downloadPosition: 'hero', email: 'private@example.test' }, closest: () => null };
  let prevented = false;
  const event = { type: 'click', button: 0, target: { closest: () => link }, preventDefault: () => { prevented = true; } };
  const downloads = () => state.gaCommands().filter(args => args[0] === 'event' && args[1] === 'download_click');
  state.listeners.click(event);
  assert.equal(state.calls.length, 1);
  assert.equal(downloads().length, 1);
  assert.equal(downloads()[0][2].architecture, 'arm64');
  assert.equal(downloads()[0][2].version, '0.4.05');
  assert.equal(downloads()[0][2].download_source, 'github');
  assert.doesNotMatch(JSON.stringify(downloads()), /private|github\.com|\.dmg/);
  link.dataset = {}; // Historical release links have no current-download markers.
  state.listeners.click(event);
  assert.equal(downloads().length, 1);
  link.href = 'https://share.weiyun.com/c6lIDCBc';
  for (const [ancestor, position] of [['nav', 'navigation'], ['.hero-actions', 'hero'], ['', 'download']]) {
    link.closest = selector => selector === ancestor ? {} : null;
    state.listeners.click(event);
    assert.equal(downloads().at(-1)[2].position, position);
    assert.equal(downloads().at(-1)[2].version, '0.4.04');
    assert.equal(downloads().at(-1)[2].download_source, 'weiyun');
  }
  assert.equal(state.calls.length, 1, 'domestic links do not extend the legacy Umami metric');
  event.type = 'auxclick'; event.button = 2; state.listeners.auxclick(event);
  assert.equal(downloads().length, 4);
  event.button = 1; state.listeners.auxclick(event);
  assert.equal(downloads().length, 5);
  link.href = 'https://unrelated.example/file.dmg'; state.listeners.auxclick(event);
  assert.equal(downloads().length, 5);
  link.href = 'https://share.weiyun.com/c6lIDCBc';
  for (const gtag of [undefined, () => { throw Error('blocked'); }, () => Promise.reject(Error('offline'))]) {
    state.window.gtag = gtag;
    assert.doesNotThrow(() => state.listeners.auxclick(event));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, false);
});

test('all twelve public pages configure GA4, while only the original four retain Umami', () => {
  const root = path.join(__dirname, '..');
  const sitemap = readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const publicFiles = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]).pathname.slice(1) + 'index.html');
  let umamiCount = 0;
  const ga4Ids = new Set();
  for (const file of publicFiles) {
    const html = readFileSync(path.join(root, file), 'utf8');
    const tags = [...html.matchAll(/<script[^>]+src="([^"]*analytics\.js[^"]*)"[^>]*><\/script>/g)];
    assert.equal(tags.length, 1, file);
    assert.equal(path.resolve(root, path.dirname(file), tags[0][1].split('?')[0]), path.join(root, 'analytics.js'));
    const value = tags[0][0].match(/data-ga4-id="([^"]*)"/)?.[1];
    assert.ok(value === '' || /^G-[A-Z0-9]{6,20}$/.test(value), file);
    ga4Ids.add(value);
    if (tags[0][0].includes('data-website-id=')) umamiCount++;
  }
  assert.equal(publicFiles.length, 12);
  assert.equal(umamiCount, 4);
  assert.equal(ga4Ids.size, 1, 'all public pages use the same measurement ID');
  for (const file of readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html') && !publicFiles.includes(file))) {
    assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), /analytics\.js/, `${file}: no analytics outside public pages`);
  }
});
