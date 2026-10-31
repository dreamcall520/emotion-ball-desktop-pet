'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
const MAX_AUTH_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SOURCE = 'web-account-quota';
const ERROR_CODES = new Set(['DIRECTORY_ACCESS_REQUIRED', 'DIRECTORY_STORAGE_FAILED', 'AUTH_UNAVAILABLE',
  'UNSAFE_AUTH_FILE', 'AUTH_TOO_LARGE', 'UNSUPPORTED_AUTH', 'LOGIN_REQUIRED', 'INVALID_AUTH',
  'TIMEOUT', 'CANCELLED', 'REDIRECT_REJECTED', 'RATE_LIMITED', 'HTTP_ERROR',
  'CONNECTION_FAILED', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function usageError(code) {
  const safe = ERROR_CODES.has(code) ? code : 'CONNECTION_FAILED';
  return Object.assign(new Error(safe), { code: safe });
}
function date(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }

// Only the account's own two windows cross this boundary. Missing windows stay missing;
// additional model pools, token counts and reset-after estimates are never merged in.
function normalizeCodexAccountUsage(raw, at = Date.now()) {
  if (!object(raw) || !date(at)) throw usageError('INVALID_RESPONSE');
  const limit = object(raw.rate_limit) ? raw.rate_limit : {};
  const windows = [];
  for (const slot of ['primary', 'secondary']) {
    const value = limit[`${slot}_window`];
    if (!object(value)) continue;
    const usedPercent = Number.isFinite(value.used_percent) && value.used_percent >= 0 && value.used_percent <= 100 ? value.used_percent : null;
    const windowMinutes = Number.isSafeInteger(value.limit_window_seconds) && value.limit_window_seconds > 0 ? value.limit_window_seconds / 60 : null;
    const resetsAt = typeof value.reset_at === 'number' && value.reset_at > 0 && date(value.reset_at * 1000) ? value.reset_at * 1000 : null;
    windows.push({ id: `codex:${slot}`, usedPercent, windowMinutes, resetsAt });
  }
  const complete = windows.every(window => window.usedPercent !== null && window.windowMinutes !== null && window.resetsAt !== null);
  return { source: SOURCE, state: windows.length === 0 ? 'unavailable' : complete ? 'ready' : 'partial', windows, updatedAt: at };
}

async function readAuthorizedCredentials(directory, io, check) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw usageError('DIRECTORY_ACCESS_REQUIRED');
  const filename = path.join(directory, 'auth.json');
  let handle;
  try {
    check();
    const before = await io.lstat(filename); check();
    if (before.isSymbolicLink() || !before.isFile()) throw usageError('UNSAFE_AUTH_FILE');
    if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAX_AUTH_BYTES) throw usageError('AUTH_TOO_LARGE');
    handle = await io.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); check();
    const stat = await handle.stat(); check();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw usageError('UNSAFE_AUTH_FILE');
    if (!Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > MAX_AUTH_BYTES) throw usageError('AUTH_TOO_LARGE');
    const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, Math.min(65536, buffer.length - size), size); check();
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > Math.min(65536, buffer.length - size)) throw usageError('INVALID_AUTH');
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_AUTH_BYTES) throw usageError('AUTH_TOO_LARGE');
    let auth;
    try { auth = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch (_) { throw usageError('INVALID_AUTH'); }
    if (!object(auth)) throw usageError('INVALID_AUTH');
    if (auth.auth_mode != null && auth.auth_mode !== 'chatgpt') throw usageError('UNSUPPORTED_AUTH');
    const tokens = object(auth.tokens) ? auth.tokens : {};
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
      throw usageError(auth.OPENAI_API_KEY ? 'UNSUPPORTED_AUTH' : 'LOGIN_REQUIRED');
    }
    if (!/^[A-Za-z0-9._~+\/-]{1,32768}={0,2}$/.test(tokens.access_token) ||
        typeof tokens.account_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(tokens.account_id)) {
      throw usageError('INVALID_AUTH');
    }
    return { token: tokens.access_token, accountId: tokens.account_id };
  } catch (error) {
    if (ERROR_CODES.has(error?.code)) throw usageError(error.code);
    throw usageError('AUTH_UNAVAILABLE');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}
async function boundedJson(response, signal, check) {
  const length = response.headers?.get?.('content-length');
  if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw usageError('RESPONSE_TOO_LARGE');
  if (!response.body || typeof response.body.getReader !== 'function') throw usageError('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) { /* Already detached. */ } };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    check();
    while (true) {
      const { done, value } = await reader.read(); check();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw usageError('INVALID_RESPONSE');
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { cancel(); throw usageError('RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch (_) { throw usageError('INVALID_RESPONSE'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch (_) { /* A cancelled reader may already be detached. */ }
  }
}

// Uses only an explicitly granted Codex root and existing ChatGPT access credentials.
// No token refresh, API-key fallback, RPC, model request or credential logging.
async function readCodexAccountUsage({ directoryAccess, io = fs.promises, fetch: fetchImpl = globalThis.fetch,
  signal, timeoutMs = 10000, now = Date.now } = {}) {
  if (!directoryAccess || typeof directoryAccess.withAccess !== 'function' || typeof fetchImpl !== 'function' ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid quota reader options');
  const controller = new AbortController();
  let timedOut = false, credentials, response;
  const check = () => { if (controller.signal.aborted) throw usageError(timedOut ? 'TIMEOUT' : 'CANCELLED'); };
  const externalAbort = () => controller.abort();
  signal?.addEventListener('abort', externalAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(usageError(timedOut ? 'TIMEOUT' : 'CANCELLED')); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  const operation = async () => {
    check();
    credentials = await directoryAccess.withAccess('codex', directory => readAuthorizedCredentials(directory, io, check));
    check();
    response = await fetchImpl(ENDPOINT, { method: 'GET', redirect: 'manual', cache: 'no-store',
      headers: { Authorization: `Bearer ${credentials.token}`, 'ChatGPT-Account-Id': credentials.accountId, Accept: 'application/json' }, signal: controller.signal });
    check();
    if (response.redirected || response.status >= 300 && response.status < 400) throw usageError('REDIRECT_REJECTED');
    if (response.url && response.url !== ENDPOINT) throw usageError('REDIRECT_REJECTED');
    if ([401, 403].includes(response.status)) throw usageError('LOGIN_REQUIRED');
    if (response.status === 429) throw usageError('RATE_LIMITED');
    if (response.status !== 200) throw usageError('HTTP_ERROR');
    const raw = await boundedJson(response, controller.signal, check); check();
    return normalizeCodexAccountUsage(raw, typeof now === 'function' ? now() : now);
  };
  try {
    return await Promise.race([operation(), aborted]);
  } catch (error) {
    if (controller.signal.aborted) throw usageError(timedOut ? 'TIMEOUT' : 'CANCELLED');
    throw usageError(error?.code);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', externalAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
    controller.abort(); credentials = null;
    try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch (_) { /* An active reader owns cancellation. */ }
  }
}

module.exports = { readCodexAccountUsage, normalizeCodexAccountUsage };
