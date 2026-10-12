const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { checkLatestRelease, downloadInstaller } = require('../lib/app-update');

const ENDPOINT = 'https://api.github.com/repos/dreamcall520/emotion-ball-desktop-pet/releases/latest';
const RELEASE_PAGE = 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/tag/';
const release = tag_name => ({ tag_name, draft: false, prerelease: false });

test('stable versions compare all three numeric parts and always use the official request and release page', async () => {
  for (const [current, latest, hasUpdate] of [
    ['0.3.9', 'v0.3.10', true], ['v0.3.10', '0.3.10', false],
    ['0.3.10', 'v0.3.9', false], ['0.3.99', 'v0.4.0', true], ['1.0.0', 'v0.99.99', false],
    ['0.3.33', 'v0.4.0', true], ['0.4.00', 'v0.4.0', false],
    ['0.4.00', 'v0.4.01', true], ['0.4.01', 'v0.4.0', false]
  ]) {
    const metadata = { ...release(latest), html_url: 'https://evil.example/download',
      assets: [{ browser_download_url: 'https://evil.example/app' }] };
    Object.defineProperty(metadata, 'body', { get() { throw new Error('release body must not be read'); } });
    const result = await checkLatestRelease(current, { platform: 'darwin', arch: 'arm64', get: async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.deepEqual(options, { headers: { 'User-Agent': `Qiuqiu/${current.replace(/^v/, '')}`,
        Accept: 'application/vnd.github+json' } });
      return metadata;
    } });
    assert.deepEqual(result, { currentVersion: current.replace(/^v/, ''), latestVersion: latest.replace(/^v/, ''),
      hasUpdate, url: RELEASE_PAGE + latest, installer: null,
      downloadMessage: '暂无适合 Apple 芯片 Mac 的新版安装包，请稍后重试。' });
  }
});

test('新版只选择匹配架构、版本和官方路径的完整 DMG，显示版本的补零不影响匹配', async () => {
  const tag = 'v0.4.4', asset = arch => ({ name: `Qiuqiu-0.4.04-macOS-${arch}.dmg`, state: 'uploaded', size: 123,
    browser_download_url: `https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/${tag}/Qiuqiu-0.4.04-macOS-${arch}.dmg` });
  const assets = [asset('arm64'), asset('x64')];
  for (const arch of ['arm64', 'x64']) {
    const result = await checkLatestRelease('0.4.03', { platform: 'darwin', arch, get: async () => ({ ...release(tag), assets }) });
    assert.deepEqual(result.installer, { name: asset(arch).name, url: asset(arch).browser_download_url });
    assert.equal(result.downloadMessage, '');
  }
  const good = asset('arm64');
  for (const invalid of [asset('x64'), { ...good, name: 'Qiuqiu-0.4.04-macOS-arm64-share.zip' },
    { ...good, name: 'Qiuqiu-0.4.03-macOS-arm64.dmg' }, { ...good, size: 0 }, { ...good, state: 'new' },
    { ...good, browser_download_url: 'https://evil.example/Qiuqiu.dmg' },
    { ...good, browser_download_url: good.browser_download_url + '?redirect=evil' }]) {
    const result = await checkLatestRelease('0.4.03', { platform: 'darwin', arch: 'arm64', get: async () => ({ ...release(tag), assets: [invalid] }) });
    assert.equal(result.installer, null); assert.match(result.downloadMessage, /Apple 芯片 Mac/);
  }
  const missingIntel = await checkLatestRelease('0.4.03', { platform: 'darwin', arch: 'x64', get: async () => ({ ...release(tag), assets: [good] }) });
  assert.equal(missingIntel.installer, null); assert.match(missingIntel.downloadMessage, /Intel Mac/);
});

test('原生下载跟踪正确的官方安装包、保存位置和进度，取消失败与超时可清理重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const installer = { name: 'Qiuqiu-0.4.04-macOS-arm64.dmg',
    url: 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/Qiuqiu-0.4.04-macOS-arm64.dmg' };
  const session = new EventEmitter(), wc = new EventEmitter(), calls = [], progress = [];
  wc.session = session; wc.isDestroyed = () => false; wc.downloadURL = url => calls.push(url);
  const createItem = (url = installer.url) => {
    const item = new EventEmitter(); item.getURLChain = () => [url, 'https://release-assets.githubusercontent.com/redirect'];
    item.setSaveDialogOptions = options => { item.dialogOptions = options; };
    item.getTotalBytes = () => 200; item.getReceivedBytes = () => 60;
    item.getSavePath = () => '/downloads/球球.dmg'; item.cancel = () => { item.cancelled = true; };
    return item;
  };
  const pending = downloadInstaller(wc, installer, { downloadsPath: '/downloads', onProgress: value => progress.push(value) });
  assert.deepEqual(calls, [installer.url]); assert.deepEqual(progress, [{ state: 'starting' }]);
  const unrelated = createItem('https://unrelated.example/app.dmg');
  session.emit('will-download', {}, unrelated, wc); assert.equal(unrelated.dialogOptions, undefined);
  const otherWindow = createItem(); session.emit('will-download', {}, otherWindow, new EventEmitter());
  assert.equal(otherWindow.dialogOptions, undefined);
  const item = createItem(); session.emit('will-download', {}, item, wc);
  assert.equal(item.dialogOptions.defaultPath, '/downloads/' + installer.name);
  assert.deepEqual(item.dialogOptions.filters, [{ name: 'macOS 安装包', extensions: ['dmg'] }]);
  item.emit('updated', {}, 'progressing'); assert.deepEqual(progress.at(-1), { state: 'downloading', percent: 30 });
  wc.emit('destroyed'); assert.equal(item.listenerCount('done'), 1, '下载开始后关闭关于页仍能下载完');
  item.emit('done', {}, 'completed'); assert.deepEqual(await pending, { state: 'completed', path: '/downloads/球球.dmg' });
  assert.equal(session.listenerCount('will-download'), 0); assert.equal(item.listenerCount('updated'), 0);
  for (const state of ['cancelled', 'interrupted']) {
    const retry = downloadInstaller(wc, installer), next = createItem(); session.emit('will-download', {}, next, wc);
    next.emit('done', {}, state); const result = await retry;
    assert.equal(result.state, state === 'cancelled' ? 'cancelled' : 'error'); assert.match(result.message, state === 'cancelled' ? /已取消/ : /下载失败/);
  }
  const interrupted = downloadInstaller(wc, installer), interruptedItem = createItem();
  session.emit('will-download', {}, interruptedItem, wc); interruptedItem.emit('updated', {}, 'interrupted');
  assert.match((await interrupted).message, /下载中断/); assert.equal(interruptedItem.cancelled, true);
  const timeout = downloadInstaller(wc, installer); t.mock.timers.tick(30000);
  assert.match((await timeout).message, /超时/); assert.equal(session.listenerCount('will-download'), 0);
  const closed = downloadInstaller(wc, installer); wc.emit('destroyed'); assert.match((await closed).message, /重新打开/);
  const count = calls.length;
  for (const invalid of [{ ...installer, url: 'https://evil.example/app.dmg' },
    { ...installer, url: installer.url + '?extra=1' }, { ...installer, name: '../unsafe.dmg' }]) {
    assert.equal((await downloadInstaller(wc, invalid)).state, 'error');
  }
  assert.equal(calls.length, count, '不接受 renderer 或非官方地址');
  wc.downloadURL = () => { throw new Error('private diagnostic'); };
  assert.match((await downloadInstaller(wc, installer)).message, /无法开始下载/);
  assert.equal(session.listenerCount('will-download'), 0); assert.equal(wc.listenerCount('destroyed'), 0);
});

test('invalid, unsafe and nonstable metadata is rejected without exposing diagnostics or fetching invalid current versions', async () => {
  let calls = 0;
  for (const current of ['0.3', '0.3.10-beta', '01.3.10', '0.3.10\r\nInjected: yes', '9007199254740992.0.0', null]) {
    await assert.rejects(checkLatestRelease(current, { get: async () => { calls++; return release('v0.3.10'); } }), /当前版本号无效/);
  }
  assert.equal(calls, 0);
  for (const metadata of [null, [], {}, release('../evil'), release('v0.3.10?next=https://evil.example'),
    release('v0.3.10-beta'), release('v9007199254740992.0.0'),
    { ...release('v0.3.10'), draft: true }, { ...release('v0.3.10'), prerelease: true }]) {
    await assert.rejects(checkLatestRelease('0.3.9', { get: async () => metadata }), /官方版本信息暂不可用/);
  }
  await assert.rejects(checkLatestRelease('0.3.9', { get: async () => { throw new Error('private diagnostic'); } }),
    error => error.message === '无法检查更新，请检查网络后重试。' && error.publicMessage === error.message);
});

test('default HTTPS rejects redirects, errors, malformed and oversized bodies and enforces the ten second timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let scenario;
  t.mock.method(https, 'get', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => { request.destroyed = true; };
    calls.push({ url, options, request });
    const current = scenario;
    queueMicrotask(() => {
      if (current.timeout) return;
      if (current.error) { request.emit('error', new Error('untrusted network diagnostic')); return; }
      const response = new EventEmitter();
      response.statusCode = current.status ?? 200;
      response.headers = { location: 'https://evil.example/redirect' };
      response.destroy = () => { response.destroyed = true; };
      callback(response);
      if (response.destroyed) return;
      for (const chunk of current.chunks || [Buffer.from(current.body || JSON.stringify(release('v0.3.10')))]) {
        if (!response.destroyed) response.emit('data', chunk);
      }
      if (!response.destroyed) response.emit('end');
    });
    return request;
  });
  for (const status of [301, 302, 307, 403, 500]) {
    scenario = { status };
    const before = calls.length;
    await assert.rejects(checkLatestRelease('0.3.9'), /官方版本信息暂不可用/);
    assert.equal(calls.length, before + 1, 'a redirect never causes a second request');
  }
  scenario = { status: 404 };
  await assert.rejects(checkLatestRelease('0.3.9'), /暂未找到球球的正式发布版本/);
  for (const bad of [{ body: 'not JSON' }, { chunks: [Buffer.alloc(256 * 1024), Buffer.alloc(1)] }]) {
    scenario = bad;
    await assert.rejects(checkLatestRelease('0.3.9'), /官方版本信息暂不可用/);
  }
  scenario = { error: true };
  await assert.rejects(checkLatestRelease('0.3.9'), /无法检查更新，请检查网络后重试/);
  scenario = { timeout: true };
  const pending = checkLatestRelease('0.3.9');
  const rejected = assert.rejects(pending, /检查更新超时/);
  t.mock.timers.tick(10000);
  await rejected;
  assert.equal(calls.at(-1).request.destroyed, true);
  scenario = {};
  assert.equal((await checkLatestRelease('0.3.9')).hasUpdate, true);
  for (const call of calls) {
    assert.equal(call.url, ENDPOINT);
    assert.deepEqual(call.options.headers, { 'User-Agent': 'Qiuqiu/0.3.9', Accept: 'application/vnd.github+json' });
  }
});
