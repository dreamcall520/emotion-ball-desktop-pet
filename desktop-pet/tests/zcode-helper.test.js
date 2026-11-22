'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createHash, createCipheriv, randomBytes } = require('node:crypto');
const { createAccountReader, projectAccount, runOperation } = require('../lib/zcode-helper.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'zcode-safe-helper-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '.zcode'), v2 = path.join(directory, 'v2'); await fs.mkdir(v2, { recursive: true });
  const key = randomBytes(32), fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 24);
  function encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([cipher.update(value), cipher.final()]);
    return 'enc:v2:os:' + fingerprint + ':' + [iv, cipher.getAuthTag(), data].map(bytes => bytes.toString('base64url')).join('.'); }
  const credentials = { 'oauth:active_provider': encrypt('zai'), 'oauth:zai:access_token': encrypt('SYNTHETIC_OAUTH_NOT_REAL'),
    zcodejwttoken: encrypt('SYNTHETIC_JWT_NOT_REAL'), 'oauth:zai:user_info': encrypt(JSON.stringify({ id: 'synthetic-user' })) };
  await fs.writeFile(path.join(v2, 'credentials.json'), JSON.stringify(credentials));
  await fs.writeFile(path.join(v2, 'setting.json'), JSON.stringify({ providerFamilyDomain: 'zai', providerFamilyConnectionSelections: { zai: { kind: 'individual-coding-plan' } } }));
  await fs.writeFile(path.join(v2, 'telemetry-state.json'), JSON.stringify({ deviceMid: 'synthetic-device' }));
  let gets = 0;
  return { directory, v2, key, credentials, getExistingKey: async () => { gets++; return key.toString('base64url'); }, gets: () => gets };
}
test('OS v2 decrypts within helper memory and returns only safe account metadata', async t => {
  const f = await fixture(t), file = path.join(f.v2, 'credentials.json'), before = await fs.readFile(file);
  const reader = await createAccountReader(f), a = await reader.read(), projected = projectAccount(a);
  assert.equal(a.jwtToken, 'SYNTHETIC_JWT_NOT_REAL'); assert.equal(projected.hasJwtToken, true); assert.equal(projected.hasAccessToken, true);
  assert.equal(projected.selection.kind, 'individual-coding-plan'); assert.match(projected.accountKey, /^[a-f0-9]{64}$/);
  for (const privateField of ['jwtToken', 'accessToken', 'codingPlanApiKey', 'accountId', 'credentialsPath', 'deviceMid']) assert.equal(projected[privateField], undefined);
  assert.equal(JSON.stringify(projected).includes('SYNTHETIC'), false); await reader.read(); assert.equal(f.gets(), 1);
  assert.deepEqual(await fs.readFile(file), before); reader.close();
});
test('missing existing OS key and mismatched fingerprints fail without creating or rewriting credentials', async t => {
  for (const scenario of ['missing', 'mismatch']) {
    const f = await fixture(t), before = await fs.readFile(path.join(f.v2, 'credentials.json'));
    const reader = await createAccountReader({ ...f, getExistingKey: async () => scenario === 'missing' ? null : Buffer.alloc(32, 1).toString('base64url') });
    await assert.rejects(reader.read(), { code: scenario === 'missing' ? 'ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED' : 'ZCODE_CREDENTIAL_DECRYPT_FAILED' });
    assert.deepEqual(await fs.readFile(path.join(f.v2, 'credentials.json')), before); reader.close();
  }
});
test('usage performs read-only official GET and strips credentials from projected results', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.v2, 'setting.json'), JSON.stringify({ providerFamilyDomain: 'zai', providerFamilyConnectionSelections: { zai: { kind: 'start-plan' } } }));
  const reader = await createAccountReader(f), a = await reader.read(), requests = [];
  const value = await runOperation('usage', { expectedAccountKey: a.accountKey }, { reader, appVersion: '3.18.2', now: 1000,
    fetch: async (url, options) => { requests.push({ url, method: options.method }); assert.equal(options.headers.Authorization, 'Bearer SYNTHETIC_JWT_NOT_REAL');
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { balances: [], plans: [] } }) }; } });
  assert.deepEqual(requests, [{ url: 'https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.18.2', method: 'GET' }]);
  assert.equal(value.accountKey, a.accountKey); assert.equal(value.balanceState, 'empty'); assert.equal(value.updatedAt, 1000);
  assert.equal(JSON.stringify(value).includes('SYNTHETIC'), false); reader.close();
});
test('quota late results cannot survive account/token changes and incomplete team selection cannot exchange tokens', async () => {
  const initial = { accountKey: 'a'.repeat(64), family: 'zai', jwtToken: 'synthetic', deviceMid: 'synthetic', selection: { kind: 'start-plan', scope: 'personal' } };
  let reads = 0;
  await assert.rejects(runOperation('usage', { expectedAccountKey: initial.accountKey }, { appVersion: '3.18.2', reader: { read: async () => ++reads === 1 ? initial : { ...initial, jwtToken: 'new' } },
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { balances: [], plans: [] } }) }) }), { code: 'ZCODE_ACCOUNT_CHANGED' });
  let requests = 0;
  await assert.rejects(runOperation('usage', { expectedAccountKey: initial.accountKey }, { appVersion: '3.18.2', reader: { read: async () => ({ ...initial, selection: { kind: 'team-coding-plan', scope: 'team' } }) },
    fetch: async () => { requests++; } }), { code: 'ZCODE_TEAM_SELECTION_REQUIRED' }); assert.equal(requests, 0);
});
