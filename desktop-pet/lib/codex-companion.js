const { createCodexConnection, CONNECTION_STATES, ERROR_CODES } = require('./codex-connection');
const { isTaskId } = require('./codex-state');

const POLL_MS = Object.freeze({ quota: 120000, tasks: 15000 });
const RETRY_MS = Object.freeze([30000, 60000, 120000]);
const STALE_MS = 300000;
const MERGE_MS = 5000;
const ALERT_GAP_MS = 30000;
const QUEUE_MS = 60000;
const DISPLAY_MS = 8000;
const MOTIONS = Object.freeze({ active: 'sway', waiting: 'peek', completed: 'hop', failed: 'jelly', quota: 'bow' });
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
  const quotaSeen = new Map();
  const terminalSeen = new Map();
  let queued = [];
  let recent = [];
  let currentAlert = null;
  let nextAlertId = 0;
  let lastPresentedAt = -Infinity;
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
      recent: recent.map(entry => ({ ...entry, taskIds: [...entry.taskIds] })),
      currentAlert: eventValid(currentAlert) ? publicAlert(currentAlert) : null
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
  function armStale() {
    clearTimer('stale');
    if (!quotaStale()) setTimer('stale', quota.updatedAt + STALE_MS - now(), () => { pruneAlerts(); notify(); });
  }
  function quotaKey(window) { return JSON.stringify([window.id, window.windowMinutes, window.resetsAt]); }
  function validRefs(event) {
    return [...event.refs.values()].flatMap(ref => {
      if (event.kind === 'quota') {
        if (quotaStale()) return [];
        const window = quota.windows.find(item => quotaKey(item) === ref.key);
        return window && Number.isFinite(window.remaining) && window.remaining <= ref.threshold && window.resetsAt > now()
          ? [{ ...ref, remaining: window.remaining }] : [];
      }
      const task = tasks.get(ref.id);
      return task?.state === event.kind && task.turnId === ref.turnId ? [ref] : [];
    });
  }
  function eventValid(event) {
    return Boolean(event && event.refs.size > 0 && now() < event.expiresAt && event.generation === generation
      && validRefs(event).length === event.refs.size);
  }
  function refreshEventRefs(event) {
    event.refs = new Map(validRefs(event).map(ref => [event.kind === 'quota' ? ref.key : ref.id, ref]));
  }
  function eventText(event) {
    const count = event.refs.size;
    if (event.kind === 'active') return null;
    if (event.kind === 'quota') {
      const remaining = Math.min(...[...event.refs.values()].map(ref => ref.remaining));
      const percentage = Math.round(remaining * 10) / 10;
      return count > 1 ? `${count} 项额度偏低\n最低剩余 ${percentage}%` : `额度剩余 ${percentage}%\n详情见 Codex 状态`;
    }
    if (event.kind === 'waiting') return count > 1 ? `有 ${count} 个任务\n等你确认哦` : '有一步等你确认哦';
    if (event.kind === 'completed') return count > 1 ? `有 ${count} 轮出结果啦\n去看看？` : '这轮有结果啦，去看看？';
    return count > 1 ? `有 ${count} 个任务\n遇到问题了` : '这一步遇到问题了';
  }
  function publicAlert(event) {
    return { id: event.id, generation: event.generation, kind: event.kind, motion: MOTIONS[event.kind],
      text: eventText(event), taskIds: event.kind === 'quota' ? [] : [...event.refs.values()].map(ref => ref.id),
      createdAt: event.createdAt, expiresAt: event.expiresAt };
  }
  function remember(event, presentedAt = null) {
    const alert = publicAlert(event);
    const entry = { id: alert.id, kind: alert.kind, text: alert.text || '有任务正在处理',
      taskIds: alert.taskIds, createdAt: alert.createdAt, presentedAt };
    const index = recent.findIndex(item => item.id === event.id);
    if (index >= 0) recent[index] = entry;
    else if (presentedAt === null) recent = [entry, ...recent].slice(0, 10);
  }
  function clearAlerts({ history = false, dedupe = false, cooldown = false } = {}) {
    clearTimer('drain'); clearTimer('alert');
    queued = []; currentAlert = null;
    if (history) recent = [];
    if (dedupe) { quotaSeen.clear(); terminalSeen.clear(); }
    if (cooldown) lastPresentedAt = -Infinity;
  }
  function dismiss(id, expectedGeneration) {
    if (!enabled || !currentAlert || id !== currentAlert.id || expectedGeneration !== generation
      || now() >= currentAlert.expiresAt) return false;
    currentAlert = null; clearTimer('alert'); onClear(); notify();
    return true;
  }
  function pruneAlerts() {
    queued = queued.filter(event => {
      if (now() >= event.expiresAt) return false;
      refreshEventRefs(event);
      return event.refs.size > 0;
    });
    if (currentAlert && !eventValid(currentAlert)) {
      currentAlert = null; clearTimer('alert'); onClear();
      return true;
    }
    return false;
  }
  function armDrain() {
    clearTimer('drain');
    pruneAlerts();
    if (!queued.length) return;
    const readyAt = Math.max(queued[0].createdAt + MERGE_MS, lastPresentedAt + ALERT_GAP_MS);
    const wakeAt = Math.min(readyAt > now() ? readyAt : now() + 1000, ...queued.map(event => event.expiresAt));
    setTimer('drain', wakeAt - now(), drain);
  }
  function drain() {
    const cleared = pruneAlerts();
    const ready = queued.find(event => event.createdAt + MERGE_MS <= now());
    if (ready && now() - lastPresentedAt >= ALERT_GAP_MS && canPresent() === true
      && enabled && !closed && queued.includes(ready) && eventValid(ready)) {
      refreshEventRefs(ready);
      queued = queued.filter(event => event !== ready);
      const candidate = { ...ready, expiresAt: now() + DISPLAY_MS };
      currentAlert = candidate;
      setTimer('alert', DISPLAY_MS, () => { if (pruneAlerts()) notify(); });
      notify();
      if (enabled && !closed && currentAlert === candidate && eventValid(candidate)) {
        refreshEventRefs(candidate);
        lastPresentedAt = now();
        remember(candidate, now());
        onAlert(publicAlert(candidate));
        if (enabled && !closed && generation === candidate.generation) notify();
      }
    } else if (cleared) notify();
    armDrain();
  }
  function enqueue(kind, ref) {
    let event = queued.find(item => item.kind === kind && now() - item.createdAt < MERGE_MS);
    if (!event) {
      event = { id: ++nextAlertId, generation, kind, createdAt: now(), expiresAt: now() + QUEUE_MS, refs: new Map() };
      queued.push(event);
      if (queued.length > 20) queued.shift();
    }
    if (kind === 'quota') {
      for (const other of queued) if (other !== event) other.refs.delete(ref.key);
    }
    event.refs.set(kind === 'quota' ? ref.key : ref.id, ref);
    remember(event); armDrain();
  }
  function quotaAlerts() {
    if (quotaStale()) return;
    for (const window of quota.windows) {
      if (!Number.isFinite(window.remaining) || !Number.isFinite(window.windowMinutes)
        || !Number.isFinite(window.resetsAt) || window.resetsAt <= now() || window.remaining > 20) continue;
      const threshold = window.remaining <= 10 ? 10 : 20;
      const key = quotaKey(window);
      const previous = quotaSeen.get(window.id);
      if (previous?.key === key && previous.threshold <= threshold) continue;
      quotaSeen.set(window.id, { key, threshold });
      if (quotaSeen.size > 64) quotaSeen.delete(quotaSeen.keys().next().value);
      enqueue('quota', { key, threshold, remaining: window.remaining });
    }
  }
  function taskAlerts(task, previous, baseline) {
    const terminal = ['completed', 'failed', 'interrupted'].includes(task.state);
    let seen = terminalSeen.get(task.id) || [];
    const alreadySeen = seen.includes(task.turnId);
    if (terminal && task.turnId && !alreadySeen) {
      seen = [...seen, task.turnId].slice(-16); terminalSeen.set(task.id, seen);
    }
    if (!previous || baseline || !task.turnId) return;
    const sameTurn = previous.turnId === task.turnId;
    if (task.state === 'active' && !['active', 'unknown'].includes(previous.state)) enqueue('active', { id: task.id, turnId: task.turnId });
    else if (task.state === 'waiting' && previous.state === 'active' && sameTurn) enqueue('waiting', { id: task.id, turnId: task.turnId });
    else if (['completed', 'failed'].includes(task.state) && ['active', 'waiting'].includes(previous.state) && sameTurn && !alreadySeen) {
      enqueue(task.state, { id: task.id, turnId: task.turnId });
    }
  }
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
    const alertCleared = pruneAlerts();
    armChannel(value.channel);
    if (changed || alertCleared) notify();
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
    // A successful quota payload is connection evidence even when the transport
    // deduplicates its unchanged "connected" status after an account switch.
    channels.quota.state = 'connected'; channels.quota.code = null; channels.quota.failures = 0;
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
    armChannel('quota'); armStale(); pruneAlerts(); quotaAlerts();
    notify();
  }
  function receiveTask(value) {
    if (!isTaskId(value?.id)) return;
    const previous = tasks.get(value.id);
    if (value.removed) {
      terminalSeen.delete(value.id);
      if (tasks.delete(value.id)) { pruneAlerts(); notify(); }
      return;
    }
    const task = {
      id: value.id, title: cleanText(value.title, 140),
      state: TASK_STATES.has(value.state) ? value.state : 'unknown',
      turnId: cleanText(value.turnId, 160) || null,
      updatedAt: timestamp(value.updatedAt),
      ...(value.unavailable === 'STATE_TOO_LARGE' ? { unavailable: 'STATE_TOO_LARGE' } : {})
    };
    if (!previous && tasks.size === 20) {
      const oldest = tasks.keys().next().value; tasks.delete(oldest); terminalSeen.delete(oldest);
    }
    tasks.set(task.id, task);
    pruneAlerts(); taskAlerts(task, previous, value.baseline === true);
    if (!previous || ['title', 'state', 'turnId', 'unavailable'].some(key => previous[key] !== task[key])) notify();
  }
  function receiveAccount(value) {
    const next = typeof value?.accountKey === 'string' ? value.accountKey.slice(0, 128) : null;
    if (accountKey !== undefined && next !== accountKey) {
      generation++;
      quota = { windows: [], updatedAt: null }; tasks.clear();
      clearAlerts({ history: true, dedupe: true, cooldown: true });
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
  function finishDisable() {
    stopConnection(); resetChannels('disabled');
    accountKey = undefined; quota = { windows: [], updatedAt: null }; tasks.clear(); lastManualAt = -Infinity;
    clearAlerts({ history: true, dedupe: true, cooldown: true });
    onClear(); notify();
  }
  async function setEnabled(value) {
    const next = value === true;
    if (closed || enabled === next) return false;
    enabled = next; generation++;
    if (enabled) { await openConnection(); return true; }
    finishDisable();
    return true;
  }
  async function refresh() {
    if (!enabled || closed || now() - lastManualAt < 10000) return false;
    lastManualAt = now(); generation++;
    stopConnection();
    clearAlerts(); armStale();
    for (const task of tasks.values()) task.state = 'unknown';
    onClear();
    await openConnection();
    return true;
  }
  function close() {
    if (closed) return;
    closed = true;
    if (!enabled) return;
    enabled = false; generation++;
    finishDisable();
  }
  return { setEnabled, refresh, getSnapshot, dismiss, close };
}

module.exports = { createCodexCompanion };
