(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lib/calendar-model'));
  else root.QiuCalendarViews = factory(root.QiuCalendarModel);
}(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const mounts = new WeakMap();
  const pad = value => String(value).padStart(2, '0');
  const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  function startOfWeek(value) {
    if (value === 0 || value === 1) return value;
    if (value === 'monday') return 1;
    if (value === 'sunday') return 0;
    try { return new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).getWeekInfo().firstDay === 1 ? 1 : 0; } catch { return 0; }
  }
  function weekday(date) { return new Date(date + 'T12:00:00Z').getUTCDay(); }
  function clock(timestamp, withOffset = false) {
    const value = new Date(timestamp), label = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
    if (!withOffset) return label;
    const minutes = -value.getTimezoneOffset();
    return `${label} UTC${minutes < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
  }
  function render(options) {
    const { container, view, events = [], todos = [], preferences = {}, calendars = [], onSelectDate = () => {}, onPreview } = options || {};
    if (!container?.ownerDocument || !['day', 'week', 'year'].includes(view)) throw new TypeError('日历视图或容器无效');
    const date = options.date;
    if (!Model.validDate(date)) throw new RangeError('请选择 1970–2100 年之间的有效日期');
    const document = container.ownerDocument, now = Number.isFinite(options.now) ? options.now : Date.now();
    const weekStart = startOfWeek(options.weekStart ?? preferences.weekStart);
    const month = Model.validDate(options.month + '-01') ? options.month : date.slice(0, 7);
    let today = ''; try { today = Model.day(now); } catch { /* no today marker outside supported years */ }
    const select = (selected, targetView) => { if (Model.validDate(selected) && typeof onSelectDate === 'function') onSelectDate(selected, targetView); };
    const element = (tag, className, content) => {
      const node = document.createElement(tag); node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const button = (className, content, selected, targetView, preview) => {
      const node = element('button', className, content); node.type = 'button'; node.dataset.date = selected;
      node.disabled = !Model.validDate(selected);
      const showPreview = preview && typeof onPreview === 'function' ? () => {
        if (!node.disabled) onPreview({ ...preview, date: selected, anchor: node });
      } : null;
      node.addEventListener('click', event => {
        if (showPreview) {
          node.focus?.({ preventScroll: true });
          if (event.detail === 0) showPreview();
        } else select(selected, targetView);
      });
      if (showPreview) node.addEventListener('dblclick', event => {
        event.preventDefault?.(); event.stopPropagation?.(); showPreview();
      });
      return node;
    };
    const markDate = (node, selected) => {
      if (selected === today) { node.classList.add('is-today'); node.setAttribute('aria-current', 'date'); }
      if (selected === date) node.classList.add('is-selected');
      node.setAttribute('aria-pressed', String(selected === date));
    };
    const state = mounts.get(container) || { positions: new Map(), current: null };
    if (state.current) state.positions.set(state.current.key, { top: state.current.node.scrollTop, left: state.current.node.scrollLeft });
    const dates = view === 'week' ? Model.weekDays(date, weekStart) : [date];
    const key = view === 'year' ? 'year:' + month.slice(0, 4) : view + ':' + dates[0];
    const previous = state.positions.get(key);
    let scroll, body = null, allDayRow = null, header = null, layouts = [];

    if (view === 'year') {
      scroll = element('div', 'calendar-year-view');
      const year = Number(month.slice(0, 4)); scroll.setAttribute('aria-label', `${year}年日历`);
      for (let number = 1; number <= 12; number++) {
        const itemMonth = `${year}-${pad(number)}`, section = element('section', 'year-month');
        section.append(element('h3', 'year-month-title', `${number}月`));
        const weekdays = element('div', 'year-weekdays'); weekdays.setAttribute('aria-hidden', 'true');
        for (let index = 0; index < 7; index++) weekdays.append(element('span', '', WEEKDAYS[(index + weekStart) % 7].slice(1)));
        section.append(weekdays);
        const days = element('div', 'year-days');
        for (const item of Model.monthDates(itemMonth, weekStart)) {
          if (!item.inMonth) { const outside = element('span', 'year-date is-outside', String(item.day)); outside.setAttribute('aria-hidden', 'true'); days.append(outside); continue; }
          const node = button('year-date', String(item.day), item.date, 'day');
          node.setAttribute('aria-label', item.date + ' ' + WEEKDAYS[weekday(item.date)]); markDate(node, item.date); days.append(node);
        }
        section.append(days); scroll.append(section);
      }
      container.replaceChildren(scroll);
    } else {
      const root = element('div', 'calendar-time-view'); root.dataset.view = view;
      scroll = element('div', 'time-view-scroll');
      const grid = element('div', 'time-grid'); grid.style.setProperty('--view-days', String(dates.length));
      header = element('div', 'time-grid-header'); header.append(element('div', 'time-grid-gutter', '时间'));
      allDayRow = element('div', 'time-all-day'); allDayRow.append(element('div', 'time-all-day-label', '全天'));
      body = element('div', 'time-grid-body');
      const hours = element('div', 'time-hours'); hours.setAttribute('aria-hidden', 'true'); body.append(hours);
      const sources = new Map((Array.isArray(calendars) ? calendars : []).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
      const color = (node, event) => {
        const value = sources.get(event.calendarId)?.color;
        if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) node.style.setProperty('--event-color', value);
      };
      const titleOf = event => text(event.title, '未命名日程') || '未命名日程';
      for (const selected of dates) {
        const layout = Model.timeLayout(selected, events, todos, preferences); layouts.push(layout);
        const heading = button('time-date', undefined, selected, 'day'); markDate(heading, selected);
        heading.setAttribute('aria-label', selected + ' ' + WEEKDAYS[weekday(selected)] + '，打开日视图');
        heading.append(element('span', 'time-weekday', WEEKDAYS[weekday(selected)]), element('strong', 'time-date-number', String(Number(selected.slice(8)))));
        if (layout.minutes !== 1440) heading.append(element('small', 'time-dst-note', layout.minutes > 0 ? `${layout.minutes / 60}小时` : '日期跳过'));
        header.append(heading);
        const allDay = element('div', 'time-all-day-cell'); allDay.dataset.date = selected;
        for (const event of layout.allDay) {
          const node = button('time-all-day-event', titleOf(event), selected, undefined, { kind: 'event', id: event.id, start: event.start });
          node.dataset.eventId = event.id; node.dataset.eventStart = String(event.start); color(node, event);
          const source = text(sources.get(event.calendarId)?.title);
          node.setAttribute('aria-label', `${selected} 全天 ${titleOf(event)}${source ? '，' + source : ''}`); node.title = node.getAttribute('aria-label');
          allDay.append(node);
        }
        if (layout.todos.length) {
          const node = button('time-todo-summary', `${layout.todos.length} 项待办`, selected, undefined, { kind: 'todos' });
          node.setAttribute('aria-label', `${selected}，${layout.todos.length}项未完成待办，查看右侧列表`); allDay.append(node);
        }
        allDayRow.append(allDay);
        const column = element('div', 'time-day-column'); column.dataset.date = selected;
        if (selected === today) column.classList.add('is-today');
        if (layout.minutes !== 1440) column.classList.add('is-dst');
        for (const hour of layout.hours) {
          const line = element('div', 'time-hour-line'); line.style.setProperty('--hour-top', `${hour.top}%`); line.dataset.label = hour.label; column.append(line);
        }
        for (const item of layout.timed) {
          const event = item.event, start = clock(item.start, layout.minutes !== 1440), end = item.end === layout.end ? '24:00' : clock(item.end, layout.minutes !== 1440);
          const time = item.start === item.end ? start : `${start}–${end}`;
          const node = button('time-event', undefined, selected, undefined, { kind: 'event', id: event.id, start: event.start }); node.dataset.eventId = event.id; node.dataset.eventStart = String(event.start);
          if (item.durationMs < 30 * 60000) node.classList.add('is-short');
          if (item.continuesBefore) node.classList.add('continues-before');
          if (item.continuesAfter) node.classList.add('continues-after');
          for (const property of ['top', 'height', 'left', 'width']) node.style.setProperty('--event-' + property, `${item[property]}%`);
          color(node, event);
          node.append(element('span', 'time-event-time', time), element('strong', 'time-event-title', titleOf(event)));
          const source = text(sources.get(event.calendarId)?.title);
          node.setAttribute('aria-label', `${selected} ${time} ${titleOf(event)}${source ? '，' + source : ''}`); node.title = node.getAttribute('aria-label');
          column.append(node);
        }
        if (now >= layout.start && now < layout.end) {
          const line = element('div', 'time-now-line'); line.style.setProperty('--now-top', `${(now - layout.start) / (layout.end - layout.start) * 100}%`);
          line.setAttribute('aria-label', '当前时间 ' + clock(now)); column.append(line);
        }
        body.append(column);
      }
      for (const hour of layouts[0].hours) {
        const label = element('span', 'time-hour-label', hour.label); label.style.setProperty('--hour-top', `${hour.top}%`); hours.append(label);
      }
      grid.append(header, allDayRow, body); scroll.append(grid); root.append(scroll); container.replaceChildren(root);
    }
    state.current = { key, node: scroll }; mounts.set(container, state);
    if (state.positions.size > 60) state.positions.delete(state.positions.keys().next().value);
    if (previous) { scroll.scrollTop = previous.top; scroll.scrollLeft = previous.left; }
    else if (body) {
      let focus = layouts.find(item => now >= item.start && now < item.end), minute;
      if (focus) {
        const previousHour = focus.hours.filter(hour => hour.timestamp <= now).at(-2);
        minute = previousHour ? (previousHour.timestamp - focus.start) / 60000 : 0;
      }
      else {
        const upcoming = layouts.flatMap(item => item.timed.filter(event => event.end >= now).map(event => ({ layout: item, event }))).sort((a, b) => a.event.start - b.event.start)[0];
        focus = upcoming?.layout || layouts[0]; minute = upcoming ? Math.max(0, (upcoming.event.start - focus.start) / 60000 - 60) : 9 * 60;
      }
      const height = body.getBoundingClientRect?.().height || 1152;
      scroll.scrollTop = minute / (focus.minutes || 1440) * height;
    }
    return { view, dates, element: scroll };
  }
  return Object.freeze({ render });
}));
