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
  let rpcGeneration = 0;
  let rpcStarting = null;
  let stream = null;
  let streamGeneration = 0;
  let accountGeneration = 0;
  let accountKey;
  let authenticated = null;
  let accountSupported = true;
  let starting = null;
  let streamStarting = null;
  let quotaFlight = null;
  let tasksFlight = null;
  let taskRetryFlight = null;
  let hasMetadata = false;
  const discoveryFlights = new Map();
  const pendingDiscoveries = new Set();
  let discoveryQueue = Promise.resolve();
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
  function beginRpc() {
    if (rpcStarting) return rpcStarting;
    const generation = ++rpcGeneration;
    rpcReady = false; rpc?.close(); report('quota', 'connecting');
    const target = createRpc({ onDisconnect: code => {
      if (!closed && generation === rpcGeneration) { rpcReady = false; reportError('quota', { code }); }
    } });
    rpc = target;
    const opening = Promise.resolve().then(() => {
      if (!closed && generation === rpcGeneration) return target.start();
    }).then(() => {
      if (!closed && generation === rpcGeneration) { rpcReady = true; drainDiscoveries(); }
    }).finally(() => { if (rpcStarting === opening) rpcStarting = null; });
    rpcStarting = opening;
    return opening;
  }
  function beginStream() {
    if (closed || authenticated === false || !accountSupported) return Promise.resolve();
    const generation = ++streamGeneration;
    stream?.close(); hasMetadata = false; pendingDiscoveries.clear();
    report('tasks', 'connecting');
    const target = createStream({
      onTask: task => { if (!closed && generation === streamGeneration) onTask(task); },
      onStatus: value => { if (!closed && generation === streamGeneration) report('tasks', value.state, value.code); },
      onDiscovered: id => { if (!closed && generation === streamGeneration) queueDiscovery(id); }
    });
    stream = target;
    streamStarting = Promise.resolve().then(() => {
      if (!closed && generation === streamGeneration) return target.start();
    }).catch(error => { if (!closed && generation === streamGeneration) reportError('tasks', error); });
    return streamStarting;
  }
  function queueDiscovery(id) {
    if (closed || authenticated === false || !accountSupported) return;
    if (!rpcReady || authenticated !== true) {
      if (pendingDiscoveries.size < 64) pendingDiscoveries.add(id);
      return;
    }
    void discoverTask(id);
  }
  function drainDiscoveries() {
    if (closed || !rpcReady || authenticated !== true || !accountSupported) return;
    const ids = [...pendingDiscoveries]; pendingDiscoveries.clear();
    for (const id of ids) queueDiscovery(id);
  }
  function discoverTask(id) {
    if (closed || !rpcReady || authenticated === false || !accountSupported || discoveryFlights.has(id)) {
      return discoveryFlights.get(id) || Promise.resolve();
    }
    const account = accountGeneration; const rpcEpoch = rpcGeneration; const streamEpoch = streamGeneration;
    const targetRpc = rpc; const targetStream = stream;
    const current = () => !closed && rpcReady && account === accountGeneration && rpcEpoch === rpcGeneration
      && streamEpoch === streamGeneration && targetRpc === rpc && targetStream === stream;
    const lookup = discoveryQueue.then(async () => {
      if (!current()) return;
      const row = await targetRpc.findThread(id);
      if (current() && row) targetStream?.addThread(row);
    }).catch(() => {
      // Discovery is opportunistic metadata validation. A failed lookup must not
      // downgrade an otherwise healthy live task channel.
    }).finally(() => { if (discoveryFlights.get(id) === lookup) discoveryFlights.delete(id); });
    discoveryFlights.set(id, lookup);
    discoveryQueue = lookup.then(() => undefined, () => undefined);
    return lookup;
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
      stream?.close(); stream = null; hasMetadata = false; pendingDiscoveries.clear();
    }
    onAccount({ accountKey });
    if (!accountSupported) report('tasks', 'unsupported', 'UNSUPPORTED');
    else if (authenticated === false) report('tasks', 'unauthenticated', 'UNAUTHENTICATED');
    else if (hadIdentity) { void beginStream(); void refreshTasks(); }
    if (authenticated === true && accountSupported) drainDiscoveries();
  }
  function refreshQuota() {
    const generation = rpcGeneration;
    if (quotaFlight?.rpcGeneration === generation) return quotaFlight.promise;
    const target = rpc;
    const current = () => !closed && rpcReady && generation === rpcGeneration;
    const flight = { rpcGeneration: generation, account: null, promise: null };
    flight.account = Promise.resolve().then(() => {
      if (current()) return target.readAccount();
    }).then(value => {
      if (!current() || !value) return false;
      acceptAccount(value);
      if (!accountSupported) { report('quota', 'unsupported', 'UNSUPPORTED'); return false; }
      if (!value.authenticated) { report('quota', 'unauthenticated', 'UNAUTHENTICATED'); return false; }
      return true;
    }).catch(error => { if (current()) reportError('quota', error); return false; });
    flight.promise = flight.account.then(async success => {
      if (!success || !current()) return;
      const account = accountGeneration;
      const quota = await target.readQuota(now());
      if (!current() || account !== accountGeneration) return;
      onQuota(quota); report('quota', 'connected');
    }).catch(error => { if (current()) reportError('quota', error); })
      .finally(() => { if (quotaFlight === flight) quotaFlight = null; });
    quotaFlight = flight;
    return flight.promise;
  }
  function refreshTasks() {
    const generation = accountGeneration;
    const rpcEpoch = rpcGeneration; const streamEpoch = streamGeneration;
    if (tasksFlight?.generation === generation && tasksFlight.rpcEpoch === rpcEpoch && tasksFlight.streamEpoch === streamEpoch) return tasksFlight.promise;
    if (closed || !rpcReady || authenticated === false || !accountSupported) return Promise.resolve();
    const targetRpc = rpc; const targetStream = stream;
    const current = () => !closed && rpcReady && generation === accountGeneration && rpcEpoch === rpcGeneration && streamEpoch === streamGeneration;
    const flight = { generation, rpcEpoch, streamEpoch, promise: null };
    flight.promise = Promise.resolve().then(() => {
      if (current()) return targetRpc.listThreads();
    }).then(rows => {
      if (!current() || !rows) return;
      hasMetadata = true;
      targetStream?.setThreads(rows);
    }).catch(error => {
      // A metadata refresh failure does not invalidate an already working live stream.
      if (current() && !hasMetadata) reportError('tasks', error);
    }).finally(() => { if (tasksFlight === flight) tasksFlight = null; });
    tasksFlight = flight;
    return flight.promise;
  }
  function refresh({ quota = true, tasks = true } = {}) {
    if (!started || closed || !rpcReady) return Promise.resolve();
    const work = [];
    if (quota) work.push(refreshQuota());
    const account = quotaFlight?.rpcGeneration === rpcGeneration ? quotaFlight.account : null;
    if (tasks) work.push((account || Promise.resolve()).then(refreshTasks));
    return Promise.all(work).then(() => undefined);
  }
  function start() {
    if (closed) return Promise.resolve();
    if (starting) return starting;
    started = true;
    const opening = beginRpc(); const generation = rpcGeneration;
    const taskStart = beginStream();
    const quotaStart = opening.then(() => {
      if (closed || generation !== rpcGeneration) return;
      return refresh();
    }).catch(error => {
      if (closed || generation !== rpcGeneration) return;
      reportError('quota', error);
      if (!hasMetadata) { reportError('tasks', error); streamGeneration++; stream?.close(); stream = null; }
    });
    starting = Promise.all([taskStart, quotaStart]).then(() => undefined);
    return starting;
  }
  function retryTasks() {
    if (!accountSupported) { report('tasks', 'unsupported', 'UNSUPPORTED'); return Promise.resolve(); }
    if (authenticated === false) { report('tasks', 'unauthenticated', 'UNAUTHENTICATED'); return Promise.resolve(); }
    if (!rpcReady) {
      streamGeneration++; stream?.close(); stream = null; hasMetadata = false;
      report('tasks', 'disconnected', 'DISCONNECTED'); return Promise.resolve();
    }
    if (taskRetryFlight?.generation === streamGeneration) return taskRetryFlight.promise;
    const opening = beginStream();
    const flight = { generation: streamGeneration, promise: null };
    flight.promise = Promise.all([opening, refreshTasks()]).then(() => undefined)
      .finally(() => { if (taskRetryFlight === flight) taskRetryFlight = null; });
    taskRetryFlight = flight;
    return flight.promise;
  }
  async function retry({ quota = true, tasks = true } = {}) {
    if (!started || closed) return;
    const previousStream = streamGeneration;
    if (quota) {
      try {
        if (!rpcReady) await beginRpc();
        if (!closed && rpcReady) await refreshQuota();
      } catch (error) { reportError('quota', error); }
    }
    if (closed || !tasks) return;
    // Reuse a stream rebuilt by an account switch or another retry, but not a cleared one.
    if (quota && streamGeneration !== previousStream && stream) {
      await Promise.all([streamStarting, refreshTasks()]);
    } else await retryTasks();
  }
  function close() {
    if (closed) return;
    closed = true; accountGeneration++; streamGeneration++; rpcGeneration++;
    rpcReady = false; accountKey = undefined; authenticated = null; accountSupported = true; hasMetadata = false;
    stream?.close(); rpc?.close(); stream = null; rpc = null; discoveryFlights.clear(); pendingDiscoveries.clear(); lastStatus.clear();
  }
  return { start, refresh, retry, close };
}

module.exports = { createCodexConnection, CONNECTION_STATES, ERROR_CODES };
