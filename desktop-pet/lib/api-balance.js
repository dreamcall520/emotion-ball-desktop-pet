const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readApiBalanceAccounts, watchApiBalanceAccounts, MAX_ACCOUNTS } = require('./api-balance-account');
const { fetchApiBalance, apiBalanceError, validAmount } = require('./api-balance-client');
const POLL_MS = 5 * 60000, WEEK_MS = 7 * 24 * 3600000, MAX_POINTS = 2016, MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = value => structuredClone(value);
function createApiBalance({ readAccounts = readApiBalanceAccounts, fetchBalance = fetchApiBalance,
  watchAccounts = watchApiBalanceAccounts, selectedAccountId = '', onSelectAccount = () => {},
  onChange = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout, historyFile } = {}) {
  // No configuration, credential, filesystem or network access before explicitly enabled.
  let enabled = false, closed = false, entries = [], selected = validId(selectedAccountId) ? selectedAccountId : '';
  let cache = new Map(), histories = {}, historyLoaded = false, historyProblem = false, historyBlocked = false;
  let configError = null, pollTimer = null, recoveryTimer = null, unwatch = null, flight = null, generation = 0;
  let lastRecoveryAt = -Infinity;
  const prune = points => points.filter(p => p.at >= now() - WEEK_MS && p.at <= now()).slice(-MAX_POINTS);
  const freshCache = () => ({ report: null, busy: false, error: null, errorCode: null, failures: 0, nextAt: 0 });
  function loadHistory() {
    if (historyLoaded) return;
    historyLoaded = true;
    if (typeof historyFile !== 'string') return;
    try {
      const stat = fs.lstatSync(historyFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_HISTORY_BYTES) throw Error();
      const raw = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (raw?.version !== 1 || !raw.accounts || typeof raw.accounts !== 'object' || Array.isArray(raw.accounts)
        || Object.keys(raw.accounts).length > 64) throw Error();
      const clean = {};
      for (const [id, points] of Object.entries(raw.accounts)) {
        if (!validId(id) || !Array.isArray(points) || points.length > MAX_POINTS || points.some((p, index) =>
          !p || !Number.isSafeInteger(p.at) || p.at < 0 || !validAmount(p.available) || !validAmount(p.cash)
          || !validAmount(p.voucher) || p.voucher < 0 || index && points[index - 1].at >= p.at)) throw Error();
        clean[id] = prune(points).map(({ at, available, cash, voucher }) => ({ at, available, cash, voucher }));
      }
      histories = clean;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { histories = {}; historyProblem = historyBlocked = true; }
    }
  }
  function appendHistory(id, report) {
    const point = { at: report.updatedAt, available: report.available, cash: report.cash, voucher: report.voucher };
    const points = prune(histories[id] || []), previous = points.at(-1);
    if (previous && point.at < previous.at) return;
    if (previous && point.at - previous.at < 60000) points[points.length - 1] = point;
    else points.push(point);
    histories[id] = points.slice(-MAX_POINTS);
    histories = Object.fromEntries(Object.entries(histories).map(([key, values]) => [key, prune(values)])
      .filter(([, values]) => values.length).sort((a, b) => b[1].at(-1).at - a[1].at(-1).at).slice(0, 64));
    if (typeof historyFile !== 'string' || historyBlocked) return;
    const temporary = `${historyFile}.${randomUUID()}.tmp`;
    try {
      const content = JSON.stringify({ version: 1, accounts: histories });
      if (Buffer.byteLength(content) > MAX_HISTORY_BYTES) throw Error();
      fs.mkdirSync(path.dirname(historyFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, historyFile); historyProblem = false;
    } catch (_) { try { fs.unlinkSync(temporary); } catch (_) {} historyProblem = true; }
  }
  const stale = row => Boolean(row?.report && (row.errorCode || configError || now() - row.report.updatedAt >= POLL_MS));
  function statusOf(entry, row) {
    if (!entry) return configError ? 'error' : 'empty';
    if (entry.status !== 'ready') return entry.status;
    if (row?.busy) return 'loading';
    if (row?.errorCode === 'UNAUTHENTICATED') return 'unauthenticated';
    if (stale(row)) return 'stale';
    if (configError || row?.errorCode) return 'error';
    return row?.report ? 'ready' : 'loading';
  }
  function getState() {
    const entry = entries.find(row => row.id === selected), row = cache.get(selected);
    const report = enabled && entry?.status === 'ready' ? row?.report || null : null;
    const error = configError || (entry?.errorCode ? apiBalanceError(entry.errorCode) : null)
      || (row?.errorCode ? apiBalanceError(row.errorCode) : null);
    return clone({ enabled, busy: Boolean(enabled && row?.busy), selectedAccountId: enabled ? selected : '',
      status: !enabled ? 'disabled' : statusOf(entry, row),
      accounts: enabled ? entries.map(item => {
        const state = cache.get(item.id), visible = item.status === 'ready';
        return { id: item.id, name: item.name, provider: item.provider, currency: item.currency,
          supported: item.supported, status: statusOf(item, state), report: visible ? state?.report || null : null,
          stale: visible && stale(state), busy: Boolean(visible && state?.busy) };
      }) : [],
      report, history: report ? prune(histories[selected] || []) : [], stale: Boolean(report && stale(row)),
      error: enabled ? error?.publicMessage || null : null, errorCode: enabled ? error?.code || null : null,
      nextRetryAt: enabled && row?.errorCode && row.nextAt > now() ? row.nextAt : null,
      historyError: enabled && historyProblem ? '余额趋势暂时无法保存，本次余额仍可更新。' : null });
  }
  function notify() { try { onChange(getState()); } catch (_) {} }
  function saveSelection(value) {
    if (selected === value) return;
    selected = value;
    try { onSelectAccount(value); } catch (_) {}
  }
  function stopFlight() {
    generation++;
    const previous = flight; flight = null;
    if (previous) { const row = cache.get(previous.id); if (row) row.busy = false; previous.controller.abort(); }
  }
  function syncAccounts() {
    try {
      const value = readAccounts();
      if (!Array.isArray(value) || value.length > MAX_ACCOUNTS || value.some(row => !validId(row?.id))) throw apiBalanceError('CONFIG_INVALID');
      entries = value; configError = null;
      for (const entry of entries) if (!cache.has(entry.id)) {
        const state = freshCache(), last = histories[entry.id]?.at(-1);
        if (last && entry.status === 'ready') state.report = { available: last.available, cash: last.cash,
          voucher: last.voucher, currency: 'CNY', updatedAt: last.at };
        cache.set(entry.id, state);
      }
      const visible = new Set(entries.map(row => row.id));
      if (flight && !entries.some(row => row.id === flight.id && row.status === 'ready')) stopFlight();
      for (const id of cache.keys()) if (!visible.has(id)) cache.delete(id);
      if (!visible.has(selected)) saveSelection(entries.find(row => row.status === 'ready')?.id
        || entries.find(row => row.supported)?.id || entries[0]?.id || '');
      return true;
    } catch (error) {
      configError = apiBalanceError(['CONFIG_INVALID', 'CONFIG_UNAVAILABLE'].includes(error?.code) ? error.code : 'CONFIG_INVALID');
      return false;
    }
  }
  function clearPoll() { if (pollTimer !== null) cancel(pollTimer); pollTimer = null; }
  function scheduleNext() {
    clearPoll();
    if (!enabled || closed || flight) return;
    const ready = entries.filter(row => row.status === 'ready').map(row => cache.get(row.id));
    const delay = configError || !ready.length ? POLL_MS : Math.max(500, Math.min(...ready.map(row => row.nextAt)) - now());
    pollTimer = schedule(() => { pollTimer = null; void tick(); }, delay); pollTimer?.unref?.();
  }
  function retryDelay(code, failures, retryAfterMs) {
    if (code === 'RATE_LIMITED') return Math.max(Number(retryAfterMs) || 0, Math.min(30 * 60000, POLL_MS * 2 ** Math.min(3, failures - 1)));
    if (['TIMEOUT', 'CONNECTION_FAILED', 'SERVICE_UNAVAILABLE'].includes(code)) return [5000, 15000, 60000][failures - 1] || POLL_MS;
    return POLL_MS;
  }
  function query(entry) {
    if (!enabled || closed || entry.status !== 'ready' || configError) return Promise.resolve(getState());
    if (flight?.id === entry.id) return flight.promise;
    if (flight) stopFlight();
    clearPoll();
    const row = cache.get(entry.id), current = ++generation, controller = new AbortController();
    row.busy = true; row.error = null; row.errorCode = null;
    const task = { id: entry.id, controller, promise: null }; flight = task;
    task.promise = (async () => {
      try {
        const result = await fetchBalance(entry, { signal: controller.signal });
        if (current !== generation || !enabled || closed) return getState();
        // Re-read after I/O: key removal/rotation must never publish an old account's result.
        if (!syncAccounts() || current !== generation || !entries.some(item => item.id === entry.id && item.status === 'ready')) return getState();
        const updatedAt = now();
        if (!validAmount(result?.available) || !validAmount(result?.cash) || !validAmount(result?.voucher)
          || result.voucher < 0 || result.currency !== 'CNY' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) throw apiBalanceError('INVALID_RESPONSE');
        row.report = { available: result.available, cash: result.cash, voucher: result.voucher, currency: 'CNY', updatedAt };
        row.failures = 0; row.error = null; row.errorCode = null; row.nextAt = now() + POLL_MS;
        appendHistory(entry.id, row.report);
      } catch (error) {
        if (current !== generation || !enabled || closed) return getState();
        const safe = apiBalanceError(error?.code); row.failures++;
        row.error = safe.publicMessage; row.errorCode = safe.code;
        if (safe.code === 'UNAUTHENTICATED') row.report = null;
        row.nextAt = now() + retryDelay(safe.code, row.failures, error?.retryAfterMs);
      } finally {
        if (flight === task) { row.busy = false; flight = null; scheduleNext(); notify(); }
        // syncAccounts can retire the current flight during its response check.
        else if (enabled && !closed && !flight) { scheduleNext(); notify(); }
      }
      return getState();
    })();
    notify();
    return task.promise;
  }
  async function tick() {
    if (!enabled || closed || flight) return getState();
    if (!syncAccounts()) { scheduleNext(); notify(); return getState(); }
    const due = entries.filter(entry => entry.status === 'ready' && cache.get(entry.id).nextAt <= now());
    const entry = due.find(row => row.id === selected) || due[0];
    if (entry) return query(entry);
    scheduleNext(); notify(); return getState();
  }
  function refresh() {
    if (!enabled || closed) return Promise.resolve(getState());
    if (!syncAccounts()) { scheduleNext(); notify(); return Promise.resolve(getState()); }
    const entry = entries.find(row => row.id === selected), row = cache.get(selected);
    if (!entry || entry.status !== 'ready' || row?.errorCode === 'RATE_LIMITED' && row.nextAt > now()) {
      scheduleNext(); notify(); return Promise.resolve(getState());
    }
    return query(entry);
  }
  function selectAccount(id) {
    if (!enabled || closed || !validId(id) || !entries.some(row => row.id === id)) return false;
    if (selected === id) return true;
    stopFlight(); saveSelection(id); notify();
    void refresh(); return true;
  }
  function recover(reason) {
    if (!enabled || closed || !['auth', 'resume', 'online'].includes(reason) || recoveryTimer !== null) return;
    recoveryTimer = schedule(() => {
      recoveryTimer = null; lastRecoveryAt = now();
      if (!enabled || closed) return;
      if (syncAccounts()) {
        for (const entry of entries) {
          const row = cache.get(entry.id);
          if (entry.status === 'ready' && !(row.errorCode === 'RATE_LIMITED' && row.nextAt > now())) row.nextAt = 0;
        }
      }
      if (!flight) void tick();
      notify();
    }, Math.max(500, lastRecoveryAt + 2000 - now()));
    recoveryTimer?.unref?.();
  }
  function stop() {
    clearPoll(); if (recoveryTimer !== null) cancel(recoveryTimer); recoveryTimer = null;
    unwatch?.(); unwatch = null; stopFlight();
  }
  function setEnabled(value) {
    if (closed || enabled === Boolean(value)) return;
    stop(); enabled = Boolean(value); lastRecoveryAt = -Infinity;
    if (!enabled) {
      entries = []; cache = new Map(); histories = {}; historyLoaded = false; historyProblem = historyBlocked = false; configError = null;
      notify(); return;
    }
    loadHistory(); syncAccounts();
    try { unwatch = watchAccounts(() => recover('auth')); } catch (_) {}
    notify(); void refresh();
  }
  function close() { if (closed) return; stop(); enabled = false; closed = true; entries = []; cache.clear(); histories = {}; }
  return { setEnabled, selectAccount, refresh, recover, getState, close };
}
module.exports = { createApiBalance, POLL_MS };
