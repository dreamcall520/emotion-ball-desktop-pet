'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Model = require('./calendar-model');

const INTERVAL = 60000, MAX_BYTES = 16384, MAX_DATES = 64, RETENTION_DAYS = 62;
// Only the first day of each officially announced holiday period is included.
// These dates do not describe an individual user's leave or any adjusted workdays.
// 2026, 国办发明电〔2025〕7号, published 2025-11-04:
// https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
// 2027, 国务院办公厅通知 dated 2026-11-05, published here 2026-11-09:
// https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml
const HOLIDAY_STARTS = Object.freeze({
  '2026-01-01': '元旦', '2026-02-15': '春节', '2026-04-04': '清明节', '2026-05-01': '劳动节',
  '2026-06-19': '端午节', '2026-09-25': '中秋节', '2026-10-01': '国庆节',
  '2027-01-01': '元旦', '2027-02-05': '春节', '2027-04-03': '清明节', '2027-05-01': '劳动节',
  '2027-06-09': '端午节', '2027-09-15': '中秋节', '2027-10-01': '国庆节'
});

function greeting(date) {
  const festivals = [...new Set(Model.specials(date)
    .filter(item => item.type === 'holiday' || item.type === 'term' && item.title === '清明')
    .map(item => item.title === '清明' ? '清明节' : item.title))];
  const start = HOLIDAY_STARTS[date];
  if (!festivals.length && !start) return null;
  const title = [...festivals, ...(start && !festivals.includes(start) ? [start + '假期开始'] : [])].join('、');
  const names = new Set([...festivals, start].filter(Boolean));
  if (names.has('清明节')) return { title, message: (festivals.includes('清明节') ? '今天是清明节' : '清明假期开始了') + '，愿思念有所寄托，也记得照顾好自己。', motion: null };
  if (names.has('端午节')) return { title, message: '端午安康，记得好好吃饭，也给自己留一点休息的时间。', motion: 'hop' };
  const message = festivals.length
    ? festivals.join('、') + '快乐！' + (start ? '假期从今天开始，' : '') + '球球来陪你过节啦。'
    : start + '假期开始了，球球来和你打个招呼。愿你这几天过得轻松一点。';
  return { title, message, motion: 'hop' };
}

function createCalendarHolidayReminders({ filePath, isEnabled = () => true, isSuppressed = () => false,
  notify, now = Date.now, setTimer = setInterval, clearTimer = clearInterval, onError = () => {} }) {
  if (typeof filePath !== 'string' || !filePath || typeof notify !== 'function') throw new TypeError('需要节日提醒文件和通知回调');
  const seen = new Set();
  let started = false, paused = false, disposed = false, blocked = false, timer = null, flight = null;
  const report = error => { try { onError(error); } catch (_) {} };
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('节日提醒记录格式或大小不合法');
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!saved || saved.schema !== 1 || !Array.isArray(saved.dates) || saved.dates.length > MAX_DATES ||
      !saved.dates.every(date => typeof date === 'string' && Model.validDate(date))) throw Error('节日提醒记录无法读取');
    for (const date of saved.dates) seen.add(date);
  } catch (error) {
    if (error.code !== 'ENOENT') { blocked = true; report(error); }
  }

  function persist(date) {
    const cutoff = new Date(Date.parse(date + 'T00:00:00Z') - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
    const dates = [...seen].filter(item => item >= cutoff && item <= date).sort().slice(-MAX_DATES);
    const temporary = filePath + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ schema: 1, dates }) + '\n', 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, filePath);
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
  }
  function attempt() {
    if (flight) return flight;
    flight = Promise.resolve().then(async () => {
      if (!started || paused || disposed || blocked || !isEnabled() || isSuppressed()) return false;
      const date = Model.day(now());
      if (seen.has(date)) return false;
      const payload = greeting(date);
      if (!payload || await notify(payload) !== true) return false;
      // A successful delivery counts even if pause/dispose happened while its
      // acknowledgement was pending. Never display it again in this process.
      seen.add(date);
      try { persist(date); } catch (error) { blocked = true; report(error); }
      return true;
    }).catch(error => { report(error); return false; }).finally(() => { flight = null; });
    return flight;
  }
  function stopTimer() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function ensureTimer() {
    if (timer === null) { timer = setTimer(() => { void attempt(); }, INTERVAL); timer?.unref?.(); }
  }
  return {
    start() { if (disposed) return Promise.resolve(false); started = true; paused = false; ensureTimer(); return attempt(); },
    pause() { paused = true; stopTimer(); },
    resume() { if (disposed || !started) return Promise.resolve(false); paused = false; ensureTimer(); return attempt(); },
    dispose() { disposed = true; paused = true; started = false; stopTimer(); },
    async preview() {
      try {
        if (disposed || isSuppressed()) return false;
        const payload = greeting(Model.day(now())) || { title: '节日互动预览', message: '节日到了，球球会像这样和你打个招呼。', motion: 'hop' };
        return await notify({ ...payload, preview: true }) === true;
      } catch (error) { report(error); return false; }
    }
  };
}

module.exports = { createCalendarHolidayReminders };
