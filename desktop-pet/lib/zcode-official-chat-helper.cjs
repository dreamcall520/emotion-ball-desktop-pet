'use strict';
// This file is interpreted by the user's unmodified, signed ZCode executable.
// Account decryption, OAuth and project-token material stay in that process.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createAccountReader, createOfficialFetch } = require('./zcode-helper.cjs');
const { createZcodeChatRpc, prepareZcodeRuntime } = require('./zcode-chat-rpc');
const { fetchZcodeUsage, requestOfficialJson } = require('./zcode-usage');
const { createZcodeOfficialAccountAuth } = require('./zcode-team-auth');
const { validAccount, METHODS, safeCode, callArguments, projectResult, projectNotification } = require('./zcode-official-chat-wire');
const fail = code => Object.assign(new Error(code), { code });
function appVersionAt(appDirectory) {
  const plist = fs.readFileSync(path.join(appDirectory, 'Contents/Info.plist'), 'utf8');
  const version = /<key>CFBundleShortVersionString<\/key>\s*<string>(\d{1,4}(?:\.\d{1,4}){1,3})<\/string>/.exec(plist)?.[1];
  if (!version) throw fail('INVALID_REQUEST'); return version;
}
async function createOfficialChatSession({ directory, appDirectory, workspaceDir, expectedAccountKey,
  reader: providedReader, createRpc = createZcodeChatRpc, spawnProcess = spawn, fetch: fetchImpl = globalThis.fetch,
  onNotification = () => {}, onDisconnect = () => {}, onRuntime = () => {}, closeTimeoutMs = 6000 } = {}) {
  if (!validAccount(expectedAccountKey) || typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0') ||
    typeof appDirectory !== 'string' || !path.isAbsolute(appDirectory) || path.basename(appDirectory) !== 'ZCode.app') throw fail('INVALID_REQUEST');
  const reader = providedReader || await createAccountReader({ directory, appDirectory });
  const controller = new AbortController(), appVersion = appVersionAt(appDirectory);
  const officialFetch = createOfficialFetch(fetchImpl);
  const requestJson = (url, init = {}) => requestOfficialJson(url, { ...init, fetch: officialFetch,
    signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  const resolveAccount = createZcodeOfficialAccountAuth(requestJson);
  let prepared, models = [];
  let pinnedSession;
  let rpc, runtimeChild, runtimeExited = false, closed = false, closing, weatherContext = '', sending = false;
  let resolveExit; const runtimeExit = new Promise(resolve => { resolveExit = resolve; });
  let notifications = Promise.resolve();
  async function account() {
    if (closed) throw fail('CLOSED');
    const value = await reader.read();
    if (closed) throw fail('CLOSED');
    if (value?.accountKey !== expectedAccountKey || !['zai', 'bigmodel'].includes(value.family)) throw fail('ZCODE_ACCOUNT_CHANGED');
    if (!['start-plan', 'individual-coding-plan', 'team-coding-plan'].includes(value.selection?.kind)) throw fail('ZCODE_PROVIDER_UNSUPPORTED');
    const session = JSON.stringify([value.accountKey, value.family, value.selection, value.sessionRevision, value.jwtToken, value.accessToken]);
    if (pinnedSession !== undefined && session !== pinnedSession) throw fail('ZCODE_ACCOUNT_CHANGED');
    pinnedSession = session;
    const { personal: _personal, ...official } = value; return official;
  }
  async function close() {
    if (closing) return closing;
    closed = true; controller.abort();
    closing = (async () => {
      try { await rpc?.close(); }
      finally {
        try {
        if (runtimeChild && !runtimeExited) {
          // Protocol.close has a timeout of its own. The scope owner needs an
          // actual exit event, so do not equate that timeout with process exit.
          try { runtimeChild.kill('SIGTERM'); } catch {}
          let timer;
          try { await Promise.race([runtimeExit, new Promise((_, reject) => { timer = setTimeout(() => {
            try { runtimeChild.kill('SIGKILL'); } catch {}
            reject(fail('PROCESS_EXIT_UNCONFIRMED'));
          }, closeTimeoutMs); })]); } finally { clearTimeout(timer); }
        }
        } finally { pinnedSession = undefined; reader.close?.(); }
      }
    })();
    return closing;
  }
  function disconnect(code) {
    if (!closed) onDisconnect(safeCode(code));
    void close().catch(() => {});
  }
  try {
    await account();
    rpc = createRpc({ workspaceDir, appDirectory, runtimeHome: path.join(workspaceDir, 'runtime-home'),
      home: path.dirname(directory), executable: path.join(appDirectory, 'Contents/MacOS/ZCode'),
      env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
        /^(?:PATH|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|LANG|LC_ALL|TMPDIR)$/.test(key) && typeof value === 'string')),
      officialOnly: true, strictOfficialSelection: true, readAccount: account,
      prepareRuntime: async options => { prepared = await prepareZcodeRuntime(options); return prepared; },
      resolveTeamAccount: (selected, options = {}) => resolveAccount(selected, { ...options, appVersion, readAccount: account,
        signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal }),
      fetchUsage: selected => fetchZcodeUsage(selected, { appVersion, fetch: officialFetch, signal: controller.signal,
        readAccount: account, resolveOfficialAccount: resolveAccount, resolveTeamAccount: resolveAccount }), requestJson,
      getWeatherContext: () => weatherContext,
      onNotification: packet => {
        notifications = notifications.then(async () => { await account(); if (!closed) onNotification(projectNotification(packet)); })
          .catch(error => disconnect(error.code));
      }, onDisconnect: disconnect,
      spawn: (...args) => {
        if (closed || runtimeChild) throw fail('CLOSED');
        runtimeChild = spawnProcess(...args); onRuntime('started');
        const exited = () => { if (runtimeExited) return; runtimeExited = true; resolveExit(); onRuntime('exited'); };
        runtimeChild.once('exit', exited); runtimeChild.once('close', exited);
        runtimeChild.on('error', () => { if (!runtimeChild.pid) exited(); });
        return runtimeChild;
      } });
  } catch (error) { reader.close?.(); throw error; }
  return { async call(method, args, context = '') {
    args = callArguments(method, args);
    if (typeof context !== 'string' || context.length > 1000 || context.includes('\0')) throw fail('INVALID_REQUEST');
    if (method === 'startTurn' && sending) throw fail('BUSY');
    if (method === 'startTurn') { sending = true; weatherContext = context; }
    try {
      const selected = await account();
      if (method === 'getConsentIdentity') {
        if (!models.some(row => row.id === args[0].model)) throw fail('MODEL_UNAVAILABLE');
        const providerId = `account:${selected.family}-${selected.selection.kind}`;
        const provider = prepared?.release?.config?.providerConfigRules?.providerRules?.find(row => row.providerId === providerId);
        let recipientOrigin; try { recipientOrigin = new URL(provider.config.api.baseUrl).origin; } catch { throw fail('UNSAFE_CONFIG'); }
        const expected = selected.selection.kind === 'start-plan' ? 'https://zcode.z.ai' : selected.family === 'zai' ? 'https://api.z.ai' : 'https://open.bigmodel.cn';
        if (recipientOrigin !== expected) throw fail('UNSAFE_CONFIG');
        await account(); return projectResult(method, { accountKey: expectedAccountKey, recipientOrigin, channel: 'official' });
      }
      const value = await rpc[method](...args); await account();
      const projected = projectResult(method, value); if (method === 'listModels') models = projected;
      return projected;
    }
    catch (error) { if (['ZCODE_ACCOUNT_CHANGED', 'UNAUTHENTICATED'].includes(error.code)) disconnect(error.code); throw fail(safeCode(error.code)); }
    finally { if (method === 'startTurn') { sending = false; weatherContext = ''; } }
  }, close };
}
async function main() {
  let session, initialized = false, ending = false;
  const pending = new Set();
  const write = packet => { process.stdout.write(JSON.stringify(packet) + '\n'); };
  const close = async () => {
    if (ending) return; ending = true;
    try { await session?.close(); write({ type: 'closed' }); process.stdin.destroy(); }
    catch { write({ type: 'disconnect', code: 'PROCESS_EXIT_UNCONFIRMED' }); }
  };
  async function receive(line) {
    let request, id;
    try {
      if (Buffer.byteLength(line) > 64 * 1024) throw fail('INVALID_REQUEST');
      request = JSON.parse(line); id = request?.id;
      if (!Number.isSafeInteger(id) || id <= 0 || pending.has(id) || !request || typeof request !== 'object' || Array.isArray(request)) throw fail('INVALID_REQUEST');
      pending.add(id);
      if (request.method === 'close') { await close(); write({ id, result: null }); return; }
      if (ending) throw fail('CLOSED');
      if (request.method === 'initialize') {
        if (initialized || !validAccount(request.expectedAccountKey)) throw fail('INVALID_REQUEST'); initialized = true;
        session = await createOfficialChatSession({ appDirectory: process.env.QIUQIU_ZCODE_APP_DIRECTORY,
          directory: process.env.QIUQIU_ZCODE_ACCOUNT_DIRECTORY, workspaceDir: process.env.QIUQIU_ZCODE_WORKSPACE_DIRECTORY,
          expectedAccountKey: request.expectedAccountKey,
          onNotification: packet => write({ type: 'notification', packet }), onDisconnect: code => write({ type: 'disconnect', code }),
          onRuntime: state => write({ type: 'runtime', state }) });
        if (ending) await session.close();
        write({ id, result: null }); return;
      }
      if (!session || !METHODS.has(request.method) || pending.size > 8) throw fail('INVALID_REQUEST');
      const result = await session.call(request.method, request.args, request.weatherContext || '');
      write({ id, result });
    } catch (error) { write({ ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}), type: 'error', code: safeCode(error.code) }); }
    finally { pending.delete(id); }
  }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => { void receive(line); }); lines.on('close', () => { void close(); });
  process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
}
if (require.main === module) void main().catch(() => { process.stdout.write(JSON.stringify({ type: 'error', code: 'ZCODE_INVALID_RESPONSE' }) + '\n'); process.exitCode = 1; });
module.exports = { createOfficialChatSession };
