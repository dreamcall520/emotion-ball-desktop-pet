'use strict';

// Authority and quota queries are independent of every chat/task provider.
// Only the settings connection flow may acquire interactive system grants.
function createMasWorkBuddyQuotaConnection({ access, quota, usage, taskAccess, tasks, saveEnabled, onChange = () => {} }) {
  let enabled = false, authorized = false, epoch = 0, closed = false, tasksAuthorized = false, taskEpoch = 0;
  function getState() {
    const state = quota.getState();
    const connected = enabled && authorized && !closed;
    const status = !enabled ? 'disconnected' : !authorized ? 'needs-authorization'
      : state.errorCode === 'DIRECTORY_ACCESS_REQUIRED' ? 'needs-authorization'
      : state.error ? 'error' : state.report ? 'ready' : 'connecting';
    const taskState = tasks?.getState();
    const taskStatus = !enabled ? 'needs-connection' : !tasksAuthorized ? 'needs-authorization'
      : taskState?.busy ? 'working' : taskState?.error ? 'error' : taskState?.report ? 'ready' : 'pending';
    return { enabled, connected: connected && status !== 'needs-authorization', status,
      tasks: { authorized: tasksAuthorized, status: taskStatus,
        message: !enabled ? '请先连接 WorkBuddy。' : !tasksAuthorized ? '任务目录尚未授权。'
          : taskState?.error || '只读本机任务；实时进行中状态未知。' },
      message: !enabled ? '尚未连接本机 WorkBuddy。' : status === 'needs-authorization' ? '请重新授权 WorkBuddy 应用和账号目录。'
        : state.error || (state.report ? '积分余额已更新；消耗统计以官方返回为准。' : '已连接，正在查询积分余额…') };
  }
  function activate() { quota.setEnabled(true); usage.setEnabled(true); onChange(); void restoreTasks(); }
  async function restoreTasks() {
    if (!taskAccess || !tasks || !enabled || !authorized || closed) return;
    const current = ++taskEpoch;
    let result;
    try { result = await taskAccess.ensure({ interactive: false }); } catch { result = null; }
    if (current !== taskEpoch || closed || !enabled) return;
    tasksAuthorized = result?.status === 'stored'; tasks.setEnabled(tasksAuthorized);
    if (tasksAuthorized) await tasks.refresh(false);
    onChange();
  }
  async function authorizeTasks(signal) {
    if (!taskAccess || !tasks || !enabled || !authorized || closed) return { status: 'needs-connection' };
    const current = ++taskEpoch;
    const result = await taskAccess.ensure({ interactive: true, signal });
    if (current !== taskEpoch || closed || signal?.aborted || !enabled) return { status: 'cancelled' };
    if (result?.status !== 'stored') return result;
    tasksAuthorized = true; tasks.setEnabled(true); onChange(); await tasks.refresh();
    return { status: 'stored' };
  }
  async function revokeTasks() {
    ++taskEpoch; tasksAuthorized = false; tasks?.setEnabled(false); onChange();
    await taskAccess?.revoke(); return { status: 'needs-authorization' };
  }
  async function restore(value) {
    const current = ++epoch;
    enabled = value === true; authorized = false;
    if (!enabled || closed) return getState();
    let result;
    try { result = await access.ensure({ interactive: false }); } catch { result = null; }
    if (current !== epoch || closed) return getState();
    authorized = result?.status === 'stored';
    if (authorized) activate(); else onChange();
    return getState();
  }
  async function connect(signal) {
    const current = ++epoch;
    if (closed || signal?.aborted) return { status: 'cancelled' };
    const result = await access.ensure({ interactive: false, signal });
    if (current !== epoch || closed || signal?.aborted) return { status: 'cancelled' };
    if (result?.status !== 'stored') return { ...getState(), status: 'needs-authorization' };
    await saveEnabled(true);
    if (current !== epoch || closed) return { status: 'cancelled' };
    // A stopped permission retry can still have enabled=true. Reset its old
    // generation so a new grant starts a query and cannot revive an old result.
    quota.setEnabled(false); usage.setEnabled(false);
    enabled = authorized = true; activate(); return getState();
  }
  async function disconnect() {
    ++epoch; ++taskEpoch; enabled = authorized = tasksAuthorized = false;
    tasks?.setEnabled(false); taskAccess?.clearPending?.();
    quota.setEnabled(false); usage.setEnabled(false); access.clearPendingApp(); onChange();
    try { await saveEnabled(false); }
    finally {
      const results = await Promise.allSettled([access.revoke(), taskAccess?.revoke()]);
      const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    }
    return getState();
  }
  return { getState, restore, connect, disconnect, authorizeTasks, revokeTasks,
    authorize: (step, signal) => access.ensure({ interactive: true, step, signal }),
    cancel: () => { access.clearPendingApp(); taskAccess?.clearPending?.(); return { status: 'cancelled' }; },
    close() { ++epoch; ++taskEpoch; closed = true; quota.close(); usage.close(); tasks?.close(); taskAccess?.close?.(); access.clearPendingApp(); }
  };
}
module.exports = { createMasWorkBuddyQuotaConnection };
