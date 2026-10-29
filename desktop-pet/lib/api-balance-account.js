const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const ORIGIN = 'https://api.moonshot.cn';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ACCOUNTS = 32;
const credentials = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validKey = value => typeof value === 'string' && /^[\x21-\x7e]{8,4096}$/.test(value)
  && !/^(?:enc:|__|\$|<)/.test(value);
function configPath({ home = os.homedir(), env = process.env } = {}) {
  const base = typeof env.ZCODE_DATA_BASE_DIR === 'string' && env.ZCODE_DATA_BASE_DIR.trim() || home;
  return path.join(base === '~' ? home : base.startsWith('~/') ? path.join(home, base.slice(2)) : base,
    '.zcode', 'v2', 'provider_config.json');
}
function officialOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api.moonshot.cn' && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && ['/anthropic', '/anthropic/', '/v1', '/v1/'].includes(url.pathname) ? ORIGIN : null;
  } catch (_) { return null; }
}
function nameOf(value, fallback, secret) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  // Check the full original/normalized text before truncating: a long key must
  // never become an apparently harmless 64-character fragment in public UI state.
  if (!clean || secret && (value.includes(secret) || clean.includes(secret)) || /\bsk-[A-Za-z0-9_-]{8,}/.test(clean)) return fallback;
  return clean.slice(0, 64);
}
// A known built-in template may omit config.api.baseUrl. This default is from the
// installed ZCode moonshot-kimi template; an explicit override never gets ignored.
function parseApiBalanceAccounts(raw) {
  const rules = raw?.config?.providerConfigRules?.providerRules;
  if (!object(raw) || !object(raw.config) || !object(raw.config.providerConfigRules) || !Array.isArray(rules)
    || rules.length > 256) throw fail('CONFIG_INVALID');
  const rows = [], seen = new Map();
  for (const [index, rule] of rules.entries()) {
    if (!object(rule)) continue;
    const config = object(rule.config) ? rule.config : {};
    const access = object(config.access) ? config.access : {};
    const api = object(config.api) ? config.api : {};
    const key = validKey(access.apiKey) ? access.apiKey : null;
    const template = typeof rule.templateId === 'string' ? rule.templateId : '';
    const providerId = typeof rule.providerId === 'string' ? rule.providerId : '';
    const isKimi = template === 'moonshot-kimi' || providerId === 'moonshot-kimi';
    // Cover the actual api.baseUrl shape plus explicit common legacy aliases.
    // Conflicting/unknown overrides fail closed instead of sending their key elsewhere.
    const overrides = [api.baseUrl, api.baseURL, api.endpoint, config.baseUrl, config.baseURL,
      config.endpoint, access.baseUrl, access.baseURL, access.endpoint, rule.baseUrl, rule.baseURL]
      .filter(value => value !== undefined && value !== null);
    const origin = overrides.length ? overrides.every(value => officialOrigin(value) === ORIGIN) ? ORIGIN : null
      : isKimi ? ORIGIN : null;
    const provider = isKimi || origin === ORIGIN ? 'moonshot' : 'unknown';
    const supported = provider === 'moonshot' && origin === ORIGIN;
    const active = ![rule.enabled, rule.active, config.enabled, config.active, access.enabled, api.enabled].includes(false);
    const status = !active ? 'disabled' : !supported ? 'unsupported' : !key || access.type && access.type !== 'api-key'
      ? 'unconfigured' : 'ready';
    const code = !active ? null : !supported ? isKimi ? 'UNSUPPORTED_ENDPOINT' : 'UNSUPPORTED_PROVIDER'
      : status === 'unconfigured' ? 'MISSING_API_KEY' : null;
    const id = supported && key
      ? hash(['api-balance-v1', provider, origin, key])
      : hash(['api-balance-config-v1', providerId || index, template, overrides, supported ? 'no-key' : 'unsupported']);
    const entry = { id, name: nameOf(rule.providerName, provider === 'moonshot' ? 'Kimi' : '其他 API', key),
      provider, currency: supported ? 'CNY' : null, supported, status, errorCode: code };
    if (status === 'ready') credentials.set(entry, { apiKey: key, origin });
    const previous = seen.get(id);
    if (previous !== undefined) {
      if (rows[previous].status !== 'ready' && entry.status === 'ready') rows[previous] = entry;
      continue;
    }
    if (rows.length === MAX_ACCOUNTS) break;
    seen.set(id, rows.length); rows.push(entry);
  }
  const names = new Map();
  rows.forEach(row => names.set(row.name, [...names.get(row.name) || [], row]));
  for (const duplicates of names.values()) if (duplicates.length > 1) {
    // Hash order keeps suffixes stable when the source list is reordered, without key tails.
    [...duplicates].sort((a, b) => a.id.localeCompare(b.id)).forEach((row, index) => { row.name += ` · ${index + 1}`; });
  }
  return rows;
}
function readApiBalanceAccounts(options = {}) {
  const fs = options.fs || nativeFs, file = configPath(options);
  let data;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw fail('CONFIG_INVALID');
    data = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(data) > MAX_BYTES) throw fail('CONFIG_INVALID');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return [];
    throw fail(error.code === 'CONFIG_INVALID' ? error.code : 'CONFIG_UNAVAILABLE');
  }
  try { return parseApiBalanceAccounts(JSON.parse(data)); }
  catch (_) { throw fail('CONFIG_INVALID'); }
}
function getApiBalanceCredential(account) { return credentials.get(account) || null; }
function watchApiBalanceAccounts(onChange, options = {}) {
  const fs = options.fs || nativeFs, file = configPath(options);
  let watcher;
  try {
    watcher = fs.watch(path.dirname(file), { persistent: false }, (_event, filename) => {
      if (!filename || String(filename) === path.basename(file)) onChange();
    });
    watcher.on('error', () => {});
  } catch (_) { /* Polling still discovers newly created or changed configuration. */ }
  return () => { try { watcher?.close(); } catch (_) {} watcher = null; };
}
module.exports = { readApiBalanceAccounts, parseApiBalanceAccounts, getApiBalanceCredential,
  watchApiBalanceAccounts, officialOrigin, MAX_ACCOUNTS };
