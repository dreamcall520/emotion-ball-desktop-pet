const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ACCOUNTS = 4; const MAX_CYCLES = 32; const MAX_SAMPLES = 1440; const MAX_RESULTS = 64;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validRemaining = value => Number.isFinite(value) && value >= 0 && value <= 100;
const validCycle = row => typeof row?.id === 'string' && row.id.startsWith('zcode:') && row.id.length <= 400
  && Number.isFinite(row.windowMinutes) && row.windowMinutes > 0 && validTime(row.periodStart)
  && validTime(row.resetsAt) && row.resetsAt > row.periodStart;
const sameCycle = (a, b) => a.id === b.id && a.periodStart === b.periodStart && a.resetsAt === b.resetsAt;
const blank = () => ({ updatedAt: 0, windows: [], results: [] });
const clone = value => JSON.parse(JSON.stringify(value));
function safeResult(row) {
  if (typeof row?.id !== 'string' || !row.id || row.id.length > 200 || typeof row.turnId !== 'string'
    || !row.turnId || row.turnId.length > 200 || !['completed', 'failed', 'interrupted'].includes(row.state)
    || !validTime(row.updatedAt)) return null;
  return { id: row.id, turnId: row.turnId, title: typeof row.title === 'string' ? row.title.slice(0, 140) : '未命名任务',
    state: row.state, updatedAt: row.updatedAt, readAt: validTime(row.readAt) ? row.readAt : null };
}
function safeAccount(raw) {
  const account = blank(); account.updatedAt = validTime(raw?.updatedAt) ? raw.updatedAt : 0;
  for (const row of Array.isArray(raw?.windows) ? raw.windows.slice(-MAX_CYCLES) : []) {
    if (!validCycle(row)) continue;
    const samples = new Map();
    for (const sample of Array.isArray(row.samples) ? row.samples.slice(-MAX_SAMPLES) : []) {
      if (validTime(sample?.at) && sample.at >= row.periodStart && sample.at <= row.resetsAt && validRemaining(sample.remaining)) {
        samples.set(sample.at, { at: sample.at, remaining: sample.remaining });
      }
    }
    account.windows.push({ id: row.id, bucketId: row.id, windowMinutes: row.windowMinutes,
      periodStart: row.periodStart, resetsAt: row.resetsAt, samples: [...samples.values()].sort((a, b) => a.at - b.at) });
  }
  const seen = new Set();
  for (const rawRow of Array.isArray(raw?.results) ? raw.results.slice(-MAX_RESULTS) : []) {
    const row = safeResult(rawRow); const key = row && JSON.stringify([row.id, row.turnId]);
    if (row && !seen.has(key)) { seen.add(key); account.results.push(row); }
  }
  return account;
}
function createZcodeQuotaHistory({ filePath, now = Date.now, onError = () => {} } = {}) {
  let accounts = {}; let accountKey = null; let closed = false;
  const report = code => { try { onError(code); } catch (_ignored) {} };
  if (typeof filePath === 'string') try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw.version === 1 && raw.accounts && typeof raw.accounts === 'object') {
      for (const [key, account] of Object.entries(raw.accounts).slice(0, MAX_ACCOUNTS)) {
        if (/^[a-f0-9]{64}$/.test(key)) accounts[key] = safeAccount(account);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') report('ZCODE_HISTORY_READ_FAILED'); }
  function persist() {
    if (typeof filePath !== 'string') return true;
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      let data = JSON.stringify({ version: 1, accounts });
      while (Buffer.byteLength(data) > MAX_BYTES) {
        const ordered = Object.entries(accounts).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const other = ordered.find(([key]) => key !== accountKey);
        if (other) delete accounts[other[0]];
        else if (accounts[accountKey]?.windows.length > 1) accounts[accountKey].windows.shift();
        else throw new Error();
        data = JSON.stringify({ version: 1, accounts });
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, filePath); return true;
    } catch (_error) { try { fs.unlinkSync(temporary); } catch (_ignored) {} report('ZCODE_HISTORY_WRITE_FAILED'); return false; }
  }
  function setAccount(value) {
    accountKey = !closed && typeof value === 'string' && value.length > 0 && value.length <= 256
      ? createHash('sha256').update(value).digest('hex') : null;
  }
  function getState() { return clone({ available: accountKey !== null,
    windows: accounts[accountKey]?.windows || [], results: accounts[accountKey]?.results || [] }); }
  function record(snapshot) {
    const at = now(); if (closed || !accountKey || snapshot?.enabled !== true || !validTime(at)) return false;
    const account = accounts[accountKey] || blank(); const before = JSON.stringify(account);
    const quota = snapshot.quota;
    if (quota?.state === 'connected' && quota.stale === false && validTime(quota.updatedAt)
      && quota.updatedAt <= at && at - quota.updatedAt < 300000) {
      for (const window of Array.isArray(quota.windows) ? quota.windows.slice(0, 64) : []) {
        if (!validCycle(window) || !validRemaining(window.remaining) || window.resetsAt <= at || quota.updatedAt < window.periodStart) continue;
        let cycle = account.windows.find(row => sameCycle(row, window));
        if (!cycle) { cycle = { id: window.id, bucketId: window.id, windowMinutes: window.windowMinutes,
          periodStart: window.periodStart, resetsAt: window.resetsAt, samples: [] }; account.windows.push(cycle); }
        const previous = cycle.samples.at(-1);
        if (previous && (quota.updatedAt <= previous.at || quota.updatedAt - previous.at < 60000)) continue;
        cycle.samples.push({ at: quota.updatedAt, remaining: window.remaining }); cycle.samples = cycle.samples.slice(-MAX_SAMPLES);
      }
    }
    for (const raw of Array.isArray(snapshot.tasks?.results) ? snapshot.tasks.results.slice(-MAX_RESULTS) : []) {
      const row = safeResult(raw); if (!row || row.updatedAt > at) continue;
      const previous = account.results.find(item => item.id === row.id && item.turnId === row.turnId);
      if (!previous) account.results.push({ ...row, readAt: null });
    }
    account.windows = account.windows.slice(-MAX_CYCLES); account.results = account.results.slice(-MAX_RESULTS);
    if (JSON.stringify(account) === before) return false;
    account.updatedAt = at; accounts[accountKey] = account;
    accounts = Object.fromEntries(Object.entries(accounts).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_ACCOUNTS));
    return persist();
  }
  function markAllRead() {
    const at = now(); const account = accounts[accountKey]; if (closed || !account || !validTime(at)) return false;
    const unread = account.results.filter(row => row.readAt === null); if (!unread.length) return false;
    unread.forEach(row => { row.readAt = at; }); if (persist()) return true;
    unread.forEach(row => { row.readAt = null; }); return false;
  }
  return { setAccount, getState, record, markAllRead, close() { closed = true; accountKey = null; } };
}
module.exports = { createZcodeQuotaHistory };
