const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const FORMAT_ERROR = 'OpenAI 统计响应不完整，费用未更新。';
const usageError = message => Object.assign(new Error(message), { publicMessage: message });
const fail = message => { throw usageError(message); };

function normalizeConnection(raw) {
  if (!raw || typeof raw.key !== 'string' || !/^sk-[A-Za-z0-9_-]{8,512}$/.test(raw.key.trim())) {
    fail('请输入有效的 OpenAI Platform Admin API Key。');
  }
  const config = {};
  for (const name of ['projectId', 'apiKeyId']) {
    const value = raw[name] ?? '';
    if (typeof value !== 'string' || (value.trim() &&
        (!/^[A-Za-z0-9_-]{1,200}$/.test(value.trim()) || value.trim().startsWith('sk-')))) {
      fail('项目与 API Key ID 请填写后台的 ID，不要填写密钥。');
    }
    config[name] = value.trim();
  }
  return { key: raw.key.trim(), ...config };
}

function requestJson(url, key) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }, response => {
      const status = response.statusCode;
      if (status !== 200) {
        response.destroy();
        const message = status === 401 ? 'Key 无效或已失效，请重新连接管理员 Key。'
          : status === 403 ? '没有费用或用量读取权限，请检查 Admin Key 权限。'
            : status === 429 ? '查询过于频繁，请稍后刷新。'
              : 'OpenAI 统计暂不可用，请稍后刷新。';
        finish(usageError(message));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 4 * 1024 * 1024) {
          finish(usageError(FORMAT_ERROR));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_) { finish(usageError(FORMAT_ERROR)); }
      });
      response.on('error', () => finish(usageError('统计连接中断，请稍后刷新。')));
    });
    let done = false;
    const timer = setTimeout(() => {
      finish(usageError('统计查询超时，请稍后刷新。'));
      request.destroy();
    }, 15000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    request.on('error', () => finish(usageError('无法连接 OpenAI 统计，请检查网络后刷新。')));
  });
}

async function readReport(connection, now = Date.now(), get = requestJson) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
  const end = Math.floor(now / 1000);
  async function buckets(endpoint) {
    if (end === start) return [];
    const url = new URL(`https://api.openai.com/v1/organization/${endpoint}`);
    for (const [name, value] of Object.entries({ start_time: start, end_time: end, bucket_width: '1d', limit: 31 })) {
      url.searchParams.set(name, String(value));
    }
    if (connection.projectId) url.searchParams.set('project_ids[]', connection.projectId);
    if (connection.apiKeyId) url.searchParams.set('api_key_ids[]', connection.apiKeyId);
    const data = [];
    const cursors = new Set();
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const result = await get(url, connection.key);
      if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') fail(FORMAT_ERROR);
      for (const bucket of result.data) {
        if (!Number.isInteger(bucket?.start_time) || bucket.start_time < start || bucket.start_time >= end ||
            !Number.isInteger(bucket.end_time) || bucket.end_time <= bucket.start_time ||
            !Array.isArray(bucket.results) || seen.has(bucket.start_time)) fail(FORMAT_ERROR);
        seen.add(bucket.start_time);
        data.push(bucket);
      }
      if (!result.has_more) return data;
      if (typeof result.next_page !== 'string' || !result.next_page || result.next_page.length > 2000 ||
          cursors.has(result.next_page)) fail(FORMAT_ERROR);
      cursors.add(result.next_page);
      url.searchParams.set('page', result.next_page);
    }
    fail(FORMAT_ERROR);
  }
  const [costBuckets, usageBuckets] = await Promise.all([buckets('costs'), buckets('usage/completions')]);
  const monthCosts = new Map();
  const dayCosts = new Map();
  for (const bucket of costBuckets) for (const item of bucket.results) {
    const amount = item?.amount;
    if (typeof amount?.value !== 'number' || !Number.isFinite(amount.value) ||
        typeof amount.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(amount.currency)) fail(FORMAT_ERROR);
    const currency = amount.currency.toUpperCase();
    monthCosts.set(currency, (monthCosts.get(currency) || 0) + amount.value);
    if (bucket.start_time >= today) dayCosts.set(currency, (dayCosts.get(currency) || 0) + amount.value);
  }
  if (!monthCosts.size) monthCosts.set('USD', 0);
  const money = values => [...monthCosts.keys()].sort().map(currency => {
    const value = values.get(currency) || 0;
    if (!Number.isFinite(value)) fail(FORMAT_ERROR);
    return { currency, value };
  });
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, requests: 0 };
  for (const bucket of usageBuckets) for (const item of bucket.results) {
    for (const [name, field] of Object.entries({ inputTokens: 'input_tokens', outputTokens: 'output_tokens', requests: 'num_model_requests' })) {
      if (!Number.isSafeInteger(item?.[field]) || item[field] < 0) fail(FORMAT_ERROR);
      usage[name] += item[field];
      if (!Number.isSafeInteger(usage[name])) fail(FORMAT_ERROR);
    }
    if (item.input_cached_tokens == null) usage.cachedInputTokens = null;
    else {
      if (!Number.isSafeInteger(item.input_cached_tokens) || item.input_cached_tokens < 0 ||
          item.input_cached_tokens > item.input_tokens) fail(FORMAT_ERROR);
      if (usage.cachedInputTokens !== null) {
        usage.cachedInputTokens += item.input_cached_tokens;
        if (!Number.isSafeInteger(usage.cachedInputTokens)) fail(FORMAT_ERROR);
      }
    }
  }
  return { month: date.toISOString().slice(0, 7), updatedAt: now,
    costs: { month: money(monthCosts), today: money(dayCosts) }, usage };
}

function createApiUsage({ filePath, safeStorage, onChange = () => {}, get = requestJson, now = Date.now }) {
  let connection = null;
  let busy = false;
  let error = null;
  let report = null;
  let revision = 0;
  const encryptedStorage = () => safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  try {
    if (fs.existsSync(filePath)) {
      if (!encryptedStorage() || fs.statSync(filePath).size > 16384) fail('storage');
      connection = normalizeConnection(JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath))));
    }
  } catch (_) { error = '已保存的连接无法读取，请重新连接 Admin Key。'; }
  const getState = () => ({ connected: Boolean(connection), busy, error,
    config: { projectId: connection?.projectId || '', apiKeyId: connection?.apiKeyId || '' },
    report: report && structuredClone(report) });
  const publish = () => { const state = getState(); onChange(state); return state; };
  async function query(candidate, save) {
    if (busy) return getState();
    const token = ++revision;
    busy = true;
    error = null;
    publish();
    try {
      const next = await readReport(candidate, now(), (...args) => {
        if (revision !== token) fail('查询已取消。');
        return get(...args);
      });
      if (revision !== token) return getState();
      if (save) {
        if (!encryptedStorage()) fail('本机安全存储不可用，连接未保存。');
        const encrypted = safeStorage.encryptString(JSON.stringify(candidate));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp`;
        try {
          fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
          fs.renameSync(temporary, filePath);
        } catch (_) {
          try { fs.rmSync(temporary, { force: true }); } catch (_) {}
          fail('连接未能安全保存，请重试。');
        }
      }
      connection = candidate;
      report = next;
    } catch (failure) {
      if (revision === token) error = failure.publicMessage || '查询或保存未完成，请稍后重试。';
    } finally {
      if (revision === token) { busy = false; publish(); }
    }
    return getState();
  }
  return {
    getState,
    connect(raw) {
      try {
        const candidate = connection && typeof raw?.key === 'string' && !raw.key.trim()
          ? { ...raw, key: connection.key } : raw;
        return query(normalizeConnection(candidate), true);
      }
      catch (failure) { error = failure.publicMessage || '连接未完成，请重试。'; return Promise.resolve(publish()); }
    },
    refresh() { return connection ? query(connection, false) : Promise.resolve(getState()); },
    disconnect() {
      try { fs.rmSync(filePath, { force: true }); }
      catch (_) { error = '本机连接未能移除，请重试。'; return publish(); }
      revision++;
      connection = null;
      report = null;
      busy = false;
      error = null;
      return publish();
    },
    close() { revision++; connection = null; report = null; busy = false; }
  };
}

module.exports = { createApiUsage, readReport, normalizeConnection };
