'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const calendar = require('../lib/calendar-model');
const notes = require('../lib/notes-model');
const local = (date, hour = 0, minute = 0) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, hour, minute).getTime(); };
const todo = (id, change = {}) => ({ ...notes.newTodo(id, local('2026-11-22', 10)), id, ...change });
const event = (id, change = {}) => ({ id, calendarId: 'actual-source-id', title: id, start: local('2026-11-22', 14), end: local('2026-11-22', 15), allDay: false, ...change });
const titles = date => calendar.specials(date).map(item => item.title);

test('strict date validation rejects normalization, coercion and dates outside 1970–2100', () => {
  for (const valid of ['1970-01-01', '2000-02-29', '2024-02-29', '2100-12-31']) assert.equal(calendar.validDate(valid), true, valid);
  for (const invalid of ['', '2026-02-29', '2026-02-30', '2100-02-29', '2026-04-31', '2026-13-01', '2026-11-00', '2026-1-01', '2026-11-22T00:00:00', '1969-12-31', '2101-01-01', null, undefined, 20261122, {}, true]) assert.equal(calendar.validDate(invalid), false, String(invalid));
  assert.equal(calendar.validDate('', true), true);
  assert.equal(calendar.validDate(null, true), false);
  assert.equal(calendar.day(local('2026-11-22', 22)), '2026-11-22');
  assert.equal(calendar.day(new Date(local('2026-11-22'))), '2026-11-22');
  for (const invalid of [NaN, Infinity, new Date('invalid'), local('2101-01-01')]) assert.throws(() => calendar.day(invalid), RangeError);
  for (const invalid of ['2026-02-30', null, true]) assert.throws(() => calendar.day(invalid), TypeError);
});

test('Sunday and Monday grids cover exactly 42 Gregorian dates with local exclusive ranges', () => {
  for (const [weekStart, start, end] of [[0, '2026-11-01', '2026-12-13'], [1, '2026-10-26', '2026-12-07']]) {
    const range = calendar.monthRange('2026-11', weekStart), grid = calendar.gridDays('2026-11', weekStart, '2026-11-22');
    assert.deepEqual(range, { start: local(start), end: local(end) });
    assert.equal(grid.length, 42); assert.equal(grid[0].date, start); assert.equal(new Set(grid.map(item => item.date)).size, 42);
    assert.equal(grid.filter(item => item.inMonth).length, 30); assert.equal(grid.filter(item => item.weekend).length, 12);
    assert.equal(grid.find(item => item.today).date, '2026-11-22');
    assert.deepEqual(grid.find(item => item.date === '2026-11-22').specials, [{ type: 'term', title: '小雪' }]);
  }
});

test('boundary years keep all border cells without accepting out-of-range selected dates', () => {
  for (const month of ['1970-01', '2100-12']) assert.equal(calendar.gridDays(month).length, 42);
  assert.equal(calendar.gridDays('1970-01')[0].date, '1969-12-28');
  assert.equal(calendar.gridDays('2100-12').at(-1).date, '2101-01-08');
  assert.deepEqual(calendar.dayItems('1969-12-31', [], []), { events: [], todos: [], completed: [], count: 0 });
  for (const month of ['2026-13', '2026-1', '2026-00', '1969-12', '2101-01', '', null]) assert.throws(() => calendar.monthRange(month), RangeError);
  assert.throws(() => calendar.gridDays('2026-11', 7), RangeError);
  assert.throws(() => calendar.monthRange('2026-11', '1'), RangeError);
});

test('lunar values use Beijing civil dates, distinguish leap months, and format readable day names', () => {
  assert.deepEqual(calendar.lunar('2026-11-22'), { month: '十月', day: '十四' });
  assert.deepEqual(calendar.lunar('2025-07-25'), { month: '闰六月', day: '初一' });
  assert.deepEqual(calendar.lunar('2025-08-22'), { month: '闰六月', day: '廿九' });
  assert.deepEqual(calendar.lunar('2025-08-23'), { month: '七月', day: '初一' });
  assert.throws(() => calendar.lunar('2026-02-30'), RangeError);
});

test('HKO 2027 month boundary stays correct across ICU versions, including New Year Eve', () => {
  assert.deepEqual(calendar.lunar('2027-02-05'), { month: '腊月', day: '廿九' });
  assert.deepEqual(calendar.lunar('2027-02-06'), { month: '正月', day: '初一' });
  assert.deepEqual(calendar.lunar('2027-03-07'), { month: '正月', day: '三十' });
  assert.deepEqual(calendar.lunar('2027-03-08'), { month: '二月', day: '初一' });
  assert.ok(titles('2027-02-05').includes('除夕'));
  assert.ok(titles('2027-02-06').includes('春节'));
  assert.equal(titles('2027-02-07').includes('春节'), false);
  assert.ok(titles('2027-02-20').includes('元宵节'));
});

test('solar terms match all 24 dates from the HKO 2026 calendar', () => {
  // Official dates: https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
  const expected = [
    ['01-05', '小寒'], ['01-20', '大寒'], ['02-04', '立春'], ['02-18', '雨水'], ['03-05', '惊蛰'], ['03-20', '春分'],
    ['04-05', '清明'], ['04-20', '谷雨'], ['05-05', '立夏'], ['05-21', '小满'], ['06-05', '芒种'], ['06-21', '夏至'],
    ['07-07', '小暑'], ['07-23', '大暑'], ['08-07', '立秋'], ['08-23', '处暑'], ['09-07', '白露'], ['09-23', '秋分'],
    ['10-08', '寒露'], ['10-23', '霜降'], ['11-07', '立冬'], ['11-22', '小雪'], ['12-07', '大雪'], ['12-22', '冬至']
  ];
  for (const [date, title] of expected) assert.ok(calendar.specials('2026-' + date).some(item => item.type === 'term' && item.title === title), date + ' ' + title);
  assert.equal(titles('2026-11-21').includes('小雪'), false);
  assert.equal(titles('2026-11-23').includes('小雪'), false);
});

test('near-midnight solar terms use HKO civil-day boundaries rather than the adjacent approximate day', () => {
  const expected = [
    ['1979-01-21', '1979-01-20', '大寒'], ['2014-03-06', '2014-03-05', '惊蛰'], ['2016-07-07', '2016-07-06', '小暑'],
    ['2045-07-07', '2045-07-06', '小暑'], ['2047-03-06', '2047-03-05', '惊蛰'], ['2051-03-20', '2051-03-21', '春分'],
    ['2082-01-20', '2082-01-19', '大寒'], ['2097-05-05', '2097-05-04', '立夏']
  ];
  for (const [date, adjacent, title] of expected) {
    assert.ok(calendar.specials(date).some(item => item.type === 'term' && item.title === title), date + ' ' + title);
    assert.equal(calendar.specials(adjacent).some(item => item.type === 'term' && item.title === title), false, adjacent + ' should not duplicate ' + title);
  }
});

test('traditional festivals have semantic labels without made-up holiday adjustments or marketing days', () => {
  assert.ok(titles('2026-02-17').includes('春节'));
  assert.ok(titles('2026-06-19').includes('端午节'));
  assert.ok(titles('2026-09-25').includes('中秋节'));
  assert.ok(titles('2026-10-01').includes('国庆节'));
  assert.deepEqual(calendar.specials('2026-11-11'), []);
  assert.equal(titles('2009-06-27').includes('端午节'), false, '闰五月初五不能再显示端午');
  for (const day of calendar.gridDays('2026-10')) for (const special of day.specials) assert.equal(/[休班]/.test(special.title), false);
});

test('official holiday arrangements distinguish whole rest periods from individual makeup workdays', () => {
  const source2026 = 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html';
  const source2027 = 'https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml';
  for (const date of ['2026-10-01', '2026-10-04', '2026-10-07']) assert.deepEqual(calendar.holidayArrangement(date),
    { kind: 'rest', name: '国庆节', start: '2026-10-01', end: '2026-10-07', source: source2026 });
  for (const date of ['2026-09-20', '2026-10-10']) assert.deepEqual(calendar.holidayArrangement(date),
    { kind: 'work', name: '国庆节', start: date, end: date, source: source2026 });
  assert.deepEqual(calendar.holidayArrangement('2027-02-13'),
    { kind: 'rest', name: '春节', start: '2027-02-05', end: '2027-02-13', source: source2027 });
  for (const date of ['2027-01-31', '2027-02-14']) assert.deepEqual(calendar.holidayArrangement(date),
    { kind: 'work', name: '春节', start: date, end: date, source: source2027 });
  assert.deepEqual(calendar.holidayArrangement('2027-06-09'),
    { kind: 'rest', name: '端午节', start: '2027-06-09', end: '2027-06-09', source: source2027 });
  assert.deepEqual(calendar.holidayArrangement('2027-09-15'),
    { kind: 'rest', name: '中秋节', start: '2027-09-15', end: '2027-09-15', source: source2027 });
  const changed = calendar.holidayArrangement('2026-10-01'); changed.kind = 'work'; changed.name = '不可污染后续查询';
  assert.equal(calendar.holidayArrangement('2026-10-01').kind, 'rest');
  assert.equal(calendar.holidayArrangement('2026-10-01').name, '国庆节');
});

test('official 2026 and 2027 schedules contain exactly their announced rest and makeup dates', () => {
  for (const [year, expectedRest, expectedWork, workDates] of [
    [2026, 33, 6, ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10']],
    [2027, 29, 5, ['01-31', '02-14', '05-08', '09-26', '10-09']]
  ]) {
    const rest = [], work = [], names = new Set();
    for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += 86400000) {
      const date = new Date(time).toISOString().slice(0, 10), item = calendar.holidayArrangement(date);
      if (!item) continue;
      assert.deepEqual(Object.keys(item).sort(), ['end', 'kind', 'name', 'source', 'start']);
      assert(item.start <= date && date <= item.end, date + ' lies in its inclusive arrangement interval');
      assert.match(item.source, /^https:\/\/(www\.beijing|chinajob\.mohrss)\.gov\.cn\//);
      assert(['rest', 'work'].includes(item.kind)); names.add(item.name);
      (item.kind === 'rest' ? rest : work).push(date);
    }
    assert.equal(rest.length, expectedRest); assert.equal(work.length, expectedWork);
    assert.deepEqual(work, workDates.map(date => year + '-' + date));
    assert.deepEqual([...names].sort(), ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'].sort());
  }
});

test('arrangement queries do not infer holidays from weekends, traditional festivals or unannounced years', () => {
  for (const [date, name] of [['2026-03-03', '元宵节'], ['2026-08-19', '七夕'], ['2027-02-20', '元宵节']]) {
    assert(titles(date).includes(name)); assert.equal(calendar.holidayArrangement(date), null, date);
  }
  for (const date of ['2026-02-01', '2026-02-24', '2026-09-28', '2026-10-08',
    '2027-02-04', '2027-06-08', '2027-06-10', '2027-09-14', '2027-09-16',
    '1970-01-01', '2025-10-01', '2025-12-31', '2027-12-31', '2028-01-01', '2100-10-01']) {
    assert.equal(calendar.holidayArrangement(date), null, date);
  }
  for (const date of ['2026-02-30', '2026-1-01', '1969-12-31', '2101-01-01', null, undefined, 20261001]) {
    assert.throws(() => calendar.holidayArrangement(date), RangeError);
  }
});

test('all grid days expose arrangements including adjacent-year cells without changing festival semantics', () => {
  for (const month of ['1970-01', '2026-09', '2026-10', '2026-12', '2027-01', '2027-02', '2100-12']) {
    const grid = calendar.gridDays(month, 1);
    assert.equal(grid.length, 42);
    for (const item of grid) {
      assert(Object.hasOwn(item, 'arrangement'));
      assert.deepEqual(item.arrangement, calendar.validDate(item.date) ? calendar.holidayArrangement(item.date) : null);
      if (calendar.validDate(item.date)) assert.deepEqual(item.specials, calendar.specials(item.date));
    }
  }
  const january = calendar.gridDays('2026-12', 1).find(item => item.date === '2027-01-01');
  assert.equal(january.inMonth, false); assert.equal(january.arrangement.name, '元旦');
  assert.equal(january.arrangement.kind, 'rest'); assert.equal(january.arrangement.end, '2027-01-03');
});

test('todo projection prefers a strict due date over reminder date and has no unscheduled fallback', () => {
  assert.equal(calendar.todoDate(todo('due', { reminderAt: local('2026-11-23', 9), reminderState: 'pending' })), '2026-11-22');
  assert.equal(calendar.todoDate(todo('reminder', { dueDate: '', reminderAt: local('2026-11-23', 9), reminderState: 'pending' })), '2026-11-23');
  assert.equal(calendar.todoDate(todo('presented', { dueDate: '', reminderAt: local('2026-11-23', 9), reminderState: 'presented' })), '2026-11-23');
  for (const change of [
    { dueDate: '' }, { dueDate: '', reminderAt: null }, { dueDate: '', reminderAt: String(local('2026-11-23')), reminderState: 'pending' },
    { dueDate: '', reminderAt: NaN, reminderState: 'pending' }, { dueDate: '', reminderAt: local('2026-11-23'), reminderState: 'dismissed' },
    { dueDate: '', reminderAt: local('2026-11-23'), reminderState: 'cancelled' }, { dueDate: '', reminderAt: local('2101-01-01'), reminderState: 'pending' },
    { dueDate: '2026-02-30', reminderAt: local('2026-11-23'), reminderState: 'pending' }, { dueDate: 20261122 }
  ]) assert.equal(calendar.todoDate(todo('invalid', change)), null);
  assert.equal(calendar.todoDate(null), null);
});

test('existing notes complete/cancel schema keeps the original projection in completed, outside count', () => {
  const pending = todo('real-schema', { dueDate: '', reminderAt: local('2026-11-22', 14), reminderState: 'pending' });
  const state = { schema: 2, revision: 0, categories: [], notes: [], todos: [pending] };
  notes.validate(state);
  const completed = notes.change(state, 'todo', pending.id, 'complete', local('2026-11-22', 14, 5)).todos[0];
  assert.equal(completed.reminderState, 'cancelled');
  assert.equal(calendar.todoDate(completed), '2026-11-22');
  const result = calendar.dayItems('2026-11-22', [], [completed]);
  assert.equal(result.count, 0); assert.deepEqual(result.todos, []); assert.deepEqual(result.completed, [completed]);
});

test('local store projections omit trash and archives, dedupe todo/reminder IDs, and respect source switches', () => {
  const a = todo('same', { reminderAt: local('2026-11-22', 9), reminderState: 'pending' });
  const done = todo('done', { completed: true, completedAt: local('2026-11-22', 12) });
  const list = [a, { ...a }, todo('deleted-zero', { deletedAt: 0 }), todo('deleted', { deletedAt: local('2026-11-22') }), todo('archived', { archived: true, completed: true }), done, todo('no-date', { dueDate: '' })];
  const result = calendar.dayItems('2026-11-22', [event('event')], list);
  assert.equal(result.count, 2); assert.deepEqual(result.todos.map(item => item.id), ['same']); assert.deepEqual(result.completed.map(item => item.id), ['done']);
  assert.equal(calendar.dayItems('2026-11-22', [event('event')], list, { selectedCalendarIds: [], showTodos: false }).count, 0);
  assert.equal(calendar.dayItems('2026-11-22', [event('event')], list, { selectedCalendarIds: [] }).count, 1);
  assert.equal(calendar.dayItems('2026-11-22', [event('event')], list, { showTodos: false }).count, 1);
});

test('newer todo copies supersede stale pending dates, completed or deleted records before projection', () => {
  const stale = todo('same', { updatedAt: 1 });
  for (const change of [{ dueDate: '2026-11-23' }, { completed: true, completedAt: 3 }, { deletedAt: 0 }]) {
    const newer = { ...stale, ...change, updatedAt: 2 };
    for (const input of [[stale, newer], [newer, stale]]) assert.equal(calendar.dayItems('2026-11-22', [], input).count, 0);
  }
});

test('system events span every intersecting date with exclusive end, zero-duration items and cancellation filtering', () => {
  const allDay = event('all-day', { start: local('2026-11-21'), end: local('2026-11-23'), allDay: true });
  const overnight = event('overnight', { start: local('2026-11-22', 23), end: local('2026-11-23', 1) });
  const midnightEnd = event('midnight', { start: local('2026-11-21', 23), end: local('2026-11-22') });
  const point = event('point', { start: local('2026-11-22'), end: local('2026-11-22') });
  const cancelled = ['cancelled', 'canceled'].flatMap(status => [event(status, { status }), event('flag-' + status, { [status]: true })]);
  const records = [overnight, allDay, { ...allDay }, midnightEnd, point, ...cancelled, event('backward', { end: local('2026-11-21') }), event('invalid', { start: NaN })];
  assert.deepEqual(calendar.dayItems('2026-11-22', records, []).events.map(item => item.id), ['all-day', 'point', 'overnight']);
  assert.deepEqual(calendar.dayItems('2026-11-23', records, []).events.map(item => item.id), ['overnight']);
  assert.equal(calendar.dayItems('2026-11-24', records, []).count, 0);
});

test('system source IDs, titles, colors and calendar fields are preserved without fixed work/personal categories', () => {
  const first = event('a', { calendarId: 'icloud-uuid', calendarTitle: '项目 α', color: '#a041cb' }), second = event('b', { calendarId: 'exchange-uuid', calendarTitle: '团队 β', color: '#fedcba' });
  assert.deepEqual(calendar.dayItems('2026-11-22', [first, second], [], { selectedCalendarIds: ['exchange-uuid'] }).events, [second]);
  assert.equal(calendar.dayItems('2026-11-22', [first, second], [], { selectedCalendarIds: null }).count, 2);
  assert.equal(calendar.dayItems('2026-11-22', [first, second], [], { selectedCalendarIds: [] }).count, 0);
});

test('recurring events retain distinct same-day occurrences and dedupe copies by id plus start', () => {
  const morning = event('recurring-series', { start: local('2026-11-22', 9), end: local('2026-11-22', 10), recurring: true });
  const afternoon = event('recurring-series', { start: local('2026-11-22', 15), end: local('2026-11-22', 16), recurring: true });
  const result = calendar.dayItems('2026-11-22', [afternoon, { ...morning }, morning, { ...afternoon }], []);
  assert.equal(result.count, 2);
  assert.deepEqual(result.events.map(item => item.start), [morning.start, afternoon.start]);
  assert.equal(calendar.dayItems('2026-11-23', [morning, afternoon], []).count, 0);
});

test('invalid inputs stay empty and projection does not mutate source arrays or records', () => {
  const records = Object.freeze([Object.freeze(event('later')), Object.freeze(event('earlier', { start: local('2026-11-22', 8), end: local('2026-11-22', 9) }))]);
  const todos = Object.freeze([Object.freeze(todo('todo'))]);
  calendar.dayItems('2026-11-22', records, todos);
  assert.equal(records[0].id, 'later'); assert.equal(todos[0].completed, false);
  for (const date of ['2026-02-30', '', null]) assert.deepEqual(calendar.dayItems(date, records, todos), { events: [], todos: [], completed: [], count: 0 });
  assert.equal(calendar.dayItems('2026-11-22', null, {}).count, 0);
});

test('DST days use civil midnight boundaries and 42 calendar cells across time zones', () => {
  const modulePath = require.resolve('../lib/calendar-model');
  const script = `
    const assert = require('node:assert/strict'), c = require(${JSON.stringify(modulePath)});
    for (const [date,next,hours] of [['2026-03-08','2026-03-09',23],['2026-11-01','2026-11-02',25]]) {
      const start = new Date(date+'T00:00:00').getTime(), end = new Date(next+'T00:00:00').getTime();
      assert.equal((end-start)/3600000,hours);
      const event = { id:'span',calendarId:'c',start,end,allDay:true };
      assert.equal(c.dayItems(date,[event],[]).count,1);
      assert.equal(c.dayItems(next,[event],[]).count,0);
      assert.equal(c.todoDate({dueDate:'',reminderAt:end-1,reminderState:'pending'}),date);
    }
    assert.deepEqual(c.monthRange('2026-03'),{start:new Date(2026,2,1).getTime(),end:new Date(2026,3,12).getTime()});
    assert.equal(new Set(c.gridDays('2026-03').map(d=>d.date)).size,42);
    assert.deepEqual(c.lunar('2026-11-22'),{month:'十月',day:'十四'});
    assert.ok(c.specials('2026-11-22').some(s=>s.title==='小雪'));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('browser UMD exposes the same independent API without Node globals', () => {
  const context = vm.createContext({ window: {}, Intl, Date });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/calendar-model'), 'utf8'), context);
  const browser = context.window.QiuCalendarModel;
  assert.deepEqual(Object.keys(browser).sort(), Object.keys(calendar).sort());
  assert.equal(browser.validDate('2026-11-22'), true);
  assert.equal(browser.todoDate({ dueDate: '2026-11-22' }), '2026-11-22');
  assert.equal(browser.gridDays('2026-11').length, 42);
  assert.equal(JSON.stringify(browser.holidayArrangement('2026-10-04')), JSON.stringify(calendar.holidayArrangement('2026-10-04')));
  assert.equal(browser.gridDays('2026-10').find(item => item.date === '2026-10-10').arrangement.kind, 'work');
});

test('Gregorian month and week helpers preserve leap dates, week origin and selectable-year border cells', () => {
  const leap = calendar.monthDates('2024-02', 1);
  assert.equal(leap.length, 42); assert.equal(leap.filter(item => item.inMonth).length, 29);
  assert.equal(leap.find(item => item.date === '2024-02-29').day, 29);
  assert.deepEqual(calendar.weekDays('2026-11-22', 0), ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
  assert.deepEqual(calendar.weekDays('2026-11-22', 1), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.equal(calendar.weekDays('1970-01-01')[0], '1969-12-28');
  assert.equal(calendar.weekDays('2100-12-31').at(-1), '2101-01-01');
  assert.throws(() => calendar.weekDays('2026-02-30'), RangeError);
});

test('time layout uses exact clipped durations, separates all-day events and retains due-date todo filters', () => {
  const spanning = event('overnight', { start: local('2026-11-21', 23), end: local('2026-11-22', 1) });
  const allDay = event('all', { start: local('2026-11-21'), end: local('2026-11-23'), allDay: true });
  const input = [spanning, allDay, { ...spanning }], tasks = [todo('todo'), todo('done', { completed: true, completedAt: 1 })];
  const layout = calendar.timeLayout('2026-11-22', input, tasks);
  assert.equal(layout.minutes, 1440); assert.equal(layout.hours.length, 25);
  assert.equal(layout.timed.length, 1); assert.deepEqual(layout.allDay, [allDay]);
  assert.equal(layout.timed[0].top, 0); assert.equal(layout.timed[0].durationMs, 3600000);
  assert.ok(Math.abs(layout.timed[0].height - 100 / 24) < 1e-10); assert.equal(layout.timed[0].continuesBefore, true);
  assert.equal(layout.todos.length, 1); assert.equal(layout.completed.length, 1);
  assert.equal(calendar.timeLayout('2026-11-23', input, tasks).timed.length, 0);
  const filtered = calendar.timeLayout('2026-11-22', input, tasks, { showSystemCalendar: false, showTodos: false });
  assert.equal(filtered.count, 0); assert.equal(filtered.timed.length, 0); assert.equal(filtered.allDay.length, 0);
  assert.equal(filtered.todos.length, 0); assert.equal(filtered.completed.length, 0);
  assert.equal(calendar.timeLayout('2026-11-22', input, [], { selectedCalendarIds: [] }).timed.length, 0);
});

test('overlap groups allocate separate columns, reuse ended columns and restore full width between groups', () => {
  const records = [
    event('a', { start: local('2026-11-22', 9), end: local('2026-11-22', 11) }),
    event('b', { start: local('2026-11-22', 9, 30), end: local('2026-11-22', 10, 30) }),
    event('c', { start: local('2026-11-22', 10), end: local('2026-11-22', 12) }),
    event('alone', { start: local('2026-11-22', 13), end: local('2026-11-22', 14) }),
    event('adjacent', { start: local('2026-11-22', 14), end: local('2026-11-22', 15) })
  ];
  const layout = calendar.timeLayout('2026-11-22', records, []), grouped = layout.timed.slice(0, 3);
  assert.deepEqual(grouped.map(item => item.column), [0, 1, 2]);
  assert.ok(grouped.every(item => item.columns === 3 && item.width === 100 / 3));
  assert.deepEqual(layout.timed.slice(3).map(item => [item.column, item.columns, item.width]), [[0, 1, 100], [0, 1, 100]]);
  assert.equal(layout.timed[0].top, 9 / 24 * 100); assert.equal(layout.timed[0].height, 2 / 24 * 100);
  assert.deepEqual(records.map(item => item.id), ['a', 'b', 'c', 'alone', 'adjacent'], 'layout leaves source order intact');
});

test('DST time layout preserves actual duration, missing/repeated hour marks and cross-day exclusivity', () => {
  const script = `
    const assert = require('node:assert/strict'), c = require(${JSON.stringify(require.resolve('../lib/calendar-model'))});
    for (const [date,start,end,minutes,hourOne,hourTwo] of [
      ['2026-03-08','2026-03-08T01:30:00-05:00','2026-03-08T03:30:00-04:00',1380,1,0],
      ['2026-11-01','2026-11-01T01:00:00-04:00','2026-11-01T02:00:00-05:00',1500,2,1]
    ]) {
      const item={id:'dst',calendarId:'c',start:Date.parse(start),end:Date.parse(end),allDay:false};
      const layout=c.timeLayout(date,[item],[]);
      assert.equal(layout.minutes,minutes);
      assert.equal(layout.hours.filter(h=>h.label==='01:00').length,hourOne);
      assert.equal(layout.hours.filter(h=>h.label==='02:00').length,hourTwo);
      assert.equal(layout.timed[0].durationMs,item.end-item.start);
      assert.equal(layout.timed[0].height,(item.end-item.start)/(layout.end-layout.start)*100);
      assert.ok(layout.hours.every((h,i,a)=>!i||h.timestamp>a[i-1].timestamp));
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
