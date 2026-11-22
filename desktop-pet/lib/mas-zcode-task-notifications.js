'use strict';

// This consent writes only our source-side hook and its private pairing. It is
// deliberately independent from read-only task-cache access.
function createMasZcodeTaskNotifications({ installer, storage, getAccountKey, verifyAccount = async () => getAccountKey(), readTurnStatus = async () => null,
  createBridge = options => require('./zcode-desktop-event-bridge').createZcodeDesktopEventBridge(options),
  createTaskState = options => require('./zcode-desktop-task-state').createZcodeDesktopTaskState(options),
  onChange = () => {}, onAlert = () => {}, onClear = () => {} }) {
  let enabled = false, connected = false, epoch = 0, closed = false, bridge = null, record = null;
  let status = 'disabled', error = null, pending = Promise.resolve(), intentEpoch = 0;
  let eventFlight = Promise.resolve(), verificationAbort = new AbortController();
  const startingBridges = new Set();
  const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const state = createTaskState({ readTurnStatus: verifiedTurnStatus, onChange: () => notify(), onAlert: alert => {
    if (enabled && connected && !closed && record?.accountKey === getAccountKey()) onAlert(alert);
  }, onClear: () => onClear() });
  function getState() {
    const tasks = state.getState();
    return { enabled, connected, status, generation: epoch,
      activeCount: connected ? tasks.activeCount || 0 : 0, runningCount: null, scope: 'authorized-device-observed-turns', accountAttributionVerified: false, overallTaskVerified: false,
      tasks: connected ? tasks.tasks || [] : [],
      message: error || ({ disabled: '动画提醒尚未启用。', 'waiting-account': '等待确认当前 ZCode 账号。',
        'needs-authorization': '请重新启用 ZCode 动画提醒。', 'account-changed': '账号已变化，请重新启用动画提醒。',
        enabling: '正在启用动画提醒…', ready: '已启用；本机新任务可触发处理中，确认本轮结束后提醒。' }[status] || '动画提醒暂时不可用。') };
  }
  function notify() { try { onChange(getState()); } catch {} }
  function serialized(run) { const result = pending.catch(() => {}).then(run); pending = result.then(() => {}, () => {}); return result; }
  async function stopReceiver() {
    verificationAbort.abort(); verificationAbort = new AbortController();
    const previous = bridge; bridge = null; connected = false; ++epoch; state.reset(); onClear();
    if (previous) await previous.close();
  }
  async function verifiedTurnStatus(input) {
    const owner = record?.accountKey, current = epoch, signal = verificationAbort.signal;
    const isCurrent = () => !closed && enabled && connected && current === epoch && owner === record?.accountKey && owner === getAccountKey() && !signal.aborted;
    if (!isCurrent()) return null;
    async function verify() {
      try {
        const latest = await verifyAccount(owner, signal);
        if (!isCurrent()) return false;
        if ((typeof latest === 'string' ? latest : latest?.accountKey) !== owner) throw Error('ACCOUNT_CHANGED');
        return true;
      } catch {
        if (isCurrent()) { enabled = false; await stopReceiver(); status = 'account-changed'; notify(); }
        return false;
      }
    }
    if (!await verify()) return null;
    const result = await readTurnStatus({ ...input, signal });
    if (!isCurrent() || !await verify() || !isCurrent()) return null;
    return result;
  }
  function receiver(current) {
    return createBridge({ onEvent: event => {
      const owner = record?.accountKey, signal = verificationAbort.signal;
      const isCurrent = () => !closed && enabled && connected && current === epoch && owner === record?.accountKey && owner === getAccountKey();
      eventFlight = eventFlight.catch(() => {}).then(async () => {
        if (!isCurrent() || signal.aborted) return;
        try {
          const verified = await verifyAccount(owner, signal);
          if (!isCurrent() || signal.aborted) return;
          if ((typeof verified === 'string' ? verified : verified?.accountKey) !== owner) throw Error('ACCOUNT_CHANGED');
          state.accept(event, { accountKey: owner, epoch: current });
        } catch {
          if (!isCurrent() || signal.aborted) return;
          enabled = false; await stopReceiver(); status = 'account-changed'; notify();
        }
      });
    } });
  }
  async function startSaved() {
    if (closed || !enabled || connected || !record) return;
    const accountKey = getAccountKey(), intent = intentEpoch;
    if (!validAccount(accountKey)) { status = 'waiting-account'; notify(); return; }
    if (accountKey !== record.accountKey) { status = 'account-changed'; enabled = false; notify(); return; }
    const grant = await installer.ensure({ interactive: false });
    if (closed || !enabled || intent !== intentEpoch || getAccountKey() !== accountKey) return;
    if (grant.status !== 'stored') { status = 'needs-authorization'; notify(); return; }
    const current = ++epoch, next = receiver(current); startingBridges.add(next);
    try {
      await next.start({ port: record.port, token: record.token });
      if (closed || !enabled || intent !== intentEpoch || current !== epoch || getAccountKey() !== accountKey) throw Error('STALE');
      const restored = await installer.restore({ receiver: { endpoint: record.endpoint, token: record.token } });
      if (closed || !enabled || intent !== intentEpoch || current !== epoch || getAccountKey() !== accountKey || restored.status !== 'installed') throw Error('STALE');
      bridge = next; startingBridges.delete(next); connected = true; status = 'ready'; error = null;
      state.bind({ accountKey, epoch: current }); notify();
    } catch {
      startingBridges.delete(next); await next.close(); if (closed || intent !== intentEpoch) return;
      status = 'needs-authorization'; error = '动画提醒未能恢复，请重新启用。'; notify();
    }
  }
  return {
    getState,
    refresh() { return state.refresh(); },
    restore() { const intent = intentEpoch; return serialized(async () => {
      const saved = await storage.load('zcode');
      if (closed || intent !== intentEpoch) return getState();
      if (saved?.version !== 1 || !validAccount(saved.accountKey) || !Number.isInteger(saved.port) ||
        saved.port < 1024 || saved.port > 65535 || !/^[A-Za-z0-9_-]{32,128}$/.test(saved.token || '') ||
        saved.endpoint !== `http://127.0.0.1:${saved.port}/zcode/events`) return getState();
      record = saved; enabled = true; await startSaved(); return getState();
    }); },
    refreshAccount() { return serialized(async () => {
      if (closed || !enabled) return getState();
      if (connected && record?.accountKey !== getAccountKey()) {
        await stopReceiver(); status = validAccount(getAccountKey()) ? 'account-changed' : 'waiting-account';
        if (status === 'account-changed') enabled = false;
        notify();
      }
      if (!connected && enabled) await startSaved();
      return getState();
    }); },
    enable(signal) { const intent = ++intentEpoch; const isCurrent = () => !closed && !signal?.aborted && intent === intentEpoch;
      return serialized(async () => {
      if (!isCurrent()) return { status: 'cancelled' };
      const accountKey = getAccountKey();
      if (!validAccount(accountKey)) return { status: 'needs-connection' };
      if (connected && record?.accountKey === accountKey) return { status: 'ready' };
      let grant;
      try { grant = await installer.ensure({ interactive: true, signal }); }
      catch { return { status: !isCurrent() ? 'cancelled' : 'error' }; }
      if (!isCurrent()) return { status: 'cancelled' };
      if (grant.status !== 'stored') return grant;
      await stopReceiver(); if (!isCurrent()) return { status: 'cancelled' };
      status = 'enabling'; error = null; notify();
      const current = ++epoch, next = receiver(current); startingBridges.add(next);
      try {
        const pairing = await next.start();
        if (!isCurrent() || current !== epoch || getAccountKey() !== accountKey) throw Error('CANCELLED');
        const installed = await installer.install({ receiver: { endpoint: pairing.endpoint, token: pairing.token }, signal });
        if (!isCurrent() || current !== epoch || getAccountKey() !== accountKey || installed.status !== 'installed') throw Error('CANCELLED');
        const saved = { version: 1, accountKey, endpoint: pairing.endpoint, port: Number(new URL(pairing.endpoint).port), token: pairing.token };
        await storage.save('zcode', saved);
        if (!isCurrent() || current !== epoch || getAccountKey() !== accountKey) throw Error('CANCELLED');
        record = saved; bridge = next; startingBridges.delete(next); enabled = connected = true; status = 'ready';
        state.bind({ accountKey, epoch: current }); notify(); return { status: 'ready', requiresNewSession: installed.requiresNewSession === true };
      } catch {
        startingBridges.delete(next); await next.close(); enabled = connected = false; record = null;
        await Promise.allSettled([storage.remove('zcode'), installer.uninstall()]);
        if (!closed) { status = 'needs-authorization'; error = !isCurrent() ? null : '动画提醒未能启用，请重试。'; notify(); }
        return { status: !isCurrent() ? 'cancelled' : 'error' };
      }
    }); },
    disable() {
      // Invalidate immediately, including a selection or installation in flight.
      ++intentEpoch; enabled = connected = false; ++epoch; installer.clearPending?.(); verificationAbort.abort(); state.reset(); onClear();
      for (const candidate of startingBridges) void candidate.close();
      if (bridge) void bridge.close();
      return serialized(async () => {
        await stopReceiver(); record = null;
        const results = await Promise.allSettled([storage.remove('zcode'), installer.uninstall()]);
        try { await installer.revoke(); } catch (reason) { results.push({ status: 'rejected', reason }); }
        status = 'disabled'; error = results.some(result => result.status === 'rejected')
          ? '已停止提醒，源端配置清理未完成，可再次停用重试。' : null;
        notify(); return { status: error ? 'cleanup-pending' : 'disabled' };
      });
    },
    close() { ++intentEpoch; closed = true; enabled = connected = false; ++epoch; verificationAbort.abort(); state.close(); onClear();
      const receivers = new Set(startingBridges); if (bridge) receivers.add(bridge);
      bridge = null; installer.close(); return Promise.allSettled([...receivers].map(candidate => candidate.close())); }
  };
}
module.exports = { createMasZcodeTaskNotifications };
