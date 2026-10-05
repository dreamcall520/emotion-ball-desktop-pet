/* Demo IPC only. The original app model, renderer and styles remain unchanged. */
(() => {
  'use strict';
  const M = window.QiuModel, params = new URLSearchParams(location.search);
  const scope = params.get('demoScope') || crypto.randomUUID();
  const mode = location.pathname.endsWith('panel.html') ? 'panel' : location.pathname.endsWith('reminder.html') ? 'reminder' : 'note';
  const role = mode === 'panel' ? 'panel' : 'desktop';
  const initialId = params.get('id') || 'sample-weekend';
  const listeners = new Map(), pending = new Map();
  const instanceId = crypto.randomUUID();
  let state, panelPinned = false, activeNoteId = initialId, secondaryMode = 'note', reminder = { items: [] }, counter = 0;
  let appearance = 'light', colorMode = 'standard';
  const copy = value => structuredClone(value);
  const emit = (name, value, second) => { for (const callback of listeners.get(name) || []) callback(copy(value), second); };
  const listen = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); return () => listeners.get(name).delete(callback); };
  const post = packet => parent.postMessage({ type: 'qiuqiu-notes-demo', scope, from: role, ...packet }, location.origin);
  function seed() {
    const now = Date.now();
    const notes = [
      { ...M.newNote('周末的小计划', '去公园走走；记得带水和相机；出门前看看天气。', now - 60000), id: 'sample-weekend', categoryId: 'sample-life', desktopOpen: true, pinned: true, favorite: true },
      { ...M.newNote('阅读摘记', '留一页空白，写下自己的想法。', now - 3600000), id: 'sample-reading', categoryId: 'sample-life', favorite: true },
      { ...M.newNote('灵感随手记', '把大计划拆成今天能做的一小步。', now - 7200000), id: 'sample-idea', categoryId: 'sample-work' },
      { ...M.newNote('以前的出行清单', '充电器、雨伞和一本书。', now - 86400000), id: 'sample-note-trash', deletedAt: now - 300000 }
    ];
    const todos = [
      { ...M.newTodo('给自己留一点休息时间', now - 60000), id: 'sample-rest', reminderAt: now + 1800000, reminderState: 'pending' },
      { ...M.newTodo('整理今天的小计划', now - 3600000), id: 'sample-plan' },
      { ...M.newTodo('读完一章书', now - 7200000), id: 'sample-read', completed: true, completedAt: now - 1800000 },
      { ...M.newTodo('收好上周的照片', now - 86400000), id: 'sample-archive', completed: true, completedAt: now - 3600000, archived: true },
      { ...M.newTodo('找回那张明信片', now - 7200000), id: 'sample-todo-trash', deletedAt: now - 300000 }
    ];
    return M.validate({ schema: 2, revision: 0, categories: [{ id: 'sample-life', name: '生活' }, { id: 'sample-work', name: '工作' }], notes, todos });
  }
  function publish(next) {
    state = copy(M.validate(next)); emit('state', state);
    post({ kind: 'state', state });
    const active = state.notes.find(note => note.id === activeNoteId);
    if (secondaryMode === 'note' && (!active || active.deletedAt || !active.desktopOpen)) noteView(false);
  }
  function update(fn) { const next = copy(state); fn(next); next.revision = state.revision + 1; publish(next); return { ok: true, state: copy(state) }; }
  function noteView(open, id = activeNoteId) { secondaryMode = 'note'; post({ kind: 'view', view: 'note', open, id }); }
  function reminderView() { secondaryMode = 'reminder'; post({ kind: 'view', view: 'reminder', open: true }); }
  function run(method, args = []) {
    if (!state) state = seed();
    if (method === 'load') return { state: copy(state), mode: args[0], id: args[1] || activeNoteId, tab: 'note', panelPinned, notesAppearance: appearance, reminder: copy(reminder) };
    if (method === 'save') {
      const [next, revision] = args;
      if (revision !== state.revision) return { ok: false, state: copy(state), message: '另一演示窗口已有更新，输入已保留，请重新打开。' };
      M.validate(next); const saved = copy(next); saved.revision = state.revision + 1; publish(saved); return { ok: true, state: copy(state) };
    }
    if (method === 'openNote') {
      const item = state.notes.find(note => note.id === args[0]);
      if (!item || item.deletedAt) return { ok: false, message: '请先从回收站恢复这条便签。' };
      activeNoteId = item.id; const result = item.desktopOpen ? { ok: true } : update(next => { next.notes.find(note => note.id === item.id).desktopOpen = true; });
      noteView(true, item.id); return result;
    }
    if (method === 'closeWindow') {
      if (args[0] === 'reminder') { noteView(state.notes.some(note => note.id === activeNoteId && note.desktopOpen && !note.deletedAt)); return { ok: true }; }
      const id = args[1]; if (state.notes.some(note => note.id === id)) update(next => { next.notes.find(note => note.id === id).desktopOpen = false; });
      noteView(false, id); return { ok: true };
    }
    if (method === 'hidePanel') { post({ kind: 'panel-visibility', open: false }); return { ok: true }; }
    if (method === 'pinPanel') { panelPinned = args[0] === true; return { ok: true, pinned: panelPinned }; }
    if (method === 'pinNote') return { ok: true, pinned: args[0] === true };
    if (method === 'reset') { const next = seed(); next.revision = state.revision + 1; publish(next); return { ok: true, state: copy(state) }; }
    if (method === 'showReminder') {
      const items = state.todos.filter(item => !item.deletedAt && !item.completed && item.reminderAt !== null);
      if (!items.length) return { ok: false, message: '先为一个未完成待办设置提醒，再体验提醒。' };
      reminder = { items: copy(items), activeId: items[0].id, occurrenceId: items[0].occurrenceId };
      emit('reminder', reminder); post({ kind: 'reminder', reminder }); reminderView(); return { ok: true };
    }
    if (method === 'actionReminder') {
      const [id, occurrenceId, action] = args;
      if (action === 'list' || action === 'process') { post({ kind: 'panel-visibility', open: true }); emit('open', { tab: 'todo' }); noteView(state.notes.some(note => note.id === activeNoteId && note.desktopOpen && !note.deletedAt)); return { ok: true, state: copy(state) }; }
      const item = state.todos.find(todo => todo.id === id);
      if (!item || item.occurrenceId !== occurrenceId || item.completed || item.deletedAt) return { ok: false, message: '这项示例提醒已处理。' };
      publish(M.change(state, 'todo', id, action));
      reminder.items = reminder.items.filter(todo => todo.id !== id);
      if (reminder.items.length) { reminder.activeId = reminder.items[0].id; reminder.occurrenceId = reminder.items[0].occurrenceId; emit('reminder', reminder); post({ kind: 'reminder', reminder }); }
      else noteView(state.notes.some(note => note.id === activeNoteId && note.desktopOpen && !note.deletedAt));
      post({ kind: 'notice', message: action === 'snooze' ? '示例已改为稍后 10 分钟；网页不发送系统通知。' : action === 'complete' ? '示例待办已完成。' : '本次示例提醒已关闭，待办仍未完成。' });
      return { ok: true, state: copy(state) };
    }
    throw Error('不支持的演示操作。');
  }
  function request(method, args = []) {
    if (role === 'panel') { try { return Promise.resolve(run(method, args)); } catch (error) { return Promise.reject(error); } }
    const requestId = `${role}-${instanceId}-${++counter}`;
    return new Promise((resolve, reject) => {
      const packet = { kind: 'request', method, args, requestId };
      const retry = method === 'load' ? setInterval(() => post(packet), 200) : null;
      const timeout = setTimeout(() => { clearInterval(retry); pending.delete(requestId); reject(Error('演示窗口暂未连接，请重置网页演示。')); }, 8000);
      pending.set(requestId, { resolve, reject, retry, timeout }); post(packet);
    });
  }
  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const packet = event.data;
    if (packet?.type === 'qiuqiu-demo-theme') {
      appearance = packet.appearance === 'dark' ? 'dark' : 'light'; colorMode = packet.colorMode === 'accessible' ? 'accessible' : 'standard';
      emit('appearance', appearance); emit('colorMode', colorMode, appearance); return;
    }
    if (packet?.type !== 'qiuqiu-notes-demo' || packet.scope !== scope) return;
    if (packet.kind === 'request' && role === 'panel') {
      try { post({ kind: 'response', requestId: packet.requestId, result: copy(await run(packet.method, packet.args)) }); }
      catch (error) { post({ kind: 'response', requestId: packet.requestId, error: error.message }); }
    } else if (packet.kind === 'response') {
      const promise = pending.get(packet.requestId); if (!promise) return;
      clearInterval(promise.retry); clearTimeout(promise.timeout); pending.delete(packet.requestId);
      if (packet.error) promise.reject(Error(packet.error)); else promise.resolve(packet.result);
    } else if (packet.kind === 'state' && role !== 'panel') { M.validate(packet.state); state = copy(packet.state); emit('state', state); }
    else if (packet.kind === 'reminder' && role !== 'panel') { reminder = copy(packet.reminder); emit('reminder', reminder); }
    else if (packet.kind === 'show-reminder' && role === 'panel') { const result = await request('showReminder'); if (!result.ok) post({ kind: 'notice', message: result.message }); }
    else if (packet.kind === 'reopen-note' && role === 'panel') { const result = await request('openNote', [activeNoteId]); if (!result.ok) post({ kind: 'notice', message: result.message }); }
  });
  window.qiuNotes = {
    async load() { const loaded = await request('load', [mode, initialId]); state = copy(loaded.state); return { ...loaded, notesAppearance: appearance }; },
    save: (next, revision) => request('save', [next, revision]),
    openNote: id => request('openNote', [id]), hidePanel: () => request('hidePanel'), closeWindow: () => request('closeWindow', [mode, initialId]),
    pinNote: value => request('pinNote', [value]), pinPanel: value => request('pinPanel', [value]),
    async copyText(text) { try { await navigator.clipboard.writeText(text); return { ok: true }; } catch { return { ok: false, message: '浏览器未允许复制，请手动复制。' }; } },
    async organizeNote(snapshot) { return { ok: true, result: { title: snapshot.title, body: snapshot.body.split(/[；;。\n]+/).map(line => line.trim()).filter(Boolean).map(line => `• ${line}`).join('\n') } }; },
    cancelOrganize: async () => ({ ok: true }), exportRaw: async () => ({ cancelled: true }), reset: () => request('reset'),
    actionReminder: (id, occurrenceId, action) => request('actionReminder', [id, occurrenceId, action]),
    onState: callback => listen('state', callback), onOpen: callback => listen('open', callback), onReminder: callback => listen('reminder', callback),
    onAppearance(callback) { callback(appearance); return listen('appearance', callback); },
    onColorMode(callback) { callback(colorMode, appearance); return listen('colorMode', callback); },
    onStorageError: callback => listen('storageError', callback), onCloseCancelled: callback => listen('closeCancelled', callback), onBeforeClose: callback => listen('beforeClose', callback)
  };
})();
