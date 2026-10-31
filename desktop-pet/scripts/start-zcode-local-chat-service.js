#!/usr/bin/env node
'use strict';

// Explicit user-invoked experimental host. Never import from the MAS App or a packager.
// Reuses the installed ZCode runtime and original account; not an official public SDK.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { createZcodeChatRpc } = require('../lib/zcode-chat-rpc');
const { readZcodeAccount } = require('../lib/zcode-account');
const SAFE_CODES = new Set(['INVALID_INPUT', 'START_FAILED', 'STOPPED', 'CLOSED', 'DISCONNECTED', 'TIMEOUT', 'BUSY',
  'INVALID_FRAME', 'UNSUPPORTED', 'UNAUTHENTICATED', 'THREAD_NOT_OWNED', 'MODELS_UNAVAILABLE', 'MODEL_UNAVAILABLE',
  'UNSAFE_CONFIG', 'TOOL_BLOCKED', 'VERIFICATION_REQUIRED', 'ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING',
  'ZCODE_TEAM_ACCESS_DENIED', 'ZCODE_LOGIN_REQUIRED', 'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR',
  'ZCODE_INVALID_RESPONSE', 'ZCODE_CREDENTIAL_DECRYPT_FAILED', 'ZCODE_ACCOUNT_MISSING', 'RATE_LIMITED', 'THREAD_BUSY', 'MISSING']);
const NOTIFICATIONS = new Set(['account/updated', 'turn/started', 'item/agentMessage/delta', 'item/completed', 'turn/completed']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const failure = code => Object.assign(new Error(SAFE_CODES.has(code) ? code : 'START_FAILED'), { code: SAFE_CODES.has(code) ? code : 'START_FAILED' });

async function startZcodeLocalChatService({ hostHome = os.homedir(), temporaryRoot = os.tmpdir(), env = process.env,
  createRpc = createZcodeChatRpc, signal, onStatus = () => {} } = {}) {
  if (typeof hostHome !== 'string' || !path.isAbsolute(hostHome) || hostHome.includes('\0') || typeof createRpc !== 'function') throw failure('INVALID_INPUT');
  if (signal?.aborted) throw failure('STOPPED');
  const scratch = await fs.promises.mkdtemp(path.join(temporaryRoot, 'qiuqiu-zcode-chat-'));
  await fs.promises.chmod(scratch, 0o700);
  const workspaceDir = path.join(scratch, 'workspace');
  const pairingFile = path.join(scratch, 'pairing.json');
  const token = randomBytes(32).toString('base64url');
  const authorizationHash = createHash('sha256').update('Bearer ' + token).digest();
  let holder = null, stopping = false, stopFlight = null, resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const ownedThreads = new Map();
  const server = http.createServer((request, response) => {
    if (request.url === '/readyz' && request.method === 'GET' && !request.headers.origin) {
      response.writeHead(stopping ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ provider: 'zcode', status: stopping ? 'stopped' : 'ready' })); return;
    }
    response.writeHead(404); response.end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  const abort = () => { void stop(); };
  function validAuthorization(value) {
    return typeof value === 'string' && value.length <= 128 &&
      timingSafeEqual(createHash('sha256').update(value).digest(), authorizationHash);
  }
  function refuse(socket, code) { socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); }
  server.on('upgrade', (request, socket, head) => {
    // No browser-origin clients, wildcard listener, URL token, redirects or unauthenticated RPC.
    if (stopping || holder) { refuse(socket, '503 Service Unavailable'); return; }
    if (request.method !== 'GET' || request.url !== '/zcode' || request.headers.origin !== undefined ||
        request.socket.remoteAddress !== '127.0.0.1' || !validAuthorization(request.headers.authorization)) {
      refuse(socket, '401 Unauthorized'); return;
    }
    try { sockets.handleUpgrade(request, socket, head, websocket => sockets.emit('connection', websocket)); }
    catch (_) { holder = null; socket.destroy(); }
  });
  sockets.on('connection', websocket => {
    let rpc = null, initialized = false, ended = false, queue = Promise.resolve(), queued = 0, lastRequestId = 0, closeFlight = null;
    const owned = { websocket, close: () => {
      if (closeFlight) return closeFlight;
      ended = true;
      closeFlight = (async () => {
        try { await rpc?.close(); } catch (_) {}
        try { websocket.terminate(); } catch (_) {}
        if (holder === owned) holder = null;
      })();
      return closeFlight;
    } };
    holder = owned;
    function send(packet) {
      if (ended || stopping || websocket.readyState !== 1) return;
      try {
        const frame = JSON.stringify(packet);
        if (Buffer.byteLength(frame) > 1024 * 1024) { void owned.close(); return; }
        websocket.send(frame);
      } catch (_) { void owned.close(); }
    }
    function error(id, code, rpcCode = -32000) {
      const safe = SAFE_CODES.has(code) ? code : 'DISCONNECTED';
      send({ id, error: { code: rpcCode, message: safe, data: { code: safe } } });
    }
    async function invoke(packet) {
      if (ended || stopping) return;
      const params = packet.params ?? {};
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw failure('INVALID_INPUT');
      if (packet.method === 'initialize') {
        if (params.protocolVersion !== 1) throw failure('UNSUPPORTED');
        if (!initialized) {
          rpc = createRpc({ workspaceDir, home: hostHome, env,
            // Do not silently use separately paid custom API providers from the user's config.
            readAccount: options => readZcodeAccount(options),
            onNotification: value => {
              if (!NOTIFICATIONS.has(value?.method) || Object.hasOwn(value, 'id')) { void owned.close(); return; }
              send(value);
            }, onDisconnect: () => { void owned.close(); } });
          await rpc.start(); initialized = true;
        }
        return { provider: 'zcode', protocolVersion: 1, tools: false };
      }
      if (!initialized) throw failure('UNAUTHENTICATED');
      if (packet.method === 'zcode/readAccount') return rpc.readAccount();
      if (packet.method === 'zcode/listModels') return rpc.listModels();
      if (packet.method === 'zcode/startThread') {
        if (ownedThreads.size >= 128) throw failure('BUSY');
        const account = await rpc.readAccount();
        if (account?.authenticated !== true || !/^[a-f0-9]{64}$/.test(account.accountKey)) throw failure('UNAUTHENTICATED');
        const thread = await rpc.startThread();
        if (!validId(thread?.id) || (await rpc.readAccount()).accountKey !== account.accountKey) throw failure('UNAUTHENTICATED');
        ownedThreads.set(thread.id, account.accountKey); return thread;
      }
      if (packet.method === 'zcode/resumeThread') {
        if (!validId(params.id) || !ownedThreads.has(params.id)) throw failure('THREAD_NOT_OWNED');
        if ((await rpc.readAccount()).accountKey !== ownedThreads.get(params.id)) throw failure('UNAUTHENTICATED');
        return rpc.resumeThread(params.id);
      }
      if (packet.method === 'zcode/startTurn') {
        if (!validId(params.id) || !ownedThreads.has(params.id)) throw failure('THREAD_NOT_OWNED');
        if (typeof params.text !== 'string' || !params.text.trim() || params.text.length > 8000 || params.text.includes('\0') ||
            !params.selection || typeof params.selection !== 'object' || Array.isArray(params.selection) ||
            typeof params.selection.model !== 'string' || params.selection.model.length > 200 ||
            typeof params.selection.effort !== 'string' || !/^[a-z]{1,16}$/.test(params.selection.effort)) throw failure('INVALID_INPUT');
        if ((await rpc.readAccount()).accountKey !== ownedThreads.get(params.id)) throw failure('UNAUTHENTICATED');
        return rpc.startTurn(params.id, params.text, { model: params.selection.model, effort: params.selection.effort });
      }
      if (packet.method === 'zcode/interruptTurn') {
        if (!validId(params.id) || !ownedThreads.has(params.id) || !validId(params.turnId)) throw failure('THREAD_NOT_OWNED');
        if ((await rpc.readAccount()).accountKey !== ownedThreads.get(params.id)) throw failure('UNAUTHENTICATED');
        return rpc.interruptTurn(params.id, params.turnId);
      }
      throw failure('UNSUPPORTED');
    }
    websocket.on('message', (data, binary) => {
      let packet;
      try {
        if (binary || data.length > 1024 * 1024) throw failure('INVALID_FRAME');
        packet = JSON.parse(data.toString('utf8'));
        if (!packet || typeof packet !== 'object' || Array.isArray(packet) || !Number.isSafeInteger(packet.id) || packet.id <= lastRequestId ||
            typeof packet.method !== 'string' || packet.method.length > 100 || Object.hasOwn(packet, 'result') || Object.hasOwn(packet, 'error')) throw failure('INVALID_FRAME');
      } catch (_) { void owned.close(); return; }
      lastRequestId = packet.id;
      if (++queued > 8) { queued--; error(packet.id, 'BUSY', -32001); return; }
      queue = queue.then(async () => {
        try { const result = await invoke(packet); send({ id: packet.id, result: result ?? null }); }
        catch (reason) { error(packet.id, reason?.code); }
        finally { queued--; }
      });
    });
    websocket.on('error', () => { void owned.close(); });
    websocket.on('close', () => { void owned.close(); });
  });
  async function stop() {
    if (stopFlight) return stopFlight;
    stopping = true; signal?.removeEventListener('abort', abort);
    stopFlight = (async () => {
      await holder?.close?.();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(() => resolve()));
      await new Promise(resolve => server.close(() => resolve()));
      let cleaned = true; try { await fs.promises.rm(scratch, { recursive: true, force: true }); } catch (_) { cleaned = false; }
      const result = { status: cleaned ? 'stopped' : 'cleanup-failed' }; resolveClosed(result); return result;
    })();
    return stopFlight;
  }
  try {
    signal?.addEventListener('abort', abort, { once: true });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (signal?.aborted || stopping) throw failure('STOPPED');
    const port = server.address().port, endpoint = `ws://127.0.0.1:${port}/zcode`;
    await fs.promises.writeFile(pairingFile, JSON.stringify({ version: 1, provider: 'zcode', endpoint, bearerToken: token, hostHome }) + '\n',
      { flag: 'wx', mode: 0o600 });
    const status = { status: 'ready', provider: 'zcode', pairingDirectory: scratch, port };
    try { onStatus(status); } catch (_) {}
    return { pairingDirectory: scratch, pairingFile, endpoint, port, stop, closed };
  } catch (error) { await stop(); throw failure(error?.code); }
}
async function runCli() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node desktop-pet/scripts/start-zcode-local-chat-service.js\nExperimental installed-ZCode account adapter; keep this terminal open. Select the printed pairing directory in the candidate App, never preview pairing.json. Ctrl+C stops only this service.\n'); return;
  }
  if (process.argv.length > 2) throw failure('INVALID_INPUT');
  const controller = new AbortController(); let service;
  const stop = () => { controller.abort(); void service?.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    service = await startZcodeLocalChatService({ signal: controller.signal,
      onStatus: value => process.stdout.write(JSON.stringify(value) + '\n') });
    await service.closed;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await service?.stop(); }
}
if (require.main === module) runCli().catch(error => {
  process.stderr.write(JSON.stringify({ status: 'error', code: SAFE_CODES.has(error?.code) ? error.code : 'START_FAILED' }) + '\n'); process.exitCode = 1;
});
module.exports = { startZcodeLocalChatService };
