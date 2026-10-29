const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { parseApiBalanceAccounts, readApiBalanceAccounts, getApiBalanceCredential, officialOrigin,
  watchApiBalanceAccounts } = require('../lib/api-balance-account');
const rule = (id = 'moonshot-kimi', key = 'sk-test-account-one', patch = {}) => ({ providerId: id,
  templateId: 'moonshot-kimi', providerName: 'Kimi', config: { access: { type: 'api-key', apiKey: key } }, ...patch });
const config = rows => ({ schemaVersion: 1, config: { providerConfigRules: { providerRules: rows } } });
test('actual template shape resolves domestic Kimi and exposes no credential in metadata', () => {
  const rows = parseApiBalanceAccounts(config([rule()]));
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'ready'); assert.equal(rows[0].provider, 'moonshot');
  assert.equal(rows[0].currency, 'CNY'); assert.match(rows[0].id, /^[a-f0-9]{64}$/);
  assert.deepEqual(getApiBalanceCredential(rows[0]), { apiKey: 'sk-test-account-one', origin: 'https://api.moonshot.cn' });
  assert.doesNotMatch(JSON.stringify(rows), /sk-test|apiKey|anthropic|baseUrl/);
  assert.equal(getApiBalanceCredential(structuredClone(rows[0])), null, 'cloning public metadata does not copy keys');
});
test('same key and official origin deduplicate across paths; distinct keys retain stable IDs and names', () => {
  const a = rule('kimi-work'), b = rule('kimi-private', 'sk-test-account-two');
  const alias = rule('kimi-duplicate', 'sk-test-account-one', { config: { access: a.config.access, api: { baseUrl: 'https://api.moonshot.cn/v1/' } } });
  const rows = parseApiBalanceAccounts(config([a, b, alias]));
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id); assert.notEqual(rows[0].name, rows[1].name);
  const reordered = parseApiBalanceAccounts(config([b, a]));
  for (const row of rows) assert.equal(reordered.find(item => item.id === row.id).name, row.name);
});
test('explicit unsafe or conflicting endpoints never inherit the official template credential route', () => {
  const values = ['http://api.moonshot.cn/v1', 'https://api.moonshot.cn.attacker.test/v1',
    'https://api.moonshot.cn/v1?key=secret', 'https://user:pass@api.moonshot.cn/v1',
    'https://api.moonshot.cn:444/v1', 'https://api.moonshot.ai/v1', 'https://api.moonshot.cn/proxy', ''];
  for (const baseUrl of values) {
    const row = parseApiBalanceAccounts(config([rule(undefined, undefined, { config: {
      access: { type: 'api-key', apiKey: 'sk-test-account-one' }, api: { baseUrl } } })]))[0];
    assert.equal(row.supported, false, baseUrl); assert.equal(row.errorCode, 'UNSUPPORTED_ENDPOINT');
    assert.equal(getApiBalanceCredential(row), null);
  }
  assert.equal(officialOrigin('https://api.moonshot.cn/anthropic'), 'https://api.moonshot.cn');
  const row = rule(); row.config.api = { baseUrl: 'https://api.moonshot.cn/v1' }; row.config.access.baseURL = 'https://proxy.test/v1';
  assert.equal(parseApiBalanceAccounts(config([row]))[0].supported, false);
});
test('manual official Kimi endpoints are supported; other providers remain listed without credentials', () => {
  const custom = rule('custom-kimi'); custom.templateId = 'custom'; custom.config.api = { baseUrl: 'https://api.moonshot.cn/v1' };
  const other = rule('other', 'sk-other-key', { templateId: 'openai', providerName: 'Other' });
  const rows = parseApiBalanceAccounts(config([custom, other]));
  assert.equal(rows[0].supported, true); assert.equal(rows[1].supported, false); assert.equal(rows[1].status, 'unsupported');
  assert.equal(getApiBalanceCredential(rows[1]), null); assert.equal(rows[1].currency, null);
});
test('false enabled/active flags prevent queries and a ready duplicate takes precedence', () => {
  for (const patch of [{ enabled: false }, { active: false }, { config: { ...rule().config, enabled: false } },
    { config: { ...rule().config, active: false } }]) {
    const row = parseApiBalanceAccounts(config([rule(undefined, undefined, patch)]))[0];
    assert.equal(row.status, 'disabled'); assert.equal(getApiBalanceCredential(row), null);
  }
  const rows = parseApiBalanceAccounts(config([rule(undefined, undefined, { enabled: false }), rule('enabled-copy')]));
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'ready');
});
test('missing/encrypted/unsafe keys are unconfigured and credential-like names are redacted', () => {
  for (const apiKey of [null, '', 'abc', 'enc:v1:some-value', 'sk-test\nInjected: bad']) {
    const row = parseApiBalanceAccounts(config([rule('moonshot-kimi', apiKey)]))[0];
    assert.equal(row.status, 'unconfigured'); assert.equal(getApiBalanceCredential(row), null);
  }
  assert.equal(parseApiBalanceAccounts(config([rule(undefined, undefined, { providerName: 'sk-test-account-one' })]))[0].name, 'Kimi');
});
test('file reader is bounded, honors data base dir, and rejects symlink/malformed stores without exposing raw content', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-accounts-'));
  try {
    const dir = path.join(home, '.zcode/v2'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'provider_config.json');
    assert.deepEqual(readApiBalanceAccounts({ home, env: {} }), []);
    fs.writeFileSync(file, JSON.stringify(config([rule()])));
    assert.equal(readApiBalanceAccounts({ home: '/not-used', env: { ZCODE_DATA_BASE_DIR: home } })[0].status, 'ready');
    fs.writeFileSync(file, '{"secret":"sk-test-account-one"');
    assert.throws(() => readApiBalanceAccounts({ home, env: {} }), e => e.code === 'CONFIG_INVALID' && !String(e).includes('sk-test'));
    fs.unlinkSync(file); fs.symlinkSync(path.join(home, 'target'), file);
    fs.writeFileSync(path.join(home, 'target'), JSON.stringify(config([rule()])));
    assert.throws(() => readApiBalanceAccounts({ home, env: {} }), e => e.code === 'CONFIG_INVALID');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
test('watch filters unrelated files and closes cleanly', () => {
  let callback, count = 0, closed = false;
  const stop = watchApiBalanceAccounts(() => count++, { home: '/fixture', env: {}, fs: {
    watch(dir, options, fn) { callback = fn; assert.equal(options.persistent, false); return { on() {}, close() { closed = true; } }; }
  } });
  callback('change', 'other.json'); callback('change', 'provider_config.json'); callback('rename', null);
  assert.equal(count, 2); stop(); assert.equal(closed, true);
});

test('oversized configuration is rejected before reading credential content', () => {
  let reads = 0;
  assert.throws(() => readApiBalanceAccounts({ home: '/fixture', env: {}, fs: {
    lstatSync() { return { isFile: () => true, isSymbolicLink: () => false, size: 2 * 1024 * 1024 + 1 }; },
    readFileSync() { reads++; return '{}'; }
  } }), { code: 'CONFIG_INVALID' });
  assert.equal(reads, 0);
});

test('long credentials in display names are redacted before truncation, including normalized text', () => {
  const key = 'fixture-private-' + 'a'.repeat(180);
  for (const providerName of [key, 'Personal ' + key, key.slice(0, 20) + '\u202e' + key.slice(20), 'sk-' + 'b'.repeat(160)]) {
    const row = parseApiBalanceAccounts(config([rule('moonshot-kimi', key, { providerName })]))[0];
    assert.equal(row.name, 'Kimi');
    assert.doesNotMatch(JSON.stringify(row), /fixture-private-|aaaaaaaa|bbbbbbbb/);
  }
  const normal = parseApiBalanceAccounts(config([rule(undefined, undefined, { providerName: 'Work '.repeat(30) })]))[0];
  assert.equal(normal.name.length, 64);
});
