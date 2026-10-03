const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/notes-model');
const { createNotesStore, MAX_BYTES } = require('../lib/notes-store');

function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-notes-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'private', 'notes.json');
  return { directory, file, store: createNotesStore(file, options) };
}

test('正式记录从空列表开始，模型在 Node 与隔离浏览器内共用', t => {
  const f = fixture(t);
  assert.deepEqual(f.store.getState(), { schema: 1, revision: 0, notes: [], todos: [] });
  assert.equal(f.store.getReadError(), null);
  assert.equal(fs.existsSync(f.file), false);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../lib/notes-model'), 'utf8'), context);
  assert.equal(typeof context.QiuModel.formatNote, 'function');
  assert.equal(context.QiuModel.newNote('浏览器便签').title, '浏览器便签');
});

test('原子回写、重读、版本与更新通知隔离，监听失败不使已保存操作失败', t => {
  const errors = [], f = fixture(t, { onError: error => errors.push(error) });
  const next = f.store.getState();
  next.notes.push({ ...M.newNote('独立便签', '完整正文'), favorite: true, desktopOpen: true, pinned: true,
    windowBounds: { x: -240, y: 80, width: 320, height: 280 } });
  next.todos.push(M.newTodo('测试待办'));
  next.revision = 99;
  let seen;
  const unsubscribe = f.store.subscribe(value => { seen = value; value.notes[0].body = '不应覆盖'; });
  f.store.subscribe(() => { throw Error('通知接收方失败'); });
  const saved = f.store.save(next, 0);
  assert.equal(saved.revision, 1);
  assert.equal(saved.notes[0].body, '完整正文');
  assert.equal(errors.length, 1);
  assert.equal(seen.revision, 1);
  next.notes[0].body = '外部草稿'; saved.notes.length = 0;
  assert.equal(f.store.getState().notes[0].body, '完整正文');
  assert.deepEqual(createNotesStore(f.file).getState(), f.store.getState());
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['notes.json']);
  unsubscribe();
  const updated = f.store.update(value => M.change(value, 'note', value.notes[0].id, 'favorite'));
  assert.equal(updated.revision, 2);
  assert.equal(updated.notes[0].favorite, false);
  assert.equal(seen.revision, 1);
});

test('过期窗口与更新中的冲突均不能覆盖已提交文件', t => {
  const f = fixture(t), old = f.store.getState();
  f.store.update(value => { value.notes.push(M.newNote('第一份')); return value; });
  const original = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => f.store.save(old, 0), { code: 'CONFLICT' });
  assert.throws(() => f.store.save(old, '1'), { code: 'CONFLICT' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  assert.throws(() => f.store.update(value => {
    f.store.update(inner => { inner.notes[0].title = '新提交'; return inner; });
    value.notes[0].title = '旧覆盖'; return value;
  }), { code: 'CONFLICT' });
  assert.equal(createNotesStore(f.file).getState().notes[0].title, '新提交');
});

test('写入、刷盘或替换失败保留原文件与内存状态，且清理本次临时文件', t => {
  const f = fixture(t);
  f.store.update(value => { value.notes.push(M.newNote('必须保留')); return value; });
  const original = fs.readFileSync(f.file, 'utf8'), before = f.store.getState();
  for (const method of ['writeFileSync', 'fsyncSync', 'renameSync']) {
    const fsImpl = Object.create(fs);
    fsImpl[method] = () => { throw Object.assign(Error('模拟存储失败'), { code: 'ENOSPC' }); };
    const failing = createNotesStore(f.file, { fsImpl });
    assert.throws(() => failing.update(value => { value.notes[0].body = '不能假保存'; return value; }), { code: 'STORAGE' });
    assert.deepEqual(failing.getState(), before);
    assert.equal(fs.readFileSync(f.file, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['notes.json']);
  }
});

test('损坏读取阻止空覆盖，原始文件可安全导出，重置成功后才解除阻塞', t => {
  const f = fixture(t), corrupt = '{这里是损坏的原稿';
  fs.mkdirSync(path.dirname(f.file)); fs.writeFileSync(f.file, corrupt);
  const fsImpl = Object.create(fs); let failRename = false;
  fsImpl.renameSync = (...args) => { if (failRename) throw Error('替换失败'); return fs.renameSync(...args); };
  const store = createNotesStore(f.file, { fsImpl });
  assert.ok(store.getReadError());
  assert.equal(store.getState().notes.length, 0);
  assert.throws(() => store.save(store.getState(), 0), { code: 'READ_BLOCKED' });
  const exported = path.join(f.directory, '原始记录.json');
  assert.equal(store.exportRaw(exported), exported);
  assert.equal(fs.readFileSync(exported, 'utf8'), corrupt);
  assert.throws(() => store.exportRaw(f.file));
  assert.throws(() => store.exportRaw(exported), { code: 'EEXIST' });
  failRename = true;
  assert.throws(() => store.reset(), { code: 'STORAGE' });
  assert.ok(store.getReadError());
  assert.equal(fs.readFileSync(f.file, 'utf8'), corrupt);
  failRename = false;
  assert.equal(store.reset().revision, 1);
  assert.equal(store.getReadError(), null);
  assert.deepEqual(createNotesStore(f.file).getState(), store.getState());
  store.update(value => { value.todos.push(M.newTodo('重置后能保存')); return value; });
  assert.equal(store.getState().todos.length, 1);
  assert.equal(fs.readFileSync(exported, 'utf8'), corrupt);
});

test('无效内容、窗口尺寸、超量 JSON 与符号链接均不会被当作正常记录覆盖', t => {
  const f = fixture(t), next = f.store.getState(), note = M.newNote('校验');
  next.notes.push(note);
  f.store.save(next, 0);
  const original = fs.readFileSync(f.file, 'utf8');
  for (const bounds of [{ x: 0, y: 0, width: 219, height: 200 }, { x: 0, y: 0, width: 300, height: 1201 },
    { x: Infinity, y: 0, width: 300, height: 200 }]) {
    const invalid = f.store.getState(); invalid.notes[0].windowBounds = bounds;
    assert.throws(() => f.store.save(invalid, 1));
  }
  const legacy = f.store.getState(); delete legacy.notes[0].windowBounds; delete legacy.notes[0].favorite;
  assert.doesNotThrow(() => M.validate(legacy));
  legacy.notes[0].favorite = 'true'; assert.throws(() => M.validate(legacy));
  const huge = f.store.getState(); huge.notes[0].body = '中'.repeat(20001);
  assert.throws(() => f.store.save(huge, 1));
  const oversized = f.store.getState(); oversized.notes = Array.from({ length: 80 }, () => M.newNote('内容', '中'.repeat(20000)));
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > MAX_BYTES);
  assert.throws(() => f.store.save(oversized, 1), { code: 'LIMIT' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  const link = path.join(f.directory, 'link.json'); fs.symlinkSync(f.file, link);
  const linked = createNotesStore(link);
  assert.ok(linked.getReadError());
  assert.throws(() => linked.save(linked.getState(), 0), { code: 'READ_BLOCKED' });
  assert.throws(() => linked.exportRaw(path.join(f.directory, 'link-export.json')));
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});

test('收藏独立于正文时间与桌面状态，删除恢复保留收藏，复制完整正文不重复首行', () => {
  const now = new Date('2026-10-03T10:00:00+08:00').getTime();
  const note = { ...M.newNote('', '首行\n第二行\n末行', now), desktopOpen: true, pinned: true };
  const initial = { schema: 1, revision: 0, notes: [note], todos: [] };
  const favorite = M.change(initial, 'note', note.id, 'favorite', now + 1000);
  assert.equal(favorite.notes[0].favorite, true);
  assert.equal(favorite.notes[0].updatedAt, now);
  assert.equal(favorite.notes[0].desktopOpen, true);
  assert.equal(favorite.notes[0].pinned, true);
  const deleted = M.change(favorite, 'note', note.id, 'trash', now + 2000);
  assert.throws(() => M.change(deleted, 'note', note.id, 'favorite'));
  const restored = M.change(deleted, 'note', note.id, 'restore', now + 3000);
  assert.equal(restored.notes[0].favorite, true);
  assert.equal(restored.notes[0].desktopOpen, false);
  assert.equal(M.formatNote(note), note.body);
  assert.equal(M.formatNote({ ...note, title: '标题' }), '标题\n首行\n第二行\n末行');
  assert.equal(M.formatList('note', deleted.notes, '回收站'), '便签列表 · 回收站（0 条）');
  assert.equal(M.formatList('note', favorite.notes, '收藏'), '便签列表 · 收藏（1 条）\n\n1. 首行\n   第二行\n   末行');
});

test('批量复制按当前顺序分块，保留全部正文与有效提醒，隐藏空字段和内部标识', () => {
  const now = new Date(2026, 9, 4, 10).getTime();
  const notes = [M.newNote('整理思路', '第一段\n\n  原始缩进\n末尾🙂', now),
    { ...M.newNote('已删除', '不能复制', now), deletedAt: now },
    M.newNote('', '\n正文首行\n\n  原始缩进\n最后一行\n', now)];
  const before = M.copy(notes);
  const notesText = M.formatList('note', notes, '搜索结果');
  assert.equal(notesText, '便签列表 · 搜索结果（2 条）\n\n1. 整理思路\n   第一段\n   \n     原始缩进\n   末尾🙂\n\n2. 正文首行\n   \n   \n     原始缩进\n   最后一行\n   ');
  assert.deepEqual(notes, before);
  assert.equal(notesText.includes(notes[0].id), false);
  assert.equal(M.formatNote(notes[2]), notes[2].body);

  const todos = [{ ...M.newTodo('整理方案', now), body: '第一段\n\n  原始缩进\n最后一段',
    reminderAt: new Date(2026, 9, 4, 15, 30).getTime(), reminderState: 'pending' },
    { ...M.newTodo('已经完成', now), dueDate: '', completed: true, completedAt: now,
      reminderAt: now, reminderState: 'cancelled' },
    { ...M.newTodo('已读提醒', now), dueDate: '', reminderAt: now, reminderState: 'dismissed' },
    { ...M.newTodo('待处理提醒', now), dueDate: '', reminderAt: new Date(2026, 9, 4, 12, 5).getTime(), reminderState: 'presented' },
    { ...M.newTodo('删除待办', now), deletedAt: now }];
  const todoText = M.formatList('todo', todos, '当前结果');
  assert.equal(todoText, '待办清单 · 当前结果（4 项）\n\n☐ 整理方案\n   截止：2026-10-04\n   提醒：2026-10-04 15:30\n   备注：\n      第一段\n      \n        原始缩进\n      最后一段\n\n☑ 已经完成\n\n☐ 已读提醒\n\n☐ 待处理提醒\n   提醒：2026-10-04 12:05');
  assert.equal(todoText.includes(todos[0].id), false);
  assert.equal(todoText.includes(todos[0].occurrenceId), false);
  assert.equal(M.formatList('todo', [], '无日期'), '待办清单 · 无日期（0 项）');
  const longBody = '完整正文'.repeat(5000);
  assert.equal(M.formatList('note', [M.newNote('长便签', longBody, now)], '全部便签'), `便签列表 · 全部便签（1 条）\n\n1. 长便签\n   ${longBody}`);
});

test('改期不改提醒或归档状态，完成与删除仅重新启用未来未展示的提醒', () => {
  const now = new Date('2026-10-03T10:00:00+08:00').getTime(), todo = M.newTodo('提醒闭环', now);
  todo.reminderAt = now + 60000; todo.reminderState = 'pending';
  const initial = { schema: 1, revision: 0, notes: [], todos: [todo] };
  const moved = M.setDueDate(initial, todo.id, M.plusDay(1, now), now + 10);
  assert.equal(moved.todos[0].reminderAt, todo.reminderAt);
  assert.equal(moved.todos[0].occurrenceId, todo.occurrenceId);
  assert.equal(moved.todos[0].reminderState, 'pending');
  assert.equal(moved.todos[0].completed, false);
  assert.throws(() => M.setDueDate(initial, todo.id, '2026-02-30', now));
  const complete = M.change(moved, 'todo', todo.id, 'complete', now + 20);
  assert.equal(complete.todos[0].reminderState, 'cancelled');
  assert.equal(M.dueReminders(complete, now + 60001).length, 0);
  const archive = M.change(complete, 'todo', todo.id, 'archive', now + 30);
  const noDate = M.setDueDate(archive, todo.id, '', now + 40);
  assert.equal(noDate.todos[0].completed, true); assert.equal(noDate.todos[0].archived, true);
  assert.equal(noDate.todos[0].reminderState, 'cancelled');
  const undone = M.change(complete, 'todo', todo.id, 'uncomplete', now + 50);
  assert.equal(undone.todos[0].reminderState, 'pending');
  assert.notEqual(undone.todos[0].occurrenceId, todo.occurrenceId);
  const deleted = M.change(undone, 'todo', todo.id, 'trash', now + 100);
  assert.throws(() => M.setDueDate(deleted, todo.id, '', now + 200));
  assert.equal(M.change(deleted, 'todo', todo.id, 'restore', now + 200).todos[0].reminderState, 'pending');
  assert.equal(M.change(deleted, 'todo', todo.id, 'restore', now + 60001).todos[0].reminderState, 'cancelled');
  const presented = M.change(initial, 'todo', todo.id, 'present', now + 100);
  const closed = M.change(presented, 'todo', todo.id, 'dismiss', now + 101);
  const doneClosed = M.change(closed, 'todo', todo.id, 'complete', now + 102);
  assert.equal(M.change(doneClosed, 'todo', todo.id, 'uncomplete', now + 103).todos[0].reminderState, 'cancelled');
  const snoozed = M.change(presented, 'todo', todo.id, 'snooze', now + 200);
  assert.equal(snoozed.todos[0].reminderAt, now + 600200);
  assert.equal(snoozed.todos[0].dueDate, todo.dueDate);
  assert.notEqual(snoozed.todos[0].occurrenceId, todo.occurrenceId);
  assert.equal(M.dueReminders(snoozed, now + 600200)[0].id, todo.id);
});
