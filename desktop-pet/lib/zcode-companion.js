const { readZcodeConnection } = require('./zcode-account');
const { fetchZcodeUsage } = require('./zcode-usage');
const { createZcodeQuotaHistory } = require('./zcode-quota-history');
const POLL_MS = Object.freeze({ quota: 120000, tasks: 15000 });
const TEAM_ERRORS = new Set(['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED']);
const clone = value => JSON.parse(JSON.stringify(value));
const codeFor = error => ['ZCODE_ACCOUNT_MISSING', 'ZCODE_CREDENTIAL_DECRYPT_FAILED', 'ZCODE_PROVIDER_UNSUPPORTED',
  'ZCODE_LOGIN_REQUIRED', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR', 'ZCODE_BILLING_ERROR', 'ZCODE_USAGE_UNAVAILABLE',
  'ZCODE_INVALID_RESPONSE', 'ZCODE_INVALID_ACCOUNT_FILE'].includes(error?.code) || TEAM_ERRORS.has(error?.code) ? error.code : 'ZCODE_UNAVAILABLE';
function createZcodeCompanion({ filePath, onChange = () => {}, now = Date.now, readAccount = readZcodeConnection,
  fetchUsage = fetchZcodeUsage, readTasks = options => require('./zcode-tasks').readZcodeTasks(options),
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let enabled = false; let closed = false; let generation = 0; let lifecycle = 0; let accountKey = null; let family = null;
  let hasCustomProviders = false;
  let quota = { state: 'disabled', windows: [], updatedAt: null, code: null };
  let tasks = { state: 'disabled', items: [], results: [], updatedAt: null, code: null };
  const history = createZcodeQuotaHistory({ filePath, now }); const timers = new Map(); const flights = {}; const observedLive = new Set();
  const stale = () => Boolean(quota.code) || quota.updatedAt === null || now() < quota.updatedAt || now() - quota.updatedAt >= 300000;
  function getSnapshot() {
    const stored = history.getState(); const known = ['connected', 'active', 'idle'].includes(tasks.state);
    return clone({ sourceId: 'zcode', enabled, generation, state: quota.state, accountKey, family, hasCustomProviders,
      quotaUpdatedAt: quota.updatedAt, buckets: quota.windows,
      quota: { ...quota, buckets: quota.windows, stale: stale() }, tasks, history: stored,
      activity: { runningCount: enabled && known ? tasks.items.filter(row => ['active', 'waiting'].includes(row.state)).length : null,
        unreadCount: enabled && stored.available ? stored.results.filter(row => row.readAt === null).length : null } });
  }
  const taskKey = row => typeof row?.turnId === 'string' && row.turnId.length > 0
    ? JSON.stringify([row.id, row.turnId]) : null;
  function recordHistory() {
    const snapshot = getSnapshot();
    // Existing terminal rows are not new results unless this run observed that turn executing.
    snapshot.tasks.results = snapshot.tasks.results.filter(row => observedLive.has(taskKey(row)));
    history.record(snapshot);
  }
  function observeLiveTasks() {
    for (const row of tasks.items) {
      const key = taskKey(row);
      if (!key || row.liveVerified !== true || !['active', 'waiting'].includes(row.state)) continue;
      observedLive.delete(key); observedLive.add(key);
    }
    while (observedLive.size > 64) observedLive.delete(observedLive.values().next().value);
  }
  function notify() { try { onChange(getSnapshot()); } catch (_ignored) {} }
  function abortFlights() { for (const flight of Object.values(flights)) flight.controller.abort(); }
  function clearTimers() { for (const handle of timers.values()) cancel(handle); timers.clear(); }
  function arm(name, delay, callback) {
    if (timers.has(name)) cancel(timers.get(name)); timers.delete(name);
    if (!enabled || closed) return;
    const handle = schedule(() => { if (timers.get(name) !== handle) return; timers.delete(name); callback(); }, Math.max(0, delay));
    handle?.unref?.(); timers.set(name, handle);
  }
  function switchAccount(account) {
    hasCustomProviders = account.personal?.hasConfigured === true;
    if (accountKey === account.accountKey) return;
    generation++; abortFlights(); observedLive.clear(); accountKey = account.accountKey; family = account.family || null; history.setAccount(accountKey);
    quota = { state: 'connecting', windows: [], updatedAt: null, code: null };
    tasks = { state: 'connecting', items: [], results: [], updatedAt: null, code: null }; notify();
  }
  function accountFailure(error) {
    generation++; abortFlights(); observedLive.clear(); accountKey = null; family = null; hasCustomProviders = false; history.setAccount(null);
    const code = codeFor(error); const state = code === 'ZCODE_ACCOUNT_MISSING' ? 'missing'
      : ['ZCODE_CREDENTIAL_DECRYPT_FAILED', 'ZCODE_LOGIN_REQUIRED'].includes(code) ? 'unauthenticated' : 'disconnected';
    quota = { state, windows: [], updatedAt: null, code }; tasks = { state, items: [], results: [], updatedAt: null, code }; notify();
  }
  async function poll(kind) {
    if (!enabled || closed) return;
    const startGeneration = generation; const startLifecycle = lifecycle; let account;
    try { account = await readAccount(); }
    catch (error) { if (enabled && !closed && startLifecycle === lifecycle && startGeneration === generation) accountFailure(error);
      if (enabled && !closed && startLifecycle === lifecycle) arm(kind, POLL_MS[kind], () => poll(kind)); return; }
    if (!enabled || closed || startLifecycle !== lifecycle || startGeneration !== generation && accountKey !== account?.accountKey) return;
    if (!account?.accountKey) { accountFailure({ code: 'ZCODE_LOGIN_REQUIRED' }); arm(kind, POLL_MS[kind], () => poll(kind)); return; }
    switchAccount(account);
    if (account.family === 'custom') {
      quota = { state: 'unsupported', windows: [], updatedAt: null, code: null };
      tasks = { state: 'unknown', items: [], results: [], updatedAt: null, code: null };
      notify(); arm(kind, POLL_MS[kind], () => poll(kind)); return;
    }
    const currentGeneration = generation; const key = accountKey;
    if (flights[kind]?.generation === currentGeneration) return flights[kind].promise;
    const flight = { generation: currentGeneration, controller: new AbortController() };
    flight.promise = (async () => {
      try {
        const result = await (kind === 'quota' ? fetchUsage(account, { now, signal: flight.controller.signal }) : readTasks({ account, now: now(), signal: flight.controller.signal }));
        if (!enabled || closed || generation !== currentGeneration || key !== accountKey) return;
        let latest;
        try { latest = await readAccount(); } catch (error) {
          if (enabled && !closed && generation === currentGeneration && key === accountKey) accountFailure(error);
          return;
        }
        if (!enabled || closed || generation !== currentGeneration) return;
        if (latest.accountKey !== key) { switchAccount(latest); arm('account-change', 0, () => refresh()); return; }
        hasCustomProviders = latest.personal?.hasConfigured === true;
        if (kind === 'quota') {
          const windows = Array.isArray(result?.buckets) ? result.buckets : Array.isArray(result?.windows) ? result.windows : [];
          quota = { state: 'connected', windows: windows.slice(0, 64), updatedAt: now(), code: null,
            balanceState: result?.balanceState || null, paidState: result?.paidState || null };
          arm('stale', 300000, notify);
        } else {
          const state = ['active', 'idle', 'connected'].includes(result?.state) ? 'connected' : 'unknown';
          const safeRows = rows => (Array.isArray(rows) ? rows.slice(0, 64) : []).flatMap(row => {
            if (typeof row?.id !== 'string' || !row.id || row.id.length > 200) return [];
            return [{ id: row.id, title: typeof row.title === 'string' ? row.title.slice(0, 140) : '未命名任务',
              state: ['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle'].includes(row.state) ? row.state : 'unknown',
              liveVerified: row.liveVerified === true,
              turnId: typeof row.turnId === 'string' ? row.turnId.slice(0, 200) : null,
              updatedAt: Number.isSafeInteger(row.updatedAt) ? row.updatedAt : null }];
          });
          tasks = { state, liveState: result?.state || 'unknown', items: safeRows(result?.items), results: safeRows(result?.results), updatedAt: now(), code: null };
        }
        recordHistory();
        if (kind === 'tasks') observeLiveTasks();
        notify();
      } catch (error) {
        if (!enabled || closed || generation !== currentGeneration || key !== accountKey) return;
        const code = codeFor(error);
        if (kind === 'quota') quota = { ...quota, state: code === 'ZCODE_LOGIN_REQUIRED' ? 'unauthenticated'
          : TEAM_ERRORS.has(code) || quota.updatedAt === null ? 'disconnected' : 'connected', code,
          queryFailed: code !== 'ZCODE_LOGIN_REQUIRED' && !TEAM_ERRORS.has(code) };
        else tasks = { ...tasks, state: 'unknown', items: [], results: [], code };
        notify();
      } finally {
        if (flights[kind] === flight) delete flights[kind];
        if (enabled && !closed && generation === currentGeneration) arm(kind, POLL_MS[kind], () => poll(kind));
      }
    })();
    flights[kind] = flight; return flight.promise;
  }
  async function refresh() { if (!enabled || closed) return getSnapshot(); await Promise.all([poll('quota'), poll('tasks')]); return getSnapshot(); }
  async function setEnabled(value) {
    if (closed || enabled === (value === true)) return getSnapshot();
    enabled = value === true; lifecycle++; generation++; clearTimers(); abortFlights(); observedLive.clear();
    if (!enabled) {
      accountKey = null; family = null; hasCustomProviders = false; history.setAccount(null);
      quota = { state: 'disabled', windows: [], updatedAt: null, code: null };
      tasks = { state: 'disabled', items: [], results: [], updatedAt: null, code: null }; notify(); return getSnapshot();
    }
    quota.state = 'connecting'; tasks.state = 'connecting'; notify(); return refresh();
  }
  function markAllRead() { const changed = history.markAllRead(); if (changed) notify(); return changed; }
  function close() { closed = true; enabled = false; lifecycle++; generation++; clearTimers(); abortFlights(); observedLive.clear(); history.close(); accountKey = null; hasCustomProviders = false; }
  return { setEnabled, refresh, getSnapshot, close, markAllRead };
}
module.exports = { createZcodeCompanion, POLL_MS };
