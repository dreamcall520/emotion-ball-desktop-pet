const { createCodexConnection, CONNECTION_STATES, ERROR_CODES } = require('./codex-connection');
const { isTaskId } = require('./codex-state');

const POLL_MS = Object.freeze({ quota: 120000, tasks: 15000 });
const RETRY_MS = Object.freeze([30000, 60000, 120000]);
const STALE_MS = 300000;
const TASK_STATES = new Set(['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle', 'unknown']);
const cleanText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : null;

// Creating the policy owns no resources. Transports and timers exist only while enabled.
function createCodexCompanion({ createConnection = createCodexConnection, onChange = () => {},
  onAlert = () => {}, onClear = () => {}, canPresent = () => true,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let enabled = false;
  let closed = false;
  let generation = 0;
  let connectionEpoch = 0;
  let connection = null;
  let accountKey;
  let lastManualAt = -Infinity;
  let quota = { windows: [], updatedAt: null };
  const tasks = new Map();
  const timers = new Map();
  const channels = {
    quota: { state: 'disabled', code: null, failures: 0, flight: null },
    tasks: { state: 'disabled', code: null, failures: 0, flight: null }
  };

  function quotaStale() {
    return quota.updatedAt === null || quota.updatedAt > now() || now() - quota.updatedAt >= STALE_MS;
  }
  function getSnapshot() {
    return {
      enabled, generation,
      quota: { state: channels.quota.state, code: channels.quota.code,
        windows: quota.windows.map(window => ({ ...window })), updatedAt: quota.updatedAt, stale: quotaStale() },
      tasks: { state: channels.tasks.state, code: channels.tasks.code, partial: true,
        items: [...tasks.values()].map(task => ({ ...task })) },
      recent: [], currentAlert: null
    };
  }
  function notify() { onChange(getSnapshot()); }
  function clearTimer(name) {
    const timer = timers.get(name);
    if (timer) cancel(timer.handle);
    timers.delete(name);
  }
  function setTimer(name, delay, callback) {
    clearTimer(name);
    if (!enabled || closed) return;
    const timer = {};
    timer.handle = schedule(() => {
      if (timers.get(name) !== timer || !enabled || closed) return;
      timers.delete(name); callback();
    }, Math.max(0, delay));
    timer.handle?.unref?.();
    timers.set(name, timer);
  }
  function clearTimers() { for (const name of [...timers.keys()]) clearTimer(name); }
  function resetChannels(state) {
    for (const channel of Object.values(channels)) {
      channel.state = state; channel.code = null; channel.failures = 0; channel.flight = null;
    }
  }
  function armChannel(name) {
    clearTimer(name);
    const channel = channels[name];
    if (!enabled || closed || channel.flight) return;
    const delay = channel.state === 'connected' ? POLL_MS[name]
      : channel.state === 'disconnected' ? RETRY_MS[Math.min(channel.failures, RETRY_MS.length - 1)] : null;
    if (delay !== null) setTimer(name, delay, () => { void runChannel(name); });
  }
  function receiveStatus(value) {
    const channel = channels[value?.channel];
    if (!channel) return;
    const state = CONNECTION_STATES.includes(value.state) ? value.state : 'disconnected';
    const code = ERROR_CODES.includes(value.code) ? value.code : null;
    const changed = channel.state !== state || channel.code !== code;
    channel.state = state; channel.code = code;
    if (state === 'connected') channel.failures = 0;
    if (value.channel === 'tasks' && ['disconnected', 'missing', 'unauthenticated', 'unsupported'].includes(state)) {
      for (const task of tasks.values()) task.state = 'unknown';
    }
    armChannel(value.channel);
    if (changed) notify();
  }
  async function runChannel(name) {
    const channel = channels[name];
    if (!enabled || closed || channel.flight || !connection) return;
    const epoch = connectionEpoch;
    const target = connection;
    const retry = channel.state === 'disconnected';
    if (!retry && channel.state !== 'connected') return;
    if (retry) channel.failures++;
    const flight = {};
    channel.flight = flight;
    try {
      const selection = { quota: name === 'quota', tasks: name === 'tasks' };
      await target[retry ? 'retry' : 'refresh'](selection);
    } catch (_error) {
      if (enabled && !closed && epoch === connectionEpoch) receiveStatus({ channel: name, state: 'disconnected', code: 'DISCONNECTED' });
    } finally {
      if (enabled && !closed && epoch === connectionEpoch && channel.flight === flight) {
        channel.flight = null; armChannel(name);
      }
    }
  }
  function receiveQuota(value) {
    quota = { updatedAt: timestamp(value?.updatedAt), windows: [] };
    for (const window of Array.isArray(value?.windows) ? value.windows.slice(0, 64) : []) {
      if (!window || typeof window.id !== 'string') continue;
      quota.windows.push({
        id: window.id.slice(0, 200), label: cleanText(window.label, 100),
        windowMinutes: Number.isFinite(window.windowMinutes) && window.windowMinutes > 0 ? window.windowMinutes : 'unknown',
        remaining: Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100 ? window.remaining : 'unknown',
        resetsAt: timestamp(window.resetsAt) ?? 'unknown'
      });
    }
    clearTimer('stale');
    if (!quotaStale()) setTimer('stale', quota.updatedAt + STALE_MS - now(), notify);
    notify();
  }
  function receiveTask(value) {
    if (!isTaskId(value?.id)) return;
    const previous = tasks.get(value.id);
    if (value.removed) { if (tasks.delete(value.id)) notify(); return; }
    const task = {
      id: value.id, title: cleanText(value.title, 140),
      state: TASK_STATES.has(value.state) ? value.state : 'unknown',
      turnId: cleanText(value.turnId, 160) || null,
      updatedAt: timestamp(value.updatedAt),
      ...(value.unavailable === 'STATE_TOO_LARGE' ? { unavailable: 'STATE_TOO_LARGE' } : {})
    };
    if (!previous && tasks.size === 20) tasks.delete(tasks.keys().next().value);
    tasks.set(task.id, task);
    if (!previous || ['title', 'state', 'turnId', 'unavailable'].some(key => previous[key] !== task[key])) notify();
  }
  function receiveAccount(value) {
    const next = typeof value?.accountKey === 'string' ? value.accountKey.slice(0, 128) : null;
    if (accountKey !== undefined && next !== accountKey) {
      generation++;
      quota = { windows: [], updatedAt: null }; tasks.clear();
      clearTimer('stale');
      for (const name of Object.keys(channels)) {
        clearTimer(name); channels[name].state = 'connecting'; channels[name].code = null; channels[name].failures = 0;
      }
      onClear(); notify();
    }
    accountKey = next;
  }
  function stopConnection() {
    connectionEpoch++;
    clearTimers();
    const previous = connection; connection = null;
    previous?.close();
  }
  async function openConnection() {
    const epoch = ++connectionEpoch;
    const current = () => enabled && !closed && epoch === connectionEpoch;
    const guard = callback => value => { if (current()) callback(value); };
    resetChannels('connecting'); notify();
    try {
      const created = createConnection({ onAccount: guard(receiveAccount), onQuota: guard(receiveQuota),
        onTask: guard(receiveTask), onStatus: guard(receiveStatus) });
      if (!current()) { created.close(); return; }
      connection = created;
      await created.start();
    } catch (_error) {
      if (current()) for (const channel of Object.keys(channels)) receiveStatus({ channel, state: 'disconnected', code: 'DISCONNECTED' });
    }
  }
  async function setEnabled(value) {
    const next = value === true;
    if (closed || enabled === next) return false;
    enabled = next; generation++;
    if (enabled) { await openConnection(); return true; }
    stopConnection(); resetChannels('disabled');
    accountKey = undefined; quota = { windows: [], updatedAt: null }; tasks.clear(); lastManualAt = -Infinity;
    onClear(); notify();
    return true;
  }
  async function refresh() {
    if (!enabled || closed || now() - lastManualAt < 10000) return false;
    lastManualAt = now(); generation++;
    stopConnection();
    for (const task of tasks.values()) task.state = 'unknown';
    onClear();
    await openConnection();
    return true;
  }
  function close() {
    if (closed) return;
    void setEnabled(false); closed = true;
  }
  return { setEnabled, refresh, getSnapshot, close };
}

module.exports = { createCodexCompanion };
