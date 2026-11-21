'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { readAuth, execute } = require('../lib/workbuddy-helper.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'mas-workbuddy-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'CodeBuddyExtension/Data/Public/auth'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'workbuddy-desktop.info');
  const session = { account: { uid: 'synthetic-user', type: 'personal' },
    auth: { domain: 'www.workbuddy.cn', accessToken: 'synthetic-access-token-no-real-credential', refreshToken: 'synthetic-refresh-token-no-real-credential' } };
  await fs.writeFile(file, JSON.stringify(session)); let storageCalls = 0;
  const options = { directory, platform: 'darwin', readStorage() {
    storageCalls++; return JSON.stringify({ version: 1, atRestSecretKey: Buffer.alloc(32, 1).toString('base64') });
  } };
  return { root, directory, file, session, options, get storageCalls() { return storageCalls; } };
}
test('explicit authorized auth directory supplies account instead of the sandbox home', async t => {
  const f = await fixture(t), value = readAuth(false, f.options);
  assert.equal(value.token, f.session.auth.accessToken); assert.equal(value.uid, 'synthetic-user');
  assert.match(value.accountKey, /^[0-9a-f]{64}$/); assert.equal(value.refreshToken, undefined);
  assert.equal(readAuth(true, f.options).refreshToken, f.session.auth.refreshToken); assert.equal(f.storageCalls, 2);
});
test('symlink credentials, logout marker and wrong auth directory fail before native key access', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside.json'); await fs.rename(f.file, outside); await fs.symlink(outside, f.file);
  assert.throws(() => readAuth(false, f.options), { code: 'UNSUPPORTED_AUTH' }); assert.equal(f.storageCalls, 0);
  await fs.unlink(f.file); await fs.rename(outside, f.file); await fs.writeFile(f.file + '.logged-out', '');
  assert.throws(() => readAuth(false, f.options), { code: 'LOGIN_REQUIRED' }); assert.equal(f.storageCalls, 0);
  assert.throws(() => readAuth(false, { ...f.options, directory: f.root }), { code: 'UNSUPPORTED_AUTH' });
});

test('helper reads the explicit runner environment directory without a default sandbox-home fallback', async t => {
  const f = await fixture(t), previous = process.env.QIUQIU_WORKBUDDY_AUTH_DIRECTORY;
  process.env.QIUQIU_WORKBUDDY_AUTH_DIRECTORY = f.directory;
  try { assert.equal(readAuth(false, { platform: 'darwin', readStorage: f.options.readStorage }).uid, 'synthetic-user'); }
  finally {
    if (previous === undefined) delete process.env.QIUQIU_WORKBUDDY_AUTH_DIRECTORY;
    else process.env.QIUQIU_WORKBUDDY_AUTH_DIRECTORY = previous;
  }
});

test('account changes during a personal usage response cannot publish the prior account statistics', async () => {
  const originalFetch = global.fetch, first = 'a'.repeat(64); let current = first;
  const response = (data, status = 200, extra = {}) => ({ ok: status >= 200 && status < 300, status,
    body: require('node:stream').Readable.from([Buffer.from(JSON.stringify(data))]),
    headers: { get: name => name === 'location' ? extra.location || null : null, getSetCookie: () => extra.cookies || [] } });
  global.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/v2/plugin/device/auth/code') return response({ code: 0, data: { deviceCode: 'synthetic-device-code' } });
    if (url.pathname === '/console/client-login') return response({}, 302, { location: '/profile/plans-usage', cookies: ['website=synthetic; Domain=.workbuddy.cn; Path=/; Secure'] });
    if (url.pathname === '/profile/plans-usage') return response({});
    assert.equal(url.pathname, '/billing/meter/get-user-request-usage'); current = 'b'.repeat(64);
    return response({ code: 0, data: { total: 0, data: [] } });
  };
  try {
    await assert.rejects(execute('usage', { expectedAccountKey: first }, () => {}, { authReader: () => ({ scope: 'personal',
      accountKey: current, uid: 'synthetic', domain: 'www.workbuddy.cn', token: 'synthetic-access-token-not-real', refreshToken: 'synthetic-refresh-token-not-real' }) }),
    { code: 'ACCOUNT_CHANGED', accountKey: first });
  } finally { global.fetch = originalFetch; }
});
