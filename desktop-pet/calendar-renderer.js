(function () {
  'use strict';

  const api = window.qiuqiuCalendar;
  const Model = window.QiuCalendarModel;
  const $ = id => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const WIDGETS = [
    { type: 'month', title: '月历', copy: '查看整月日期', icon: 'calendar' },
    { type: 'date', title: '日期', copy: '突出今天与农历', icon: null },
    { type: 'agenda', title: '近期日程 · 小', copy: '查看下一项安排', icon: 'clock' },
    { type: 'agenda-wide', title: '近期日程 · 中', copy: '查看今天和明天', icon: 'calendar' }
  ];
  let state = null;
  let expandedEvents = false;
  let expandedTodos = false;
  let previousPage = null;
  let lastSelection = null;
  let modalReported = false;
  let savingTodo = false;
  let savingMonth = false;
  let previewTarget = null;
  let localError = '';
  let settingsNotice = '';
  let timeTrigger = null;
  let dateMonth = '';
  let settingsToast = '', settingsToastTimer;
  const pendingTodos = new Set();
  const signatures = Object.create(null);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function icon(name) {
    const node = document.createElementNS(SVG_NS, 'svg');
    node.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#cal-' + name);
    node.append(use);
    return node;
  }
  function button(text, className, action, value) {
    const node = el('button', className, text);
    node.type = 'button';
    if (action) node.dataset.action = action;
    if (value != null) node.dataset.value = String(value);
    return node;
  }
  function setText(id, value) { $(id).textContent = value == null ? '' : String(value); }
  function showMessage(id, value) { setText(id, value); $(id).hidden = !value; }
  function renderFeedback() {
    const message = localError || state?.error || '';
    const modal = document.querySelector('dialog[open]');
    showMessage('global-error', modal ? '' : message);
    const notice = $('settings-dialog').open ? message || settingsNotice : '';
    if (notice !== settingsToast) {
      clearTimeout(settingsToastTimer); settingsToast = notice;
      showMessage('settings-feedback', notice);
      if (notice) settingsToastTimer = setTimeout(() => { $('settings-feedback').hidden = true; }, 4200);
    }
  }
  function empty(message) { return el('p', 'empty-state', message); }
  function weekStart() {
    if (state.preferences.weekStart === 'monday') return 1;
    if (state.preferences.weekStart === 'sunday') return 0;
    try {
      const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);
      const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo;
      return info.firstDay % 7 === 1 ? 1 : 0;
    } catch (_) { return 0; }
  }
  function parseDay(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }
  function dateText(date) {
    const value = parseDay(date);
    return `${value.getMonth() + 1}月${value.getDate()}日`;
  }
  function weekday(date) { return '周' + WEEK[parseDay(date).getDay()]; }
  function monthText(month) { const [year, value] = month.split('-').map(Number); return `${year}年${value}月`; }
  function offsetDate(date, amount) { const value = parseDay(date); value.setDate(value.getDate() + amount); return Model.day(value); }
  function timestampDay(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function timeText(value) {
    if (!Number.isFinite(new Date(value).getTime())) return '时间待确认';
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
  }
  function fullLunar(date) {
    try { const lunar = Model.lunar(date); return `${lunar.month}${lunar.day}`; } catch (_) { return ''; }
  }
  function specialText(date) { return Model.specials(date).map(item => item.title).join(' · '); }
  function dateItems(date) { return Model.dayItems(date, state.preferences.showSystemCalendar === false ? [] : state.system.events, state.todos, state.preferences); }
  function calendarFor(event) { return state.system.calendars.find(item => item.id === event.calendarId); }
  function colorize(node, value) {
    // The native bridge only returns six-digit hex colors. Keep all other values out of CSS.
    if (typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) node.style.setProperty('--event-color', value);
  }
  function eventTime(event, date, range = false) {
    if (event.allDay) return '全天';
    const startDay = timestampDay(event.start), endDay = timestampDay(event.end);
    if (startDay < date) return '跨日';
    if (range && event.end > event.start && endDay === date) return `${timeText(event.start)}–${timeText(event.end)}`;
    return timeText(event.start);
  }
  function nextEvent(items, date) {
    if (date !== Model.day(state.now)) return null;
    return items.events.find(event => !event.allDay && (event.end > state.now || event.start >= state.now)) || null;
  }
  function sameSignature(key, value) {
    const next = JSON.stringify(value);
    if (signatures[key] === next) return true;
    signatures[key] = next;
    return false;
  }
  function preserveFocus(container, make) {
    const active = document.activeElement;
    const date = container.contains(active) ? active.dataset.date : null;
    const todo = container.contains(active) ? active.dataset.todoId : null;
    make();
    if (date || todo) {
      const selector = date ? `[data-date="${CSS.escape(date)}"]` : `button[data-todo-id="${CSS.escape(todo)}"]`;
      container.querySelector(selector)?.focus({ preventScroll: true });
    }
  }

  async function act(action, value, options = {}) {
    if (!api) return null;
    if (!options.quiet) { localError = ''; if (!['holiday-preview','time-preview'].includes(action)) settingsNotice = ''; }
    try {
      const result = await api.action(action, value);
      if (result && !options.ignoreState) applyState(result);
      return result;
    } catch (_) {
      if (!options.quiet) {
        localError = '操作未完成，请重试';
        renderFeedback();
      }
      return { error: '操作未完成，请重试' };
    }
  }

  function monthDetail() {
    if (state.mode !== 'desktop') return { density: 'counts', rows: 0, holidayBars: false };
    const rect = $('days').getBoundingClientRect(), width = rect.width / 7, height = rect.height / 6;
    const density = width < 78 || height < 76 ? 'counts' : width >= 106 && height >= 100 ? 'full' : 'summary';
    // Width controls how much detail is legible; height controls how many rows fit.
    // Do not cap a tall, narrow month cell at a single appointment.
    return { density, rows: density === 'counts' ? 0 : Math.max(1, Math.floor((height - 28) / 14)), holidayBars: density !== 'counts' && height >= 86 };
  }
  function appendDayItems(node, items, slots, date) {
    const list = el('span', 'day-items');
    const entries = [...items.events.map(event => ({ event })), ...items.todos.map(todo => ({ todo }))];
    const rows = [];
    for (const item of entries.slice(0, slots)) {
      const row = el('span', item.event ? 'cell-event' + (item.event.allDay ? ' is-all-day' : '') : 'cell-todo');
      const title = item.event?.title || item.todo.title;
      if (item.event) {
        row.dataset.eventId = item.event.id; row.dataset.eventStart = String(item.event.start);
        colorize(row, calendarFor(item.event)?.color);
        if (!item.event.allDay) row.append(el('span', 'cell-time', eventTime(item.event, date)));
      }
      row.append(el('span', 'cell-title', title)); row.title = title;
      rows.push(row); list.append(row);
    }
    const more = el('span', 'cell-more');
    more.hidden = rows.length === entries.length;
    if (!more.hidden) more.textContent = `+${entries.length - rows.length}个`;
    list.append(more);
    node.append(list);
    return { node, list, rows, more, total: entries.length };
  }
  function fitDayItems({ node, rows, more, total }) {
    const style = getComputedStyle(node);
    const bottom = node.getBoundingClientRect().bottom - parseFloat(style.paddingBottom || 0) - parseFloat(style.borderBottomWidth || 0);
    // Reserve a separate final line for the remaining count, using actual rendered
    // row metrics so larger text and solar-term labels cannot cause clipping.
    while (rows.length && (more.hidden ? rows.at(-1) : more).getBoundingClientRect().bottom > bottom + .5) {
      rows.pop().remove();
      more.hidden = false;
      more.textContent = `+${total - rows.length}个`;
    }
  }
  function holidayLabel(arrangement) { return arrangement.name + (arrangement.kind === 'rest' ? '（休）' : '（班）'); }
  function layoutHolidayBars() {
    const grid = $('days'), bounds = grid.getBoundingClientRect(), cells = grid.querySelectorAll('.day');
    for (const bar of grid.querySelectorAll('.holiday-bar')) {
      const first = cells[Number(bar.dataset.first)], last = cells[Number(bar.dataset.last)];
      const slot = first?.querySelector('.holiday-slot');
      if (!slot || !last) continue;
      const start = first.getBoundingClientRect(), end = last.getBoundingClientRect(), lane = slot.getBoundingClientRect();
      bar.style.left = `${start.left + first.clientLeft - bounds.left - grid.clientLeft}px`;
      bar.style.top = `${lane.top - bounds.top - grid.clientTop}px`;
      bar.style.width = `${end.right - parseFloat(getComputedStyle(last).borderRightWidth || 0) - start.left - first.clientLeft}px`;
      bar.style.height = `${lane.height}px`;
    }
  }
  function appendHolidayBars(days) {
    for (let index = 0; index < days.length;) {
      const first = days[index], arrangement = first.arrangement;
      if (!arrangement) { index++; continue; }
      let end = index;
      while (end + 1 < days.length && Math.floor((end + 1) / 7) === Math.floor(index / 7)) {
        const next = days[end + 1].arrangement;
        if (!next || next.kind !== arrangement.kind || next.name !== arrangement.name || next.start !== arrangement.start || next.end !== arrangement.end) break;
        end++;
      }
      const bar = el('span', 'holiday-bar' + (first.date === arrangement.start ? ' is-start' : '') + (days[end].date === arrangement.end ? ' is-end' : ''), holidayLabel(arrangement));
      bar.dataset.kind = arrangement.kind; bar.dataset.name = arrangement.name;
      bar.dataset.first = String(index); bar.dataset.last = String(end);
      bar.setAttribute('aria-hidden', 'true'); $('days').append(bar);
      index = end + 1;
    }
  }
  function renderMonth() {
    const today = Model.day(state.now), start = weekStart();
    const detail = monthDetail(); document.body.dataset.detail = detail.density;
    if (sameSignature('month', [state.month, state.selectedDate, today, start, state.preferences, state.system.events, state.todos, state.mode, detail])) { layoutHolidayBars(); return; }
    $('days').setAttribute('aria-label', monthText(state.month) + '日期');
    $('weekdays').replaceChildren(...Array.from({ length: 7 }, (_, index) => {
      const value = (index + start) % 7;
      return el('span', value === 0 || value === 6 ? 'weekend' : '', WEEK[value]);
    }));
    preserveFocus($('days'), () => {
      const summaries = [];
      const days = Model.gridDays(state.month, start, today);
      const cells = days.map(item => {
        const classes = ['day'];
        if (!item.inMonth) classes.push('outside');
        if (item.weekend) classes.push('weekend');
        if (item.date === today) classes.push('today');
        if (item.date === state.selectedDate) classes.push('selected');
        const node = button(null, classes.join(' '));
        node.dataset.date = item.date;
        node.tabIndex = item.date === state.selectedDate ? 0 : -1;
        node.disabled = !Model.validDate(item.date);
        node.setAttribute('aria-pressed', String(item.date === state.selectedDate));
        if (item.date === today) node.setAttribute('aria-current', 'date');
        const header = el('span', 'day-header');
        const number = el('span', 'number', item.day);
        if (state.mode === 'desktop' && !item.inMonth && item.day === 1) {
          const label = el('span', 'month-boundary');
          label.append(el('span', '', Number(item.date.slice(5, 7)) + '月'), number, el('span', '', '日'));
          header.append(label);
        } else header.append(number);
        const arrangement = item.arrangement;
        const special = item.specials.filter(special => !arrangement || special.title !== arrangement.name).map(item => item.title).join(' · ');
        if (state.preferences.lunar) header.append(el('span', 'lunar', item.lunar.day === '初一' ? item.lunar.month : item.lunar.day));
        node.append(header);
        if (arrangement) {
          if (detail.holidayBars) node.append(el('span', 'holiday-slot'));
          else {
            const flag = el('span', 'holiday-day-status', arrangement.kind === 'rest' ? '休' : '班');
            flag.dataset.kind = arrangement.kind; flag.setAttribute('aria-hidden', 'true');
            const line = el('span', 'day-number-line'); line.append(header.firstElementChild, flag); header.prepend(line);
          }
        }
        if (special) node.append(el('span', 'special-tag', special));
        const items = dateItems(item.date), count = items.count;
        if (count) node.append(el('span', 'item-count', count + '项'));
        if (detail.rows) summaries.push(appendDayItems(node, items, detail.rows, item.date));
        node.setAttribute('aria-label', [dateText(item.date), weekday(item.date), item.date === today ? '今天' : '', state.preferences.lunar ? `农历${item.lunar.month}${item.lunar.day}` : '', special, arrangement ? arrangement.name + (arrangement.kind === 'rest' ? '，假期休息' : '，调休上班') : '', count ? `${count}项事项` : '无事项'].filter(Boolean).join('，'));
        return node;
      });
      if (!cells.some(node => node.tabIndex === 0)) cells.find(node => !node.disabled && !node.classList.contains('outside')).tabIndex = 0;
      $('days').replaceChildren(...cells);
      if (detail.holidayBars) { appendHolidayBars(days); layoutHolidayBars(); }
      summaries.forEach(fitDayItems);
    });
  }

  function calendarView() { return state.mode === 'desktop' && ['day', 'week', 'year'].includes(state.view) ? state.view : 'month'; }
  function renderCalendar() {
    const view = calendarView(), month = view === 'month';
    document.body.dataset.view = view;
    const rounded = state.preferences.monthRounded === true;
    document.body.dataset.monthCorners = rounded ? 'rounded' : 'square';
    const corners = $('month-corners'), cornerLabel = rounded ? '切换为直角日格' : '切换为圆角日格';
    corners.hidden = state.mode !== 'desktop' || !month;
    corners.setAttribute('aria-pressed', String(rounded)); corners.setAttribute('aria-label', cornerLabel); corners.dataset.tooltip = cornerLabel;
    corners.replaceChildren(icon(rounded ? 'corners-rounded' : 'corners-square'), el('span', '', rounded ? '圆角' : '直角'));
    $('view-switch').hidden = state.mode !== 'desktop';
    for (const node of $('view-switch').querySelectorAll('button')) node.setAttribute('aria-pressed', String(node.dataset.value === view));
    $('weekdays').hidden = !month; $('days').hidden = !month; $('calendar-detail-view').hidden = month;
    document.querySelector('.calendar-main').setAttribute('aria-label', ({ day: '日视图', week: '周视图', month: '月历', year: '年视图' })[view]);
    let title = monthText(state.month);
    if (view === 'day') title = `${monthText(state.selectedDate.slice(0, 7))}${parseDay(state.selectedDate).getDate()}日`;
    if (view === 'year') title = state.month.slice(0, 4) + '年';
    if (view === 'week') {
      const date = parseDay(state.selectedDate), offset = (date.getDay() - weekStart() + 7) % 7;
      date.setDate(date.getDate() - offset); const first = timestampDay(date.getTime());
      date.setDate(date.getDate() + 6); const last = timestampDay(date.getTime());
      title = first.slice(0, 7) === last.slice(0, 7) ? `${monthText(first.slice(0, 7))}${parseDay(first).getDate()}–${parseDay(last).getDate()}日` : `${first.replaceAll('-', '/')}–${last.slice(5).replace('-', '/')}`;
    }
    $('month-title').replaceChildren(document.createTextNode(title), icon('down'));
    const unit = ({ day: '天', week: '周', month: '月', year: '年' })[view];
    for (const [id, direction] of [['previous-month', -1], ['next-month', 1]]) {
      const label = (direction < 0 ? '上一' : '下一') + unit;
      $(id).setAttribute('aria-label', label); $(id).dataset.tooltip = label;
      let allowed;
      if (month) allowed = direction < 0 ? state.month > '1970-01' : state.month < '2100-12';
      else if (view === 'year') allowed = direction < 0 ? state.month.slice(0,4) > '1970' : state.month.slice(0,4) < '2100';
      else { try { allowed = Model.validDate(offsetDate(state.selectedDate, direction * (view === 'week' ? 7 : 1))); } catch (_) { allowed = false; } }
      $(id).disabled = !allowed;
    }
    if (month) { renderMonth(); return; }
    const range = $('calendar-detail-view');
    if (sameSignature('detail-view', [view, state.selectedDate, state.month, state.now, state.system.events, state.system.calendars, state.todos, state.preferences])) return;
    window.QiuCalendarViews.render({ container: range, view, date: state.selectedDate, month: state.month, now: state.now,
      events: state.system.events, todos: state.todos, preferences: state.preferences, calendars: state.system.calendars, weekStart: weekStart(),
      onPreview: openItemPreview,
      onSelectDate: async (date, targetView) => { await act('select-date', date); if (targetView && targetView !== calendarView()) await act('view', targetView); } });
  }

  function renderDate() {
    const today = Model.day(state.now), date = state.selectedDate;
    setText('date-context', date === today ? '今天' : '所选日期');
    $('selected-title').replaceChildren(document.createTextNode(dateText(date)), el('small', '', weekday(date)));
    const lunar = state.preferences.lunar ? `农历${fullLunar(date)}` : '';
    const special = specialText(date);
    setText('selected-lunar', [lunar, special].filter(Boolean).join(' · '));
    $('selected-lunar').hidden = !lunar && !special;
    setText('schedule-title', date === today ? '今日日程' : '当日日程');
    setText('todos-title', date === today ? '今日待办' : '当日待办');
  }
  function weatherText() {
    const weather = state.weather;
    if (Number.isFinite(weather.temperature)) {
      const stale = ['stale', 'error'].includes(weather.status);
      const updated = Number.isFinite(weather.updatedAt) && Number.isFinite(new Date(weather.updatedAt).getTime());
      return { temperature: Math.round(weather.temperature) + '°', condition: weather.condition || '当前天气',
        detail: stale ? (updated ? `上次更新 ${timeText(weather.updatedAt)}` : '上次天气') : Number.isFinite(weather.feelsLike) ? `体感 ${Math.round(weather.feelsLike)}°` : '' };
    }
    if (weather.status === 'loading') return { temperature: '—', condition: '正在获取', detail: '' };
    if (!weather.city || ['unconfigured', 'disabled'].includes(weather.status)) return { temperature: '—', condition: '设置城市', detail: '查看今日天气' };
    return { temperature: '—', condition: '暂时无法获取', detail: '点击重试' };
  }
  function renderWeather() {
    $('weather').hidden = state.preferences.weather === false;
    const value = weatherText();
    setText('weather-city', state.weather.city);
    setText('weather-temperature', value.temperature);
    setText('weather-condition', value.condition);
    setText('weather-feels', value.detail);
    $('weather-feels').hidden = !value.detail;
    $('weather').setAttribute('aria-label', `今日天气，${state.weather.city || '尚未设置城市'}，${value.temperature}，${value.condition}，${value.detail}`);
  }
  function connectionContent(target, inSettings) {
    const system = state.system;
    target.classList.toggle('is-connected', state.preferences.showSystemCalendar !== false && system.status === 'granted' && !system.error);
    const connectButton = (label, action) => {
      const node = button(label, 'secondary connection-action', action);
      if (action === 'connect') node.setAttribute('aria-label', '连接系统日历');
      return node;
    };
    target.replaceChildren();
    target.hidden = false;
    if (state.preferences.showSystemCalendar === false) {
      target.append(el('p', '', '系统日历已隐藏'));
      if (!inSettings) target.append(connectButton('显示日历', 'show-system'));
      return;
    }
    if (system.connecting) { target.append(el('p', '', '正在连接系统日历…')); return; }
    if (system.status === 'granted') {
      if (system.error) {
        target.append(el('p', '', system.error), connectButton('重新读取', 'refresh'));
      } else if (inSettings) {
        target.append(el('p', '', system.calendars.length ? '日历来源' : '暂无可用日历'), connectButton('打开系统日历', 'system-calendar'));
      } else target.hidden = true;
      return;
    }
    if (system.status === 'not-determined') {
      target.append(el('p', '', inSettings ? '连接后选择日历来源' : '尚未连接系统日历'), connectButton(inSettings ? '连接日历' : '连接', 'connect'));
    } else if (system.status === 'denied' || system.status === 'restricted') {
      target.append(el('p', '', system.status === 'restricted' ? '系统限制了日历访问' : '尚未允许读取日历'), connectButton('系统设置', 'system-settings'));
    } else {
      target.append(el('p', '', system.status === 'unsupported' ? '当前系统暂不支持读取日历' : system.error || '系统日历暂时不可用'));
      if (system.status !== 'unsupported') target.append(connectButton('重试', 'refresh'));
    }
  }
  function eventRow(event, date, upcoming) {
    const row = el('article', 'event-row');
    row.dataset.eventId = event.id;
    row.dataset.eventStart = String(event.start); row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', (event.title || '日程') + '，双击或按回车预览');
    row.append(el('span', 'source-stripe'), el('time', 'event-time', eventTime(event, date)));
    const source = calendarFor(event);
    colorize(row, source?.color);
    const copy = el('div', 'event-copy'), title = el('div', 'event-title-line');
    title.append(el('span', 'event-title', event.title || '未命名日程'));
    if (event === upcoming) title.append(el('span', 'event-badge', event.start <= state.now && event.end > state.now ? '进行中' : '下一场'));
    copy.append(title);
    const details = [event.allDay ? null : eventTime(event, date, true), source?.title].filter(Boolean);
    if (details.length) copy.append(el('span', 'event-source', details.join(' · ')));
    row.append(copy);
    return row;
  }
  function renderEvents(items) {
    if (sameSignature('events', [items.events, state.system, state.selectedDate, state.now, expandedEvents, state.mode])) return;
    setText('schedule-count', items.events.length + '项');
    connectionContent($('connection-status'), false);
    const connected = state.preferences.showSystemCalendar !== false && state.system.status === 'granted';
    const max = state.mode === 'menu' ? 1 : 2;
    const upcoming = nextEvent(items, state.selectedDate);
    const first = upcoming ? items.events.indexOf(upcoming) : 0;
    const shown = expandedEvents ? items.events : items.events.slice(first, first + max);
    $('events').replaceChildren(...shown.map(item => eventRow(item, state.selectedDate, upcoming)));
    if (!items.events.length && connected && !state.system.error) {
      let message = state.system.refreshing ? '正在读取日程…' : '当天暂无日程';
      if (Array.isArray(state.preferences.selectedCalendarIds) && !state.preferences.selectedCalendarIds.length) message = '尚未选择显示的日历';
      $('events').append(empty(message));
    }
    $('events-more').hidden = items.events.length <= max;
    setText('events-more', expandedEvents ? '收起日程' : `查看全部${items.events.length}项`);
    $('events-more').setAttribute('aria-expanded', String(expandedEvents));
    $('events-truncated').hidden = !state.system.truncated;
  }
  function todoRow(todo, completed) {
    const row = el('div', 'todo-row' + (completed ? ' is-completed' : ''));
    row.dataset.todoId = todo.id;
    const check = button(null, 'todo-check' + (completed ? ' done' : ''));
    check.dataset.todoId = todo.id;
    check.dataset.action = 'toggle-todo';
    check.dataset.value = todo.id;
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(completed));
    check.setAttribute('aria-label', `${completed ? '恢复待办' : '完成待办'}：${todo.title || '未命名待办'}`);
    check.disabled = pendingTodos.has(todo.id);
    if (completed) {
      const svg = document.createElementNS(SVG_NS, 'svg'), path = document.createElementNS(SVG_NS, 'path');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', 'm5 12 4 4 10-10'); svg.append(path); check.append(svg);
    }
    const copy = el('span', 'todo-copy', todo.title || '未命名待办');
    if (!completed && Number.isFinite(todo.reminderAt) && ['pending', 'presented'].includes(todo.reminderState)) {
      const reminderDay = timestampDay(todo.reminderAt);
      if (reminderDay) copy.append(el('small', '', `${reminderDay === state.selectedDate ? '' : dateText(reminderDay) + ' '}${timeText(todo.reminderAt)} 提醒`));
    }
    row.append(check, copy);
    return row;
  }
  function renderTodos(items) {
    $('todos-section').hidden = state.preferences.showTodos === false;
    if (sameSignature('todos', [items.todos, items.completed, state.selectedDate, expandedTodos, state.mode, state.notesError, Array.from(pendingTodos)])) return;
    showMessage('notes-error', state.notesError);
    setText('todo-count', items.todos.length + '项未完成');
    const max = state.mode === 'menu' ? 2 : 3;
    preserveFocus($('todos'), () => {
      $('todos').replaceChildren(...(expandedTodos ? items.todos : items.todos.slice(0, max)).map(item => todoRow(item, false)));
    });
    if (!items.todos.length && !state.notesError) {
      const today = state.selectedDate === Model.day(state.now);
      $('todos').append(empty(items.completed.length ? (today ? '今天的待办都完成啦，辛苦了' : '这天的待办都完成了') : (today ? '今天还没有待办，慢慢安排就好' : '这天还没有待办')));
    }
    $('todos-more').hidden = items.todos.length <= max;
    setText('todos-more', expandedTodos ? '收起待办' : `查看全部${items.todos.length}项`);
    $('todos-more').setAttribute('aria-expanded', String(expandedTodos));
    $('completed-group').hidden = false;
    const chevron = icon('down'); chevron.classList.add('completed-chevron');
    $('completed-summary').replaceChildren(icon('check-circle'), el('span', 'completed-label', '已完成'), el('span', 'completed-count', `${items.completed.length}项`), chevron);
    preserveFocus($('completed'), () => $('completed').replaceChildren(...items.completed.map(item => todoRow(item, true))));
    if (!items.completed.length) $('completed').append(empty('当天暂无已完成待办'));
    $('new-todo').disabled = Boolean(state.notesError);
  }

  function renderSources() {
    const calendars = state.system.calendars, chosen = state.preferences.selectedCalendarIds;
    if (!sameSignature('sources', calendars)) {
      const focused = document.activeElement?.dataset.sourceId;
      $('calendar-sources').replaceChildren(...calendars.map(source => {
        const label = el('label', 'settings-row'), text = el('span', 'source-label');
        const dot = el('i', 'source-dot'); dot.setAttribute('aria-hidden', 'true'); colorize(dot, source.color);
        text.append(dot, document.createTextNode(source.title || '未命名日历'));
        const input = el('input', 'source-checkbox'); input.type = 'checkbox'; input.dataset.sourceId = source.id;
        input.setAttribute('aria-label', source.title || '未命名日历'); label.append(text, input); return label;
      }));
      if (focused) $('calendar-sources').querySelector(`[data-source-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }
    for (const input of $('calendar-sources').querySelectorAll('input')) input.checked = chosen == null || chosen.includes(input.dataset.sourceId);
    $('calendar-sources').hidden = state.preferences.showSystemCalendar === false || state.system.status !== 'granted';
  }
  function renderSettings() {
    for (const input of document.querySelectorAll('[data-preference]')) {
      const value = state.preferences[input.dataset.preference];
      if (input.type === 'checkbox') input.checked = value !== false;
      else input.value = value || 'system';
    }
    $('setting-menu-date').disabled = !state.preferences.menuEnabled;
    const formats = [$('setting-menu-solar'), $('setting-menu-lunar'), $('setting-menu-weekday')];
    $('menu-date-options').hidden = !state.preferences.menuEnabled || !state.preferences.menuDate;
    for (const input of formats) input.disabled = !state.preferences.menuEnabled || !state.preferences.menuDate;
    for (const input of document.querySelectorAll('[data-time-preference]')) {
      input.value = state.preferences[input.dataset.timePreference] || '09:00';
      input.querySelector('.time-value').textContent = input.value;
      input.disabled = state.preferences.timeReminders === false;
    }
    $('setting-reminder-weekdays').disabled = state.preferences.timeReminders === false;
    $('setting-pin').checked = state.pinned;
    connectionContent($('settings-connection'), true);
    renderSources();
    if (!$('widget-options').children.length) {
      $('widget-options').replaceChildren(...WIDGETS.map(item => {
        const row = el('section', 'widget-option'); row.dataset.widgetType = item.type;
        const preview = el('div', 'widget-preview'); preview.setAttribute('aria-hidden', 'true');
        preview.append(item.icon ? icon(item.icon) : document.createTextNode(String(parseDay(Model.day(state.now)).getDate())));
        const info = el('div', 'widget-option-info');
        info.append(el('h3', '', item.title), el('p', '', item.copy));
        const controls = el('div', 'widget-option-controls');
        const enabledLabel = el('label'), enabled = el('input', 'switch');
        enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch'); enabled.dataset.widgetEnabled = item.type;
        enabled.setAttribute('aria-label', `显示${item.title}组件`); enabledLabel.append(enabled, document.createTextNode('显示'));
        const pinnedLabel = el('label'), pinned = el('input'); pinned.type = 'checkbox'; pinned.dataset.widgetPinned = item.type;
        pinned.setAttribute('aria-label', `${item.title}组件置顶`); pinnedLabel.append(pinned, document.createTextNode('置顶'));
        controls.append(enabledLabel, pinnedLabel); info.append(controls); row.append(preview, info); return row;
      }));
    }
    for (const item of WIDGETS) {
      const setting = state.preferences.widgets?.[item.type] || {};
      const enabled = document.querySelector(`[data-widget-enabled="${item.type}"]`);
      const pinned = document.querySelector(`[data-widget-pinned="${item.type}"]`);
      enabled.checked = setting.enabled === true;
      pinned.checked = setting.pinned === true;
      pinned.disabled = !setting.enabled;
    }
    setText('widget-error', state.error);
  }

  function widgetDateLine(today) {
    const line = el('div', 'widget-date-line');
    line.append(el('span', 'widget-date-number', parseDay(today).getDate()));
    const stacked = (text, className) => {
      const node = el('span', `widget-date-meta ${className}`);
      for (const character of text) node.append(el('span', '', character));
      return node;
    };
    if (state.preferences.lunar) {
      const lunar = stacked(Model.lunar(today).day, 'widget-date-lunar');
      lunar.title = fullLunar(today); line.append(lunar);
    }
    line.append(stacked(weekday(today), 'widget-date-weekday'));
    line.title = `${dateText(today)} ${weekday(today)}${state.preferences.lunar ? ' · ' + fullLunar(today) : ''}`;
    return line;
  }
  function widgetSpecial(today) {
    const special = specialText(today);
    return special ? el('span', 'widget-special', special) : null;
  }
  function widgetAgendaRow(event, date, interactive = false) {
    const row = interactive ? button(null, 'widget-agenda-row', 'desktop-date', date) : el('span', 'widget-agenda-row');
    colorize(row, calendarFor(event)?.color);
    row.append(el('strong', '', event.title || '未命名日程'), el('small', '', eventTime(event, date, true)));
    row.title = [event.title, eventTime(event, date, true), calendarFor(event)?.title].filter(Boolean).join(' · ');
    row.dataset.date = date;
    return row;
  }
  function smallAgendaGroups(events, date) {
    const groups = new Map();
    for (const event of events) {
      const key = [event.allDay === true, event.start, event.end].join('/');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    return [...groups.values()].map(items => {
      const row = widgetAgendaRow(items[0], date), time = row.lastElementChild;
      row.firstElementChild.remove();
      for (const event of items) row.insertBefore(el('strong', '', event.title || '未命名日程'), time);
      row.dataset.eventCount = String(items.length);
      row.title = items.map(event => [event.title || '未命名日程', eventTime(event, date, true), calendarFor(event)?.title].filter(Boolean).join(' · ')).join('\n');
      return row;
    });
  }
  function widgetTodoCount(count) {
    const node = el('span', 'widget-bottom widget-todo-count');
    node.append(icon('bell'), document.createTextNode(`今日 ${count} 项待办`)); return node;
  }
  function upcoming() {
    const today = Model.day(state.now);
    for (let index = 0; index < 7; index++) {
      const date = offsetDate(today, index);
      const event = dateItems(date).events.find(item => item.allDay || item.end > state.now || item.start >= state.now);
      if (event) return { date, event };
    }
    return null;
  }
  function widgetUnavailable() {
    if (state.preferences.showSystemCalendar === false) return '系统日历已隐藏';
    if (state.system.connecting || state.system.refreshing) return '正在读取日程…';
    if (state.system.status === 'not-determined') return '连接后查看日程';
    if (['denied', 'restricted'].includes(state.system.status)) return '尚未允许读取日历';
    if (state.system.status !== 'granted' || state.system.error) return '日历暂时不可用';
    if (Array.isArray(state.preferences.selectedCalendarIds) && !state.preferences.selectedCalendarIds.length) return '尚未选择日历';
    return '近期暂无日程';
  }
  function widgetOpen(date, className = 'widget-open') {
    const node = button(null, className, 'desktop-date', date);
    node.setAttribute('aria-label', `打开${dateText(date)}日历`); return node;
  }
  function renderWidgetMonth(today) {
    const box = el('div', 'widget-month'), header = el('div', 'widget-month-header');
    const title = button(monthText(state.month), 'widget-month-title', 'desktop-date', state.month + '-01');
    const move = el('span', 'widget-month-move');
    for (const [action, symbol, label] of [['previous-month', 'left', '上一月'], ['next-month', 'right', '下一月']]) {
      const node = button(null, 'icon-button', action); node.append(icon(symbol)); node.setAttribute('aria-label', label);
      node.disabled = action === 'previous-month' ? state.month <= '1970-01' : state.month >= '2100-12'; move.append(node);
    }
    header.append(title, move);
    const weekdays = el('div', 'widget-week'), grid = el('div', 'widget-grid');
    const start = weekStart();
    for (let index = 0; index < 7; index++) weekdays.append(el('span', '', WEEK[(index + start) % 7]));
    const days = Model.gridDays(state.month, start, today);
    let length = 42;
    // A small month keeps complete weeks while allowing five-row months more breathing room.
    if (!days[35].inMonth) length = 35;
    grid.dataset.rows = String(length / 7);
    for (const day of days.slice(0, length)) {
      if (!day.inMonth) { grid.append(el('span')); continue; }
      const node = button(day.day, `widget-day${day.weekend ? ' weekend' : ''}${day.date === today ? ' is-today' : ''}`, 'desktop-date', day.date);
      node.dataset.date = day.date;
      node.setAttribute('aria-label', `${dateText(day.date)}，${weekday(day.date)}${day.date === today ? '，今天' : ''}`);
      if (day.date === today) node.setAttribute('aria-current', 'date'); grid.append(node);
    }
    box.append(header, weekdays, grid); return box;
  }
  function renderWidget() {
    const today = Model.day(state.now), type = state.widgetType || 'month';
    $('widget-surface').dataset.type = type;
    $('widget-pin').setAttribute('aria-pressed', String(state.pinned));
    $('widget-pin').dataset.tooltip = state.pinned ? '取消组件置顶' : '组件置顶';
    if (sameSignature('widget', [type, state.month, today, state.system, state.todos, state.preferences, state.weather, Math.floor(state.now / 60000)])) return;
    let content;
    if (type === 'month') content = renderWidgetMonth(today);
    else if (type === 'date') {
      content = widgetOpen(today);
      const heading = el('span', 'widget-date-head', weekday(today)); heading.append(el('small', '', parseDay(today).getMonth() + 1 + '月'));
      const main = el('span', 'widget-date-main'); main.append(el('span', 'widget-date-large', parseDay(today).getDate()));
      if (state.preferences.lunar) main.append(el('span', 'widget-lunar-vertical', fullLunar(today)));
      content.append(heading, main);
    } else if (type === 'agenda') {
      const next = upcoming(); content = widgetOpen(next?.date || today);
      content.append(widgetDateLine(today));
      const special = widgetSpecial(today); if (special) content.append(special);
      if (next) {
        const candidates = dateItems(next.date).events.filter(event => event.allDay || event.end > state.now || event.start >= state.now);
        if (next.date !== today) content.append(el('span', 'widget-label', `${dateText(next.date)} ${weekday(next.date)}`));
        for (const row of smallAgendaGroups(candidates, next.date).slice(0, 4)) content.append(row);
      } else content.append(el('span', 'widget-empty-area', widgetUnavailable()));
      const count = dateItems(today).todos.length;
      if (state.preferences.showTodos && count) content.append(widgetTodoCount(count));
    } else {
      content = el('div', 'widget-open widget-wide');
      const left = widgetOpen(today, 'widget-wide-left'), right = el('span', 'widget-wide-right');
      left.append(widgetDateLine(today));
      const special = widgetSpecial(today); if (special) left.append(special);
      const items = dateItems(today), tomorrow = offsetDate(today, 1), tomorrowItems = dateItems(tomorrow);
      const remaining = items.events.filter(event => event.allDay || event.end > state.now || event.start >= state.now);
      const count = items.todos.length;
      const showTodoPreview = state.preferences.showTodos && count > 0;
      const showLeftExtra = !showTodoPreview && !special && remaining.length > 3;
      if (state.preferences.weather && Number.isFinite(state.weather.temperature)) {
        const weather = el('span', 'widget-weather'); weather.append(icon('weather'), document.createTextNode(`${Math.round(state.weather.temperature)}° ${state.weather.condition}`));
        if (['stale', 'error'].includes(state.weather.status)) weather.append(el('small', '', '上次'));
        left.append(weather);
      }
      if (showLeftExtra) { const extra = widgetAgendaRow(remaining[3], today); extra.classList.add('widget-extra'); left.append(extra); }
      if (showTodoPreview) {
        const preview = el('span', 'widget-todo-preview'), check = el('span', 'widget-mini-check'); check.setAttribute('aria-hidden', 'true');
        const title = items.todos[0].title || '未命名待办'; preview.title = title;
        preview.append(check, el('span', 'widget-mini-title', title)); left.append(preview);
      }
      if (state.preferences.showTodos && count) left.append(widgetTodoCount(count));
      if (state.preferences.showSystemCalendar === false || state.system.status !== 'granted' || state.system.error || (!remaining.length && !tomorrowItems.events.length)) {
        right.append(el('span', 'widget-empty-area', widgetUnavailable()));
        const expand = widgetOpen(today, 'widget-expand'); expand.textContent = '打开日历'; right.append(expand);
      } else {
        if (remaining.length >= 2) {
          right.append(el('span', 'widget-label', '今天'));
          for (const event of remaining.slice(0, 3)) right.append(widgetAgendaRow(event, today, true));
          if (remaining.length > 3 + Number(showLeftExtra)) right.append(el('span', 'widget-bottom widget-other', `其他 ${remaining.length - 3 - Number(showLeftExtra)} 项日程`));
          else if (tomorrowItems.events.length) right.append(el('span', 'widget-bottom', `明天 ${tomorrowItems.events.length} 项日程`));
        } else {
          if (remaining.length) right.append(el('span', 'widget-label', '今天'), widgetAgendaRow(remaining[0], today, true));
          else right.append(el('span', 'widget-label', '今天暂无后续日程'));
          right.append(el('span', 'widget-label widget-subgroup', '明天'));
          if (tomorrowItems.events.length) {
            right.append(widgetAgendaRow(tomorrowItems.events[0], tomorrow, true));
            if (tomorrowItems.events.length > 1) right.append(el('span', 'widget-bottom widget-other', `其他 ${tomorrowItems.events.length - 1} 项日程`));
          } else right.append(el('span', 'widget-empty', '暂无日程'));
        }
      }
      content.append(left, right);
    }
    preserveFocus($('widget-body'), () => $('widget-body').replaceChildren(content));
    if (type === 'agenda') {
      const rows = Array.from(content.querySelectorAll('.widget-agenda-row'));
      const footer = content.querySelector('.widget-todo-count');
      // The footer already includes its own padding; reserving another gap can
      // discard a second row that fits above the actual bell/count footer.
      const limit = content.getBoundingClientRect().bottom - (footer ? footer.getBoundingClientRect().height : 0);
      while (rows.length > 1 && rows.at(-1).getBoundingClientRect().bottom > limit) rows.pop().remove();
      const first = rows[0];
      if (first) {
        const titles = Array.from(first.querySelectorAll('strong'));
        while (titles.length > 1 && first.getBoundingClientRect().bottom > limit) titles.pop().remove();
      }
    }
  }

  function previewEvent(target) {
    if (state.preferences.showSystemCalendar === false || state.system.status !== 'granted') return null;
    const chosen = state.preferences.selectedCalendarIds;
    return state.system.events.find(event => event.id === target.id && event.start === target.start && (!Array.isArray(chosen) || chosen.includes(event.calendarId)));
  }
  function closeItemPreview() {
    previewTarget?.anchor?.classList.remove('preview-active');
    previewTarget = null;
    const popup = $('item-preview'); if (popup.matches(':popover-open')) popup.hidePopover();
    popup.replaceChildren();
  }
  function openItemPreview(target) {
    if (!state || !target?.anchor?.isConnected) return;
    const event = target.kind === 'event' ? previewEvent(target) : null;
    if (target.kind === 'event' && !event || target.kind === 'todos' && !Model.validDate(target.date)) return;
    if (target.kind === 'todos' && (state.preferences.showTodos === false || state.notesError)) return;
    closeTimePicker(false); closeDatePicker(false);
    previewTarget?.anchor?.classList.remove('preview-active'); previewTarget = target; target.anchor.classList.add('preview-active');
    const popup = $('item-preview'), heading = el('header', 'item-preview-header');
    popup.style.removeProperty('--event-color');
    const title = el('h2', '', event ? event.title || '未命名日程' : dateText(target.date) + '待办');
    const close = button('', 'icon-button'); close.setAttribute('aria-label', '关闭预览'); close.append(icon('close')); close.addEventListener('click', closeItemPreview);
    heading.append(title, close); const content = el('div', 'item-preview-content'); content.append(heading); popup.replaceChildren(content);
    const field = (label, value) => {
      if (value == null || value === '') return;
      const row = el('section', 'item-preview-field'); row.append(el('span', 'item-preview-label', label), el('div', 'item-preview-value', value)); content.append(row);
    };
    if (event) {
      const format = value => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
      const last = event.allDay && event.end > event.start ? event.end - 1 : event.end;
      const same = format(event.start) === format(last);
      field('时间', event.allDay ? format(event.start) + (same ? '' : ' – ' + format(last)) + ' · 全天' : format(event.start) + ' ' + timeText(event.start) + ' – ' + (same ? '' : format(event.end) + ' ') + timeText(event.end));
      field('地点', event.location); field('日历', calendarFor(event)?.title);
      field('提醒', Array.isArray(event.reminderMinutes) ? event.reminderMinutes.map(minutes => minutes === 0 ? '开始时' : `开始前 ${Number(minutes.toFixed(2))} 分钟`).join('、') : '');
      field('组织者', event.organizer); field('备注', event.notes);
      colorize(popup, calendarFor(event)?.color); content.append(el('p', 'item-preview-footnote', '此日程为只读'));
    } else {
      const items = dateItems(target.date).todos;
      if (!items.length) content.append(empty('当天没有未完成待办'));
      for (const item of items) field('待办', item.title);
    }
    if (!popup.matches(':popover-open')) popup.showPopover();
    const anchor = target.anchor.getBoundingClientRect(), size = popup.getBoundingClientRect();
    let left = anchor.right + 10;
    if (left + size.width > innerWidth - 10) left = anchor.left >= size.width + 20 ? anchor.left - size.width - 10 : innerWidth - size.width - 10;
    const finalLeft = Math.max(10, Math.min(innerWidth - size.width - 10, left)), finalTop = Math.max(10, Math.min(innerHeight - size.height - 10, anchor.top));
    popup.style.left = `${finalLeft}px`; popup.style.top = `${finalTop}px`;
    popup.dataset.side = finalLeft >= (anchor.left + anchor.right) / 2 ? 'right' : 'left';
    popup.style.setProperty('--preview-width', `${size.width}px`); popup.style.setProperty('--preview-height', `${size.height}px`);
    popup.style.setProperty('--preview-arrow-y', `${Math.max(20, Math.min(size.height - 20, anchor.top + Math.min(anchor.height / 2, 32) - finalTop))}px`);
    reportModal();
  }
  $('item-preview').addEventListener('toggle', event => { if (event.newState === 'closed') { previewTarget?.anchor?.classList.remove('preview-active'); previewTarget = null; $('item-preview').replaceChildren(); } reportModal(); });
  const eventPreviewTarget = node => ({ kind: 'event', id: node.dataset.eventId, start: Number(node.dataset.eventStart), anchor: node });
  document.addEventListener('click', event => {
    if (event.target.closest('.cell-event[data-event-id]')) event.stopPropagation();
  }, true);
  document.addEventListener('dblclick', event => {
    const node = event.target.closest('.cell-event[data-event-id],.event-row[data-event-id]');
    if (node) { event.preventDefault(); openItemPreview(eventPreviewTarget(node)); }
  });
  document.addEventListener('keydown', event => {
    const node = event.target.closest('.event-row[data-event-id]');
    if (node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openItemPreview(eventPreviewTarget(node)); }
  });
  window.addEventListener('resize', closeItemPreview);

  function reportModal() {
    // Coalesce a dialog-to-dialog transition so a menu window never briefly loses its guard.
    queueMicrotask(() => {
      const open = Boolean(document.querySelector('dialog[open]')) || $('item-preview').matches(':popover-open');
      if (open !== modalReported) {
        modalReported = open;
        void act('modal-open', open, { quiet: true, ignoreState: true });
      }
    });
  }
  function openDialog(id) {
    closeItemPreview();
    closeTimePicker(false);
    closeDatePicker(false);
    for (const node of document.querySelectorAll('dialog[open]')) if (node.id !== id) node.close();
    const dialog = $(id);
    if (!dialog.open) dialog.showModal();
    reportModal();
    renderFeedback();
  }
  function closeDialog(id) {
    closeTimePicker(false);
    closeDatePicker(false);
    const dialog = $(id); if (dialog.open) dialog.close();
    if (id === 'settings-dialog' || id === 'widgets-dialog') void act('page', 'calendar');
    reportModal();
    renderFeedback();
  }
  function applyState(snapshot) {
    if (!snapshot || !Model || !Model.validDate(snapshot.selectedDate)) return;
    state = snapshot;
    state.preferences ||= {};
    state.system ||= {};
    state.system.events ||= [];
    state.system.calendars ||= [];
    state.todos ||= [];
    state.weather ||= {};
    if (previewTarget && (!previewTarget.anchor.isConnected || previewTarget.kind === 'event' && !previewEvent(previewTarget) || previewTarget.kind === 'todos' && (state.preferences.showTodos === false || state.notesError || !dateItems(previewTarget.date).todos.length))) closeItemPreview();
    if (lastSelection !== state.selectedDate) {
      expandedEvents = false; expandedTodos = false;
      $('completed-group').open = false;
      lastSelection = state.selectedDate;
    }
    document.body.dataset.mode = state.mode;
    document.body.style.setProperty('--menu-anchor-x', Number.isFinite(state.menuAnchorX) ? `${state.menuAnchorX}px` : '50%');
    $('boot-status').hidden = true;
    $('calendar-shell').hidden = state.mode === 'widget';
    $('widget-surface').hidden = state.mode !== 'widget';
    $('desktop-open').hidden = state.mode !== 'menu';
    $('close').hidden = state.mode === 'desktop';
    $('refresh').disabled = state.system.refreshing || state.system.connecting;
    $('refresh').setAttribute('aria-busy', String(Boolean(state.system.refreshing || state.system.connecting)));
    $('pin').setAttribute('aria-pressed', String(Boolean(state.pinned)));
    $('pin').dataset.tooltip = state.pinned ? '取消窗口置顶' : '窗口置顶';
    if (state.mode === 'widget') renderWidget();
    else {
      renderCalendar(); renderDate(); renderWeather();
      const items = dateItems(state.selectedDate); renderEvents(items); renderTodos(items);
    }
    renderSettings();
    if (previewTarget && !previewTarget.anchor.isConnected) closeItemPreview();
    const page = state.page || 'calendar';
    if (page !== previousPage) {
      previousPage = page;
      if (page === 'settings') openDialog('settings-dialog');
      else if (page === 'widgets') openDialog('widgets-dialog');
      else for (const node of document.querySelectorAll('#settings-dialog[open],#widgets-dialog[open]')) node.close();
      reportModal();
    }
    renderFeedback();
  }

  function closeTimePicker(restore = true) {
    const trigger = timeTrigger; timeTrigger = null;
    if ($('time-picker').matches(':popover-open')) $('time-picker').hidePopover();
    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); if (restore && !trigger.disabled) trigger.focus({ preventScroll: true }); }
  }
  function activateSettingsTab(value) {
    if (!['display', 'sources', 'reminders'].includes(value)) return;
    closeTimePicker(false);
    for (const node of $('settings-tabs').querySelectorAll('[data-settings-tab]')) {
      const selected = node.dataset.settingsTab === value;
      node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('[data-settings-panel]')) panel.hidden = panel.dataset.settingsPanel !== value;
    $('settings-dialog').querySelector('.dialog-scroll').scrollTop = 0;
  }
  function positionPicker(picker, trigger) {
    const rect = trigger.getBoundingClientRect(), bounds = picker.getBoundingClientRect();
    picker.style.left = `${Math.max(10, Math.min(innerWidth - bounds.width - 10, rect.right - bounds.width))}px`;
    const top = rect.bottom + bounds.height + 8 < innerHeight ? rect.bottom + 7 : rect.top - bounds.height - 7;
    picker.style.top = `${Math.max(10, Math.min(innerHeight - bounds.height - 10, top))}px`;
  }
  function openTimePicker(trigger) {
    if (trigger.disabled) return;
    closeTimePicker(false); timeTrigger = trigger;
    const [hour, minute] = trigger.value.split(':');
    $('time-hour').value = hour; $('time-minute').value = minute;
    setText('time-picker-title', trigger.getAttribute('aria-label')); showMessage('time-picker-error', '');
    trigger.setAttribute('aria-expanded', 'true'); $('time-picker').showPopover();
    positionPicker($('time-picker'), trigger);
    $('time-hour').focus(); $('time-hour').select();
  }
  async function saveTimePicker() {
    if (!timeTrigger) return;
    const trigger = timeTrigger, hour = $('time-hour').value, minute = $('time-minute').value;
    if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute) || Number(hour) > 23 || Number(minute) > 59) {
      showMessage('time-picker-error', '小时填 0–23，分钟填 0–59'); return;
    }
    const value = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    $('time-picker-save').disabled = true;
    const result = await act('preferences', { [trigger.dataset.timePreference]: value });
    $('time-picker-save').disabled = false;
    if (result && !result.error) closeTimePicker();
    else showMessage('time-picker-error', result?.error || '时间尚未保存，请重试');
  }
  async function previewReminder(kind) {
    settingsToast = null;
    settingsNotice = '正在展示预览…'; renderFeedback();
    const result = await act(kind ? 'time-preview' : 'holiday-preview', kind);
    settingsNotice = result && !result.error ? '已在球球旁展示预览' : '';
    renderFeedback();
  }

  function closeDatePicker(restore = true) {
    if (!$('date-picker').matches(':popover-open')) return;
    $('date-picker').hidePopover(); $('todo-date-trigger').setAttribute('aria-expanded', 'false');
    if (restore) $('todo-date-trigger').focus({ preventScroll: true });
  }
  function renderDatePicker(focusDate) {
    const today = Model.day(state.now), selected = $('todo-date').value, start = weekStart();
    setText('date-picker-title', monthText(dateMonth));
    $('date-picker-previous').disabled = dateMonth <= '1970-01';
    $('date-picker-next').disabled = dateMonth >= '2100-12';
    $('date-picker-week').replaceChildren(...Array.from({ length: 7 }, (_, index) => el('span', '', WEEK[(index + start) % 7])));
    const focused = focusDate || (selected.startsWith(dateMonth) ? selected : dateMonth + '-01');
    $('date-picker-grid').replaceChildren(...Model.gridDays(dateMonth, start, today).map(item => {
      const node = button(item.day, `date-picker-day${item.inMonth ? '' : ' outside'}${item.date === today ? ' is-today' : ''}${item.date === selected ? ' is-selected' : ''}`);
      node.dataset.date = item.date; node.disabled = !Model.validDate(item.date); node.tabIndex = item.date === focused ? 0 : -1;
      node.setAttribute('aria-label', `${dateText(item.date)}，${weekday(item.date)}`);
      node.setAttribute('aria-pressed', String(item.date === selected));
      if (item.date === today) node.setAttribute('aria-current', 'date');
      return node;
    }));
    if (focusDate) $('date-picker-grid').querySelector(`[data-date="${CSS.escape(focusDate)}"]`)?.focus({ preventScroll: true });
  }
  function openDatePicker() {
    if ($('date-picker').matches(':popover-open')) { closeDatePicker(); return; }
    const selected = Model.validDate($('todo-date').value) ? $('todo-date').value : state.selectedDate;
    dateMonth = selected.slice(0, 7); renderDatePicker();
    $('date-picker').showPopover(); $('todo-date-trigger').setAttribute('aria-expanded', 'true');
    positionPicker($('date-picker'), $('todo-date-trigger'));
    $('date-picker-grid').querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }
  function chooseTodoDate(value) {
    if (value && !Model.validDate(value)) return;
    $('todo-date').value = value; updateTodoSave(); closeDatePicker();
  }
  function moveDatePickerMonth(direction) {
    const date = parseDay(dateMonth + '-01'); date.setMonth(date.getMonth() + direction);
    let month; try { month = Model.day(date).slice(0, 7); } catch (_) { return; }
    if (!Model.validDate(month + '-01')) return;
    dateMonth = month; renderDatePicker();
  }

  function changeMonth(direction) {
    if (state.mode === 'desktop') return act('navigate', direction);
    const date = parseDay(state.month + '-01'); date.setMonth(date.getMonth() + direction);
    const month = Model.day(date).slice(0, 7);
    if (month >= '1970-01' && month <= '2100-12') return act('month', month);
    return Promise.resolve(null);
  }
  function openTodo() {
    if (state.notesError) return;
    $('todo-title').value = ''; $('todo-date').value = state.selectedDate; setText('todo-error', '');
    updateTodoSave(); openDialog('todo-dialog'); $('todo-title').focus();
  }
  function updateTodoSave() {
    const title = $('todo-title').value.trim();
    $('todo-save').disabled = savingTodo || !title || Array.from(title).length > 200 || !Model.validDate($('todo-date').value);
    setText('todo-date-value', $('todo-date').value ? $('todo-date').value.replaceAll('-', '/') : '选择日期');
  }
  async function toggleTodo(id) {
    if (pendingTodos.has(id)) return;
    pendingTodos.add(id); renderTodos(dateItems(state.selectedDate));
    await act('toggle-todo', id);
    pendingTodos.delete(id); renderTodos(dateItems(state.selectedDate));
  }
  async function dispatch(action, value) {
    if (!state) return;
    if (action === 'previous-month') return changeMonth(-1);
    if (action === 'next-month') return changeMonth(1);
    if (action === 'toggle-todo') return toggleTodo(value);
    if (action === 'desktop-date') return act('desktop', { date: value });
    if (action === 'show-system') return act('preferences', { showSystemCalendar: true });
    if (action === 'calendar-view') return act('view', value);
    if (action === 'time-preview') return previewReminder(value);
    return act(action, value);
  }
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) { closeDialog(close.dataset.closeDialog); return; }
    const action = event.target.closest('[data-action]');
    if (action && !action.disabled) void dispatch(action.dataset.action, action.dataset.value);
  });
  $('days').addEventListener('click', event => {
    const cell = event.target.closest('button[data-date]');
    if (cell && !cell.disabled) void act('select-date', cell.dataset.date);
  });
  $('days').addEventListener('keydown', async event => {
    const cell = event.target.closest('button[data-date]');
    if (!cell) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let date;
    try {
      if (Object.hasOwn(moves, event.key)) date = offsetDate(cell.dataset.date, moves[event.key]);
      else if (event.key === 'Home' || event.key === 'End') {
        const offset = (parseDay(cell.dataset.date).getDay() - weekStart() + 7) % 7;
        date = offsetDate(cell.dataset.date, event.key === 'Home' ? -offset : 6 - offset);
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        const value = parseDay(cell.dataset.date), day = value.getDate();
        value.setDate(1); value.setMonth(value.getMonth() + (event.key === 'PageUp' ? -1 : 1));
        const last = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate(); value.setDate(Math.min(day, last)); date = Model.day(value);
      }
    } catch (_) { return; }
    if (!date || !Model.validDate(date)) return;
    event.preventDefault(); await act('select-date', date);
    $('days').querySelector(`[data-date="${date}"]`)?.focus({ preventScroll: true });
  });
  $('previous-month').addEventListener('click', () => void changeMonth(-1));
  $('next-month').addEventListener('click', () => void changeMonth(1));
  $('today').addEventListener('click', () => void act('today'));
  $('month-corners').addEventListener('click', () => void act('preferences', { monthRounded: state.preferences.monthRounded !== true }));
  $('refresh').addEventListener('click', () => void act('refresh'));
  $('pin').addEventListener('click', () => void act('pin', !state.pinned));
  $('close').addEventListener('click', () => void act('close'));
  $('desktop-open').addEventListener('click', () => void act('desktop', { date: state.selectedDate }));
  $('settings-open').addEventListener('click', () => void act('page', 'settings'));
  $('settings-tabs').addEventListener('click', event => {
    const tab = event.target.closest('[data-settings-tab]'); if (tab) activateSettingsTab(tab.dataset.settingsTab);
  });
  $('settings-tabs').addEventListener('keydown', event => {
    const tabs = Array.from($('settings-tabs').querySelectorAll('[data-settings-tab]')), current = tabs.indexOf(event.target);
    if (current < 0) return;
    let index;
    if (event.key === 'ArrowRight') index = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault(); activateSettingsTab(tabs[index].dataset.settingsTab); tabs[index].focus();
  });
  $('widget-manager-open').addEventListener('click', () => void act('page', 'widgets'));
  $('settings-widgets').addEventListener('click', () => void act('page', 'widgets'));
  $('widget-settings').addEventListener('click', () => void act('page', 'widgets'));
  $('widget-pin').addEventListener('click', () => void act('pin', !state.pinned));
  $('widget-close').addEventListener('click', () => void act('close'));
  $('weather').addEventListener('click', () => void act('weather'));
  $('holiday-preview').addEventListener('click', () => void previewReminder());
  for (const trigger of document.querySelectorAll('[data-time-preference]')) trigger.addEventListener('click', () => openTimePicker(trigger));
  $('time-picker-cancel').addEventListener('click', () => closeTimePicker());
  $('time-picker-save').addEventListener('click', () => void saveTimePicker());
  for (const input of [$('time-hour'), $('time-minute')]) input.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); const max = input.id === 'time-hour' ? 23 : 59;
      const current = Number(input.value);
      input.value = String(((Number.isInteger(current) ? current : 0) + (event.key === 'ArrowUp' ? 1 : max) + max + 1) % (max + 1)).padStart(2, '0');
    } else if (event.key === 'Enter') { event.preventDefault(); void saveTimePicker(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if ($('date-picker').matches(':popover-open')) { event.preventDefault(); event.stopImmediatePropagation(); closeDatePicker(); }
    else if (timeTrigger) { event.preventDefault(); event.stopImmediatePropagation(); closeTimePicker(); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (timeTrigger && !$('time-picker').contains(event.target) && !timeTrigger.contains(event.target)) closeTimePicker(false);
    if ($('date-picker').matches(':popover-open') && !$('date-picker').contains(event.target) && !$('todo-date-trigger').contains(event.target)) closeDatePicker(false);
  }, true);
  $('settings-dialog').querySelector('.dialog-scroll').addEventListener('scroll', () => closeTimePicker(false));
  window.addEventListener('resize', () => { closeTimePicker(false); closeDatePicker(false); });
  $('events-more').addEventListener('click', () => { expandedEvents = !expandedEvents; renderEvents(dateItems(state.selectedDate)); });
  $('todos-more').addEventListener('click', () => { expandedTodos = !expandedTodos; renderTodos(dateItems(state.selectedDate)); });
  $('new-todo').addEventListener('click', openTodo);
  $('todo-date-trigger').addEventListener('click', openDatePicker);
  $('date-picker-previous').addEventListener('click', () => moveDatePickerMonth(-1));
  $('date-picker-next').addEventListener('click', () => moveDatePickerMonth(1));
  $('date-picker-today').addEventListener('click', () => chooseTodoDate(Model.day(state.now)));
  $('date-picker-clear').addEventListener('click', () => chooseTodoDate(''));
  $('date-picker-grid').addEventListener('click', event => {
    const node = event.target.closest('button[data-date]'); if (node && !node.disabled) chooseTodoDate(node.dataset.date);
  });
  $('date-picker-grid').addEventListener('keydown', event => {
    const node = event.target.closest('button[data-date]'); if (!node) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let date;
    try {
      if (Object.hasOwn(steps, event.key)) date = offsetDate(node.dataset.date, steps[event.key]);
      else if (event.key === 'PageUp' || event.key === 'PageDown') {
        const current = parseDay(node.dataset.date), day = current.getDate(); current.setDate(1);
        current.setMonth(current.getMonth() + (event.key === 'PageUp' ? -1 : 1));
        current.setDate(Math.min(day, new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate())); date = Model.day(current);
      } else if (event.key === 'Home' || event.key === 'End') {
        const offset = (parseDay(node.dataset.date).getDay() - weekStart() + 7) % 7;
        date = offsetDate(node.dataset.date, event.key === 'Home' ? -offset : 6 - offset);
      } else return;
    } catch (_) { return; }
    event.preventDefault(); if (!Model.validDate(date)) return;
    dateMonth = date.slice(0, 7); renderDatePicker(date);
  });
  $('todo-title').addEventListener('input', updateTodoSave);
  $('todo-date').addEventListener('input', updateTodoSave);
  $('todo-form').addEventListener('submit', async event => {
    event.preventDefault(); updateTodoSave(); if ($('todo-save').disabled) return;
    const previousIds = new Set(state.todos.map(item => item.id));
    const dueDate = $('todo-date').value;
    savingTodo = true; updateTodoSave(); setText('todo-error', ''); setText('todo-save', '正在添加…');
    const result = await act('new-todo', { title: $('todo-title').value.trim(), dueDate });
    savingTodo = false; setText('todo-save', '添加待办'); updateTodoSave();
    if (!result || result.error) setText('todo-error', result?.error || '待办尚未添加，请重试');
    else {
      closeDialog('todo-dialog');
      if (state.selectedDate !== dueDate) await act('select-date', dueDate);
      expandedTodos = true; renderTodos(dateItems(state.selectedDate));
      const added = state.todos.find(item => !previousIds.has(item.id) && item.dueDate === dueDate);
      if (added) requestAnimationFrame(() => {
        const row = Array.from($('todos').children).find(node => node.dataset.todoId === added.id);
        row?.scrollIntoView({ block: 'nearest' });
      });
    }
  });
  function renderMonthPicker(focusMonth = false) {
    const year = $('month-year').value, valid = /^\d{4}$/.test(year) && Number(year) >= 1970 && Number(year) <= 2100;
    const selected = Number($('month-input').value.slice(5)), today = Model.day(state.now).slice(0, 7);
    showMessage('month-picker-error', valid ? '' : '请输入 1970–2100 年之间的年份');
    $('month-year').setAttribute('aria-invalid', String(!valid));
    $('month-year').disabled = savingMonth;
    $('month-year-previous').disabled = savingMonth || !valid || Number(year) <= 1970;
    $('month-year-next').disabled = savingMonth || !valid || Number(year) >= 2100;
    $('month-picker-current').disabled = savingMonth;
    $('month-picker-go').disabled = savingMonth || !valid;
    if (valid) $('month-input').value = year + '-' + String(selected).padStart(2, '0');
    $('month-picker-grid').replaceChildren(...Array.from({ length: 12 }, (_, index) => {
      const month = index + 1, value = year + '-' + String(month).padStart(2, '0');
      const node = button(month + '月', 'month-picker-month' + (valid && value === today ? ' is-current' : ''));
      node.dataset.month = String(month); node.disabled = savingMonth || !valid;
      node.setAttribute('aria-label', valid ? `${year}年${month}月` : `${month}月`);
      node.setAttribute('aria-pressed', String(month === selected)); node.tabIndex = month === selected ? 0 : -1;
      return node;
    }));
    if (focusMonth && valid) $('month-picker-grid').querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
  }
  function selectPickerMonth(month, focus = true) {
    $('month-input').value = $('month-year').value + '-' + String(month).padStart(2, '0');
    renderMonthPicker(focus);
  }
  $('month-title').addEventListener('click', () => {
    $('month-input').value = state.month; $('month-year').value = state.month.slice(0, 4);
    renderMonthPicker(); openDialog('month-dialog'); $('month-picker-grid').querySelector('[aria-pressed=true]')?.focus();
  });
  $('month-year').addEventListener('input', () => renderMonthPicker());
  for (const [id, amount] of [['month-year-previous', -1], ['month-year-next', 1]]) $(id).addEventListener('click', () => {
    $('month-year').value = String(Number($('month-year').value) + amount); renderMonthPicker();
  });
  $('month-picker-current').addEventListener('click', () => {
    $('month-input').value = Model.day(state.now).slice(0, 7); $('month-year').value = $('month-input').value.slice(0, 4); renderMonthPicker(true);
  });
  $('month-picker-grid').addEventListener('click', event => {
    const node = event.target.closest('[data-month]'); if (node && !node.disabled) selectPickerMonth(Number(node.dataset.month));
  });
  $('month-picker-grid').addEventListener('keydown', event => {
    const node = event.target.closest('[data-month]'); if (!node || node.disabled) return;
    const current = Number(node.dataset.month), moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    let month;
    if (Object.hasOwn(moves, event.key)) month = Math.max(1, Math.min(12, current + moves[event.key]));
    else if (event.key === 'Home') month = 1;
    else if (event.key === 'End') month = 12;
    else return;
    event.preventDefault(); selectPickerMonth(month);
  });
  $('month-form').addEventListener('submit', async event => {
    event.preventDefault(); const month = $('month-input').value;
    if (savingMonth || $('month-picker-go').disabled || !Model.validDate(month + '-01')) return;
    savingMonth = true; renderMonthPicker();
    let result;
    try { result = await act('month', month); }
    finally { savingMonth = false; renderMonthPicker(); }
    if (result && !result.error) closeDialog('month-dialog');
    else showMessage('month-picker-error', result?.error || '年月尚未切换，请重试');
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog.id); });
    dialog.addEventListener('close', reportModal);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog.id);
    });
  }
  document.addEventListener('change', async event => {
    const input = event.target;
    if (input.dataset.preference) {
      const patch = { [input.dataset.preference]: input.type === 'checkbox' ? input.checked : input.value };
      if (['menuDateSolar', 'menuDateLunar', 'menuDateWeekday'].includes(input.dataset.preference)
        && !document.querySelector('#menu-date-options input:checked')) {
        patch.menuDate = false;
        patch.menuDateSolar = true;
      }
      await act('preferences', patch);
      if (state) renderSettings();
    } else if (input.dataset.sourceId) {
      const ids = Array.from($('calendar-sources').querySelectorAll('input:checked'), node => node.dataset.sourceId);
      await act('sources', ids); if (state) renderSources();
    } else if (input.dataset.widgetEnabled) {
      const type = input.dataset.widgetEnabled;
      await act('widget', { type, enabled: input.checked, pinned: state.preferences.widgets?.[type]?.pinned === true });
      if (state) renderSettings();
    } else if (input.dataset.widgetPinned) {
      await act('widget', { type: input.dataset.widgetPinned, enabled: true, pinned: input.checked });
      if (state) renderSettings();
    }
  });
  $('setting-pin').addEventListener('change', event => void act('pin', event.target.checked));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && state?.mode === 'menu') { event.preventDefault(); void act('close'); }
  });
  window.addEventListener('focus', () => {
    // Weather opens a separate native window. Restore our own dialog guard on return.
    if (document.querySelector('dialog[open]')) void act('modal-open', true, { quiet: true, ignoreState: true });
  });

  document.documentElement.dataset.inputMode = 'pointer';
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.inputMode = 'pointer'; }, true);
  document.addEventListener('keydown', event => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'Tab' || event.key.startsWith('Arrow'))) document.documentElement.dataset.inputMode = 'keyboard';
  }, true);
  let resizeFrame;
  const resizeMonth = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (state && state.mode !== 'widget') renderCalendar(); }); };
  new ResizeObserver(resizeMonth).observe($('days'));
  window.addEventListener('resize', resizeMonth);
  const tooltip = $('calendar-tooltip'); let tooltipTimer;
  function hideTooltip() { clearTimeout(tooltipTimer); tooltip.hidden = true; }
  function showTooltip(target) {
    hideTooltip(); if (!target?.dataset.tooltip) return;
    tooltipTimer = setTimeout(() => {
      tooltip.textContent = target.dataset.tooltip; tooltip.hidden = false;
      const rect = target.getBoundingClientRect(), tip = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(6, Math.min(innerWidth - tip.width - 6, rect.left + (rect.width - tip.width) / 2))}px`;
      tooltip.style.top = `${rect.bottom + tip.height + 8 < innerHeight ? rect.bottom + 6 : Math.max(4, rect.top - tip.height - 6)}px`;
    }, 220);
  }
  for (const target of document.querySelectorAll('.icon-button[title]')) {
    target.dataset.tooltip = target.title; target.removeAttribute('title');
    target.addEventListener('pointerenter', () => showTooltip(target)); target.addEventListener('pointerleave', hideTooltip);
    target.addEventListener('focus', () => { if (document.documentElement.dataset.inputMode === 'keyboard') showTooltip(target); });
    target.addEventListener('blur', hideTooltip); target.addEventListener('click', hideTooltip);
  }

  if (!api || !Model) { setText('boot-status', '日历暂时无法打开，请重启球球后重试'); return; }
  api.onState(applyState);
  api.get().then(result => {
    if (!result) throw Error('No calendar state');
    applyState(result);
  }).catch(() => { setText('boot-status', '日历暂时无法打开，请重启球球后重试'); });
}());
