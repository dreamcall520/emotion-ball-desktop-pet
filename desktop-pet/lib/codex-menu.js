const { isTaskId } = require('./codex-state');
const { menuText } = require('./codex-text');
const { scopeQuotaWindows } = require('./codex-quota-view');

const CONNECTION_LABELS = Object.freeze({ disabled: '已关闭', connecting: '正在连接', connected: '已连接',
  missing: '未找到 Codex', unauthenticated: '未登录', unsupported: '暂不支持', disconnected: '未连接' });
const TASK_LABELS = Object.freeze({ active: '处理中', waiting: '等你确认' });

function period(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '周期暂不可用';
  if (minutes % 1440 === 0) return `${minutes / 1440}天`;
  if (minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}
function dateLabel(value) {
  if (!Number.isFinite(value) || value < 0 || value > 8640000000000000) return '暂不可用';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function allRows(snapshot) {
  if (!Array.isArray(snapshot?.tasks?.items)) return [];
  const trusted = new Map();
  for (const item of snapshot.tasks.items) {
    if (!isTaskId(item?.id)) continue;
    const id = item.id.toLowerCase();
    if (!trusted.has(id) && trusted.size >= 64) continue;
    trusted.set(id, { ...item, id });
  }
  return [...trusted.values()];
}
const visibleRows = snapshot => allRows(snapshot)
  .filter(item => !item.unavailable && (item.state === 'active' || item.state === 'waiting'));
const action = (snapshot, type, extra = {}) => ({ scope: 'menu', type, generation: snapshot.generation, ...extra });

function taskConnectionLabel(tasks) {
  if (tasks?.state === 'missing') return '未连接桌面任务';
  return CONNECTION_LABELS[tasks?.state] || '暂不可用';
}

function hasPartialTasks(snapshot) {
  const tasks = snapshot?.tasks;
  return tasks?.state === 'connected' && (tasks.code === 'PARTIAL_STATE' || (Array.isArray(tasks.items)
    && tasks.items.some(item => isTaskId(item?.id) && item.unavailable)));
}

function emptyTaskLabel(snapshot) {
  const tasks = snapshot?.tasks;
  if (tasks?.state === 'connected' && hasPartialTasks(snapshot)) return '部分任务暂不可用，请到 Codex 查看';
  if (tasks?.state === 'connected') return '暂无进行中或待确认的任务';
  if (tasks?.code === 'STATE_TOO_LARGE') return '状态包过大，暂不可用';
  return taskConnectionLabel(tasks);
}

function taskSubmenu(snapshot) {
  const rows = visibleRows(snapshot);
  const items = rows.slice(0, 20).map(task => ({
    label: `${menuText(task.title, 36, '未命名任务')} · ${TASK_LABELS[task.state]}`,
    action: action(snapshot, 'open-task', { taskId: task.id })
  }));
  if (rows.length > 20) items.push({ label: `另有 ${rows.length - 20} 个，请到 Codex 查看`, enabled: false });
  return items.length ? items : [{ label: emptyTaskLabel(snapshot), enabled: false }];
}

function alertResultRows(snapshot, alertId, now) {
  if (snapshot?.enabled !== true || !Number.isSafeInteger(snapshot.generation)) return [];
  const alert = snapshot.currentAlert;
  if (!alert || alert.id !== alertId || alert.generation !== snapshot.generation || alert.kind !== 'completed'
    || !Number.isFinite(alert.expiresAt) || now >= alert.expiresAt || !Array.isArray(alert.taskIds)
    || alert.taskIds.length < 2 || alert.taskIds.some(id => !isTaskId(id))) return [];
  const taskIds = alert.taskIds.map(id => id.toLowerCase());
  if (new Set(taskIds).size !== taskIds.length) return [];
  const trusted = new Map(allRows(snapshot).filter(task => !task.unavailable).map(task => [task.id, task]));
  const rows = taskIds.map(id => trusted.get(id));
  return rows.every(Boolean) ? rows : [];
}

// The result contains data only. The host must resolve action descriptors against
// a fresh controller snapshot at click time before invoking any external action.
function buildCodexMenu(snapshot, now = Date.now()) {
  if (snapshot?.enabled !== true) return [];
  const quota = snapshot.quota || {};
  const tasks = snapshot.tasks || {};
  const quotaItems = scopeQuotaWindows(quota.windows).map(window => {
    const family = window.id.split(':', 1)[0].trim().toLowerCase();
    const remaining = Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100
      ? `${Math.round(window.remaining * 10) / 10}%` : '暂不可用';
    const reset = Number.isFinite(window.resetsAt) && window.resetsAt <= now ? '等待更新新周期' : dateLabel(window.resetsAt);
    return { label: `${family} · ${period(window.windowMinutes)}：${remaining}${quota.stale ? '（已过期）' : ''}`,
      submenu: [{ label: `重置：${reset}`, enabled: false }] };
  });
  return [
    { label: `额度：${CONNECTION_LABELS[quota.state] || '暂不可用'}${quota.stale && quota.windows?.length ? '（已过期）' : ''}`, enabled: false },
    { id: 'codex-quota', label: '额度明细', submenu: quotaItems.length ? quotaItems : [{ label: '额度暂不可用', enabled: false }] },
    { label: `上次更新：${dateLabel(quota.updatedAt)}`, enabled: false },
    { type: 'separator' },
    { label: `任务进展：${taskConnectionLabel(tasks)}${hasPartialTasks(snapshot) ? ' · 部分任务暂不可用' : ''}（最近最多20个任务）`, enabled: false },
    { id: 'codex-tasks', label: '任务列表', submenu: taskSubmenu(snapshot) },
    { type: 'separator' },
    { id: 'codex-refresh', label: '刷新状态（至少间隔10秒）', action: action(snapshot, 'refresh') }
  ];
}

function buildCodexResultMenu(snapshot, alertId, now = Date.now()) {
  return alertResultRows(snapshot, alertId, now).map(task => ({
    label: menuText(task.title, 36, '未命名任务'),
    action: { scope: 'result', type: 'open-task', generation: snapshot.generation, alertId, taskId: task.id }
  }));
}

function resolveCodexAction(snapshot, descriptor, now = Date.now()) {
  if (snapshot?.enabled !== true || !descriptor || !Number.isSafeInteger(snapshot.generation)
    || descriptor.generation !== snapshot.generation || !['menu', 'alert', 'result'].includes(descriptor.scope)) return null;
  const taskRows = allRows(snapshot);
  const alert = snapshot.currentAlert;
  if ((descriptor.scope === 'alert' || descriptor.scope === 'result')
    && (!alert || alert.id !== descriptor.alertId || alert.generation !== snapshot.generation
    || !Number.isFinite(alert.expiresAt) || now >= alert.expiresAt)) return null;
  if (descriptor.type === 'refresh') return descriptor.scope === 'menu' ? { type: 'refresh' } : null;
  if (descriptor.type === 'dismiss') return descriptor.scope === 'alert' ? { type: 'dismiss', alertId: alert.id } : null;
  if (descriptor.type === 'show-results') return descriptor.scope === 'alert'
    && alertResultRows(snapshot, descriptor.alertId, now).length >= 2 ? { type: 'show-results', alertId: alert.id } : null;
  if (descriptor.type !== 'open-task' || !isTaskId(descriptor.taskId)) return null;
  const taskId = descriptor.taskId.toLowerCase();
  if (!taskRows.some(task => task.id === taskId && !task.unavailable)) return null;
  if (descriptor.scope === 'result'
    && !alertResultRows(snapshot, descriptor.alertId, now).some(task => task.id === taskId)) return null;
  if (descriptor.scope === 'alert' && (!Array.isArray(alert.taskIds) || alert.taskIds.length !== 1
    || !isTaskId(alert.taskIds[0]) || alert.taskIds[0].toLowerCase() !== taskId)) return null;
  return { type: 'open-task', taskId, url: `codex://threads/${taskId}` };
}

module.exports = { buildCodexMenu, buildCodexResultMenu, resolveCodexAction };
