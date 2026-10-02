const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { checkLatestRelease } = require('../lib/app-update');

const ENDPOINT = 'https://api.github.com/repos/dreamcall520/emotion-ball-desktop-pet/releases/latest';
const RELEASE_PAGE = 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/tag/';
const release = tag_name => ({ tag_name, draft: false, prerelease: false });

test('stable versions compare all three numeric parts and always use the official request and release page', async () => {
  for (const [current, latest, hasUpdate] of [
    ['0.3.9', 'v0.3.10', true], ['v0.3.10', '0.3.10', false],
    ['0.3.10', 'v0.3.9', false], ['0.3.99', 'v0.4.0', true], ['1.0.0', 'v0.99.99', false]
  ]) {
    const metadata = { ...release(latest), html_url: 'https://evil.example/download',
      assets: [{ browser_download_url: 'https://evil.example/app' }] };
    Object.defineProperty(metadata, 'body', { get() { throw new Error('release body must not be read'); } });
    const result = await checkLatestRelease(current, { get: async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.deepEqual(options, { headers: { 'User-Agent': `Qiuqiu/${current.replace(/^v/, '')}`,
        Accept: 'application/vnd.github+json' } });
      return metadata;
    } });
    assert.deepEqual(result, { currentVersion: current.replace(/^v/, ''), latestVersion: latest.replace(/^v/, ''),
      hasUpdate, url: RELEASE_PAGE + latest });
  }
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
