const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { normalizeQuota, normalizeThreadList } = require('./codex-state');

const ERROR_CODES = Object.freeze(['MISSING', 'UNAUTHENTICATED', 'UNSUPPORTED', 'DISCONNECTED', 'TIMEOUT', 'INVALID_FRAME', 'UNSAFE_SOCKET', 'STATE_TOO_LARGE', 'PARTIAL_STATE', 'CLOSED', 'BUSY']);
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const METHODS = new Set(['initialize', 'account/read', 'account/rateLimits/read', 'thread/list']);
function codexError(code) {
  const safe = ERROR_CODES.includes(code) ? code : 'DISCONNECTED';
  return Object.assign(new Error(safe), { code: safe });
}
function remoteError(raw) {
  if (raw?.code === -32601 || raw?.code === -32602) return codexError('UNSUPPORTED');
  if (raw?.code === 401 || raw?.code === 403) return codexError('UNAUTHENTICATED');
  return codexError('DISCONNECTED');
}

function ignoreClosedError() {}
function finishNativeClose(target) {
  // Node may have already queued an error before close(). Keep no task callback alive;
  // the stateless guard is removed when this owned native resource finishes closing.
  target.once('error', ignoreClosedError);
  target.once('close', () => target.removeListener('error', ignoreClosedError));
}

function projectAccount(raw) {
  if (raw?.account === null) return { accountKey: null, authenticated: false };
  const account = raw?.account;
  if (account?.type === 'chatgpt' && typeof account.email === 'string' && account.email.trim()) {
    return { accountKey: createHash('sha256').update(`chatgpt:${account.email.trim().toLowerCase()}`).digest('hex'), authenticated: true };
  }
  // API-key accounts have no safe stable identity field; never read the key to manufacture one.
  if (account && typeof account === 'object' && !Array.isArray(account) &&
    typeof account.type === 'string' && account.type.trim() && account.type !== 'chatgpt') {
    return { accountKey: null, authenticated: null, supported: false };
  }
  throw codexError('UNSUPPORTED');
}

function createCodexRpc({ fs = nodeFs, spawn = childProcess.spawn, homedir = os.homedir,
  timeoutMs = 10000, maxFrameBytes = MAX_FRAME_BYTES, onDisconnect = () => {} } = {}) {
  const timeout = Math.max(1, Math.min(15000, timeoutMs));
  const frameLimit = Math.max(1, Math.min(MAX_FRAME_BYTES, maxFrameBytes));
  let child = null;
  let closed = false;
  let ready = false;
  let starting = null;
  let startReject = null;
  let startTimer = null;
  let nextId = 0;
  let chunks = [];
  let buffered = 0;
  const pending = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const ensureOpen = () => { if (closed) throw codexError('CLOSED'); };

  function shutdown(code = 'CLOSED') {
    if (closed) return;
    closed = true; ready = false;
    clearTimeout(startTimer); startTimer = null;
    startReject?.(codexError(code)); startReject = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(codexError(code)); }
    pending.clear(); chunks = []; buffered = 0;
    if (child) {
      child.stdout.removeListener('data', onData);
      child.stdout.removeListener('error', onFailure);
      child.stdin.removeListener('error', onFailure);
      child.stderr.removeListener('error', onFailure);
      child.removeListener('error', onFailure);
      child.removeListener('exit', onFailure);
      for (const target of [child, child.stdin, child.stdout, child.stderr]) finishNativeClose(target);
      // This process is exclusively owned by this connection, never the desktop app/router.
      try { if (Number.isSafeInteger(child.pid) && child.pid > 0) child.kill('SIGKILL'); }
      catch { /* no raw error leaves the boundary */ }
      child = null;
    }
    if (code !== 'CLOSED') onDisconnect(code);
  }
  function onFailure() { shutdown('DISCONNECTED'); }

  function receive(packet) {
    if (closed) return;
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) { shutdown('INVALID_FRAME'); return; }
    const request = pending.get(packet.id);
    if (!request) return; // Notifications and unsolicited bodies are immediately discarded.
    pending.delete(packet.id); clearTimeout(request.timer);
    if (packet.error) { request.reject(remoteError(packet.error)); return; }
    if (!Object.hasOwn(packet, 'result')) { request.reject(codexError('INVALID_FRAME')); return; }
    try { request.resolve(request.project(packet.result)); } catch (error) { request.reject(codexError(error.code)); }
  }

  function onData(input) {
    if (closed) return;
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0;
    let frames = 0;
    while (offset < data.length && !closed) {
      const end = data.indexOf(10, offset);
      const stop = end < 0 ? data.length : end;
      const size = stop - offset;
      if (buffered + size > frameLimit || ++frames > 1024) { shutdown('INVALID_FRAME'); return; }
      if (size) { chunks.push(Buffer.from(data.subarray(offset, stop))); buffered += size; }
      offset = end < 0 ? data.length : end + 1;
      if (end < 0) break;
      const frame = Buffer.concat(chunks, buffered);
      chunks = []; buffered = 0;
      if (frame.length === 0) continue;
      try { receive(JSON.parse(decoder.decode(frame))); } catch { shutdown('INVALID_FRAME'); }
    }
  }

  function request(method, params, project) {
    if (closed) return Promise.reject(codexError('CLOSED'));
    if (!METHODS.has(method)) return Promise.reject(codexError('UNSUPPORTED'));
    if (!child || (method !== 'initialize' && !ready)) return Promise.reject(codexError('DISCONNECTED'));
    if (pending.size >= 4) return Promise.reject(codexError('BUSY'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(codexError('TIMEOUT')); }, timeout);
      pending.set(id, { resolve, reject, timer, project });
      try { child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }
      catch { shutdown('DISCONNECTED'); }
    });
  }

  async function discover() {
    const home = homedir();
    const candidates = ['/Applications/Codex.app', '/Applications/ChatGPT.app',
      path.join(home, 'Applications/Codex.app'), path.join(home, 'Applications/ChatGPT.app')]
      .map(app => path.join(app, 'Contents/Resources/codex'));
    for (const file of candidates) {
      ensureOpen();
      try {
        const stat = await fs.promises.lstat(file);
        ensureOpen();
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        await fs.promises.access(file, nodeFs.constants.X_OK);
        ensureOpen();
        return file;
      } catch (error) { if (closed) throw codexError('CLOSED'); }
    }
    throw codexError('MISSING');
  }

  function start() {
    if (closed) return Promise.reject(codexError('CLOSED'));
    if (starting) return starting;
    const cancelled = new Promise((resolve, reject) => { startReject = reject; });
    startTimer = setTimeout(() => shutdown('TIMEOUT'), timeout);
    const connect = (async () => {
      const binary = await discover();
      ensureOpen();
      child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.on('error', onFailure); child.on('exit', onFailure);
      child.stdout.on('data', onData); child.stdout.on('error', onFailure);
      child.stdin.on('error', onFailure); child.stderr.on('error', onFailure);
      child.stderr.resume(); // Drain without retaining or logging server diagnostics.
      await request('initialize', { clientInfo: { name: 'emotion-ball-desktop-pet', version: '1.0.0' }, capabilities: { experimentalApi: true } }, () => undefined);
      ensureOpen();
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
      ready = true;
    })();
    starting = Promise.race([connect, cancelled]).catch(error => {
      shutdown(error.code); throw codexError(error.code);
    }).finally(() => { clearTimeout(startTimer); startTimer = null; startReject = null; });
    return starting;
  }

  return {
    start,
    readAccount: () => request('account/read', { refreshToken: false }, projectAccount),
    readQuota: (now = Date.now()) => request('account/rateLimits/read', {}, raw => normalizeQuota(raw, now)),
    listThreads: () => request('thread/list', { limit: 20, sortKey: 'updated_at', archived: false, sourceKinds: [], useStateDbOnly: true }, normalizeThreadList),
    close: () => shutdown()
  };
}

module.exports = { createCodexRpc, codexError, ERROR_CODES, MAX_FRAME_BYTES };
