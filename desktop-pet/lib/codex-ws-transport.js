'use strict';

const { TextDecoder } = require('node:util');
const DEFAULT_LIMIT = 16 * 1024 * 1024;
const NOOP = () => {};
const CODES = new Set(['INVALID_ENDPOINT', 'INVALID_TOKEN', 'TRANSPORT_UNAVAILABLE', 'NOT_READY',
  'CLOSED', 'DISCONNECTED', 'TIMEOUT', 'INVALID_FRAME', 'FRAME_TOO_LARGE', 'UNSUPPORTED',
  'INVALID_REQUEST', 'UNAUTHENTICATED', 'BUSY', 'REMOTE_ERROR']);
function transportError(code) {
  const safe = CODES.has(code) ? code : 'DISCONNECTED';
  return Object.assign(new Error(safe), { code: safe });
}
function loopbackEndpoint(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw transportError('INVALID_ENDPOINT'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) throw transportError('INVALID_ENDPOINT');
  return url.href;
}
function defaultSocketFactory(endpoint, options) {
  let WebSocket;
  try { WebSocket = require('ws'); } catch (_) { throw transportError('TRANSPORT_UNAVAILABLE'); }
  return new WebSocket(endpoint, options);
}
function remoteError(raw) {
  return transportError(({ '-32601': 'UNSUPPORTED', '-32602': 'INVALID_REQUEST',
    '401': 'UNAUTHENTICATED', '403': 'UNAUTHENTICATED', '-32001': 'BUSY' })[raw?.code] || 'REMOTE_ERROR');
}
function validMethod(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function validId(value) { return Number.isSafeInteger(value) || typeof value === 'string' && value.length > 0 && value.length <= 128; }

// Main-process transport only. No account discovery, auth-file reads, service spawning,
// logging, auto-approval or model calls. Default factory requires the `ws` package;
// the browser-standard WebSocket is unsuitable because it cannot set this auth header.
function createCodexWsTransport({ endpoint, bearerToken, createSocket = defaultSocketFactory,
  connectTimeoutMs = 10000, requestTimeoutMs = 15000, maxFrameBytes = DEFAULT_LIMIT,
  clientInfo = { name: 'emotion-ball-desktop-pet', version: '1.0.0' }, experimentalApi = false,
  onNotification = NOOP, onServerRequest, onDisconnect = NOOP } = {}) {
  const url = loopbackEndpoint(endpoint);
  if (typeof bearerToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{16,8192}={0,2}$/.test(bearerToken)) {
    throw transportError('INVALID_TOKEN');
  }
  if (typeof createSocket !== 'function' || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > DEFAULT_LIMIT ||
      !Number.isFinite(connectTimeoutMs) || connectTimeoutMs < 1 || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TypeError('Invalid transport options');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pending = new Map(), incoming = new Set();
  let socket, state = 'idle', nextId = 0, startPromise, resolveStart, rejectStart, startupTimer;
  const safely = (callback, ...args) => { try { callback(...args); } catch (_) { /* No raw callback error crosses the boundary. */ } };
  function shutdown(code) {
    if (state === 'closed') return;
    state = 'closed'; clearTimeout(startupTimer);
    rejectStart?.(transportError(code)); resolveStart = rejectStart = null;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(transportError(code)); }
    pending.clear(); incoming.clear();
    if (socket) {
      socket.removeListener('open', opened); socket.removeListener('message', received);
      socket.removeListener('error', failed); socket.removeListener('close', disconnected);
      // ws can emit a queued handshake error after close(); retain only a stateless guard.
      socket.on('error', NOOP);
      try { socket.close(1000); } catch (_) { /* Never stop the provider service. */ }
    }
    if (code !== 'CLOSED') safely(onDisconnect, code);
  }
  function send(packet) {
    let frame;
    try { frame = JSON.stringify(packet); } catch (_) { throw transportError('INVALID_REQUEST'); }
    if (Buffer.byteLength(frame) > maxFrameBytes) throw transportError('FRAME_TOO_LARGE');
    try { socket.send(frame, error => { if (error) shutdown('DISCONNECTED'); }); }
    catch (_) { shutdown('DISCONNECTED'); throw transportError('DISCONNECTED'); }
  }
  function requestInternal(method, params, timeoutMs) {
    if (state === 'closed') return Promise.reject(transportError('CLOSED'));
    if (!validMethod(method)) return Promise.reject(transportError('INVALID_REQUEST'));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(transportError('TIMEOUT')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { send({ id, method, params }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function failed() { shutdown('DISCONNECTED'); }
  function disconnected() { shutdown('DISCONNECTED'); }
  function received(data, isBinary = false) {
    if (state === 'closed') return;
    let bytes, packet;
    try {
      if (isBinary) throw transportError('INVALID_FRAME');
      if (typeof data === 'string') bytes = Buffer.from(data);
      else if (Buffer.isBuffer(data)) bytes = data;
      else if (data instanceof ArrayBuffer) bytes = Buffer.from(data);
      else if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
        if (data.reduce((n, chunk) => n + chunk.length, 0) > maxFrameBytes) throw transportError('FRAME_TOO_LARGE');
        bytes = Buffer.concat(data);
      } else throw transportError('INVALID_FRAME');
      if (bytes.length > maxFrameBytes) throw transportError('FRAME_TOO_LARGE');
      packet = JSON.parse(decoder.decode(bytes));
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw transportError('INVALID_FRAME');
    } catch (error) { shutdown(error?.code === 'FRAME_TOO_LARGE' ? 'FRAME_TOO_LARGE' : 'INVALID_FRAME'); return; }
    if (Object.hasOwn(packet, 'method')) {
      if (!validMethod(packet.method) || Object.hasOwn(packet, 'result') || Object.hasOwn(packet, 'error')) { shutdown('INVALID_FRAME'); return; }
      if (!Object.hasOwn(packet, 'id')) { safely(onNotification, { method: packet.method, params: packet.params }); return; }
      if (!validId(packet.id) || incoming.has(packet.id)) { shutdown('INVALID_FRAME'); return; }
      const id = packet.id; incoming.add(id);
      // Unsupported server requests (including approvals) fail closed, never auto-approve.
      Promise.resolve().then(() => {
        if (typeof onServerRequest !== 'function') throw transportError('UNSUPPORTED');
        return onServerRequest({ id, method: packet.method, params: packet.params });
      }).then(result => {
        if (state !== 'closed') send({ id, result: result === undefined ? null : result });
      }, () => {
        if (state !== 'closed') send({ id, error: { code: -32601, message: 'Client request handler unavailable' } });
      }).catch(() => { shutdown('DISCONNECTED'); }).finally(() => incoming.delete(id));
      return;
    }
    const entry = pending.get(packet.id);
    if (!entry) return; // Unsolicited responses never become task notifications.
    pending.delete(packet.id); clearTimeout(entry.timer);
    const hasResult = Object.hasOwn(packet, 'result'), hasError = Object.hasOwn(packet, 'error');
    if (hasResult === hasError) { entry.reject(transportError('INVALID_FRAME')); shutdown('INVALID_FRAME'); return; }
    hasError ? entry.reject(remoteError(packet.error)) : entry.resolve(packet.result);
  }
  async function opened() {
    if (state !== 'connecting') return;
    try {
      await requestInternal('initialize', { clientInfo, capabilities: { experimentalApi: Boolean(experimentalApi) } }, requestTimeoutMs);
      if (state === 'closed') return;
      send({ method: 'initialized' });
      if (state === 'closed') return;
      state = 'ready'; clearTimeout(startupTimer); resolveStart?.(); resolveStart = rejectStart = null;
    } catch (error) { shutdown(CODES.has(error?.code) ? error.code : 'DISCONNECTED'); }
  }
  function start() {
    if (state === 'closed') return Promise.reject(transportError('CLOSED'));
    if (startPromise) return startPromise;
    state = 'connecting';
    startPromise = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    startupTimer = setTimeout(() => shutdown('TIMEOUT'), connectTimeoutMs);
    try {
      socket = createSocket(url, { headers: { Authorization: `Bearer ${bearerToken}` },
        maxPayload: maxFrameBytes, followRedirects: false, handshakeTimeout: connectTimeoutMs });
      if (!socket || !['on', 'once', 'removeListener', 'send', 'close'].every(key => typeof socket[key] === 'function')) {
        socket = null; throw transportError('TRANSPORT_UNAVAILABLE');
      }
      socket.on('open', opened); socket.on('message', received); socket.on('error', failed); socket.on('close', disconnected);
    } catch (error) { shutdown(error?.code === 'TRANSPORT_UNAVAILABLE' ? error.code : 'DISCONNECTED'); }
    return startPromise;
  }
  function request(method, params = {}) {
    if (state !== 'ready') return Promise.reject(transportError(state === 'closed' ? 'CLOSED' : 'NOT_READY'));
    return requestInternal(method, params, requestTimeoutMs);
  }
  function notify(method, params) {
    if (state !== 'ready') throw transportError(state === 'closed' ? 'CLOSED' : 'NOT_READY');
    if (!validMethod(method)) throw transportError('INVALID_REQUEST');
    send({ method, ...(params === undefined ? {} : { params }) });
  }
  return { start, request, notify, close: () => shutdown('CLOSED'), getState: () => state };
}

module.exports = { createCodexWsTransport, loopbackEndpoint };
