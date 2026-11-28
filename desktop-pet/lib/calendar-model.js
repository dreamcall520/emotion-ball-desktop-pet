(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QiuCalendarModel = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN_YEAR = 1970, MAX_YEAR = 2100, DAY_MS = 86400000;
  const pad = value => String(value).padStart(2, '0');
  const dateLabel = (year, month, date) => `${year}-${pad(month)}-${pad(date)}`;
  const utcLabel = value => dateLabel(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());

  function parts(value, borders = false) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, date] = value.split('-').map(Number);
    if (year < MIN_YEAR - Number(borders) || year > MAX_YEAR + Number(borders) || month < 1 || month > 12 || date < 1 || date > 31) return null;
    const check = new Date(Date.UTC(year, month - 1, date));
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? { year, month, date } : null;
  }
  function validDate(value, allowEmpty = false) { return (allowEmpty && value === '') || parts(value) !== null; }
  function requireDate(value, borders = false) {
    const result = parts(value, borders);
    if (!result) throw new RangeError('请选择 1970–2100 年之间的有效日期');
    return result;
  }
  function day(time = Date.now()) {
    if (typeof time !== 'number' && !(time instanceof Date)) throw new TypeError('日期时间必须是时间戳或 Date');
    const value = new Date(time);
    if (!Number.isFinite(value.getTime()) || value.getFullYear() < MIN_YEAR || value.getFullYear() > MAX_YEAR) throw new RangeError('日期时间超出支持范围');
    return dateLabel(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  function monthStart(month, weekStart) {
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01')) throw new RangeError('请选择 1970–2100 年之间的有效月份');
    if (weekStart !== 0 && weekStart !== 1) throw new RangeError('周起始日必须为周日或周一');
    const { year, month: number } = parts(month + '-01');
    const first = Date.UTC(year, number - 1, 1), offset = (new Date(first).getUTCDay() - weekStart + 7) % 7;
    return first - offset * DAY_MS;
  }
  function midnight(utc) {
    const value = new Date(utc);
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()).getTime();
  }
  // Calendar labels advance by Gregorian date; timestamps use local midnight, including DST.
  function monthRange(month, weekStart = 0) {
    const first = monthStart(month, weekStart);
    return { start: midnight(first), end: midnight(first + 42 * DAY_MS) };
  }
  function monthDates(month, weekStart = 0) {
    const start = monthStart(month, weekStart);
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(start + index * DAY_MS), date = utcLabel(value), weekday = value.getUTCDay();
      return { date, day: value.getUTCDate(), inMonth: date.startsWith(month + '-'), weekend: weekday === 0 || weekday === 6 };
    });
  }
  function weekDays(date, weekStart = 0) {
    const { year, month, date: number } = requireDate(date);
    if (weekStart !== 0 && weekStart !== 1) throw new RangeError('周起始日必须为周日或周一');
    const current = Date.UTC(year, month - 1, number), offset = (new Date(current).getUTCDay() - weekStart + 7) % 7;
    return Array.from({ length: 7 }, (_, index) => utcLabel(new Date(current + (index - offset) * DAY_MS)));
  }
  // The full week may include disabled border dates outside the selectable years.
  function dayRange(date) {
    const { year, month, date: number } = requireDate(date, true);
    return { start: new Date(year, month - 1, number).getTime(), end: new Date(year, month - 1, number + 1).getTime() };
  }

  let chineseFormatter;
  const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
  const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const MONTH_NUMBERS = { 正月: 1, 一月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6, 七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 冬月: 11, 十二月: 12, 腊月: 12 };
  function lunarParts(date) {
    const value = requireDate(date, true);
    // Chinese calendar dates and solar terms use China Standard Time regardless of desktop TZ.
    const timestamp = Date.UTC(value.year, value.month - 1, value.date, 4);
    chineseFormatter ||= new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });
    const output = chineseFormatter.formatToParts(new Date(timestamp));
    const month = output.find(part => part.type === 'month')?.value || '';
    let number = MONTH_NUMBERS[month.replace(/^闰/, '')], dateNumber = Number(output.find(part => part.type === 'day')?.value), leap = month.startsWith('闰');
    // ICU 78 places this new moon one civil day late. The actual lunar month is Feb 6–Mar 7.
    // HKO: https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2027.pdf
    if (date >= '2027-02-06' && date <= '2027-03-07') { number = 1; dateNumber = 1 + Math.floor((timestamp - Date.UTC(2027, 1, 6, 4)) / DAY_MS); leap = false; }
    if (!number || !Number.isInteger(dateNumber) || dateNumber < 1 || dateNumber > 30) throw new Error('系统暂时无法换算农历');
    return { number, dateNumber, leap, month: (leap ? '闰' : '') + LUNAR_MONTHS[number - 1], day: LUNAR_DAYS[dateNumber - 1] };
  }
  function lunar(date) { requireDate(date); const result = lunarParts(date); return { month: result.month, day: result.day }; }

  const TERM_TITLES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  // Near-midnight cases where the low-order longitude approximation changes the civil day.
  // Dates verified against HKO's annual tables (1970–2100, 1975 not retrieved):
  // https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T2026c.txt (replace the year)
  const TERM_DATE_CORRECTIONS = { '1979-1': 21, '2014-4': 6, '2016-12': 7, '2045-12': 7, '2047-4': 6, '2051-5': 20, '2082-1': 20, '2097-8': 5 };
  const termCache = new Map();
  const sin = degrees => Math.sin(degrees * Math.PI / 180);
  // Solve the Sun's apparent longitude at 15-degree intervals. Low-order Meeus equations:
  // https://gml.noaa.gov/grad/solcalc/calcdetails.html and /grad/solcalc/main.js
  // The result is a calendar-day approximation, not an ephemeris for precise event times.
  function solarLongitude(timestamp) {
    const t = (timestamp / DAY_MS + 2440587.5 - 2451545) / 36525;
    const meanLongitude = 280.46646 + t * (36000.76983 + 0.0003032 * t);
    const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const center = sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * anomaly) * (0.019993 - 0.000101 * t) + sin(3 * anomaly) * 0.000289;
    return meanLongitude + center - 0.00569 - 0.00478 * sin(125.04 - 1934.136 * t);
  }
  function terms(year) {
    if (termCache.has(year)) return termCache.get(year);
    const result = new Map();
    for (let index = 0; index < 24; index++) {
      const month = Math.floor(index / 2), expectedDay = index % 2 ? 21 : 6, target = (285 + 15 * index) % 360;
      let low = Date.UTC(year, month, expectedDay - 5), high = Date.UTC(year, month, expectedDay + 5);
      for (let step = 0; step < 36; step++) {
        const middle = (low + high) / 2, delta = ((solarLongitude(middle) - target) % 360 + 540) % 360 - 180;
        if (delta < 0) low = middle; else high = middle;
      }
      const correctedDay = TERM_DATE_CORRECTIONS[`${year}-${index}`];
      const date = correctedDay ? dateLabel(year, month + 1, correctedDay) : utcLabel(new Date((low + high) / 2 + 8 * 3600000));
      result.set(date, TERM_TITLES[index]);
    }
    termCache.set(year, result);
    return result;
  }
  // Official mainland-China holiday arrangements; inclusive civil-date ranges.
  // 2026: 国办发明电〔2025〕7号, 2025-11-04.
  // https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
  // 2027: 国办发明电〔2026〕10号, dated 2026-11-05, official republication 2026-11-09.
  // https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml
  // A festival or an ordinary weekend alone does not imply an official rest/work adjustment.
  const HOLIDAY_ARRANGEMENTS = {
    2026: {
      source: 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
      periods: [
        { name: '元旦', start: '2026-01-01', end: '2026-01-03', work: ['2026-01-04'] },
        { name: '春节', start: '2026-02-15', end: '2026-02-23', work: ['2026-02-14', '2026-02-28'] },
        { name: '清明节', start: '2026-04-04', end: '2026-04-06', work: [] },
        { name: '劳动节', start: '2026-05-01', end: '2026-05-05', work: ['2026-05-09'] },
        { name: '端午节', start: '2026-06-19', end: '2026-06-21', work: [] },
        { name: '中秋节', start: '2026-09-25', end: '2026-09-27', work: [] },
        { name: '国庆节', start: '2026-10-01', end: '2026-10-07', work: ['2026-09-20', '2026-10-10'] }
      ]
    },
    2027: {
      source: 'https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml',
      periods: [
        { name: '元旦', start: '2027-01-01', end: '2027-01-03', work: [] },
        { name: '春节', start: '2027-02-05', end: '2027-02-13', work: ['2027-01-31', '2027-02-14'] },
        { name: '清明节', start: '2027-04-03', end: '2027-04-05', work: [] },
        { name: '劳动节', start: '2027-05-01', end: '2027-05-05', work: ['2027-05-08'] },
        { name: '端午节', start: '2027-06-09', end: '2027-06-09', work: [] },
        { name: '中秋节', start: '2027-09-15', end: '2027-09-15', work: [] },
        { name: '国庆节', start: '2027-10-01', end: '2027-10-07', work: ['2027-09-26', '2027-10-09'] }
      ]
    }
  };
  function arrangementForDate(date) {
    const schedule = HOLIDAY_ARRANGEMENTS[date.slice(0, 4)];
    if (!schedule) return null;
    for (const period of schedule.periods) {
      if (date >= period.start && date <= period.end) return { kind: 'rest', name: period.name, start: period.start, end: period.end, source: schedule.source };
      if (period.work.includes(date)) return { kind: 'work', name: period.name, start: date, end: date, source: schedule.source };
    }
    return null;
  }
  function holidayArrangement(date) { requireDate(date); return arrangementForDate(date); }

  const FIXED_HOLIDAYS = { '01-01': '元旦', '05-01': '劳动节', '10-01': '国庆节' };
  const LUNAR_HOLIDAYS = { '1-1': '春节', '1-15': '元宵节', '5-5': '端午节', '7-7': '七夕', '8-15': '中秋节', '9-9': '重阳节', '12-8': '腊八节' };
  function specialItems(date) {
    const { year, month, date: number } = requireDate(date, true), result = [];
    const term = terms(year).get(date);
    if (term) result.push({ type: 'term', title: term });
    const fixed = FIXED_HOLIDAYS[date.slice(5)];
    if (fixed) result.push({ type: 'holiday', title: fixed });
    const converted = lunarParts(date), holiday = !converted.leap && LUNAR_HOLIDAYS[`${converted.number}-${converted.dateNumber}`];
    if (holiday) result.push({ type: 'holiday', title: holiday });
    if (!converted.leap && converted.number === 12 && converted.dateNumber >= 29) {
      const next = lunarParts(utcLabel(new Date(Date.UTC(year, month - 1, number + 1))));
      if (!next.leap && next.number === 1 && next.dateNumber === 1) result.push({ type: 'holiday', title: '除夕' });
    }
    return result;
  }
  function specials(date) { requireDate(date); return specialItems(date); }
  function gridDays(month, weekStart = 0, today = day()) {
    const start = monthStart(month, weekStart);
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(start + index * DAY_MS), date = utcLabel(value), converted = lunarParts(date), weekday = value.getUTCDay();
      return { date, day: value.getUTCDate(), inMonth: date.startsWith(month + '-'), weekend: weekday === 0 || weekday === 6,
        today: date === today, lunar: { month: converted.month, day: converted.day }, specials: specialItems(date), arrangement: arrangementForDate(date) };
    });
  }

  function todoDate(todo) {
    if (!todo || typeof todo !== 'object') return null;
    if (todo.dueDate !== '' && todo.dueDate != null) return validDate(todo.dueDate) ? todo.dueDate : null;
    if (todo.completed !== true && !['pending', 'presented'].includes(todo.reminderState)) return null;
    if (typeof todo.reminderAt !== 'number' || !Number.isFinite(todo.reminderAt)) return null;
    try { return day(todo.reminderAt); } catch { return null; }
  }
  function usableId(item) { return item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0; }
  function latestTodos(todos) {
    const unique = new Map();
    for (const todo of todos) {
      if (!usableId(todo)) continue;
      const previous = unique.get(todo.id);
      if (!previous || (Number.isFinite(todo.updatedAt) ? todo.updatedAt : -Infinity) > (Number.isFinite(previous.updatedAt) ? previous.updatedAt : -Infinity)) unique.set(todo.id, todo);
    }
    return unique.values();
  }
  function dayItems(date, events, todos, preferences = {}) {
    const result = { events: [], todos: [], completed: [], count: 0 };
    // Border cells outside the selectable range are empty, including malformed date strings.
    if (!validDate(date)) return result;
    const { year, month, date: number } = parts(date), start = new Date(year, month - 1, number).getTime(), end = new Date(year, month - 1, number + 1).getTime();
    const selected = Array.isArray(preferences?.selectedCalendarIds) ? new Set(preferences.selectedCalendarIds) : null, seen = new Set();
    for (const event of preferences?.showSystemCalendar === false ? [] : Array.isArray(events) ? events : []) {
      if (!usableId(event) || event.deletedAt != null || event.archived === true || event.cancelled === true || event.canceled === true || ['cancelled', 'canceled'].includes(event.status)) continue;
      if (selected && !selected.has(event.calendarId)) continue;
      if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end < event.start) continue;
      // End is exclusive for all-day and timed events; zero-duration appointments belong to their start day.
      const overlaps = event.start === event.end ? event.start >= start && event.start < end : event.start < end && event.end > start;
      const occurrence = `${event.id}:${event.start}`;
      if (!overlaps || seen.has(occurrence)) continue;
      seen.add(occurrence); result.events.push(event);
    }
    result.events.sort((a, b) => Number(b.allDay === true) - Number(a.allDay === true) || a.start - b.start);
    if (preferences?.showTodos !== false) {
      for (const todo of latestTodos(Array.isArray(todos) ? todos : [])) {
        if (todo.deletedAt != null || todo.archived === true || todoDate(todo) !== date) continue;
        (todo.completed === true ? result.completed : result.todos).push(todo);
      }
      result.completed.sort((a, b) => (Number.isFinite(b.completedAt) ? b.completedAt : 0) - (Number.isFinite(a.completedAt) ? a.completedAt : 0));
    }
    result.count = result.events.length + result.todos.length;
    return result;
  }

  function timeLayout(date, events, todos, preferences = {}) {
    const { start, end } = dayRange(date), minutes = (end - start) / 60000, items = dayItems(date, events, todos, preferences), hours = [];
    // Advance real minutes, not setHours(): repeated and missing DST hours stay explicit.
    let previousOffset;
    for (let timestamp = start; timestamp < end; timestamp += 60000) {
      const value = new Date(timestamp), offset = value.getTimezoneOffset();
      if (timestamp === start || value.getMinutes() === 0 || previousOffset !== undefined && offset !== previousOffset)
        hours.push({ timestamp, label: `${pad(value.getHours())}:${pad(value.getMinutes())}`, top: (timestamp - start) / (end - start) * 100 });
      previousOffset = offset;
    }
    if (minutes > 0) hours.push({ timestamp: end, label: '24:00', top: 100 });
    const timed = items.events.filter(event => !event.allDay).map(event => {
      const clippedStart = Math.max(start, event.start), clippedEnd = Math.min(end, event.end);
      const layoutEnd = Math.min(end, Math.max(clippedEnd, clippedStart + 60000));
      return { event, start: clippedStart, end: clippedEnd, durationMs: clippedEnd - clippedStart,
        continuesBefore: event.start < start, continuesAfter: event.end > end,
        top: (clippedStart - start) / (end - start) * 100, height: (layoutEnd - clippedStart) / (end - start) * 100,
        layoutEnd, column: 0, columns: 1, left: 0, width: 100 };
    }).sort((a, b) => a.start - b.start || b.layoutEnd - a.layoutEnd);
    let group = [], groupEnd = -Infinity;
    const place = () => {
      const ends = [];
      for (const item of group) {
        let column = ends.findIndex(value => value <= item.start);
        if (column < 0) column = ends.length;
        ends[column] = item.layoutEnd; item.column = column;
      }
      for (const item of group) { item.columns = ends.length; item.width = 100 / ends.length; item.left = item.column * item.width; }
    };
    for (const item of timed) {
      if (item.start >= groupEnd) { place(); group = []; groupEnd = -Infinity; }
      group.push(item); groupEnd = Math.max(groupEnd, item.layoutEnd);
    }
    place();
    return { date, start, end, minutes, hours, allDay: items.events.filter(event => event.allDay), timed,
      todos: items.todos, completed: items.completed, count: items.count };
  }

  return Object.freeze({ day, validDate, monthRange, monthDates, weekDays, dayRange, gridDays, todoDate, dayItems, timeLayout, lunar, specials, holidayArrangement });
}));
