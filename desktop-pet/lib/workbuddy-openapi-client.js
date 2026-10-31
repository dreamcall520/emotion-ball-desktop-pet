'use strict';

const { TextDecoder } = require('node:util');
const ORIGIN = 'https://www.workbuddy.cn';
const BASE = ORIGIN + '/openapi/v2';
const SOURCE = 'workbuddy-openapi';
const MAX_BYTES = 1024 * 1024;
const SCOPES = Object.freeze({ assistantRead: 'user.localassistant.readable', assistantInvoke: 'user.localassistant.invokable',
  taskRead: 'user.task.readable', taskInvoke: 'user.task.invokable' });
const SCOPE_LIST = Object.values(SCOPES);
const TASK_STATES = new Set(['CREATING', 'idle', 'planning', 'working', 'pending', 'completed', 'failed', 'archived', 'deleted']);
const CODES = new Set(['APP_NOT_CONFIGURED', 'AUTHORIZATION_REQUIRED', 'PERMISSION_REQUIRED', 'INVALID_INPUT',
  'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE', 'TIMEOUT', 'CANCELLED', 'REDIRECT_REJECTED', 'RATE_LIMITED',
  'HTTP_ERROR', 'API_ERROR', 'CONNECTION_FAILED', 'ASSISTANT_OFFLINE', 'UNKNOWN_OUTCOME', 'BUSY']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
function failure(code, options = {}) {
  const safe = CODES.has(code) ? code : 'CONNECTION_FAILED';
  return Object.assign(new Error(safe), { code: safe }, options);
}
function knownRejection(code) { return failure(code, { outcome: 'rejected', retryable: false }); }
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const at = Date.parse(value); return Number.isFinite(at) && at >= 0 ? at : null;
}
function boundedText(value, limit, secret) {
  if (typeof value !== 'string') return null;
  return value.slice(0, limit).split(secret).join('[redacted]');
}
function sizeOption(value, max) { return Number.isSafeInteger(value) && value >= 1 && value <= max; }
function tokenError(error) {
  if (['SCOPE_REQUIRED', 'INSUFFICIENT_SCOPE', 'PERMISSION_REQUIRED'].includes(error?.code)) return failure('PERMISSION_REQUIRED');
  if (['AUTH_REQUIRED', 'AUTHORIZATION_REQUIRED', 'SESSION_NOT_FOUND', 'LOGIN_REQUIRED', 'SESSION_EXPIRED'].includes(error?.code)) return failure('AUTHORIZATION_REQUIRED');
  if (error?.code === 'APP_NOT_CONFIGURED') return failure('APP_NOT_CONFIGURED');
  return failure('CONNECTION_FAILED');
}
async function limitedJson(response, controller, check) {
  const length = response.headers?.get?.('content-length');
  if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > MAX_BYTES) throw failure('RESPONSE_TOO_LARGE');
  if (typeof response.body?.getReader !== 'function') throw failure('INVALID_RESPONSE');
  const reader = response.body.getReader();
  let done = false;
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} };
  controller.signal.addEventListener('abort', cancel, { once: true });
  const chunks = []; let bytes = 0;
  try {
    check();
    while (true) {
      const result = await reader.read(); check();
      if (result.done) { done = true; break; }
      if (!(result.value instanceof Uint8Array)) throw failure('INVALID_RESPONSE');
      bytes += result.value.byteLength;
      if (bytes > MAX_BYTES) throw failure('RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(result.value));
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
    catch (_) { throw failure('INVALID_RESPONSE'); }
  } finally {
    controller.signal.removeEventListener('abort', cancel);
    if (!done) cancel();
    try { reader.releaseLock(); } catch (_) {}
  }
}
function assistantData(raw) {
  if (!object(raw) || typeof raw.code !== 'number') throw failure('INVALID_RESPONSE');
  if (raw.code !== 0) throw knownRejection('API_ERROR');
  if (!object(raw.data)) throw failure('INVALID_RESPONSE');
  return raw.data;
}

// Intended for a trusted server/connector layer. tokenPort is supplied by the OAuth
// broker, never by a website Session or desktop credential reader. No client_secret,
// OAuth exchange, refresh, task-ticket/ACP exposure or automatic permission replies.
function createWorkBuddyOpenApiClient({ tokenPort, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid OpenAPI client options');
  let sending = false;
  async function run(requiredScopes, operation, { signal, mutation = false } = {}) {
    const controller = new AbortController();
    let timedOut = false, postStarted = false, credentials, rejectAbort;
    const responses = [];
    const cancelExternal = () => controller.abort();
    signal?.addEventListener('abort', cancelExternal, { once: true });
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(failure(timedOut ? 'TIMEOUT' : 'CANCELLED')); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const check = () => { if (controller.signal.aborted) throw failure(timedOut ? 'TIMEOUT' : 'CANCELLED'); };
    const work = async () => {
      check();
      if (typeof tokenPort?.getAccessToken !== 'function') throw failure('APP_NOT_CONFIGURED');
      try { credentials = await tokenPort.getAccessToken({ requiredScopes: [...requiredScopes], signal: controller.signal }); }
      catch (error) { throw tokenError(error); }
      check();
      if (!object(credentials) || typeof credentials.accessToken !== 'string' ||
          !/^[A-Za-z0-9._~+\/-]{1,32768}={0,2}$/.test(credentials.accessToken) || !Array.isArray(credentials.scopes)) throw failure('AUTHORIZATION_REQUIRED');
      if (requiredScopes.some(scope => !credentials.scopes.includes(scope))) throw failure('PERMISSION_REQUIRED');
      const expiresAt = Number.isSafeInteger(credentials.expiresAt) && credentials.expiresAt > 0 ? credentials.expiresAt : null;
      if (credentials.expiresAt !== undefined && (expiresAt === null || expiresAt <= now())) throw failure('AUTHORIZATION_REQUIRED');
      const authorization = { scopes: SCOPE_LIST.filter(scope => credentials.scopes.includes(scope)), expiresAt };
      async function request(route, { method = 'GET', body } = {}) {
        // route is generated only by the four methods below, never from a provider URL.
        const url = BASE + route; check();
        if (method === 'POST') postStarted = true;
        let response;
        try { response = await fetchImpl(url, { method, redirect: 'manual', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: 'application/json',
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
        catch (_) { check(); throw failure('CONNECTION_FAILED'); }
        responses.push(response); check();
        if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== url) throw failure('REDIRECT_REJECTED');
        if (response.status === 401) throw knownRejection('AUTHORIZATION_REQUIRED');
        if (response.status === 403) throw knownRejection('PERMISSION_REQUIRED');
        if (response.status === 429) throw knownRejection('RATE_LIMITED');
        if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw failure('HTTP_ERROR');
        const raw = await limitedJson(response, controller, check); check(); return raw;
      }
      return operation({ request, authorization, secret: credentials.accessToken });
    };
    try { return await Promise.race([work(), aborted]); }
    catch (error) {
      const code = controller.signal.aborted ? timedOut ? 'TIMEOUT' : 'CANCELLED' : CODES.has(error?.code) ? error.code : 'CONNECTION_FAILED';
      if (mutation && postStarted && error?.outcome !== 'rejected') {
        throw failure('UNKNOWN_OUTCOME', { outcome: 'unknown', retryable: false, causeCode: code });
      }
      throw failure(code, error?.outcome === 'rejected' ? { outcome: 'rejected', retryable: false } : {});
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancelExternal);
      controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); credentials = null;
      for (const response of responses) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch (_) {} }
    }
  }
  function getAssistantStatus({ signal } = {}) {
    return run([SCOPES.assistantRead], async ({ request, authorization }) => {
      const data = assistantData(await request('/localassistant'));
      if (typeof data.online !== 'boolean') throw failure('INVALID_RESPONSE');
      return { source: SOURCE, scope: 'pc-local-assistant', online: data.online, authorization };
    }, { signal });
  }
  function listTasks({ page = 1, size = 20, signal } = {}) {
    if (!sizeOption(page, 100000) || !sizeOption(size, 100)) return Promise.reject(failure('INVALID_INPUT'));
    return run([SCOPES.taskRead], async ({ request, authorization, secret }) => {
      const raw = await request(`/tasks?page=${page}&size=${size}`);
      if (object(raw) && typeof raw.code === 'number' && raw.code !== 0) throw knownRejection('API_ERROR');
      if (!object(raw) || !Array.isArray(raw.tasks) || raw.tasks.length > size || !object(raw.pagination) ||
          raw.pagination.page !== page || raw.pagination.size !== size || !count(raw.pagination.total) ||
          !count(raw.total) || raw.total !== raw.pagination.total) throw failure('INVALID_RESPONSE');
      const tasks = raw.tasks.map(row => {
        if (!object(row) || !validId(row.task_id)) throw failure('INVALID_RESPONSE');
        return { id: row.task_id, name: boundedText(row.name, 200, secret), status: TASK_STATES.has(row.status) ? row.status : 'unknown',
          createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) };
      });
      return { source: SOURCE, scope: 'cloud-tasks-only', tasks, pagination: { page, size, total: raw.total }, authorization };
    }, { signal });
  }
  function listMessages({ afterMessageId, limit = 20, offset = 0, signal } = {}) {
    if (!validId(afterMessageId) || !sizeOption(limit, 100) || !count(offset) || offset > 100000) return Promise.reject(failure('INVALID_INPUT'));
    return run([SCOPES.assistantRead], async ({ request, authorization, secret }) => {
      const data = assistantData(await request(`/localassistant/message?message_id=${encodeURIComponent(afterMessageId)}&limit=${limit}&offset=${offset}`));
      if (!Array.isArray(data.messages) || data.messages.length > limit) throw failure('INVALID_RESPONSE');
      const messages = data.messages.map(row => {
        if (!object(row) || !validId(row.message_id) || !Array.isArray(row.content) || !Array.isArray(row.attachments) || !object(row.metadata)) throw failure('INVALID_RESPONSE');
        const content = row.content.slice(0, 64).flatMap(value => object(value) && value.type === 'text' && typeof value.text === 'string'
          ? [{ type: 'text', text: boundedText(value.text, 65536, secret) }] : []);
        return { id: row.message_id, role: ['user', 'assistant'].includes(row.role) ? row.role : 'unknown',
          msgType: typeof row.msg_type === 'string' && /^[a-z_]{1,64}$/.test(row.msg_type) ? row.msg_type : 'unknown',
          createdAt: timestamp(row.created_at), content, attachmentCount: row.attachments.length,
          metadataPresent: Object.keys(row.metadata).length > 0, unsupportedContentCount: row.content.length - content.length };
      });
      return { source: SOURCE, scope: 'pc-assistant-incremental-shared-history', messages,
        pagination: { limit, offset, afterMessageId, hasMore: null }, partial: true, authorization };
    }, { signal });
  }
  async function sendMessage({ content, signal, msg_type } = {}) {
    if (typeof content !== 'string' || !content.trim() || content.length > 8000 || content.includes('\0') ||
        msg_type !== undefined && msg_type !== 'text') throw failure('INVALID_INPUT');
    if (sending) throw failure('BUSY');
    sending = true;
    try {
      return await run([SCOPES.assistantRead, SCOPES.assistantInvoke], async ({ request, authorization }) => {
        const status = assistantData(await request('/localassistant'));
        if (typeof status.online !== 'boolean') throw failure('INVALID_RESPONSE');
        if (!status.online) throw failure('ASSISTANT_OFFLINE');
        const data = assistantData(await request('/localassistant/message', { method: 'POST', body: { content, msg_type: 'text' } }));
        if (!validId(data.message_id)) throw failure('INVALID_RESPONSE');
        return { source: SOURCE, scope: 'pc-local-assistant', state: 'accepted', messageId: data.message_id,
          completion: 'not-confirmed', authorization };
      }, { signal, mutation: true });
    } finally { sending = false; }
  }
  function getCapabilities() {
    return { source: SOURCE, configured: typeof tokenPort?.getAccessToken === 'function', verified: false,
      externalApplicationAuthorization: 'required', requiredScopes: [...SCOPE_LIST],
      localAssistantConversationIsolated: false, modelSelectionSupported: false,
      automaticPermissionResponses: false, cloudTasksAreLocalTasks: false };
  }
  return { getAssistantStatus, listTasks, listMessages, sendMessage, getCapabilities };
}
module.exports = { createWorkBuddyOpenApiClient };
