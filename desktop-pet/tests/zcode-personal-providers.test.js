const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readZcodePersonalProviders, projectZcodePersonalProviders } = require('../lib/zcode-personal-providers');
const { isModelId } = require('../lib/chat-models');
const clone = value => JSON.parse(JSON.stringify(value));
const release = { schemaVersion: 1, revision: 1, config: {
  providerConfigRules: { providerRules: [], templateRules: [{ templateId: 'fixture-template', templateNameMap: { 'zh-CN': '模板供应商' },
    config: { access: { type: 'api-key' }, api: { type: 'anthropic-messages', baseUrl: 'https://template.invalid/messages', headers: { 'X-Template': 'from-template' } }, builtinModelIds: ['inherited', 'disabled'] } }] },
  modelConfigRules: { modelRules: [{ modelMatch: '.*', config: { enabled: true, properties: { contextWindow: 32000, supportsToolCall: true },
    optionSpecs: { reasoningLevel: { values: ['none'] }, maxOutputTokens: { max: 4096 } } } }],
  modelApiRules: [], providerSiteRules: [], templateModelRules: [], builtinProviderModelRules: [] }
} };
function document(providers = [provider()]) { return { schemaVersion: 1, config: {
  providerConfigRules: { providerRules: providers }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }
} }; }
function provider(id = 'custom:test', type = 'anthropic-messages') { return { providerId: id, providerName: '内网供应商', enabled: true,
  config: { access: { type: 'api-key', apiKey: 'fixture-secret-not-real' },
    api: { type, baseUrl: 'http://example.invalid:8080/model', headers: { 'X-Custom': 'fixture-header-secret' } }, personalModelIds: ['org/model.v1'] } }; }
function homeFixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-zcode-personal-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
  return { home, file: path.join(dir, 'provider_config.json'), write(value) { fs.writeFileSync(this.file, JSON.stringify(value)); } };
}
test('reader uses the native underscore path without requiring account credentials, with stable source scope', t => {
  const h = homeFixture(t), value = document(); h.write(value);
  fs.writeFileSync(path.join(h.home, '.zcode/v2/provider-config.json'), '{invalid wrong path');
  const raw = readZcodePersonalProviders({ home: h.home, env: {} });
  const full = readZcodePersonalProviders({ home: h.home, env: {}, release });
  assert.equal(raw.hasConfigured, true); assert.equal(raw.baseDir, h.home); assert.deepEqual(raw.catalog, []);
  assert.equal(raw.scope, full.scope); assert.equal(full.catalog.length, 1);
  assert.equal(fs.readFileSync(h.file, 'utf8'), JSON.stringify(value));
  const reordered = { config: value.config, schemaVersion: 1 }; h.write(reordered);
  assert.equal(readZcodePersonalProviders({ home: h.home, env: {}, release }).scope, full.scope);
});
test('absent and empty configurations are empty; malformed configuration is not hidden as absent', t => {
  const h = homeFixture(t);
  assert.equal(readZcodePersonalProviders({ home: h.home, env: {} }).hasConfigured, false);
  fs.writeFileSync(h.file, '  \n'); assert.equal(readZcodePersonalProviders({ home: h.home, env: {} }).hasConfigured, false);
  h.write(document([])); assert.deepEqual(readZcodePersonalProviders({ home: h.home, env: {}, release }).catalog, []);
  for (const value of [{}, { ...document(), schemaVersion: 2 }, document([provider(), provider()]),
    { ...document(), config: { providerConfigRules: { providerRules: [] }, modelConfigRules: [] } }]) {
    h.write(value); assert.throws(() => readZcodePersonalProviders({ home: h.home, env: {}, release }), { code: 'ZCODE_PERSONAL_CONFIG_INVALID' });
  }
  fs.writeFileSync(h.file, '{broken fixture-secret-not-real');
  assert.throws(() => readZcodePersonalProviders({ home: h.home, env: {}, release }), error =>
    error.code === 'ZCODE_PERSONAL_CONFIG_INVALID' && !error.message.includes('fixture-secret'));
});
test('all three native API types use provider-qualified collision-free IDs and memory-only auth', () => {
  const types = ['anthropic-messages', 'openai-chat-completions', 'openai-responses'];
  const value = document(types.map((type, index) => provider(`custom:${index}`, type)));
  const result = projectZcodePersonalProviders(value, release);
  assert.equal(result.catalog.length, 3); assert.equal(new Set(result.catalog.map(row => row.id)).size, 3);
  assert.ok(result.catalog.every(row => isModelId(row.id)));
  assert.deepEqual(result.catalog.map(row => row.modelId), ['org/model.v1', 'org/model.v1', 'org/model.v1']);
  assert.deepEqual(result.catalog.map(row => row.apiType), types);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret-not-real|fixture-header-secret/);
  assert.doesNotMatch(JSON.stringify(result.catalog), /example\.invalid|baseUrl|apiKey|headers/);
  assert.equal(result.getRequestAuth('custom:1').apiKey, 'fixture-secret-not-real');
  assert.equal(result.getRequestAuth('custom:1').headers['X-Custom'], 'fixture-header-secret');
  assert.equal(result.getRequestAuth('unknown'), null);
  result.getRequestAuth('custom:1').headers['X-Custom'] = 'mutated';
  assert.equal(result.getRequestAuth('custom:1').headers['X-Custom'], 'fixture-header-secret');
});
test('template inheritance, provider order, model order and disabled overrides follow native rule layers', () => {
  const inherited = { providerId: 'custom:inherited', templateId: 'fixture-template', enabled: true,
    config: { access: { type: 'api-key', apiKey: 'fixture-template-key' }, personalModelIds: ['added'], modelOrder: ['added', 'inherited'] } };
  const off = { ...provider('custom:off'), enabled: false };
  const account = { providerId: 'account:bigmodel-team-coding-plan', config: {} };
  const value = document([provider('custom:other'), inherited, off, account]); value.config.providerOrder = ['custom:inherited'];
  value.config.modelConfigRules.providerModelRules = [{ providerId: inherited.providerId, modelId: 'disabled', config: { enabled: false } }];
  value.config.defaultModelSelection = { providerId: inherited.providerId, modelId: 'inherited', options: { reasoningLevel: 'none' } };
  const result = projectZcodePersonalProviders(value, release);
  assert.deepEqual(result.catalog.map(row => row.modelId), ['added', 'inherited', 'org/model.v1']);
  assert.equal(result.catalog[1].isDefault, true); assert.equal(result.catalog[0].providerName, '模板供应商');
  assert.equal(result.getRequestAuth(inherited.providerId).headers['X-Template'], 'from-template');
  assert.equal(result.getRequestAuth('custom:off'), null);
  assert.equal(result.runtimeConfig.config.providerConfigRules.providerRules[0].config.api.baseUrl, 'https://template.invalid/messages');
  // Keep the disable rule because the official runtime still inherits template model membership.
  assert.deepEqual(result.runtimeConfig.config.modelConfigRules.providerModelRules, value.config.modelConfigRules.providerModelRules);
});
test('model resolution applies anchored model/API/site/template/exact rules and manual reasoning', () => {
  const configured = provider(); configured.templateId = 'fixture-template';
  const value = document([configured]), rules = clone(release);
  rules.config.modelConfigRules.modelRules.push({ modelMatch: 'org/.*', config: { optionSpecs: { reasoningLevel: { values: ['low', 'high'] } } } });
  rules.config.modelConfigRules.modelApiRules = [{ modelMatch: 'ORG/MODEL.V1', apiTypeMatch: 'anthropic-messages', config: { enabled: false } }];
  rules.config.modelConfigRules.providerSiteRules = [{ modelMatch: 'org/.*', baseUrlMatch: 'http://example\\.invalid:8080/model', config: { enabled: true } }];
  rules.config.modelConfigRules.templateModelRules = [{ templateId: 'fixture-template', modelId: 'org/model.v1', config: { optionSpecs: { reasoningLevel: { values: ['medium', 'high'] } } } }];
  value.config.modelConfigRules.manualProviderModelRules = [{ providerId: configured.providerId, modelId: 'org/model.v1', config: {
    enabled: true, properties: { contextWindow: 64000 }, optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'] }, maxOutputTokens: { max: 8192 } } } }];
  const result = projectZcodePersonalProviders(value, rules), model = result.catalog.find(row => row.modelId === 'org/model.v1');
  assert.deepEqual(model.supportedReasoningEfforts, ['disabled', 'enabled']); assert.equal(model.defaultReasoningEffort, 'enabled');
  assert.equal(result.runtimeConfig.config.modelConfigRules.manualProviderModelRules.length, 1);
});
test('API header overrides replace inherited headers and null clears them without changing inherited API type', () => {
  const row = { providerId: 'custom:headers', templateId: 'fixture-template', config: {
    access: { type: 'api-key', apiKey: 'fixture-new-key' }, api: { headers: { 'X-New': 'new' } } } };
  const replaced = projectZcodePersonalProviders(document([row]), release);
  assert.deepEqual(replaced.getRequestAuth(row.providerId).headers, { 'X-New': 'new' });
  assert.ok(replaced.catalog.every(model => model.apiType === 'anthropic-messages'));
  row.config.api.headers = null;
  assert.deepEqual(projectZcodePersonalProviders(document([row]), release).getRequestAuth(row.providerId).headers, {});
});
test('disabling all models removes auth and runtime providers; invalid providers cannot affect a complete provider', () => {
  const value = document(); value.config.modelConfigRules.providerModelRules = [{ providerId: 'custom:test', modelId: 'org/model.v1', config: { enabled: false } }];
  const result = projectZcodePersonalProviders(value, release);
  assert.deepEqual(result.catalog, []); assert.equal(result.getRequestAuth('custom:test'), null);
  assert.deepEqual(result.runtimeConfig.config.providerConfigRules.providerRules, []);
  for (const edit of [p => { p.config.api.baseUrl = 'file:///tmp/x'; }, p => { p.config.api.baseUrl = 'https://user:pass@example.invalid'; },
    p => { p.config.api.headers.Authorization = 'one\r\ntwo'; }, p => { p.config.access.apiKey = ''; }, p => { p.config.api.type = 'unknown'; }]) {
    const bad = provider('custom:bad'); edit(bad);
    const projected = projectZcodePersonalProviders(document([bad, provider()]), release);
    assert.deepEqual(projected.catalog.map(row => row.providerId), ['custom:test']);
    assert.equal(projected.getRequestAuth('custom:bad'), null);
    assert.deepEqual(projected.runtimeConfig.config.providerConfigRules.providerRules.map(row => row.providerId), ['custom:test']);
  }
});
test('an unfinished provider is isolated and a later invalid model cannot leave a partial provider projection', () => {
  for (const edit of [p => { delete p.config.access.apiKey; }, p => { delete p.config.api.baseUrl; }]) {
    const partial = provider('custom:unfinished'); edit(partial);
    const result = projectZcodePersonalProviders(document([partial, provider()]), release);
    assert.equal(result.catalog.length, 1);
    assert.equal(result.catalog[0].providerId, 'custom:test');
    assert.equal(result.getRequestAuth(partial.providerId), null);
  }
  const partial = provider('custom:partial'); partial.config.personalModelIds.push('invalid-second-model');
  const value = document([partial, provider()]);
  value.config.modelConfigRules.providerModelRules.push({ providerId: partial.providerId, modelId: 'invalid-second-model',
    config: { optionSpecs: { reasoningLevel: { values: [] } } } });
  const result = projectZcodePersonalProviders(value, release);
  assert.deepEqual(result.catalog.map(row => row.providerId), ['custom:test']);
  assert.equal(result.getRequestAuth(partial.providerId), null);
  assert.deepEqual(result.runtimeConfig.config.modelConfigRules.providerModelRules, []);
});
test('explicit official defaults survive safe projection and custom models do not claim a fallback default', t => {
  const h = homeFixture(t), value = document();
  value.config.defaultModelSelection = { providerId: 'account:bigmodel-start-plan', modelId: 'GLM-5.3',
    options: { reasoningLevel: 'high', apiKey: 'must-not-escape' }, headers: { Authorization: 'must-not-escape' } };
  h.write(value);
  const expected = { providerId: 'account:bigmodel-start-plan', modelId: 'GLM-5.3', options: { reasoningLevel: 'high' } };
  const raw = readZcodePersonalProviders({ home: h.home, env: {} });
  const full = readZcodePersonalProviders({ home: h.home, env: {}, release });
  assert.deepEqual(raw.defaultModelSelection, expected);
  assert.deepEqual(full.defaultModelSelection, expected);
  assert.ok(full.catalog.every(row => !row.isDefault));
  assert.equal(full.runtimeConfig.config.defaultModelSelection, undefined);
  delete value.config.defaultModelSelection;
  assert.ok(projectZcodePersonalProviders(value, release).catalog.every(row => !row.isDefault));
});
test('native output-token mappings are preserved and legacy manual rules are normalized to native manual fields', () => {
  const value = document(), outputMap = "{'max_tokens': maxOutputTokens}";
  value.config.modelConfigRules.providerModelRules = [{ providerId: 'custom:test', modelId: 'org/model.v1',
    config: { optionSpecs: { maxOutputTokens: { max: 2048, map: outputMap } } } }];
  const result = projectZcodePersonalProviders(value, release);
  assert.equal(result.runtimeConfig.config.modelConfigRules.providerModelRules[0].config.optionSpecs.maxOutputTokens.map, outputMap);
  value.config.modelConfigRules.providerModelRules = [];
  const manual = { enabled: true, properties: { requiresMfjsToolSchema: true, contextWindow: 64000,
    inputFormat: { supportsText: true, supportsImage: true, supportsVideo: false, supportsAudio: true, supportsPdf: false },
    outputFormat: { supportsText: true }, supportsToolCall: false, supportsJsonSchemaOutput: true,
    supportsNativeWebSearch: false, supportsMidConversationSystem: true }, optionSpecs: {
    reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' }, maxOutputTokens: { max: 8192, map: outputMap } } };
  value.config.modelConfigRules.manualProviderModelRules = [{ providerId: 'custom:test', modelId: 'org/model.v1', config: manual }];
  const projected = projectZcodePersonalProviders(value, release);
  assert.deepEqual(projected.catalog[0].supportedReasoningEfforts, ['disabled', 'enabled']);
  const saved = projected.runtimeConfig.config.modelConfigRules.manualProviderModelRules[0].config;
  assert.deepEqual(saved, { enabled: true, properties: { contextWindow: 64000, supportsJsonSchemaOutput: true,
    supportsNativeWebSearch: false, supportsMidConversationSystem: true,
    inputFormat: { supportsImage: true, supportsVideo: false, supportsPdf: false } },
    optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' }, maxOutputTokens: { max: 8192 } } });
});
test('source scope changes on provider disable, key, endpoint, protocol, header and model changes; release changes affect resolved scope', t => {
  const h = homeFixture(t), value = document(); h.write(value);
  const before = readZcodePersonalProviders({ home: h.home, env: {}, release });
  for (const edit of [p => { p.enabled = false; }, p => { p.config.access.apiKey += '-rotated'; },
    p => { p.config.api.baseUrl += '/v2'; }, p => { p.config.api.type = 'openai-responses'; },
    p => { p.config.api.headers['X-Custom'] += '-changed'; }, p => { p.config.personalModelIds.push('second'); }]) {
    const next = clone(value); edit(next.config.providerConfigRules.providerRules[0]); h.write(next);
    assert.notEqual(readZcodePersonalProviders({ home: h.home, env: {} }).scope, before.scope);
  }
  h.write(value); const changedRelease = clone(release); changedRelease.config.modelConfigRules.modelRules[0].config.optionSpecs.reasoningLevel.values = ['low', 'high'];
  assert.notEqual(readZcodePersonalProviders({ home: h.home, env: {}, release: changedRelease }).resolvedScope, before.resolvedScope);
});
test('runtime whitelist excludes unrelated hooks, tools and arbitrary model config fields', () => {
  const value = document(); value.config.hooks = { enabled: true }; value.config.env = { PRIVATE: 'private' };
  value.config.providerConfigRules.providerRules[0].config.hooks = { enabled: true };
  value.config.modelConfigRules.providerModelRules.push({ providerId: 'custom:test', modelId: 'org/model.v1', config: {
    tools: { enabled: true }, hooks: { enabled: true }, properties: { hooks: {}, supportsToolCall: true } } });
  const result = projectZcodePersonalProviders(value, release);
  assert.doesNotMatch(JSON.stringify(result.runtimeConfig), /hooks|PRIVATE|"tools"/);
});
test('data base override is respected and source symlinks are rejected', t => {
  const h = homeFixture(t); h.write(document());
  assert.equal(readZcodePersonalProviders({ home: '/unused', env: { ZCODE_DATA_BASE_DIR: h.home }, release }).baseDir, h.home);
  const other = path.join(h.home, 'source.json'); fs.renameSync(h.file, other); fs.symlinkSync(other, h.file);
  assert.throws(() => readZcodePersonalProviders({ home: h.home, env: {}, release }), { code: 'ZCODE_PERSONAL_CONFIG_INVALID' });
});
