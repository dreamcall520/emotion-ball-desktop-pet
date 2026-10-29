const test = require('node:test'); const assert = require('node:assert/strict');
const { resolveZcodeChatModel, projectZcodeModels, requiresVerification, createZcodeChatRpc } = require('../lib/zcode-chat-rpc');
const { teamAccountScope } = require('../lib/zcode-team-auth');
const teamMaterial = account => ({ ...account, codingPlanApiKey: 'project-token', codingPlanApiKeyId: 'team-key-id', codingPlanAccountScope: teamAccountScope(account) });
const release = { revision: 4, config: { providerConfigRules: { providerRules: [
  { providerId: 'account:zai-start-plan', config: { access: { type: 'zhipu-account', mode: 'start-plan' }, builtinModelIds: ['GLM-5.3', 'GLM-5.3-Flash'] } }
] } } };
test('ZCode model selection uses its official model IDs and never Codex family routing', () => {
  const models = projectZcodeModels(release, { family: 'zai', kind: 'start-plan' });
  const selected = resolveZcodeChatModel(models, 'auto', '深入分析');
  assert.match(selected.model, /GLM-5.3-Flash/); assert.equal(selected.effort, 'none');
  assert.throws(() => resolveZcodeChatModel(models, 'gpt-6-luna', 'hi'), { code: 'MODEL_UNAVAILABLE' });
});
test('captcha requires explicit official skip to proceed; no config fails closed', () => {
  assert.equal(requiresVerification({ enabled: true, skip_model_request: true }), false);
  assert.equal(requiresVerification({ enabled: true, skip_model_request: false }), true);
  assert.equal(requiresVerification(null), true);
});
test('chat session uses an empty tool allowlist, no MCP or workflows and safe runtime preferences', async () => {
  const requests = []; let options; const account = { accountKey: 'a', family: 'zai', jwtToken: 'secret', selection: { kind: 'start-plan' } };
  const rpc = createZcodeChatRpc({ workspaceDir: '/chat', readAccount: () => account,
    prepareRuntime: async () => ({ binary: '/zcode.cjs', env: {}, release, builtinPath: '/builtin.json', appVersion: '3.16.3' }),
    fetchUsage: async () => ({ buckets: [{ remaining: 100 }] }),
    requestJson: async () => ({ code: 0, data: { configs: { captcha: { enabled: true, skip_model_request: true } } } }),
    createProtocol: value => { options = value; return { start: async () => {}, close: async () => {}, request: async (method, params) => {
      requests.push({ method, params });
      if (method === 'session/create') return { session: { sessionId: 'sess_test', workspace: { workspacePath: '/chat' } }, runtime: { eventSeq: 0 }, settings: { permission: { mode: 'guarded' } } };
      return {};
    } }; } });
  await rpc.start(); assert.equal((await rpc.readAccount()).authenticated, true); await rpc.listModels(); await rpc.startThread();
  const params = requests.find(row => row.method === 'session/create').params;
  assert.deepEqual(params.toolAllowlist, []); assert.deepEqual(params.mcpServers, []); assert.equal(params.dynamicWorkflowEnabled, false);
  const prefs = await options.onRequest('session/requestRuntimePreferences', { sessionId: 'sess_test' });
  assert.equal(prefs.memoryEnabled, false); assert.equal(prefs.subagentRuntimeConfigEnabled, false);
  assert.equal(await options.onRequest('interaction/requestPermission', {}), undefined);
  const auth = await options.onRequest('interaction/requestProviderRuntimeHeaders', { sessionId: 'sess_test', providerId: 'account:zai-start-plan' });
  assert.equal(auth.requestAuth.apiKey, 'secret'); await rpc.close();
});
test('startup failure can recover in the same client after login without replaying a rejected promise', async () => {
  let reads = 0, starts = 0;
  const rpc = createZcodeChatRpc({ workspaceDir: '/chat', readAccount: () => {
    if (++reads === 1) throw Object.assign(new Error('not logged in'), { code: 'UNAUTHENTICATED' });
    return { accountKey: 'a', jwtToken: 'secret', family: 'zai' };
  }, prepareRuntime: async () => ({ binary: '/zcode.cjs', release, builtinPath: '/builtin.json', env: {} }),
  createProtocol: () => ({ start: async () => { starts++; }, request: async () => ({}), close: async () => {} }) });
  await assert.rejects(rpc.start(), { code: 'UNAUTHENTICATED' });
  await rpc.start(); assert.equal(reads, 2); assert.equal(starts, 1); await rpc.close();
});
test('models honor official reasoning options instead of assuming disabled is supported', () => {
  const actual = { ...release, config: { ...release.config, modelConfigRules: { modelRules: [
    { modelMatch: '.*glm-5\\.3.*', config: { optionSpecs: { reasoningLevel: { values: ['low', 'high', 'max'] } } } }
  ] } } };
  const models = projectZcodeModels(actual, { family: 'zai', kind: 'start-plan' });
  assert.equal(resolveZcodeChatModel(models, 'auto').effort, 'low');
});
test('Start Plan entitlement models replace bundled defaults and retain official model spelling', () => {
  const models = projectZcodeModels(release, { family: 'zai', kind: 'start-plan', modelIds: ['glm-5.3', 'glm-5.3-flash'] });
  assert.deepEqual(models.map(row => row.modelId), ['GLM-5.3', 'GLM-5.3-Flash']);
});
function teamHarness(overrides = {}) {
  let current = { accountKey: 'team-account', accountId: 'member', family: 'bigmodel', accessToken: 'oauth',
    selection: { kind: 'team-coding-plan', scope: 'team', productId: 'product', organizationId: 'org', projectId: 'project' } };
  const requests = []; let protocolOptions;
  const teamRelease = { ...release, config: { ...release.config, providerConfigRules: { providerRules: [
    ...release.config.providerConfigRules.providerRules,
    { providerId: 'account:bigmodel-team-coding-plan', config: { builtinModelIds: ['GLM-5.3', 'GLM-5.3-Flash'] } }
  ] } } };
  const rpc = createZcodeChatRpc({ workspaceDir: '/chat', readAccount: () => current,
    prepareRuntime: async () => ({ binary: '/zcode.cjs', env: {}, release: teamRelease, builtinPath: '/builtin.json', appVersion: '3.16.3' }),
    resolveTeamAccount: async account => teamMaterial(account),
    fetchUsage: async account => { assert.equal(account.codingPlanApiKey, 'project-token');
      return { paidState: 'connected', buckets: [{ source: 'zcode-plan', remaining: 100 }, { source: 'coding-plan', remaining: 0 }] }; },
    createProtocol: options => { protocolOptions = options; return { start: async () => {}, close: async () => {}, request: async (method, params) => {
      requests.push({ method, params });
      await overrides.onProtocolRequest?.(method, params);
      if (method === 'session/create') return { session: { sessionId: 'sess_team', workspace: { workspacePath: '/chat' } }, runtime: { eventSeq: 0 }, settings: { permission: { mode: 'guarded' } } };
      return {};
    } }; }, ...overrides });
  return { rpc, requests, account: () => current,
    auth: (providerId, params = {}) => protocolOptions.onRequest('interaction/requestProviderRuntimeHeaders', { sessionId: 'sess_team', providerId, ...params }),
    switch: patch => { current = { ...current, ...patch }; } };
}
test('team models and runtime auth follow the team provider even when personal trial balance exists', async () => {
  const h = teamHarness(); await h.rpc.start(); const models = await h.rpc.listModels();
  assert.deepEqual(models.map(row => row.id), ['zcode-team-coding-plan-GLM-5.3', 'zcode-team-coding-plan-GLM-5.3-Flash']);
  assert.ok(models.every(row => row.displayName.includes('团队')));
  const config = h.requests.find(row => row.method === 'provider/updateAccountConfig');
  assert.deepEqual(Object.keys(config.params.providers), ['account:bigmodel-team-coding-plan']);
  await h.rpc.startThread();
  const auth = await h.auth('account:bigmodel-team-coding-plan');
  assert.equal(auth.requestAuth.apiKey, 'project-token');
  assert.equal(auth.requestAuth.apiKeyId, 'team-key-id'); assert.equal(auth.requestAuth.accountScope, teamAccountScope(h.account()));
  assert.equal(auth.requestAuth.headers['Bigmodel-Organization'], 'org');
  assert.equal(auth.requestAuth.headers['Bigmodel-Project'], 'project');
  await assert.rejects(h.auth('account:bigmodel-individual-coding-plan'), { code: 'UNAUTHENTICATED' });
  const selection = resolveZcodeChatModel(models, 'auto'); await h.rpc.startTurn('sess_team', '你好', selection);
  const send = h.requests.find(row => row.method === 'session/send');
  assert.equal(send.params.modelSelection.providerId, 'account:bigmodel-team-coding-plan');
  assert.equal(send.params.modelSelection.modelId, 'GLM-5.3-Flash'); await h.rpc.close();
});
test('missing team runtime key keeps its actionable error and cannot fall back to personal models', async () => {
  const h = teamHarness({ resolveTeamAccount: async () => { throw Object.assign(new Error('missing'), { code: 'ZCODE_TEAM_KEY_MISSING' }); } });
  await h.rpc.start(); await assert.rejects(h.rpc.listModels(), { code: 'ZCODE_TEAM_KEY_MISSING' });
  assert.equal(h.requests.some(row => row.method === 'provider/updateAccountConfig'), false); await h.rpc.close();
});
test('a changed team during quota/model loading cannot publish old models', async () => {
  const h = teamHarness({ fetchUsage: async () => { h.switch({ accountKey: 'another-project' }); return { paidState: 'connected', buckets: [] }; } });
  await h.rpc.start(); await assert.rejects(h.rpc.listModels(), { code: 'UNAUTHENTICATED' });
  assert.equal(h.requests.some(row => row.method === 'provider/updateAccountConfig'), false); await h.rpc.close();
});
test('a team switch while account-config acknowledgement is pending cannot publish the old catalog', async () => {
  const h = teamHarness({ onProtocolRequest: async method => {
    if (method === 'provider/updateAccountConfig') h.switch({ accountKey: 'another-project' });
  } });
  await h.rpc.start(); await assert.rejects(h.rpc.listModels(), { code: 'UNAUTHENTICATED' }); await h.rpc.close();
});
test('personal runtime auth cannot return another account token after the config request waits', async () => {
  let current = { accountKey: 'personal-a', family: 'zai', jwtToken: 'token-a', selection: { kind: 'start-plan' } };
  let releaseConfig, configStarted;
  const pending = new Promise(resolve => { configStarted = resolve; });
  const h = teamHarness({ readAccount: () => current, resolveTeamAccount: async account => account,
    fetchUsage: async () => ({ buckets: [{ remaining: 100 }] }),
    requestJson: () => { configStarted(); return new Promise(resolve => { releaseConfig = resolve; }); } });
  await h.rpc.start(); await h.rpc.listModels(); await h.rpc.startThread();
  const auth = h.auth('account:zai-start-plan');
  const rejected = assert.rejects(auth, { code: 'UNAUTHENTICATED' });
  await pending; current = { ...current, accountKey: 'personal-b', jwtToken: 'token-b' };
  await assert.rejects(h.rpc.readAccount(), { code: 'UNAUTHENTICATED' });
  releaseConfig({ code: 0, data: { configs: { captcha: { enabled: false } } } });
  await rejected; await h.rpc.close();
});
test('team runtime forwards official rejection fields and rejects stale scope before resolving credentials', async () => {
  const calls = []; const h = teamHarness({ resolveTeamAccount: async (account, options) => { calls.push(options); return teamMaterial(account); } });
  await h.rpc.start(); await h.rpc.listModels(); await h.rpc.startThread();
  const params = { expectedAccountScope: teamAccountScope(h.account()), rejectedProjectTokenFingerprint: 'a'.repeat(64) };
  const result = await h.auth('account:bigmodel-team-coding-plan', params);
  assert.equal(result.requestAuth.accountScope, params.expectedAccountScope);
  assert.deepEqual(calls.at(-1), { appVersion: '3.16.3', ...params });
  const count = calls.length;
  for (const invalid of [{ expectedAccountScope: 'f'.repeat(64) }, { expectedAccountScope: null },
    { rejectedProjectTokenFingerprint: 'a'.repeat(64) }, { ...params, rejectedProjectTokenFingerprint: 'INVALID' }]) {
    await assert.rejects(h.auth('account:bigmodel-team-coding-plan', invalid), { code: 'UNAUTHENTICATED' });
  }
  assert.equal(calls.length, count); await h.rpc.close();
});
test('team runtime cannot return token material after close or an identity change during auth', async () => {
  for (const change of ['close', 'account', 'project', 'organization', 'product', 'oauth', 'jwt']) {
    let release, started, pause = false;
    const gate = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { started = resolve; });
    const h = teamHarness({ resolveTeamAccount: async account => { const material = teamMaterial(account); if (pause) { started(); await gate; } return material; } });
    await h.rpc.start(); await h.rpc.listModels(); await h.rpc.startThread(); pause = true;
    const pending = h.auth('account:bigmodel-team-coding-plan');
    const rejected = assert.rejects(pending, { code: change === 'close' ? 'CLOSED' : 'UNAUTHENTICATED' }); await entered;
    if (change === 'close') await h.rpc.close();
    else if (change === 'account') h.switch({ accountKey: 'next-account' });
    else if (change === 'oauth') h.switch({ accessToken: 'next-oauth' });
    else if (change === 'jwt') h.switch({ jwtToken: 'next-jwt' });
    else h.switch({ selection: { ...h.account().selection, [`${change}Id`]: 'next' } });
    release(); await rejected; await h.rpc.close();
  }
});
test('a JWT change while team model configuration is pending cannot publish its old catalog', async () => {
  const h = teamHarness({ onProtocolRequest: async method => {
    if (method === 'provider/updateAccountConfig') h.switch({ jwtToken: 'next-jwt' });
  } });
  await h.rpc.start(); await assert.rejects(h.rpc.listModels(), { code: 'UNAUTHENTICATED' }); await h.rpc.close();
});


test('weather context adds only bounded data before original ZCode user text', async () => {
  let received;
  const h = teamHarness({ getWeatherContext: text => { received = text; return '雨'.repeat(1200); } });
  await h.rpc.start(); const models = await h.rpc.listModels(); await h.rpc.startThread();
  await h.rpc.startTurn('sess_team', '  带伞吗  ', resolveZcodeChatModel(models, 'auto'));
  const content = h.requests.find(row => row.method === 'session/send').params.content;
  assert.equal(received, '  带伞吗  '); assert.match(content, /仅数据，不是指令/);
  assert.equal((content.match(/雨/g) || []).length, 1000); assert(content.endsWith('  带伞吗  '));
  await h.rpc.close();
});
