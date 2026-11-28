'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createCalendarWindow, createCalendarTrayImages } = require('../lib/calendar-window');
const { createNotesStore } = require('../lib/notes-store');
const Notes = require('../lib/notes-model');
const Model = require('../lib/calendar-model');

const calendarURL = pathToFileURL(path.join(__dirname, '../calendar.html')).href;
const today = new Date(2026, 10, 22, 12).getTime();
const local = (date, hour = 12) => new Date(date + 'T' + String(hour).padStart(2, '0') + ':00:00').getTime();
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const calendars = [{ id: 'work', title: '工作', color: '#007aff' }, { id: 'personal', title: '个人' }];
const appointment = (id, date = '2026-11-22', calendarId = 'work') => ({
  id, calendarId, title: id, start: local(date, 14), end: local(date, 15), allDay: false
});
const granted = (events = [], extra = {}) => ({ status: 'granted', calendars, events, truncated: false, ...extra });
const configuredWeather = () => ({ enabled: true, status: 'ready', city: { name: '北京', latitude: 39.9, longitude: 116.4 },
  current: { temperature: 8, apparentTemperature: 6, weatherCode: 0 }, updatedAt: today });

function fixture(t, { status = 'not-determined', saved, raw, rawNotes, manualReads = false, manualConnect = false,
  response = granted(), area = { x: 0, y: 0, width: 1440, height: 900 }, anchor = { x: 900, y: 0, width: 24, height: 24 },
  weather = configuredWeather() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-calendar-window-'));
  const filePath = path.join(dir, 'calendar.json'), notesPath = path.join(dir, 'notes.json');
  if (raw !== undefined) fs.writeFileSync(filePath, raw);
  else if (saved !== undefined) fs.writeFileSync(filePath, JSON.stringify({ schema: 1, preferences: saved }));
  if (rawNotes !== undefined) fs.writeFileSync(notesPath, rawNotes);
  const handlers = new Map(), windows = [], trays = [], reads = [], connects = [], errors = [], changes = [], links = [], tracked = [], weatherCalls = [];
  const store = createNotesStore(notesPath);
  let currentStatus = status, currentTime = today, currentResponse = response, currentWeather = weather, suppressed = false, tick, timerCleared = false;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.dead = false; this.visible = false; this.sent = []; this.showCount = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: calendarURL }, getURL: () => this.documentURL,
        send: (channel, state) => { assert.equal(this.dead, false, 'must not send to a destroyed window'); this.sent.push({ channel, state }); },
        setWindowOpenHandler: handler => { this.openHandler = handler; }
      });
      windows.push(this);
    }
    loadFile(file) { this.loadedFile = file; this.documentURL = pathToFileURL(file).href; return Promise.resolve(); }
    isDestroyed() { return this.dead; }
    isVisible() { return this.visible; }
    show() { this.visible = true; this.showCount++; }
    showInactive() { this.show(); }
    focus() { this.emit('focus'); }
    hide() { this.visible = false; }
    setAlwaysOnTop(value) { this.topmost = value; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    getBounds() { return { ...this.bounds }; }
    close() { this.destroy(); }
    destroy() { if (this.dead) return; this.dead = true; this.visible = false; this.emit('closed'); }
  }
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); this.icon = icon; trays.push(this); }
    getBounds() { return { ...anchor }; }
    setToolTip(value) { this.tooltip = value; }
    setTitle(value) { this.title = value; }
    setImage(value) { this.icon = value; (this.imageChanges ||= []).push(value); }
    destroy() { this.dead = true; }
  }
  const systemCalendar = {
    status: () => ({ status: currentStatus }),
    connect() {
      const request = deferred(); connects.push(request);
      return manualConnect ? request.promise : Promise.resolve({ status: currentStatus });
    },
    read(range) {
      const request = { range: { ...range }, ...deferred() }; reads.push(request);
      return manualReads ? request.promise : Promise.resolve(currentResponse);
    }
  };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area })
  });
  const controller = createCalendarWindow({
    BrowserWindow: Window, Tray: FakeTray, nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
    screen, shell: { openExternal: async link => { links.push(link); } }, filePath, store, systemCalendar,
    trackWindow: win => tracked.push(win), getWeather: () => currentWeather,
    openWeatherDetail: win => weatherCalls.push({ kind: 'detail', parent: win }),
    openWeatherCity: win => weatherCalls.push({ kind: 'city', parent: win }),
    isSuppressed: () => suppressed, onChange: () => changes.push(true), onError: error => errors.push(error), now: () => currentTime,
    setTimer: callback => { tick = callback; return { unref() {} }; }, clearTimer: () => { timerCleared = true; }
  });
  t.after(() => { controller.destroy(); fs.rmSync(dir, { recursive: true, force: true }); });
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const get = (win, ipcEvent = event(win)) => handlers.get('calendar:get')(ipcEvent);
  const action = (win, name, value, ipcEvent = event(win)) => handlers.get('calendar:action')(ipcEvent, { action: name, value });
  function open(options) { controller.open(options); return controller.getWindows().find(win => win.options.title === '球球日历' && win.options.resizable); }
  return { controller, windows, trays, reads, connects, errors, changes, tracked, handlers, links, store, filePath, notesPath, screen, weatherCalls,
    get, action, event, open, finish: win => win.webContents.emit('did-finish-load'), tick: () => tick(),
    persisted: () => JSON.parse(fs.readFileSync(filePath, 'utf8')).preferences,
    setStatus: value => { currentStatus = value; }, setResponse: value => { currentResponse = value; },
    setWeather: value => { currentWeather = value; },
    suppress: value => { suppressed = value; }, setTime: value => { currentTime = value; }, timerCleared: () => timerCleared };
}

test('fresh startup creates the calendar menu entry without opening windows or requesting permission', t => {
  const f = fixture(t);
  assert.equal(f.controller.getPreferences().monthRounded, false);
  assert.equal(f.controller.getPreferences().menuEnabled, true);
  assert.equal(f.controller.getPreferences().menuDate, false);
  assert.equal(f.trays.length, 1); assert.equal(f.trays[0].tooltip, '球球日历'); assert.equal(f.trays[0].title, '');
  assert.equal(f.controller.menu().submenu.find(item => item.id === 'calendar-menu-enabled').checked, true);
  assert.deepEqual(f.windows, []); assert.deepEqual(f.connects, []); assert.deepEqual(f.reads, []);
  assert.equal(fs.existsSync(f.filePath), false, 'default startup must not create or migrate preference storage');
  f.trays[0].emit('click');
  assert.equal(f.windows.length, 1, 'the enabled entry opens the calendar on demand');
});

test('month corners default to square, persist each choice and retain it after restart', async t => {
  const f = fixture(t, { saved: { menuDate: true, lunar: false } }), win = f.open(); f.finish(win);
  assert.equal(f.get(win).preferences.monthRounded, false);
  assert.equal(Object.hasOwn(f.persisted(), 'monthRounded'), false, 'reading an older profile does not migrate it');
  await f.action(win, 'preferences', { monthRounded: true });
  assert.equal(f.persisted().monthRounded, true); assert.equal(f.persisted().menuDate, true); assert.equal(f.persisted().lunar, false);
  const restarted = fixture(t, { saved: f.persisted() });
  assert.equal(restarted.controller.getPreferences().monthRounded, true);
  const invalid = await f.action(win, 'preferences', { monthRounded: 'rounded' });
  assert.match(invalid.error, /无法保存/); assert.equal(f.persisted().monthRounded, true);
  await f.action(win, 'preferences', { monthRounded: false });
  assert.equal(f.persisted().monthRounded, false);
  assert.equal(fixture(t, { saved: f.persisted() }).controller.getPreferences().monthRounded, false);
});

test('an explicit disabled calendar menu remains disabled after startup and a later restart', t => {
  const saved = { menuEnabled: false, menuDate: true, lunar: false }, f = fixture(t, { saved });
  assert.equal(f.controller.getPreferences().menuEnabled, false);
  assert.equal(f.controller.menu().submenu.find(item => item.id === 'calendar-menu-enabled').checked, false);
  assert.deepEqual(f.trays, []); assert.deepEqual(f.persisted(), saved);
  f.tick(); f.controller.pause(); f.controller.resume();
  assert.deepEqual(f.trays, []); assert.deepEqual(f.persisted(), saved);
  const restarted = fixture(t, { saved: f.persisted() });
  assert.equal(restarted.controller.getPreferences().menuEnabled, false); assert.deepEqual(restarted.trays, []);
  assert.deepEqual(restarted.persisted(), saved);
});

test('only an owned main frame at the exact local document URL may use calendar IPC', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  const trusted = f.event(win), channel = f.handlers.get('calendar:action');
  const denied = [
    { ...trusted, sender: { mainFrame: trusted.senderFrame, getURL: () => calendarURL } },
    { ...trusted, senderFrame: { url: calendarURL } },
    { ...trusted, senderFrame: undefined }
  ];
  for (const event of denied) {
    assert.equal(f.get(win, event), null);
    assert.equal(await channel(event, { action: 'connect' }), null);
    assert.equal(await channel(event, { action: 'new-todo', value: { title: '不应保存', dueDate: '2026-11-22' } }), null);
  }
  for (const url of ['https://example.invalid/', calendarURL + '?other', calendarURL + '#other', pathToFileURL(path.join(__dirname, '../notes.html')).href]) {
    win.webContents.mainFrame.url = url;
    assert.equal(f.get(win), null);
    assert.equal(await f.action(win, 'connect'), null);
  }
  win.webContents.mainFrame.url = calendarURL; win.documentURL = 'https://example.invalid/';
  assert.equal(f.get(win), null);
  assert.equal(await f.action(win, 'system-settings'), null);
  assert.equal(f.connects.length, 0); assert.equal(f.reads.length, 0);
  assert.equal(f.store.getState().todos.length, 0); assert.deepEqual(f.links, []);
});

test('opening windows, restoration, navigation and refresh never request calendar permission', async t => {
  const f = fixture(t, { saved: { menuEnabled: true, widgets: { date: { enabled: true } } } });
  const win = f.open();
  for (const item of f.controller.getWindows()) f.finish(item);
  f.trays[0].emit('click'); f.finish(f.controller.getWindows().at(-1));
  await f.action(win, 'month', '2026-12'); await f.action(win, 'refresh');
  await f.action(win, 'page', 'settings'); f.tick();
  assert.equal(f.connects.length, 0); assert.equal(f.reads.length, 0);
  assert.equal(f.get(win).system.status, 'not-determined');
});

test('explicit connect is shared across windows and reads only after permission is granted', async t => {
  const f = fixture(t, { manualConnect: true, saved: { menuEnabled: true } }), desktop = f.open(); f.finish(desktop);
  f.trays[0].emit('click'); const menu = f.controller.getWindows().at(-1); f.finish(menu);
  const first = f.action(desktop, 'connect'), second = f.action(menu, 'connect');
  await flush();
  assert.equal(f.connects.length, 1); assert.equal(f.reads.length, 0);
  assert.equal(f.get(desktop).system.connecting, true);
  f.setStatus('granted'); f.connects[0].resolve({ status: 'granted' }); await Promise.all([first, second]);
  assert.equal(f.reads.length, 2);
  for (const win of [desktop, menu]) { assert.equal(f.get(win).system.status, 'granted'); assert.equal(f.get(win).system.connecting, false); }
});

test('empty source selection survives persistence and means no calendars, not all calendars', async t => {
  const f = fixture(t, { status: 'granted', response: granted([appointment('meeting')]) }), win = f.open(); f.finish(win); await flush();
  assert.equal(f.get(win).preferences.selectedCalendarIds, null);
  await f.action(win, 'sources', []);
  const state = f.get(win);
  assert.deepEqual(state.preferences.selectedCalendarIds, []);
  assert.deepEqual(f.persisted().selectedCalendarIds, []);
  assert.equal(Model.dayItems('2026-11-22', state.system.events, state.todos, state.preferences).events.length, 0);
  await f.action(win, 'sources', ['missing-source']);
  assert.deepEqual(f.persisted().selectedCalendarIds, []);
  assert.match(f.get(win).error, /现有日历来源/);
  const reopened = fixture(t, { saved: f.persisted() });
  assert.deepEqual(reopened.controller.getPreferences().selectedCalendarIds, []);
});

test('desktop, menu and widget keep independent months; late reads cannot replace a newer month', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true, saved: { menuEnabled: true, weekStart: 'sunday', widgets: { month: { enabled: true } } } });
  const widget = f.controller.getWindows()[0], desktop = f.open(); f.finish(widget); f.finish(desktop);
  f.trays[0].emit('click'); const menu = f.controller.getWindows().at(-1); f.finish(menu);
  assert.equal(f.reads.length, 3);
  const december = f.action(desktop, 'month', '2026-12'), january = f.action(desktop, 'month', '2027-01');
  const menuFebruary = f.action(menu, 'month', '2027-02');
  assert.deepEqual(f.reads[3].range, Model.monthRange('2026-12', 0));
  assert.deepEqual(f.reads[4].range, Model.monthRange('2027-01', 0));
  f.reads[4].resolve(granted([appointment('january', '2027-01-06')])); await january;
  f.reads[5].resolve(granted([appointment('february', '2027-02-07')])); await menuFebruary;
  f.reads[0].resolve(granted([appointment('widget-today')]));
  f.reads[1].resolve(granted([appointment('old-november')]));
  f.reads[2].resolve(granted([appointment('old-menu')]));
  f.reads[3].resolve(granted([appointment('old-december', '2026-12-03')])); await december; await flush();
  assert.equal(f.get(desktop).month, '2027-01'); assert.deepEqual(f.get(desktop).system.events.map(item => item.id), ['january']);
  assert.equal(f.get(menu).month, '2027-02'); assert.deepEqual(f.get(menu).system.events.map(item => item.id), ['february']);
  assert.equal(f.get(widget).month, '2026-11'); assert.deepEqual(f.get(widget).system.events.map(item => item.id), ['widget-today']);
  assert.deepEqual(f.get(desktop).weather, f.get(widget).weather);
});

test('a revoked status clears every window and invalidates reads already in flight', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true, saved: { widgets: { agenda: { enabled: true } } } });
  const widget = f.controller.getWindows()[0], desktop = f.open(); f.finish(widget); f.finish(desktop);
  f.reads[0].resolve(granted([appointment('widget-secret')])); f.reads[1].resolve(granted([appointment('desktop-secret')])); await flush();
  const refreshing = f.action(desktop, 'refresh');
  assert.equal(f.reads.length, 4);
  f.setStatus('denied');
  assert.equal(f.get(desktop).system.status, 'denied');
  for (const win of [desktop, widget]) assert.deepEqual(f.get(win).system.events, []);
  f.reads[2].resolve(granted([appointment('late-widget-secret')])); f.reads[3].resolve(granted([appointment('late-desktop-secret')])); await refreshing;
  for (const win of [desktop, widget]) {
    assert.equal(f.get(win).system.status, 'denied'); assert.deepEqual(f.get(win).system.events, []);
    assert.deepEqual(win.sent.at(-1).state.system.events, []);
  }
});

test('read denial clears other windows immediately instead of leaving stale events', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true, saved: { widgets: { date: { enabled: true } } } });
  const widget = f.controller.getWindows()[0], desktop = f.open(); f.finish(widget); f.finish(desktop);
  f.reads[0].resolve(granted([appointment('private')])); f.reads[1].resolve(granted()); await flush();
  const pending = f.action(desktop, 'month', '2026-12');
  f.setStatus('denied'); f.reads[2].resolve({ status: 'denied', calendars: [], events: [] }); await pending;
  for (const win of [desktop, widget]) { assert.equal(f.get(win).system.status, 'denied'); assert.deepEqual(f.get(win).system.events, []); }
});

test('read errors discard stale events and do not masquerade as a successful empty calendar', async t => {
  const f = fixture(t, { status: 'granted', response: granted([appointment('previous')]) }), win = f.open(); f.finish(win); await flush();
  f.setResponse(granted([appointment('invalid-error-data')], { error: 'native-error' }));
  await f.action(win, 'refresh');
  assert.deepEqual(f.get(win).system.events, []);
  assert.match(f.get(win).system.error, /暂时无法读取/);
});

test('pause prevents a late connect from fetching or showing calendars', async t => {
  const f = fixture(t, { manualConnect: true }), win = f.open(); f.finish(win);
  const connecting = f.action(win, 'connect'); await flush(); f.controller.pause();
  const shows = win.showCount; f.setStatus('granted'); f.connects[0].resolve({ status: 'granted' }); await connecting;
  assert.equal(f.reads.length, 0); assert.equal(win.visible, false); assert.equal(win.showCount, shows);
  assert.equal(f.get(win), null);
  assert.ok(win.sent.every(item => item.state.system.events.length === 0));
});

test('pause invalidates a pending read and does not restore its events on resume', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true }), win = f.open(); f.finish(win);
  f.controller.pause(); const shows = win.showCount;
  f.reads[0].resolve(granted([appointment('late-private')])); await flush();
  assert.equal(win.visible, false); assert.equal(win.showCount, shows);
  assert.ok(win.sent.every(item => item.state.system.events.length === 0));
  f.controller.resume();
  assert.deepEqual(f.get(win).system.events, []);
  assert.equal(f.reads.length, 2); f.reads[1].resolve(granted([appointment('fresh')])); await flush();
  assert.deepEqual(f.get(win).system.events.map(item => item.id), ['fresh']);
});

test('destroying during connect prevents late access, window creation and publication', async t => {
  const f = fixture(t, { manualConnect: true }), win = f.open(); f.finish(win);
  const connecting = f.action(win, 'connect'); await flush(); f.controller.destroy();
  const sent = win.sent.length; f.setStatus('granted'); f.connects[0].resolve({ status: 'granted' }); await connecting;
  assert.equal(f.reads.length, 0); assert.equal(win.sent.length, sent); assert.equal(win.dead, true);
  assert.deepEqual(f.controller.getWindows(), []);
});

test('destroying with a read in flight cannot publish private events to a closed window', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true }), win = f.open(); f.finish(win);
  f.controller.destroy(); const sent = win.sent.length;
  f.reads[0].resolve(granted([appointment('late-private')])); await flush();
  assert.equal(win.sent.length, sent); assert.equal(win.dead, true); assert.equal(f.errors.length, 0);
});

test('resume respects a continuing suppression condition', t => {
  const f = fixture(t, { saved: { widgets: { date: { enabled: true } } } }), win = f.open();
  for (const item of f.controller.getWindows()) f.finish(item);
  f.controller.pause(); f.suppress(true); f.controller.resume();
  for (const item of f.controller.getWindows()) assert.equal(item.visible, false);
  assert.equal(f.controller.open(), false); assert.equal(f.get(win), null);
});

test('a closed widget stays disabled across refresh, resume and restart', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true, saved: { widgets: { agenda: { enabled: true } } } });
  const widget = f.controller.getWindows()[0]; f.finish(widget); widget.close();
  assert.equal(f.persisted().widgets.agenda.enabled, false);
  f.reads[0].resolve(granted([appointment('late')])); await flush();
  f.tick(); f.controller.pause(); f.controller.resume();
  assert.deepEqual(f.controller.getWindows(), []); assert.equal(f.windows.length, 1); assert.equal(widget.visible, false);
  const restarted = fixture(t, { saved: f.persisted() });
  assert.deepEqual(restarted.controller.getWindows(), []);
});

test('quitting destroys windows without clearing enabled widgets and removes IPC/timers/listeners', t => {
  const f = fixture(t, { saved: { menuEnabled: true, widgets: { month: { enabled: true }, 'agenda-wide': { enabled: true, pinned: true } } } });
  for (const item of f.controller.getWindows()) f.finish(item);
  f.controller.destroy();
  assert.equal(f.controller.getPreferences().widgets.month.enabled, true);
  assert.equal(f.controller.getPreferences().widgets['agenda-wide'].enabled, true);
  assert.equal(f.handlers.size, 0); assert.equal(f.timerCleared(), true); assert.equal(f.trays[0].dead, true);
  assert.equal(f.screen.listenerCount('display-removed'), 0); assert.equal(f.screen.listenerCount('display-metrics-changed'), 0);
  assert.ok(f.windows.every(win => win.dead)); assert.equal(f.controller.open(), false);
  const restored = fixture(t, { saved: f.controller.getPreferences() });
  assert.equal(restored.controller.getWindows().length, 2);
  assert.equal(restored.controller.getWindows().find(win => win.options.width === 344).topmost, true);
});

test('calendar writes to the existing notes store and preserves existing notes and reminders', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  const note = Notes.newNote('原有便签', '不能丢失', today);
  const reminder = { ...Notes.newTodo('原有提醒', today), reminderAt: today + 3600000, reminderState: 'pending' };
  f.store.update(state => ({ ...state, notes: [note], todos: [reminder] }));
  await f.action(win, 'select-date', '2026-12-09');
  await f.action(win, 'new-todo', { title: '  整理计划  ', dueDate: '2026-12-10', reminderAt: today + 60000, reminderState: 'pending' });
  const state = f.store.getState(), added = state.todos.find(item => item.id !== reminder.id);
  assert.equal(added.title, '整理计划'); assert.equal(added.dueDate, '2026-12-10');
  assert.equal(added.reminderAt, null); assert.equal(added.reminderState, 'none');
  assert.deepEqual(state.notes, [note]); assert.deepEqual(state.todos.find(item => item.id === reminder.id), reminder);
  assert.deepEqual(new Set(Notes.dueReminders(state, today + 7200000).map(item => item.id)), new Set([reminder.id]));
  assert.deepEqual(createNotesStore(f.notesPath).getState(), state);
  assert.deepEqual(f.get(win).todos, state.todos);
  const second = f.open(); assert.equal(second, win, 'opening the calendar reuses its desktop window');
});

test('opening and cancelling a todo modal does not change the store or create reminders', async t => {
  const f = fixture(t, { saved: { menuEnabled: true } }); f.trays[0].emit('click');
  const menu = f.controller.getWindows()[0]; f.finish(menu);
  const before = f.store.getState();
  await f.action(menu, 'modal-open', true); menu.emit('blur'); assert.equal(menu.dead, false);
  await f.action(menu, 'modal-open', false); menu.emit('blur');
  assert.equal(menu.dead, true); assert.deepEqual(f.store.getState(), before);
  assert.equal(fs.existsSync(f.notesPath), false); assert.deepEqual(Notes.dueReminders(f.store.getState(), today), []);
});

test('invalid todo input never mutates the shared store and completion is visible to all windows', async t => {
  const f = fixture(t, { saved: { widgets: { agenda: { enabled: true } } } }), desktop = f.open();
  const widget = f.controller.getWindows()[0]; f.finish(desktop); f.finish(widget);
  for (const value of [null, { title: '', dueDate: '2026-11-22' }, { title: 'x'.repeat(201), dueDate: '2026-11-22' },
    { title: '无效日期', dueDate: '2026-02-30' }, { title: '越界日期', dueDate: '2101-01-01' }]) await f.action(desktop, 'new-todo', value);
  assert.equal(f.store.getState().todos.length, 0); assert.equal(fs.existsSync(f.notesPath), false);
  await f.action(desktop, 'new-todo', { title: '可完成', dueDate: '2026-11-22' });
  const id = f.store.getState().todos[0].id;
  await f.action(widget, 'toggle-todo', id);
  assert.equal(f.store.getState().todos[0].completed, true);
  for (const win of [desktop, widget]) { assert.equal(f.get(win).todos[0].completed, true); assert.equal(win.sent.at(-1).state.todos[0].completed, true); }
});

test('a corrupt notes store blocks todo writes while retaining its original bytes', async t => {
  const original = '{damaged notes store', f = fixture(t, { rawNotes: original }), win = f.open(); f.finish(win);
  const before = f.store.getState(); await f.action(win, 'new-todo', { title: '不能覆盖', dueDate: '2026-11-22' });
  assert.deepEqual(f.store.getState(), before); assert.equal(fs.readFileSync(f.notesPath, 'utf8'), original);
  assert.match(f.get(win).notesError, /无法读取/); assert.match(f.get(win).error, /已保留原记录/);
});

for (const [name, original] of [
  ['invalid JSON', '{broken'], ['unsupported schema', JSON.stringify({ schema: 2, preferences: {} })],
  ['array preferences', JSON.stringify({ schema: 1, preferences: [] })], ['null preferences', JSON.stringify({ schema: 1, preferences: null })]
]) test('damaged calendar preferences are never overwritten: ' + name, async t => {
  const f = fixture(t, { raw: original }), win = f.open(); f.finish(win);
  await f.action(win, 'preferences', { menuEnabled: false });
  await f.action(win, 'widget', { type: 'date', enabled: true });
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), original);
  assert.equal(f.controller.getPreferences().menuEnabled, true);
  assert.equal(f.controller.getPreferences().widgets.date.enabled, false);
  assert.match(f.get(win).error, /无法读取/);
});

test('all three calendar forms stay within a small negative-origin display', async t => {
  const area = { x: -780, y: -120, width: 560, height: 450 };
  const f = fixture(t, { area, saved: { menuEnabled: true, widgets: { 'agenda-wide': { enabled: true, bounds: { x: 8000, y: 8000, width: 386, height: 184 } } } } });
  f.open(); f.trays[0].emit('click');
  for (const win of f.controller.getWindows()) {
    const bounds = win.getBounds();
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    assert.equal(win.options.webPreferences.contextIsolation, true); assert.equal(win.options.webPreferences.sandbox, true);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    assert.ok(f.tracked.includes(win)); assert.deepEqual(win.openHandler(), { action: 'deny' });
    let blocked = false; win.webContents.emit('will-navigate', { preventDefault: () => { blocked = true; } }); assert.equal(blocked, true);
  }
});

test('menu date label is optional without removing the calendar entry', async t => {
  const f = fixture(t, { saved: { menuEnabled: true, menuDate: true } }), win = f.open(); f.finish(win);
  assert.match(f.trays[0].title, /11月22日/);
  await f.action(win, 'preferences', { menuDate: false });
  assert.equal(f.trays[0].title, ''); assert.equal(f.trays[0].dead, undefined); assert.equal(f.persisted().menuDate, false);
  await f.action(win, 'preferences', { menuEnabled: false }); assert.equal(f.trays[0].dead, true);
});

test('menu date defaults off without migrating saved preferences, while explicit true and false remain intact', async t => {
  const missing = fixture(t, { saved: { menuEnabled: true } }), win = missing.open(); missing.finish(win);
  assert.equal(missing.get(win).preferences.menuDate, false); assert.equal(missing.trays[0].title, '');
  assert.equal(Object.hasOwn(missing.persisted(), 'menuDate'), false, 'reading old preferences must not rewrite them');
  await missing.action(win, 'preferences', { menuDate: true });
  assert.match(missing.trays[0].title, /11月22日/); assert.equal(missing.persisted().menuDate, true);
  const restored = fixture(t, { saved: missing.persisted() });
  assert.equal(restored.controller.getPreferences().menuDate, true); assert.match(restored.trays[0].title, /11月22日/);
  const disabled = fixture(t, { saved: { menuEnabled: true, menuDate: false } });
  assert.equal(disabled.controller.getPreferences().menuDate, false); assert.equal(disabled.trays[0].title, '');
});

test('old enabled menu-date settings default to solar only without rewriting explicit on/off preferences', async t => {
  for (const menuDate of [true, false]) {
    const saved = { menuEnabled: true, menuDate }, f = fixture(t, { saved }), prefs = f.controller.getPreferences();
    assert.equal(prefs.menuDate, menuDate); assert.equal(prefs.menuDateSolar, true);
    assert.equal(prefs.menuDateLunar, false); assert.equal(prefs.menuDateWeekday, false);
    assert.equal(f.trays[0].title, menuDate ? '11月22日' : '');
    assert.deepEqual(f.persisted(), saved, 'normalization does not migrate a personal preferences file');
  }
});

test('menu date supports all seven solar/lunar/weekday combinations once each and keeps the master switch independent', async t => {
  const f = fixture(t, { saved: { menuEnabled: true, menuDate: true } }), win = f.open(); f.finish(win);
  const combinations = [
    [true, false, false, '11月22日'], [false, true, false, '十月十四'], [false, false, true, '周日'],
    [true, true, false, '11月22日 十月十四'], [true, false, true, '11月22日 周日'],
    [false, true, true, '十月十四 周日'], [true, true, true, '11月22日 十月十四 周日']
  ];
  for (const [menuDateSolar, menuDateLunar, menuDateWeekday, expected] of combinations) {
    await f.action(win, 'preferences', { menuDateSolar, menuDateLunar, menuDateWeekday });
    assert.equal(f.trays[0].title, expected); assert.equal(f.persisted().menuDate, true);
  }
  await f.action(win, 'preferences', { menuDate: false });
  await f.action(win, 'preferences', { menuDateSolar: false, menuDateLunar: true, menuDateWeekday: false });
  assert.equal(f.trays[0].title, ''); assert.equal(f.persisted().menuDate, false);
  const restarted = fixture(t, { saved: f.persisted() });
  assert.equal(restarted.trays[0].title, ''); assert.equal(restarted.controller.getPreferences().menuDateLunar, true);
  const restoredWindow = restarted.open(); restarted.finish(restoredWindow);
  await restarted.action(restoredWindow, 'preferences', { menuDate: true });
  assert.equal(restarted.trays[0].title, '十月十四', 'saved format is restored after the master date switch is enabled');
});

test('menu date refreshes each format across local midnight and preserves the actual lunar leap-month label', t => {
  const f = fixture(t, { saved: { menuEnabled: true, menuDate: true, menuDateSolar: true, menuDateLunar: true, menuDateWeekday: true } });
  f.setTime(new Date(2026, 10, 22, 23, 59).getTime()); f.tick();
  assert.equal(f.trays[0].title, '11月22日 十月十四 周日');
  f.setTime(new Date(2026, 10, 23, 0, 1).getTime()); f.tick();
  assert.equal(f.trays[0].title, '11月23日 十月十五 周一');
  f.setTime(new Date(2025, 6, 25, 12).getTime()); f.tick();
  assert.equal(f.trays[0].title, '7月25日 闰六月初一 周五');
});

test('invalid date-format settings keep legal selections and all-false data falls back to solar without enabling dates', async t => {
  const empty = fixture(t, { saved: { menuEnabled: true, menuDate: false, menuDateSolar: false, menuDateLunar: false, menuDateWeekday: false } });
  assert.equal(empty.controller.getPreferences().menuDateSolar, true); assert.equal(empty.controller.getPreferences().menuDate, false);
  assert.equal(empty.trays[0].title, ''); assert.equal(empty.persisted().menuDateSolar, false, 'invalid saved data is not silently rewritten');
  const retained = fixture(t, { saved: { menuEnabled: true, menuDate: true, menuDateSolar: false, menuDateLunar: true, menuDateWeekday: 'false' } });
  assert.equal(retained.controller.getPreferences().menuDateSolar, false); assert.equal(retained.controller.getPreferences().menuDateLunar, true);
  assert.equal(retained.controller.getPreferences().menuDateWeekday, false); assert.equal(retained.trays[0].title, '十月十四');
  const win = retained.open(); retained.finish(win);
  const original = fs.readFileSync(retained.filePath, 'utf8');
  for (const value of ['false', 0, null, {}]) await retained.action(win, 'preferences', { menuDateLunar: value });
  assert.equal(fs.readFileSync(retained.filePath, 'utf8'), original); assert.equal(retained.trays[0].title, '十月十四');
  await retained.action(win, 'preferences', { menuDateSolar: false, menuDateLunar: false, menuDateWeekday: false });
  assert.equal(retained.persisted().menuDateSolar, true); assert.equal(retained.persisted().menuDateLunar, false);
  assert.equal(retained.persisted().menuDateWeekday, false); assert.equal(retained.persisted().menuDate, true);
  assert.equal(retained.trays[0].title, '11月22日');
});

test('date icon keeps the original 2x bitmap, pads only below, and caches both black-and-white template variants', () => {
  const bitmap = Buffer.alloc(36 * 36 * 4, 127), calls = [];
  const original = { setTemplateImage(value) { this.template = value; }, getSize: () => ({ width: 18, height: 18 }),
    toBitmap(options) { assert.equal(options.scaleFactor, 2); return bitmap; } };
  const aligned = { setTemplateImage(value) { this.template = value; }, isEmpty: () => false };
  const images = createCalendarTrayImages({ createFromPath: file => { calls.push(file); return original; },
    createFromBitmap: (data, options) => { calls.push({ data, options }); return aligned; } }, '/fixture/calendar-iconTemplate.png');
  assert.equal(images(false), original); assert.equal(images(true), aligned);
  assert.equal(images(true), aligned); assert.equal(images(false), original);
  assert.equal(calls.length, 2, 'one source load and one padded bitmap for repeated toggles');
  assert.deepEqual(calls[1].options, { width: 36, height: 40, scaleFactor: 2 });
  assert.deepEqual(calls[1].data.subarray(0, bitmap.length), bitmap);
  assert.equal(calls[1].data.subarray(bitmap.length).every(value => value === 0), true);
  assert.equal(original.template, true); assert.equal(aligned.template, true);
});

test('icon alignment safely falls back when bitmap capabilities or valid 2x pixels are unavailable', () => {
  for (const failure of ['missing', 'throws', 'short', 'empty']) {
    let draws = 0;
    const original = { setTemplateImage() {}, getSize: () => ({ width: 18, height: 18 }),
      toBitmap: () => failure === 'short' ? Buffer.alloc(4) : Buffer.alloc(36 * 36 * 4) };
    const nativeImage = { createFromPath: () => original, createFromBitmap: () => { draws++; if (failure === 'throws') throw Error('unsupported'); return { isEmpty: () => true }; } };
    if (failure === 'missing') delete nativeImage.createFromBitmap;
    const images = createCalendarTrayImages(nativeImage, '/fixture/icon.png');
    assert.equal(images(true), original); assert.equal(images(true), original);
    assert.ok(draws <= 1, 'failed capability is cached rather than retried every minute');
  }
});

test('widgets remain natively movable and their moved bounds survive restart without changing notes', t => {
  const f = fixture(t, { saved: { widgets: { month: { enabled: true } } } });
  const widget = f.controller.getWindows()[0]; f.finish(widget);
  const note = Notes.newNote('保留便签', '仅移动组件', today);
  f.store.update(state => ({ ...state, notes: [note] }));
  const before = fs.readFileSync(f.notesPath, 'utf8');
  assert.equal(widget.options.movable, true); assert.equal(widget.options.resizable, false);
  const moved = { ...widget.getBounds(), x: 260, y: 320 }; widget.setBounds(moved); widget.emit('moved');
  assert.deepEqual(f.persisted().widgets.month.bounds, moved); assert.equal(f.persisted().widgets.month.enabled, true);
  assert.equal(fs.readFileSync(f.notesPath, 'utf8'), before);
  const restored = fixture(t, { saved: f.persisted() });
  assert.deepEqual(restored.controller.getWindows()[0].getBounds(), moved);
});

test('all widgets share a 164pt height while retaining saved positions, enabled/pinned flags and preferences', t => {
  const sizes = { month: [164, 164], date: [164, 164], agenda: [164, 164], 'agenda-wide': [344, 164] };
  const widgets = Object.fromEntries(Object.keys(sizes).map((type, index) => [type, { enabled: true, pinned: index % 2 === 1,
    bounds: { x: 80 + index * 250, y: 120, width: type === 'agenda-wide' ? 386 : type === 'date' ? 160 : 184, height: type === 'date' ? 160 : 184 } }]));
  const saved = { menuEnabled: false, menuDate: true, lunar: false, weather: false, showTodos: false, widgets };
  const f = fixture(t, { saved });
  for (const win of f.controller.getWindows()) {
    const type = f.get(win).widgetType, bounds = win.getBounds();
    assert.deepEqual([bounds.width, bounds.height], sizes[type], type);
    assert.equal(bounds.x, widgets[type].bounds.x); assert.equal(bounds.y, widgets[type].bounds.y);
    assert.equal(win.options.minWidth, sizes[type][0]); assert.equal(win.options.minHeight, sizes[type][1]);
    assert.equal(win.topmost, widgets[type].pinned); assert.equal(f.get(win).preferences.widgets[type].enabled, true);
    assert.equal(win.options.hasShadow, false); assert.equal(win.options.transparent, true);
  }
  assert.deepEqual(f.persisted(), saved, 'opening uniform-sized cards must not migrate saved bounds or other preferences');
});

test('compact date card still clamps to a smaller screen and stays closed after refresh and restart', t => {
  const area = { x: -500, y: -80, width: 140, height: 130 };
  const f = fixture(t, { area, saved: { widgets: { date: { enabled: true, bounds: { x: 5000, y: 5000, width: 184, height: 184 } } } } });
  const win = f.controller.getWindows()[0]; f.finish(win);
  assert.deepEqual(win.getBounds(), area);
  win.close(); assert.equal(f.persisted().widgets.date.enabled, false);
  f.tick(); f.controller.pause(); f.controller.resume(); assert.equal(f.controller.getWindows().length, 0);
  const restarted = fixture(t, { saved: f.persisted() }); assert.equal(restarted.controller.getWindows().length, 0);
});

test('system calendars remain enabled by default for existing authorized preferences', async t => {
  const f = fixture(t, { status: 'granted', saved: { menuEnabled: false, lunar: true }, response: granted([appointment('existing')]) });
  const win = f.open(); f.finish(win); await flush();
  assert.equal(f.get(win).preferences.showSystemCalendar, true);
  assert.deepEqual(f.get(win).system.events.map(item => item.id), ['existing']);
  assert.equal(f.reads.length, 1); assert.equal(f.connects.length, 0);
});

test('a restored disabled system-calendar preference prevents reads in every calendar form', async t => {
  const f = fixture(t, { status: 'granted', saved: { showSystemCalendar: false, menuEnabled: true, widgets: { agenda: { enabled: true } } } });
  const desktop = f.open(); f.trays[0].emit('click');
  for (const win of f.controller.getWindows()) f.finish(win);
  await f.action(desktop, 'month', '2026-12'); await f.action(desktop, 'refresh'); f.tick(); await flush();
  assert.equal(f.reads.length, 0); assert.equal(f.connects.length, 0);
  for (const win of f.controller.getWindows()) {
    const state = f.get(win); assert.equal(state.preferences.showSystemCalendar, false);
    assert.deepEqual(state.system.events, []); assert.deepEqual(state.system.calendars, []);
  }
});

test('disabling system calendars clears all windows immediately and invalidates pending reads', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true, saved: { menuEnabled: true, widgets: { agenda: { enabled: true } } } });
  const desktop = f.open(); f.trays[0].emit('click');
  const windows = f.controller.getWindows(); for (const win of windows) f.finish(win);
  assert.equal(f.reads.length, 3);
  for (const request of f.reads) request.resolve(granted([appointment('private')])); await flush();
  for (const win of windows) assert.equal(f.get(win).system.events.length, 1);
  const refreshing = f.action(desktop, 'refresh'); assert.equal(f.reads.length, 6);
  await f.action(desktop, 'preferences', { showSystemCalendar: false });
  assert.equal(f.persisted().showSystemCalendar, false);
  for (const win of windows) {
    assert.deepEqual(win.sent.at(-1).state.system.events, []);
    assert.deepEqual(win.sent.at(-1).state.system.calendars, []);
  }
  for (const request of f.reads.slice(3)) request.resolve(granted([appointment('late-private')])); await refreshing;
  await f.action(desktop, 'month', '2027-01'); f.tick(); await flush();
  assert.equal(f.reads.length, 6);
  for (const win of windows) {
    const state = f.get(win); assert.equal(state.preferences.showSystemCalendar, false);
    assert.deepEqual(state.system.events, []); assert.deepEqual(state.system.calendars, []);
    assert.deepEqual(win.sent.at(-1).state.system.events, []);
    assert.deepEqual(win.sent.at(-1).state.system.calendars, []);
    assert.equal(state.system.refreshing, false);
  }
});

test('reenabling system calendars refreshes all open windows without requesting permission again', async t => {
  const f = fixture(t, { status: 'granted', saved: { showSystemCalendar: false, widgets: { date: { enabled: true } } }, response: granted([appointment('fresh')]) });
  const desktop = f.open(); for (const win of f.controller.getWindows()) f.finish(win);
  assert.equal(f.reads.length, 0);
  await f.action(desktop, 'preferences', { showSystemCalendar: true });
  assert.equal(f.persisted().showSystemCalendar, true); assert.equal(f.reads.length, 2); assert.equal(f.connects.length, 0);
  for (const win of f.controller.getWindows()) {
    const state = f.get(win); assert.deepEqual(state.system.events.map(item => item.id), ['fresh']);
    assert.deepEqual(state.system.calendars, calendars);
  }
});

test('an explicit connect also enables the system-calendar preference', async t => {
  const f = fixture(t, { saved: { showSystemCalendar: false }, manualConnect: true }), win = f.open(); f.finish(win);
  const connecting = f.action(win, 'connect'); await flush();
  assert.equal(f.connects.length, 1); assert.equal(f.persisted().showSystemCalendar, true);
  f.setStatus('granted'); f.connects[0].resolve({ status: 'granted' }); await connecting;
  assert.equal(f.get(win).preferences.showSystemCalendar, true); assert.equal(f.reads.length, 1);
});

test('turning the switch off while connect is pending wins over the late permission result', async t => {
  const f = fixture(t, { saved: { showSystemCalendar: false }, manualConnect: true }), win = f.open(); f.finish(win);
  const connecting = f.action(win, 'connect'); await flush();
  await f.action(win, 'preferences', { showSystemCalendar: false });
  f.setStatus('granted'); f.connects[0].resolve({ status: 'granted' }); await connecting;
  const state = f.get(win);
  assert.equal(state.preferences.showSystemCalendar, false); assert.equal(f.persisted().showSystemCalendar, false);
  assert.equal(f.reads.length, 0); assert.deepEqual(state.system.events, []); assert.deepEqual(state.system.calendars, []);
});

test('a read from before an off/on cycle cannot replace the newly refreshed events or source list', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true }), win = f.open(); f.finish(win);
  await f.action(win, 'preferences', { showSystemCalendar: false });
  const enabling = f.action(win, 'preferences', { showSystemCalendar: true });
  assert.equal(f.reads.length, 2);
  const latest = [{ id: 'new-source', title: '新来源' }];
  f.reads[1].resolve(granted([appointment('new-event', '2026-11-22', 'new-source')], { calendars: latest })); await enabling;
  f.reads[0].resolve(granted([appointment('stale-event')])); await flush();
  assert.deepEqual(f.get(win).system.events.map(item => item.id), ['new-event']);
  assert.deepEqual(f.get(win).system.calendars, latest);
});

test('system-calendar preference accepts only booleans and preserves the last saved choice', async t => {
  const f = fixture(t, { saved: { showSystemCalendar: false } }), win = f.open(); f.finish(win);
  for (const value of ['false', 0, null, {}]) await f.action(win, 'preferences', { showSystemCalendar: value });
  assert.equal(f.get(win).preferences.showSystemCalendar, false);
  assert.equal(f.persisted().showSystemCalendar, false); assert.equal(f.reads.length, 0);
});

test('calendar window forms use native desktop chrome and a single transparent popup surface', t => {
  const f = fixture(t, { saved: { menuEnabled: true, widgets: { month: { enabled: true } } } });
  const desktop = f.open(); f.trays[0].emit('click'); const menu = f.controller.getWindows().at(-1);
  const widget = f.controller.getWindows().find(win => win.options.title === '球球日历小组件');
  assert.equal(desktop.options.width, 960); assert.equal(desktop.options.height, 720);
  assert.equal(desktop.options.frame, true); assert.equal(desktop.options.titleBarStyle, 'hiddenInset');
  assert.equal(desktop.options.resizable, true); assert.equal(desktop.options.minWidth, 760); assert.equal(desktop.options.minHeight, 600);
  assert.equal(menu.options.width, 520); assert.equal(menu.options.height, 480);
  for (const win of [menu, widget]) {
    assert.equal(win.options.frame, false); assert.equal(win.options.transparent, true);
    assert.equal(win.options.backgroundColor, '#00000000'); assert.equal(win.options.resizable, false);
  }
  assert.equal(menu.options.hasShadow, true, 'menu retains its native popup shadow');
  assert.equal(widget.options.hasShadow, false, 'widgets omit the native dark shadow rim');
});

test('menu anchor is a relative x coordinate and stays inside the popup near either screen edge', t => {
  for (const anchor of [{ x: 900, y: 0, width: 24, height: 24 }, { x: 0, y: 0, width: 16, height: 24 }, { x: 1430, y: 0, width: 10, height: 24 }]) {
    const f = fixture(t, { anchor, saved: { menuEnabled: true } }); f.trays[0].emit('click');
    const menu = f.controller.getWindows()[0]; f.finish(menu); const x = f.get(menu).menuAnchorX;
    assert.equal(Number.isFinite(x), true); assert.ok(x >= 10 && x <= menu.getBounds().width - 10);
    if (anchor.x === 900) assert.equal(x, anchor.x + anchor.width / 2 - menu.getBounds().x);
  }
});

test('desktop resize publishes a new state without creating another window', async t => {
  const f = fixture(t), win = f.open(); f.finish(win); const sent = win.sent.length;
  win.setBounds({ ...win.getBounds(), width: 760, height: 600 }); win.emit('resize'); await flush();
  assert.ok(win.sent.length > sent); assert.equal(win.sent.at(-1).channel, 'calendar:state');
  assert.equal(win.sent.at(-1).state.mode, 'desktop'); assert.equal(f.windows.length, 1);
});

test('expanding a menu calendar opens the chosen date in desktop form and closes the popup', async t => {
  const f = fixture(t, { saved: { menuEnabled: true } }); f.trays[0].emit('click');
  const menu = f.controller.getWindows()[0]; f.finish(menu);
  await f.action(menu, 'select-date', '2026-12-24'); await f.action(menu, 'desktop', { date: '2026-12-24' });
  assert.equal(menu.dead, true); assert.equal(f.controller.getWindows().length, 1);
  const desktop = f.controller.getWindows()[0]; f.finish(desktop);
  assert.equal(f.get(desktop).mode, 'desktop'); assert.equal(f.get(desktop).selectedDate, '2026-12-24');
  assert.equal(desktop.options.frame, true);
});

test('configured current weather opens details, including zero temperature and a cached stale report', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  for (const state of [configuredWeather(), { ...configuredWeather(), status: 'stale' }, { ...configuredWeather(), current: { temperature: 0, weatherCode: 3 } }]) {
    f.setWeather(state); await f.action(win, 'weather');
  }
  assert.equal(f.weatherCalls.length, 3);
  assert.ok(f.weatherCalls.every(call => call.kind === 'detail' && call.parent === win));
});

test('unconfigured weather opens city selection instead of an empty detail window', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  for (const state of [null, {}, { ...configuredWeather(), city: null }, { ...configuredWeather(), current: null },
    { ...configuredWeather(), current: { temperature: null } }, { ...configuredWeather(), current: { temperature: NaN } },
    { ...configuredWeather(), current: { temperature: Infinity } }, { ...configuredWeather(), current: { temperature: '8' } }]) {
    f.setWeather(state); await f.action(win, 'weather');
  }
  assert.equal(f.weatherCalls.length, 8);
  assert.ok(f.weatherCalls.every(call => call.kind === 'city' && call.parent === win));
});

test('desktop views are isolated from menu and widgets and cannot be changed by foreign frames', async t => {
  const f = fixture(t, { saved: { menuEnabled: true, widgets: { month: { enabled: true } } } }), desktop = f.open();
  f.trays[0].emit('click'); const windows = f.controller.getWindows(); for (const win of windows) f.finish(win);
  assert.ok(windows.every(win => f.get(win).view === 'month'));
  await f.action(desktop, 'select-date', '2026-12-24'); await f.action(desktop, 'view', 'week');
  assert.equal(f.get(desktop).view, 'week'); assert.equal(f.get(desktop).selectedDate, '2026-12-24'); assert.equal(f.get(desktop).month, '2026-12');
  for (const win of windows.filter(win => win !== desktop)) {
    const before = f.get(win);
    await f.action(win, 'view', 'day'); await f.action(win, 'navigate', 1);
    assert.equal(f.get(win).view, 'month'); assert.equal(f.get(win).selectedDate, before.selectedDate);
    assert.equal(f.get(win).month, before.month);
  }
  const trusted = f.event(desktop);
  assert.equal(await f.action(desktop, 'view', 'year', { ...trusted, senderFrame: { url: calendarURL } }), null);
  assert.equal(await f.action(desktop, 'navigate', 1, { ...trusted, sender: {} }), null);
  assert.equal(f.get(desktop).view, 'week'); assert.equal(f.get(desktop).selectedDate, '2026-12-24');
});

test('desktop navigation uses natural days, weeks, months and years with month-end clamping', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  for (const [view, start, direction, expected] of [
    ['day', '2026-12-31', 1, '2027-01-01'], ['day', '2027-01-01', -1, '2026-12-31'],
    ['week', '2026-12-28', 1, '2027-01-04'], ['week', '2027-01-04', -1, '2026-12-28'],
    ['month', '2026-01-31', 1, '2026-02-28'], ['month', '2024-01-31', 1, '2024-02-29'],
    ['month', '2024-03-31', -1, '2024-02-29'], ['month', '2026-12-31', 1, '2027-01-31'],
    ['year', '2024-02-29', 1, '2025-02-28'], ['year', '2024-02-29', -1, '2023-02-28'],
    ['year', '2026-12-31', 1, '2027-12-31']
  ]) {
    await f.action(win, 'select-date', start); await f.action(win, 'view', view); await f.action(win, 'navigate', direction);
    const state = f.get(win); assert.equal(state.selectedDate, expected, view + ' ' + start);
    assert.equal(state.month, expected.slice(0, 7)); assert.equal(state.view, view);
  }
  assert.equal(f.connects.length, 0);
});

test('out-of-range desktop navigation leaves selection and read range unchanged', async t => {
  const f = fixture(t, { status: 'granted' }), win = f.open(); f.finish(win); await flush();
  for (const view of ['day', 'week', 'month', 'year']) for (const [date, direction] of [['1970-01-01', -1], ['2100-12-31', 1]]) {
    await f.action(win, 'select-date', date); await f.action(win, 'view', view); const reads = f.reads.length;
    await f.action(win, 'navigate', direction);
    assert.equal(f.get(win).selectedDate, date); assert.equal(f.get(win).month, date.slice(0, 7)); assert.equal(f.get(win).view, view);
    assert.equal(f.reads.length, reads); assert.match(f.get(win).error, /1970.*2100/);
  }
});

test('desktop view and navigate IPC reject coercion, fractional steps and unsupported values', async t => {
  const f = fixture(t, { status: 'granted' }), win = f.open(); f.finish(win); await flush();
  await f.action(win, 'view', 'week'); const before = f.get(win), reads = f.reads.length;
  for (const value of [null, undefined, {}, [], 'Day', 'agenda', 0, true]) await f.action(win, 'view', value);
  for (const value of [null, undefined, {}, [], '1', true, 0, 2, -2, 0.5, NaN, Infinity]) await f.action(win, 'navigate', value);
  const after = f.get(win); assert.equal(after.view, before.view); assert.equal(after.selectedDate, before.selectedDate);
  assert.equal(after.month, before.month); assert.equal(f.reads.length, reads);
});

test('desktop month selection clamps its date in every view while menu month paging keeps its selection', async t => {
  const f = fixture(t, { saved: { menuEnabled: true } }), desktop = f.open(); f.finish(desktop);
  f.trays[0].emit('click'); const menu = f.controller.getWindows().at(-1); f.finish(menu);
  for (const view of ['day', 'week', 'month', 'year']) {
    await f.action(desktop, 'select-date', '2024-01-31'); await f.action(desktop, 'view', view);
    await f.action(desktop, 'month', '2024-02');
    assert.equal(f.get(desktop).selectedDate, '2024-02-29'); assert.equal(f.get(desktop).month, '2024-02'); assert.equal(f.get(desktop).view, view);
  }
  await f.action(desktop, 'view', 'month'); await f.action(desktop, 'navigate', 1);
  assert.equal(f.get(desktop).selectedDate, '2024-03-29', '下一月基于当前展示的已选月份');
  const originalDate = f.get(menu).selectedDate;
  await f.action(menu, 'month', '2027-03'); assert.equal(f.get(menu).selectedDate, originalDate); assert.equal(f.get(menu).view, 'month');
});

test('today and date selection preserve desktop view and keep its month aligned', async t => {
  const f = fixture(t), win = f.open(); f.finish(win);
  for (const view of ['day', 'week', 'year']) {
    await f.action(win, 'view', view); await f.action(win, 'select-date', '2026-12-24');
    assert.equal(f.get(win).view, view); assert.equal(f.get(win).month, '2026-12');
    f.setTime(local('2027-01-03')); await f.action(win, 'today');
    assert.equal(f.get(win).view, view); assert.equal(f.get(win).selectedDate, '2027-01-03'); assert.equal(f.get(win).month, '2027-01');
  }
});

test('year view reads only its anchor month and source filtering remains intact after navigation', async t => {
  const f = fixture(t, { status: 'granted', saved: { weekStart: 'sunday' } }), win = f.open(); f.finish(win); await flush();
  await f.action(win, 'sources', ['personal']); await f.action(win, 'view', 'year');
  assert.deepEqual(f.reads.at(-1).range, Model.monthRange('2026-11', 0));
  await f.action(win, 'navigate', 1); assert.deepEqual(f.reads.at(-1).range, Model.monthRange('2027-11', 0));
  assert.equal(f.get(win).selectedDate, '2027-11-22');
  await f.action(win, 'select-date', '2026-11-22'); await f.action(win, 'view', 'day');
  f.setResponse(granted([appointment('work-event', '2026-11-23', 'work'), appointment('personal-event', '2026-11-23', 'personal')]));
  await f.action(win, 'navigate', 1); const state = f.get(win);
  assert.deepEqual(state.preferences.selectedCalendarIds, ['personal']); assert.deepEqual(f.persisted().selectedCalendarIds, ['personal']);
  assert.deepEqual(Model.dayItems(state.selectedDate, state.system.events, state.todos, state.preferences).events.map(item => item.id), ['personal-event']);
  assert.equal(f.connects.length, 0); assert.ok(f.reads.every(request => request.range.end - request.range.start <= 43 * 86400000));
});

test('a late view-change read cannot replace the date or events of a newer navigation', async t => {
  const f = fixture(t, { status: 'granted', manualReads: true }), win = f.open(); f.finish(win);
  const changing = f.action(win, 'view', 'day'), navigating = f.action(win, 'navigate', 1);
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve(granted([appointment('current', '2026-11-23')])); await navigating;
  f.reads[1].resolve(granted([appointment('old-view')])); await changing;
  f.reads[0].resolve(granted([appointment('old-initial')])); await flush();
  const state = f.get(win); assert.equal(state.view, 'day'); assert.equal(state.selectedDate, '2026-11-23');
  assert.deepEqual(state.system.events.map(item => item.id), ['current']);
});

test('desktop IPC navigation keeps civil dates across DST changes in both directions', async t => {
  const originalTZ = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const f = fixture(t, { status: 'granted', saved: { weekStart: 'sunday' } }), win = f.open(); f.finish(win); await flush();
    await f.action(win, 'view', 'day'); await f.action(win, 'select-date', '2026-03-07');
    await f.action(win, 'navigate', 1); assert.equal(f.get(win).selectedDate, '2026-03-08');
    await f.action(win, 'navigate', 1); assert.equal(f.get(win).selectedDate, '2026-03-09');
    assert.equal(f.reads.at(-1).range.end - f.reads.at(-1).range.start, 42 * 86400000 - 3600000);
    await f.action(win, 'view', 'week'); await f.action(win, 'select-date', '2026-03-07');
    await f.action(win, 'navigate', 1); assert.equal(f.get(win).selectedDate, '2026-03-14');
    await f.action(win, 'navigate', -1); assert.equal(f.get(win).selectedDate, '2026-03-07');
    await f.action(win, 'view', 'day'); await f.action(win, 'select-date', '2026-10-31');
    await f.action(win, 'navigate', 1); assert.equal(f.get(win).selectedDate, '2026-11-01');
    await f.action(win, 'navigate', 1); assert.equal(f.get(win).selectedDate, '2026-11-02');
    assert.equal(f.reads.at(-1).range.end - f.reads.at(-1).range.start, 42 * 86400000 + 3600000);
  } finally { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; }
});
