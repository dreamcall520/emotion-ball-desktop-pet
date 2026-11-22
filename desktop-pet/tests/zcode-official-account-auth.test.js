'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createZcodeOfficialAccountAuth, officialAccountScope } = require('../lib/zcode-team-auth');
const { readZcodeAccount } = require('../lib/zcode-account');
const { fetchZcodeUsage, normalizeCodingPlanQuota } = require('../lib/zcode-usage');
const NOW = 1795300000000;
const sha = value => createHash('sha256').update(value).digest('hex');
const personal = { accountKey: 'personal', family: 'zai', accountId: 'account', accountIdentity: 'account', zcodeUserId: 'zcode-user',
  sessionRevision: 'revision', accessToken: 'oauth-session', jwtToken: 'zcode-session',
  selection: { kind: 'individual-coding-plan', scope: 'personal' } };
const team = { ...personal, family: 'bigmodel', selection: { kind: 'team-coding-plan', scope: 'team', organizationId: 'org', projectId: 'team', productId: 'coding-team' } };
function fixture({ keys, gate, info, entitlement, token } = {}) {
  const requests = []; let issued = 0, clock = NOW;
  const resolver = createZcodeOfficialAccountAuth(async (url, options) => {
    requests.push({ url, options }); if (gate) await gate(url, options);
    let data;
    if (url.endsWith('/getCustomerInfo')) data = info || { organizations: [
      { organizationId: 'team-only', projects: [{ projectId: 'foreign-team', projectType: 2 }] },
      { organizationId: 'org', organizationName: '默认机构', projects: [
        { projectId: 'team', projectType: 2 }, { projectId: 'personal-other', projectType: 1 }, { projectId: 'personal', projectName: '默认项目', projectType: 1 }
      ] }
    ] };
    else if (url.endsWith('/querySubscribeDetail')) data = entitlement || { hasSubscription: true, status: 'EFFECTIVE', memberGrantStatus: 'VALID' };
    else if (url.endsWith('/api_keys')) data = keys || [
      { name: 'another-app', apiKey: 'unrelated-key' }, { name: 'zcode-api-key', apiKey: 'personal-id' }, { name: 'zcode-team-api-key', keyType: 2, apiKey: 'team-id' }
    ];
    else if (url.endsWith('/access_tokens')) data = token || { accessToken: `short-token-${++issued}`, tokenType: 'Bearer', expiresIn: 3600, expiresAt: clock / 1000 + 3600 };
    else throw new Error('Unexpected fixture request');
    return { code: 200, data };
  }, { now: () => clock });
  return { resolver, requests, tick: value => { clock += value; } };
}

test('个人OAuth只选非团队默认项目和现有ZCode key，唯一POST仅交换短期会话token', async () => {
  const f = fixture(), result = await f.resolver(personal, { appVersion: '3.18.2' });
  assert.equal(result.codingPlanApiKey, 'short-token-1'); assert.equal(result.codingPlanApiKeyId, 'personal-id');
  assert.equal(result.codingPlanProjectToken, true); assert.equal(result.codingPlanQuotaOrigin, 'https://api.z.ai');
  assert.equal(f.requests.length, 3); assert.equal(f.requests[0].options.headers.Authorization, 'oauth-session');
  assert.match(f.requests[1].url, /organization\/org\/projects\/personal\/api_keys$/);
  assert.equal(f.requests[1].options.headers.Authorization, 'Bearer oauth-session');
  const post = f.requests[2]; assert.match(post.url, /api_keys\/personal-id\/access_tokens$/);
  assert.deepEqual(JSON.parse(post.options.body), { clientType: 'zcode', clientVersion: '3.18.2' });
  assert.equal(post.options.headers.Authorization, 'Bearer oauth-session');
  assert.equal(f.requests.filter(row => row.options.method === 'POST').length, 1);
});

test('团队只使用当前选中组织项目，保留席位校验和相应OAuth/project-token边界', async () => {
  const f = fixture(), result = await f.resolver(team, { appVersion: '3.18.2' });
  assert.equal(f.requests.length, 4); assert.ok(f.requests.every(row => row.url.startsWith('https://bigmodel.cn/')));
  assert.equal(f.requests[1].options.headers['Bigmodel-Organization'], 'org');
  assert.equal(f.requests[2].options.headers['Bigmodel-Project'], 'team');
  assert.equal(f.requests[2].options.headers.Authorization, 'oauth-session');
  assert.equal(result.codingPlanApiKeyId, 'team-id'); assert.equal(result.codingPlanQuotaOrigin, 'https://open.bigmodel.cn');
});

test('缺已有key或个人只含团队项目时不创建key、不切其他计费来源', async () => {
  for (const [options, account, code] of [
    [{ keys: [] }, personal, 'ZCODE_PERSONAL_KEY_MISSING'], [{ keys: [] }, team, 'ZCODE_TEAM_KEY_MISSING'],
    [{ info: { organizations: [{ organizationId: 'org', projects: [{ projectId: 'team', projectType: 2 }] }] } }, personal, 'ZCODE_PERSONAL_PROJECT_UNAVAILABLE']
  ]) {
    const f = fixture(options); await assert.rejects(f.resolver(account), { code });
    assert.ok(f.requests.every(row => row.options.method !== 'POST'));
  }
});

test('新official scope覆盖sessionRevision、账号映射与当前项目，旧fingerprint不误伤新token', async () => {
  const expected = sha(JSON.stringify(['zai', 'individual-coding-plan', null, 'oauth-session', 'zcode-session', 'revision', 'account', 'zcode-user']));
  assert.equal(officialAccountScope(personal), expected);
  for (const fields of [{ sessionRevision: 'next' }, { accountIdentity: 'linked-account' }, { zcodeUserId: 'next-user' }, { accessToken: 'next-oauth' }]) {
    assert.notEqual(officialAccountScope({ ...personal, ...fields }), expected);
  }
  const f = fixture(), first = await f.resolver(personal), opts = { expectedAccountScope: expected, rejectedProjectTokenFingerprint: sha(first.codingPlanApiKey) };
  const [next, joined] = await Promise.all([f.resolver(personal, opts), f.resolver(personal, opts)]);
  assert.notEqual(next.codingPlanApiKey, first.codingPlanApiKey); assert.equal(next.codingPlanApiKey, joined.codingPlanApiKey);
  assert.equal((await f.resolver(personal, opts)).codingPlanApiKey, next.codingPlanApiKey);
  assert.equal(f.requests.filter(row => row.options.method === 'POST').length, 2);
});

test('交换token期间切账号或取消，迟到token不能交付且可重新连接', async () => {
  let entered, finish; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ gate: async url => { if (url.endsWith('/access_tokens')) { entered(); await gate; } } });
  let latest = personal;
  const pending = f.resolver(personal, { readAccount: async () => latest });
  const rejected = assert.rejects(pending, { code: 'ZCODE_LOGIN_REQUIRED' }); await started;
  latest = { ...personal, sessionRevision: 'next' }; finish(); await rejected;
  const fresh = await f.resolver(latest); assert.ok(fresh.codingPlanApiKey);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.resolver(latest, { signal: controller.signal }), { code: 'DISCONNECTED' });
});

test('个人无本地key仍可按当前OAuth交换会话token查询付费quota，与Start空桶分开', async () => {
  const calls = []; let tokenIssued = false;
  const result = await fetchZcodeUsage({ ...personal, deviceMid: 'device' }, { now: NOW, appVersion: '3.18.2', fetch: async (url, options) => {
    calls.push({ url, options }); let data;
    if (url.endsWith('/getCustomerInfo')) data = { organizations: [{ organizationId: 'org', projects: [{ projectId: 'personal', projectType: 1 }] }] };
    else if (url.endsWith('/api_keys')) data = [{ name: 'zcode-api-key', apiKey: 'key-id' }];
    else if (url.endsWith('/access_tokens')) { tokenIssued = true; data = { accessToken: 'short-session', tokenType: 'Bearer', expiresIn: 3600, expiresAt: Date.now() / 1000 + 3600 }; }
    else if (url.includes('/billing/balance')) data = { plans: [], balances: [] };
    else if (url.endsWith('/quota/limit')) {
      assert.equal(tokenIssued, true); assert.equal(options.headers.Authorization, 'short-session');
      data = { level: 'Coding Pro', limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 1, nextResetTime: NOW + 3600000 }] };
    } else throw new Error('Unexpected request');
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data }) };
  } });
  assert.equal(result.balanceState, 'empty'); assert.equal(result.paidState, 'connected');
  assert.equal(result.buckets[0].remaining, 99); assert.equal(result.buckets[0].planName, 'Coding Pro');
  assert.equal(calls.filter(row => row.options.method === 'POST').length, 1);
  assert.equal(JSON.stringify(result).includes('short-session'), false);
});

test('严格账户仅采用当前session及可核对userId的linked BigModel，不借缓存账号', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-current-session-')), dir = path.join(home, '.zcode/v2');
  t.after(() => fs.rmSync(home, { recursive: true, force: true })); fs.mkdirSync(dir, { recursive: true });
  const raw = { 'oauth:active_provider': 'zai_cn', 'oauth:zai_cn:access_token': 'active-zcode-oauth',
    'oauth:zai_cn:user_info': JSON.stringify({ user_id: 'zcode-user' }), zcodejwttoken: 'zcode-jwt', 'oauth:session_revision': 'revision',
    'oauth:bigmodel:access_token': 'previous-cached-oauth', 'oauth:bigmodel:user_info': JSON.stringify({ id: 'previous-account' }),
    'oauth:linked_bigmodel': JSON.stringify({ userId: 'zcode-user', customerId: 'linked-customer', accessToken: 'current-maas-oauth' }) };
  const file = path.join(dir, 'credentials.json'); fs.writeFileSync(file, JSON.stringify(raw));
  fs.writeFileSync(path.join(dir, 'setting.json'), JSON.stringify({ providerFamilyDomain: 'bigmodel', providerFamilyConnectionSelections: { bigmodel: team.selection } }));
  const account = readZcodeAccount({ home, env: {}, requireScopedApiKey: true });
  assert.equal(account.accountId, 'linked-customer'); assert.equal(account.zcodeUserId, 'zcode-user');
  assert.equal(account.accessToken, 'current-maas-oauth'); assert.equal(account.jwtToken, 'zcode-jwt'); assert.equal(account.sessionRevision, 'revision');
  raw['oauth:linked_bigmodel'] = JSON.stringify({ userId: 'different-user', customerId: 'linked-customer', accessToken: 'current-maas-oauth' });
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => readZcodeAccount({ home, env: {}, requireScopedApiKey: true }), { code: 'ZCODE_LOGIN_REQUIRED' });
});

test('额度百分比跟随原厂server percentage，精确单位余额不覆盖官方展示口径', () => {
  const rows = normalizeCodingPlanQuota({ data: { limits: [
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 1, usage: 1000, remaining: 999, nextResetTime: NOW + 3600000 },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 6, usage: 1000, remaining: 933.7870967741935, nextResetTime: NOW + 86400000 }
  ] } }, NOW);
  assert.deepEqual(rows.map(row => row.remaining), [99, 94]);
  assert.deepEqual(rows.map(row => row.remainingUnits), [999, 933.7870967741935]);
  assert.equal(new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(rows[1].remaining), '94');
});
