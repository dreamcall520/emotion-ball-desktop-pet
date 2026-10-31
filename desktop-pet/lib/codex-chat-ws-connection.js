'use strict';

const { TextDecoder } = require('node:util');
const { loopbackEndpoint } = require('./codex-ws-transport');
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const NOOP = () => {};
function fail(code) { return Object.assign(new Error(code), { code }); }

// Transport only: it deliberately does not initialize app-server or approve requests.
// The chat RPC owns schema, config, workspace and tool checks for both transports.
function createCodexChatWsConnection({ endpoint, bearerToken, createSocket = (url, options) => {
  const WebSocket = require('ws'); return new WebSocket(url, options);
}, maxFrameBytes = MAX_FRAME_BYTES, timeoutMs = 15000, onPacket = NOOP, onFailure = NOOP } = {}) {
  let url;
  try { url = loopbackEndpoint(endpoint); } catch (_) { throw fail('INVALID_INPUT'); }
  if (typeof bearerToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{16,8192}={0,2}$/.test(bearerToken) ||
      typeof createSocket !== 'function' || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > MAX_FRAME_BYTES) throw fail('INVALID_INPUT');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let socket = null, closed = false, opened = false, starting = null, rejectStart = null, closing = null;
  function problem(code) {
    if (closed) return;
    rejectStart?.(fail(code)); rejectStart = null;
    try { onFailure(code); } catch (_) { /* Caller failures cannot expose diagnostics. */ }
    void close();
  }
  function message(data, binary) {
    if (closed) return;
    try {
      if (binary) throw fail('INVALID_FRAME');
      let bytes;
      if (typeof data === 'string') bytes = Buffer.from(data);
      else if (Buffer.isBuffer(data)) bytes = data;
      else if (data instanceof ArrayBuffer) bytes = Buffer.from(data);
      else if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
        if (data.reduce((size, chunk) => size + chunk.length, 0) > maxFrameBytes) throw fail('INVALID_FRAME');
        bytes = Buffer.concat(data);
      } else throw fail('INVALID_FRAME');
      if (bytes.length > maxFrameBytes) throw fail('INVALID_FRAME');
      const packet = JSON.parse(decoder.decode(bytes));
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw fail('INVALID_FRAME');
      onPacket(packet);
    } catch (_) { problem('INVALID_FRAME'); }
  }
  const disconnected = () => problem('DISCONNECTED');
  function connect() {
    if (closed) return Promise.reject(fail('CLOSED'));
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      rejectStart = reject;
      try {
        socket = createSocket(url, { headers: { Authorization: `Bearer ${bearerToken}` },
          maxPayload: maxFrameBytes, followRedirects: false, handshakeTimeout: timeoutMs });
        if (!socket || !['on', 'once', 'removeListener', 'send', 'close'].every(name => typeof socket[name] === 'function')) {
          socket = null; throw fail('INVALID_INPUT');
        }
        socket.once('open', () => { if (!closed) { opened = true; rejectStart = null; resolve(); } });
        socket.on('message', message); socket.on('error', disconnected); socket.on('close', disconnected);
      } catch (_) { problem('DISCONNECTED'); }
    });
    return starting;
  }
  function send(packet) {
    if (closed || !opened) throw fail(closed ? 'CLOSED' : 'DISCONNECTED');
    let frame;
    try { frame = JSON.stringify(packet); } catch (_) { throw fail('INVALID_FRAME'); }
    if (Buffer.byteLength(frame) > maxFrameBytes) throw fail('INVALID_FRAME');
    try { socket.send(frame, error => { if (error) problem('DISCONNECTED'); }); }
    catch (_) { problem('DISCONNECTED'); throw fail('DISCONNECTED'); }
  }
  function close() {
    if (closing) return closing;
    closed = true; opened = false;
    rejectStart?.(fail('CLOSED')); rejectStart = null;
    if (!socket) { closing = Promise.resolve(); return closing; }
    socket.removeListener('message', message); socket.removeListener('error', disconnected); socket.removeListener('close', disconnected);
    socket.on('error', NOOP);
    closing = new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); socket.removeListener('close', done); resolve(); };
      socket.once('close', done);
      // Closing a WebSocket never terminates the provider service/process.
      timer = setTimeout(() => { try { socket.terminate?.(); } catch (_) {} done(); }, 1000);
      try { socket.close(1000); } catch (_) { done(); }
    });
    return closing;
  }
  return { connect, send, close };
}
module.exports = { createCodexChatWsConnection };
