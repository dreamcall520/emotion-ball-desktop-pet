const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setImmediate: flush } = require('node:timers/promises');
const M = require('../lib/notes-model');
const { createNotesCompanion, visibleBounds } = require('../lib/notes-companion');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

function fixture(t, initial, getDefaultTab, organizer, getAppearance) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiu-notes-window-'));
  const file = path.join(dir, 'notes.json');
  if (initial) fs.writeFileSync(file, JSON.stringify(initial));
  let clock = new Date('2026-10-03T12:00:00').getTime(), tick;
  const windows = [], errors = [], completions = [], handlers = new Map(), clipboard = [], dialogs = [], dialogCalls = [], dialogResult = { response: 1 };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false; this.destroyed = false; this.sent = [];
      const contents = Object.assign(new EventEmitter(), { mainFrame: {},
        getURL: () => this.url, setWindowOpenHandler: fn => { this.openHandler = fn; },
        send: (channel, value) => {
          this.sent.push([channel, value]);
          if (channel === 'notes:before-close' && this.allowClose !== undefined) {
            ipc.emit('notes:close-response', event(this), value.token, this.allowClose);
          }
        }
      });
      Object.defineProperty(this, 'webContents', { get: () => {
        if (this.destroyed) throw new TypeError('Object has been destroyed');
        return contents;
      } });
      windows.push(this);
    }
    loadFile(filePath, { query }) { this.url = pathToFileURL(filePath).href + '?' + new URLSearchParams(query); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; this.activeShow = true; }
    showInactive() { this.visible = true; this.inactiveShow = true; this.inactiveShows = (this.inactiveShows || 0) + 1; }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    setBackgroundColor(value) { this.backgroundColor = value; }
    setAlwaysOnTop(value) { this.pinned = value; }
    isAlwaysOnTop() { return this.pinned === true; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.boundsWrites = (this.boundsWrites || 0) + 1; }
  }
  const ipc = Object.assign(new EventEmitter(), { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) });
  const screen = Object.assign(new EventEmitter(), {
    area: { x: 0, y: 30, width: 1440, height: 900 },
    getDisplayMatching() { return { workArea: this.area }; }, getPrimaryDisplay() { return { workArea: this.area }; }
  });
  const pet = { bounds: { x: 1360, y: 880, width: 80, height: 80 }, visible: true, destroyed: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, getBounds() { return { ...this.bounds }; } };
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const controller = createNotesCompanion({ BrowserWindow: Window, ipcMain: ipc, screen, filePath: file,
    clipboard: { writeText: text => clipboard.push(text) },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showMessageBox: async (...args) => { dialogs.push(args.at(-1)); dialogCalls.push(args); return dialogResult; } },
    getPetBounds: () => pet.destroyed ? null : pet.getBounds(), getPetWindow: () => pet,
    getPetPresentation: () => ({ shape: 'aurora-cloud' }), getDefaultTab, getAppearance, organizer, onError: error => errors.push(error),
    onComplete: id => completions.push(id), now: () => clock,
    setTimer: fn => { tick = fn; return { unref() {} }; }, clearTimer: () => { tick = null; }, closeTimeoutMs: 50 });
  t.after(async () => {
    for (const win of windows) win.allowClose = true;
    await controller.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  return { controller, windows, screen, pet, errors, completions, clipboard, handlers, ipc, file, dir, dialogs, dialogCalls, dialogResult,
    event, call: (win, channel, ...args) => handlers.get(channel)(event(win), ...args),
    ready: win => { win.emit('ready-to-show'); return win; },
    time: time => { clock = time; tick?.(); }, now: () => clock,
    descriptor: () => controller.getWindows().reminder?.sent.filter(([channel]) => channel === 'notes:reminder').at(-1)?.[1]
  };
}

test('notes windows deny unrelated/subframe/navigation IPC and use isolated local preload', async t => {
  const f = fixture(t), panel = f.ready(f.controller.openPanel({ tab: 'note', create: true }));
  const options = panel.options.webPreferences;
  assert.equal(panel.options.width, 380); assert.equal(panel.options.height, 520);
  assert.equal(options.contextIsolation, true); assert.equal(options.nodeIntegration, false); assert.equal(options.sandbox, true);
  assert.equal(panel.openHandler().action, 'deny');
  let prevented = false; panel.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  assert.deepEqual((await f.call(panel, 'notes:load')).state.notes, []);
  assert.equal((await f.handlers.get('notes:copy')({ sender: panel.webContents, senderFrame: {} }, 'secret')).ok, false);
  panel.url = 'https://example.test/';
  assert.equal((await f.call(panel, 'notes:copy', 'secret')).ok, false); assert.equal(f.clipboard.length, 0);
});

test('normal opens use the current default even in an existing panel, explicit routes override it', t => {
  let defaultTab = 'note';
  const f = fixture(t, undefined, () => defaultTab), panel = f.ready(f.controller.openPanel());
  const lastOpen = () => panel.sent.filter(([channel]) => channel === 'notes:open').at(-1)[1];
  assert.deepEqual(lastOpen(), { tab: 'note', create: false, id: null });
  assert.equal(f.controller.openPanel({ tab: 'todo', create: true, id: 'todo-1' }), panel);
  assert.deepEqual(lastOpen(), { tab: 'todo', create: true, id: 'todo-1' });
  assert.equal(f.controller.openPanel(), panel);
  assert.equal(lastOpen().tab, 'note');
  defaultTab = 'todo';
  f.controller.openPanel({ tab: 'note', id: 'note-1' });
  assert.deepEqual(lastOpen(), { tab: 'note', create: false, id: 'note-1' });
  f.controller.openPanel(); assert.equal(lastOpen().tab, 'todo');
  for (defaultTab of [undefined, null, 'notes', {}, 1]) {
    f.controller.openPanel(); assert.equal(lastOpen().tab, 'todo');
  }
  const fallback = fixture(t), fresh = fallback.ready(fallback.controller.openPanel());
  assert.equal(fresh.sent.find(([channel]) => channel === 'notes:open')[1].tab, 'todo');
});

test('panel topmost is window-only, readable, retained on hide and protected by sender/mode checks', async t => {
  const f = fixture(t), panel = f.ready(f.controller.openPanel()), store = f.controller.getStore();
  const original = store.getState();
  assert.equal((await f.call(panel, 'notes:load')).panelPinned, false);
  assert.deepEqual(await f.call(panel, 'notes:pin-panel', true), { ok: true, pinned: true });
  assert.equal(panel.isAlwaysOnTop(), true); assert.equal((await f.call(panel, 'notes:load')).panelPinned, true);
  panel.allowClose = true; assert.equal((await f.call(panel, 'notes:hide-panel')).ok, true);
  assert.equal(f.controller.openPanel(), panel); assert.equal(panel.isAlwaysOnTop(), true);
  assert.equal((await f.handlers.get('notes:pin-panel')({ sender: panel.webContents, senderFrame: {} }, false)).ok, false);
  assert.equal(panel.isAlwaysOnTop(), true);
  assert.deepEqual(await f.call(panel, 'notes:pin-panel', false), { ok: true, pinned: false });
  assert.equal((await f.call(panel, 'notes:pin-panel', 'true')).ok, false);
  assert.equal(panel.isAlwaysOnTop(), false); assert.deepEqual(store.getState(), original);
  const note = M.newNote('independent', '', f.now());
  store.update(state => { state.notes.push(note); return state; }); f.controller.openNote(note.id);
  const noteWindow = f.ready(f.controller.getWindows().notes[0]);
  assert.equal((await f.call(noteWindow, 'notes:pin-panel', true)).ok, false);
  assert.equal(store.getState().notes[0].pinned, false);
  await f.call(panel, 'notes:pin-panel', true); panel.destroy();
  const fresh = f.ready(f.controller.openPanel()); assert.equal((await f.call(fresh, 'notes:load')).panelPinned, false);
});

test('desktop notes use one editor, save bounds, restore pinned state and hide without deleting', async t => {
  const f = fixture(t), store = f.controller.getStore(), note = M.newNote('test', 'body', f.now());
  store.update(state => { state.notes.push(note); return state; });
  assert.equal(f.controller.openNote(note.id).ok, true);
  const first = f.ready(f.controller.getWindows().notes[0]); first.allowClose = true;
  assert.equal(first.getBounds().width, 300); assert.equal(first.getBounds().height, 220);
  assert.equal(first.options.maxWidth, 1400); assert.equal(first.options.maxHeight, 1200);
  assert.equal(f.controller.openNote(note.id).ok, true); assert.equal(f.controller.getWindows().notes.length, 1);
  const next = store.getState(); next.notes[0].pinned = true;
  assert.equal((await f.call(first, 'notes:save', next, next.revision)).ok, true); assert.equal(first.pinned, true);
  first.setBounds({ x: 100, y: 200, width: 320, height: 300 });
  assert.equal((await f.call(first, 'notes:close-window')).ok, true);
  const saved = store.getState().notes[0];
  assert.equal(saved.desktopOpen, false); assert.equal(saved.body, 'body'); assert.equal(saved.deletedAt, null);
  assert.deepEqual(saved.windowBounds, { x: 100, y: 200, width: 320, height: 300 });
  f.controller.openNote(note.id); const restored = f.controller.getWindows().notes[0];
  assert.deepEqual(restored.getBounds(), saved.windowBounds); assert.equal(restored.pinned, true);
});

test('closed cleanup survives Electron destroyed getters, native hide, reopen and pending quit', async t => {
  const f = fixture(t), store = f.controller.getStore(), note = M.newNote('native lifecycle', 'saved', f.now());
  store.update(state => { state.notes.push({ ...note, desktopOpen: true }); return state; });
  const first = f.ready(f.controller.getWindows().notes[0]); first.allowClose = true;
  let prevented = false;
  first.emit('close', { preventDefault() { prevented = true; } }); await flush();
  assert.equal(prevented, true); assert.equal(first.destroyed, true);
  assert.throws(() => first.webContents, /Object has been destroyed/);
  assert.equal(f.controller.getWindows().notes.length, 0);
  assert.equal(store.getState().notes[0].desktopOpen, false);
  assert.equal(f.controller.openNote(note.id).ok, true);
  const reopened = f.ready(f.controller.getWindows().notes[0]);
  assert.notEqual(reopened, first); assert.equal(store.getState().notes[0].body, 'saved');
  const quitting = f.controller.close(); await flush();
  assert.equal(reopened.sent.some(([channel]) => channel === 'notes:before-close'), true);
  reopened.destroy();
  assert.equal(await quitting, true); assert.equal(f.controller.getWindows().notes.length, 0);
  assert.equal(store.getState().notes[0].desktopOpen, true);
  assert.deepEqual(f.errors, []);
});

test('quit waits for every editor, cancellation destroys none, successful quit retains restart flags', async t => {
  const f = fixture(t), store = f.controller.getStore();
  store.update(state => { state.notes.push({ ...M.newNote('keep', '', f.now()), desktopOpen: true }); return state; });
  const note = f.ready(f.controller.getWindows().notes[0]), panel = f.ready(f.controller.openPanel());
  note.allowClose = true; panel.allowClose = false;
  assert.equal(await f.controller.close(), false); assert.equal(note.destroyed, false); assert.equal(panel.destroyed, false);
  assert.equal(f.handlers.has('notes:save'), true);
  panel.allowClose = true;
  assert.equal(await f.controller.close(), true); assert.equal(note.destroyed, true); assert.equal(panel.destroyed, true);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).notes[0].desktopOpen, true); assert.equal(f.handlers.size, 0);
});

test('quit holds approved editors while another waits, and cancellation releases the matching tokens', async t => {
  const f = fixture(t), store = f.controller.getStore();
  store.update(state => { state.notes.push({ ...M.newNote('first', '', f.now()), desktopOpen: true }); return state; });
  const first = f.ready(f.controller.getWindows().notes[0]), second = f.ready(f.controller.openPanel());
  first.allowClose = true;
  const quitting = f.controller.close(); await flush();
  const a = first.sent.find(([channel]) => channel === 'notes:before-close')[1];
  const b = second.sent.find(([channel]) => channel === 'notes:before-close')[1];
  assert.equal(a.hold, true); assert.equal(b.hold, true); assert.notEqual(a.token, b.token);
  assert.equal(first.destroyed, false); assert.equal(second.destroyed, false);
  f.ipc.emit('notes:close-response', f.event(second), b.token, false);
  assert.equal(await quitting, false);
  assert.equal(first.sent.find(([channel]) => channel === 'notes:close-cancelled')[1], a.token);
  assert.equal(second.sent.find(([channel]) => channel === 'notes:close-cancelled')[1], b.token);
  f.ipc.emit('notes:close-response', f.event(first), a.token, true);
  assert.equal(first.destroyed, false);
  second.allowClose = true;
  assert.equal(await f.controller.close(), true);
});

test('quit cannot reuse an ordinary hide approval as a held editor approval', async t => {
  const f = fixture(t), panel = f.ready(f.controller.openPanel());
  const hiding = f.call(panel, 'notes:hide-panel');
  const ordinary = panel.sent.find(([channel]) => channel === 'notes:before-close')[1];
  assert.equal(ordinary.hold, false);
  const quitting = f.controller.close();
  f.ipc.emit('notes:close-response', f.event(panel), ordinary.token, true);
  assert.equal((await hiding).ok, true); await flush();
  const held = panel.sent.filter(([channel]) => channel === 'notes:before-close').at(-1)[1];
  assert.equal(held.hold, true); assert.notEqual(held.token, ordinary.token);
  assert.equal(panel.destroyed, false);
  f.ipc.emit('notes:close-response', f.event(panel), held.token, true);
  assert.equal(await quitting, true);
});

test('quit timeout and bounds-write failure release every held editor without destroying drafts', async t => {
  const f = fixture(t), store = f.controller.getStore();
  store.update(state => { state.notes.push({ ...M.newNote('first', '', f.now()), desktopOpen: true }); return state; });
  const first = f.ready(f.controller.getWindows().notes[0]), second = f.ready(f.controller.openPanel());
  first.allowClose = true;
  const timed = f.controller.close();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(await timed, false); assert.equal(first.destroyed, false);
  assert.equal(first.sent.filter(([channel]) => channel === 'notes:close-cancelled').length, 1);
  assert.equal(second.sent.filter(([channel]) => channel === 'notes:close-cancelled').length, 1);
  second.allowClose = true;
  const rename = fs.renameSync; fs.renameSync = () => { throw Error('disk failed'); };
  try { assert.equal(await f.controller.close(), false); }
  finally { fs.renameSync = rename; }
  assert.equal(first.destroyed, false); assert.equal(second.destroyed, false);
  assert.equal(first.sent.filter(([channel]) => channel === 'notes:close-cancelled').length, 2);
  assert.equal(second.sent.filter(([channel]) => channel === 'notes:close-cancelled').length, 2);
  const getBounds = first.getBounds; first.getBounds = () => { throw Error('native window failed'); };
  try { assert.equal(await f.controller.close(), false); }
  finally { first.getBounds = getBounds; }
  assert.equal(first.sent.filter(([channel]) => channel === 'notes:close-cancelled').length, 3);
});

test('quit warns only for active reminders and may remain running even without an open notes window', async t => {
  const f = fixture(t), store = f.controller.getStore();
  const todo = { ...M.newTodo('future', f.now()), reminderAt: f.now() + 600000, reminderState: 'pending' };
  store.update(state => { state.todos.push(todo); return state; });
  f.dialogResult.response = 0;
  assert.equal(await f.controller.close(), false); assert.equal(f.handlers.has('notes:load'), true);
  const prompt = f.dialogs[0];
  assert.deepEqual(prompt.buttons, ['继续运行', '退出球球']); assert.equal(prompt.defaultId, 0); assert.equal(prompt.cancelId, 0);
  assert.equal(store.getState().todos[0].reminderState, 'pending');
  f.dialogResult.response = 1;
  assert.equal(await f.controller.close(), true);
});

test('quit reminder confirmation uses a visible notes parent and remains independent when every notes window is hidden', async t => {
  const f = fixture(t), store = f.controller.getStore(), panel = f.ready(f.controller.openPanel());
  panel.allowClose = true;
  store.update(state => {
    state.todos.push({ ...M.newTodo('keep reminder', f.now()), reminderAt: f.now() - 1, reminderState: 'pending' });
    return state;
  });
  const reminder = f.ready(f.controller.getWindows().reminder), saved = store.getState();
  assert.equal(panel.visible, true); assert.equal(reminder.visible, true);
  f.dialogResult.response = 0;
  assert.equal(await f.controller.close(), false);
  assert.equal(f.dialogCalls.at(-1)[0], panel, 'visible notes window remains the sheet parent');
  f.controller.pause();
  assert.equal(panel.visible, false); assert.equal(reminder.visible, false);
  assert.equal(await f.controller.close(), false);
  assert.equal(f.dialogCalls.at(-1).length, 1, 'hidden windows must not own the exit reminder confirmation');
  assert.equal(f.dialogCalls.at(-1)[0].message, '退出后提醒将暂停，下次启动会汇总未处理提醒。');
  assert.deepEqual(store.getState(), saved); assert.equal(panel.destroyed, false); assert.equal(reminder.destroyed, false);
  f.dialogResult.response = 1;
  assert.equal(await f.controller.close(), true);
  assert.equal(f.dialogCalls.at(-1).length, 1); assert.deepEqual(store.getState(), saved);
  assert.equal(panel.destroyed, true); assert.equal(reminder.destroyed, true);
});

test('save failure preserves note window and its old desktop state for retry', async t => {
  const f = fixture(t), store = f.controller.getStore();
  store.update(state => { state.notes.push({ ...M.newNote('keep', '', f.now()), desktopOpen: true }); return state; });
  const win = f.ready(f.controller.getWindows().notes[0]); win.allowClose = true;
  const rename = fs.renameSync; fs.renameSync = () => { throw Error('disk failed'); };
  try {
    const result = await f.call(win, 'notes:close-window'); assert.equal(result.ok, false);
    assert.equal(win.destroyed, false); assert.equal(store.getState().notes[0].desktopOpen, true);
  } finally { fs.renameSync = rename; }
  assert.equal((await f.call(win, 'notes:close-window')).ok, true); assert.equal(win.destroyed, true);
});

test('startup/lock recovery summarizes due reminders, processes one token and never focuses', async t => {
  const f = fixture(t), store = f.controller.getStore();
  const a = { ...M.newTodo('one', f.now()), reminderAt: f.now() + 5000, reminderState: 'pending' };
  const b = { ...M.newTodo('two', f.now() + 1), reminderAt: f.now() + 6000, reminderState: 'pending' };
  store.update(state => { state.todos.push(a, b); return state; });
  f.controller.pause(); f.time(f.now() + 10000);
  assert.equal(store.getState().todos[0].reminderState, 'pending'); assert.equal(f.controller.getWindows().reminder, null);
  f.controller.resume(); const win = f.ready(f.controller.getWindows().reminder);
  assert.equal(f.descriptor().summary, true); assert.equal(f.descriptor().items.length, 2);
  assert.equal(win.inactiveShow, true); assert.equal(win.focused, undefined);
  assert.equal((await f.call(win, 'notes:close-window')).ok, true);
  assert.equal(win.visible, false); assert.equal(store.getState().todos[0].reminderState, 'pending');
  f.time(f.now() + 1000); assert.equal(win.visible, false);
  f.controller.pause(); f.controller.resume(); assert.equal(win.visible, true);
  await f.call(win, 'notes:reminder-action', null, null, 'process');
  assert.equal(f.descriptor().activeId, a.id); assert.equal(store.getState().todos[0].reminderState, 'presented');
  assert.equal((await f.call(win, 'notes:reminder-action', a.id, 'stale-token', 'complete')).ok, false);
  assert.equal(store.getState().todos[0].completed, false);
  assert.equal((await f.call(win, 'notes:reminder-action', a.id, a.occurrenceId, 'complete')).ok, true);
  assert.deepEqual(f.completions, [a.id]); assert.equal(f.descriptor().activeId, b.id);
  const result = await f.call(win, 'notes:reminder-action', b.id, b.occurrenceId, 'snooze');
  assert.equal(result.ok, true); assert.equal(store.getState().todos[1].reminderAt, f.now() + 600000);
  assert.notEqual(store.getState().todos[1].occurrenceId, b.occurrenceId); assert.equal(win.visible, false);
});

test('hiding an old summary or viewing its list does not suppress a later new reminder', async t => {
  for (const hideBy of ['close', 'list']) {
    const f = fixture(t, undefined, () => 'note'), store = f.controller.getStore();
    const old = { ...M.newTodo('old summary', f.now()), reminderAt: f.now() + 1000, reminderState: 'pending' };
    const later = { ...M.newTodo('later reminder', f.now()), reminderAt: f.now() + 5000, reminderState: 'pending' };
    store.update(state => { state.todos.push(old, later); return state; });
    f.controller.pause(); f.time(f.now() + 2000); f.controller.resume();
    const win = f.ready(f.controller.getWindows().reminder);
    assert.equal(f.descriptor().summary, true); assert.deepEqual(f.descriptor().items.map(item => item.id), [old.id]);
    const result = hideBy === 'close' ? await f.call(win, 'notes:close-window') :
      await f.call(win, 'notes:reminder-action', null, null, 'list');
    assert.equal(result.ok, true); assert.equal(win.visible, false);
    if (hideBy === 'list') {
      const panel = f.ready(f.controller.getWindows().panel);
      assert.equal(panel.sent.find(([channel]) => channel === 'notes:open')[1].tab, 'todo');
    }
    assert.equal(store.getState().todos[0].reminderState, 'pending');
    f.time(f.now() + 3000);
    assert.equal(win.visible, true); assert.equal(f.descriptor().summary, false);
    assert.equal(f.descriptor().activeId, later.id);
    assert.deepEqual(f.descriptor().items.map(item => item.id), [later.id]);
    assert.equal((await f.call(win, 'notes:reminder-action', later.id, later.occurrenceId, 'complete')).ok, true);
    assert.equal(win.visible, false); assert.equal(store.getState().todos[0].reminderState, 'pending');
    f.controller.pause(); f.controller.resume();
    assert.equal(win.visible, true); assert.equal(f.descriptor().summary, true);
    assert.deepEqual(f.descriptor().items.map(item => item.id), [old.id]);
  }
});

test('reminder ticks preserve current controls, while changed tasks and next items still refresh', async t => {
  const f = fixture(t), store = f.controller.getStore();
  const a = { ...M.newTodo('first', f.now()), reminderAt: f.now() + 1000, reminderState: 'pending' };
  const b = { ...M.newTodo('next', f.now() + 1), reminderAt: f.now() + 1000, reminderState: 'pending' };
  store.update(state => { state.todos.push(a, b); return state; });
  f.time(f.now() + 1000);
  const win = f.controller.getWindows().reminder;
  const packets = () => win.sent.filter(([channel]) => channel === 'notes:reminder');
  assert.equal(packets().length, 0);
  f.ready(win);
  assert.equal(packets().length, 1); assert.equal(win.inactiveShows, 1);
  for (let i = 0; i < 5; i++) f.time(f.now() + 1000);
  assert.equal(packets().length, 1); assert.equal(win.inactiveShows, 1);
  store.update(state => { state.todos[0].title = 'changed'; return state; });
  assert.equal(packets().length, 2); assert.equal(f.descriptor().items[0].title, 'changed');
  await f.call(win, 'notes:reminder-action', a.id, a.occurrenceId, 'complete');
  assert.equal(packets().length, 3); assert.equal(f.descriptor().activeId, b.id); assert.equal(win.inactiveShows, 1);
  f.time(f.now() + 1000); assert.equal(packets().length, 3); assert.equal(win.inactiveShows, 1);
});

test('reminders appear next to the painted pet, follow native changes and avoid screen edges without polling movement', async t => {
  const f = fixture(t), store = f.controller.getStore();
  f.pet.bounds = { x: 600, y: 400, width: 80, height: 80 };
  const todo = { ...M.newTodo('follow pet', f.now()), reminderAt: f.now() + 1000, reminderState: 'pending' };
  store.update(state => { state.todos.push(todo); return state; }); f.time(f.now() + 1000);
  const win = f.ready(f.controller.getWindows().reminder);
  assert.equal(win.options.title, '待办提醒'); assert.equal(win.focused, undefined);
  assert.deepEqual(win.getBounds(), { x: 460, y: 206, width: 360, height: 190 });
  const initial = win.getBounds(), packets = win.sent.filter(([channel]) => channel === 'notes:reminder').length;
  f.pet.bounds = { x: 750, y: 550, width: 80, height: 80 };
  f.time(f.now() + 1000); assert.deepEqual(win.getBounds(), initial);
  assert.equal(f.controller.repositionReminder(), true);
  assert.deepEqual(win.getBounds(), { x: 610, y: 356, width: 360, height: 190 });
  f.pet.bounds = { x: 750, y: 550, width: 120, height: 120 }; f.controller.repositionReminder();
  assert.deepEqual(win.getBounds(), { x: 630, y: 357, width: 360, height: 190 });
  for (const [x, y] of [[0, 30], [1360, 30], [1360, 850], [0, 850]]) {
    f.pet.bounds = { x, y, width: 80, height: 80 }; f.controller.repositionReminder();
    const b = win.getBounds(), area = f.screen.area, p = petVisualBounds(f.pet.bounds, 'aurora-cloud');
    assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height);
    assert.ok(b.x + b.width <= p.x || b.x >= p.x + p.width || b.y + b.height <= p.y || b.y >= p.y + p.height);
  }
  const writes = win.boundsWrites; f.controller.repositionReminder(); assert.equal(win.boundsWrites, writes);
  assert.equal(win.sent.filter(([channel]) => channel === 'notes:reminder').length, packets);
  const setBounds = win.setBounds; win.setBounds = () => { throw Error('native placement failed'); };
  f.pet.bounds.x = 600; assert.equal(f.controller.repositionReminder(), false);
  assert.equal(f.errors.at(-1).message, 'native placement failed'); win.setBounds = setBounds;
  f.controller.pause(); f.pet.bounds = { x: 300, y: 200, width: 80, height: 80 };
  assert.equal(f.controller.repositionReminder(), false); assert.equal(win.boundsWrites, writes); assert.equal(win.visible, false);
  f.controller.resume(); assert.equal(win.visible, true); assert.notEqual(win.getBounds().x, initial.x);
  f.pet.visible = false; f.controller.repositionReminder(); assert.equal(win.visible, false);
  f.pet.visible = true; f.controller.repositionReminder(true); assert.equal(win.visible, true);
  f.pet.destroyed = true; f.controller.repositionReminder(); assert.equal(win.visible, false);
  win.destroy(); assert.equal(f.controller.repositionReminder(), false);
});

test('reminder write failure keeps current token/window and completion feedback waits for save', async t => {
  const f = fixture(t), store = f.controller.getStore();
  const todo = { ...M.newTodo('due', f.now()), reminderAt: f.now() + 1000, reminderState: 'pending' };
  store.update(state => { state.todos.push(todo); return state; });
  f.time(f.now() + 1000); const win = f.ready(f.controller.getWindows().reminder);
  assert.equal(f.descriptor().summary, false); assert.equal(f.descriptor().activeId, todo.id);
  const rename = fs.renameSync; fs.renameSync = () => { throw Error('disk failed'); };
  try {
    assert.equal((await f.call(win, 'notes:reminder-action', todo.id, todo.occurrenceId, 'complete')).ok, false);
    assert.equal(win.visible, true); assert.equal(store.getState().todos[0].completed, false); assert.equal(f.completions.length, 0);
    assert.ok(f.descriptor().error);
  } finally { fs.renameSync = rename; }
  assert.equal((await f.call(win, 'notes:reminder-action', todo.id, todo.occurrenceId, 'complete')).ok, true);
  assert.equal(win.visible, false); assert.equal(f.completions.length, 1);
});

test('every successfully saved completion feeds back once; loading, deleting and resetting do not', async t => {
  const f = fixture(t), store = f.controller.getStore(), panel = f.ready(f.controller.openPanel());
  const todo = M.newTodo('panel task', f.now());
  store.update(state => { state.todos.push(todo, { ...M.newTodo('imported complete', f.now()), completed: true, completedAt: f.now() }); return state; });
  assert.deepEqual(f.completions, []);
  const complete = M.change(store.getState(), 'todo', todo.id, 'complete', f.now());
  const rename = fs.renameSync; fs.renameSync = () => { throw Error('disk failed'); };
  try { assert.equal((await f.call(panel, 'notes:save', complete, complete.revision - 1)).ok, false); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(f.completions, []);
  assert.equal((await f.call(panel, 'notes:save', complete, complete.revision - 1)).ok, true);
  assert.deepEqual(f.completions, [todo.id]);
  store.update(state => state); assert.deepEqual(f.completions, [todo.id]);
  store.update(state => M.change(state, 'todo', todo.id, 'trash', f.now()));
  store.update(state => M.change(state, 'todo', todo.id, 'restore', f.now()));
  assert.deepEqual(f.completions, [todo.id]);
  store.update(state => M.change(state, 'todo', todo.id, 'uncomplete', f.now()));
  store.update(state => M.change(state, 'todo', todo.id, 'complete', f.now()));
  assert.deepEqual(f.completions, [todo.id, todo.id]);
  store.reset(); assert.deepEqual(f.completions, [todo.id, todo.id]);
});

test('display removal constrains title controls and dimensions without pet-size fallback', async t => {
  const f = fixture(t), store = f.controller.getStore();
  store.update(state => { state.notes.push({ ...M.newNote('restore', '', f.now()), desktopOpen: true,
    windowBounds: { x: -1900, y: -200, width: 600, height: 700 } }); return state; });
  const win = f.controller.getWindows().notes[0];
  assert.deepEqual(win.getBounds(), { x: 0, y: 30, width: 600, height: 700 });
  f.screen.area = { x: 0, y: 0, width: 400, height: 300 }; f.screen.emit('display-removed');
  assert.deepEqual(win.getBounds(), { x: 0, y: 0, width: 400, height: 300 });
  assert.deepEqual(visibleBounds({ x: 999, y: 999, width: 200, height: 100 }, f.screen),
    { x: 160, y: 140, width: 240, height: 160 });
  await flush();
});


test('organize IPC accepts only an existing unchanged note and never writes generated content',async t=>{
  const note=M.newNote('合成测试','星期五开会'),initial={schema:1,revision:0,notes:[note],todos:[]};let requests=0;
  const organizer={organize:async value=>{requests++;assert.deepEqual(value,{title:note.title,body:note.body});return{title:'会议安排',body:'星期五：开会'}},cancel:async()=>{},close:async()=>{}};
  const f=fixture(t,initial,undefined,organizer),panel=f.ready(f.controller.openPanel());
  const snapshot={id:note.id,title:note.title,body:note.body};
  assert.equal((await f.call(panel,'notes:organize',{...snapshot,body:'未保存的其他内容'})).ok,false);
  assert.equal((await f.call(panel,'notes:organize',{...snapshot,id:'missing'})).ok,false);
  assert.equal((await f.call(panel,'notes:organize',{...snapshot,body:'x'.repeat(20001)})).ok,false);assert.equal(requests,0);
  const result=await f.call(panel,'notes:organize',snapshot);assert.deepEqual(result,{ok:true,result:{title:'会议安排',body:'星期五：开会'}});assert.equal(requests,1);
  assert.equal(f.controller.getStore().getState().notes[0].body,note.body);
});

test('organize cancellation belongs to its requesting window and discards late results',async t=>{
  const note=M.newNote('本窗','合成测试'),other=M.newNote('别窗','合成测试');let resolve,cancelled=0;
  const organizer={organize:()=>new Promise(r=>resolve=r),cancel:async()=>{cancelled++},close:async()=>{}};
  const f=fixture(t,{schema:1,revision:0,notes:[note,other],todos:[]},undefined,organizer),panel=f.ready(f.controller.openPanel());
  f.controller.openNote(other.id);const otherWindow=f.ready(f.controller.getWindows().notes[0]);
  const pending=f.call(panel,'notes:organize',{id:note.id,title:note.title,body:note.body});await flush();
  assert.equal((await f.call(otherWindow,'notes:organize',{id:note.id,title:note.title,body:note.body})).ok,false);
  await f.call(otherWindow,'notes:organize-cancel');assert.equal(cancelled,0);
  await f.call(panel,'notes:organize-cancel');assert.equal(cancelled,1);resolve({title:'迟到',body:'应被丢弃'});assert.equal((await pending).ok,false);
});

test('notes appearance updates live panel/note/reminder windows and newly opened windows',async t=>{
  let appearance='light';const f=fixture(t,undefined,undefined,undefined,()=>appearance),panel=f.ready(f.controller.openPanel());const store=f.controller.getStore();
  assert.equal((await f.call(panel,'notes:load')).notesAppearance,'light');const note=M.newNote('theme','saved',f.now()),todo=M.newTodo('due',f.now());Object.assign(todo,{reminderAt:f.now()-1,reminderState:'pending'});
  store.update(s=>{s.notes.push({...note,desktopOpen:true});s.todos.push(todo);return s});const noteWindow=f.ready(f.controller.getWindows().notes[0]),reminder=f.ready(f.controller.getWindows().reminder);
  appearance='dark';f.controller.syncAppearance();for(const win of [panel,noteWindow,reminder]){assert.equal(win.backgroundColor,'#182125');assert.deepEqual(win.sent.filter(([c])=>c==='notes:appearance').at(-1),['notes:appearance','dark']);assert.equal((await f.call(win,'notes:load')).notesAppearance,'dark')}
  const extra=M.newNote('new','',f.now());store.update(s=>{s.notes.push(extra);return s});f.controller.openNote(extra.id);assert.equal(f.controller.getWindows().notes.at(-1).options.backgroundColor,'#182125');
  appearance='light';f.controller.syncAppearance();assert.equal(noteWindow.backgroundColor,'#F7FAF9');
});
