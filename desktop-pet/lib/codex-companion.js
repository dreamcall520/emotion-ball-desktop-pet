const { createCodexConnection, CONNECTION_STATES, ERROR_CODES } = require('./codex-connection');
const { isTaskId } = require('./codex-state');
const { completionText } = require('./codex-text');
const { selectPrimaryQuotaWindows } = require('./codex-quota-view');
const { createQuotaAlertTracker, mergeQuotaAlerts } = require('./codex-quota-alerts');

const POLL_MS = Object.freeze({ quota: 120000, tasks: 15000 });
const RETRY_MS = Object.freeze([30000, 60000, 120000]);
const STALE_MS = 300000;
const MERGE_MS = 5000;
const ALERT_GAP_MS = 30000;
const QUEUE_MS = 60000;
const TASK_DISPLAY_MS = 8000;
const QUOTA_DISPLAY_MS = Object.freeze({ normal: 6000, strong: 12000, urgent: 12000 });
const IDLE_TRANSITION_MS = 5000;
const MOTIONS = Object.freeze({ active: 'sway', waiting: 'peek', completed: 'hop', failed: 'jelly' });
const TASK_STATES = new Set(['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle', 'unknown']);
const QUOTA_PERIODS = new Set(['auto', 'fiveHour', 'weekly']);
const cleanText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : null;

// Creating the policy owns no resources. Transports and timers exist only while enabled.
function createCodexCompanion({ createConnection = createCodexConnection, onChange = () => {},
  onAlert = () => {}, onAlertUpdate = () => {}, onClear = () => {}, canPresent = () => true,
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
  const quotaTracker = createQuotaAlertTracker();
  const terminalSeen = new Map();
  const idleTransitions = new Map();
  let queued = [];
  let currentAlert = null;
  let preferences = { taskNameInAlerts: false, quotaAlwaysVisible: false, quotaPeriod: 'auto' };
  let quotaNeedsBaseline = true;
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
        windows: quota.windows.map(window => ({ ...window })), updatedAt: quota.updatedAt, stale: quotaStale(),
        ...(Number.isSafeInteger(quota.resetCreditsAvailable) && quota.resetCreditsAvailable >= 0
          ? { resetCreditsAvailable: quota.resetCreditsAvailable } : {}) },
      tasks: { state: channels.tasks.state, code: channels.tasks.code, partial: true,
        items: [...tasks.values()].map(task => ({ ...task })) },
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
    if (!quotaStale()) setTimer('stale', quota.updatedAt + STALE_MS - now(), () => {
      quotaNeedsBaseline = true;
      pruneAlerts(); notify();
    });
  }
  function quotaKey(window) { return JSON.stringify([window.id, window.windowMinutes, window.resetsAt]); }
  function selectedQuotaWindows() {
    if (channels.quota.state !== 'connected' || quotaStale()) return [];
    const selected = new Map();
    for (const window of selectPrimaryQuotaWindows(quota.windows, preferences.quotaPeriod, now())) {
      selected.set(quotaKey(window), window);
    }
    return [...selected.values()];
  }
  function quotaSeverity(level) {
    return level >= 90 ? 'urgent' : level >= 80 ? 'strong' : 'normal';
  }
  function quotaSummary(refs) {
    if (!refs.length) return null;
    return {
      level: Math.max(...refs.map(ref => ref.level)),
      remaining: Math.min(...refs.map(ref => ref.remaining)),
      count: refs.length
    };
  }
  function eventSeverity(event, refs) {
    return event.kind === 'quota' ? quotaSeverity(quotaSummary(refs)?.level || 0) : 'normal';
  }
  function eventDuration(event, refs) {
    const severity = eventSeverity(event, refs);
    return event.kind === 'quota' ? QUOTA_DISPLAY_MS[severity] : TASK_DISPLAY_MS;
  }
  function eventMotion(event, refs) {
    if (event.kind !== 'quota') return MOTIONS[event.kind];
    return eventSeverity(event, refs) === 'normal' ? 'bow' : 'jelly';
  }
  function validRefs(event) {
    return [...event.refs.values()].flatMap(ref => {
      if (event.kind === 'quota') {
        const window = selectedQuotaWindows().find(item => quotaKey(item) === ref.key);
        return window && window.remaining <= 100 - ref.level
          ? [{ ...ref, remaining: window.remaining }] : [];
      }
      const task = tasks.get(ref.id);
      return task?.state === event.kind && task.turnId === ref.turnId ? [{ ...ref, title: task.title }] : [];
    });
  }
  function eventValid(event) {
    const beforeExpiry = event?.kind === 'quota' && event.shownAt === undefined
      ? [...event.refs.values()].every(ref => now() < ref.queueExpiresAt)
      : now() < event?.expiresAt;
    return Boolean(event && event.refs.size > 0 && beforeExpiry && event.generation === generation
      && validRefs(event).length === event.refs.size);
  }
  function refSignature(event, refs) {
    return JSON.stringify(refs.map(ref => event.kind === 'quota'
      ? [ref.key, ref.level, ref.remaining, ref.resetsAt]
      : [ref.id, ref.turnId, ref.title]));
  }
  function refreshEventRefs(event, filter = () => true) {
    const refs = validRefs(event).filter(filter);
    event.refs = new Map(refs.map(ref => [event.kind === 'quota' ? ref.key : ref.id, ref]));
    return refs;
  }
  function eventText(event, refs) {
    const count = refs.length;
    if (event.kind === 'active') return null;
    if (event.kind === 'quota') {
      const summary = quotaSummary(refs);
      const remaining = summary.remaining;
      const percentage = Math.round(remaining * 10) / 10;
      if (count > 1) {
        return summary.level >= 100
          ? `多项额度中已有额度用完\n最低剩余 ${percentage}%，非账户总余额`
          : `多项额度提醒\n最低剩余 ${percentage}%，非账户总余额`;
      }
      if (summary.level >= 100) return '这项额度已用完\n重置时间见 Codex 状态';
      if (summary.level >= 90) return `这项额度只剩 ${percentage}%\n留意一下接下来的用量`;
      if (summary.level >= 80) return `这项额度剩余 ${percentage}%\n用量接近上限啦`;
      const used = Math.round((100 - remaining) * 10) / 10;
      return `本周期已用 ${used}%\n还剩 ${percentage}%，继续陪你`;
    }
    if (event.kind === 'waiting') return count > 1 ? `有 ${count} 个任务\n等你确认哦` : '有一步等你确认哦';
    return count > 1 ? `有 ${count} 个任务\n遇到问题了` : '这一步遇到问题了';
  }
  function publicAlertForRefs(event, refs) {
    return { id: event.id, generation: event.generation, kind: event.kind,
      motion: eventMotion(event, refs), severity: eventSeverity(event, refs), durationMs: eventDuration(event, refs),
      text: event.kind === 'completed'
        ? completionText(refs.map(ref => ref.title), refs.length, preferences.taskNameInAlerts)
        : eventText(event, refs),
      taskIds: event.kind === 'quota' ? [] : refs.map(ref => ref.id),
      createdAt: event.createdAt, expiresAt: event.expiresAt };
  }
  function publicAlert(event) {
    return publicAlertForRefs(event, validRefs(event));
  }
  function publicModelSignature(alert) {
    return JSON.stringify([alert.motion, alert.severity, alert.durationMs, alert.text, alert.taskIds]);
  }
  function setPreferences(next = {}) {
    let values;
    try {
      if (next && typeof next === 'object' && !Array.isArray(next)) {
        values = {
          taskNameInAlerts: next.taskNameInAlerts,
          quotaAlwaysVisible: next.quotaAlwaysVisible,
          quotaPeriod: next.quotaPeriod
        };
      }
    } catch {
      return false;
    }
    const previous = preferences;
    const proposed = { ...previous };
    if (typeof values?.taskNameInAlerts === 'boolean') proposed.taskNameInAlerts = values.taskNameInAlerts;
    if (typeof values?.quotaAlwaysVisible === 'boolean') proposed.quotaAlwaysVisible = values.quotaAlwaysVisible;
    if (QUOTA_PERIODS.has(values?.quotaPeriod)) proposed.quotaPeriod = values.quotaPeriod;
    if (Object.keys(proposed).every(key => proposed[key] === previous[key])) return false;
    preferences = proposed;
    const periodChanged = previous.quotaPeriod !== proposed.quotaPeriod;
    const alwaysOpened = !previous.quotaAlwaysVisible && proposed.quotaAlwaysVisible;
    const alwaysClosed = previous.quotaAlwaysVisible && !proposed.quotaAlwaysVisible;
    if (periodChanged) {
      quotaTracker.reset();
      quotaNeedsBaseline = true;
      pruneAlerts();
    }
    if (alwaysOpened) removeOrdinaryQuotaAlerts();
    if (periodChanged || alwaysClosed) quotaAlerts({ baseline: true });
    notify();
    if (previous.taskNameInAlerts !== proposed.taskNameInAlerts && eventValid(currentAlert)) {
      onAlertUpdate(publicAlert(currentAlert));
    }
    return true;
  }
  function clearAlerts({ dedupe = false, cooldown = false } = {}) {
    clearTimer('drain'); clearTimer('alert');
    queued = []; currentAlert = null;
    idleTransitions.clear();
    if (dedupe) { quotaTracker.reset(); quotaNeedsBaseline = true; terminalSeen.clear(); }
    if (cooldown) lastPresentedAt = -Infinity;
  }
  function removeOrdinaryQuotaAlerts() {
    queued = queued.filter(event => {
      if (event.kind !== 'quota') return true;
      event.refs = new Map([...event.refs].filter(([, ref]) => ref.level >= 80));
      return event.refs.size > 0;
    });
    if (currentAlert?.kind === 'quota') reconcileCurrentAlert(ref => ref.level >= 80);
    armDrain();
  }
  function dismiss(id, expectedGeneration) {
    if (!enabled || !currentAlert || id !== currentAlert.id || expectedGeneration !== generation
      || now() >= currentAlert.expiresAt) return false;
    currentAlert = null; clearTimer('alert'); onClear(); notify();
    return true;
  }
  function clearCurrentAlert(event) {
    if (currentAlert !== event) return false;
    currentAlert = null; clearTimer('alert'); onClear();
    return true;
  }
  function armCurrentAlert(event) {
    if (!enabled || closed || currentAlert !== event) return;
    const resetsAt = event.kind === 'quota'
      ? [...event.refs.values()].map(ref => ref.resetsAt).filter(value => Number.isFinite(value) && value > now())
      : [];
    const wakeAt = Math.min(event.expiresAt, ...resetsAt);
    setTimer('alert', wakeAt - now(), () => {
      const changed = pruneAlerts();
      if (changed && enabled && !closed) notify();
    });
  }
  function reconcileCurrentAlert(filter = () => true) {
    const event = currentAlert;
    if (!event) return false;
    if (now() >= event.expiresAt || event.generation !== generation) return clearCurrentAlert(event);
    const beforeRefs = [...event.refs.values()];
    const beforeSignature = refSignature(event, beforeRefs);
    const beforeModel = publicModelSignature(publicAlertForRefs(event, beforeRefs));
    const refs = refreshEventRefs(event, filter);
    if (!refs.length) return clearCurrentAlert(event);
    const durationMs = eventDuration(event, refs);
    const reasonableExpiry = (event.shownAt ?? event.createdAt) + durationMs;
    event.expiresAt = Math.min(event.expiresAt, reasonableExpiry);
    if (now() >= event.expiresAt) return clearCurrentAlert(event);
    const nextAlert = publicAlertForRefs(event, refs);
    const changed = beforeSignature !== refSignature(event, refs)
      || beforeModel !== publicModelSignature(nextAlert);
    armCurrentAlert(event);
    if (changed) onAlertUpdate(nextAlert);
    return changed;
  }
  function pruneAlerts() {
    queued = queued.filter(event => {
      if (event.generation !== generation) return false;
      if (event.kind === 'quota') refreshEventRefs(event, ref => now() < ref.queueExpiresAt);
      else {
        if (now() >= event.expiresAt) return false;
        refreshEventRefs(event);
      }
      return event.refs.size > 0;
    });
    return reconcileCurrentAlert();
  }
  function armDrain() {
    clearTimer('drain');
    pruneAlerts();
    if (!enabled || closed || !queued.length) return;
    const mergedAt = Math.min(...queued.map(event => event.createdAt + MERGE_MS));
    const readyAt = Math.max(mergedAt, lastPresentedAt + ALERT_GAP_MS);
    const quotaResets = queued.flatMap(event => event.kind === 'quota'
      ? [...event.refs.values()].map(ref => ref.resetsAt).filter(value => Number.isFinite(value) && value > now())
      : []);
    const queueExpiries = queued.flatMap(event => event.kind === 'quota'
      ? [...event.refs.values()].map(ref => ref.queueExpiresAt)
      : [event.expiresAt]);
    const wakeAt = Math.min(readyAt > now() ? readyAt : now() + 1000,
      ...queueExpiries, ...quotaResets);
    setTimer('drain', wakeAt - now(), drain);
  }
  function drain() {
    const cleared = pruneAlerts();
    const readyEvents = queued.filter(event => event.createdAt + MERGE_MS <= now());
    let ready = readyEvents[0];
    if (ready?.kind === 'quota') {
      ready = readyEvents.filter(event => event.kind === 'quota').sort((left, right) => {
        const leftLevel = quotaSummary(validRefs(left))?.level || 0;
        const rightLevel = quotaSummary(validRefs(right))?.level || 0;
        return rightLevel - leftLevel || left.createdAt - right.createdAt;
      })[0] || ready;
    }
    if (ready && now() - lastPresentedAt >= ALERT_GAP_MS && canPresent() === true
      && enabled && !closed && queued.includes(ready) && eventValid(ready)) {
      refreshEventRefs(ready);
      queued = queued.filter(event => event !== ready);
      const durationMs = eventDuration(ready, [...ready.refs.values()]);
      const candidate = { ...ready, shownAt: now(), expiresAt: now() + durationMs };
      currentAlert = candidate;
      armCurrentAlert(candidate);
      notify();
      if (enabled && !closed && currentAlert === candidate && eventValid(candidate)) {
        refreshEventRefs(candidate);
        lastPresentedAt = now();
        onAlert(publicAlert(candidate));
        if (enabled && !closed && generation === candidate.generation) notify();
      }
    } else if (cleared) notify();
    armDrain();
  }
  function enqueue(kind, ref) {
    let event = kind === 'quota' ? queued.find(item => item.kind === kind && item.refs.has(ref.key)) : null;
    const previousRef = kind === 'quota' ? event?.refs.get(ref.key) : null;
    if (!event) event = queued.find(item => item.kind === kind && now() - item.createdAt < MERGE_MS);
    if (!event) {
      event = { id: ++nextAlertId, generation, kind, createdAt: now(), refs: new Map() };
      if (kind !== 'quota') event.expiresAt = now() + QUEUE_MS;
      queued.push(event);
      if (queued.length > 20) queued.shift();
    }
    if (kind === 'quota') {
      for (const other of queued) if (other !== event) other.refs.delete(ref.key);
      const queueExpiresAt = !previousRef || ref.level > previousRef.level
        ? now() + QUEUE_MS : previousRef.queueExpiresAt;
      ref = { ...ref, queueExpiresAt };
    }
    event.refs.set(kind === 'quota' ? ref.key : ref.id, ref);
    armDrain();
  }
  function quotaAlerts({ baseline = false } = {}) {
    if (!enabled || closed || channels.quota.state !== 'connected' || quotaStale()) return;
    const selected = selectedQuotaWindows();
    if (!selected.length) return;
    const crossed = quotaTracker.update(selected, {
      baseline: baseline || quotaNeedsBaseline,
      alwaysVisible: preferences.quotaAlwaysVisible
    });
    quotaNeedsBaseline = false;
    const merged = mergeQuotaAlerts(crossed);
    for (const ref of merged?.refs || []) {
      const visible = currentAlert?.kind === 'quota' ? currentAlert.refs.get(ref.key) : null;
      if (!visible || visible.level < ref.level) enqueue('quota', ref);
    }
  }
  function taskAlerts(task, previous, baseline) {
    const sameTurn = Boolean(task.turnId && previous?.turnId === task.turnId);
    const idleTransition = idleTransitions.get(task.id);
    const followsIdle = sameTurn && previous.state === 'idle'
      && idleTransition?.turnId === task.turnId && now() < idleTransition.expiresAt;
    // Codex can publish runtime idle just before the same turn's terminal patch.
    // Bridge only that short observed transition; idle alone is never completion.
    if (task.state === 'idle' && !baseline && sameTurn) {
      if (['active', 'waiting'].includes(previous.state)) {
        idleTransitions.set(task.id, { turnId: task.turnId, expiresAt: now() + IDLE_TRANSITION_MS });
      } else if (!followsIdle) idleTransitions.delete(task.id);
    } else idleTransitions.delete(task.id);
    const terminal = ['completed', 'failed', 'interrupted'].includes(task.state);
    let seen = terminalSeen.get(task.id) || [];
    const alreadySeen = seen.includes(task.turnId);
    if (terminal && task.turnId && !alreadySeen) {
      seen = [...seen, task.turnId].slice(-16); terminalSeen.set(task.id, seen);
    }
    if (!previous || baseline || !task.turnId) return;
    if (task.state === 'active' && !['active', 'unknown'].includes(previous.state)) enqueue('active', { id: task.id, turnId: task.turnId });
    else if (task.state === 'waiting' && previous.state === 'active' && sameTurn) enqueue('waiting', { id: task.id, turnId: task.turnId });
    else if (['completed', 'failed'].includes(task.state)
      && (['active', 'waiting'].includes(previous.state) || followsIdle) && sameTurn && !alreadySeen) {
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
    if (value.channel === 'quota' && state !== 'connected') quotaNeedsBaseline = true;
    if (value.channel === 'tasks' && ['disconnected', 'missing', 'unauthenticated', 'unsupported'].includes(state)) {
      idleTransitions.clear();
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
    const quotaGeneration = generation;
    const quotaEpoch = connectionEpoch;
    const quotaConnection = connection;
    // A successful quota payload is connection evidence even when the transport
    // deduplicates its unchanged "connected" status after an account switch.
    channels.quota.state = 'connected'; channels.quota.code = null; channels.quota.failures = 0;
    const resetCreditsAvailable = value?.resetCreditsAvailable;
    const nextQuota = {
      updatedAt: timestamp(value?.updatedAt),
      windows: [],
      ...(Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
        ? { resetCreditsAvailable } : {})
    };
    quota = nextQuota;
    for (const window of Array.isArray(value?.windows) ? value.windows.slice(0, 64) : []) {
      if (!window || typeof window.id !== 'string') continue;
      nextQuota.windows.push({
        id: window.id.slice(0, 200), label: cleanText(window.label, 100),
        windowMinutes: Number.isFinite(window.windowMinutes) && window.windowMinutes > 0 ? window.windowMinutes : 'unknown',
        remaining: Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100 ? window.remaining : 'unknown',
        resetsAt: timestamp(window.resetsAt) ?? 'unknown'
      });
    }
    if (quotaStale()) quotaNeedsBaseline = true;
    pruneAlerts();
    const currentRequest = () => enabled && !closed && generation === quotaGeneration
      && connectionEpoch === quotaEpoch && connection === quotaConnection && quota === nextQuota;
    if (!currentRequest()) return;
    armChannel('quota'); armStale(); quotaAlerts();
    if (currentRequest()) notify();
  }
  function receiveTask(value) {
    if (!isTaskId(value?.id)) return;
    const previous = tasks.get(value.id);
    if (value.removed) {
      terminalSeen.delete(value.id);
      idleTransitions.delete(value.id);
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
    if (!previous && tasks.size === 64) {
      const oldest = tasks.keys().next().value; tasks.delete(oldest); terminalSeen.delete(oldest);
      idleTransitions.delete(oldest);
    }
    tasks.set(task.id, task);
    const taskGeneration = generation;
    const taskEpoch = connectionEpoch;
    pruneAlerts();
    // onClear may replace the task baseline or connection while pruning.
    if (enabled && !closed && generation === taskGeneration && connectionEpoch === taskEpoch && tasks.get(task.id) === task) {
      taskAlerts(task, previous, value.baseline === true);
    }
    if (!previous || ['title', 'state', 'turnId', 'unavailable'].some(key => previous[key] !== task[key])) notify();
  }
  function receiveAccount(value) {
    const next = typeof value?.accountKey === 'string' ? value.accountKey.slice(0, 128) : null;
    if (accountKey === undefined) { accountKey = next; return; }
    if (next === accountKey) return;
    accountKey = next;
    generation++;
    const accountGeneration = generation;
    const accountEpoch = connectionEpoch;
    const accountConnection = connection;
    quota = { windows: [], updatedAt: null }; tasks.clear();
    clearAlerts({ dedupe: true, cooldown: true });
    clearTimer('stale');
    for (const name of Object.keys(channels)) {
      clearTimer(name); channels[name].state = 'connecting'; channels[name].code = null; channels[name].failures = 0;
    }
    onClear();
    if (enabled && !closed && generation === accountGeneration && connectionEpoch === accountEpoch
      && connection === accountConnection && accountKey === next) notify();
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
    clearAlerts({ dedupe: true, cooldown: true });
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
    const refreshGeneration = generation;
    stopConnection();
    const refreshEpoch = connectionEpoch;
    quotaNeedsBaseline = true;
    clearAlerts(); armStale();
    for (const task of tasks.values()) task.state = 'unknown';
    onClear();
    if (enabled && !closed && generation === refreshGeneration && connectionEpoch === refreshEpoch && connection === null) {
      await openConnection();
    }
    return true;
  }
  function close() {
    if (closed) return;
    closed = true;
    if (!enabled) return;
    enabled = false; generation++;
    finishDisable();
  }
  return { setEnabled, setPreferences, refresh, getSnapshot, dismiss, close };
}

module.exports = { createCodexCompanion };
