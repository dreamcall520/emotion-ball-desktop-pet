'use strict';

const path = require('node:path');
const STATUSES = new Set(['not-determined', 'denied', 'restricted', 'granted']);
const MAX_RANGE = 62 * 86400000;
const ERRORS = Object.freeze({
  unsupported: '此系统暂不支持读取系统日历，仍可使用球球待办。',
  unavailable: '系统日历组件不可用，请稍后重试。',
  invalid: '请选择有效的日历日期范围（最多62天）。',
  failed: '暂时无法读取系统日历，请重试。'
});
function cleanText(value, limit, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, limit) || fallback;
}
function eventDetails(item) {
  const details = {};
  const location = cleanText(item.location, 500);
  if (location) details.location = location;
  if (typeof item.notes === 'string') {
    const notes = item.notes.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '').trim().slice(0, 4000);
    if (notes) details.notes = notes;
  }
  const organizer = cleanText(item.organizer, 300);
  if (organizer && !organizer.includes('@')) details.organizer = organizer;
  if (Array.isArray(item.reminderMinutes)) {
    const minutes = [...new Set(item.reminderMinutes.slice(0, 8).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 525600))];
    if (minutes.length) details.reminderMinutes = minutes;
  }
  return details;
}
function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function empty(status, error) { return { status, calendars: [], events: [], truncated: false, ...(error ? { error } : {}) }; }
function createSystemCalendar({ native, platform = process.platform } = {}) {
  let binding = native, loaded = native !== undefined, connecting = null;
  function getBinding() {
    if (!loaded) {
      loaded = true;
      try { binding = require(path.join(__dirname, '../native/calendar-events.node')); } catch { binding = null; }
    }
    return binding;
  }
  function status() {
    if (platform !== 'darwin') return { status: 'unsupported', error: ERRORS.unsupported };
    try {
      const current = getBinding()?.status();
      if (!STATUSES.has(current)) return { status: 'error', error: ERRORS.unavailable };
      return { status: current };
    } catch { return { status: 'error', error: ERRORS.unavailable }; }
  }
  function connect() {
    if (connecting) return connecting;
    const current = status();
    if (!['not-determined', 'denied'].includes(current.status)) return Promise.resolve(current);
    connecting = Promise.resolve().then(() => getBinding().connect()).then(result => STATUSES.has(result) ? status() : { status: 'error', error: ERRORS.failed }, () => ({ status: 'error', error: ERRORS.failed })).finally(() => { connecting = null; });
    return connecting;
  }
  async function read(range) {
    const { start, end } = range || {};
    const current = status();
    if (current.status !== 'granted') return empty(current.status, current.error);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_RANGE || Math.abs(start) > 8640000000000000 || Math.abs(end) > 8640000000000000) return empty('error', ERRORS.invalid);
    try {
      const raw = await getBinding().read(start, end);
      const latest = status();
      if (latest.status !== 'granted') return empty(latest.status, latest.error);
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!value || !Array.isArray(value.calendars) || !Array.isArray(value.events) || value.calendars.length > 1000 || value.events.length > 2000) throw Error();
      const ids = new Set();
      const calendars = value.calendars.map(item => {
        if (!validId(item?.id) || ids.has(item.id)) throw Error();
        ids.add(item.id);
        return { id: item.id, title: cleanText(item.title, 160, '未命名日历'), ...(typeof item.color === 'string' && /^#[\da-f]{6}$/i.test(item.color) ? { color: item.color } : {}) };
      });
      const eventIds = new Set();
      const events = value.events.map(item => {
        if (!validId(item?.id) || !ids.has(item.calendarId) || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end < item.start || item.start >= end || item.end < start || typeof item.allDay !== 'boolean') throw Error();
        const key = item.id + ':' + item.start;
        if (eventIds.has(key)) return null;
        eventIds.add(key);
        return { id: item.id, calendarId: item.calendarId, title: cleanText(item.title, 300, '未命名日程'), start: item.start, end: item.end, allDay: item.allDay,
          ...(validId(item.itemId) ? { itemId: item.itemId } : {}), ...(typeof item.recurring === 'boolean' ? { recurring: item.recurring } : {}), ...eventDetails(item) };
      }).filter(Boolean);
      return { status: 'granted', calendars, events, truncated: value.truncated === true };
    } catch { return empty('error', ERRORS.failed); }
  }
  return { status, connect, read };
}
module.exports = { createSystemCalendar, MAX_RANGE };
