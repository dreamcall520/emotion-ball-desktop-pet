const { isTaskId } = require('./codex-state');

const CONNECTION_LABELS = Object.freeze({ disabled: '已关闭', connecting: '正在连接', connected: '已连接',
  missing: '未找到 Codex', unauthenticated: '未登录', unsupported: '暂不支持', disconnected: '未连接' });
const TASK_LABELS = Object.freeze({ active: '处理中', waiting: '等你确认', completed: '本轮已结束',
  failed: '本轮失败', interrupted: '已中断', idle: '空闲', unknown: '暂不可用' });

function plain(value, maximum = 40, fallback = '') {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim() : '';
  const points = Array.from(text || fallback);
  return (points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : points.join('')).replace(/&/g, '&&');
}
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
const rows = snapshot => Array.isArray(snapshot?.tasks?.items) ? snapshot.tasks.items.filter(item => isTaskId(item?.id)).slice(0, 20) : [];
const action = (snapshot, type, extra = {}) => ({ scope: 'menu', type, generation: snapshot.generation, ...extra });

// The result contains data only. The host must resolve action descriptors against
// a fresh controller snapshot at click time before invoking any external action.
function buildCodexMenu(snapshot, now = Date.now()) {
  if (snapshot?.enabled !== true) return [];
  const quota = snapshot.quota || {};
  const tasks = snapshot.tasks || {};
  const taskRows = rows(snapshot);
  const quotaItems = (Array.isArray(quota.windows) ? quota.windows.slice(0, 64) : []).map(window => {
    const remaining = Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100
      ? `${Math.round(window.remaining * 10) / 10}%` : '暂不可用';
    const reset = Number.isFinite(window.resetsAt) && window.resetsAt <= now ? '等待更新新周期' : dateLabel(window.resetsAt);
    return { label: `${plain(window.label, 32, '额度')} · ${period(window.windowMinutes)}：${remaining}${quota.stale ? '（已过期）' : ''}`,
      submenu: [{ label: `重置：${reset}`, enabled: false }] };
  });
  const taskItems = taskRows.map(task => ({
    label: `${plain(task.title, 36, '未命名任务')} · ${task.unavailable === 'STATE_TOO_LARGE' ? '状态包过大，暂不可用' : TASK_LABELS[task.state] || TASK_LABELS.unknown}`,
    action: action(snapshot, 'open-task', { taskId: task.id })
  }));
  const recentItems = (Array.isArray(snapshot.recent) ? snapshot.recent.slice(0, 10) : []).map(entry => {
    const ids = [...new Set(Array.isArray(entry.taskIds) ? entry.taskIds : [])].filter(id => taskRows.some(task => task.id === id));
    const descriptor = ids.length === 1 ? action(snapshot, 'open-task', { taskId: ids[0] })
      : ids.length > 1 ? action(snapshot, 'show-tasks') : null;
    return { label: plain(entry.text, 48, '状态提醒'), enabled: Boolean(descriptor), ...(descriptor ? { action: descriptor } : {}) };
  });
  return [
    { label: `额度：${CONNECTION_LABELS[quota.state] || '暂不可用'}${quota.stale && quota.windows?.length ? '（已过期）' : ''}`, enabled: false },
    { id: 'codex-quota', label: '额度明细', submenu: quotaItems.length ? quotaItems : [{ label: '额度暂不可用', enabled: false }] },
    { label: `上次更新：${dateLabel(quota.updatedAt)}`, enabled: false },
    { type: 'separator' },
    { label: `任务进展：${tasks.state === 'missing' ? '未连接桌面任务' : CONNECTION_LABELS[tasks.state] || '暂不可用'}（最近最多20个任务）`, enabled: false },
    { id: 'codex-tasks', label: '任务列表', submenu: taskItems.length ? taskItems : [{ label: '尚未读到任务', enabled: false }] },
    { id: 'codex-recent', label: '最近提醒', submenu: recentItems.length ? recentItems : [{ label: '暂无提醒', enabled: false }] },
    { type: 'separator' },
    { id: 'codex-refresh', label: '刷新状态（至少间隔10秒）', action: action(snapshot, 'refresh') }
  ];
}

function resolveCodexAction(snapshot, descriptor, now = Date.now()) {
  if (snapshot?.enabled !== true || !descriptor || !Number.isSafeInteger(snapshot.generation)
    || descriptor.generation !== snapshot.generation || !['menu', 'alert'].includes(descriptor.scope)) return null;
  const taskRows = rows(snapshot);
  const alert = snapshot.currentAlert;
  if (descriptor.scope === 'alert' && (!alert || alert.id !== descriptor.alertId || alert.generation !== snapshot.generation
    || !Number.isFinite(alert.expiresAt) || now >= alert.expiresAt)) return null;
  if (descriptor.type === 'refresh') return descriptor.scope === 'menu' ? { type: 'refresh' } : null;
  if (descriptor.type === 'dismiss') return descriptor.scope === 'alert' ? { type: 'dismiss', alertId: alert.id } : null;
  if (descriptor.type === 'show-tasks') {
    const ids = descriptor.scope === 'alert' ? alert.taskIds : taskRows.map(task => task.id);
    return Array.isArray(ids) && ids.length > (descriptor.scope === 'alert' ? 1 : 0)
      && ids.every(id => isTaskId(id) && taskRows.some(task => task.id === id)) ? { type: 'show-tasks' } : null;
  }
  if (descriptor.type !== 'open-task' || !isTaskId(descriptor.taskId) || !taskRows.some(task => task.id === descriptor.taskId)) return null;
  if (descriptor.scope === 'alert' && (!Array.isArray(alert.taskIds) || alert.taskIds.length !== 1 || alert.taskIds[0] !== descriptor.taskId)) return null;
  return { type: 'open-task', taskId: descriptor.taskId, url: `codex://threads/${descriptor.taskId.toLowerCase()}` };
}

module.exports = { buildCodexMenu, resolveCodexAction };
