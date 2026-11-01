(function (root) {
  const cleanText = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';
  const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  function clean(value) {
    const report = value?.report;
    return { busy: value?.busy === true, error: value?.error ? '任务读取失败，请刷新重试' : null,
      report: report?.source === 'local-session-cache' && report.scope === 'current-account' ? {
        observedAt: time(report.observedAt), pendingReview: count(report.pendingReview), total: count(report.total), truncated: report.truncated === true,
        items: Array.isArray(report.items) ? report.items.slice(0, 100).filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.id)).map(item => ({
          id: item.id, title: cleanText(item.title, 240) || '未命名任务', status: ['completed', 'terminated', 'running'].includes(item.status) ? item.status : 'unknown',
          unread: item.unread === true, updatedAt: time(item.updatedAt)
        })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) : []
      } : null };
  }
  if (typeof module !== 'undefined') { module.exports = { clean }; return; }
  const doc = root.document, el = id => doc.getElementById(id);
  const api = root.petWorkBuddyDetails;
  const statuses = { completed: '上次已完成', terminated: '上次已结束', running: '实时状态未同步', unknown: '实时状态未同步' };
  const date = at => at === null ? '时间暂未提供' : new Date(at).toLocaleString('zh-CN', { hour12: false });
  const node = (tag, className, text) => { const value = doc.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; };
  const svgNode = (tag, attrs) => { const value = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, text] of Object.entries(attrs)) value.setAttribute(key, text); return value; };
  let current = null, mode = 'tasks', resize = () => {};
  const resized = () => { try { resize(); } catch (_) {} };
  function title(text, amount) {
    el('details-title').replaceChildren(node('span', '', text), ...(amount === null ? [] : [node('span', 'activity-count', String(amount))]), node('small', 'title-product', 'WorkBuddy'));
  }
  function readAllButton() {
    let button = el('details-read-all');
    if (button) return button;
    button = node('button', '', ''); button.id = 'details-read-all'; button.type = 'button';
    const icon = svgNode('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.appendChild(svgNode('path', { d: 'M10 7V4a2 2 0 0 1 4 0v3M6.5 11.5l-1.6 8Q4.6 21 6.1 21h11.8q1.5 0 1.2-1.5l-1.6-8M10 15l-1 6' }));
    icon.appendChild(svgNode('rect', { x: '4', y: '7', width: '16', height: '4.5', rx: '2.25' }));
    button.appendChild(icon); button.appendChild(node('span', '', '全部已查看'));
    button.title = '清除球球内全部待查看提醒，不修改 WorkBuddy 的未读标记';
    button.addEventListener('click', () => api?.clearTasks?.());
    const tools = doc.querySelector('.panel-tools'); tools.parentNode.insertBefore(button, tools);
    return button;
  }
  function drawDevice() {
    const host = el('task-view'), tasks = current.tasks || {};
    title('设备任务记录', null);
    const clear = el('details-read-all'); if (clear) clear.hidden = true;
    host.replaceChildren(node('p', 'panel-note', '原工具事件与设备历史分别展示；账号归属未核实，不代表当前聊天账号。'));
    host.appendChild(node('h3', '', '原工具最近事件'));
    const live = tasks.liveObservations?.observations || [];
    const phases = { 'submitted': '已提交请求', 'stop-observed': '已停止，完成待确认', 'session-opened': '会话已打开', 'session-ended': '会话已结束，任务终态未确认', 'failure-observed': '观察到失败事件', 'final-stop-observed': '观察到主回复停止' };
    const ul = node('ul', 'activity-list');
    for (const row of live) {
      const terminal = row.terminalConfirmed === true && row.terminalKind === 'main-reply';
      const status = terminal ? ({ completed: '原工具主回复已完成', failed: '原工具主回复失败', interrupted: '原工具主回复已中断' }[row.state] || '主回复状态待确认') : phases[row.phase] || '状态待确认';
      const li = node('li', 'panel-note', `${status}；整体任务状态未确认${row.realtime ? '' : '（上次事件）'} · ${date(row.observedAt)}`); ul.appendChild(li);
    }
    host.appendChild(live.length ? ul : node('p', 'empty-state', '尚未收到原工具事件'));
    host.appendChild(node('h3', '', '设备历史缓存'));
    const history = tasks.deviceHistory;
    host.appendChild(node('p', 'panel-note', '仅为所选设备缓存范围；历史完成不代表当前任务完成。'));
    if (!history) host.appendChild(node('p', 'empty-state', '尚未读取设备历史缓存'));
    else if (!history.items.length) host.appendChild(node('p', 'empty-state', '所选缓存范围没有可展示的记录'));
    else {
      const list = node('ul', 'activity-list');
      for (const item of history.items) {
        const li = node('li', 'panel-note'); li.appendChild(node('b', '', item.title));
        li.appendChild(node('p', '', `${({ 'last-completed': '上次已完成', 'last-interrupted': '上次已中断', 'last-failed': '上次失败' })[item.state] || '历史状态未知'} · ${date(item.updatedAt)}`)); list.appendChild(li);
      }
      host.appendChild(list);
      if (history.truncated) host.appendChild(node('p', 'panel-note', '仅展示部分设备历史记录'));
    }
    if (tasks.error) host.appendChild(node('p', 'panel-note', '设备任务记录暂不可用。'));
    resized();
  }
  function draw() {
    if (current.tasks?.deviceHistory || current.tasks?.liveObservations) return drawDevice();
    const state = clean(current.tasks), report = state.report, host = el('task-view');
    const list = mode === 'results' && report ? report.items.filter(item => item.unread) : [];
    title(mode === 'results' ? '待查看' : '进行中', mode === 'results' ? report?.pendingReview ?? null : null);
    const clear = readAllButton(); clear.hidden = mode !== 'results' || !list.length; clear.disabled = state.busy;
    const tabs = node('div', 'trend-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '任务');
    for (const [action, label] of [['tasks', '进行中'], ['results', `待查看${report?.pendingReview === null || !report ? '' : `（${report.pendingReview}）`}`]]) {
      const tab = node('button', '', label); tab.type = 'button'; tab.id = `task-tab-${action}`;
      tab.setAttribute('aria-pressed', String(mode === action)); tab.addEventListener('click', () => { mode = action; draw(); }); tabs.appendChild(tab);
    }
    const tools = node('div', 'chart-meta'); tools.appendChild(tabs);
    const refresh = node('button', 'reset-link', state.busy ? '读取中…' : '刷新'); refresh.type = 'button'; refresh.id = 'tasks-refresh'; refresh.disabled = state.busy;
    refresh.title = report ? `本机已同步于 ${date(report.observedAt)}；实时运行状态尚未确认` : '读取本机已同步任务，实时运行状态尚未确认';
    refresh.addEventListener('click', () => api?.refreshTasks?.()); tools.appendChild(refresh);
    host.replaceChildren(tools);
    if (state.error) { const error = node('p', 'panel-note', state.error); error.id = 'tasks-error'; error.setAttribute('role', 'status'); host.appendChild(error); }
    if (!list.length) {
      const message = state.busy ? '正在读取任务…' : mode === 'tasks' ? '暂无可确认的进行中任务' : !report ? '待查看记录暂未同步' : '暂无待查看任务';
      const empty = node('p', 'empty-state', message); empty.id = 'tasks-empty';
      empty.title = mode === 'tasks' ? '本机历史状态不能证明任务仍在运行，暂不展示历史 running 或已完成记录' : '仅包含当前账户在球球内尚未查看的本机已同步记录'; host.appendChild(empty);
    } else {
      const ul = node('ul', 'activity-list'); ul.id = 'tasks-list';
      for (const item of list) {
        const li = node('li'), row = node('button', 'activity-item'); row.type = 'button'; row.dataset.taskId = item.id;
        const icon = node('span', 'activity-icon'); icon.setAttribute('aria-hidden', 'true');
        const art = svgNode('svg', { viewBox: '0 0 20 20' }); art.appendChild(svgNode('path', { d: item.status === 'completed' ? 'M4 10l4 4 8-9' : 'M5 5l10 10M15 5L5 15' })); icon.appendChild(art);
        const copy = node('span', 'activity-copy'); copy.appendChild(node('b', '', item.title)); copy.appendChild(node('small', '', statuses[item.status]));
        row.appendChild(icon); row.appendChild(copy); row.appendChild(node('span', 'unread-marker'));
        row.title = `打开对应 WorkBuddy 会话；本机同步时间 ${date(item.updatedAt)}`;
        row.addEventListener('click', () => api?.openTask?.(item.id));
        li.appendChild(row); ul.appendChild(li);
      }
      host.appendChild(ul);
    }
    resized();
  }
  root.workBuddyTasksView = { render(value, onResize) {
    const active = ['tasks', 'results'].includes(value?.action);
    el('quota-view').hidden = active; el('task-view').hidden = !active;
    if (!active) { current = null; title('消耗趋势', null); const button = el('details-read-all'); if (button) button.hidden = true; return false; }
    if (current?.action !== value.action) mode = value.action;
    current = value; resize = typeof onResize === 'function' ? onResize : () => {}; draw(); return true;
  } };
})(typeof window === 'undefined' ? globalThis : window);
