#!/usr/bin/env node
'use strict';

// User-invoked host-side CLI only. Never import from main.js or a packager.
// The MAS App imports the generated pairing file through the system file picker.
const nodeFs = require('node:fs');
const nodeOs = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn: nodeSpawn } = require('node:child_process');
const { randomBytes: nodeRandomBytes, createHash } = require('node:crypto');
const { DISABLED_FEATURES } = require('../lib/codex-chat-rpc');
const SAFE_CODES = new Set(['INVALID_INPUT', 'UNSAFE_CONFIG', 'CODEX_NOT_FOUND', 'START_FAILED',
  'START_TIMEOUT', 'SERVICE_EXITED', 'STOPPED', 'CLEANUP_FAILED']);
function failure(code) { return Object.assign(new Error(SAFE_CODES.has(code) ? code : 'START_FAILED'), { code: SAFE_CODES.has(code) ? code : 'START_FAILED' }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function installedBinary(io, hostHome) {
  const apps = ['/Applications/Codex.app', '/Applications/ChatGPT.app',
    path.join(hostHome, 'Applications/Codex.app'), path.join(hostHome, 'Applications/ChatGPT.app')];
  const candidates = [
    ...apps.map(app => path.join(app, 'Contents/Resources/codex')),
    ...apps.map(app => path.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'))
  ];
  for (const filename of candidates) {
    try {
      const stat = await io.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await io.access(filename, nodeFs.constants.X_OK);
      return filename;
    } catch (_) { /* No path, account or error contents are logged. */ }
  }
  throw failure('CODEX_NOT_FOUND');
}
function serverArgs(endpoint, tokenHash) {
  return ['app-server', '--listen', endpoint, '--ws-auth', 'capability-token', '--ws-token-sha256', tokenHash,
    ...DISABLED_FEATURES.flatMap(name => ['-c', `features.${name}=false`]),
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', 'skills.include_instructions=false', '-c', 'features.skip_host_skill_discovery=true'];
}

async function startCodexLocalChatService({ binary, io = nodeFs.promises, spawnProcess = nodeSpawn,
  fetch: fetchImpl = globalThis.fetch, reservePort = reserveLoopbackPort, randomBytes = nodeRandomBytes,
  hostHome = nodeOs.homedir(), temporaryRoot = nodeOs.tmpdir(), env = process.env,
  startTimeoutMs = 15000, signal, onStatus = () => {} } = {}) {
  if (typeof hostHome !== 'string' || !path.isAbsolute(hostHome) || hostHome.includes('\0') ||
      typeof fetchImpl !== 'function' || !Number.isFinite(startTimeoutMs) || startTimeoutMs < 1 || startTimeoutMs > 60000) throw failure('INVALID_INPUT');
  // Preserve the host login. Never rewrite HOME/CODEX_HOME or edit its configuration.
  if (env.CODEX_HOME !== undefined && (typeof env.CODEX_HOME !== 'string' ||
      !path.isAbsolute(env.CODEX_HOME) || path.resolve(env.CODEX_HOME) !== path.join(hostHome, '.codex'))) throw failure('UNSAFE_CONFIG');
  const executable = binary || await installedBinary(io, hostHome);
  const port = await reservePort();
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw failure('START_FAILED');
  const endpoint = `ws://127.0.0.1:${port}`;
  const scratch = await io.mkdtemp(path.join(temporaryRoot, 'qiuqiu-codex-chat-'));
  let child = null, stopped = false, exited = false, stopFlight = null, rejectExit;
  let exitCode = null, exitSignal = null, resolveClosed;
  const startupAbort = new AbortController();
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const earlyExit = new Promise((_, reject) => { rejectExit = reject; });
  // A child can fail before the readiness race is attached. Keep that rejection observed.
  void earlyExit.catch(() => {});
  const pairingFile = path.join(scratch, 'pairing.json');
  const status = value => { try { onStatus(value); } catch (_) {} };
  async function cleanup() {
    try { await io.rm(scratch, { recursive: true, force: true }); return true; }
    catch (_) { return false; }
  }
  async function finish() {
    signal?.removeEventListener('abort', externalAbort);
    const cleaned = await cleanup();
    const result = { status: cleaned ? 'stopped' : 'cleanup-failed', exitCode, signal: exitSignal };
    resolveClosed(result); return result;
  }
  function markExit(code, signal) {
    if (exited) return;
    exited = true; exitCode = Number.isInteger(code) ? code : null;
    exitSignal = typeof signal === 'string' ? signal : null;
    startupAbort.abort(); rejectExit(failure(stopped ? 'STOPPED' : 'SERVICE_EXITED'));
    void finish();
  }
  async function stop() {
    if (stopFlight) return stopFlight;
    stopped = true; startupAbort.abort();
    stopFlight = (async () => {
      if (!child) return finish();
      if (exited) return closed;
      // This handle is the one process created below. Never enumerate/kill Codex peers.
      try { child.kill('SIGTERM'); } catch (_) { markExit(null, null); }
      const escalation = setTimeout(() => { if (!exited) { try { child.kill('SIGKILL'); } catch (_) {} } }, 1500);
      try { return await closed; }
      finally { clearTimeout(escalation); }
    })();
    return stopFlight;
  }
  const externalAbort = () => { void stop(); };
  const checkStopped = () => { if (stopped || signal?.aborted) throw failure('STOPPED'); };
  signal?.addEventListener('abort', externalAbort, { once: true });
  try {
    checkStopped();
    await io.chmod(scratch, 0o700); checkStopped();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await io.writeFile(pairingFile, JSON.stringify({ version: 1, endpoint, bearerToken: token, hostHome }) + '\n',
      { flag: 'wx', mode: 0o600 }); checkStopped();
    await io.chmod(pairingFile, 0o600); checkStopped();
    child = spawnProcess(executable, serverArgs(endpoint, tokenHash),
      { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr?.on('error', () => {}); child.stderr?.resume(); // Drain; never retain diagnostics.
    child.once('exit', markExit);
    child.once('error', () => markExit(null, null));
    const startedAt = Date.now();
    const ready = (async () => {
      while (!stopped && !exited && Date.now() - startedAt < startTimeoutMs) {
        const attempt = new AbortController();
        const abortAttempt = () => attempt.abort();
        startupAbort.signal.addEventListener('abort', abortAttempt, { once: true });
        const remaining = Math.max(1, startTimeoutMs - (Date.now() - startedAt));
        const timer = setTimeout(abortAttempt, Math.min(750, remaining));
        try {
          const response = await fetchImpl(`http://127.0.0.1:${port}/readyz`,
            { method: 'GET', redirect: 'error', cache: 'no-store', signal: attempt.signal });
          try { await response.body?.cancel(); } catch (_) {}
          if (!stopped && !exited && response.status === 200 && response.redirected !== true) return;
        } catch (_) { /* A closed port while startup proceeds is expected. */ }
        finally { clearTimeout(timer); startupAbort.signal.removeEventListener('abort', abortAttempt); }
        if (!stopped && !exited) await wait(Math.min(100, Math.max(1, startTimeoutMs - (Date.now() - startedAt))));
      }
      throw failure(stopped ? 'STOPPED' : exited ? 'SERVICE_EXITED' : 'START_TIMEOUT');
    })();
    let startupDeadline;
    const deadline = new Promise((_, reject) => {
      startupDeadline = setTimeout(() => { startupAbort.abort(); reject(failure('START_TIMEOUT')); }, startTimeoutMs);
    });
    try { await Promise.race([ready, earlyExit, deadline]); }
    finally { clearTimeout(startupDeadline); }
    checkStopped();
    status({ status: 'ready', pairingFile, port });
    return { pairingFile, endpoint, port, stop, closed };
  } catch (error) {
    await stop(); throw failure(stopped && signal?.aborted ? 'STOPPED' : error?.code);
  }
}

async function runCli() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node desktop-pet/scripts/start-codex-local-chat-service.js\nKeep this terminal open. Import the printed pairing.json through the MAS App system picker. Ctrl+C stops only this service and removes its temporary pairing file.\n');
    return;
  }
  if (process.argv.length > 2) throw failure('INVALID_INPUT');
  let service, stopRequested = false;
  const controller = new AbortController();
  const stop = () => { stopRequested = true; controller.abort(); void service?.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    service = await startCodexLocalChatService({ signal: controller.signal, onStatus: value => process.stdout.write(JSON.stringify(value) + '\n') });
    if (stopRequested) await service.stop();
    const result = await service.closed;
    process.stdout.write(JSON.stringify({ status: result.status }) + '\n');
    if (result.status === 'cleanup-failed') process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (service) await service.stop();
  }
}
if (require.main === module) runCli().catch(error => {
  if (error?.code === 'STOPPED') { process.stdout.write(JSON.stringify({ status: 'stopped' }) + '\n'); return; }
  process.stderr.write(JSON.stringify({ status: 'error', code: SAFE_CODES.has(error?.code) ? error.code : 'START_FAILED' }) + '\n');
  process.exitCode = 1;
});
module.exports = { startCodexLocalChatService, serverArgs };
