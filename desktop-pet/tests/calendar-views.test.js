'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Views = require('../calendar-views'), Model = require('../lib/calendar-model');
const at = (date, hour = 0, minute = 0) => new Date(date + `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).getTime();

function fixture() {
  class Element {
    constructor(tag, document) {
      this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {};
      this.className = ''; this._text = ''; this.scrollTop = 0; this.scrollLeft = 0;
      this.classList = { add: name => { this.className += ' ' + name; } };
      const styles = new Map(); this.style = { setProperty: (key, value) => styles.set(key, value), getPropertyValue: key => styles.get(key) || '' };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_value) { throw Error('calendar views must use textContent'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click(detail = 1) { if (!this.disabled) this.listeners.click?.({ target: this, detail }); }
    focus() { this.ownerDocument.activeElement = this; }
    doubleClick() { if (!this.disabled) { this.click(1); this.click(2); this.listeners.dblclick?.({ target: this, detail: 2, preventDefault() {}, stopPropagation() {} }); } }
    getBoundingClientRect() { return { height: this.hasClass('time-grid-body') ? 1152 : this.hasClass('time-grid-header') ? 52 : 38 }; }
    hasClass(name) { return this.className.split(/\s+/).includes(name); }
  }
  const document = { createElement: tag => new Element(tag, document) }, container = document.createElement('div'), selected = [];
  const all = () => { const result = []; const walk = node => { result.push(node); node.children.forEach(walk); }; walk(container); return result; };
  const find = name => all().filter(node => node.hasClass(name));
  const render = (change = {}) => Views.render({ container, view: 'day', date: '2026-11-22', month: '2026-11', now: at('2026-11-22', 15, 30),
    events: [], todos: [], preferences: {}, calendars: [], weekStart: 0, onSelectDate: (date, view) => selected.push([date, view]), ...change });
  return { container, selected, all, find, render };
}

test('day view shows real timed and all-day events, filters sources, and treats all supplied labels as text', () => {
  const f = fixture(), title = '<img src=x onerror=alert(1)>', events = [
    { id: 'a', title, calendarId: 'work', start: at('2026-11-22', 9), end: at('2026-11-22', 10), url: 'javascript:alert(1)' },
    { id: 'b', title: '讨论', calendarId: 'work', start: at('2026-11-22', 9, 30), end: at('2026-11-22', 11) },
    { id: 'all', title: '假期', calendarId: 'work', start: at('2026-11-22'), end: at('2026-11-23'), allDay: true }
  ];
  const todos = [{ id: 't', dueDate: '2026-11-22', completed: false }, { id: 'done', dueDate: '2026-11-22', completed: true }];
  f.render({ events, todos, calendars: [{ id: 'work', title: '项目日历', color: '#123abc' }] });
  assert.equal(f.find('time-day-column').length, 1); assert.equal(f.find('time-event').length, 2);
  assert.equal(f.find('time-all-day-event').length, 1); assert.equal(f.find('time-todo-summary')[0].textContent, '1 项待办');
  assert.equal(f.find('time-event-title')[0].textContent, title);
  assert.equal(f.all().some(node => ['IMG', 'A', 'SCRIPT', 'INPUT'].includes(node.tagName)), false);
  const event = f.find('time-event')[0];
  assert.equal(event.style.getPropertyValue('--event-left'), '0%'); assert.equal(event.style.getPropertyValue('--event-width'), '50%');
  assert.equal(event.style.getPropertyValue('--event-color'), '#123abc');
  assert.match(event.getAttribute('aria-label'), /09:00–10:00/); assert.equal(event.type, 'button');
  event.click(); assert.deepEqual(f.selected.at(-1), ['2026-11-22', undefined]);
  f.render({ events, todos, preferences: { showSystemCalendar: false, showTodos: false } });
  assert.equal(f.find('time-event').length, 0); assert.equal(f.find('time-all-day-event').length, 0); assert.equal(f.find('time-todo-summary').length, 0);
});

test('week view exposes seven reachable date headers and clips a cross-midnight event into both dates', () => {
  const f = fixture();
  f.render({ view: 'week', weekStart: 1, events: [{ id: 'night', calendarId: 'c', title: '跨日', start: at('2026-11-21', 23), end: at('2026-11-22', 1) }] });
  assert.equal(f.find('time-day-column').length, 7); assert.equal(f.find('time-date').length, 7);
  assert.equal(f.find('time-date')[0].dataset.date, '2026-11-16'); assert.equal(f.find('time-date-number').at(-1).textContent, '22');
  assert.equal(f.find('time-event').length, 2); assert.equal(f.find('continues-before').length, 1); assert.equal(f.find('continues-after').length, 1);
  f.find('time-date')[0].click(); assert.deepEqual(f.selected.at(-1), ['2026-11-16', 'day']);
  f.find('time-event')[0].click(); assert.deepEqual(f.selected.at(-1), ['2026-11-21', undefined]);
});

test('time-event and todo previews preserve their nodes on mouse clicks and open once on double click or keyboard activation', () => {
  const f = fixture(), previews = [], events = [
    { id: 'timed', calendarId: 'c', title: '日程', start: at('2026-11-22', 9), end: at('2026-11-22', 10) },
    { id: 'all', calendarId: 'c', title: '全天', start: at('2026-11-22'), end: at('2026-11-23'), allDay: true }
  ];
  f.render({ events, todos: [{ id: 't', dueDate: '2026-11-22', completed: false }], onPreview: value => previews.push(value) });
  for (const [selector, expected] of [
    ['time-event', { kind: 'event', id: 'timed', start: events[0].start }],
    ['time-all-day-event', { kind: 'event', id: 'all', start: events[1].start }],
    ['time-todo-summary', { kind: 'todos' }]
  ]) {
    const node = f.find(selector)[0], before = previews.length;
    node.click();
    assert.equal(previews.length, before); assert.equal(node.ownerDocument.activeElement, node);
    assert.equal(f.find(selector)[0], node, 'first click keeps the double-click target mounted');
    assert.deepEqual(f.selected, []);
    node.doubleClick();
    assert.equal(previews.length, before + 1);
    assert.deepEqual(previews.at(-1), { ...expected, date: '2026-11-22', anchor: node });
    node.click(0);
    assert.equal(previews.length, before + 2, 'Enter/Space/synthetic button activation is keyboard-accessible');
    assert.deepEqual(previews.at(-1), { ...expected, date: '2026-11-22', anchor: node });
    assert.deepEqual(f.selected, [], 'preview activation never selects a new date or replaces the target');
    if (expected.kind === 'event') { assert.equal(node.dataset.eventId, expected.id); assert.equal(node.dataset.eventStart, String(expected.start)); }
  }
  f.find('time-date')[0].click(); assert.deepEqual(f.selected, [['2026-11-22', 'day']], 'date headers retain their existing navigation');
});

test('week previews retain the original occurrence start while identifying the clicked cross-midnight date', () => {
  const f = fixture(), previews = [], start = at('2026-11-21', 23);
  f.render({ view: 'week', weekStart: 1, events: [{ id: 'night', calendarId: 'c', title: '跨日', start, end: at('2026-11-22', 1) }], onPreview: value => previews.push(value) });
  const rows = f.find('time-event'); assert.equal(rows.length, 2);
  for (const node of rows) node.doubleClick();
  assert.deepEqual(previews.map(({ kind, id, start, date }) => ({ kind, id, start, date })), [
    { kind: 'event', id: 'night', start, date: '2026-11-21' }, { kind: 'event', id: 'night', start, date: '2026-11-22' }
  ]);
  assert.deepEqual(f.selected, []);
  f.render({ view: 'year', onPreview: value => previews.push(value) });
  f.find('year-date').find(node => node.tagName === 'BUTTON').click();
  assert.equal(f.selected.length, 1); assert.equal(f.selected[0][1], 'day'); assert.equal(previews.length, 2);
});

test('without a preview callback timed, all-day and todo buttons keep their existing date selection', () => {
  const f = fixture();
  f.render({ events: [
    { id: 'timed', calendarId: 'c', title: '日程', start: at('2026-11-22', 9), end: at('2026-11-22', 10) },
    { id: 'all', calendarId: 'c', title: '全天', start: at('2026-11-22'), end: at('2026-11-23'), allDay: true }
  ], todos: [{ id: 't', dueDate: '2026-11-22', completed: false }], onPreview: null });
  for (const selector of ['time-event', 'time-all-day-event', 'time-todo-summary']) f.find(selector)[0].click();
  assert.deepEqual(f.selected, Array.from({ length: 3 }, () => ['2026-11-22', undefined]));
});

test('year view renders twelve Gregorian month grids and leap-day navigation without inventing event counts', () => {
  const f = fixture(); f.render({ view: 'year', date: '2024-02-29', month: '2024-11', now: at('2024-02-29', 12) });
  assert.equal(f.find('year-month').length, 12); assert.equal(f.find('year-days').length, 12);
  const dates = f.find('year-date').filter(node => node.tagName === 'BUTTON');
  assert.equal(dates.length, 366); assert.equal(f.find('is-today').length, 1); assert.equal(f.find('is-selected').length, 1);
  assert.equal(f.find('year-date').length, 12 * 42, 'each month has six full weeks');
  assert(f.find('is-outside').every(node => /^\d{1,2}$/.test(node.textContent)), 'neighbouring months fill the visible trailing rows');
  assert.equal(f.find('time-event').length, 0); assert.equal(f.find('time-todo-summary').length, 0);
  const leap = dates.find(node => node.dataset.date === '2024-02-29');
  assert.equal(leap.type, 'button'); assert.equal(leap.getAttribute('aria-current'), 'date');
  leap.click(); assert.deepEqual(f.selected.at(-1), ['2024-02-29', 'day']);
});

test('initial timeline starts at the previous whole hour, while live updates and view round-trips preserve scroll', () => {
  const f = fixture(); f.render();
  const first = f.find('time-view-scroll')[0];
  assert.equal(first.scrollTop, 14 / 24 * 1152, '15:30 first shows 14:00 below the sticky header, without double-counting its flow height');
  first.scrollTop = 321; first.scrollLeft = 19; f.render({ events: [] });
  assert.equal(f.find('time-view-scroll')[0].scrollTop, 321); assert.equal(f.find('time-view-scroll')[0].scrollLeft, 19);
  f.render({ date: '2026-11-23' }); f.find('time-view-scroll')[0].scrollTop = 456;
  f.render(); assert.equal(f.find('time-view-scroll')[0].scrollTop, 321);
  f.render({ view: 'year' }); f.find('calendar-year-view')[0].scrollTop = 67;
  f.render({ view: 'year', month: '2026-12' }); assert.equal(f.find('calendar-year-view')[0].scrollTop, 67);
});

test('week border dates are disabled and unsafe source colors never become CSS', () => {
  const f = fixture(); f.render({ view: 'week', date: '1970-01-01', month: '1970-01', now: at('1970-01-01'),
    events: [{ id: 'x', title: '日程', calendarId: 'unsafe', start: at('1970-01-01', 9), end: at('1970-01-01', 10) }], calendars: [{ id: 'unsafe', color: 'url(javascript:alert(1))' }] });
  assert.equal(f.find('time-date').filter(node => node.disabled).length, 4);
  f.find('time-date')[0].click(); assert.equal(f.selected.length, 0);
  assert.equal(f.find('time-event')[0].style.getPropertyValue('--event-color'), '');
  assert.throws(() => f.render({ date: '2101-01-01' }), RangeError);
});

test('browser UMD loads against the shared browser model without Node integration', () => {
  const context = { window: { QiuCalendarModel: Model } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../calendar-views.js'), 'utf8'), context);
  assert.equal(typeof context.window.QiuCalendarViews.render, 'function');
});
