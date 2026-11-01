'use strict';
const { aggregateUsage, usageRange } = require('./workbuddy-usage-reader');

const ENDPOINT = 'https://www.workbuddy.cn/billing/meter/get-user-request-usage';
const MESSAGES = Object.freeze({
  LOGIN_REQUIRED: '请在球球自己的 WorkBuddy 网页中登录后重试。',
  RATE_LIMITED: 'WorkBuddy 查询过于频繁，请稍后重试。',
  REDIRECT_REJECTED: 'WorkBuddy 查询发生意外跳转，本次未更新。',
  TIMEOUT: 'WorkBuddy 查询超时，本次未更新。',
  CANCELLED: '已取消 WorkBuddy 查询。',
  RESPONSE_TOO_LARGE: 'WorkBuddy 返回内容过大，本次未更新。',
  INVALID_RESPONSE: 'WorkBuddy 返回格式异常，本次未更新。',
  API_ERROR: 'WorkBuddy 未能提供额度，本次未更新。',
  NO_CREDIT_DATA: 'WorkBuddy 未提供可识别的积分汇总。',
  SERVICE_UNAVAILABLE: 'WorkBuddy 服务暂不可用。',
  CONNECTION_FAILED: '无法连接 WorkBuddy，请稍后重试。',
  USAGE_INCOMPLETE: 'WorkBuddy 用量分页不完整，本次未更新。',
  SESSION_UNAVAILABLE: 'WorkBuddy 网页会话暂不可用。'
});
function usageError(code) {
  return Object.assign(new Error(MESSAGES[code]), { code });
}
// Independent candidate, not wired to main.js. The caller owns an Electron Session
// where the user signs into WorkBuddy. Never imports browser cookies or desktop keys.
// No raw response, cookie, token, account ID or provider exception leaves this module.
function createWorkBuddyWebUsage({ session, timeoutMs = 10000, maxResponseBytes = 256 * 1024, now = Date.now } = {}) {
  if (!session || typeof session.fetch !== 'function' || typeof session.getUserAgent !== 'function') {
    throw new TypeError('A website Session with fetch/getUserAgent is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024) {
    throw new TypeError('Invalid request limits');
  }
  async function readUsage({ signal } = {}) {
    if (signal?.aborted) throw usageError('CANCELLED');
    let userAgent;
    try { userAgent = session.getUserAgent(); }
    catch (_) { throw usageError('SESSION_UNAVAILABLE'); }
    if (typeof userAgent !== 'string' || !userAgent || /[^\x20-\x7e]/.test(userAgent)) throw usageError('SESSION_UNAVAILABLE');
    const controller = new AbortController();
    let reader, response, interrupt, timer, abortCode;
    const interrupted = new Promise((_, reject) => { interrupt = reject; });
    const stop = code => {
      if (abortCode) return;
      abortCode = code;
      controller.abort();
      // Cancelling the body stream matters even when an injected fetch ignores signal.
      if (reader) { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} }
      interrupt(usageError(code));
    };
    const onAbort = () => stop('CANCELLED');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const operation = (async () => {
      try {
        if (abortCode) throw usageError(abortCode);
        const startedAt = now(), range = usageRange(startedAt), pages = [];
        let total = null, received = 0;
        for (let pageNum = 1; pageNum <= 100; pageNum++) {
          response = await session.fetch(ENDPOINT, {
            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': userAgent, 'X-Client-Platform': 'web' },
            body: JSON.stringify({ startTime: range.startDate + ' 00:00:00', endTime: range.endDate + ' 23:59:59', pageNum, pageSize: 100 }), credentials: 'include', redirect: 'manual', signal: controller.signal
          });
          if (abortCode) throw usageError(abortCode);
          if (!response || !Number.isInteger(response.status)) throw usageError('INVALID_RESPONSE');
          if (response.redirected || response.type === 'opaqueredirect' || (response.url && response.url !== ENDPOINT) ||
              response.status >= 300 && response.status < 400) throw usageError('REDIRECT_REJECTED');
          if (response.status === 401 || response.status === 403) throw usageError('LOGIN_REQUIRED');
          if (response.status === 429) throw usageError('RATE_LIMITED');
          if (response.status >= 500) throw usageError('SERVICE_UNAVAILABLE');
          if (response.status !== 200) throw usageError('API_ERROR');
          const declared = response.headers?.get?.('content-length');
          if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) throw usageError('RESPONSE_TOO_LARGE');
          if (!response.body || typeof response.body.getReader !== 'function') throw usageError('INVALID_RESPONSE');
          reader = response.body.getReader();
          let bytes = 0;
          const chunks = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (abortCode) throw usageError(abortCode);
            if (done) break;
            if (!(value instanceof Uint8Array)) throw usageError('INVALID_RESPONSE');
            bytes += value.byteLength;
            if (bytes > maxResponseBytes) throw usageError('RESPONSE_TOO_LARGE');
            chunks.push(value);
          }
          const body = Buffer.concat(chunks, bytes);
          let raw;
          try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
          catch (_) { throw usageError('INVALID_RESPONSE'); }
          reader.releaseLock(); reader = null;
          if (raw?.code === 401 || raw?.code === 403) throw usageError('LOGIN_REQUIRED');
          if (raw?.code !== 0) throw usageError('API_ERROR');
          const data = raw.data;
          if (!data || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 10000 ||
              !Array.isArray(data.data) || data.data.length > 100) throw usageError('INVALID_RESPONSE');
          if (total === null) total = data.total;
          if (total !== data.total) throw usageError('USAGE_INCOMPLETE');
          pages.push(data.data.map(row => ({ requestTime: row?.requestTime, credit: row?.credit, requestId: row?.requestId })));
          received += data.data.length;
          if (received > total) throw usageError('USAGE_INCOMPLETE');
          if (received === total) {
            let aggregated;
            try { aggregated = aggregateUsage(pages, range, startedAt); }
            catch (_) { throw usageError('INVALID_RESPONSE'); }
            const { delayHours, ...report } = aggregated;
            return { ...report, source: 'website-usage', scope: 'website-request-usage' };
          }
          if (data.data.length !== 100) throw usageError('USAGE_INCOMPLETE');
        }
        throw usageError('USAGE_INCOMPLETE');
      } catch (error) {
        if (abortCode) throw usageError(abortCode);
        if (Object.hasOwn(MESSAGES, error?.code)) throw usageError(error.code);
        throw usageError('CONNECTION_FAILED');
      } finally {
        if (!reader && response?.body?.cancel) { try { void Promise.resolve(response.body.cancel()).catch(() => {}); } catch (_) {} }
        if (reader) {
          try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) { /* No raw provider/body error is retained. */ }
          try { reader.releaseLock(); } catch (_) { /* A cancelled pending read may still own it. */ }
        }
      }
    })();
    try { return await Promise.race([operation, interrupted]); }
    finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort); controller.abort();
      if (!reader && response?.body?.cancel) {
        try { void Promise.resolve(response.body.cancel()).catch(() => {}); } catch (_) {}
      }
    }
  }
  return { readUsage };
}
module.exports = { createWorkBuddyWebUsage };
