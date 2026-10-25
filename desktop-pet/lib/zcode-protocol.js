const { spawn: nodeSpawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const METHODS = new Set(['runtime/capabilities', 'session/create', 'session/resume', 'session/read',
  'session/subscribe', 'session/send', 'session/stop', 'provider/updateAccountConfig', 'provider/refreshRegistry']);
function protocolError(raw) {
  if (raw?.code === 401 || raw?.code === 403) return 'UNAUTHENTICATED';
  if (raw?.code === 429) return 'RATE_LIMITED';
  if (raw?.code === -32601 || raw?.code === -32602) return 'UNSUPPORTED';
  if (raw?.code === -32010) return 'THREAD_BUSY';
  return 'DISCONNECTED';
}
function createZcodeProtocol({ binary, cwd, env = process.env, executable = process.execPath, spawn = nodeSpawn,
  timeoutMs = 20000, maxFrameBytes = MAX_FRAME_BYTES, onRequest = async () => undefined,
  onNotification = () => {}, onDisconnect = () => {} } = {}) {
  const pending = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
  const limit = Math.min(MAX_FRAME_BYTES, Math.max(1, Number(maxFrameBytes) || MAX_FRAME_BYTES));
  let child, nextId = 0, closed = null, chunks = [], buffered = 0, closing;
  function write(packet) { try { child.stdin.write(JSON.stringify(packet) + '\n'); } catch { shutdown('DISCONNECTED'); } }
  function shutdown(code = 'CLOSED') {
    if (closed) return closing || Promise.resolve();
    closed = code;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(fail(code)); }
    pending.clear(); chunks = []; buffered = 0;
    if (child) {
      const owned = child;
      child = null;
      closing = new Promise(resolve => {
        const done = () => { clearTimeout(timer); owned.removeListener('exit', done); owned.removeListener('close', done); resolve(); };
        const timer = setTimeout(() => { try { owned.kill('SIGKILL'); } catch {} done(); }, 2000);
        owned.once('exit', done); owned.once('close', done);
        try { owned.stdin.end(); if (code !== 'CLOSED') owned.kill('SIGTERM'); } catch { done(); }
      });
    }
    if (code !== 'CLOSED') { try { onDisconnect(code); } catch {} }
    return closing || Promise.resolve();
  }
  async function receive(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw fail('INVALID_FRAME');
    if (typeof packet.method === 'string') {
      if (Object.hasOwn(packet, 'id')) {
        let result;
        try { result = await onRequest(packet.method, packet.params); } catch (error) {
          write({ id: packet.id, error: { code: -32601, message: 'Unavailable in companion chat' } });
          shutdown(['VERIFICATION_REQUIRED', 'UNAUTHENTICATED', 'TIMEOUT', 'DISCONNECTED'].includes(error?.code) ? error.code : 'TOOL_BLOCKED'); return;
        }
        if (result === undefined) {
          write({ id: packet.id, error: { code: -32601, message: 'Companion tools are disabled' } });
          shutdown('TOOL_BLOCKED'); return;
        }
        if (!closed) write({ id: packet.id, result });
      } else { try { onNotification(packet); } catch { shutdown('INVALID_FRAME'); } }
      return;
    }
    const entry = pending.get(packet.id);
    if (!entry) return;
    pending.delete(packet.id); clearTimeout(entry.timer);
    if (packet.error) entry.reject(fail(protocolError(packet.error)));
    else if (Object.hasOwn(packet, 'result')) entry.resolve(packet.result);
    else entry.reject(fail('INVALID_FRAME'));
  }
  function onData(input) {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0, frames = 0;
    while (offset < data.length && !closed) {
      const end = data.indexOf(10, offset), stop = end < 0 ? data.length : end, size = stop - offset;
      if (buffered + size > limit || ++frames > 1024) { shutdown('INVALID_FRAME'); return; }
      if (size) { chunks.push(Buffer.from(data.subarray(offset, stop))); buffered += size; }
      offset = end < 0 ? data.length : end + 1;
      if (end < 0) break;
      const frame = Buffer.concat(chunks, buffered); chunks = []; buffered = 0;
      if (!frame.length) continue;
      try { void receive(JSON.parse(decoder.decode(frame))).catch(() => shutdown('INVALID_FRAME')); }
      catch { shutdown('INVALID_FRAME'); }
    }
  }
  async function start() {
    if (closed) throw fail(closed);
    if (child) return;
    child = spawn(executable, [binary, 'app-server', '--stdio', '--surface', 'desktop'],
      { cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', onData);
    for (const target of [child, child.stdin, child.stdout, child.stderr]) target.on('error', () => shutdown('DISCONNECTED'));
    child.on('exit', () => shutdown('DISCONNECTED')); child.stderr.resume();
  }
  function request(method, params) {
    if (closed) return Promise.reject(fail(closed));
    if (!child) return Promise.reject(fail('DISCONNECTED'));
    if (!METHODS.has(method)) return Promise.reject(fail('UNSUPPORTED'));
    if (pending.size >= 8) return Promise.reject(fail('BUSY'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => shutdown('TIMEOUT'), Math.max(1, Math.min(30000, timeoutMs)));
      pending.set(id, { resolve, reject, timer }); write({ id, method, params });
    });
  }
  return { start, request, close: () => shutdown() };
}
module.exports = { createZcodeProtocol, protocolError, MAX_FRAME_BYTES };
