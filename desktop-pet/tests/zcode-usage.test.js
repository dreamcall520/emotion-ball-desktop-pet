const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readZcodeAccount } = require('../lib/zcode-account');
const { normalizeZcodeBalance, normalizeCodingPlanQuota, fetchZcodeUsage, requestOfficialJson } = require('../lib/zcode-usage');
const fixture = require('./fixtures/zcode-balance.json');
const now = fixture.server_time * 1000;
function encrypted(value, secret) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), iv);
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
test('native encrypted credentials stay read only and account key remains stable across token refresh', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-account-'));
  const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'credentials.json'); const env = { ZCODE_CREDENTIAL_SECRET: 'test-secret' };
  const raw = { 'oauth:active_provider': encrypted('zai', env.ZCODE_CREDENTIAL_SECRET),
    zcodejwttoken: encrypted('jwt-first', env.ZCODE_CREDENTIAL_SECRET),
    'oauth:zai:user_info': encrypted(JSON.stringify({ user_id: 'account-1' }), env.ZCODE_CREDENTIAL_SECRET) };
  fs.writeFileSync(file, JSON.stringify(raw)); fs.writeFileSync(path.join(dir, 'telemetry-state.json'), JSON.stringify({ deviceMid: 'native-device' }));
  const before = fs.readFileSync(file, 'utf8'); const account = readZcodeAccount({ home, env });
  assert.equal(account.jwtToken, 'jwt-first'); assert.equal(account.deviceMid, 'native-device'); assert.equal(account.family, 'zai');
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.match(account.accountKey, /^[a-f0-9]{64}$/);
  raw.zcodejwttoken = encrypted('jwt-second', env.ZCODE_CREDENTIAL_SECRET); fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(readZcodeAccount({ home, env }).accountKey, account.accountKey);
  assert.throws(() => readZcodeAccount({ home, env: { ZCODE_CREDENTIAL_SECRET: 'wrong' } }), /ZCODE_CREDENTIAL_DECRYPT_FAILED/);
  fs.rmSync(home, { recursive: true });
});
test('balance normalizes each actual bucket independently, expiry is never called reset', () => {
  const buckets = normalizeZcodeBalance(fixture, now);
  assert.equal(buckets.length, 4); assert.equal(new Set(buckets.map(row => row.id)).size, 4);
  const once = buckets.find(row => row.total === 200000000);
  assert.equal(once.remaining, 100); assert.equal(once.remainingUnits, 200000000); assert.equal(once.periodKind, 'one_time');
  assert.equal(once.windowMinutes, (1792976400 - 1792844679) / 60);
  assert.equal(buckets.find(row => row.total === 3000000).periodKind, 'daily');
  assert.equal(normalizeZcodeBalance({ ...fixture, plans: fixture.plans.map(row => ({ ...row, status: 'expired' })) }, now).length, 0);
  assert.equal(normalizeZcodeBalance({ ...fixture, balances: [fixture.balances[0], fixture.balances[0]] }, now).length, 1);
  assert.deepEqual(normalizeZcodeBalance({ ...fixture, balances: [{ ...fixture.balances[0], remaining_units: NaN }] }, now), []);
});
test('official requests reject auth redirects and untrusted hosts before fetch', async () => {
  let calls = 0;
  await assert.rejects(requestOfficialJson('https://evil.example/balance', { fetch: () => { calls++; } }), /ZCODE_UNTRUSTED_ENDPOINT/);
  assert.equal(calls, 0);
  await assert.rejects(requestOfficialJson('https://zcode.z.ai/api/v1/x', { fetch: async (_url, init) => {
    assert.equal(init.redirect, 'error'); return { ok: false, status: 302 };
  } }), /ZCODE_HTTP_ERROR/);
});
test('billing endpoint uses native device and jwt only, returns no credentials', async () => {
  const response = await fetchZcodeUsage({ jwtToken: 'secret-jwt', deviceMid: 'native-mid' }, { now, fetch: async (url, init) => {
    assert.match(url, /^https:\/\/zcode.z.ai\/api\/v1\/zcode-plan\/billing\/balance/);
    assert.equal(init.headers.Authorization, 'Bearer secret-jwt'); assert.equal(init.headers['x-device-mid'], 'native-mid');
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: fixture }) };
  } });
  assert.equal(response.buckets.length, 4); assert.deepEqual(response.modelIds, ['glm-5.3', 'glm-5.3-flash']);
  assert.equal(JSON.stringify(response).includes('secret-jwt'), false);
});
test('paid windows use server spans, MCP remains separate and missing windows stay missing', () => {
  const buckets = normalizeCodingPlanQuota({ data: { limits: [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25, nextResetTime: now + 3600000 },
    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 10, nextResetTime: now + 86400000 }
  ] } }, now);
  assert.equal(buckets[0].windowMinutes, 300); assert.equal(buckets[0].remaining, 75);
  assert.equal(buckets[1].meter, 'tool_usage'); assert.equal(buckets[1].windowMinutes, null); assert.equal(buckets[1].periodStart, null);
  assert.deepEqual(normalizeCodingPlanQuota({ data: { limits: [] } }, now), []);
});
test('native scoped paid credentials follow the exact selected account and team, without creating a key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-scope-')); const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
  const env = { ZCODE_CREDENTIAL_SECRET: 'scoped-secret' };
  const raw = { 'oauth:active_provider': encrypted('zai', env.ZCODE_CREDENTIAL_SECRET), zcodejwttoken: encrypted('jwt', env.ZCODE_CREDENTIAL_SECRET),
    'oauth:zai:user_info': encrypted(JSON.stringify({ user_id: 'account-1' }), env.ZCODE_CREDENTIAL_SECRET),
    'account-provider:team:account%3Azai-team-coding-plan:product1:org1:proj1:account:account-1:api-key': encrypted('actual-paid-key', env.ZCODE_CREDENTIAL_SECRET) };
  fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(dir, 'setting.json'), JSON.stringify({ providerFamilyDomain: 'zai', providerFamilyConnectionSelections: { zai: {
    kind: 'team-coding-plan', productId: 'product1', organizationId: 'org1', projectId: 'proj1' } } }));
  const account = readZcodeAccount({ home, env }); assert.equal(account.selection.scope, 'team');
  assert.equal(account.selection.providerId, 'account:zai-team-coding-plan'); assert.equal(account.codingPlanApiKey, 'actual-paid-key');
  raw['oauth:zai:user_info'] = encrypted(JSON.stringify({ user_id: 'account-2' }), env.ZCODE_CREDENTIAL_SECRET);
  fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify(raw));
  assert.equal(readZcodeAccount({ home, env }).codingPlanApiKey, null);
  assert.notEqual(readZcodeAccount({ home, env }).accountKey, account.accountKey); fs.rmSync(home, { recursive: true });
});
test('paid team quota sends only selected scope to the corresponding official host', async () => {
  const response = await fetchZcodeUsage({ family: 'bigmodel', codingPlanApiKey: 'paid-key',
    selection: { scope: 'team', organizationId: 'org1', projectId: 'proj1' } }, { now, fetch: async (url, init) => {
      assert.equal(url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2');
      assert.equal(init.headers['Bigmodel-Organization'], 'org1'); assert.equal(init.headers['Bigmodel-Project'], 'proj1');
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: { limits: [
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 10, nextResetTime: now + 86400000 } ] } }) };
    } });
  assert.equal(response.paidState, 'connected'); assert.equal(response.buckets[0].unit, 'credits'); assert.equal(response.buckets[0].remaining, 90);
});
test('a balance outage cannot hide an independently successful paid quota', async () => {
  let calls = 0;
  const response = await fetchZcodeUsage({ jwtToken: 'jwt', deviceMid: 'mid', family: 'zai', codingPlanApiKey: 'paid-key' },
    { now, fetch: async url => {
      calls++;
      if (url.includes('/billing/balance')) return { ok: false, status: 503 };
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: { limits: [
        { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 20, nextResetTime: now + 3600000 } ] } }) };
    } });
  assert.equal(calls, 2); assert.equal(response.balanceState, 'error'); assert.equal(response.paidState, 'connected'); assert.equal(response.buckets[0].remaining, 80);
});
