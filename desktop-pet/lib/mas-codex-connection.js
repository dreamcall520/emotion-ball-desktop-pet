'use strict';
const { readCodexAccountUsage } = require('./codex-account-usage');

function statusCode(error) {
  if (['DIRECTORY_ACCESS_REQUIRED', 'AUTH_UNAVAILABLE'].includes(error?.code)) return ['missing', 'MISSING'];
  if (['LOGIN_REQUIRED', 'UNSUPPORTED_AUTH', 'INVALID_AUTH'].includes(error?.code)) return ['unauthenticated', 'UNAUTHENTICATED'];
  return ['disconnected', error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'DISCONNECTED'];
}
// This connection owns no subprocess, external socket or provider configuration.
function createMasCodexConnection({ directoryAccess, fetch, readUsage = readCodexAccountUsage,
  createTasks = options => require('./mas-codex-tasks').createMasCodexTasks(options),
  onQuota = () => {}, onTask = () => {}, onStatus = () => {}, onAccount = () => {},
  ignoreTask = () => false, ignoreThread = () => false, now = Date.now } = {}) {
  let closed = false, started = false, accountKey, generation = 0;
  const flights = new Map(), controllers = new Set(), previousTasks = new Map();
  const tasks = createTasks({ directoryAccess, ignoreTask, ignoreThread, now });
  const report = (channel, state, code = null) => { if (!closed) onStatus({ channel, state, code, ...(channel === 'tasks' ? { partial: true } : {}) }); };
  function poll(channel) {
    if (closed || !started) return Promise.resolve();
    if (flights.has(channel)) return flights.get(channel);
    const controller = new AbortController(), epoch = generation;
    controllers.add(controller);
    report(channel, 'connecting');
    const flight = Promise.resolve().then(async () => {
      if (channel === 'quota') {
        const snapshot = await readUsage({ directoryAccess, fetch, signal: controller.signal, now, includeAccountKey: true });
        if (closed || epoch !== generation) return;
        if (snapshot.accountKey !== accountKey) {
          accountKey = snapshot.accountKey; previousTasks.clear(); onAccount({ accountKey });
        }
        const windows = snapshot.windows.map(window => ({ id: window.id, label: 'Codex',
          windowMinutes: window.windowMinutes, remaining: window.usedPercent === null ? null : 100 - window.usedPercent,
          resetsAt: window.resetsAt }));
        onQuota({ windows, updatedAt: snapshot.updatedAt, source: snapshot.source });
        report(channel, windows.length ? 'connected' : 'unsupported', windows.length ? null : 'UNSUPPORTED');
      } else {
        const result = await tasks.read({ signal: controller.signal });
        if (closed || epoch !== generation) return;
        const rows = Array.isArray(result) ? result : result.items || [];
        const seen = new Set();
        for (const row of rows) {
          if (ignoreTask(row.id)) continue;
          seen.add(row.id); previousTasks.set(row.id, row); onTask(row);
        }
        for (const [id, row] of previousTasks) if (!seen.has(id)) {
          onTask({ ...row, state: 'unknown', partial: true, updatedAt: now() }); previousTasks.delete(id);
        }
        report(channel, 'connected');
      }
    }).catch(error => { if (!closed && epoch === generation) report(channel, ...statusCode(error)); })
      .finally(() => { controllers.delete(controller); if (flights.get(channel) === flight) flights.delete(channel); });
    flights.set(channel, flight); return flight;
  }
  function refresh({ quota = true, tasks = true } = {}) {
    return Promise.all([...(quota ? [poll('quota')] : []), ...(tasks ? [poll('tasks')] : [])]).then(() => undefined);
  }
  function start() { if (closed) return Promise.resolve(); started = true; return refresh(); }
  function close() { if (closed) return; closed = true; generation++; for (const c of controllers) c.abort(); controllers.clear(); previousTasks.clear(); }
  return { start, refresh, retry: refresh, close };
}
module.exports = { createMasCodexConnection };
