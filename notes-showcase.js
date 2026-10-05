/* Memory-only product demo: no storage, model, notification, or network calls. */
(() => {
  const root = document.querySelector('[data-notes-demo]');
  if (!root) return;
  const get = name => root.querySelector(`[data-notes-${name}]`);
  const node = (tag, className, text) => {
    const item = document.createElement(tag); item.className = className || '';
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const localTime = date => `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = localDate(new Date());
  const seed = {
    note: [
      { id: 'n1', title: '周末的小计划', body: '去公园走走；记得带水和相机；出门前看看天气。', category: '生活', favorite: true, desktop: true },
      { id: 'n2', title: '灵感随手记', body: '把大计划拆成今天能做的一小步。', category: '工作', favorite: false, desktop: false },
      { id: 'n3', title: '读书摘记', body: '留一页空白，写下自己的想法。', category: '未分类', favorite: false, desktop: false },
      { id: 'n4', title: '以前的出行清单', body: '充电器、雨伞和一本书。', category: '生活', favorite: false, desktop: false, trash: true }
    ],
    todo: [
      { id: 't1', title: '给自己留一点休息时间', body: '', due: today, reminder: localTime(new Date(Date.now() + 3600000)), completed: false },
      { id: 't2', title: '整理今天的小计划', body: '', due: today, reminder: '', completed: false },
      { id: 't3', title: '读完一章书', body: '', due: today, reminder: '', completed: true },
      { id: 't4', title: '收好上周的照片', body: '', due: '', reminder: '', completed: true, archived: true },
      { id: 't5', title: '找回那张明信片', body: '', due: '', reminder: '', completed: false, trash: true }
    ]
  };
  const filters = {
    note: [['all', '全部便签'], ['favorites', '收藏'], ['desktop', '桌面显示'], ['生活', '生活'], ['工作', '工作'], ['未分类', '未分类'], ['trash', '回收站']],
    todo: [['all', '全部待办'], ['today', '今天'], ['pending', '未完成'], ['completed', '已完成'], ['archived', '归档'], ['trash', '回收站']]
  };
  let records, tab = 'note', selected = { note: 'n1', todo: 't1' }, filter = 'all', nextId = 0, organizing, undo, reminderId;
  const current = () => records[tab].find(item => item.id === selected[tab]);
  const titleOf = item => item.title.trim() || item.body.trim().split('\n')[0].slice(0, 40) || '无标题便签';
  const say = text => { get('status').textContent = text; };
  const button = (text, action, id, className) => {
    const item = node('button', className, text); item.type = 'button'; item.dataset.notesAction = action; item.dataset.notesId = id;
    return item;
  };
  function visible(item) {
    if (filter === 'trash') return !!item.trash;
    if (item.trash) return false;
    if (tab === 'note') return filter === 'all' || (filter === 'favorites' ? item.favorite : filter === 'desktop' ? item.desktop : item.category === filter);
    if (filter === 'archived') return !!item.archived;
    if (item.archived) return false;
    return filter === 'all' || (filter === 'completed' ? item.completed : filter === 'pending' ? !item.completed : item.due === today);
  }
  function renderList() {
    const query = get('search').value.trim().toLocaleLowerCase();
    const list = records[tab].filter(item => visible(item) && `${item.title} ${item.body}`.toLocaleLowerCase().includes(query));
    get('count').textContent = `${list.length} 条示例`;
    get('group').textContent = filters[tab].find(([value]) => value === filter)[1];
    get('records').replaceChildren();
    for (const item of list) {
      const label = titleOf(item);
      const row = node('article', `notes-record${item.completed ? ' is-completed' : ''}`);
      if (tab === 'todo' && !item.trash && !item.archived) {
        const check = button(item.completed ? '✓' : '', 'complete', item.id, 'notes-check');
        check.setAttribute('aria-pressed', String(item.completed)); check.setAttribute('aria-label', `${item.completed ? '恢复未完成' : '标记完成'}：${item.title}`); row.append(check);
      }
      const copy = node('div', 'notes-record-copy'), title = button(label, 'select', item.id, 'notes-record-title');
      title.setAttribute('aria-current', String(item.id === selected[tab])); copy.append(title);
      if (tab === 'note') copy.append(node('p', 'notes-record-preview', item.body));
      const meta = node('div', 'notes-record-meta');
      if (tab === 'note') { meta.append(node('span', 'notes-record-category', item.category)); if (item.desktop && !item.trash) meta.append(node('span', '', '桌面显示中')); }
      else { if (item.due) meta.append(node('span', '', `截止 ${item.due.slice(5)}`)); if (item.reminder && !item.completed && !item.trash) meta.append(node('span', '', `提醒 ${item.reminder.slice(11)}`)); if (item.archived) meta.append(node('span', '', '已归档')); }
      copy.append(meta); row.append(copy);
      if (item.trash || item.archived) row.append(button('恢复', 'restore', item.id, 'notes-primary'));
      else {
        if (tab === 'note') { const star = button(item.favorite ? '★' : '☆', 'favorite', item.id, 'notes-favorite'); star.setAttribute('aria-pressed', String(item.favorite)); star.setAttribute('aria-label', `${item.favorite ? '取消收藏' : '收藏'}：${label}`); row.append(star); }
        const menu = node('details', 'notes-record-menu'), summary = node('summary', '', '⋯'), actions = node('div');
        summary.setAttribute('aria-label', `${label}的更多操作`);
        if (tab === 'note') actions.append(button('在桌面显示', 'open', item.id));
        if (tab === 'todo' && item.completed) actions.append(button('归档已完成', 'archive', item.id));
        actions.append(button('移到回收站', 'trash', item.id)); menu.append(summary, actions); row.append(menu);
      }
      get('records').append(row);
    }
    if (!list.length) get('records').append(node('p', 'notes-empty', query ? '没有匹配的示例，试试其他关键词。' : '这里暂时没有记录。换个分组看看吧。'));
  }
  function renderSide() {
    const item = current();
    get('desktop').hidden = tab !== 'note'; get('timing').hidden = tab !== 'todo'; get('reminder').hidden = true;
    if (!item) return;
    if (tab === 'note') {
      const closed = !item.desktop || item.trash;
      get('card').hidden = closed; get('closed').hidden = !closed;
      get('closed-copy').textContent = item.trash ? '这条便签在回收站中，恢复后可继续使用。' : '内容保留在列表中，可以再放回桌面。';
      get('open-note').disabled = !!item.trash;
      get('title').value = item.title; get('body').value = item.body; get('category').value = item.category;
      get('undo').hidden = !undo || undo.id !== item.id;
    } else {
      get('todo-title').textContent = item.title; get('due').value = item.due; get('reminder-time').value = item.reminder;
      get('due').disabled = get('reminder-time').disabled = !!item.trash || !!item.archived;
      get('show-reminder').disabled = !!item.trash || !!item.completed || !item.reminder || item.reminderHandled || new Date(item.reminder) <= new Date();
    }
  }
  function render() { renderList(); renderSide(); }
  function setTab(value) {
    tab = value; filter = 'all'; get('search').value = '';
    root.querySelectorAll('[data-notes-tab]').forEach(item => { const active = item.dataset.notesTab === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; });
    get('records').setAttribute('aria-labelledby', tab === 'note' ? 'notes-demo-notes-tab' : 'notes-demo-todos-tab');
    get('filter').replaceChildren(...filters[tab].map(([value, label]) => { const option = node('option', '', label); option.value = value; return option; }));
    get('search').placeholder = tab === 'note' ? '搜索便签' : '搜索待办';
    get('draft').placeholder = tab === 'note' ? '写下想记住的事…' : '添加一件小事…'; get('draft').setAttribute('aria-label', tab === 'note' ? '新示例便签标题' : '新示例待办标题');
    get('draft').value = ''; render();
  }
  root.querySelectorAll('[data-notes-tab]').forEach(item => {
    item.addEventListener('click', () => setTab(item.dataset.notesTab));
    item.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setTab(event.key === 'Home' ? 'note' : event.key === 'End' ? 'todo' : tab === 'note' ? 'todo' : 'note'); root.querySelector(`[data-notes-tab="${tab}"]`).focus(); });
  });
  get('filter').addEventListener('change', () => { filter = get('filter').value; renderList(); });
  get('search').addEventListener('input', renderList);
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-notes-action]'); if (!target) return;
    const item = records[tab].find(record => record.id === target.dataset.notesId); if (!item) return;
    const action = target.dataset.notesAction;
    if (action === 'select') { selected[tab] = item.id; if (tab === 'note' && !item.trash) item.desktop = true; }
    if (action === 'open') { selected.note = item.id; item.desktop = true; say('示例便签已在旁边的桌面区域显示。'); }
    if (action === 'favorite') { item.favorite = !item.favorite; say(item.favorite ? '已收藏这条示例便签。' : '已取消收藏。'); }
    if (action === 'complete') { item.completed = !item.completed; say(item.completed ? '已完成。可在更多操作中归档。' : '已恢复未完成；已处理或过期的提醒不会重新启用。'); }
    if (action === 'archive') { item.archived = true; say('已归档，切换到“归档”可找到并恢复这条记录。'); }
    if (action === 'trash') { item.trash = true; item.desktop = false; say('已移到回收站，切换到“回收站”可恢复。'); }
    if (action === 'restore') { item.trash = false; item.archived = false; say(tab === 'note' ? '便签已恢复到列表，分类与收藏仍保留。' : '待办已恢复到列表，原来的完成状态保留。'); }
    render();
    const focusAction = action === 'favorite' ? 'favorite' : action === 'complete' ? 'complete' : 'select';
    root.querySelector(`[data-notes-id="${item.id}"][data-notes-action="${focusAction}"]`)?.focus();
  });
  get('quick').addEventListener('submit', event => {
    event.preventDefault(); const title = get('draft').value.trim(); if (!title) return;
    const id = `demo-${++nextId}`;
    records[tab].unshift(tab === 'note' ? { id, title, body: '', category: '未分类', favorite: false, desktop: true } : { id, title, body: '', due: '', reminder: '', completed: false });
    selected[tab] = id; filter = 'all'; get('filter').value = 'all'; get('search').value = ''; get('draft').value = ''; render(); say('已添加示例，刷新页面后会重置。'); get('draft').focus();
  });
  for (const field of ['title', 'body', 'category']) get(field).addEventListener(field === 'category' ? 'change' : 'input', () => {
    const item = current(); if (tab !== 'note' || !item || item.trash) return;
    item[field] = get(field).value; undo = null; get('undo').hidden = true; renderList(); say('修改仅保留在这次网页演示中。');
  });
  get('close-note').addEventListener('click', () => { current().desktop = false; render(); say('桌面便签已关闭，内容仍在列表中。'); get('open-note').focus(); });
  get('open-note').addEventListener('click', () => { if (current().trash) return; current().desktop = true; render(); get('title').focus(); });
  for (const field of ['due', 'reminder-time']) get(field).addEventListener('change', () => {
    const item = current(); if (tab !== 'todo' || !item || item.trash || item.archived || !get(field).validity.valid) return;
    item[field === 'due' ? 'due' : 'reminder'] = get(field).value; if (field === 'reminder-time') item.reminderHandled = false; renderList(); get('show-reminder').disabled = item.completed || !item.reminder || item.reminderHandled || new Date(item.reminder) <= new Date();
    say(field === 'due' ? '截止日期已修改，提醒时间保持原样。' : '提醒时间已修改，截止日期保持原样。');
  });
  get('show-reminder').addEventListener('click', () => { const item = current(); if (!item || item.completed || !item.reminder || item.reminderHandled || new Date(item.reminder) <= new Date()) return; reminderId = item.id; get('reminder-title').textContent = item.title; get('reminder').hidden = false; say('现在展示提醒卡示例，不会触发系统通知。'); get('reminder-complete').focus(); });
  get('reminder-complete').addEventListener('click', () => { const item = records.todo.find(item => item.id === reminderId); if (!item) return; item.completed = true; item.reminderHandled = true; render(); say('提醒中的示例待办已完成。'); get('show-reminder').focus(); });
  get('snooze').addEventListener('click', () => { const item = records.todo.find(item => item.id === reminderId); if (!item) return; item.reminder = localTime(new Date(Date.now() + 600000)); item.reminderHandled = false; render(); say('示例提醒已改为 10 分钟后；官网不会真的计时或发送通知。'); get('show-reminder').focus(); });
  get('organize').addEventListener('click', () => {
    const item = current(); if (!item || item.trash || !item.title.trim() && !item.body.trim()) return;
    organizing = { id: item.id, title: item.title, body: item.body };
    get('original').textContent = `${item.title}\n\n${item.body}`; get('original-details').open = true; get('result').hidden = true; get('apply').hidden = true; get('generate').hidden = false;
    get('organize-status').textContent = '原文保持不变，直到你确认替换。'; get('organize-dialog').showModal(); get('generate').focus();
  });
  get('generate').addEventListener('click', () => {
    if (!organizing) return;
    organizing.result = organizing.body.split(/[；;。\n]+/).map(line => line.trim()).filter(Boolean).map(line => `• ${line}`).join('\n');
    get('result-text').textContent = `${organizing.title}\n\n${organizing.result}`; get('result').hidden = false; get('original-details').open = false; get('generate').hidden = true; get('apply').hidden = false;
    get('organize-status').textContent = '请核对示例预览；替换后可立即撤销。'; get('apply').focus();
  });
  root.querySelectorAll('[data-notes-cancel-organize]').forEach(item => item.addEventListener('click', () => { get('organize-dialog').close(); say('原文保持不变。'); }));
  get('apply').addEventListener('click', () => {
    if (!organizing || organizing.result === undefined) return;
    const item = records.note.find(item => item.id === organizing.id);
    if (!item || item.trash || item.title !== organizing.title || item.body !== organizing.body) { get('organize-status').textContent = '原文已有变化，未替换。请关闭后重新整理。'; return; }
    undo = { id: item.id, title: item.title, body: item.body }; item.body = organizing.result; get('organize-dialog').close(); render(); say('已替换示例内容，可点“撤销整理”恢复原文。'); get('undo').focus();
  });
  get('undo').addEventListener('click', () => { const item = current(); if (!undo || item.id !== undo.id) return; item.title = undo.title; item.body = undo.body; undo = null; render(); say('已恢复整理前的原文。'); get('organize').focus(); });
  get('organize-dialog').addEventListener('close', () => { organizing = null; });
  get('reset').addEventListener('click', reset);
  function reset() { records = structuredClone(seed); selected = { note: 'n1', todo: 't1' }; undo = null; organizing = null; reminderId = null; get('organize-dialog').close(); setTab('note'); say('点开便签试试，也可以切换到待办。'); }
  reset();
})();
