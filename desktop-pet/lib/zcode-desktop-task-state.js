'use strict';
const { createHash } = require('node:crypto');
const { parseMetadata } = require('./zcode-desktop-event-bridge');
const WIRE = new Set(['version', 'sessionId', 'turnId', 'event', 'phase']);
const BRIDGE = new Set(['type', 'source', 'scope', 'correlated', 'terminalConfirmed', 'terminalKind',
  'overallTaskVerified', 'taskState', 'observedAt', 'observationId']);
const TERMINAL = Object.freeze({ completed: 'completed', error: 'failed', cancelled: 'interrupted' });
const SCOPE = 'authorized-device-observed-turns';
const validBinding = value => value && /^[a-f0-9]{64}$/.test(value.accountKey || '') && Number.isSafeInteger(value.epoch) && value.epoch >= 0;

// UserPromptSubmit proves that this turn was accepted. Stop runs before the
// continuation decision, so it only requests a database refresh. A terminal is
// accepted exclusively from turn_usage with the exact observed session + turn.
function createZcodeDesktopTaskState({ readTurnStatus = async () => null, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout, onChange = () => {}, onAlert = () => {}, onClear = () => {},
  inactivityMs = 120000, pollMs = 1000, maxWatchMs = 1800000 } = {}) {
  if (typeof readTurnStatus !== 'function' || !Number.isSafeInteger(inactivityMs) || inactivityMs < 20 || inactivityMs > 1800000 ||
    !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 60000 || !Number.isSafeInteger(maxWatchMs) || maxWatchMs < inactivityMs || maxWatchMs > 86400000) throw new TypeError('Invalid task observer options');
  let binding = null, closed = false, timer = null, revision = 0, alertId = 0, flight = null;
  const tasks = new Map(), tombstones = new Set();
  const clock = () => { const at = Number(now()); return Number.isFinite(at) && at >= 0 ? Math.trunc(at) : Date.now(); };
  const call = (fn, value) => { try { fn(value); } catch {} };
  const current = owner => Boolean(binding && validBinding(owner) && binding.accountKey === owner.accountKey && binding.epoch === owner.epoch);
  const pending = task => !task.terminalConfirmed && !tombstones.has(task.id);
  function getState() {
    const list = [...tasks.values()].sort((a, b) => b.revision - a.revision);
    const active = list.filter(task => task.state === 'processing');
    return structuredClone({ enabled: Boolean(binding) && !closed, accountKey: binding?.accountKey || null,
      epoch: binding?.epoch ?? null, generation: binding?.epoch ?? null, status: !binding || closed ? 'disabled' : active.length ? 'processing' : list.some(task => task.state === 'unknown') ? 'unknown' : 'idle',
      activeCount: active.length, observedActiveCount: active.length, runningCount: null,
      task: active[0] || list[0] || null, tasks: list, scope: SCOPE,
      accountAttributionVerified: false, overallTaskVerified: false });
  }
  const notify = () => call(onChange, getState());
  const clear = reason => call(onClear, { reason, accountKey: binding?.accountKey || null, epoch: binding?.epoch ?? null });
  function stopTimer() { if (timer !== null) cancel(timer); timer = null; }
  function tombstone(key) { tombstones.add(key); while (tombstones.size > 1024) tombstones.delete(tombstones.values().next().value); }
  function expire() {
    const at = clock(); let changed = false;
    for (const task of tasks.values()) {
      if (!pending(task)) continue;
      if (task.deadline <= at && task.state === 'processing') {
        Object.assign(task, { state: 'unknown', phase: 'inactivity', realtime: false, revision: ++revision }); changed = true;
      }
      if (task.watchUntil <= at) tombstone(task.id);
    }
    if (changed) { notify(); if (!getState().activeCount) clear('inactivity'); }
  }
  function arm() {
    stopTimer(); if (closed || !binding) return;
    const at = clock(), watching = [...tasks.values()].filter(task => pending(task) && task.watchUntil > at);
    if (!watching.length) return;
    const owner = { ...binding }, deadlines = watching.flatMap(task => [task.watchUntil, ...(task.state === 'processing' ? [task.deadline] : [])]);
    timer = schedule(() => { timer = null; if (!closed && current(owner)) void refresh(); }, Math.max(1, Math.min(pollMs, Math.min(...deadlines) - at)));
    timer?.unref?.();
  }
  function emit(kind, task, owner) {
    if (closed || !current(owner)) return;
    call(onAlert, { id: ++alertId, kind, taskId: task.id, sessionId: task.sessionId, turnId: task.turnId,
      accountKey: owner.accountKey, epoch: owner.epoch, generation: owner.epoch, observedAt: clock(),
      terminal: task.terminalConfirmed, terminalKind: task.terminalConfirmed ? 'main-reply' : null,
      source: task.terminalConfirmed ? 'zcode-authorized-turn-usage' : 'zcode-desktop-hook',
      scope: SCOPE, accountAttributionVerified: false, overallTaskVerified: false });
  }
  function reset() { stopTimer(); binding = null; tasks.clear(); tombstones.clear(); clear('reset'); notify(); }
  function bind(owner) {
    if (closed) return false;
    if (!validBinding(owner)) { reset(); return false; }
    if (current(owner)) return true;
    reset(); binding = { accountKey: owner.accountKey, epoch: owner.epoch }; notify(); return true;
  }
  function accept(raw, owner) {
    if (closed || !current(owner) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    let metadata;
    try {
      if (Object.keys(raw).some(key => !WIRE.has(key) && !BRIDGE.has(key))) return false;
      metadata = parseMetadata(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([key]) => WIRE.has(key))))));
    } catch { return false; }
    if (!metadata.turnId || !['UserPromptSubmit', 'Stop'].includes(metadata.event)) return false;
    const id = createHash('sha256').update(metadata.sessionId + '\0' + metadata.turnId).digest('hex').slice(0, 32);
    if (tombstones.has(id)) return false;
    const prior = tasks.get(id), at = clock();
    if (metadata.event === 'UserPromptSubmit') {
      if (prior) return false;
      for (const task of tasks.values()) if (task.sessionId === metadata.sessionId && pending(task)) {
        Object.assign(task, { state: 'unknown', phase: 'superseded', realtime: false, revision: ++revision }); tombstone(task.id);
      }
      const task = { id, sessionId: metadata.sessionId, turnId: metadata.turnId, state: 'processing', phase: 'submitted',
        startedAt: at, lastEventAt: at, deadline: at + inactivityMs, watchUntil: at + maxWatchMs, revision: ++revision,
        running: null, realtime: true, liveVerified: false, terminalConfirmed: false, terminalKind: null,
        evidence: 'observed-user-prompt-hook', scope: SCOPE, accountAttributionVerified: false, overallTaskVerified: false };
      tasks.set(id, task); notify(); emit('processing', task, owner);
      while (tasks.size > 128) { const first = tasks.keys().next().value; tombstone(first); tasks.delete(first); }
    } else {
      if (!prior || !pending(prior)) return false;
      // No completion or success is inferred from Stop, including repeated Stop
      // callbacks in a continuation. A new stage only extends the activity lease.
      Object.assign(prior, { phase: 'stop-observed', lastEventAt: at, deadline: at + inactivityMs, revision: ++revision }); notify();
    }
    void refresh(); return current(owner);
  }
  function refresh() {
    if (closed || !binding) return Promise.resolve(getState());
    const owner = { ...binding };
    if (flight && current(flight.owner)) return flight.promise;
    expire();
    const run = { owner };
    run.promise = (async () => {
      const watching = [...tasks.values()].filter(pending);
      await Promise.all(watching.map(async task => {
        let row;
        try { row = await readTurnStatus({ sessionId: task.sessionId, turnId: task.turnId }); } catch { return; }
        if (closed || !current(owner) || tasks.get(task.id) !== task || !pending(task)) return;
        if (!row || row.sessionId !== task.sessionId || row.turnId !== task.turnId || !Object.hasOwn(TERMINAL, row.status) ||
          !Number.isSafeInteger(row.startedAt) || row.startedAt < 0 || !Number.isSafeInteger(row.completedAt) ||
          row.completedAt < row.startedAt || row.completedAt < task.startedAt || row.completedAt > clock()) return;
        Object.assign(task, { state: TERMINAL[row.status], phase: 'main-reply-ended', finishedAt: row.completedAt,
          terminalConfirmed: true, terminalKind: 'main-reply', realtime: true, revision: ++revision,
          evidence: 'exact-observed-turn-usage-terminal', source: 'zcode-authorized-turn-usage' });
        tombstone(task.id); notify(); if (!getState().activeCount) clear('terminal'); emit(task.state, task, owner);
      }));
      if (!closed && current(owner)) { expire(); arm(); }
      return getState();
    })().finally(() => { if (flight === run) flight = null; });
    flight = run; return run.promise;
  }
  function close() { if (closed) return; reset(); closed = true; notify(); }
  return { bind, accept, refresh, reset, getState, close };
}
module.exports = { createZcodeDesktopTaskState };
