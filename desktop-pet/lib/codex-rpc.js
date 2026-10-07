const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { readCodexUsageHistory } = require('./codex-usage-history');
const { isTaskId, normalizeQuota, normalizeThreadList, normalizeResetHistoryPage,
  accountResetHistoryDetails, MAX_RESET_HISTORY_EVENTS } = require('./codex-state');

const ERROR_CODES = Object.freeze(['MISSING', 'UNAUTHENTICATED', 'UNSUPPORTED', 'DISCONNECTED', 'TIMEOUT', 'INVALID_FRAME', 'UNSAFE_SOCKET', 'STATE_TOO_LARGE', 'PARTIAL_STATE', 'CLOSED', 'BUSY']);
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const METHODS = new Set(['initialize', 'account/read', 'account/rateLimits/read', 'getAuthStatus', 'thread/list']);
const RESET_HISTORY_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/history';
const HISTORY_CACHE_MS = 120000;
const HISTORY_MAX_PAGES = 10;
const HISTORY_PAGE_BYTES = 256 * 1024;
const HISTORY_TOTAL_BYTES = 1024 * 1024;
const THREAD_LIST_PARAMS = Object.freeze({ sortKey: 'updated_at', archived: false, sourceKinds: [], useStateDbOnly: true });
const DISCOVERY_PAGE_LIMIT = 100;
const DISCOVERY_MAX_PAGES = 10;
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
    const workspace = raw?.workspaceRouting?.chatgptAccountId;
    const scope = typeof workspace === 'string' && workspace.length > 0 && workspace.length <= 200 ? `:workspace:${workspace}` : '';
    return { accountKey: createHash('sha256').update(`chatgpt:${account.email.trim().toLowerCase()}${scope}`).digest('hex'), authenticated: true };
  }
  // API-key accounts have no safe stable identity field; never read the key to manufacture one.
  if (account && typeof account === 'object' && !Array.isArray(account) &&
    typeof account.type === 'string' && account.type.trim() && account.type !== 'chatgpt') {
    return { accountKey: null, authenticated: null, supported: false };
  }
  throw codexError('UNSUPPORTED');
}

function createCodexRpc({ fs = nodeFs, spawn = childProcess.spawn, homedir = os.homedir,
  timeoutMs = 10000, maxFrameBytes = MAX_FRAME_BYTES, onDisconnect = () => {}, ignoreThread = () => false,
  fetch = globalThis.fetch, now = Date.now, historyTimeoutMs = 5000, readUsageHistory = readCodexUsageHistory } = {}) {
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
  let accountIdentity = null, accountVersion = 0, historyCache = null, historyFlight = null;
  let localHistoryCycle = null;
  const historyControllers = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const ensureOpen = () => { if (closed) throw codexError('CLOSED'); };

  function shutdown(code = 'CLOSED') {
    if (closed) return;
    closed = true; ready = false;
    for (const controller of historyControllers) controller.abort();
    historyControllers.clear(); historyCache = null; accountIdentity = null; accountVersion++;
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

  function request(method, params, project, requestTimeout = timeout) {
    if (closed) return Promise.reject(codexError('CLOSED'));
    if (!METHODS.has(method)) return Promise.reject(codexError('UNSUPPORTED'));
    if (!child || (method !== 'initialize' && !ready)) return Promise.reject(codexError('DISCONNECTED'));
    if (pending.size >= 4) return Promise.reject(codexError('BUSY'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(codexError('TIMEOUT')); }, Math.max(1, Math.min(timeout, requestTimeout)));
      pending.set(id, { resolve, reject, timer, project });
      try { child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }
      catch { shutdown('DISCONNECTED'); }
    });
  }

  async function discover() {
    const home = homedir();
    const apps = ['/Applications/Codex.app', '/Applications/ChatGPT.app',
      path.join(home, 'Applications/Codex.app'), path.join(home, 'Applications/ChatGPT.app')];
    const candidates = [
      ...apps.map(app => path.join(app, 'Contents/Resources/codex')),
      ...apps.map(app => path.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'))
    ];
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

  function projectThreads(raw, limit) {
    // Workspace identity is available only before the metadata projection drops cwd.
    const filtered = Array.isArray(raw?.data)
      ? { ...raw, data: raw.data.filter(row => !ignoreThread(row)) } : raw;
    return normalizeThreadList(filtered, limit);
  }

  async function findThread(id) {
    if (!isTaskId(id)) return null;
    let cursor = null;
    const seenCursors = new Set();
    for (let page = 0; page < DISCOVERY_MAX_PAGES; page++) {
      const result = await request('thread/list', {
        limit: DISCOVERY_PAGE_LIMIT, ...THREAD_LIST_PARAMS, ...(cursor ? { cursor } : {})
      }, raw => ({
        rows: projectThreads(raw, DISCOVERY_PAGE_LIMIT),
        nextCursor: typeof raw?.nextCursor === 'string' && raw.nextCursor.length <= 500 ? raw.nextCursor : null
      }));
      const match = result.rows.find(row => row.id === id);
      if (match) return match;
      if (!result.nextCursor || seenCursors.has(result.nextCursor)) return null;
      seenCursors.add(result.nextCursor); cursor = result.nextCursor;
    }
    return null;
  }

  function rememberAccount(raw) {
    const projected = projectAccount(raw);
    const routing = raw?.workspaceRouting;
    const identity = { ...projected,
      emailKey: raw?.account?.type === 'chatgpt' && typeof raw.account.email === 'string'
        ? createHash('sha256').update(raw.account.email.trim().toLowerCase()).digest('hex') : null,
      accountId: typeof routing?.chatgptAccountId === 'string' && routing.chatgptAccountId.length <= 200 ? routing.chatgptAccountId : null,
      backendOrigin: typeof routing?.backendOrigin === 'string' ? routing.backendOrigin : null,
      routingOverride: ['NO_CONSTRAINT', 'us', 'us_cr'].includes(routing?.accountRoutingOverride) ? routing.accountRoutingOverride : null };
    if (JSON.stringify(identity) !== JSON.stringify(accountIdentity)) {
      accountVersion++;
      for (const controller of historyControllers) controller.abort();
      historyCache = null; historyFlight = null;
      localHistoryCycle = null;
    }
    accountIdentity = identity;
    return projected;
  }

  function projectHistoryAuth(raw, identity) {
    if (!['chatgpt', 'chatgptAuthTokens'].includes(raw?.authMethod) || typeof raw.authToken !== 'string'
      || !raw.authToken || raw.authToken.length > 32768 || /[\s\u0000-\u001f\u007f]/u.test(raw.authToken)) throw codexError('UNAUTHENTICATED');
    let accountId = identity.accountId;
    try {
      const parts = raw.authToken.split('.');
      if (parts.length === 3 && parts[1].length <= 24000) {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const email = claims?.['https://api.openai.com/profile']?.email;
        if (typeof email === 'string' && createHash('sha256').update(email.trim().toLowerCase()).digest('hex') !== identity.emailKey) throw codexError('UNAUTHENTICATED');
        const id = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
        if (typeof id === 'string' && id.length > 0 && id.length <= 200) {
          if (accountId && accountId !== id) throw codexError('UNAUTHENTICATED');
          accountId = id;
        }
      }
    } catch (error) { if (error?.code === 'UNAUTHENTICATED') throw error; }
    if (!accountId || /[\u0000-\u001f\u007f]/u.test(accountId)) throw codexError('UNSUPPORTED');
    return { token: raw.authToken, accountId };
  }

  async function readHistoryBody(response, budget) {
    const declared = Number(response.headers?.get('content-length'));
    const limit = Math.min(HISTORY_PAGE_BYTES, budget.remaining);
    if (Number.isFinite(declared) && declared > limit) {
      try { await response.body?.cancel(); } catch (_) {}
      throw codexError('INVALID_FRAME');
    }
    if (!response.body?.getReader) throw codexError('INVALID_FRAME');
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw codexError('INVALID_FRAME');
        parts.push(Buffer.from(value));
      }
      budget.remaining -= size;
      return JSON.parse(decoder.decode(Buffer.concat(parts, size)));
    } catch (error) {
      try { await reader.cancel(); } catch (_) {}
      throw codexError(error?.code === 'INVALID_FRAME' ? error.code : 'INVALID_FRAME');
    } finally { reader.releaseLock(); }
  }

  async function fetchAccountHistory(identity, version, controller, flight) {
    if (identity?.authenticated !== true || typeof fetch !== 'function'
      || (identity.backendOrigin !== null && identity.backendOrigin !== 'https://chatgpt.com')) throw codexError('UNSUPPORTED');
    const current = () => { ensureOpen(); if (version !== accountVersion || controller.signal.aborted) throw codexError('CLOSED'); };
    let auth = null;
    const discardAuth = () => { auth = null; };
    controller.signal.addEventListener('abort', discardAuth, { once: true });
    const events = [], ids = new Set(), cursors = new Set();
    const budget = { remaining: HISTORY_TOTAL_BYTES };
    let cursor = null, partial = false;
    try {
      auth = await request('getAuthStatus', { includeToken: true, refreshToken: false },
        raw => projectHistoryAuth(raw, identity), Math.min(5000, historyTimeoutMs));
      current();
      flight.accountId = auth.accountId;
      // Re-check the existing identity around HTTP, including older CLI accounts
      // whose account/read response has no workspaceRouting or token email claim.
      await request('account/read', { refreshToken: false }, rememberAccount, Math.min(5000, historyTimeoutMs));
      current();
      if (historyCache?.version === version && historyCache.accountId === auth.accountId
        && now() - historyCache.at < HISTORY_CACHE_MS) return accountResetHistoryDetails(historyCache.value);
      for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
        const url = new URL(RESET_HISTORY_URL);
        if (cursor) url.searchParams.set('cursor', cursor);
        const headers = { Authorization: `Bearer ${auth.token}`, 'ChatGPT-Account-Id': auth.accountId };
        if (identity.routingOverride && identity.routingOverride !== 'NO_CONSTRAINT') headers['X-OpenAI-Account-Routing-Override'] = identity.routingOverride;
        const response = await fetch(url.href, { method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: controller.signal });
        current();
        if (response.redirected || (response.url && new URL(response.url).origin !== 'https://chatgpt.com')) throw codexError('UNSUPPORTED');
        if (!response.ok) {
          try { await response.body?.cancel(); } catch (_) {}
          throw codexError(response.status === 401 || response.status === 403 ? 'UNAUTHENTICATED'
            : response.status === 404 ? 'UNSUPPORTED' : response.status === 429 ? 'BUSY' : 'DISCONNECTED');
        }
        const value = normalizeResetHistoryPage(await readHistoryBody(response, budget));
        current();
        if (!value) throw codexError('INVALID_FRAME');
        partial ||= value.partial;
        for (const event of value.events) {
          if (ids.has(event.id)) continue;
          if (events.length >= MAX_RESET_HISTORY_EVENTS) { partial = true; break; }
          ids.add(event.id); events.push(event);
        }
        if (!value.nextCursor) {
          await request('account/read', { refreshToken: false }, rememberAccount, Math.min(5000, historyTimeoutMs));
          current();
          return accountResetHistoryDetails({ state: partial ? 'partial' : 'ready', events, updatedAt: now() });
        }
        if (events.length >= MAX_RESET_HISTORY_EVENTS || cursors.has(value.nextCursor) || page === HISTORY_MAX_PAGES - 1 || budget.remaining <= 0) break;
        cursors.add(value.nextCursor); cursor = value.nextCursor;
      }
      await request('account/read', { refreshToken: false }, rememberAccount, Math.min(5000, historyTimeoutMs));
      current();
      return accountResetHistoryDetails({ state: 'partial', events, updatedAt: now() });
    } catch (error) {
      current();
      if (events.length) return accountResetHistoryDetails({ state: 'partial', events, updatedAt: now(), code: error?.code || 'DISCONNECTED' });
      throw error;
    } finally { auth = null; controller.signal.removeEventListener('abort', discardAuth); }
  }

  async function readAccountHistory() {
    ensureOpen();
    const version = accountVersion;
    if (historyFlight?.version === version) return historyFlight.promise;
    const controller = new AbortController(); historyControllers.add(controller);
    const previous = historyCache?.version === version ? historyCache : null;
    let timer, timedOut = false;
    const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(codexError(timedOut ? 'TIMEOUT' : 'CLOSED')), { once: true }));
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, Math.min(5000, historyTimeoutMs)));
    const flight = { version, accountId: null, promise: null };
    flight.promise = Promise.race([fetchAccountHistory(accountIdentity, version, controller, flight), cancelled]).catch(error =>
      accountResetHistoryDetails({ state: error?.code === 'UNSUPPORTED' || error?.code === 'UNAUTHENTICATED' ? 'unavailable' : 'error',
        events: flight.accountId && flight.accountId === previous?.accountId ? previous.value.events : [],
        updatedAt: flight.accountId && flight.accountId === previous?.accountId ? previous.value.updatedAt : null, code: error?.code || 'DISCONNECTED' }))
      .then(value => {
        ensureOpen();
        if (version !== accountVersion) throw codexError('DISCONNECTED');
        const cacheAt = previous && value.updatedAt === previous.value.updatedAt && value.state === previous.value.state ? previous.at : now();
        historyCache = { version, accountId: flight.accountId, at: cacheAt, value };
        return accountResetHistoryDetails(value);
      }).finally(() => { clearTimeout(timer); controller.abort(); historyControllers.delete(controller); if (historyFlight === flight) historyFlight = null; });
    historyFlight = flight;
    return flight.promise;
  }

  async function readQuota(at = now()) {
    const version = accountVersion;
    const quota = await request('account/rateLimits/read', {}, raw => normalizeQuota(raw, at));
    if (version !== accountVersion) throw codexError('DISCONNECTED');
    const sameCycle = localHistoryCycle?.version === version && localHistoryCycle.windows.length === quota.windows.length
      && quota.windows.every(window => localHistoryCycle.windows.some(previous => previous.id === window.id
        && previous.windowMinutes === window.windowMinutes && Math.abs(previous.resetsAt - window.resetsAt) <= 1000));
    let local = Promise.resolve([]);
    if (accountIdentity?.authenticated === true && accountIdentity.accountId && !sameCycle) {
      localHistoryCycle = { version, windows: quota.windows };
      const identity = accountIdentity;
      local = Promise.resolve().then(() => readUsageHistory({ accountId: identity.accountId, windows: quota.windows,
        root: path.join(homedir(), '.codex'), now: at, io: fs.promises })).catch(() => []);
    }
    const [accountResetHistory, historySamples] = await Promise.all([readAccountHistory(), local]);
    ensureOpen();
    if (version !== accountVersion) throw codexError('DISCONNECTED');
    return { ...quota, accountResetHistory, ...(Array.isArray(historySamples) && historySamples.length
      ? { historySamples: historySamples.slice(-12000) } : {}) };
  }

  return {
    start,
    readAccount: () => request('account/read', { refreshToken: false }, rememberAccount),
    readQuota,
    listThreads: () => request('thread/list', { limit: 20, ...THREAD_LIST_PARAMS }, projectThreads),
    findThread,
    close: () => shutdown()
  };
}

module.exports = { createCodexRpc, codexError, ERROR_CODES, MAX_FRAME_BYTES };
