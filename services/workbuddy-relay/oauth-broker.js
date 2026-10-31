'use strict';
const { randomBytes } = require('node:crypto');
const AUTHORIZE = 'https://www.workbuddy.cn/openapi/v2/authorize';
const TOKEN = 'https://www.workbuddy.cn/openapi/v2/token';
const SCOPES = new Set(['user.localassistant.readable', 'user.localassistant.invokable', 'user.task.readable', 'user.task.invokable']);
const fail = code => Object.assign(new Error(code), { code });
function configuration(env = process.env) {
  const clientId = env.WORKBUDDY_CLIENT_ID, clientSecret = env.WORKBUDDY_CLIENT_SECRET;
  const redirectUri = env.WORKBUDDY_REDIRECT_URI;
  if (![clientId, clientSecret, redirectUri].every(x => typeof x === 'string' && x && !/[\r\n]/.test(x))) throw fail('CONFIGURATION_REQUIRED');
  let callback;
  try { callback = new URL(redirectUri); } catch { throw fail('INVALID_CALLBACK'); }
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || callback.search ||
      callback.port || callback.hostname === 'localhost' || !callback.pathname.startsWith('/')) throw fail('INVALID_CALLBACK');
  return { clientId, clientSecret, redirectUri };
}
function createOAuthBroker({ config = configuration(), tokenStore, clock = Date.now,
  random = () => randomBytes(32).toString('base64url'), fetch: request = globalThis.fetch,
  stateTtlMs = 300000, timeoutMs = 10000 } = {}) {
  config = configuration({ WORKBUDDY_CLIENT_ID: config.clientId, WORKBUDDY_CLIENT_SECRET: config.clientSecret, WORKBUDDY_REDIRECT_URI: config.redirectUri });
  if (!tokenStore || !['get', 'set', 'delete'].every(k => typeof tokenStore[k] === 'function') || typeof request !== 'function' ||
      !Number.isSafeInteger(stateTtlMs) || stateTtlMs < 1 || stateTtlMs > 600000 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail('CONFIGURATION_REQUIRED');
  const pending = new Map(), flights = new Map(), generations = new Map(), writes = new Map();
  const validSession = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(id)) throw fail('INVALID_SESSION'); };
  const now = () => { const t = clock(); if (!Number.isSafeInteger(t) || t < 0) throw fail('CLOCK_FAILED'); return t; };
  async function mutate(sessionId, operation) {
    const previous = writes.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    writes.set(sessionId, next);
    try { return await next; } finally { if (writes.get(sessionId) === next) writes.delete(sessionId); }
  }
  async function save(sessionId, generation, record) {
    try { await mutate(sessionId, async () => {
      if ((generations.get(sessionId) || 0) !== generation) throw fail('AUTHORIZATION_REQUIRED');
      await tokenStore.set(sessionId, record);
    }); } catch (e) { throw fail(e?.code === 'AUTHORIZATION_REQUIRED' ? e.code : 'TOKEN_STORE_FAILED'); }
    if ((generations.get(sessionId) || 0) !== generation) throw fail('AUTHORIZATION_REQUIRED');
  }
  async function exchange(fields) {
    const controller = new AbortController();
    let timer, activeReader;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); if (activeReader) { try { void activeReader.cancel().catch(() => {}); } catch {} } reject(fail('TOKEN_TIMEOUT')); }, timeoutMs); });
    const operation = (async () => {
      try {
        const response = await request(TOKEN, { method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }).toString() });
        if (response.status >= 300 && response.status < 400 || response.redirected) throw fail('TOKEN_REDIRECT_REJECTED');
        if (response.status !== 200) throw fail(response.status === 400 || response.status === 401 ? 'AUTHORIZATION_REQUIRED' : 'TOKEN_SERVICE_FAILED');
        if (Number(response.headers?.get?.('content-length')) > 65536) throw fail('INVALID_TOKEN_RESPONSE');
        // Cap body while streaming; never log or expose the provider response.
        const reader = response.body?.getReader(); activeReader = reader;
        if (!reader) throw fail('INVALID_TOKEN_RESPONSE');
        const chunks = []; let length = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength; if (length > 65536) throw fail('INVALID_TOKEN_RESPONSE'); chunks.push(value); }
        } finally { void reader.cancel().catch(() => {}); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks, length).toString('utf8')); } catch { throw fail('INVALID_TOKEN_RESPONSE'); }
        const safeToken = v => typeof v === 'string' && v.length > 0 && v.length <= 16384 && /^[\x21-\x7e]+$/.test(v);
        if (!safeToken(body.access_token) || !safeToken(body.refresh_token) || body.token_type !== 'Bearer' ||
            !Number.isSafeInteger(body.expires_in) || body.expires_in < 1 || body.expires_in > 31536000 || typeof body.scope !== 'string') throw fail('INVALID_TOKEN_RESPONSE');
        const scopes = body.scope.split(/\s+/).filter(Boolean);
        if (!scopes.length || scopes.some(s => !SCOPES.has(s))) throw fail('INVALID_TOKEN_RESPONSE');
        return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + body.expires_in * 1000, scopes };
      } catch (error) {
        const allowed = ['TOKEN_TIMEOUT', 'TOKEN_REDIRECT_REJECTED', 'AUTHORIZATION_REQUIRED', 'TOKEN_SERVICE_FAILED', 'INVALID_TOKEN_RESPONSE'];
        throw fail(allowed.includes(error?.code) ? error.code : 'TOKEN_CONNECTION_FAILED');
      }
    })();
    try { return await Promise.race([operation, deadline]); } finally { clearTimeout(timer); controller.abort(); }
  }
  function beginAuthorization(sessionId, scopes) {
    validSession(sessionId);
    if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => !SCOPES.has(s))) throw fail('INVALID_SCOPE');
    const time = now(); for (const [key, value] of pending) if (value.expiresAt <= time) pending.delete(key);
    if (pending.size >= 10000) throw fail('AUTHORIZATION_BUSY');
    const state = random();
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(state) || pending.has(state)) throw fail('STATE_GENERATION_FAILED');
    const requested = [...new Set(scopes)];
    pending.set(state, { sessionId, generation: generations.get(sessionId) || 0, scopes: requested, expiresAt: time + stateTtlMs });
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: requested.join(' '), state }).toString();
    return { authorizationUrl: url.href, expiresAt: time + stateTtlMs };
  }
  async function handleCallback(sessionId, callbackURL) {
    validSession(sessionId);
    let url; try { url = new URL(callbackURL); } catch { throw fail('INVALID_CALLBACK'); }
    const expected = new URL(config.redirectUri);
    if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || url.username || url.password || url.hash) throw fail('INVALID_CALLBACK');
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length > 1) throw fail('INVALID_STATE');
    const state = url.searchParams.get('state'), entry = pending.get(state);
    if (!entry || entry.sessionId !== sessionId || entry.expiresAt <= now()) throw fail('INVALID_STATE');
    pending.delete(state); // Consume before any asynchronous operation, including failed exchange.
    if (url.searchParams.has('error')) throw fail('AUTHORIZATION_DENIED');
    const code = url.searchParams.get('code');
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) throw fail('INVALID_AUTHORIZATION_CODE');
    const record = await exchange({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
    if ((generations.get(sessionId) || 0) !== entry.generation) throw fail('AUTHORIZATION_REQUIRED');
    if (record.scopes.some(s => !entry.scopes.includes(s))) throw fail('INVALID_TOKEN_RESPONSE');
    await save(sessionId, entry.generation, record);
    return { connected: true, scopes: [...record.scopes], expiresAt: record.expiresAt };
  }
  async function getRecord(sessionId, { forceRefresh = false } = {}) {
    validSession(sessionId);
    if (flights.has(sessionId)) return flights.get(sessionId);
    const generation = generations.get(sessionId) || 0;
    const flight = (async () => {
      let record; try { record = await tokenStore.get(sessionId); } catch { throw fail('TOKEN_STORE_FAILED'); }
      if ((generations.get(sessionId) || 0) !== generation) throw fail('AUTHORIZATION_REQUIRED');
      if (!record) throw fail('AUTHORIZATION_REQUIRED');
      if (!forceRefresh && record.expiresAt > now() + 30000) return record;
      const fresh = await exchange({ grant_type: 'refresh_token', refresh_token: record.refreshToken });
      if ((generations.get(sessionId) || 0) !== generation) throw fail('AUTHORIZATION_REQUIRED');
      if (fresh.scopes.some(s => !record.scopes.includes(s))) throw fail('INVALID_TOKEN_RESPONSE');
      await save(sessionId, generation, fresh);
      return fresh;
    })();
    flights.set(sessionId, flight);
    try { return await flight; } finally { if (flights.get(sessionId) === flight) flights.delete(sessionId); }
  }
  async function getAccessToken(sessionId, { forceRefresh = false, requiredScopes = [], signal } = {}) {
    if (signal?.aborted) throw fail('CANCELLED');
    if (!Array.isArray(requiredScopes) || requiredScopes.some(s => !SCOPES.has(s))) throw fail('INVALID_SCOPE');
    let onAbort;
    const cancelled = new Promise((_, reject) => { onAbort = () => reject(fail('CANCELLED')); });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    let record;
    try { record = await Promise.race([getRecord(sessionId, { forceRefresh }), cancelled]); }
    finally { signal?.removeEventListener('abort', onAbort); }
    if (signal?.aborted) throw fail('CANCELLED');
    if (requiredScopes.some(s => !record.scopes.includes(s))) throw fail('SCOPE_REQUIRED');
    return { accessToken: record.accessToken, scopes: [...record.scopes], expiresAt: record.expiresAt };
  }
  async function getConnectionState(sessionId) {
    validSession(sessionId);
    let record; try { record = await tokenStore.get(sessionId); } catch { throw fail('TOKEN_STORE_FAILED'); }
    if (!record) return { connected: false, scopes: [], expiresAt: null };
    return { connected: true,
      scopes: [...record.scopes].filter(s => SCOPES.has(s)), expiresAt: record.expiresAt };
  }
  async function revoke(sessionId) {
    validSession(sessionId);
    generations.set(sessionId, (generations.get(sessionId) || 0) + 1);
    for (const [key, value] of pending) if (value.sessionId === sessionId) pending.delete(key);
    flights.delete(sessionId);
    try { await mutate(sessionId, () => tokenStore.delete(sessionId)); } catch { throw fail('TOKEN_STORE_FAILED'); }
    return { connected: false };
  }
  return { beginAuthorization, handleCallback, getAccessToken, getConnectionState, revoke };
}
module.exports = { createOAuthBroker, configuration };
