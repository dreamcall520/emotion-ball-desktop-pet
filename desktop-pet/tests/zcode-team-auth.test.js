const test = require('node:test'); const assert = require('node:assert/strict');
const { createZcodeTeamAuth } = require('../lib/zcode-team-auth');
const START = 1793000000000;
const account = { family: 'bigmodel', accountId: 'member1', accessToken: 'oauth-token', accountKey: 'account1',
  selection: { kind: 'team-coding-plan', scope: 'team', productId: 'product1', organizationId: 'org1', projectId: 'proj1' } };
function fixture(overrides = {}) {
  let clock = START; const requests = [];
  const resolver = createZcodeTeamAuth(async (url, init) => {
    requests.push({ url, init });
    if (overrides.request) await overrides.request(url, init);
    let data;
    if (url.endsWith('/getCustomerInfo')) data = overrides.info || { organizations: [{ organizationId: 'org1', projects: [{ projectId: 'proj1', projectType: 2 }] }] };
    else if (url.endsWith('/querySubscribeDetail')) data = overrides.entitlement || { hasSubscription: true, status: 'EFFECTIVE', memberGrantStatus: 'VALID' };
    else if (url.endsWith('/api_keys')) data = overrides.keys || [{ name: 'personal', keyType: 1, apiKey: 'wrong-id' }, { name: 'zcode-team-api-key', keyType: 2, apiKey: 'team-key-id' }];
    else if (url.endsWith('/team-key-id/access_tokens')) data = overrides.token || { enable: true, accessToken: `project-token-${clock}`, tokenType: 'Bearer', expiresIn: 3600, expiresAt: clock / 1000 + 3600 };
    else throw new Error('Unexpected endpoint');
    return { code: '200', data };
  }, { now: () => clock });
  return { resolver, requests, tick: delta => { clock += delta; } };
}
test('team auth uses official read-only discovery and mints only a token for the existing key ID', async () => {
  const h = fixture(); const original = JSON.stringify(account);
  const result = await h.resolver(account, { appVersion: '3.16.3' });
  assert.equal(result.codingPlanApiKey, `project-token-${START}`); assert.equal(JSON.stringify(account), original);
  assert.equal(h.requests.length, 4); assert.equal(h.requests.filter(row => row.init.method === 'POST').length, 1);
  assert.ok(h.requests.every(row => row.url.startsWith('https://bigmodel.cn/')));
  assert.equal(h.requests[0].init.headers.Authorization, 'oauth-token');
  assert.equal(h.requests[1].init.headers['Bigmodel-Organization'], 'org1');
  assert.equal(h.requests[2].init.headers.Authorization, 'oauth-token');
  const mint = h.requests[3]; assert.match(mint.url, /api_keys\/team-key-id\/access_tokens$/);
  assert.equal(mint.init.headers.Authorization, 'Bearer oauth-token');
  assert.equal(mint.init.headers['Bigmodel-Organization'], undefined);
  assert.deepEqual(JSON.parse(mint.init.body), { clientType: 'zcode', clientVersion: '3.16.3' });
});
test('Z.ai uses its own origin and entitlement Bearer auth', async () => {
  const h = fixture({ info: { organizations: [{ organizationId: 'org1', projects: [{ projectId: 'proj1', projectType: ' 2 ' }] }] } });
  await h.resolver({ ...account, family: 'zai', accessToken: 'Bearer oauth-token' });
  assert.ok(h.requests.every(row => row.url.startsWith('https://api.z.ai/')));
  assert.equal(h.requests[0].init.headers.Authorization, 'oauth-token');
  assert.equal(h.requests[1].init.headers.Authorization, 'Bearer oauth-token');
});
test('missing key, seat or project fails closed without creating a key or minting a token', async () => {
  for (const [overrides, code] of [
    [{ keys: [] }, 'ZCODE_TEAM_KEY_MISSING'],
    [{ entitlement: { status: 'EFFECTIVE', memberGrantStatus: 'UNASSIGNED' } }, 'ZCODE_TEAM_ACCESS_DENIED'],
    [{ entitlement: { status: 'EXPIRED', memberGrantStatus: 'VALID' } }, 'ZCODE_TEAM_ACCESS_DENIED'],
    [{ entitlement: { status: 'EFFECTIVE', memberGrantStatus: 'VALID' } }, 'ZCODE_INVALID_RESPONSE'],
    [{ entitlement: { hasSubscription: 'true', status: 'EFFECTIVE', memberGrantStatus: 'VALID' } }, 'ZCODE_INVALID_RESPONSE'],
    [{ info: { organizations: [] } }, 'ZCODE_TEAM_ACCESS_DENIED']
  ]) {
    const h = fixture(overrides); await assert.rejects(h.resolver(account), { code });
    assert.ok(h.requests.every(row => !row.init.method));
  }
});
test('disabled, expired and malformed runtime tokens are never returned or cached', async () => {
  for (const token of [
    { enable: false }, { accessToken: 'token', tokenType: 'Bearer', expiresIn: 100, expiresAt: START / 1000 - 1 },
    ...['false', null].map(enable => ({ enable, accessToken: 'token', tokenType: 'Bearer', expiresIn: 3600, expiresAt: START / 1000 + 3600 })),
    { accessToken: 'bad\r\ntoken', tokenType: 'Bearer', expiresIn: 1000, expiresAt: START / 1000 + 1000 }
  ]) {
    const h = fixture({ token }); await assert.rejects(h.resolver(account), { code: token.enable === false ? 'ZCODE_TEAM_ACCESS_DENIED' : 'ZCODE_INVALID_RESPONSE' });
    await assert.rejects(h.resolver(account)); assert.equal(h.requests.length, 8);
  }
});
test('runtime tokens share one flight, recheck entitlement and renew before expiry', async () => {
  const h = fixture(); const [a, b] = await Promise.all([h.resolver(account), h.resolver(account)]);
  assert.equal(a.codingPlanApiKey, b.codingPlanApiKey); assert.equal(h.requests.length, 4);
  await h.resolver(account); assert.equal(h.requests.length, 4);
  h.tick(120001); await h.resolver(account); assert.equal(h.requests.length, 6);
  h.tick(3400000); const renewed = await h.resolver(account); assert.notEqual(renewed.codingPlanApiKey, a.codingPlanApiKey);
  assert.equal(h.requests.length, 10);
});
test('OAuth rotation, product changes and explicit invalidation cannot reuse old token material', async () => {
  const h = fixture(); await h.resolver(account);
  await h.resolver({ ...account, accessToken: 'new-oauth' }); assert.equal(h.requests.length, 8);
  const next = { ...account, selection: { ...account.selection, productId: 'product2' } };
  const material = await h.resolver(next); assert.equal(h.requests.length, 12);
  h.resolver.invalidate(account); await h.resolver(next); assert.equal(h.requests.length, 12);
  h.resolver.invalidate(material); await h.resolver(next); assert.equal(h.requests.length, 16);
});
test('a late rejection for an old token cannot invalidate a renewed token in the same team', async () => {
  const h = fixture(); const old = await h.resolver(account);
  h.tick(3500000); const latest = await h.resolver(account); assert.notEqual(latest.codingPlanApiKey, old.codingPlanApiKey);
  h.resolver.invalidate(old); await h.resolver(account); assert.equal(h.requests.length, 8);
  h.resolver.invalidate(latest); await h.resolver(account); assert.equal(h.requests.length, 12);
});
test('an old-account response arriving after a switch cannot publish its token', async () => {
  let release; let first = true;
  const gate = new Promise(resolve => { release = resolve; });
  const h = fixture({ request: async () => { if (first) { first = false; await gate; } } });
  const old = h.resolver(account); const rejected = assert.rejects(old, { code: 'ZCODE_LOGIN_REQUIRED' });
  await h.resolver({ ...account, accessToken: 'new-oauth' }); release(); await rejected;
  assert.equal(h.requests.filter(row => row.init.method === 'POST').length, 1);
});
test('incomplete scope and missing OAuth fail before any request', async () => {
  const h = fixture();
  await assert.rejects(h.resolver({ ...account, selection: { ...account.selection, projectId: '' } }), { code: 'ZCODE_TEAM_SELECTION_REQUIRED' });
  await assert.rejects(h.resolver({ ...account, accessToken: '' }), { code: 'ZCODE_LOGIN_REQUIRED' });
  assert.equal(h.requests.length, 0);
});
