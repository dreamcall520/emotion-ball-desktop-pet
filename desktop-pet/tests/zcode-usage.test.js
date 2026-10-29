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
  const selection = { kind: 'team-coding-plan', productId: 'product2', organizationId: 'org1', projectId: 'proj1', scope: 'personal', providerId: 'wrong' };
  fs.writeFileSync(path.join(dir, 'setting.json'), JSON.stringify({ providerFamilyConnectionSelections: { zai: selection } }));
  const switched = readZcodeAccount({ home, env });
  assert.equal(switched.selection.scope, 'team'); assert.equal(switched.selection.providerId, account.selection.providerId);
  assert.notEqual(switched.accountKey, account.accountKey); assert.equal(switched.codingPlanApiKey, null);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ provider: { 'builtin:zai-coding-plan': {
    enabled: true, options: { apiKey: 'old-personal-paid-key', baseURL: 'https://api.z.ai/api/anthropic' } } } }));
  assert.equal(readZcodeAccount({ home, env }).codingPlanApiKey, null);
  raw['oauth:zai:user_info'] = encrypted(JSON.stringify({ user_id: 'account-2' }), env.ZCODE_CREDENTIAL_SECRET);
  fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify(raw));
  assert.equal(readZcodeAccount({ home, env }).codingPlanApiKey, null);
  assert.notEqual(readZcodeAccount({ home, env }).accountKey, account.accountKey); fs.rmSync(home, { recursive: true });
});
test('paid team quota sends only selected scope to the corresponding official host', async () => {
  const response = await fetchZcodeUsage({ family: 'bigmodel', codingPlanApiKey: 'paid-key', jwtToken: 'personal-jwt', deviceMid: 'mid',
    selection: { scope: 'team', productId: 'product1', organizationId: 'org1', projectId: 'proj1' } },
    { now, resolveTeamAccount: async account => account, fetch: async (url, init) => {
      assert.equal(url, 'https://bigmodel.cn/api/monitor/usage/quota/limit?type=2');
      assert.equal(init.headers.Authorization, 'paid-key');
      assert.equal(init.headers['Bigmodel-Organization'], 'org1'); assert.equal(init.headers['Bigmodel-Project'], 'proj1');
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: { limits: [
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 10, nextResetTime: now + 86400000 } ] } }) };
    } });
  assert.equal(response.paidState, 'connected'); assert.equal(response.buckets[0].unit, 'credits'); assert.equal(response.buckets[0].remaining, 90);
  assert.equal(response.balanceState, 'unavailable'); assert.match(response.buckets[0].planName, /团队/);
});
test('team auth failure cannot fall back to a personal balance or a personal quota request', async () => {
  let calls = 0;
  await assert.rejects(fetchZcodeUsage({ family: 'bigmodel', jwtToken: 'jwt', deviceMid: 'mid', codingPlanApiKey: 'old-personal-key',
    selection: { kind: 'team-coding-plan', scope: 'team', productId: 'p', organizationId: 'o' } },
    { fetch: async () => { calls++; } }), { code: 'ZCODE_TEAM_SELECTION_REQUIRED' });
  assert.equal(calls, 0);
});
test('official HTTP transport allows token minting but rejects key creation before sending', async () => {
  const base = 'https://bigmodel.cn/api/biz/v1/organization/org/projects/proj/api_keys'; let calls = 0;
  const fetch = async (url, init) => { calls++; assert.equal(url, `${base}/existing/access_tokens`);
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.body, '{"clientType":"zcode"}');
    return { ok: true, status: 200, text: async () => '{"code":200}' }; };
  await assert.rejects(requestOfficialJson(base, { method: 'POST', fetch }), { code: 'ZCODE_UNTRUSTED_ENDPOINT' });
  await requestOfficialJson(`${base}/existing/access_tokens`, { method: 'POST', body: '{"clientType":"zcode"}', fetch });
  assert.equal(calls, 1);
});
test('explicit provider family selects its own OAuth profile and never borrows the active-family JWT', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-family-'));
  try {
    const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify({ 'oauth:active_provider': 'zai', zcodejwttoken: 'zai-jwt',
      'oauth:bigmodel:access_token': 'bigmodel-oauth', 'oauth:bigmodel:user_info': JSON.stringify({ id: 'bigmodel-id' }) }));
    fs.writeFileSync(path.join(dir, 'setting.json'), JSON.stringify({ providerFamilyDomain: 'bigmodel',
      providerFamilyConnectionSelections: { bigmodel: { kind: 'team-coding-plan', productId: 'p', organizationId: 'o', projectId: 'j' } } }));
    const account = readZcodeAccount({ home, env: {} });
    assert.equal(account.family, 'bigmodel'); assert.equal(account.accountId, 'bigmodel-id');
    assert.equal(account.jwtToken, null); assert.equal(account.accessToken, 'bigmodel-oauth');
    assert.equal(account.selection.providerId, 'account:bigmodel-team-coding-plan');
  } finally { fs.rmSync(home, { recursive: true }); }
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
test('team discovery, token minting and both quota windows work end to end without local team keys', async () => {
  const observed = []; const instant = Date.now();
  const account = { accountKey: 'e2e-team', accountId: 'e2e-member', family: 'bigmodel', accessToken: 'e2e-oauth',
    jwtToken: 'personal-jwt', deviceMid: 'mid', codingPlanApiKey: null,
    selection: { kind: 'team-coding-plan', scope: 'team', productId: 'product', organizationId: 'org', projectId: 'project' } };
  const result = await fetchZcodeUsage(account, { now: instant, fetch: async (url, init) => {
    observed.push({ url, method: init.method }); let data;
    if (url.endsWith('/getCustomerInfo')) data = { organizations: [{ organizationId: 'org', projects: [{ projectId: 'project', projectType: 2 }] }] };
    else if (url.endsWith('/querySubscribeDetail')) data = { status: 'EFFECTIVE', memberGrantStatus: 'VALID', hasSubscription: true };
    else if (url.endsWith('/api_keys')) data = [{ name: 'zcode-team-api-key', keyType: 2, apiKey: 'key-id' }];
    else if (url.endsWith('/key-id/access_tokens')) data = { enable: true, accessToken: 'runtime-token', tokenType: 'Bearer', expiresIn: 3600, expiresAt: instant / 1000 + 3600 };
    else if (url.endsWith('/quota/limit?type=2')) {
      assert.equal(init.headers.Authorization, 'runtime-token'); assert.equal(init.headers['Bigmodel-Organization'], 'org');
      data = { limits: [
        { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 30, nextResetTime: instant + 3600000 },
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 22, nextResetTime: instant + 4 * 86400000 }
      ] };
    } else throw new Error('Unexpected request');
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 200, success: true, data }) };
  } });
  assert.equal(observed.length, 5); assert.equal(observed.filter(row => row.method === 'POST').length, 1);
  assert.deepEqual(result.buckets.map(row => [row.windowMinutes, row.remaining]), [[300, 70], [10080, 78]]);
  assert.equal(result.balanceState, 'unavailable'); assert.equal(account.codingPlanApiKey, null);
  for (const secret of ['e2e-oauth', 'runtime-token', 'personal-jwt', 'key-id']) assert.equal(JSON.stringify(result).includes(secret), false);
});
