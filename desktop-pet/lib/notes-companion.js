const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const M = require('./notes-model');
const { createNotesStore } = require('./notes-store');
const { GAP } = require('./quota-label-placement');
const { petVisualBounds } = require('./pet-visual-bounds');

// Pet placement's fallback is a square pet; notes keep their own rectangular size.
function visibleBounds(bounds, screen) {
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(Math.max(240, Math.round(bounds.width)), area.width);
  const height = Math.min(Math.max(160, Math.round(bounds.height)), area.height);
  return { x: Math.min(Math.max(Math.round(bounds.x), area.x), area.x + area.width - width),
    y: Math.min(Math.max(Math.round(bounds.y), area.y), area.y + area.height - height), width, height };
}

function reminderBounds(bounds, area, size, presentation) {
  const pet = petVisualBounds(bounds, presentation?.shape, presentation);
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const x = pet.x + (pet.width - width) / 2, y = pet.y + (pet.height - height) / 2;
  const candidates = [
    { x, y: pet.y - height - GAP }, { x, y: pet.y + pet.height + GAP },
    { x: pet.x + pet.width + GAP, y }, { x: pet.x - width - GAP, y }
  ].map(candidate => ({ x: Math.round(candidate.x), y: Math.round(candidate.y), width, height }));
  const inside = b => b.x >= area.x && b.y >= area.y && b.x + width <= area.x + area.width && b.y + height <= area.y + area.height;
  const fits = candidates.find(inside);
  if (fits) return fits;
  const bounded = candidates.map(b => ({ ...b,
    x: Math.min(Math.max(b.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(b.y, area.y), area.y + area.height - height) }));
  return bounded.find(b => b.x + width <= pet.x || b.x >= pet.x + pet.width || b.y + height <= pet.y || b.y >= pet.y + pet.height) || bounded[0];
}

function createNotesCompanion({ BrowserWindow, screen, ipcMain, clipboard, dialog, filePath,
  getPetBounds, getPetWindow = null, getPetPresentation = () => null, getDefaultTab = () => 'todo', getAppearance = () => 'light', onComplete = () => {}, onError = () => {}, isSuppressed = () => false,
  organizer = null,
  now = Date.now, setTimer = setInterval, clearTimer = clearInterval, closeTimeoutMs = 60000 }) {
  const store = createNotesStore(filePath, { onError });
  const html = path.join(__dirname, '..', 'notes.html');
  const resourceUrl = pathToFileURL(html).href;
  const entries = new Map(), windowEntries = new WeakMap(), noteWindows = new Map(), closing = new Map(), handlers = [], hiddenOccurrences = new Set();
  let panel = null, reminderWindow = null, paused = false, closed = false, scanning = false;
  let summary = true, processingSummary = false, active = null, reminderError = null, lastTick = now();
  let lastDay = M.day(lastTick), lastOffset = new Date(lastTick).getTimezoneOffset();
  let closeAttempt = null, exitTokens = null;
  let organizing = null;
  async function cancelOrganization(entry) {
    if (!organizing || entry && organizing.entry !== entry) return;
    const current = organizing; current.cancelled = true;
    try { await organizer?.cancel(); } finally { if (organizing === current) organizing = null; }
  }
  const report = error => { try { onError(error); } catch (_) {} };
  const suppressed = () => closed || paused || isSuppressed();
  const alive = win => win && !win.isDestroyed();
  const send = (win, channel, value) => {
    const entry = windowEntries.get(win);
    if (alive(win) && entry) { try { entry.contents.send(channel, value); return true; } catch (error) { report(error); } }
    return false;
  };
  const appearance = () => getAppearance() === 'dark' ? 'dark' : 'light';
  function syncAppearance() {
    const value = appearance();
    for (const entry of entries.values()) if (alive(entry.win)) {
      entry.win.setBackgroundColor?.(value === 'dark' ? '#182125' : '#F7FAF9');
      send(entry.win, 'notes:appearance', value);
    }
  }
  const occurrenceKey = item => JSON.stringify([item.id, item.occurrenceId]);
  const due = () => M.dueReminders(store.getState(), now()).filter(item => !hiddenOccurrences.has(occurrenceKey(item)));
  function hideCurrentReminders() {
    for (const item of due()) hiddenOccurrences.add(occurrenceKey(item));
    active = null; reminderError = null; summary = false; processingSummary = false;
    if (alive(reminderWindow)) reminderWindow.hide();
  }
  const reminderDescriptor = () => ({ summary: summary && !processingSummary,
    items: due(), activeId: active?.id || null, occurrenceId: active?.occurrenceId || null, error: reminderError });
  function owned(event) {
    const entry = entries.get(event?.sender);
    if (!entry || !alive(entry.win) || event.senderFrame !== event.sender.mainFrame) return null;
    const url = event.sender.getURL();
    return url.split('?')[0].split('#')[0] === resourceUrl ? entry : null;
  }
  const failure = error => ({ ok: false, state: store.getState(), message: error?.message || '操作未完成，请重试。' });
  function nativeUpdate(fn) {
    try { return { ok: true, state: store.update(fn) }; }
    catch (error) { return failure(error); }
  }
  function anchor(width, height) {
    const pet = getPetBounds?.() || screen.getPrimaryDisplay().workArea;
    return visibleBounds({ x: pet.x + (pet.width || 0) + 12, y: pet.y, width, height }, screen);
  }
  function placeReminder(allowHidden = false) {
    try {
      if (!alive(reminderWindow) || suppressed() || !windowEntries.get(reminderWindow)?.ready || !allowHidden && !reminderWindow.isVisible()) return false;
      const petWindow = getPetWindow?.(), pet = getPetBounds?.();
      if (!pet || getPetWindow && (!alive(petWindow) || !petWindow.isVisible())) { reminderWindow.hide(); return false; }
      const current = reminderWindow.getBounds();
      const next = reminderBounds(pet, screen.getDisplayMatching(pet).workArea, current, getPetPresentation());
      if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) reminderWindow.setBounds(next, false);
      return true;
    } catch (error) { report(error); return false; }
  }
  function show(win, inactive = false) {
    if (!alive(win) || suppressed() || !windowEntries.get(win)?.ready) return;
    if (inactive) win.showInactive(); else { win.show(); win.focus(); }
  }
  function createWindow(mode, id, bounds) {
    const reminder = mode === 'reminder', note = mode === 'note';
    const win = new BrowserWindow({ ...bounds, minWidth: note ? 240 : 360, minHeight: note || reminder ? 160 : 420,
      ...(note ? { maxWidth: 1400, maxHeight: 1200 } : {}),
      frame: false, title: reminder ? '待办提醒' : note ? '球球便签' : '便签与待办',
      backgroundColor: appearance() === 'dark' ? '#182125' : '#F7FAF9', show: false, resizable: !reminder, maximizable: false,
      fullscreenable: false, skipTaskbar: note || reminder, alwaysOnTop: reminder,
      webPreferences: { preload: path.join(__dirname, '..', 'notes-preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, spellcheck: false, webviewTag: false }
    });
    const contents = win.webContents;
    const entry = { win, contents, mode, id, ready: false, open: null, boundsTimer: null, allowedClose: false };
    entries.set(contents, entry); windowEntries.set(win, entry);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('did-finish-load', () => send(win, 'notes:appearance', appearance()));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('render-process-gone', () => {
      if (mode === 'reminder') { active = null; summary = true; processingSummary = false; }
      report(Error('便签窗口暂时无法响应，请重新打开；已保存记录保持不变。'));
      entry.allowedClose = true; if (alive(win)) win.destroy();
    });
    win.once('ready-to-show', () => {
      entry.ready = true;
      if (entry.open) send(win, 'notes:open', entry.open);
      if (reminder) updateReminderWindow();
      else show(win, note && !entry.focusOnReady);
    });
    win.on('close', event => {
      if (entry.allowedClose) return;
      event.preventDefault();
      if (reminder && !active) hideCurrentReminders();
      else if (reminder) void actionReminder(active?.id, active?.occurrenceId, 'dismiss');
      else void hideEntry(entry);
    });
    win.on('closed', () => {
      void cancelOrganization(entry);
      clearTimeout(entry.boundsTimer);
      entries.delete(contents); windowEntries.delete(win);
      if (noteWindows.get(id) === win) noteWindows.delete(id);
      if (panel === win) panel = null;
      if (reminderWindow === win) { reminderWindow = null; active = null; }
      const pending = closing.get(contents);
      if (pending) pending.finish(true);
    });
    if (note) {
      const persistBounds = () => {
        clearTimeout(entry.boundsTimer);
        entry.boundsTimer = setTimeout(() => saveBounds(entry), 250);
        entry.boundsTimer.unref?.();
      };
      win.on('move', persistBounds); win.on('resize', persistBounds);
    }
    void win.loadFile(html, { query: { mode, ...(id ? { id } : {}) } }).catch(error => {
      report(error); entry.allowedClose = true; if (alive(win)) win.destroy();
      if (reminder) { summary = true; processingSummary = false; }
    });
    return win;
  }
  function saveBounds(entry) {
    if (!alive(entry.win) || closed) return { ok: true };
    const bounds = entry.win.getBounds(), current = store.getState().notes.find(item => item.id === entry.id);
    if (!current || current.deletedAt || !current.desktopOpen || JSON.stringify(current.windowBounds) === JSON.stringify(bounds)) return { ok: true };
    const result = nativeUpdate(state => {
      const item = state.notes.find(item => item.id === entry.id);
      item.windowBounds = bounds; item.position = { x: bounds.x, y: bounds.y }; return state;
    });
    if (!result.ok) send(entry.win, 'notes:storage-error', result.message);
    return result;
  }
  function canClose(entry, hold = false) {
    if (!entry || !alive(entry.win) || !entry.ready || entry.mode === 'reminder') return Promise.resolve(true);
    const pending = closing.get(entry.contents);
    if (pending) return hold && !pending.hold ? pending.promise.then(allowed => allowed ? canClose(entry, true) : false) : pending.promise;
    const token = randomUUID();
    let finish;
    const promise = new Promise(resolve => { finish = value => { clearTimeout(timer); closing.delete(entry.contents); resolve(value); }; });
    const timer = setTimeout(() => { report(Error('窗口尚未确认保存，已取消关闭。')); finish(false); }, closeTimeoutMs);
    timer.unref?.();
    closing.set(entry.contents, { token, hold, promise, finish });
    if (hold) exitTokens?.set(entry.win, token);
    send(entry.win, 'notes:before-close', { token, hold });
    return promise;
  }
  async function hideEntry(entry) {
    if (!await canClose(entry)) return { ok: false, message: '已取消关闭，未保存内容仍保留在窗口中。' };
    await cancelOrganization(entry);
    if (entry.mode === 'note') {
      const boundsResult = saveBounds(entry);
      if (!boundsResult.ok) return boundsResult;
      const result = nativeUpdate(state => {
        const item = state.notes.find(item => item.id === entry.id);
        if (item) item.desktopOpen = false;
        return state;
      });
      if (!result.ok) return result;
    } else if (alive(entry.win)) entry.win.hide();
    return { ok: true };
  }
  function syncWindows(state) {
    for (const [id, win] of noteWindows) {
      const item = state.notes.find(item => item.id === id);
      if (!item || item.deletedAt || !item.desktopOpen) {
        const entry = windowEntries.get(win);
        if (entry) entry.allowedClose = true;
        if (alive(win)) win.destroy();
      } else if (alive(win)) win.setAlwaysOnTop(item.pinned);
    }
    if (closed) return;
    for (const item of state.notes.filter(item => !item.deletedAt && item.desktopOpen)) {
      if (alive(noteWindows.get(item.id))) continue;
      const win = createWindow('note', item.id, visibleBounds(item.windowBounds || anchor(300, 220), screen));
      noteWindows.set(item.id, win); win.setAlwaysOnTop(item.pinned);
    }
  }
  function updateReminderWindow() {
    const items = due();
    if (suppressed() || !items.length) {
      if (alive(reminderWindow)) reminderWindow.hide();
      if (!items.length) { active = null; reminderError = null; }
      return;
    }
    if (!alive(reminderWindow)) reminderWindow = createWindow('reminder', null, anchor(360, 190));
    const entry = windowEntries.get(reminderWindow), descriptor = reminderDescriptor(), serialized = JSON.stringify(descriptor);
    if (entry?.ready && entry.reminderPayload !== serialized && send(reminderWindow, 'notes:reminder', descriptor)) entry.reminderPayload = serialized;
    if (!reminderWindow.isVisible() && placeReminder(true)) show(reminderWindow, true);
  }
  function scan(forceSummary = false) {
    if (scanning || suppressed() || store.getReadError()) return;
    scanning = true;
    try {
      const time = now(), gap = time - lastTick;
      lastTick = time;
      if (forceSummary || gap > 65000 || gap < -5000) { summary = true; processingSummary = false; hiddenOccurrences.clear(); active = null; }
      const items = due();
      if (!items.length) { summary = false; processingSummary = false; }
      if (active && !items.some(item => item.id === active.id && item.occurrenceId === active.occurrenceId)) active = null;
      if (summary && !processingSummary) { updateReminderWindow(); return; }
      if (reminderError && !active) { updateReminderWindow(); return; }
      if (!active && items.length) {
        const item = items[0];
        const result = item.reminderState === 'presented' ? { ok: true } : nativeUpdate(state => M.change(state, 'todo', item.id, 'present', time));
        if (!result.ok) { reminderError = result.message; updateReminderWindow(); return; }
        active = { id: item.id, occurrenceId: item.occurrenceId }; reminderError = null;
      }
      updateReminderWindow();
    } finally { scanning = false; }
  }
  async function actionReminder(id, occurrenceId, name) {
    if (suppressed()) return { ok: false, message: '提醒暂时暂停。' };
    if (name === 'list') { hideCurrentReminders(); openPanel({ tab: 'todo' }); return { ok: true }; }
    if (name === 'process') { summary = false; processingSummary = true; reminderError = null; scan(); return { ok: true }; }
    if (!['complete', 'snooze', 'dismiss'].includes(name)) return { ok: false, message: '提醒操作不合法。' };
    if (!active || id !== active.id || occurrenceId !== active.occurrenceId ||
      !due().some(item => item.id === id && item.occurrenceId === occurrenceId)) return { ok: false, message: '这次提醒已变化，请查看当前提醒。' };
    const result = nativeUpdate(state => M.change(state, 'todo', id, name, now()));
    if (!result.ok) { reminderError = result.message; updateReminderWindow(); return result; }
    active = null; reminderError = null;
    scan(); return result;
  }
  function openPanel({ tab, create = false, id = null } = {}) {
    if (suppressed()) return null;
    if (!['note', 'todo'].includes(tab)) tab = getDefaultTab() === 'note' ? 'note' : 'todo';
    if (!alive(panel)) panel = createWindow('panel', null, anchor(380, 520));
    const entry = windowEntries.get(panel);
    entry.open = { tab, create: create === true, id: typeof id === 'string' ? id : null };
    if (entry.ready) send(panel, 'notes:open', entry.open);
    show(panel); return panel;
  }
  function openNote(id) {
    if (suppressed()) return { ok: false, message: '球球暂时暂停。' };
    const item = store.getState().notes.find(item => item.id === id && !item.deletedAt);
    if (!item) return { ok: false, message: '便签不存在或已删除。' };
    if (!item.desktopOpen) {
      const result = nativeUpdate(state => { state.notes.find(item => item.id === id).desktopOpen = true; return state; });
      if (!result.ok) return result;
    } else syncWindows(store.getState());
    const win = noteWindows.get(id);
    if (alive(win)) windowEntries.get(win).focusOnReady = true;
    show(win); return { ok: true, state: store.getState() };
  }
  let previousState = store.getState();
  const unsubscribe = store.subscribe(state => {
    const oldTodos = new Map(previousState.todos.map(item => [item.id, item]));
    previousState = state;
    syncWindows(state);
    for (const entry of entries.values()) send(entry.win, 'notes:state', state);
    for (const item of state.todos) {
      const old = oldTodos.get(item.id);
      if (!item.deletedAt && item.completed && old && !old.deletedAt && !old.completed) {
        try { onComplete(item.id); } catch (error) { report(error); }
      }
    }
    scan();
  });
  function handle(channel, fn) {
    handlers.push(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      const entry = owned(event);
      if (!entry || closed || isSuppressed()) return { ok: false, message: '窗口来源无效或暂时暂停。' };
      try { return await fn(entry, ...args); } catch (error) { report(error); return failure(error); }
    });
  }
  handle('notes:load', entry => ({ state: store.getState(), error: store.getReadError(), mode: entry.mode, id: entry.id,
    notesAppearance: appearance(), panelPinned: entry.mode === 'panel' && entry.win.isAlwaysOnTop(), reminder: reminderDescriptor() }));
  handle('notes:save', async (entry, next, revision) => {
    if (entry.mode === 'reminder') throw Error('提醒窗口不能直接覆盖记录。');
    M.validate(next);
    for (const [id, win] of noteWindows) {
      const candidate = next.notes.find(item => item.id === id);
      if (win !== entry.win && (!candidate || candidate.deletedAt || !candidate.desktopOpen) &&
        !await canClose(windowEntries.get(win))) throw Error('便签仍有未保存内容，已取消操作。');
    }
    return { ok: true, state: store.save(next, revision) };
  });
  handle('notes:open-note', (_entry, id) => { if (typeof id !== 'string' || id.length > 200) throw Error('便签标识不合法。'); return openNote(id); });
  handle('notes:hide-panel', entry => entry.mode === 'panel' ? hideEntry(entry) : { ok: false, message: '请在主面板收起。' });
  handle('notes:close-window', entry => {
    if (entry.mode !== 'reminder') return hideEntry(entry);
    if (active) return actionReminder(active.id, active.occurrenceId, 'dismiss');
    hideCurrentReminders(); return { ok: true };
  });
  handle('notes:pin-note', (entry, value) => {
    if (entry.mode !== 'note' || typeof value !== 'boolean') throw Error('便签置顶参数不合法。');
    return nativeUpdate(state => { const note = state.notes.find(item => item.id === entry.id && !item.deletedAt); if (!note) throw Error('便签已删除。'); note.pinned = value; return state; });
  });
  handle('notes:pin-panel', (entry, value) => {
    if (entry.mode !== 'panel' || typeof value !== 'boolean') throw Error('面板置顶参数不合法。');
    entry.win.setAlwaysOnTop(value);
    return { ok: true, pinned: entry.win.isAlwaysOnTop() };
  });
  handle('notes:copy', (_entry, text) => {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) throw Error('待复制内容为空或过长。');
    clipboard.writeText(text); return { ok: true };
  });
  handle('notes:organize', async (entry, snapshot) => {
    if (entry.mode === 'reminder' || !organizer) return { ok: false, message: '请在便签中使用智能整理。' };
    if (!snapshot || typeof snapshot.id !== 'string' || typeof snapshot.title !== 'string' || typeof snapshot.body !== 'string' ||
      Array.from(snapshot.title).length > 200 || Array.from(snapshot.body).length > 20000) return { ok: false, message: '便签内容为空或过长，请调整后重试。' };
    const item = store.getState().notes.find(note => note.id === snapshot.id && !note.deletedAt);
    if (!item || entry.mode === 'note' && entry.id !== item.id || item.title !== snapshot.title || item.body !== snapshot.body)
      return { ok: false, message: '便签已有新修改，请重新打开智能整理。' };
    if (organizing) return { ok: false, message: '正在整理另一条便签，请稍后再试。' };
    const current = { entry, cancelled: false }; organizing = current;
    try {
      const result = await organizer.organize({ title: item.title, body: item.body });
      if (current.cancelled || !alive(entry.win) || suppressed()) return { ok: false, message: '整理已取消，原文保持不变。' };
      return { ok: true, result };
    } catch (error) { return { ok: false, message: error.message || '整理暂时不可用，原文保持不变。' }; }
    finally { if (organizing === current) organizing = null; }
  });
  handle('notes:organize-cancel', async entry => { await cancelOrganization(entry); return { ok: true }; });
  handle('notes:reminder-action', (entry, id, occurrenceId, name) => entry.mode === 'reminder' ? actionReminder(id, occurrenceId, name) : { ok: false, message: '请在提醒窗口操作。' });
  handle('notes:export', async entry => {
    const result = await dialog.showSaveDialog(entry.win, { title: '导出便签与待办原始记录', defaultPath: '球球便签与待办.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    store.exportRaw(result.filePath); return { ok: true };
  });
  handle('notes:reset', async entry => {
    const result = await dialog.showMessageBox(entry.win, { type: 'warning', title: '重置便签与待办',
      message: '将清空全部便签与待办。请先导出原始数据。', buttons: ['取消', '已导出，重置'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) return { ok: false, cancelled: true };
    for (const ownedEntry of entries.values()) if (ownedEntry !== entry && !await canClose(ownedEntry)) return { ok: false, message: '窗口仍有未保存内容。' };
    return { ok: true, state: store.reset() };
  });
  const closeResponse = (event, token, allowed) => {
    if (!owned(event)) return;
    const pending = closing.get(event.sender);
    if (pending?.token === token && typeof allowed === 'boolean') pending.finish(allowed);
  };
  ipcMain.on('notes:close-response', closeResponse);
  const adjust = () => {
    for (const entry of entries.values()) if (alive(entry.win)) entry.win.setBounds(visibleBounds(entry.win.getBounds(), screen));
    placeReminder();
  };
  screen.on('display-added', adjust); screen.on('display-removed', adjust); screen.on('display-metrics-changed', adjust);
  syncWindows(store.getState());
  const timer = setTimer(() => {
    const time = now(), day = M.day(time), offset = new Date(time).getTimezoneOffset();
    if (day !== lastDay || offset !== lastOffset) {
      lastDay = day; lastOffset = offset;
      for (const entry of entries.values()) send(entry.win, 'notes:state', store.getState());
    }
    scan();
  }, 1000);
  timer.unref?.(); scan();
  function close() {
    if (closed) return Promise.resolve(true);
    if (closeAttempt) return closeAttempt;
    exitTokens = new Map();
    closeAttempt = (async () => {
      let approved = false;
      try {
        if (store.getState().todos.some(item => !item.deletedAt && !item.completed && ['pending', 'presented'].includes(item.reminderState))) {
          const parent = [...entries.values()].find(entry => alive(entry.win))?.win;
          const options = { type: 'question', title: '退出球球', message: '退出后提醒将暂停，下次启动会汇总未处理提醒。',
            buttons: ['继续运行', '退出球球'], defaultId: 0, cancelId: 0 };
          const result = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
          if (result.response !== 1) return false;
        }
        for (const entry of entries.values()) if (!await canClose(entry, true)) return false;
        for (const entry of entries.values()) if (entry.mode === 'note' && !saveBounds(entry).ok) return false;
        approved = true;
      } catch (error) { report(error); return false; }
      finally {
        if (!approved) for (const [win, token] of exitTokens) send(win, 'notes:close-cancelled', token);
        exitTokens = null;
      }
      closed = true; clearTimer(timer); unsubscribe();
      await cancelOrganization(); await organizer?.close();
      for (const channel of handlers) ipcMain.removeHandler(channel);
      ipcMain.removeListener('notes:close-response', closeResponse);
      screen.removeListener('display-added', adjust); screen.removeListener('display-removed', adjust); screen.removeListener('display-metrics-changed', adjust);
      for (const entry of [...entries.values()]) { entry.allowedClose = true; if (alive(entry.win)) entry.win.destroy(); }
      return true;
    })().finally(() => { closeAttempt = null; });
    return closeAttempt;
  }
  return {
    openPanel, openNote, close, syncAppearance,
    repositionReminder(reveal = false) { if (reveal) scan(); else return placeReminder(); },
    pause() { paused = true; void cancelOrganization(); for (const entry of entries.values()) { entry.wasVisible = entry.win.isVisible(); entry.win.hide(); } },
    resume() {
      if (closed) return;
      paused = false; lastTick = now(); hiddenOccurrences.clear();
      for (const entry of entries.values()) if (entry.mode === 'note' || entry.wasVisible && entry.mode !== 'reminder') show(entry.win, entry.mode === 'note');
      scan(true);
    },
    getStore: () => store,
    getWindows: () => ({ panel, notes: [...noteWindows.values()], reminder: reminderWindow })
  };
}

module.exports = { createNotesCompanion, visibleBounds };
