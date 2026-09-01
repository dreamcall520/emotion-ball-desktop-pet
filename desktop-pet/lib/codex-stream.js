const nodeFs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { codexError } = require('./codex-rpc');
const { createFrameParser } = require('./codex-frame');
const { MAX_TASKS, isTaskId, isEligibleThread, projectTask, taskFromProjection, applyTaskPatches } = require('./codex-state');
const MAX_TRACKED_TASKS = 64;
const DISCOVERED_RETENTION_MS = 90000;
const IDLE_RETENTION_MS = 15000;

function encodeFrame(packet) {
  const data = Buffer.from(JSON.stringify(packet));
  const header = Buffer.alloc(4); header.writeUInt32LE(data.length);
  return Buffer.concat([header, data]);
}

function createCodexStream({ onTask = () => {}, onStatus = () => {}, onDiscovered = () => {},
  fs = nodeFs, connect = options => net.createConnection(options), homedir = os.homedir,
  getuid = () => process.getuid(), now = Date.now, timeoutMs = 10000 } = {}) {
  const timeout = Math.max(1, Math.min(15000, timeoutMs));
  const records = new Map();
  // Keep excluded IDs across metadata refresh/removal, but never an unbounded history.
  const oversizedIds = new Set();
  let socket = null;
  let parser = null;
  let closed = false;
  let ready = false;
  let clientId = 'emotion-ball-readonly';
  let requestId = null;
  let starting = null;
  let resolveStart = null;
  let rejectStart = null;
  let startTimer = null;
  let snapshotTimer = null;
  let lastDiscovery = -Infinity;
  let lastStatus = null;

  function status(state, code = null) {
    const key = `${state}:${code}`;
    if (key === lastStatus || closed) return;
    lastStatus = key; onStatus({ state, code, partial: true });
  }
  function write(packet) {
    if (closed || !socket?.writable) return;
    try { socket.write(encodeFrame(packet)); } catch { fail('DISCONNECTED'); }
  }
  function followingPacket(record, following) {
    return { type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: clientId,
      params: { conversationId: record.metadata.id, hostId: 'local', following } };
  }
  function follow(record, following) {
    if (ready) write(followingPacket(record, following));
  }
  function publishUnknown(record, removed = false) {
    onTask({ ...record.metadata, state: 'unknown', turnId: null, updatedAt: now(), partial: true, baseline: true,
      ...(record.unavailable ? { unavailable: record.unavailable } : {}), ...(removed ? { removed: true } : {}) });
    record.task = null; record.revision = null; record.baseline = true;
    reportAvailability();
  }
  function removeRecord(record) {
    clearTimeout(record.timer); publishUnknown(record, true); follow(record, false); records.delete(record.metadata.id);
  }
  function canRetain(record) {
    return record.sticky === true && (record.retainUntil === Infinity || now() < record.retainUntil);
  }
  function metadata(row) {
    return { id: row.id, title: typeof row.title === 'string' && row.title.trim()
      ? row.title.trim().slice(0, 200) : '未命名任务' };
  }
  function addRecord(row, sticky = false) {
    if (!isEligibleThread(row)) return null;
    let record = records.get(row.id);
    if (record) {
      record.metadata = metadata(row);
      if (sticky) {
        record.sticky = true;
        record.retainUntil = Math.max(record.retainUntil || 0, now() + DISCOVERED_RETENTION_MS);
      }
      if (!record.task) requestSnapshot(record);
      return record;
    }
    if (records.size >= MAX_TRACKED_TASKS) {
      const expired = [...records.values()].find(value => !canRetain(value));
      if (!expired) return null;
      removeRecord(expired);
    }
    record = { metadata: metadata(row), task: null, revision: null, owner: null, baseline: true, timer: null,
      lastFollow: -Infinity, unavailable: oversizedIds.has(row.id) ? 'STATE_TOO_LARGE' : null,
      sticky, retainUntil: sticky ? now() + DISCOVERED_RETENTION_MS : 0 };
    records.set(row.id, record); publishUnknown(record); requestSnapshot(record);
    return record;
  }
  function cleanup(code = 'CLOSED') {
    if (closed) return;
    const wasReady = ready;
    closed = true; ready = false;
    for (const record of records.values()) {
      clearTimeout(record.timer);
      try { if (wasReady && socket?.writable) socket.write(encodeFrame(followingPacket(record, false))); }
      catch { /* Unfollowing is best effort; teardown must not recursively report a broken socket. */ }
    }
    records.clear(); oversizedIds.clear();
    clearTimeout(startTimer); clearTimeout(snapshotTimer); startTimer = null; snapshotTimer = null;
    rejectStart?.(codexError(code)); rejectStart = null; resolveStart = null;
    parser?.close(); parser = null;
    if (socket) {
      socket.removeListener('data', onData); socket.removeListener('error', onSocketFailure);
      socket.removeListener('close', onSocketFailure); socket.removeListener('end', onSocketFailure);
      socket.removeListener('connect', onConnect); socket.destroy(); socket = null;
    }
  }
  function fail(code) {
    if (closed) return;
    for (const record of records.values()) publishUnknown(record);
    const state = code === 'MISSING' ? 'missing' : ['UNSUPPORTED', 'UNSAFE_SOCKET', 'STATE_TOO_LARGE'].includes(code) ? 'unsupported' : 'disconnected';
    status(state, code); cleanup(code);
  }
  function onSocketFailure() { fail('DISCONNECTED'); }
  function onData(data) { parser?.push(data); }

  function requestSnapshot(record) {
    if (closed || !ready || record.unavailable) return;
    const remaining = 5000 - (now() - record.lastFollow);
    if (remaining > 0) {
      if (!record.timer) record.timer = setTimeout(() => { record.timer = null; requestSnapshot(record); }, Math.min(5000, remaining));
      return;
    }
    clearTimeout(record.timer); record.timer = null; record.lastFollow = now();
    follow(record, true);
  }

  function reportAvailability() {
    if (!ready) return;
    const current = [...records.values()];
    const partial = current.some(record => record.unavailable);
    if (current.some(record => record.task)) status('connected', partial ? 'PARTIAL_STATE' : null);
    else if (partial) status('unsupported', 'STATE_TOO_LARGE');
    else status('connecting');
  }
  function receiveOversized(envelope) {
    if (closed || !ready || !records.has(envelope.conversationId)) return false;
    if ((envelope.targetClientIds && !envelope.targetClientIds.includes(clientId)) ||
      (envelope.paramTargetClientIds && !envelope.paramTargetClientIds.includes(clientId))) return true;
    const record = records.get(envelope.conversationId);
    if (record.unavailable) return true;
    if (oversizedIds.size >= MAX_TASKS) { fail('STATE_TOO_LARGE'); return true; }
    oversizedIds.add(envelope.conversationId);
    record.unavailable = 'STATE_TOO_LARGE'; record.owner = envelope.sourceClientId;
    clearTimeout(record.timer); record.timer = null;
    clearTimeout(snapshotTimer); snapshotTimer = null;
    publishUnknown(record); follow(record, false); reportAvailability();
    return true;
  }

  function receiveState(packet) {
    const params = packet.params;
    if (params?.hostId !== 'local' || !records.has(params.conversationId)) return;
    const record = records.get(params.conversationId);
    if (record.unavailable) return;
    if (packet.version !== 11) { fail('UNSUPPORTED'); return; }
    if (!isTaskId(packet.sourceClientId)) { publishUnknown(record); requestSnapshot(record); return; }
    if (record.owner && record.owner !== packet.sourceClientId) {
      record.owner = packet.sourceClientId; publishUnknown(record); requestSnapshot(record); return;
    }
    const change = params.change;
    if (!Number.isSafeInteger(change?.revision) || change.revision < 0) { publishUnknown(record); requestSnapshot(record); return; }
    if (change.type === 'snapshot') {
      const raw = change.conversationState;
      if (!raw || raw.id !== record.metadata.id || !isEligibleThread(raw)) {
        publishUnknown(record, true); clearTimeout(record.timer); follow(record, false); records.delete(record.metadata.id); return;
      }
      if (record.revision !== null && change.revision < record.revision) return;
      record.owner = packet.sourceClientId;
      record.task = projectTask(raw);
      if (record.task.title === '未命名任务') record.task.title = record.metadata.title;
    } else if (change.type === 'patches') {
      if (!record.task || change.baseRevision !== record.revision || change.revision <= change.baseRevision) {
        publishUnknown(record); requestSnapshot(record); return;
      }
      const projected = applyTaskPatches(record.task, change.patches);
      if (projected.needsSnapshot) { publishUnknown(record); requestSnapshot(record); return; }
      record.task = projected.task;
    } else { publishUnknown(record); requestSnapshot(record); return; }
    record.revision = change.revision;
    clearTimeout(snapshotTimer); snapshotTimer = null;
    const task = taskFromProjection(record.task, now());
    if (task.state === 'active' || task.state === 'waiting') { record.sticky = true; record.retainUntil = Infinity; }
    else if (['completed', 'failed', 'interrupted'].includes(task.state) && record.sticky) {
      record.retainUntil = now() + DISCOVERED_RETENTION_MS;
    } else if (task.state === 'idle' && record.sticky) record.retainUntil = now() + IDLE_RETENTION_MS;
    onTask({ ...task, baseline: record.baseline }); record.baseline = false;
    reportAvailability();
  }

  function receive(packet) {
    if (closed) return;
    if (packet.type === 'client-discovery-request') {
      if (typeof packet.requestId === 'string' && packet.requestId.length <= 200) {
        write({ type: 'client-discovery-response', requestId: packet.requestId, response: { canHandle: false } });
      }
      return;
    }
    if (packet.type === 'response' && packet.requestId === requestId) {
      if (ready) return;
      if (packet.resultType !== 'success' || packet.method !== 'initialize' || !isTaskId(packet.result?.clientId)) { fail('UNSUPPORTED'); return; }
      clientId = packet.result.clientId; ready = true; requestId = null;
      clearTimeout(startTimer); startTimer = null;
      snapshotTimer = setTimeout(() => fail('TIMEOUT'), timeout);
      for (const record of records.values()) requestSnapshot(record);
      resolveStart?.(); resolveStart = null; rejectStart = null;
      return;
    }
    if (packet.type !== 'broadcast' || !ready) return;
    if (packet.targetClientIds != null && (!Array.isArray(packet.targetClientIds) || !packet.targetClientIds.includes(clientId))) return;
    const params = packet.params;
    if (params?.targetClientIds != null && (!Array.isArray(params.targetClientIds) || !params.targetClientIds.includes(clientId))) return;
    if (packet.method === 'thread-stream-state-changed') { receiveState(packet); return; }
    if (packet.method === 'ipc-connection-reset' && packet.version === 1) { fail('DISCONNECTED'); return; }
    if (packet.method === 'client-status-changed' && packet.version === 0 && params?.status === 'disconnected') {
      if ([...records.values()].some(record => record.owner === params.clientId)) fail('DISCONNECTED');
      return;
    }
    if (packet.version !== 1 || params?.hostId !== 'local' || !isTaskId(params.conversationId)) return;
    if (packet.method === 'thread-stream-following-status-requested') {
      const record = records.get(params.conversationId); if (record) requestSnapshot(record);
    } else if (packet.method === 'thread-stream-following-changed' && params.following === true && !records.has(params.conversationId)) {
      if (now() - lastDiscovery >= 5000) { lastDiscovery = now(); onDiscovered(params.conversationId); }
    }
  }

  function onConnect() {
    if (closed) return;
    requestId = randomUUID();
    write({ type: 'request', method: 'initialize', version: 0, sourceClientId: clientId, requestId,
      params: { clientType: 'emotion-ball-desktop-pet' } });
  }
  async function socketPath() {
    const base = path.join(homedir(), '.codex');
    const directory = path.join(base, 'ipc');
    const endpoint = path.join(directory, 'ipc.sock');
    const uid = getuid();
    for (const file of [base, directory, endpoint]) {
      const stat = await fs.promises.lstat(file);
      if (closed) throw codexError('CLOSED');
      if (stat.uid !== uid || (stat.mode & 0o022) !== 0 || stat.isSymbolicLink() ||
        (file === endpoint ? !stat.isSocket() : !stat.isDirectory())) throw codexError('UNSAFE_SOCKET');
    }
    return endpoint;
  }
  function start() {
    if (closed) return Promise.reject(codexError('CLOSED'));
    if (starting) return starting;
    status('connecting');
    starting = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    startTimer = setTimeout(() => fail('TIMEOUT'), timeout);
    socketPath().then(endpoint => {
      if (closed) return;
      parser = createFrameParser({ onMessage: receive, onError: fail, onOversized: receiveOversized });
      socket = connect({ path: endpoint });
      socket.on('connect', onConnect); socket.on('data', onData);
      socket.on('error', onSocketFailure); socket.on('close', onSocketFailure); socket.on('end', onSocketFailure);
    }).catch(error => { if (!closed) fail(error.code === 'ENOENT' ? 'MISSING' : error.code === 'UNSAFE_SOCKET' ? 'UNSAFE_SOCKET' : 'DISCONNECTED'); });
    return starting;
  }
  function setThreads(rows) {
    if (closed) return;
    const selected = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (selected.size >= MAX_TASKS) break;
      if (!isEligibleThread(row)) continue;
      selected.set(row.id, metadata(row));
    }
    for (const [id, record] of records) {
      if (!selected.has(id) && (selected.size === 0 || !canRetain(record))) removeRecord(record);
    }
    for (const [id, metadata] of selected) {
      let record = records.get(id);
      if (!record) record = addRecord(metadata);
      else record.metadata = metadata;
      if (record && !record.task) requestSnapshot(record);
    }
    reportAvailability();
  }
  function addThread(row) {
    if (closed) return false;
    const record = addRecord(row, true);
    reportAvailability();
    return Boolean(record);
  }
  return { start, setThreads, addThread, refresh() { for (const record of records.values()) requestSnapshot(record); }, close: () => cleanup() };
}

module.exports = { createCodexStream, createFrameParser };
