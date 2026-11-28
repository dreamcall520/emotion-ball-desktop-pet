'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Model = require('./calendar-model');

// User-supplied text, preserved verbatim. Persist only indices, never this text.
const PHRASES = Object.freeze({
  morning: [
    '早呀，今天也一起慢慢来。', '新的一天，我来陪你啦。', '早上好，先给自己一个微笑吧。', '今天也请照顾好自己。',
    '慢慢进入状态就好，我在这里。', '早呀，先喝口水再开始吧。', '今天想先完成哪件小事？', '又是可以重新出发的一天。',
    '早上好，愿今天有一点小惊喜。', '不用着急，一件一件来。', '准备好啦？我陪你开始。', '早呀，记得给早餐留一点时间。',
    '今天的第一份陪伴已送达。', '醒醒神，我们一起出发。', '早上好，先把肩膀放松。', '愿你今天忙得从容一点。'
  ],
  lunch: [
    '先吃饭吧，忙碌也要照顾自己。', '午饭时间到，肚子也在等你。', '给工作按个暂停，去吃点喜欢的吧。', '别让午饭一直等着你呀。',
    '今天中午想吃什么？', '吃饱了，再回来慢慢忙。', '先去补充一点能量吧。', '午餐也是今天的重要安排。',
    '辛苦半天啦，去好好吃顿饭。', '屏幕先交给我，你去吃饭吧。', '再忙也给午饭留个位置。', '放下手里的事，尝点热乎的。',
    '午饭记得吃，球球记挂着。', '到饭点啦，照顾一下小胃。', '去吃饭吧，我在这里等你。', '忙碌的上午结束，轮到午餐啦。'
  ],
  rest: [
    '歇一会儿吧，给眼睛也放个假。', '午后慢一点，休息片刻吧。', '把视线从屏幕移开一会儿。', '伸个懒腰，放松一下肩膀。',
    '闭目养神几分钟也很好。', '先不赶路，给自己一点空白。', '坐久了，站起来走走吧。', '喝口水，换一口新鲜空气。',
    '休息不是偷懒，是照顾自己。', '让脑袋也喘口气吧。', '午间的小暂停，现在开始？', '窗外也值得看一眼。',
    '手腕和肩膀都想休息啦。', '慢慢呼吸，暂时放下事情。', '短短休息一下，再继续也不迟。', '给下午留一点精神吧。'
  ],
  offWork: [
    '辛苦啦，到收工时间了。', '今天忙到这里，也很不错啦。', '到你设置的下班时间啦。', '记得把一点时间留给生活。',
    '收拾一下，准备结束今天的工作吧。', '今天辛苦了，给自己一个拥抱。', '工作之外，也有值得期待的事。', '到点啦，检查一下还有什么要收尾。',
    '把今天轻轻放下吧。', '忙了一天，别忘了休息。', '今天的努力，球球看见啦。', '收工时间到，慢慢整理一下吧。',
    '也该轮到自己的时间啦。', '辛苦啦，晚饭记得好好吃。', '给今天画个温柔的句号吧。', '到了约好的收工时间，我来提醒你。'
  ]
});
for (const group of Object.values(PHRASES)) Object.freeze(group);
const KINDS = Object.keys(PHRASES);
const TIMES = { morning: ['morningTime', '09:00'], lunch: ['lunchTime', '12:00'], rest: ['restTime', '13:00'], offWork: ['offWorkTime', '18:00'] };
const TITLES = { morning: '早安', lunch: '午餐时间', rest: '午间休息', offWork: '下班时间' };
const MOTIONS = { morning: 'peek', lunch: 'hop', rest: 'sway', offWork: 'bow' };
const MAX_BYTES = 65536, MAX_DAYS = 64, RETENTION_DAYS = 62, INTERVAL = 60000;
const emptyState = () => ({ schema: 1, days: {}, pools: Object.fromEntries(KINDS.map(kind => [kind, { remaining: [], last: null }])) });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function minutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
function targets(preferences) {
  return Object.fromEntries(KINDS.map(kind => {
    const [key, fallback] = TIMES[kind];
    return [kind, minutes(Object.hasOwn(preferences, key) ? preferences[key] : fallback)];
  }));
}
function validate(saved) {
  if (!record(saved) || saved.schema !== 1 || !record(saved.days) || Object.keys(saved.days).length > MAX_DAYS || !record(saved.pools)) throw Error('时间提醒记录无法读取');
  for (const [date, kinds] of Object.entries(saved.days)) {
    if (!Model.validDate(date) || !Array.isArray(kinds) || kinds.length > KINDS.length || new Set(kinds).size !== kinds.length || !kinds.every(kind => KINDS.includes(kind))) throw Error('时间提醒日期记录不合法');
  }
  for (const kind of KINDS) {
    const pool = saved.pools[kind], validIndex = index => Number.isInteger(index) && index >= 0 && index < PHRASES[kind].length;
    if (!record(pool) || !Array.isArray(pool.remaining) || pool.remaining.length > PHRASES[kind].length ||
      !pool.remaining.every(validIndex) || new Set(pool.remaining).size !== pool.remaining.length ||
      pool.last !== null && !validIndex(pool.last) || pool.remaining.includes(pool.last)) throw Error('时间提醒文案轮换记录不合法');
  }
  return { schema: 1, days: saved.days, pools: Object.fromEntries(KINDS.map(kind => [kind, { remaining: [...saved.pools[kind].remaining], last: saved.pools[kind].last }])) };
}

function createCalendarTimeReminders({ filePath, getPreferences = () => ({}), isSuppressed = () => false,
  notify, now = Date.now, random = Math.random, setTimer = setInterval, clearTimer = clearInterval, onError = () => {} }) {
  if (typeof filePath !== 'string' || !filePath || typeof notify !== 'function') throw new TypeError('需要时间提醒文件和通知回调');
  let state = emptyState(), blocked = false, started = false, paused = false, disposed = false, timer = null, flight = null;
  const drafts = new Map();
  const report = error => { try { onError(error); } catch (_) {} };
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('时间提醒记录格式或大小不合法');
    state = validate(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) { if (error.code !== 'ENOENT') { blocked = true; report(error); } }

  function candidate(kind) {
    if (drafts.has(kind)) return drafts.get(kind);
    let remaining = [...state.pools[kind].remaining];
    if (!remaining.length) {
      remaining = PHRASES[kind].map((_, index) => index);
      for (let i = remaining.length - 1; i > 0; i--) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw Error('时间提醒随机选择暂时不可用');
        const j = Math.floor(value * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      if (remaining[0] === state.pools[kind].last) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
    }
    const draft = { kind, index: remaining[0], remaining: remaining.slice(1) };
    drafts.set(kind, draft); return draft;
  }
  function persist(date) {
    const cutoff = new Date(Date.parse(date + 'T00:00:00Z') - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
    const dates = Object.keys(state.days).filter(day => day >= cutoff && day <= date).sort().slice(-MAX_DAYS);
    state.days = Object.fromEntries(dates.map(day => [day, state.days[day]]));
    const temporary = filePath + '.' + randomUUID() + '.tmp'; let fd;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(state) + '\n', 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, filePath);
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
  }
  async function deliver(kind, date, preview) {
    const draft = candidate(kind);
    if (await notify({ kind, title: TITLES[kind], message: PHRASES[kind][draft.index], motion: MOTIONS[kind], ...(preview ? { preview: true } : {}) }) !== true) return false;
    state.pools[kind] = { remaining: draft.remaining, last: draft.index }; drafts.delete(kind);
    if (!preview) state.days[date] = [...(state.days[date] || []), kind];
    // Acknowledged delivery is consumed even if pause/dispose happened while
    // waiting. Otherwise a successfully shown line could repeat after restart.
    if (!blocked) { try { persist(Model.day(now())); } catch (error) { blocked = true; report(error); } }
    return true;
  }
  function preferences() { const value = getPreferences(); return record(value) ? value : {}; }
  function attempt() {
    if (flight) return flight;
    flight = Promise.resolve().then(async () => {
      if (!started || paused || disposed || blocked || isSuppressed()) return false;
      const prefs = preferences(), clock = new Date(now());
      if (prefs.timeReminders === false) return false;
      Model.day(clock); // Validate the injected clock before any delivery.
      const scheduled = targets(prefs);
      for (const kind of KINDS) {
        if (scheduled[kind] === null) continue;
        const hour = Math.floor(scheduled[kind] / 60), minute = scheduled[kind] % 60;
        for (const offset of [0, -1]) {
          const target = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + offset, hour, minute);
          // A skipped DST wall time is not silently moved to another hour.
          if (target.getHours() !== hour || target.getMinutes() !== minute || target.getFullYear() < 1970 || target.getFullYear() > 2100) continue;
          if (prefs.reminderWeekdaysOnly !== false && [0, 6].includes(target.getDay())) continue;
          const elapsed = clock.getTime() - target.getTime(), date = Model.day(target);
          if (elapsed >= 0 && elapsed < 30 * 60000 && !(state.days[date] || []).includes(kind)) return deliver(kind, date, false);
        }
      }
      return false;
    }).catch(error => { report(error); return false; }).finally(() => { flight = null; });
    return flight;
  }
  function stopTimer() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function ensureTimer() { if (timer === null) { timer = setTimer(() => { void attempt(); }, INTERVAL); timer?.unref?.(); } }
  return {
    start() { if (disposed) return Promise.resolve(false); started = true; paused = false; ensureTimer(); return attempt(); },
    pause() { paused = true; stopTimer(); },
    resume() { if (disposed || !started) return Promise.resolve(false); paused = false; ensureTimer(); return attempt(); },
    dispose() { disposed = true; paused = true; started = false; stopTimer(); },
    preview(kind) {
      if (flight) return Promise.resolve(false);
      flight = Promise.resolve().then(() => {
        if (disposed || isSuppressed() || kind !== undefined && !KINDS.includes(kind)) return false;
        const clock = new Date(now()), date = Model.day(clock);
        if (kind === undefined) {
          const scheduled = targets(preferences()), minute = clock.getHours() * 60 + clock.getMinutes();
          kind = KINDS.filter(name => scheduled[name] !== null && scheduled[name] <= minute).sort((a, b) => scheduled[b] - scheduled[a])[0] || 'morning';
        }
        return deliver(kind, date, true);
      }).catch(error => { report(error); return false; }).finally(() => { flight = null; });
      return flight;
    }
  };
}

module.exports = { createCalendarTimeReminders, PHRASES };
