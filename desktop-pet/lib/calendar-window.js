'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Model = require('./calendar-model');
const Notes = require('./notes-model');
const { createSystemCalendar } = require('./system-calendar');
const TYPES = ['month', 'date', 'agenda', 'agenda-wide'];
const VIEWS = ['day', 'week', 'month', 'year'];
const DEFAULTS = { menuEnabled: true, menuDate: false, menuDateSolar: true, menuDateLunar: false, menuDateWeekday: false,
  lunar: true, weather: true, showTodos: true, showSystemCalendar: true, monthRounded: false,
  holidayReminders: true, timeReminders: true, reminderWeekdaysOnly: true,
  morningTime: '09:00', lunchTime: '12:00', restTime: '13:00', offWorkTime: '18:00', weekStart: 'system', selectedCalendarIds: null };
const TIME_KEYS = ['morningTime', 'lunchTime', 'restTime', 'offWorkTime'];
const DATE_KEYS = ['menuDateSolar', 'menuDateLunar', 'menuDateWeekday'];
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
function createCalendarTrayImages(nativeImage, filePath) {
  let original;
  const images = new Map();
  return withDate => {
    const key = withDate === true;
    if (images.has(key)) return images.get(key);
    original ||= nativeImage.createFromPath(filePath);
    original.setTemplateImage?.(true);
    let image = original;
    if (key && typeof original.getSize === 'function' && typeof original.toBitmap === 'function' && typeof nativeImage.createFromBitmap === 'function') {
      try {
        const size = original.getSize(), scaleFactor = 2;
        if (size.width === 18 && size.height === 18) {
          const width = size.width * scaleFactor, height = size.height * scaleFactor;
          const bitmap = original.toBitmap({ scaleFactor });
          if (Buffer.isBuffer(bitmap) && bitmap.length === width * height * 4) {
            // Preserve the original 18pt glyph and its 2x pixels. Two blank points
            // below it shift its optical center up 1pt beside the native title.
            const padded = Buffer.alloc(width * (height + 2 * scaleFactor) * 4);
            bitmap.copy(padded);
            const aligned = nativeImage.createFromBitmap(padded, { width, height: height + 2 * scaleFactor, scaleFactor });
            if (aligned && !aligned.isEmpty?.()) { aligned.setTemplateImage?.(true); image = aligned; }
          }
        }
      } catch (_) { /* Older nativeImage implementations safely retain the original template. */ }
    }
    images.set(key, image);
    return image;
  };
}
function preferences(value = {}) {
  const result = { ...DEFAULTS, widgets: {} };
  for (const key of ['menuEnabled', 'menuDate', ...DATE_KEYS, 'lunar', 'weather', 'showTodos', 'showSystemCalendar', 'monthRounded', 'holidayReminders', 'timeReminders', 'reminderWeekdaysOnly']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (DATE_KEYS.every(key => result[key] === false)) result.menuDateSolar = true;
  for (const key of TIME_KEYS) if (validTime(value[key])) result[key] = value[key];
  if (['system', 'monday', 'sunday'].includes(value.weekStart)) result.weekStart = value.weekStart;
  if (Array.isArray(value.selectedCalendarIds) && value.selectedCalendarIds.length <= 500 && value.selectedCalendarIds.every(id => typeof id === 'string' && id.length <= 500)) result.selectedCalendarIds = [...new Set(value.selectedCalendarIds)];
  for (const type of TYPES) {
    const item = value.widgets?.[type];
    result.widgets[type] = { enabled: item?.enabled === true, pinned: item?.pinned === true, bounds: null };
    if (item?.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item.bounds[key])) && item.bounds.width > 0 && item.bounds.height > 0)
      result.widgets[type].bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(item.bounds[key])]));
  }
  return result;
}
function weekStart(value) {
  if (value === 'monday') return 1;
  if (value === 'sunday') return 0;
  try { return new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).getWeekInfo().firstDay === 1 ? 1 : 0; } catch (_) { return 0; }
}
function clampBounds(bounds, area, size) {
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  return { x: Math.round(Math.max(area.x, Math.min(bounds?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds?.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))), width, height };
}
function weatherSnapshot(state) {
  const code = state?.current?.weatherCode;
  const condition = code === 0 ? '晴' : [1, 2].includes(code) ? '晴间多云' : code === 3 ? '阴' : [45, 48].includes(code) ? '雾' : code >= 95 ? '雷雨' : [71, 73, 75, 77, 85, 86].includes(code) ? '雪' : code >= 51 && code <= 82 ? '雨' : '';
  return { status: state?.enabled === false ? 'disabled' : state?.status || 'unconfigured', city: state?.city?.name || '',
    temperature: state?.enabled !== false && Number.isFinite(state?.current?.temperature) ? state.current.temperature : null,
    feelsLike: state?.enabled !== false && Number.isFinite(state?.current?.apparentTemperature) ? state.current.apparentTemperature : null,
    condition, updatedAt: Number.isFinite(state?.updatedAt) ? state.updatedAt : null };
}
function dateInMonth(date, month) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return month + '-' + String(Math.min(Number(date.slice(8)), last)).padStart(2, '0');
}
function navigateDate(date, view, direction) {
  const [year, month, number] = date.split('-').map(Number);
  let result;
  if (view === 'day' || view === 'week') {
    result = new Date(Date.UTC(year, month - 1, number + direction * (view === 'week' ? 7 : 1))).toISOString().slice(0, 10);
  } else {
    const target = new Date(Date.UTC(year + (view === 'year' ? direction : 0), month - 1 + (view === 'month' ? direction : 0), 1));
    result = dateInMonth(date, target.toISOString().slice(0, 7));
  }
  if (!Model.validDate(result)) throw Error('请选择 1970–2100 年之间的日期');
  return result;
}
function createCalendarWindow({ BrowserWindow, Tray, nativeImage, screen, ipcMain, shell, filePath, store,
  systemCalendar = createSystemCalendar(), trackWindow = () => {}, getWeather = () => null, openWeatherCity = () => {}, openWeatherDetail = () => {},
  onHolidayPreview = async () => false, onTimePreview = async () => false,
  isSuppressed = () => false, onChange = () => {}, onError = () => {}, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
  const root = path.join(__dirname, '..'), html = path.join(root, 'calendar.html'), url = pathToFileURL(html).href;
  const trayImages = createCalendarTrayImages(nativeImage, path.join(root, 'assets/calendar-iconTemplate.png'));
  let trayImageDate = null;
  let prefs = preferences(), storageError = null, destroyed = false, paused = false, calendarTray = null, connecting = false, connectFlight = null;
  let globalSystem = { status: 'not-determined', calendars: [], error: null }, epoch = 0;
  const entries = new Set();
  let desktop = null, popup = null;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('Invalid calendar preferences');
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!saved || saved.schema !== 1 || !saved.preferences || typeof saved.preferences !== 'object' || Array.isArray(saved.preferences)) throw Error('Invalid calendar preferences');
    prefs = preferences(saved.preferences);
  } catch (error) { if (error.code !== 'ENOENT') { storageError = '日历设置无法读取，请保留原文件后重试'; onError(error); } }
  function persist(next) {
    if (storageError) throw Error(storageError);
    const clean = preferences(next), temporary = filePath + '.' + process.pid + '.tmp';
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(temporary, JSON.stringify({ schema: 1, preferences: clean }) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, filePath); prefs = clean;
    } finally { try { fs.unlinkSync(temporary); } catch (_) {} }
  }
  function status() {
    try { return systemCalendar.status(); } catch (_) { return { status: 'unavailable' }; }
  }
  function clearSystemData() {
    epoch++;
    for (const entry of entries) { entry.generation++; entry.events = []; entry.refreshing = false; entry.truncated = false; }
    globalSystem = { ...globalSystem, calendars: [], error: null };
  }
  function syncStatus(next = status()) {
    if (!prefs.showSystemCalendar) {
      globalSystem = { status: next.status, calendars: [], error: null };
      return;
    }
    if (next.status !== 'granted') {
      if (globalSystem.status !== next.status || [...entries].some(entry => entry.events.length)) epoch++;
      for (const entry of entries) { entry.generation++; entry.events = []; entry.refreshing = false; }
      globalSystem = { status: next.status, calendars: [], error: next.error ? '系统日历暂时无法读取' : null };
    } else globalSystem = { ...globalSystem, status: next.status };
  }
  function snapshot(entry) {
    const state = store.getState();
    return { mode: entry.mode, widgetType: entry.type, view: entry.view, month: entry.month, selectedDate: entry.date, now: now(),
      page: entry.page, pinned: entry.pinned, menuAnchorX: entry.mode === 'menu' ? menuAnchor(entry.win.getBounds()) : null, preferences: clone(prefs),
      system: { ...clone(globalSystem), events: clone(entry.events), connecting, refreshing: entry.refreshing, truncated: entry.truncated },
      todos: clone(state.todos), notesError: store.getReadError?.() ? '待办文件无法读取，请在便签与待办中检查' : null,
      weather: weatherSnapshot(getWeather()), error: entry.error || storageError };
  }
  function publish(entry) { if (!destroyed && entry && !entry.win.isDestroyed()) entry.win.webContents.send('calendar:state', snapshot(entry)); }
  function publishAll() { for (const entry of entries) publish(entry); }
  function report(entry, error, message = '操作未完成，请重试') { onError(error); entry.error = message; publish(entry); }
  function active(entry) { return !destroyed && !paused && !isSuppressed() && entries.has(entry) && !entry.win.isDestroyed(); }
  function viewRange(entry) { return Model.monthRange(entry.mode === 'widget' && entry.type !== 'month' ? Model.day(now()).slice(0, 7) : entry.month, weekStart(prefs.weekStart)); }
  async function refresh(entry) {
    if (!active(entry)) return;
    syncStatus();
    if (!prefs.showSystemCalendar || globalSystem.status !== 'granted') { publishAll(); return; }
    const generation = ++entry.generation, revision = epoch;
    entry.refreshing = true; publish(entry);
    try {
      const result = await systemCalendar.read(viewRange(entry));
      if (!active(entry) || generation !== entry.generation || revision !== epoch) return;
      if (result.status !== 'granted') { syncStatus(result); publishAll(); return; }
      // Read errors never turn into successful empty calendars or keep stale events.
      entry.events = Array.isArray(result.events) && !result.error ? result.events : [];
      entry.truncated = result.truncated === true;
      globalSystem = { status: 'granted', calendars: Array.isArray(result.calendars) ? result.calendars : [], error: result.error ? '系统日历暂时无法读取，请刷新重试' : null };
    } catch (error) { if (active(entry) && generation === entry.generation) { entry.events = []; report(entry, error, '日程更新失败，请重试'); } }
    finally { if (generation === entry.generation) { entry.refreshing = false; publishAll(); } }
  }
  function refreshAll() { return Promise.all([...entries].filter(active).map(refresh)); }
  function safeArea(bounds) { return (bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()).workArea; }
  function boundsFor(mode, type) {
    const size = mode === 'desktop' ? { width: 960, height: 720 } : mode === 'menu' ? { width: 520, height: 480 } : { width: type === 'agenda-wide' ? 344 : 164, height: 164 };
    const saved = mode === 'widget' ? prefs.widgets[type].bounds : null;
    if (mode === 'menu' && calendarTray) {
      const anchor = calendarTray.getBounds(), area = safeArea(anchor);
      return clampBounds({ x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y + anchor.height + 4 }, area, size);
    }
    const area = safeArea(saved);
    const index = TYPES.indexOf(type);
    return clampBounds(saved || (mode === 'widget' ? { x: area.x + 24 + (index % 2) * 200, y: area.y + 24 + Math.floor(index / 2) * 200 } : null), area, size);
  }
  function menuAnchor(bounds) {
    const anchor = calendarTray?.getBounds();
    return Math.round(Math.max(22, Math.min(bounds.width - 22, anchor ? anchor.x + anchor.width / 2 - bounds.x : bounds.width / 2)));
  }
  function create(mode, type = null) {
    if (destroyed || paused || isSuppressed()) return null;
    const date = Model.day(now()), bounds = boundsFor(mode, type);
    const win = new BrowserWindow({ ...bounds, show: false, frame: mode === 'desktop',
      ...(mode === 'desktop' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { transparent: true, hasShadow: mode === 'menu' }),
      title: mode === 'widget' ? '球球日历小组件' : '球球日历',
      resizable: mode === 'desktop', movable: mode !== 'menu', minWidth: mode === 'desktop' ? Math.min(760, bounds.width) : bounds.width, minHeight: mode === 'desktop' ? Math.min(600, bounds.height) : bounds.height,
      maximizable: mode === 'desktop', fullscreenable: false, skipTaskbar: mode !== 'desktop', backgroundColor: mode === 'desktop' ? '#f7f8fa' : '#00000000',
      webPreferences: { preload: path.join(root, 'calendar-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const entry = { win, mode, type, view: 'month', date, month: date.slice(0, 7), page: 'calendar', pinned: mode === 'widget' && prefs.widgets[type].pinned,
      generation: 0, events: [], refreshing: false, truncated: false, error: null, modalOpen: false, ready: false, weatherOpen: false };
    entries.add(entry);
    trackWindow(win); // Installs initial theme before loadFile; every window follows global theme broadcasts.
    win.setAlwaysOnTop(entry.pinned, 'floating');
    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => { entry.ready = true; if (active(entry)) { publish(entry); if (mode === 'widget') win.showInactive(); else win.show(); void refresh(entry); } });
    win.on('blur', () => { if (mode === 'menu' && !entry.modalOpen && !entry.pinned) win.close(); });
    win.on('focus', () => { if (entry.weatherOpen) { entry.weatherOpen = false; entry.modalOpen = false; } });
    win.on('closed', () => {
      entry.generation++; entries.delete(entry);
      if (desktop === entry) desktop = null;
      if (popup === entry) popup = null;
      if (!destroyed && mode === 'widget') {
        try { persist({ ...prefs, widgets: { ...prefs.widgets, [type]: { ...prefs.widgets[type], enabled: false } } }); onChange(); publishAll(); } catch (error) { onError(error); }
      }
    });
    const saveBounds = () => {
      if (mode !== 'widget' || destroyed || win.isDestroyed()) return;
      try { persist({ ...prefs, widgets: { ...prefs.widgets, [type]: { ...prefs.widgets[type], bounds: win.getBounds() } } }); } catch (error) { report(entry, error, '组件位置未能保存'); }
    };
    win.on('moved', saveBounds);
    win.on('resize', () => publish(entry));
    win.loadFile(html).catch(error => { if (!win.isDestroyed()) report(entry, error, '日历窗口未能打开'); });
    return entry;
  }
  function openDesktop({ page = 'calendar', date } = {}) {
    if (destroyed || paused || isSuppressed()) return false;
    desktop ||= create('desktop');
    if (!desktop) return false;
    desktop.page = ['calendar', 'settings', 'widgets'].includes(page) ? page : 'calendar';
    if (Model.validDate(date)) { desktop.date = date; desktop.month = date.slice(0, 7); void refresh(desktop); }
    publish(desktop); if (desktop.ready) { desktop.win.show(); desktop.win.focus(); } return true;
  }
  function togglePopup() {
    if (popup) { popup.win.close(); return; }
    popup = create('menu');
  }
  function syncTray() {
    if (destroyed) return;
    if (!prefs.menuEnabled) { calendarTray?.destroy(); calendarTray = null; if (popup) popup.win.close(); return; }
    if (!calendarTray && Tray && nativeImage) {
      calendarTray = new Tray(trayImages(prefs.menuDate)); trayImageDate = prefs.menuDate;
      calendarTray.setToolTip('球球日历');
      calendarTray.on('click', togglePopup);
    }
    if (calendarTray) {
      if (trayImageDate !== prefs.menuDate) { calendarTray.setImage?.(trayImages(prefs.menuDate)); trayImageDate = prefs.menuDate; }
      const date = new Date(now());
      const labels = [];
      if (prefs.menuDate) {
        if (prefs.menuDateSolar) labels.push(`${date.getMonth() + 1}月${date.getDate()}日`);
        if (prefs.menuDateLunar) { const converted = Model.lunar(Model.day(date)); labels.push(converted.month + converted.day); }
        if (prefs.menuDateWeekday) labels.push(['周日','周一','周二','周三','周四','周五','周六'][date.getDay()]);
      }
      calendarTray.setTitle(labels.join(' '));
    }
  }
  function widget(value) {
    if (!value || !TYPES.includes(value.type) || typeof value.enabled !== 'boolean') throw Error('请选择有效的小组件');
    const old = prefs.widgets[value.type], next = { ...old, enabled: value.enabled };
    if (typeof value.pinned === 'boolean') next.pinned = value.pinned;
    persist({ ...prefs, widgets: { ...prefs.widgets, [value.type]: next } });
    const entry = [...entries].find(item => item.type === value.type && item.mode === 'widget');
    if (!value.enabled) entry?.win.close();
    else if (entry) { entry.pinned = next.pinned; entry.win.setAlwaysOnTop(next.pinned, 'floating'); entry.win.showInactive(); }
    else create('widget', value.type);
    onChange(); publishAll();
  }
  function trusted(event) {
    const entry = [...entries].find(item => item.win.webContents === event?.sender && !item.win.isDestroyed());
    if (!entry || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== url || event.sender.getURL() !== url) return null;
    return entry;
  }
  async function action(entry, name, value) {
    if (!active(entry)) return null;
    entry.error = null;
    try {
      switch (name) {
        case 'month':
          if (typeof value !== 'string' || !Model.validDate(value + '-01')) throw Error('请选择有效月份');
          if (entry.mode === 'desktop') entry.date = dateInMonth(entry.date, value);
          entry.month = value; await refresh(entry); break;
        case 'view':
          if (entry.mode !== 'desktop' || !VIEWS.includes(value)) throw Error('请选择有效的桌面日历视图');
          entry.view = value; entry.month = entry.date.slice(0, 7); await refresh(entry); break;
        case 'navigate': {
          if (entry.mode !== 'desktop' || value !== -1 && value !== 1) throw Error('请选择有效的桌面日历方向');
          const date = navigateDate(entry.date, entry.view, value);
          entry.date = date; entry.month = date.slice(0, 7); await refresh(entry); break;
        }
        case 'select-date':
          if (!Model.validDate(value)) throw Error('请选择有效日期');
          entry.date = value;
          if (entry.month !== value.slice(0, 7)) { entry.month = value.slice(0, 7); await refresh(entry); }
          break;
        case 'today': entry.date = Model.day(now()); entry.month = entry.date.slice(0, 7); await refresh(entry); break;
        case 'refresh': await refreshAll(); break;
        case 'connect':
          if (!prefs.showSystemCalendar) { persist({ ...prefs, showSystemCalendar: true }); clearSystemData(); publishAll(); }
          if (!connectFlight) {
            const revision = epoch; connecting = true; publishAll();
            connectFlight = Promise.resolve().then(() => systemCalendar.connect()).then(result => {
              if (destroyed || paused || revision !== epoch) return;
              syncStatus(result); return refreshAll();
            }).finally(() => { connecting = false; connectFlight = null; publishAll(); });
          }
          await connectFlight;
          if (active(entry) && prefs.showSystemCalendar && globalSystem.status !== 'granted') await refreshAll();
          break;
        case 'sources': {
          const ids = new Set(globalSystem.calendars.map(item => item.id));
          if (!Array.isArray(value) || value.length > 500 || !value.every(id => ids.has(id))) throw Error('请选择现有日历来源');
          persist({ ...prefs, selectedCalendarIds: value }); publishAll(); onChange(); break;
        }
        case 'preferences': {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('日历设置无法保存');
          const patch = {};
          for (const [key, item] of Object.entries(value)) {
            if (['menuEnabled','menuDate',...DATE_KEYS,'lunar','weather','showTodos','showSystemCalendar','monthRounded','holidayReminders','timeReminders','reminderWeekdaysOnly'].includes(key) && typeof item === 'boolean') patch[key] = item;
            else if (TIME_KEYS.includes(key) && validTime(item)) patch[key] = item;
            else if (key === 'weekStart' && ['system','monday','sunday'].includes(item)) patch[key] = item;
            else throw Error('日历设置无法保存');
          }
          persist({ ...prefs, ...patch });
          if (Object.hasOwn(patch, 'showSystemCalendar')) clearSystemData();
          syncTray(); onChange(); publishAll();
          if (Object.hasOwn(patch, 'weekStart') || patch.showSystemCalendar === true) await refreshAll(); break;
        }
        case 'widget': widget(value); break;
        case 'page':
          if (!['calendar','settings','widgets'].includes(value)) throw Error('页面不存在');
          if (entry.mode === 'widget' && value !== 'calendar') openDesktop({ page: value });
          else entry.page = value;
          break;
        case 'modal-open': entry.modalOpen = value === true; return snapshot(entry);
        case 'desktop': openDesktop({ date: Model.validDate(value?.date) ? value.date : entry.date }); if (entry.mode === 'menu') entry.win.close(); break;
        case 'new-todo': {
          if (!value || typeof value.title !== 'string' || !value.title.trim() || Array.from(value.title.trim()).length > 200 || !Model.validDate(value.dueDate)) throw Error('请填写待办内容和有效日期');
          if (store.getReadError?.()) throw Error('待办文件无法读取，已保留原记录');
          await store.update(state => {
            const item = Notes.newTodo(value.title.trim(), now()); item.dueDate = value.dueDate;
            return Notes.validate({ ...state, revision: state.revision + 1, todos: [...state.todos, item] });
          }); break;
        }
        case 'toggle-todo':
          if (typeof value !== 'string' || store.getReadError?.()) throw Error('待办无法更新');
          await store.update(state => {
            const item = state.todos.find(item => item.id === value && item.deletedAt == null && !item.archived);
            if (!item) throw Error('待办已不存在');
            return Notes.change(state, 'todo', value, item.completed ? 'uncomplete' : 'complete', now());
          }); break;
        case 'pin':
          if (typeof value !== 'boolean') throw Error('窗口设置无法保存');
          entry.pinned = value; entry.win.setAlwaysOnTop(value, 'floating');
          if (entry.mode === 'widget') widget({ type: entry.type, enabled: true, pinned: value }); break;
        case 'close': entry.win.close(); return null;
        case 'system-settings': await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'); break;
        case 'system-calendar': await shell.openExternal('ical://'); break;
        case 'holiday-preview':
          if (await onHolidayPreview() !== true) throw Error('球球正在忙，请稍后再试；也请确认已开启互动气泡');
          break;
        case 'time-preview':
          if (!['morning','lunch','rest','offWork'].includes(value)) throw Error('请选择有效的互动时段');
          if (await onTimePreview(value) !== true) throw Error('球球正在忙，请稍后再试；也请确认已开启互动气泡');
          break;
        case 'weather': {
          entry.modalOpen = true; entry.weatherOpen = true;
          const weather = weatherSnapshot(getWeather());
          if (weather.city && Number.isFinite(weather.temperature)) openWeatherDetail(entry.win);
          else openWeatherCity(entry.win);
          break;
        }
        default: throw Error('无法执行此操作');
      }
    } catch (error) { report(entry, error, /^E[A-Z]+$/.test(error.code || '') ? '操作未能保存，请重试' : error.message || '操作未完成，请重试'); }
    publish(entry); return snapshot(entry);
  }
  ipcMain.handle('calendar:get', event => { const entry = trusted(event); if (!entry || !active(entry)) return null; syncStatus(); publishAll(); return snapshot(entry); });
  ipcMain.handle('calendar:action', (event, packet) => { const entry = trusted(event); if (!entry || !packet || typeof packet.action !== 'string') return null; return action(entry, packet.action, packet.value); });
  const unsubscribe = store.subscribe(() => publishAll());
  function tick() {
    if (destroyed || paused || isSuppressed()) return;
    syncTray();
    for (const entry of entries) if (entry.mode === 'widget') {
      const today = Model.day(now()), rolled = entry.date !== today;
      entry.date = today;
      if (entry.type !== 'month' || rolled) entry.month = today.slice(0, 7);
    }
    void refreshAll(); publishAll();
  }
  const timer = setTimer(tick, 60000); timer?.unref?.();
  const displayChanged = () => { for (const entry of entries) if (!entry.win.isDestroyed()) entry.win.setBounds(clampBounds(entry.win.getBounds(), safeArea(entry.win.getBounds()), entry.win.getBounds())); };
  screen.on?.('display-removed', displayChanged); screen.on?.('display-metrics-changed', displayChanged);
  syncStatus(); syncTray();
  for (const type of TYPES) if (prefs.widgets[type].enabled) create('widget', type);
  return { open: openDesktop, getWindows: () => [...entries].map(item => item.win), getPreferences: () => clone(prefs),
    updateWeather: publishAll,
    menu: () => ({ id: 'calendar-menu', label: '日历', submenu: [
      { id: 'calendar-open', label: '打开日历', click: () => openDesktop() },
      { id: 'calendar-menu-enabled', label: '常驻菜单栏', type: 'checkbox', checked: prefs.menuEnabled, click: item => {
        try { persist({ ...prefs, menuEnabled: item.checked }); syncTray(); onChange(); publishAll(); } catch (error) { onError(error); }
      } },
      { id: 'calendar-menu-date', label: '显示菜单栏日期', type: 'checkbox', enabled: prefs.menuEnabled, checked: prefs.menuDate, click: item => {
        try { persist({ ...prefs, menuDate: item.checked }); syncTray(); onChange(); publishAll(); } catch (error) { onError(error); }
      } },
      { id: 'calendar-widgets', label: '桌面小组件', click: () => openDesktop({ page: 'widgets' }) },
      { id: 'calendar-settings', label: '日历设置', click: () => openDesktop({ page: 'settings' }) }
    ] }),
    pause() { paused = true; epoch++; for (const entry of entries) { entry.generation++; entry.events = []; entry.refreshing = false; entry.win.hide(); } },
    resume() { paused = false; if (isSuppressed()) return; for (const entry of entries) { if (entry.mode === 'widget') entry.win.showInactive(); else if (entry.mode === 'desktop') entry.win.show(); else entry.win.close(); } tick(); },
    destroy() { if (destroyed) return; destroyed = true; epoch++; clearTimer(timer); unsubscribe?.(); calendarTray?.destroy();
      screen.removeListener?.('display-removed', displayChanged); screen.removeListener?.('display-metrics-changed', displayChanged);
      for (const entry of entries) { entry.events = []; entry.win.destroy(); } entries.clear();
      ipcMain.removeHandler('calendar:get'); ipcMain.removeHandler('calendar:action'); }
  };
}
module.exports = { createCalendarWindow, createCalendarTrayImages, preferences, weekStart, clampBounds, weatherSnapshot };
