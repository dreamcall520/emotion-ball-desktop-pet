const https = require('node:https');
const { getApiBalanceCredential } = require('./api-balance-account');
const ENDPOINT = 'https://api.moonshot.cn/v1/users/me/balance';
const MESSAGES = {
  CONFIG_UNAVAILABLE: '暂时无法读取 API 配置。', CONFIG_INVALID: 'API 配置格式暂不可用。',
  UNSUPPORTED_PROVIDER: '该供应商暂未接入余额查询。', UNSUPPORTED_ENDPOINT: '该 API 地址暂未接入余额查询。',
  MISSING_API_KEY: '请在 ZCode 中配置此账户的 API Key。', UNAUTHENTICATED: 'API Key 已失效，请在 ZCode 中更新。',
  RATE_LIMITED: '查询较频繁，稍后会自动重试。', TIMEOUT: '余额查询超时，稍后重试。',
  CONNECTION_FAILED: '暂时无法连接余额服务。', SERVICE_UNAVAILABLE: '余额服务暂不可用。',
  INVALID_RESPONSE: '余额数据不完整，本次未更新。', CANCELLED: '已停止余额查询。'
};
function apiBalanceError(code) {
  if (!Object.hasOwn(MESSAGES, code)) code = 'CONNECTION_FAILED';
  return Object.assign(new Error(MESSAGES[code]), { code, publicMessage: MESSAGES[code] });
}
function validAmount(value) { return Number.isFinite(value) && Math.abs(value) <= 1e12; }
function parseBalance(value) {
  const data = value?.data;
  if (value?.code !== 0 || value?.status !== true || !data || typeof data !== 'object' || Array.isArray(data)
    || !validAmount(data.available_balance)
    || !validAmount(data.cash_balance) || !validAmount(data.voucher_balance) || data.voucher_balance < 0) {
    throw apiBalanceError('INVALID_RESPONSE');
  }
  return { available: data.available_balance, cash: data.cash_balance, voucher: data.voucher_balance, currency: 'CNY' };
}
function createApiBalanceClient({ request = https.request, timeoutMs = 15000,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  return function fetchApiBalance(account, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(apiBalanceError('CANCELLED'));
    if (!account?.supported || account.provider !== 'moonshot') return Promise.reject(apiBalanceError('UNSUPPORTED_PROVIDER'));
    const credential = getApiBalanceCredential(account);
    if (!credential) return Promise.reject(apiBalanceError(account.errorCode || 'MISSING_API_KEY'));
    if (credential.origin !== 'https://api.moonshot.cn') return Promise.reject(apiBalanceError('UNSUPPORTED_ENDPOINT'));
    return new Promise((resolve, reject) => {
      let req, res, timer, settled = false, bytes = 0, chunks = [];
      const abort = () => finish(apiBalanceError('CANCELLED'));
      function finish(error, value) {
        if (settled) return;
        settled = true; cancel(timer); signal?.removeEventListener('abort', abort);
        chunks = [];
        if (error) { res?.destroy?.(); req?.destroy?.(); reject(error); }
        else resolve(value);
      }
      timer = schedule(() => finish(apiBalanceError('TIMEOUT')), Math.max(1, Math.min(30000, timeoutMs)));
      timer?.unref?.();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        req = request(ENDPOINT, { method: 'GET', headers: { Authorization: `Bearer ${credential.apiKey}`,
          Accept: 'application/json', 'User-Agent': 'Qiuqiu-ApiBalance/1' } }, response => {
          res = response;
          if (settled) { res.destroy?.(); return; }
          res.on('error', () => finish(apiBalanceError('CONNECTION_FAILED')));
          res.on('aborted', () => finish(apiBalanceError('CONNECTION_FAILED')));
          const status = res.statusCode;
          if (status !== 200) {
            const code = [401, 403].includes(status) ? 'UNAUTHENTICATED' : status === 429 ? 'RATE_LIMITED'
              : status >= 300 && status < 400 ? 'UNSUPPORTED_ENDPOINT' : status >= 500 ? 'SERVICE_UNAVAILABLE' : 'INVALID_RESPONSE';
            const error = apiBalanceError(code);
            if (status === 429) {
              const seconds = Number(res.headers?.['retry-after']);
              if (Number.isFinite(seconds) && seconds > 0) error.retryAfterMs = Math.min(1800000, Math.max(60000, seconds * 1000));
            }
            finish(error); return;
          }
          if (Number(res.headers?.['content-length']) > 128 * 1024) { finish(apiBalanceError('INVALID_RESPONSE')); return; }
          res.on('data', chunk => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > 128 * 1024) { finish(apiBalanceError('INVALID_RESPONSE')); return; }
            chunks.push(buffer);
          });
          res.on('end', () => {
            if (settled) return;
            try { finish(null, parseBalance(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
            catch (_) { finish(apiBalanceError('INVALID_RESPONSE')); }
          });
        });
        req.on('error', () => finish(apiBalanceError('CONNECTION_FAILED')));
        req.end();
        if (signal?.aborted) abort();
      } catch (_) { finish(apiBalanceError('CONNECTION_FAILED')); }
    });
  };
}
const fetchApiBalance = createApiBalanceClient();
module.exports = { createApiBalanceClient, fetchApiBalance, apiBalanceError, parseBalance, validAmount };
