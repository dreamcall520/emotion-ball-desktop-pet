const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createZcodeChatRpc, resolveZcodeChatModel } = require('../lib/zcode-chat-rpc');
const { readZcodeConnection } = require('../lib/zcode-account');
const { readZcodePersonalProviders } = require('../lib/zcode-personal-providers');
const release = { revision: 33, config: { providerConfigRules: { providerRules: [], templateRules: [] },
  modelConfigRules: { modelRules: [{ modelMatch: '.*', config: { enabled: true, optionSpecs: { reasoningLevel: { values: ['none'] } } } }] } } };
function setup(t, official = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-custom-chat-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
  const document = { schemaVersion: 1, config: { providerConfigRules: { providerRules:
    ['anthropic-messages', 'openai-chat-completions', 'openai-responses'].map((type, index) => ({ providerId: `custom:fixture-${index}`, providerName: `供应商${index}`, enabled: true,
      config: { group: 'standard-personal', access: { type: 'api-key', apiKey: `fixture-key-${index}` },
        api: { type, baseUrl: `http://127.0.0.1:${14000 + index}`, headers: { 'X-Fixture': `provider-${index}` } }, personalModelIds: ['same-model'] } })) },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] } } };
  const config = path.join(dir, 'provider_config.json'), personalPath = path.join(home, 'runtime-provider.json');
  const save = () => fs.writeFileSync(config, JSON.stringify(document)); save();
  let options; const calls = [], notifications = [];
  const team = { accountKey: 'official-fixture', accountId: 'member', family: 'bigmodel', accessToken: 'fixture-oauth',
    selection: { kind: 'team-coding-plan', productId: 'product', organizationId: 'org', projectId: 'project' } };
  const rpc = createZcodeChatRpc({ workspaceDir: home, home, env: {},
    onNotification: packet => notifications.push(packet),
    ...(official ? { readAccount: input => ({ ...team, personal: readZcodePersonalProviders(input) }) } : {}),
    prepareRuntime: async () => ({ binary: '/fixture-cli', personalPath, env: {}, release, builtinPath: '/fixture-builtin', appVersion: '3.16.3' }),
    resolveTeamAccount: async () => { throw Object.assign(Error('fixture team quota unavailable'), { code: 'ZCODE_TEAM_ACCESS_DENIED' }); },
    fetchUsage: async () => { throw Error('custom-only must not request official quota'); },
    requestJson: async () => { throw Error('custom-only must not request official account API'); },
    createProtocol: value => { options = value; return { start: async () => {}, close: async () => {}, request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'session/create') return { session: { sessionId: 'fixture_session', workspace: { workspacePath: home } }, settings: { permission: { mode: 'guarded' } } };
      return {};
    } }; } });
  t.after(() => rpc.close());
  return { rpc, calls, notifications, config, document, save, home, personalPath,
    auth: providerId => options.onRequest('interaction/requestProviderRuntimeHeaders', { sessionId: 'fixture_session', providerId }) };
}
test('custom providers work without official login and same model names stay distinct', async t => {
  const f = setup(t); assert.equal(readZcodeConnection({ home: f.home, env: {} }).family, 'custom');
  await f.rpc.start(); const models = await f.rpc.listModels();
  assert.equal(models.length, 3); assert.equal(new Set(models.map(row => row.id)).size, 3);
  assert(models.every(row => row.displayName.includes('供应商') && row.displayName.includes('same-model')));
  assert.doesNotMatch(JSON.stringify(models), /fixture-key|X-Fixture|127\.0\.0\.1/);
  const config = JSON.parse(fs.readFileSync(f.personalPath, 'utf8'));
  assert.equal(fs.statSync(f.personalPath).mode & 0o777, 0o600);
  assert.equal(config.config.providerConfigRules.providerRules[1].config.access.apiKey, 'fixture-key-1');
  assert.deepEqual(config.config.providerConfigRules.providerRules[1].config.api.headers, { 'X-Fixture': 'provider-1' });
  assert.equal(f.calls.find(row => row.method === 'provider/refreshRegistry').params.reason, 'qiuqiu-personal-provider-config-updated');
  assert.equal(f.calls.some(row => row.method === 'provider/updateAccountConfig'), false);
  await f.rpc.startThread();
  await f.rpc.startTurn('fixture_session', '测试', resolveZcodeChatModel(models, models[1].id));
  const send = f.calls.find(row => row.method === 'session/send');
  assert.equal(send.params.modelSelection.providerId, 'custom:fixture-1'); assert.equal(send.params.modelSelection.modelId, 'same-model');
  await assert.rejects(f.auth('custom:fixture-1'), { code: 'UNAUTHENTICATED' }, 'custom API-key providers must not enter official-account callbacks');
  await assert.rejects(f.auth('custom:fixture-0'), { code: 'UNAUTHENTICATED' });
  await assert.rejects(f.auth('unknown'), { code: 'UNAUTHENTICATED' });
  await f.rpc.close(); assert.equal(fs.existsSync(f.personalPath), false);
});
test('unavailable official Team quota does not block configured custom model chat', async t => {
  const f = setup(t, true); await f.rpc.start(); const models = await f.rpc.listModels();
  assert.equal(models.length, 3); await f.rpc.startThread();
  await f.rpc.startTurn('fixture_session', '测试', resolveZcodeChatModel(models, models[0].id));
  assert.equal(JSON.parse(fs.readFileSync(f.personalPath, 'utf8')).config.providerConfigRules.providerRules[0].config.access.apiKey, 'fixture-key-0');
  assert(!f.calls.some(row => row.method === 'provider/updateAccountConfig'));
});
test('changing a custom key or disabling its provider invalidates the old chat scope and credentials', async t => {
  const f = setup(t); await f.rpc.start(); await f.rpc.listModels(); await f.rpc.startThread();
  const before = await f.rpc.readAccount();
  f.document.config.providerConfigRules.providerRules[0].config.access.apiKey = 'fixture-replaced-key'; f.save();
  await assert.rejects(f.rpc.readAccount(), { code: 'UNAUTHENTICATED' });
  assert.equal(fs.existsSync(f.personalPath), false);
  assert.notEqual((await f.rpc.readAccount()).accountKey, before.accountKey);
  const models = await f.rpc.listModels();
  f.document.config.providerConfigRules.providerRules[0].enabled = false; f.save();
  await assert.rejects(f.rpc.startTurn('fixture_session', '禁止旧请求', resolveZcodeChatModel(models, models[0].id)), { code: 'UNAUTHENTICATED' });
  assert.equal(f.calls.some(row => row.method === 'session/send'), false);
  assert.equal((await f.rpc.listModels()).length, 2);
});
test('next startup removes interrupted private credentials even if account login now fails', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-custom-cleanup-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.zcode/provider-config.json'); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'interrupted-fixture-key', { mode: 0o600 });
  const rpc = createZcodeChatRpc({ workspaceDir: home, readAccount: () => { throw Object.assign(Error(), { code: 'UNAUTHENTICATED' }); } });
  await assert.rejects(rpc.start(), { code: 'UNAUTHENTICATED' }); assert.equal(fs.existsSync(file), false); await rpc.close();
});
for (const change of ['remove', 'disable-all', 'invalid-json']) test(`losing custom configuration (${change}) clears credentials and invalidates the chat`, async t => {
  const f = setup(t); await f.rpc.start(); await f.rpc.listModels();
  assert(fs.existsSync(f.personalPath));
  if (change === 'remove') fs.rmSync(f.config);
  else if (change === 'invalid-json') fs.writeFileSync(f.config, '{');
  else { f.document.config.providerConfigRules.providerRules.forEach(row => row.enabled = false); f.save(); }
  await assert.rejects(f.rpc.readAccount());
  assert.equal(fs.existsSync(f.personalPath), false);
  assert(f.notifications.some(packet => packet.method === 'account/updated'), 'the chat owner must retire the old connection');
  assert.equal(f.calls.some(row => row.method === 'session/send'), false);
});
