const { createCodexRpc, ERROR_CODES } = require('./codex-rpc');
const { createCodexStream } = require('./codex-stream');

const CONNECTION_STATES = Object.freeze(['connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected']);

// Construction deliberately does not instantiate transports, inspect the installation,
// resolve the home directory, read accounts, or connect to any endpoint.
function createCodexConnection({ onQuota = () => {}, onTask = () => {}, onStatus = () => {}, onAccount = () => {},
  createRpc = createCodexRpc, createStream = createCodexStream, now = Date.now } = {}) {
  let started = false;
  let closed = false;
  let rpc = null;
  let rpcReady = false;
  let stream = null;
  let streamGeneration = 0;
  let accountGeneration = 0;
  let accountKey;
  let authenticated = null;
  let accountSupported = true;
  let starting = null;
  let streamStarting = null;
  let accountFlight = null;
  let quotaFlight = null;
  let tasksFlight = null;
  let hasMetadata = false;
  const lastStatus = new Map();

  function report(channel, state, code = null) {
    if (closed) return;
    const safeState = CONNECTION_STATES.includes(state) ? state : 'disconnected';
    const safeCode = code === null ? null : ERROR_CODES.includes(code) ? code : 'DISCONNECTED';
    const key = `${safeState}:${safeCode}`;
    if (lastStatus.get(channel) === key) return;
    lastStatus.set(channel, key);
    onStatus({ channel, state: safeState, code: safeCode, ...(channel === 'tasks' ? { partial: true } : {}) });
  }
  function reportError(channel, error) {
    const code = ERROR_CODES.includes(error?.code) ? error.code : 'DISCONNECTED';
    const state = code === 'MISSING' ? 'missing' : code === 'UNAUTHENTICATED' ? 'unauthenticated'
      : ['UNSUPPORTED', 'UNSAFE_SOCKET', 'INVALID_FRAME'].includes(code) ? 'unsupported' : 'disconnected';
    report(channel, state, code);
  }
  function beginStream() {
    if (closed || authenticated === false || !accountSupported) return Promise.resolve();
    const generation = ++streamGeneration;
    report('tasks', 'connecting');
    stream = createStream({
      onTask: task => { if (!closed && generation === streamGeneration) onTask(task); },
      onStatus: value => { if (!closed && generation === streamGeneration) report('tasks', value.state, value.code); },
      onDiscovered: () => { if (!closed && generation === streamGeneration) void refresh({ quota: false, tasks: true }); }
    });
    streamStarting = Promise.resolve().then(() => {
      if (!closed && generation === streamGeneration) return stream.start();
    }).catch(error => { if (!closed && generation === streamGeneration) reportError('tasks', error); });
    return streamStarting;
  }
  function acceptAccount(value) {
    if (closed) return;
    const supported = value.supported !== false;
    const unchanged = value.accountKey === accountKey && value.authenticated === authenticated && supported === accountSupported;
    authenticated = value.authenticated;
    accountSupported = supported;
    if (unchanged) return;
    const hadIdentity = accountKey !== undefined;
    accountKey = value.accountKey;
    accountGeneration++;
    if (hadIdentity || authenticated === false || !accountSupported) {
      streamGeneration++;
      stream?.close(); stream = null; hasMetadata = false;
    }
    onAccount({ accountKey });
    if (!accountSupported) report('tasks', 'unsupported', 'UNSUPPORTED');
    else if (authenticated === false) report('tasks', 'unauthenticated', 'UNAUTHENTICATED');
    else if (hadIdentity) void beginStream();
  }
  function refreshQuota() {
    if (quotaFlight) return quotaFlight;
    accountFlight = Promise.resolve().then(() => {
      if (!closed) return rpc.readAccount();
    }).then(value => {
      if (closed || !value) return false;
      acceptAccount(value);
      if (!accountSupported) { report('quota', 'unsupported', 'UNSUPPORTED'); return false; }
      if (!value.authenticated) { report('quota', 'unauthenticated', 'UNAUTHENTICATED'); return false; }
      return true;
    }).catch(error => { reportError('quota', error); return false; });
    quotaFlight = accountFlight.then(async success => {
      if (!success || closed) return;
      const generation = accountGeneration;
      const quota = await rpc.readQuota(now());
      if (closed || generation !== accountGeneration) return;
      onQuota(quota); report('quota', 'connected');
    }).catch(error => reportError('quota', error)).finally(() => { quotaFlight = null; accountFlight = null; });
    return quotaFlight;
  }
  function refreshTasks() {
    if (tasksFlight) return tasksFlight;
    if (closed || authenticated === false || !accountSupported) return Promise.resolve();
    const generation = accountGeneration;
    tasksFlight = Promise.resolve().then(() => {
      if (!closed) return rpc.listThreads();
    }).then(rows => {
      if (closed || generation !== accountGeneration || !rows) return;
      hasMetadata = true;
      stream?.setThreads(rows);
    }).catch(error => {
      // A metadata refresh failure does not invalidate an already working live stream.
      if (!hasMetadata) reportError('tasks', error);
    }).finally(() => { tasksFlight = null; });
    return tasksFlight;
  }
  function refresh({ quota = true, tasks = true } = {}) {
    if (!started || closed || !rpcReady) return Promise.resolve();
    const work = [];
    if (quota) work.push(refreshQuota());
    if (tasks) work.push((accountFlight || Promise.resolve()).then(refreshTasks));
    return Promise.all(work).then(() => undefined);
  }
  function start() {
    if (closed) return Promise.resolve();
    if (starting) return starting;
    started = true;
    report('quota', 'connecting');
    rpc = createRpc({ onDisconnect: code => { if (!closed) { rpcReady = false; reportError('quota', { code }); } } });
    const taskStart = beginStream();
    const quotaStart = Promise.resolve().then(() => {
      if (!closed) return rpc.start();
    }).then(() => {
      if (closed) return;
      rpcReady = true;
      return refresh();
    }).catch(error => {
      if (closed) return;
      reportError('quota', error);
      if (!hasMetadata) { reportError('tasks', error); streamGeneration++; stream?.close(); stream = null; }
    });
    starting = Promise.all([taskStart, quotaStart]).then(() => undefined);
    return starting;
  }
  function close() {
    if (closed) return;
    closed = true; accountGeneration++; streamGeneration++;
    rpcReady = false; accountKey = undefined; authenticated = null; accountSupported = true; hasMetadata = false;
    stream?.close(); rpc?.close(); stream = null; rpc = null; lastStatus.clear();
  }
  return { start, refresh, close };
}

module.exports = { createCodexConnection, CONNECTION_STATES, ERROR_CODES };
