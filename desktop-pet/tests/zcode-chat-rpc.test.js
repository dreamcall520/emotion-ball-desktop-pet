const test = require('node:test'); const assert = require('node:assert/strict');
const { resolveZcodeChatModel, projectZcodeModels, requiresVerification, createZcodeChatRpc } = require('../lib/zcode-chat-rpc');
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
