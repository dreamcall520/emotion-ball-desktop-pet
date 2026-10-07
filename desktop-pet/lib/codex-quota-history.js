const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isTaskId, quotaResetDetails } = require('./codex-state');

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ACCOUNTS = 4;
const MAX_CYCLES = 8;
const MAX_SAMPLES = Object.freeze({ 300: 192, 10080: 6000 });
const MAX_RESULTS = 64;
const MAX_IMPORT_SAMPLES = 12000;
const RESET_TOLERANCE_MS = 1000;
const STALE_MS = 300000;
const MIN_SAMPLE_MS = 60000;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validRemaining = value => Number.isFinite(value) && value >= 0 && value <= 100;
const clone = value => JSON.parse(JSON.stringify(value));
const blankAccount = () => ({ updatedAt: 0, windows: [], results: [], resetHistory: [] });

const validCycle = row => typeof row?.id === 'string' && row.id.length <= 200 && row.id.startsWith('codex:')
  && [300, 10080].includes(row.windowMinutes) && validTime(row.resetsAt);
const sameCycle = (row, window) => row.id === window.id && row.windowMinutes === window.windowMinutes
  && Math.abs(row.resetsAt - window.resetsAt) <= RESET_TOLERANCE_MS;

function mergeSamples(samples, cycle) {
  const byTime = new Map();
  for (const sample of samples) {
    if (validTime(sample?.at) && validRemaining(sample.remaining)
      && sample.at >= cycle.resetsAt - cycle.windowMinutes * 60000 - RESET_TOLERANCE_MS
      && sample.at <= cycle.resetsAt + RESET_TOLERANCE_MS) {
      byTime.set(sample.at, { at: sample.at, remaining: sample.remaining });
    }
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at).slice(-MAX_SAMPLES[cycle.windowMinutes]);
}

function cycleFor(account, window) {
  const matches = account.windows.filter(row => sameCycle(row, window));
  const cycle = matches[0] || { id: window.id, windowMinutes: window.windowMinutes,
    resetsAt: window.resetsAt, samples: [] };
  if (matches.length > 1) cycle.samples = mergeSamples(matches.flatMap(row => row.samples), cycle);
  account.windows = [...account.windows.filter(row => !matches.includes(row)), cycle];
  return cycle;
}

function safeResult(row) {
  if (!isTaskId(row?.id) || typeof row.turnId !== 'string' || !row.turnId || row.turnId.length > 160
    || !['completed', 'failed', 'interrupted'].includes(row.state) || !validTime(row.updatedAt)) return null;
  return { id: row.id, turnId: row.turnId, title: typeof row.title === 'string' ? row.title.slice(0, 140) : '未命名任务',
    state: row.state, updatedAt: row.updatedAt, readAt: validTime(row.readAt) ? row.readAt : null };
}

function safeAccount(raw) {
  const account = blankAccount();
  account.updatedAt = validTime(raw?.updatedAt) ? raw.updatedAt : 0;
  for (const row of Array.isArray(raw?.windows) ? raw.windows.slice(-MAX_CYCLES) : []) {
    if (!validCycle(row)) continue;
    const cycle = cycleFor(account, row);
    cycle.samples = mergeSamples([...cycle.samples,
      ...(Array.isArray(row.samples) ? row.samples.slice(-MAX_SAMPLES[row.windowMinutes]) : [])], cycle);
  }
  const keys = new Set();
  for (const rawRow of Array.isArray(raw?.results) ? raw.results.slice(-MAX_RESULTS) : []) {
    const row = safeResult(rawRow); const key = row && JSON.stringify([row.id, row.turnId]);
    if (row && !keys.has(key)) { keys.add(key); account.results.push(row); }
  }
  const rows = quotaResetDetails({ resetOpportunities: raw?.resetHistory }).resetOpportunities || [];
  account.resetHistory = rows.filter(row => row.status === 'redeemed' || (typeof row.expiresAt === 'number'
    && row.expiresAt <= account.updatedAt)).slice(-64);
  return account;
}

// This store owns no timer or connection. Only fresh, enabled observations write.
function createQuotaHistory({ filePath, now = Date.now, onError = () => {} } = {}) {
  let accounts = {};
  let accountKey = null;
  let closed = false;
  function reportError(code) { try { if (typeof onError === 'function') onError(code); } catch (_ignored) {} }
  if (typeof filePath === 'string') {
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('INVALID_HISTORY_FILE');
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw?.version === 1 && raw.accounts && typeof raw.accounts === 'object') {
        for (const [key, account] of Object.entries(raw.accounts).slice(0, MAX_ACCOUNTS)) {
          if (/^[a-f0-9]{64}$/.test(key)) accounts[key] = safeAccount(account);
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') reportError('HISTORY_READ_FAILED'); }
  }
  function persist() {
    if (typeof filePath !== 'string') return;
    const temporary = `${filePath}.tmp`;
    try {
      let data = JSON.stringify({ version: 1, accounts });
      while (Buffer.byteLength(data) > MAX_BYTES) {
        const ordered = Object.entries(accounts).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const removableCycle = ordered.find(([, account]) => account.windows.length > 1);
        const removableAccount = ordered.find(([key]) => key !== accountKey);
        if (removableCycle) removableCycle[1].windows.shift();
        else if (removableAccount) delete accounts[removableAccount[0]];
        else {
          const samples = accounts[accountKey]?.windows[0]?.samples;
          if (!samples || samples.length < 2) throw new Error('HISTORY_TOO_LARGE');
          samples.splice(0, Math.ceil(samples.length / 2));
        }
        data = JSON.stringify({ version: 1, accounts });
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, data, { mode: 0o600 });
      fs.renameSync(temporary, filePath);
    } catch (_error) {
      try { fs.unlinkSync(temporary); } catch (_ignored) {}
      reportError('HISTORY_WRITE_FAILED');
    }
  }
  function setAccount(value) {
    accountKey = !closed && typeof value === 'string' && value.length > 0 && value.length <= 128
      ? createHash('sha256').update(value).digest('hex') : null;
  }
  function getState() {
    const account = accountKey ? accounts[accountKey] : null;
    return clone(account ? { available: true, windows: account.windows, results: account.results, resetHistory: account.resetHistory }
      : { available: accountKey !== null, windows: [], results: [], resetHistory: [] });
  }
  function saveAccount(account, time) {
    account.updatedAt = time;
    account.windows = account.windows.slice(-MAX_CYCLES);
    accounts[accountKey] = account;
    const ordered = Object.entries(accounts).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    accounts = Object.fromEntries(ordered.slice(0, MAX_ACCOUNTS));
    persist();
  }
  function importSamples(trustedWindows, samples) {
    const time = now();
    if (closed || !accountKey || !validTime(time) || !Array.isArray(samples)
      || samples.length > MAX_IMPORT_SAMPLES) return false;
    const trusted = (Array.isArray(trustedWindows) ? trustedWindows.slice(0, 64) : [])
      .filter(window => validCycle(window) && window.resetsAt > time);
    const account = accounts[accountKey] || blankAccount();
    const before = JSON.stringify(account);
    const imported = new Map();
    for (const sample of samples) {
      if (!validCycle(sample) || !validTime(sample.at) || sample.at > time || !validRemaining(sample.remaining)) continue;
      const window = trusted.find(row => sameCycle(row, sample)
        && sample.at >= row.resetsAt - row.windowMinutes * 60000);
      if (!window) continue;
      const key = JSON.stringify([window.id, window.windowMinutes, window.resetsAt]);
      if (!imported.has(key)) imported.set(key, { window, samples: [] });
      imported.get(key).samples.push({ at: sample.at, remaining: sample.remaining });
    }
    for (const group of imported.values()) {
      const cycle = cycleFor(account, group.window);
      // Local observations win when a rollout repeats an already sampled timestamp.
      cycle.samples = mergeSamples([...group.samples, ...cycle.samples], cycle);
    }
    if (JSON.stringify(account) === before) return false;
    saveAccount(account, time);
    return true;
  }
  function record(snapshot) {
    const time = now();
    if (closed || !accountKey || snapshot?.enabled !== true || !validTime(time)) return false;
    const account = accounts[accountKey] || blankAccount();
    const before = JSON.stringify(account);
    const quota = snapshot.quota;
    if (quota?.state === 'connected' && quota.stale === false && validTime(quota.updatedAt)
      && quota.updatedAt <= time && time - quota.updatedAt < STALE_MS) {
      const at = quota.updatedAt;
      for (const window of Array.isArray(quota.windows) ? quota.windows.slice(0, 64) : []) {
        if (!validCycle(window) || !validRemaining(window.remaining) || window.resetsAt <= time
          || at < window.resetsAt - window.windowMinutes * 60000) continue;
        const cycle = cycleFor(account, window);
        const previous = cycle.samples.at(-1);
        if (previous && at <= previous.at) continue;
        // Retain interruptions/corrections; the trend and forecast split at these boundaries.
        const interrupted = previous && (window.remaining > previous.remaining
          || previous.remaining - window.remaining >= 25 || at - previous.at >= STALE_MS);
        if (previous && !interrupted && at - previous.at < MIN_SAMPLE_MS) continue;
        cycle.samples.push({ at, remaining: window.remaining });
        cycle.samples = cycle.samples.slice(-MAX_SAMPLES[window.windowMinutes]);
      }
      const resetRows = quotaResetDetails(quota).resetOpportunities;
      for (const row of resetRows || []) {
        if (row.status !== 'redeemed' && !(typeof row.expiresAt === 'number' && row.expiresAt <= time)) continue;
        const index = account.resetHistory.findIndex(old => old.id === row.id);
        if (index === -1) account.resetHistory.push(row); else account.resetHistory[index] = row;
      }
      account.resetHistory = account.resetHistory.slice(-64);
      account.windows = account.windows.slice(-MAX_CYCLES);
    }
    for (const raw of Array.isArray(snapshot.tasks?.results) ? snapshot.tasks.results.slice(-MAX_RESULTS) : []) {
      const row = safeResult(raw);
      if (!row || row.updatedAt > time) continue;
      const previous = account.results.find(item => item.id === row.id && item.turnId === row.turnId);
      if (!previous) account.results.push({ ...row, readAt: null });
      else previous.title = row.title;
    }
    account.results = account.results.slice(-MAX_RESULTS);
    if (JSON.stringify(account) === before) return false;
    saveAccount(account, time);
    return true;
  }
  function markRead(id, turnId) {
    const time = now();
    if (closed || !accountKey || !validTime(time) || !isTaskId(id) || (turnId != null && typeof turnId !== 'string')) return false;
    const account = accounts[accountKey];
    if (!account) return false;
    let changed = false;
    for (const row of account.results) if (row.id === id && (turnId == null || row.turnId === turnId) && row.readAt === null) {
      row.readAt = time; changed = true;
    }
    if (changed) { account.updatedAt = time; persist(); }
    return changed;
  }
  return { setAccount, record, importSamples, markRead, getState, close() { closed = true; accountKey = null; } };
}

module.exports = { createQuotaHistory };
