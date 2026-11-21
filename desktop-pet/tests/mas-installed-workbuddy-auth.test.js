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
test('account-check verifies only current local identity with no HTTP/model operation or secret result',async()=>{
 const previous=global.fetch;let networkCalls=0,reads=0;global.fetch=async()=>{networkCalls++;throw Error('network must not run');};
 const key='a'.repeat(64),auth={accountKey:key,uid:'synthetic-private',scope:'personal',token:'synthetic-private'};
 try{
  const result=await execute('account-check',{expectedAccountKey:key},()=>{},{authReader:()=>{reads++;return{...auth};}});
  assert.deepEqual(result,{accountKey:key});assert.ok(reads>=2);assert.equal(networkCalls,0);
  await assert.rejects(execute('account-check',{expectedAccountKey:'b'.repeat(64)},()=>{},{authReader:()=>({...auth})}),{code:'ACCOUNT_CHANGED'});
  let index=0;await assert.rejects(execute('account-check',{expectedAccountKey:key},()=>{},{authReader:()=>({...auth,accountKey:index++?'b'.repeat(64):key})}),{code:'ACCOUNT_CHANGED'});
 }finally{global.fetch=previous;}
});

test('personal model and chat requests verify the expected local account before any HTTP', async () => {
  const previous = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw Error('HTTP must not run for the wrong account'); };
  try {
    for (const operation of ['models', 'chat']) await assert.rejects(execute(operation,
      { expectedAccountKey: 'b'.repeat(64) }, () => {}, { authReader: () => ({ scope: 'personal', accountKey: 'a'.repeat(64),
        uid: 'synthetic-user', domain: 'www.workbuddy.cn', token: 'synthetic-token-not-real' }) }), { code: 'ACCOUNT_CHANGED' });
    assert.equal(calls, 0);
  } finally { global.fetch = previous; }
});
test('personal chat rechecks local identity after model HTTP, on every SSE delta, and before final success', async () => {
  const previous = global.fetch, key = 'a'.repeat(64), { Readable } = require('node:stream');
  try {
    for (const change of ['models', 'delta', 'terminal']) {
      let current = key, posts = 0; const deltas = [];
      const event = text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
      const terminal = 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n';
      global.fetch = async input => {
        const pathname = new URL(input).pathname;
        if (pathname === '/v3/config') {
          if (change === 'models') current = 'b'.repeat(64);
          return { ok: true, status: 200, headers: { get: () => 'application/json' }, body: Readable.from([Buffer.from(JSON.stringify({ code: 0,
            data: { agents: [{ name: 'cli', models: ['auto'] }], models: [{ id: 'auto', name: '自动' }] } }))]) };
        }
        assert.equal(pathname, '/v2/chat/completions'); posts++;
        return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: (async function* () {
          yield Buffer.from(event('已核验的合成片段'));
          if (change === 'delta') current = 'b'.repeat(64);
          yield Buffer.from(event('后续片段') + terminal);
          if (change === 'terminal') current = 'b'.repeat(64);
        })() };
      };
      await assert.rejects(execute('chat', { expectedAccountKey: key, model: 'auto', conversationId: 'synthetic-turn',
        messages: [{ role: 'user', content: 'synthetic input, not sent outside this fixture' }] }, text => deltas.push(text),
      { authReader: () => ({ scope: 'personal', accountKey: current, uid: 'synthetic-user', domain: 'www.workbuddy.cn', token: 'synthetic-token-not-real' }) }),
      { code: 'ACCOUNT_CHANGED', accountKey: key });
      assert.equal(posts, change === 'models' ? 0 : 1);
      if (change === 'models') assert.deepEqual(deltas, []);
      if (change === 'delta') assert.deepEqual(deltas, ['已核验的合成片段']);
    }
  } finally { global.fetch = previous; }
});
