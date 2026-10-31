'use strict';

const { createCodexChatWsConnection } = require('./codex-chat-ws-connection');
const SAFE_CODES = new Set(['CLOSED', 'DISCONNECTED', 'TIMEOUT', 'BUSY', 'INVALID_INPUT', 'INVALID_FRAME', 'UNSUPPORTED',
  'UNAUTHENTICATED', 'THREAD_NOT_OWNED', 'MODELS_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'UNSAFE_CONFIG', 'TOOL_BLOCKED',
  'VERIFICATION_REQUIRED', 'ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED',
  'ZCODE_LOGIN_REQUIRED', 'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR',
  'ZCODE_INVALID_RESPONSE', 'ZCODE_CREDENTIAL_DECRYPT_FAILED', 'ZCODE_ACCOUNT_MISSING', 'RATE_LIMITED', 'THREAD_BUSY', 'MISSING']);
const NOTIFICATIONS = new Set(['account/updated', 'turn/started', 'item/agentMessage/delta', 'item/completed', 'turn/completed']);
const failure = code => Object.assign(new Error(SAFE_CODES.has(code) ? code : 'DISCONNECTED'), { code: SAFE_CODES.has(code) ? code : 'DISCONNECTED' });

// Client-side adapter only. No account files, provider processes, API fallback or auto-approval.
function createZcodeChatWsRpc({ endpoint, bearerToken, createConnection = createCodexChatWsConnection,
  createSocket, timeoutMs = 20000, onNotification = () => {}, onDisconnect = () => {} } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw failure('INVALID_INPUT');
  let closed = false, ready = false, starting = null, nextId = 0;
  const pending = new Map();
  function rejectPending(code) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure(code)); }
    pending.clear();
  }
  function failed(code) {
    if (closed) return;
    closed = true; ready = false; rejectPending(code);
    try { onDisconnect(SAFE_CODES.has(code) ? code : 'DISCONNECTED'); } catch (_) {}
    void connection.close();
  }
  function receive(packet) {
    if (closed) return;
    if (typeof packet?.method === 'string') {
      if (Object.hasOwn(packet, 'id') || !NOTIFICATIONS.has(packet.method)) { failed('TOOL_BLOCKED'); return; }
      try { onNotification(packet); } catch (_) { failed('INVALID_FRAME'); }
      return;
    }
    const entry = pending.get(packet?.id);
    if (!entry) return;
    pending.delete(packet.id); clearTimeout(entry.timer);
    const result = Object.hasOwn(packet, 'result'), error = Object.hasOwn(packet, 'error');
    if (result === error) { entry.reject(failure('INVALID_FRAME')); failed('INVALID_FRAME'); return; }
    if (error) entry.reject(failure(packet.error?.data?.code || (packet.error?.code === -32601 ? 'UNSUPPORTED' : 'DISCONNECTED')));
    else entry.resolve(packet.result);
  }
  const connection = createConnection({ endpoint, bearerToken, ...(createSocket ? { createSocket } : {}),
    timeoutMs, maxFrameBytes: 1024 * 1024, onPacket: receive, onFailure: failed });
  function request(method, params = {}, initializing = false) {
    if (closed || !initializing && !ready) return Promise.reject(failure(closed ? 'CLOSED' : 'DISCONNECTED'));
    if (pending.size >= 8) return Promise.reject(failure('BUSY'));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(failure('TIMEOUT')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { connection.send({ id, method, params }); }
      catch (_) { clearTimeout(timer); pending.delete(id); reject(failure('DISCONNECTED')); }
    });
  }
  function start() {
    if (closed) return Promise.reject(failure('CLOSED'));
    if (starting) return starting;
    starting = (async () => {
      await connection.connect();
      const result = await request('initialize', { protocolVersion: 1 }, true);
      if (closed || result?.provider !== 'zcode' || result?.protocolVersion !== 1) throw failure('INVALID_FRAME');
      ready = true;
    })().catch(error => { failed(error.code); throw failure(error.code); });
    return starting;
  }
  return { start,
    readAccount: () => request('zcode/readAccount'), listModels: () => request('zcode/listModels'),
    startThread: () => request('zcode/startThread'), resumeThread: id => request('zcode/resumeThread', { id }),
    startTurn: (id, text, selection) => request('zcode/startTurn', { id, text, selection }),
    interruptTurn: (id, turnId) => request('zcode/interruptTurn', { id, turnId }),
    nameThread: () => Promise.reject(failure('UNSUPPORTED')),
    close: () => { if (!closed) { closed = true; ready = false; rejectPending('CLOSED'); } return connection.close(); }
  };
}

module.exports = { createZcodeChatWsRpc };
