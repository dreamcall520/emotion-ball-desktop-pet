#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const VERSION = '2.179.0';
const BASE = path.join(os.homedir(), 'Library/Application Support/球球桌宠-商店联调工具/codebuddy-cli');
const safeError = code => Object.assign(new Error(code), { code });
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function buildLaunch({ base = BASE, password, port, env = process.env, runtime = process.execPath } = {}) {
  if (!path.isAbsolute(base) || !/^[A-Za-z0-9_-]{32,200}$/.test(password || '') || !Number.isInteger(port) || port < 1 || port > 65535) throw safeError('INVALID_CONFIGURATION');
  const childEnv = { ...env };
  // Credentials are owned by the isolated official CLI login, never imported.
  for (const key of Object.keys(childEnv)) if (/^(CODEBUDDY_|SERVER__|ELECTRON_|ANTHROPIC_|OPENAI_|BIGMODEL_|ZAI_|GEMINI_)/.test(key)) delete childEnv[key];
  Object.assign(childEnv, { CODEBUDDY_CONFIG_DIR: path.join(base, 'profile'),
    DISABLE_AUTOUPDATER: '1', CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_PASSWORD: password,
    CODEBUDDY_DISABLE_CRON: '1', CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CODEBUDDY_AGENT_HOME_ORCHESTRATION_ENABLED: '0' });
  return { command: runtime, args: [path.join(base, 'node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'),
    '--serve', '--host', '127.0.0.1', '--port', String(port), '--auth', 'password', '--agent', 'cli',
    '--permission-mode', 'dontAsk', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'user', '--settings', JSON.stringify({ disableAllHooks: true,
      permissions: { deny: ['*', 'mcp__*'], allow: [], disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable' } })],
    options: { cwd: path.join(base, 'workspace'), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] } };
}
async function startService({ base = BASE, spawnChild = spawn, request = globalThis.fetch, allocatePort = freePort,
  random = () => randomBytes(32).toString('base64url'), timeoutMs = 180000,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  let packageInfo;
  try { packageInfo = JSON.parse(await fs.readFile(path.join(base, 'node_modules/@tencent-ai/codebuddy-code/package.json'), 'utf8')); }
  catch { throw safeError('CLI_NOT_INSTALLED'); }
  if (packageInfo.name !== '@tencent-ai/codebuddy-code' || packageInfo.version !== VERSION) throw safeError('CLI_VERSION_MISMATCH');
  const password = random(), port = await allocatePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const launch = buildLaunch({ base, password, port });
  await fs.mkdir(launch.options.cwd, { recursive: true, mode: 0o700 });
  const child = spawnChild(launch.command, launch.args, launch.options);
  // Official startup output can include its gateway password. Drain, never echo.
  child.stdout?.resume(); child.stderr?.resume();
  let exited = false, directory, stopped = false;
  child.once('exit', () => { exited = true; if (directory) void fs.rm(directory, { recursive: true, force: true }); });
  child.once('error', () => { exited = true; });
  async function stop() {
    if (stopped) return; stopped = true;
    if (!exited) { child.kill('SIGTERM'); for (let i = 0; i < 20 && !exited; i++) await pause(50); if (!exited) child.kill('SIGKILL'); }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
  try {
    const deadline = now() + timeoutMs;
    let ready = false;
    while (now() < deadline && !exited) {
      try {
        const response = await request(endpoint + '/api/v1/auth/status', { redirect: 'manual',
          headers: { Authorization: `Bearer ${password}`, 'X-CodeBuddy-Request': '1' }, signal: AbortSignal.timeout(2000) });
        if (response.status === 200 && !response.redirected) {
          const text = await response.text();
          if (text.length < 4096) { const status = JSON.parse(text); ready = status.authEnabled === true && status.authenticated === true; }
        } else await response.body?.cancel();
      } catch { /* Retry only readiness; never dispatch a task or authentication request. */ }
      if (ready) break;
      await pause(200);
    }
    if (!ready) throw safeError(exited ? 'CLI_EXITED' : 'CLI_START_TIMEOUT');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qiuqiu-workbuddy-cli-'));
    await fs.chmod(directory, 0o700);
    const pairingPath = path.join(directory, 'connection.json');
    await fs.writeFile(pairingPath, JSON.stringify({ version: 1, provider: 'workbuddy-cli', endpoint, password, workspaceDir: launch.options.cwd, cliVersion: VERSION }), { mode: 0o600, flag: 'wx' });
    if (exited) throw safeError('CLI_EXITED');
    return { pairingPath, endpoint, cliVersion: VERSION, stop };
  } catch (error) { await stop(); throw safeError(['CLI_EXITED', 'CLI_START_TIMEOUT'].includes(error?.code) ? error.code : 'CLI_START_FAILED'); }
}
if (require.main === module) {
  startService().then(service => {
    console.log(JSON.stringify({ status: 'ready', provider: 'workbuddy-cli', pairingPath: service.pairingPath, cliVersion: service.cliVersion }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.stop().finally(() => process.exit(0)); });
  }).catch(error => { console.error(error.code || 'CLI_START_FAILED'); process.exitCode = 1; });
}
module.exports = { buildLaunch, startService, VERSION };
