const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { readReport, createApiUsage, normalizeConnection } = require('../lib/api-usage');

const now = Date.parse('2026-10-02T12:00:00Z');
const day = Date.parse('2026-10-02T00:00:00Z') / 1000;
const month = day - 86400;
const connection = { key: 'sk-admin-demo-not-a-real-key', projectId: 'proj_codex', apiKeyId: 'key_codex' };
const bucket = (start, results) => ({ start_time: start, end_time: start + 86400, results });
const page = data => ({ data, has_more: false, next_page: null });
const cost = (value, currency = 'usd') => ({ amount: { value, currency } });
const tokens = (input, output, cached) => ({ input_tokens: input, output_tokens: output,
  input_cached_tokens: cached, num_model_requests: 2 });

test('official reports use UTC, exact money units, filters and complete pagination', async () => {
  const calls = [];
  const report = await readReport(connection, now, async (url, key) => {
    calls.push(url.toString());
    assert.equal(url.origin, 'https://api.openai.com');
    assert.equal(key, connection.key);
    assert.equal(url.searchParams.get('start_time'), String(month));
    assert.equal(url.searchParams.get('end_time'), String(now / 1000));
    assert.equal(url.searchParams.get('limit'), '31');
    assert.equal(url.searchParams.get('project_ids[]'), 'proj_codex');
    assert.equal(url.searchParams.get('api_key_ids[]'), 'key_codex');
    if (url.pathname.endsWith('/costs')) {
      return url.searchParams.has('page') ? page([bucket(day, [cost(0.06), cost(-0.01), cost(2, 'eur')])])
        : { data: [bucket(month, [cost(1.25)])], has_more: true, next_page: 'next + / =' };
    }
    return page([bucket(month, [tokens(10000, 2000, 4000)]), bucket(day, [tokens(3000, 1000, 500)])]);
  });
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls.find(value => value.includes('page='))).searchParams.get('page'), 'next + / =');
  assert.deepEqual(report.costs.month, [{ currency: 'EUR', value: 2 }, { currency: 'USD', value: 1.3 }]);
  assert.ok(Math.abs(report.costs.today.find(item => item.currency === 'USD').value - 0.05) < 1e-10);
  assert.deepEqual(report.usage, { inputTokens: 13000, outputTokens: 3000, cachedInputTokens: 4500, requests: 4 });
  assert.equal(report.month, '2026-10');
});

test('complete empty reports are zero; missing amounts and broken pagination are unknown', async () => {
  const empty = await readReport(connection, now, async () => page([]));
  assert.deepEqual(empty.costs.month, [{ currency: 'USD', value: 0 }]);
  const unknown = await readReport(connection, now, async url => url.pathname.endsWith('/costs')
    ? page([]) : page([bucket(day, [tokens(10, 2, undefined)])]));
  assert.equal(unknown.usage.cachedInputTokens, null);
  await assert.rejects(readReport(connection, now, async () => page([bucket(day, [{}])])), /响应不完整/);
  await assert.rejects(readReport(connection, now, async () => ({ data: [], has_more: true, next_page: 'loop' })), /响应不完整/);
  await assert.rejects(readReport(connection, now, async url => url.pathname.endsWith('/costs')
    ? page([]) : page([bucket(day, [tokens(10, 2, 11)])])), /响应不完整/);
  assert.throws(() => normalizeConnection({ ...connection, key: 'sk-evil\r\nheader' }), /有效/);
  assert.throws(() => normalizeConnection({ ...connection, apiKeyId: connection.key }), /不要填写密钥/);
});

test('encrypted connection, sanitized snapshots and failed scope change retain the matching report', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-usage-'));
  const filePath = path.join(directory, 'usage.enc');
  // Stand-in for the OS-backed Electron safeStorage, without touching a real vault.
  const encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
  let get = async () => page([]);
  const service = createApiUsage({ filePath, safeStorage, now: () => now, get: (...args) => get(...args) });
  try {
    const connected = await service.connect(connection);
    assert.equal(connected.connected, true);
    assert.equal(fs.readFileSync(filePath).includes(Buffer.from(connection.key)), false);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(connected).includes(connection.key), false);
    const restored = createApiUsage({ filePath, safeStorage });
    assert.equal(restored.getState().connected, true);
    assert.deepEqual(restored.getState().config, connected.config);
    restored.close();
    const filtered = await service.connect({ key: '', projectId: 'proj_new', apiKeyId: '' });
    assert.equal(filtered.config.projectId, 'proj_new');
    assert.equal(JSON.stringify(filtered).includes(connection.key), false);
    get = async () => { throw new Error(`secret: ${connection.key}`); };
    const failed = await service.connect({ ...connection, projectId: 'proj_other' });
    assert.deepEqual(failed.report, filtered.report);
    assert.deepEqual(failed.config, filtered.config);
    assert.equal(JSON.stringify(failed).includes(connection.key), false);
    assert.equal(service.disconnect().connected, false);
    assert.equal(fs.existsSync(filePath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('late queries cannot restore a disconnected source; insecure storage never writes plaintext', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-api-usage-'));
  const filePath = path.join(directory, 'usage.enc');
  const gates = [];
  const service = createApiUsage({ filePath, safeStorage: { isEncryptionAvailable: () => false },
    now: () => now, get: () => new Promise(resolve => gates.push(resolve)) });
  try {
    const pending = service.connect(connection);
    service.disconnect();
    gates.forEach(resolve => resolve({ data: [], has_more: true, next_page: 'after-disconnect' }));
    assert.equal((await pending).connected, false);
    assert.equal(gates.length, 2, 'disconnect prevents new pagination requests with the old key');
    assert.equal(fs.existsSync(filePath), false);
    const insecure = createApiUsage({ filePath, safeStorage: { isEncryptionAvailable: () => false },
      now: () => now, get: async () => page([]) });
    const state = await insecure.connect(connection);
    assert.equal(state.connected, false);
    assert.match(state.error, /安全存储不可用/);
    assert.equal(fs.existsSync(filePath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP redirects are rejected without sending credentials onward or exposing response bodies', async t => {
  const original = https.get;
  t.after(() => { https.get = original; });
  const urls = [];
  https.get = (url, options, receive) => {
    urls.push(url.toString());
    assert.equal(url.origin, 'https://api.openai.com');
    assert.equal(options.headers.Authorization, `Bearer ${connection.key}`);
    const request = new EventEmitter();
    request.destroy = () => {};
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 302;
      response.headers = { location: 'https://untrusted.example/' };
      response.destroy = () => {};
      receive(response);
    });
    return request;
  };
  await assert.rejects(readReport(connection, now), error => {
    assert.equal(error.message.includes(connection.key), false);
    assert.match(error.message, /统计暂不可用/);
    return true;
  });
  assert.equal(urls.length, 2);
});
