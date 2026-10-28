const nativeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const API_TYPES = new Set(['anthropic-messages', 'openai-chat-completions', 'openai-responses']);
const MAX_BYTES = 4 * 1024 * 1024;
const RUNTIME_KEY = 'qiuqiu-runtime-credential-required';
const fail = () => Object.assign(new Error('ZCODE_PERSONAL_CONFIG_INVALID'), { code: 'ZCODE_PERSONAL_CONFIG_INVALID' });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
function overlay(base, next) {
  if (next === undefined) return base;
  if (!record(base) || !record(next)) return clone(next);
  const result = { ...base };
  for (const key of Object.keys(next)) if (!['__proto__', 'prototype', 'constructor'].includes(key)) result[key] = overlay(base[key], next[key]);
  return result;
}
const emptyConfig = () => ({ schemaVersion: 1, config: { providerConfigRules: { providerRules: [] },
  modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] } } });
function ids(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 512 || value.some(id => !text(id))) throw fail();
  return [...new Set(value)];
}
function ordered(values, order) {
  const valid = new Set(values);
  return [...new Set([...ids(order).filter(id => valid.has(id)), ...values])];
}
function validateDocument(document) {
  if (!record(document) || document.schemaVersion !== 1 || !record(document.config)) throw fail();
  const config = document.config, providers = config.providerConfigRules?.providerRules;
  const models = config.modelConfigRules;
  if (!Array.isArray(providers) || providers.length > 256 || !record(models) ||
    !Array.isArray(models.providerModelRules) || !Array.isArray(models.manualProviderModelRules)) throw fail();
  const seen = new Set();
  for (const row of providers) {
    if (!record(row) || !text(row.providerId) || !record(row.config) || seen.has(row.providerId) ||
      row.enabled !== undefined && typeof row.enabled !== 'boolean') throw fail();
    seen.add(row.providerId);
    if (row.templateId != null && !text(row.templateId) || row.providerName != null && !text(row.providerName)) throw fail();
  }
  const modelSeen = new Set();
  for (const row of [...models.providerModelRules, ...models.manualProviderModelRules]) {
    const key = JSON.stringify([row?.providerId, row?.modelId]);
    if (!record(row) || !text(row.providerId) || !text(row.modelId) || !record(row.config) || modelSeen.has(key)) throw fail();
    modelSeen.add(key);
    if (row.config.enabled != null && typeof row.config.enabled !== 'boolean') throw fail();
  }
  ids(config.providerOrder);
  if (config.defaultModelSelection !== undefined && (!record(config.defaultModelSelection) ||
    !text(config.defaultModelSelection.providerId) || !text(config.defaultModelSelection.modelId))) throw fail();
  return document;
}
function modelConfig(config, manual = false) {
  const result = {};
  if (own(config, 'enabled')) result.enabled = config.enabled;
  if (own(config, 'properties')) {
    if (config.properties === null) result.properties = null;
    else {
      if (!record(config.properties)) throw fail();
      result.properties = {};
      const fields = manual ? ['contextWindow', 'supportsJsonSchemaOutput', 'supportsNativeWebSearch', 'supportsMidConversationSystem']
        : ['contextWindow', 'supportsToolCall', 'supportsJsonSchemaOutput', 'supportsNativeWebSearch', 'supportsMidConversationSystem', 'requiresMfjsToolSchema'];
      for (const key of fields) if (own(config.properties, key)) result.properties[key] = config.properties[key];
      for (const key of manual ? ['inputFormat'] : ['inputFormat', 'outputFormat']) if (own(config.properties, key)) {
        const format = config.properties[key];
        if (format !== null && !record(format)) throw fail();
        const formats = manual ? ['supportsImage', 'supportsVideo', 'supportsPdf']
          : ['supportsText', 'supportsImage', 'supportsVideo', 'supportsAudio', 'supportsPdf'];
        result.properties[key] = format === null ? null : Object.fromEntries(formats
          .filter(name => own(format, name)).map(name => [name, format[name]]));
      }
    }
  }
  if (own(config, 'optionSpecs')) {
    if (config.optionSpecs === null) result.optionSpecs = null;
    else {
      if (!record(config.optionSpecs)) throw fail();
      result.optionSpecs = {};
      for (const [key, fields] of [['reasoningLevel', ['values', 'map']], ['maxOutputTokens', manual ? ['max'] : ['max', 'map']]]) if (own(config.optionSpecs, key)) {
        const option = config.optionSpecs[key];
        if (option !== null && !record(option)) throw fail();
        result.optionSpecs[key] = option === null ? null : Object.fromEntries(fields.filter(name => own(option, name)).map(name => [name, clone(option[name])]));
      }
    }
  }
  return result;
}
function matches(pattern, value, insensitive = false) {
  if (typeof pattern !== 'string' || pattern.length > 2048) throw fail();
  try { return new RegExp(`^(?:${pattern})$`, insensitive ? 'i' : '').test(value); } catch (_) { throw fail(); }
}
function normalizedBase(value) {
  const url = new URL(value), suffix = url.search + url.hash, string = url.toString();
  return (suffix ? string.slice(0, -suffix.length) : string).replace(/\/+$/, '') + suffix;
}
function clearManualFields(config) {
  const result = clone(config);
  for (const key of ['contextWindow', 'supportsJsonSchemaOutput', 'supportsNativeWebSearch', 'supportsMidConversationSystem']) delete result.properties?.[key];
  for (const key of ['supportsImage', 'supportsVideo', 'supportsPdf']) delete result.properties?.inputFormat?.[key];
  delete result.optionSpecs?.reasoningLevel;
  delete result.optionSpecs?.maxOutputTokens?.max;
  return result;
}
function resolveModel(release, personal, provider, modelId) {
  const source = release.config.modelConfigRules || {}; let config = {};
  for (const kind of ['modelRules', 'modelApiRules', 'providerSiteRules', 'templateModelRules', 'builtinProviderModelRules']) {
    for (const row of source[kind] || []) {
      const exact = kind === 'templateModelRules' || kind === 'builtinProviderModelRules';
      if (exact ? row.modelId !== modelId || (kind === 'templateModelRules' ? row.templateId !== provider.templateId : row.providerId !== provider.providerId)
        : !matches(row.modelMatch, modelId, true) || row.apiTypeMatch !== undefined && !matches(row.apiTypeMatch, provider.config.api.type) ||
          kind === 'providerSiteRules' && !matches(row.baseUrlMatch, normalizedBase(provider.config.api.baseUrl))) continue;
      config = overlay(config, modelConfig(row.config));
    }
  }
  for (const kind of ['providerModelRules', 'manualProviderModelRules']) for (const row of personal[kind]) {
    if (row.providerId !== provider.providerId || row.modelId !== modelId) continue;
    if (kind === 'manualProviderModelRules') config = clearManualFields(config);
    config = overlay(config, modelConfig(row.config, kind === 'manualProviderModelRules'));
  }
  return config;
}
function accessConfig(base, next) {
  if (next === undefined) return base;
  if (!record(base) || !record(next) || base.type !== next.type) return next;
  return overlay(base, next);
}
function providerConfig(base, next) {
  const result = overlay(base, next);
  result.access = accessConfig(base?.access, next?.access);
  // Native ProviderApiConfig replaces the headers record; it does not merge old credentials into new headers.
  if (record(result.api) && record(next?.api) && own(next.api, 'headers')) result.api.headers = clone(next.api.headers);
  return result;
}
function safeHeaders(value) {
  if (value == null) return {};
  if (!record(value) || Object.keys(value).length > 64) throw fail();
  const result = {};
  for (const [key, content] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) || typeof content !== 'string' ||
      content.length > 8192 || /[\x00-\x1f\x7f]/.test(content)) throw fail();
    result[key] = content;
  }
  return result;
}
function defaultModelSelection(config) {
  const selected = config.defaultModelSelection;
  if (!selected) return undefined;
  const effort = selected.options?.reasoningLevel;
  return { providerId: selected.providerId, modelId: selected.modelId,
    ...(text(effort, 32) ? { options: { reasoningLevel: effort } } : {}) };
}
function projectZcodePersonalProviders(document, release) {
  validateDocument(document);
  if (!record(release?.config?.providerConfigRules) || !record(release.config.modelConfigRules)) throw fail();
  const source = document.config, builtin = release.config.providerConfigRules;
  const runtimeConfig = emptyConfig(), catalog = [], resolvedModels = [], auth = new Map();
  const providerRows = new Map(source.providerConfigRules.providerRules.map(row => [row.providerId, row]));
  const enabledIds = [...providerRows.keys()].filter(id => !id.startsWith('account:') && providerRows.get(id).enabled !== false);
  for (const providerId of ordered(enabledIds, source.providerOrder)) {
    // A saved provider may still be missing its key or URL. Keep other complete providers usable.
    // Build each projection locally so a bad later model cannot publish a partial provider.
    try {
      const row = providerRows.get(providerId), inherited = (builtin.providerRules || []).find(item => item.providerId === providerId);
      if (row.enabled === undefined && inherited?.enabled === false) continue;
      const templateId = own(row, 'templateId') ? row.templateId : inherited?.templateId;
      const template = templateId ? (builtin.templateRules || []).find(item => item.templateId === templateId) : null;
      if (templateId && !template) throw fail();
      let config = providerConfig(template?.config || {}, inherited?.config || {});
      config = providerConfig(config, row.config);
      if (config.access?.type === 'zhipu-account' || config.visibility === 'hidden') continue;
      if (!['api-key', 'zhipu-coding-plan-api-key'].includes(config.access?.type) || !text(config.access.apiKey, 16384) ||
        !API_TYPES.has(config.api?.type) || !text(config.api.baseUrl, 8192)) throw fail();
      let url; try { url = new URL(config.api.baseUrl); } catch (_) { throw fail(); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail();
      const headers = safeHeaders(config.api.headers);
      const providerName = row.providerName || inherited?.providerName || template?.templateNameMap?.['zh-CN'] || template?.templateNameMap?.['en-US'] || providerId;
      const models = ordered([...new Set([...ids(config.builtinModelIds), ...ids(config.personalModelIds)])], config.modelOrder);
      const activeModels = [], providerCatalog = [], providerResolvedModels = [];
      for (const modelId of models) {
        const resolved = resolveModel(release, source.modelConfigRules, { providerId, templateId, config }, modelId);
        if (resolved.enabled !== true) continue;
        const values = resolved.optionSpecs?.reasoningLevel?.values;
        if (!Array.isArray(values) || !values.length || values.some(value => !text(value, 32))) throw fail();
        const selected = source.defaultModelSelection;
        const isDefault = selected?.providerId === providerId && selected?.modelId === modelId;
        activeModels.push(modelId);
        providerResolvedModels.push({ providerId, modelId, config: resolved });
        providerCatalog.push({ id: `zcode-custom-${hash([providerId, modelId]).slice(0, 32)}`, displayName: `${providerName} · ${modelId}`,
          providerId, providerName, modelId, apiType: config.api.type, customProvider: true,
          supportedReasoningEfforts: [...values], defaultReasoningEffort: isDefault && values.includes(selected.options?.reasoningLevel)
            ? selected.options.reasoningLevel : values[values.length - 1], isDefault });
      }
      if (!activeModels.length) continue;
      const providerModelRules = {};
      for (const kind of ['providerModelRules', 'manualProviderModelRules']) providerModelRules[kind] =
        source.modelConfigRules[kind].filter(item => item.providerId === providerId && models.includes(item.modelId))
          .map(item => ({ providerId, modelId: item.modelId, config: modelConfig(item.config, kind === 'manualProviderModelRules') }));
      catalog.push(...providerCatalog);
      resolvedModels.push(...providerResolvedModels);
      auth.set(providerId, { apiKey: config.access.apiKey, headers });
    // Keep credentials separate from model metadata; only the private runtime config receives them.
      runtimeConfig.config.providerConfigRules.providerRules.push({ providerId, providerName, enabled: true,
        ...(templateId ? { templateId } : {}), config: { group: 'standard-personal',
          access: { type: config.access.type, apiKey: RUNTIME_KEY },
          api: { type: config.api.type, baseUrl: config.api.baseUrl, headers: {} }, personalModelIds: activeModels, modelOrder: activeModels } });
      for (const kind of ['providerModelRules', 'manualProviderModelRules']) runtimeConfig.config.modelConfigRules[kind].push(...providerModelRules[kind]);
    } catch (error) {
      if (error.code !== 'ZCODE_PERSONAL_CONFIG_INVALID') throw error;
    }
  }
  const selected = defaultModelSelection(source);
  if (selected && catalog.some(row => row.providerId === selected.providerId && row.modelId === selected.modelId)) {
    runtimeConfig.config.defaultModelSelection = { providerId: selected.providerId, modelId: selected.modelId,
      ...(selected.options?.reasoningLevel ? { options: { reasoningLevel: selected.options.reasoningLevel } } : {}) };
  }
  return { catalog, runtimeConfig, defaultModelSelection: selected,
    resolvedScope: hash([document, runtimeConfig, resolvedModels, [...auth.entries()]]),
    getRequestAuth: providerId => auth.has(providerId) ? clone(auth.get(providerId)) : null };
}
function readZcodePersonalProviders({ home = os.homedir(), env = process.env, fs = nativeFs, release } = {}) {
  const configuredBase = env.ZCODE_DATA_BASE_DIR?.trim() || home;
  const baseDir = configuredBase === '~' ? home : configuredBase.startsWith('~/') ? path.join(home, configuredBase.slice(2)) : configuredBase;
  const filePath = path.join(baseDir, '.zcode', 'v2', 'provider_config.json');
  let document = emptyConfig();
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink?.() || stat.size > MAX_BYTES) throw fail();
    const content = fs.readFileSync(filePath, 'utf8');
    document = content.trim() ? JSON.parse(content) : emptyConfig();
  } catch (error) { if (error.code !== 'ENOENT') throw fail(); }
  validateDocument(document);
  const hasConfigured = document.config.providerConfigRules.providerRules.some(row => !row.providerId.startsWith('account:') && row.enabled !== false);
  const result = { scope: hash(document), baseDir, hasConfigured, catalog: [], runtimeConfig: emptyConfig(),
    defaultModelSelection: defaultModelSelection(document.config), getRequestAuth: () => null };
  return release ? { ...result, ...projectZcodePersonalProviders(document, release) } : result;
}
module.exports = { readZcodePersonalProviders, projectZcodePersonalProviders };
