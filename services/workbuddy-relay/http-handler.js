'use strict';
const { randomBytes, createHash } = require('node:crypto');
const SCOPES = ['user.localassistant.readable', 'user.localassistant.invokable', 'user.task.readable'];
const SAFE = new Set(['AUTHORIZATION_REQUIRED','INSUFFICIENT_SCOPE','ASSISTANT_OFFLINE','UNKNOWN_OUTCOME','INVALID_RESPONSE',
  'RATE_LIMITED','TIMEOUT','CANCELLED','SERVICE_UNAVAILABLE','CONNECTION_FAILED','INVALID_REQUEST','TOKEN_SERVICE_FAILED',
  'TOKEN_TIMEOUT','TOKEN_REDIRECT_REJECTED','TOKEN_STORE_FAILED','INVALID_STATE','EXPIRED_STATE','INVALID_CALLBACK','PERMISSION_REQUIRED','APP_NOT_CONFIGURED','INVALID_INPUT','RESPONSE_TOO_LARGE','REDIRECT_REJECTED','HTTP_ERROR','API_ERROR','BUSY']);
const fail = code => Object.assign(new Error(code), { code });
// This router stays on the service host. WorkBuddy credentials never cross its HTTP boundary.
function createRelayHandler({ broker, createClient, ledgerStore, callbackUrl, clock = Date.now,
  random = () => randomBytes(32).toString('base64url'), maxPending = 128 } = {}) {
  if (!broker || !['beginAuthorization','handleCallback','getConnectionState','revoke'].every(k => typeof broker[k] === 'function') ||
      typeof createClient !== 'function' || !ledgerStore || !['get','set'].every(k => typeof ledgerStore[k] === 'function')) throw fail('CONFIGURATION_REQUIRED');
  const callback = new URL(callbackUrl);
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash) throw fail('INVALID_CALLBACK');
  const pending = new Map(), states = new Map(), sends = new Map();
  let windowStart = clock(), starts = 0;
  function clean() { for (const [id, item] of pending) if (item.expiresAt <= clock()) { pending.delete(id); states.delete(item.state); } }
  function reply(res, status, value) {
    res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'" });
    res.end(JSON.stringify(value));
  }
  async function json(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail('INVALID_REQUEST');
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 16384) throw fail('INVALID_REQUEST'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
    catch (_) { throw fail('INVALID_REQUEST'); }
  }
  function token(req) { const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization || ''); if (!m) throw fail('AUTHORIZATION_REQUIRED'); return m[1]; }
  async function sendOnce(sessionId, client, body) {
    if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '') || typeof body.content !== 'string' || !body.content.trim() ||
        body.content.length > 8000 || body.content.includes('\0')) throw fail('INVALID_REQUEST');
    const key = 'request_' + createHash('sha256').update(sessionId + ':' + body.requestId).digest('hex');
    const digest = createHash('sha256').update(body.content).digest('hex');
    if (sends.has(key)) { const entry=sends.get(key); if(entry.digest!==digest)throw fail('INVALID_REQUEST'); return entry.promise; }
    const operation = (async () => {
      const prior = await ledgerStore.get(key);
      if (prior) {
        if (prior.digest !== digest) throw fail('INVALID_REQUEST');
        if (prior.result) return prior.result;
        if (prior.notSentCode) throw fail(prior.notSentCode);
        throw fail('UNKNOWN_OUTCOME');
      }
      // Durable intent precedes the non-idempotent upstream request. No retry of uncertain sends.
      await ledgerStore.set(key, { digest, state:'attempting', createdAt:clock() });
      try {
        const result = await client.sendMessage({ content:body.content });
        const safe = { state:'accepted', messageId:result.messageId, completion:'not-confirmed', source:'workbuddy-openapi', scope:'pc-local-assistant' };
        await ledgerStore.set(key, { digest, result:safe, createdAt:clock() }); return safe;
      } catch (error) {
        // Even a storage failure after acceptance leaves an uncertain intent; never resend automatically.
        if (['ASSISTANT_OFFLINE','INSUFFICIENT_SCOPE','PERMISSION_REQUIRED','AUTHORIZATION_REQUIRED'].includes(error?.code) || error?.outcome==='rejected' && SAFE.has(error.code)) {
          await ledgerStore.set(key, { digest, notSentCode:error.code, createdAt:clock() }); throw error;
        }
        throw fail('UNKNOWN_OUTCOME');
      }
    })();
    sends.set(key, {digest,promise:operation});
    try { return await operation; } finally { if (sends.get(key)?.promise === operation) sends.delete(key); }
  }
  return async function handler(req, res) {
    try {
      clean();
      const url = new URL(req.url, callback.origin);
      if (req.method === 'GET' && url.pathname === callback.pathname) {
        const state = url.searchParams.get('state'), sessionId = states.get(state);
        if (!sessionId || !pending.has(sessionId)) throw fail('INVALID_STATE');
        states.delete(state); pending.delete(sessionId);
        await broker.handleCallback(sessionId, callback.origin + req.url);
        return reply(res, 200, { connected:true, message:'WorkBuddy 已连接，请返回球球刷新连接状态。' });
      }
      // Desktop main-process calls only; browser pages cannot initiate credentialed cross-origin RPC.
      if (req.headers.origin || req.headers['x-qiuqiu-client'] !== 'desktop-v1') return reply(res, 403, { error:'INVALID_REQUEST' });
      if (req.method === 'POST' && url.pathname === '/v1/connect') {
        await json(req);
        if (clock() - windowStart >= 60000) { windowStart = clock(); starts = 0; }
        if (++starts > 20 || pending.size >= maxPending) throw fail('RATE_LIMITED');
        const sessionId = random();
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(sessionId) || pending.has(sessionId)) throw fail('SERVICE_UNAVAILABLE');
        const auth = await broker.beginAuthorization(sessionId, SCOPES);
        const authUrl = new URL(auth.authorizationUrl);
        if (authUrl.origin !== 'https://www.workbuddy.cn' || authUrl.pathname !== '/openapi/v2/authorize') throw fail('SERVICE_UNAVAILABLE');
        const state = authUrl.searchParams.get('state');
        if (!/^[A-Za-z0-9_-]{32,200}$/.test(state || '') || state === sessionId || states.has(state)) throw fail('SERVICE_UNAVAILABLE');
        pending.set(sessionId, { state, expiresAt:auth.expiresAt }); states.set(state, sessionId);
        return reply(res, 200, { sessionToken:sessionId, authorizationUrl:auth.authorizationUrl, expiresAt:auth.expiresAt });
      }
      const sessionId = token(req);
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        if (pending.has(sessionId)) return reply(res, 200, { connected:false, pending:true, expiresAt:pending.get(sessionId).expiresAt });
        const state = await broker.getConnectionState(sessionId);
        return reply(res, 200, { connected:state.connected === true, scopes:Array.isArray(state.scopes) ? state.scopes : [], expiresAt:state.expiresAt || null });
      }
      const state = await broker.getConnectionState(sessionId);
      if (!state.connected) throw fail('AUTHORIZATION_REQUIRED');
      if (req.method === 'POST' && url.pathname === '/v1/disconnect') {
        await json(req); await broker.revoke(sessionId); return reply(res, 200, { connected:false, localDisconnectOnly:true });
      }
      if (req.method !== 'POST' || url.pathname !== '/v1/rpc') return reply(res, 404, { error:'NOT_FOUND' });
      const body = await json(req), client = createClient(sessionId);
      let result;
      if (body.method === 'assistant-status') result = await client.getAssistantStatus();
      else if (body.method === 'tasks') result = await client.listTasks({ page:body.page, size:body.size });
      else if (body.method === 'messages') result = await client.listMessages({ afterMessageId:body.afterMessageId, offset:body.offset, limit:body.limit });
      else if (body.method === 'send-text') result = await sendOnce(sessionId, client, body);
      else throw fail('INVALID_REQUEST');
      // The client contract must project provider output; never proxy raw responses or tokens.
      return reply(res, 200, { result });
    } catch (error) {
      const code = SAFE.has(error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
      reply(res, code === 'AUTHORIZATION_REQUIRED' ? 401 : code === 'RATE_LIMITED' ? 429 : 400,
        { error:code, ...(code === 'UNKNOWN_OUTCOME' ? { outcome:'unknown', retryable:false } : {}) });
    }
  };
}
module.exports = { createRelayHandler };
