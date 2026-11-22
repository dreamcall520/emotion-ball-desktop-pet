'use strict';

const PURPOSE = 'zcode-quota-device-tasks-v1';
const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validRecord = value => value?.purpose === PURPOSE && value.version === 1 && validAccount(value.accountKey);
const fail = code => Object.assign(new Error(code), { code });

// Main/account consent, optional device-task consent and the enabled preference
// are distinct. Transient loss/cancellation suspends reads without saving false.
function createMasZcodeQuotaConnection({ access, readAccount, link, storage,
  onChange = () => {}, onAccountChanged = () => {} }) {
  let enabled = false, authorized = false, tasksAuthorized = false, accountKey = null;
  let epoch = 0, taskEpoch = 0, closed = false, pending = Promise.resolve(), accountFlight = null, connecting = null;
  const queue = operation => {
    const result = pending.catch(() => {}).then(operation);
    pending = result.then(() => {}, () => {}); return result;
  };
  const check = (owner, signal, taskOwner) => {
    if (closed || owner !== epoch || signal?.aborted || taskOwner !== undefined && taskOwner !== taskEpoch) throw fail('CANCELLED');
  };
  function notify() { try { onChange(); } catch {} }
  function accountChanged() { try { onAccountChanged(); } catch {} }
  function suspend() {
    // Never fall back to setEnabled(false): that API saves a user preference.
    try { return Promise.resolve(link.suspend?.()).catch(() => {}); } catch { return Promise.resolve(); }
  }
  function getState() {
    const snapshot = closed ? null : link.getSnapshot(), quota = snapshot?.quota;
    const connected = enabled && authorized && !closed;
    const status = !enabled || closed ? 'disconnected' : !authorized ? 'needs-authorization'
      : quota?.code ? 'error' : quota?.updatedAt != null ? 'ready' : 'connecting';
    return { enabled: enabled && !closed, connected, status,
      message: !enabled || closed ? '尚未连接本机 ZCode。' : !authorized ? '请重新连接并确认当前 ZCode 账号。'
        : status === 'error' ? '额度暂未读取成功，可在 ZCode 中核对当前套餐后刷新。'
        : status === 'ready' ? '额度已更新，体验与付费套餐分别展示。' : '已连接，正在查询额度…',
      tasks: { authorized: connected && tasksAuthorized,
        status: !connected ? 'needs-connection' : tasksAuthorized ? 'ready' : 'needs-authorization',
        message: '仅显示授权目录中的本机任务，不代表当前账号的全部任务。' },
      chat: { enabled: false, authorized: false, status: 'scope-unavailable',
        message: '聊天需完成当前官方账号的连接授权。' } };
  }
  function invalidate() {
    ++epoch; ++taskEpoch; authorized = tasksAuthorized = false; accountKey = null;
    void suspend(); accountChanged(); notify();
  }
  async function verifyAccount({ signal } = {}) {
    const owner = epoch, expected = accountKey;
    if (!enabled || !authorized || !expected || closed) throw fail('DIRECTORY_ACCESS_REQUIRED');
    const selected = await readAccount(); check(owner, signal);
    if (selected?.accountKey !== expected) { invalidate(); throw fail('ACCOUNT_CHANGED'); }
    return expected;
  }
  async function rollbackSaved(previous) {
    if (previous === undefined || previous === null) await storage.remove('zcode');
    else await storage.save('zcode', previous);
  }
  function rollbackRuntime(attempt) {
    if (!attempt.runtimeStarted) return;
    ({ enabled, authorized, tasksAuthorized, accountKey } = attempt.previous);
    if (!authorized) void suspend();
    notify();
  }
  async function activate(owner, signal, saved) {
    const selected = await readAccount(); check(owner, signal);
    if (!validAccount(selected?.accountKey)) throw fail('ZCODE_LOGIN_REQUIRED');
    if (saved.accountKey !== selected.accountKey) throw fail('ACCOUNT_CHANGED');
    enabled = authorized = true; accountKey = selected.accountKey; tasksAuthorized = saved.tasks === true;
    // Connection consent is committed before starting a potentially long quota
    // request. Closing its settings window after this point is not a disconnect.
    // The link's suspension revision cancels a still-pending consent continuation.
    const startup = Promise.resolve(link.setEnabled(true)); startup.catch(() => {}); check(owner, signal);
    void Promise.resolve(startup).then(async result => {
      check(owner);
      if (result === false) throw fail('ZCODE_CONNECTION_UNAVAILABLE');
      await verifyAccount(); check(owner); notify();
    }).catch(error => { if (owner === epoch && !closed && error.code !== 'CANCELLED') invalidate(); });
    notify(); return getState();
  }
  return {
    getState,
    getAccountKey: () => enabled && authorized && !closed ? accountKey : null,
    getGeneration: () => epoch,
    isTasksAuthorized: () => enabled && authorized && tasksAuthorized && !closed,
    verifyAccount,
    authorize: (step, signal) => closed ? Promise.resolve({ status: 'cancelled' }) : access.ensure({ interactive: true, step, signal }),
    cancel() {
      ++epoch; ++taskEpoch; access.clearPendingApp();
      if (connecting) rollbackRuntime(connecting);
      return { status: 'cancelled' };
    },
    connect(signal) {
      const owner = ++epoch;
      return queue(async () => {
        check(owner, signal);
        const attempt = { owner, runtimeStarted: false, previous: { enabled, authorized, tasksAuthorized, accountKey } };
        connecting = attempt; let previousSaved, wrote = false, committed = false;
        try {
          const grant = await access.ensure({ interactive: false, signal }); check(owner, signal);
          if (grant.status !== 'stored') { if (authorized) invalidate(); return { status: 'needs-authorization' }; }
          const selected = await readAccount(); check(owner, signal);
          if (!validAccount(selected?.accountKey)) throw fail('ZCODE_LOGIN_REQUIRED');
          // Reconnecting the same live connection keeps its independent task
          // consent and does not toggle the user's enabled preference.
          if (authorized && accountKey === selected.accountKey) {
            await verifyAccount({ signal }); check(owner, signal);
            await link.refresh(); check(owner, signal); notify(); return getState();
          }
          if (authorized && accountKey !== selected.accountKey) {
            authorized = tasksAuthorized = false; accountKey = null;
            attempt.previous = { enabled, authorized: false, tasksAuthorized: false, accountKey: null };
            void suspend(); accountChanged(); notify();
          }
          previousSaved = await storage.load('zcode'); check(owner, signal);
          const saved = { purpose: PURPOSE, version: 1, accountKey: selected.accountKey,
            tasks: validRecord(previousSaved) && previousSaved.accountKey === selected.accountKey && previousSaved.tasks === true };
          await storage.save('zcode', saved); wrote = true; check(owner, signal);
          attempt.runtimeStarted = true;
          const result = await activate(owner, signal, saved); check(owner, signal);
          committed = true; return result;
        } catch (error) {
          if (wrote && !committed) await rollbackSaved(previousSaved).catch(() => {});
          if (owner === epoch && !closed) {
            if (error.code === 'CANCELLED') rollbackRuntime(attempt);
            else if (attempt.runtimeStarted || authorized) invalidate();
          }
          if (error.code === 'CANCELLED') return { status: 'cancelled' };
          throw error;
        } finally { if (connecting === attempt) connecting = null; }
      }).catch(error => { if (error.code === 'CANCELLED') return { status: 'cancelled' }; throw error; });
    },
    restore(value) {
      const owner = ++epoch; ++taskEpoch;
      if (closed) return Promise.resolve(getState());
      enabled = value === true; authorized = tasksAuthorized = false; accountKey = null;
      void suspend();
      return queue(async () => {
        check(owner); if (!enabled) return getState();
        const saved = await storage.load('zcode'); check(owner);
        if (!validRecord(saved)) { notify(); return getState(); }
        const grant = await access.ensure({ interactive: false }); check(owner);
        if (grant.status !== 'stored') { notify(); return getState(); }
        return activate(owner, null, saved);
      }).catch(() => { if (owner === epoch && !closed) invalidate(); return getState(); });
    },
    authorizeTasks(signal) {
      const owner = epoch, taskOwner = ++taskEpoch;
      return queue(async () => {
        check(owner, signal, taskOwner);
        const key = await verifyAccount({ signal }); check(owner, signal, taskOwner);
        const previous = await storage.load('zcode'); check(owner, signal, taskOwner);
        let wrote = false;
        try {
          await storage.save('zcode', { purpose: PURPOSE, version: 1, accountKey: key, tasks: true }); wrote = true;
          check(owner, signal, taskOwner); await verifyAccount({ signal }); check(owner, signal, taskOwner);
          tasksAuthorized = true; notify();
          // Granting read authority does not wait for a quota network request.
          void Promise.resolve().then(() => {
            if (!closed && owner === epoch && taskOwner === taskEpoch && tasksAuthorized) return link.refresh();
          }).catch(() => {});
          return { status: 'stored' };
        } catch (error) {
          if (wrote) await rollbackSaved(previous).catch(() => {});
          if (error.code === 'CANCELLED') return { status: 'cancelled' };
          throw error;
        }
      }).catch(error => { if (error.code === 'CANCELLED') return { status: 'cancelled' }; throw error; });
    },
    revokeTasks() {
      const owner = epoch; ++taskEpoch; tasksAuthorized = false; notify();
      return queue(async () => {
        if (closed || owner !== epoch || !enabled || !authorized || !validAccount(accountKey)) return { status: 'revoked' };
        await storage.save('zcode', { purpose: PURPOSE, version: 1, accountKey, tasks: false });
        return { status: 'revoked' };
      });
    },
    refreshAccount() {
      if (!enabled || !authorized || closed) return Promise.resolve(getState());
      const owner = epoch;
      if (!accountFlight || accountFlight.owner !== owner) {
        const run = { owner };
        run.promise = verifyAccount().catch(error => {
          if (owner === epoch && !closed && enabled && error.code !== 'CANCELLED') invalidate();
        }).finally(() => { if (accountFlight === run) accountFlight = null; });
        accountFlight = run;
      }
      return accountFlight.promise;
    },
    disconnect() {
      ++epoch; ++taskEpoch; enabled = authorized = tasksAuthorized = false; accountKey = null;
      void suspend(); access.clearPendingApp(); accountChanged(); notify();
      return queue(async () => {
        const results = await Promise.allSettled([() => link.setEnabled(false), () => storage.remove('zcode'), () => access.revoke()].map(run => Promise.resolve().then(run)));
        const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
        return { status: 'disconnected' };
      });
    },
    close() {
      if (closed) return;
      closed = true; ++epoch; ++taskEpoch; enabled = authorized = tasksAuthorized = false; accountKey = null;
      access.clearPendingApp(); void suspend(); notify();
    }
  };
}
function projectMasZcodeSnapshot(snapshot = {}, tasksAuthorized, approvedAccountKey) {
  // A companion can finish a query after the selected source account changes.
  // A caller supplying an approval key must never display that other account's
  // quota/history during the interval before the controller's next identity check.
  if (arguments.length >= 3 && (!validAccount(approvedAccountKey) || snapshot.accountKey !== approvedAccountKey)) {
    const state = validAccount(approvedAccountKey) ? 'connecting' : 'disabled';
    return { ...snapshot, enabled: false, state, accountKey: null, family: null, hasCustomProviders: false,
      quotaUpdatedAt: null, buckets: [], quota: { state, windows: [], buckets: [], updatedAt: null, code: null, stale: true },
      tasks: { state: 'unknown', items: [], tasks: [], results: [], code: null, scope: 'not-authorized', accountAttributionVerified: false },
      history: { available: false, windows: [], results: [] }, activity: { runningCount: null, unreadCount: null } };
  }
  const allowed = tasksAuthorized === true && snapshot.enabled === true;
  return { ...snapshot,
    tasks: allowed ? { ...snapshot.tasks, scope: 'authorized-device-cache', accountAttributionVerified: false,
      activity: { runningCount: null, unreadCount: null } }
      : { state: 'unknown', items: [], tasks: [], results: [], code: null, scope: 'not-authorized', accountAttributionVerified: false },
    history: allowed ? snapshot.history : { ...snapshot.history, results: [] },
    activity: { runningCount: null, unreadCount: allowed ? snapshot.activity?.unreadCount ?? null : null } };
}
module.exports = { createMasZcodeQuotaConnection, projectMasZcodeSnapshot };
