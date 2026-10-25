(function (root) {
  const cleanText = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';
  const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  function clean(value) {
    const report = value?.report;
    return { busy: value?.busy === true, error: value?.error ? '任务读取失败，请刷新重试' : null,
      report: report?.source === 'local-session-cache' && report.scope === 'current-account' ? {
        observedAt: time(report.observedAt), pendingReview: count(report.pendingReview), total: count(report.total), truncated: report.truncated === true,
        items: Array.isArray(report.items) ? report.items.slice(0, 100).filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(item.id)).map(item => ({
          id: item.id, title: cleanText(item.title, 240) || '未命名任务', status: ['completed', 'terminated', 'running'].includes(item.status) ? item.status : 'unknown',
          unread: item.unread === true, updatedAt: time(item.updatedAt), transport: ['local', 'remote', 'cloud'].includes(item.transport) ? item.transport : 'unknown'
        })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) : []
      } : null };
  }
  if (typeof module !== 'undefined') { module.exports = { clean }; return; }
  const doc = root.document, el = id => doc.getElementById(id);
  const status = { completed: '上次已完成', terminated: '上次已结束', running: '实时状态未同步', unknown: '实时状态未同步' };
  const date = at => at === null ? '时间暂未提供' : new Date(at).toLocaleString('zh-CN', { hour12: false });
  const node = (tag, className, text) => { const value = doc.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; };
  let current = null, mode = 'tasks', resize = () => {};
  const resized = () => { try { resize(); } catch (_) {} };
  function title(text) { el('details-title').replaceChildren(node('span', '', text), node('small', 'title-product', 'WorkBuddy')); }
  function draw() {
    const state = clean(current.tasks), report = state.report, host = el('task-view');
    title(mode === 'results' ? '待查看' : '任务');
    const tabs = node('div', 'trend-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '任务记录');
    for (const [action, label] of [['tasks', '最近任务'], ['results', `待查看${report?.pendingReview === null || !report ? '' : `（${report.pendingReview}）`}`]]) {
      const tab = node('button', '', label); tab.type = 'button'; tab.id = `task-tab-${action}`;
      tab.setAttribute('aria-pressed', String(mode === action)); tab.addEventListener('click', () => { mode = action; draw(); }); tabs.appendChild(tab);
    }
    const tools = node('div', 'chart-meta'); tools.appendChild(tabs);
    const refresh = node('button', 'reset-link', state.busy ? '读取中…' : '刷新'); refresh.type = 'button'; refresh.id = 'tasks-refresh'; refresh.disabled = state.busy;
    refresh.addEventListener('click', () => root.petWorkBuddyDetails?.refreshTasks?.()); tools.appendChild(refresh);
    const scope = node('p', 'panel-note', report?.observedAt === null || !report ? '本机已同步 · 尚未查询' : `本机已同步 · ${new Date(report.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`);
    scope.id = 'tasks-scope'; scope.title = report ? `当前账户的本机已同步记录，查询于 ${date(report.observedAt)}；不代表全局任务列表` : '仅查询当前账户的本机任务元数据，不读取任务正文';
    const info = node('details', 'panel-note'); info.id = 'tasks-info';
    info.appendChild(node('summary', '', 'ⓘ 实时进行中数量暂未提供'));
    info.appendChild(node('p', '', '实时运行状态未同步，当前显示本机已同步记录；待查看不代表全局任务统计。'));
    info.addEventListener('toggle', resized);
    host.replaceChildren(tools, scope, info);
    if (state.error) { const error = node('p', 'panel-note', state.error); error.id = 'tasks-error'; error.setAttribute('role', 'status'); host.appendChild(error); }
    const list = report ? report.items.filter(item => mode !== 'results' || item.unread) : [];
    if (!list.length) {
      const message = state.busy ? '正在读取本机任务元数据…' : !report ? state.error ? '任务记录暂不可用' : '尚未同步任务记录' : mode === 'results' ? '本机已同步记录中暂无待查看任务' : '本机尚未同步到任务记录';
      const empty = node('p', 'empty-state', message); empty.id = 'tasks-empty'; host.appendChild(empty);
    } else {
      const ul = node('ul', 'activity-list'); ul.id = 'tasks-list';
      for (const [index, item] of list.entries()) {
        const li = node('li'), row = node('button', 'activity-item'); row.type = 'button'; row.dataset.taskId = item.id;
        const icon = node('span', 'activity-icon', '▤'); icon.setAttribute('aria-hidden', 'true');
        const copy = node('span', 'activity-copy'); copy.appendChild(node('b', '', item.title)); copy.appendChild(node('small', '', `${status[item.status]} · ${date(item.updatedAt)}`));
        row.appendChild(icon); row.appendChild(copy);
        if (item.unread) { const marker = node('span', 'unread-marker'); marker.setAttribute('aria-label', '本机已同步的待查看标记'); row.appendChild(marker); }
        const metadata = node('div', 'panel-note'); metadata.id = `task-metadata-${index}`; metadata.hidden = true;
        for (const text of [`任务 ID：${item.id}`, `上次同步状态：${status[item.status]}`, `记录时间：${date(item.updatedAt)}`, `记录来源：${({ local: '本机', remote: '远程', cloud: '云端', unknown: '暂未提供' })[item.transport]}`, '仅展示元数据；展开不会读取正文或修改待查看标记。']) metadata.appendChild(node('p', '', text));
        row.setAttribute('aria-controls', metadata.id); row.setAttribute('aria-expanded', 'false');
        row.addEventListener('click', () => { metadata.hidden = !metadata.hidden; row.setAttribute('aria-expanded', String(!metadata.hidden)); resized(); });
        li.appendChild(row); li.appendChild(metadata); ul.appendChild(li);
      }
      host.appendChild(ul);
    }
    if (report?.truncated) host.appendChild(node('p', 'panel-note', '最多显示最近100条本机记录，列表可能不完整。'));
    resized();
  }
  root.workBuddyTasksView = { render(value, onResize) {
    const active = ['tasks', 'results'].includes(value?.action);
    el('quota-view').hidden = active; el('task-view').hidden = !active;
    if (!active) { current = null; title('积分变化'); return false; }
    if (current?.action !== value.action) mode = value.action;
    current = value; resize = typeof onResize === 'function' ? onResize : () => {}; draw(); return true;
  } };
})(typeof window === 'undefined' ? globalThis : window);
