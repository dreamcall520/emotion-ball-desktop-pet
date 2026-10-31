'use strict';

const ENDPOINT = 'https://www.workbuddy.cn/billing/meter/get-user-resource-summary';
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
  SESSION_UNAVAILABLE: 'WorkBuddy 网页会话暂不可用。'
});
function quotaError(code) {
  return Object.assign(new Error(MESSAGES[code]), { code });
}
function capacity(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    throw quotaError('INVALID_RESPONSE');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw quotaError('INVALID_RESPONSE');
  return number;
}
function summarize(raw, updatedAt) {
  if (raw?.code !== 0) {
    if (raw?.code === 401 || raw?.code === 403) throw quotaError('LOGIN_REQUIRED');
    throw quotaError('API_ERROR');
  }
  if (!Array.isArray(raw?.data?.Packages)) throw quotaError('INVALID_RESPONSE');
  let total = 0, remaining = 0, reserved = 0, count = 0;
  const names = new Set();
  for (const pkg of raw.data.Packages) {
    if (!pkg || pkg.CapacityUnit !== 'credits') continue;
    total += capacity(pkg.CycleTotalCapacity);
    remaining += capacity(pkg.CycleRemainCapacity);
    reserved += pkg.CycleFrozenCapacity === undefined ? 0 : capacity(pkg.CycleFrozenCapacity);
    if (![total, remaining, reserved].every(Number.isFinite)) throw quotaError('INVALID_RESPONSE');
    if (pkg.SubscriptionPackageName !== undefined) {
      if (typeof pkg.SubscriptionPackageName !== 'string' || pkg.SubscriptionPackageName.length > 200) {
        throw quotaError('INVALID_RESPONSE');
      }
      const name = pkg.SubscriptionPackageName.trim();
      if (name) names.add(name);
    }
    count++;
  }
  if (!count) throw quotaError('NO_CREDIT_DATA');
  if (!Number.isFinite(updatedAt) || updatedAt < 0) throw quotaError('INVALID_RESPONSE');
  return {
    scope: 'website-summary',
    credits: { total, remaining, used: Math.max(0, total - remaining), reserved },
    planNames: [...names], updatedAt,
    coverage: { packages: 'credits-only', basicRewardPurchased: 'not-separated',
      cycleReset: 'not-queried', enterpriseLimit: 'not-verified' }
  };
}

// Independent candidate, not wired to main.js. The caller owns an Electron Session
// where the user signs into WorkBuddy. Never imports browser cookies or desktop keys.
// No raw response, cookie, token, account ID or provider exception leaves this module.
function createWorkBuddyWebQuota({ session, timeoutMs = 10000, maxResponseBytes = 256 * 1024, now = Date.now } = {}) {
  if (!session || typeof session.fetch !== 'function' || typeof session.getUserAgent !== 'function') {
    throw new TypeError('A website Session with fetch/getUserAgent is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024) {
    throw new TypeError('Invalid request limits');
  }
  async function readSummary({ signal } = {}) {
    if (signal?.aborted) throw quotaError('CANCELLED');
    let userAgent;
    try { userAgent = session.getUserAgent(); }
    catch (_) { throw quotaError('SESSION_UNAVAILABLE'); }
    if (typeof userAgent !== 'string' || !userAgent || /[\r\n]/.test(userAgent)) throw quotaError('SESSION_UNAVAILABLE');
    const controller = new AbortController();
    let reader, response, interrupt, timer, abortCode;
    const interrupted = new Promise((_, reject) => { interrupt = reject; });
    const stop = code => {
      if (abortCode) return;
      abortCode = code;
      controller.abort();
      // Cancelling the body stream matters even when an injected fetch ignores signal.
      if (reader) { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} }
      interrupt(quotaError(code));
    };
    const onAbort = () => stop('CANCELLED');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const operation = (async () => {
      try {
        if (abortCode) throw quotaError(abortCode);
        response = await session.fetch(ENDPOINT, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': userAgent },
          body: '{}', credentials: 'include', redirect: 'manual', signal: controller.signal
        });
        if (abortCode) throw quotaError(abortCode);
        if (!response || !Number.isInteger(response.status)) throw quotaError('INVALID_RESPONSE');
        if (response.redirected || response.type === 'opaqueredirect' || (response.url && response.url !== ENDPOINT) ||
            response.status >= 300 && response.status < 400) throw quotaError('REDIRECT_REJECTED');
        if (response.status === 401 || response.status === 403) throw quotaError('LOGIN_REQUIRED');
        if (response.status === 429) throw quotaError('RATE_LIMITED');
        if (response.status >= 500) throw quotaError('SERVICE_UNAVAILABLE');
        if (response.status !== 200) throw quotaError('API_ERROR');
        const declared = response.headers?.get?.('content-length');
        if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) throw quotaError('RESPONSE_TOO_LARGE');
        if (!response.body || typeof response.body.getReader !== 'function') throw quotaError('INVALID_RESPONSE');
        reader = response.body.getReader();
        let bytes = 0;
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (abortCode) throw quotaError(abortCode);
          if (done) break;
          if (!(value instanceof Uint8Array)) throw quotaError('INVALID_RESPONSE');
          bytes += value.byteLength;
          if (bytes > maxResponseBytes) throw quotaError('RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
        const body = Buffer.concat(chunks, bytes);
        let raw;
        try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
        catch (_) { throw quotaError('INVALID_RESPONSE'); }
        return summarize(raw, now());
      } catch (error) {
        if (abortCode) throw quotaError(abortCode);
        if (Object.hasOwn(MESSAGES, error?.code)) throw quotaError(error.code);
        throw quotaError('CONNECTION_FAILED');
      } finally {
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
  return { readSummary };
}
module.exports = { createWorkBuddyWebQuota };
