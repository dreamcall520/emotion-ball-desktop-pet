const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MODES = ['focus', 'short', 'long'];
const FACES = ['analog', 'timeline', 'modules', 'minutes'];
const LIMITS = { focus: 180, short: 60, long: 120 };
const LINES = ['不急，专心做好眼前这一件。', '一点点推进，也是在向前。'];
const milestones = total => total < 600 ? [] : total >= 2700 ? [total / 3, total * 2 / 3] : [total / 2];
const copy = state => ({ ...state, durations: { ...state.durations }, marks: [...state.marks] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const day = time => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const validIntention = value => typeof value === 'string' && value.length <= 60 && !/[\u0000-\u001f\u007f]/.test(value);
const requireValid = (condition, message = '番茄钟参数无效。') => { if (!condition) throw new Error(message); };

function createPomodoro({ filePath, now = Date.now, onChange = () => {}, onError = () => {},
  canEncourage = () => true, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  requireValid(typeof filePath === 'string' && filePath.length > 0, '需要番茄钟记录文件路径。');
  const report = error => { try { onError(error); } catch (_) {} };
  const time = () => {
    const value = now();
    requireValid(integer(value, 0, 253402300000000), '当前时间无效。');
    return value;
  };
  let state = { mode: 'focus', status: 'idle', total: 1500, remaining: 1500, deadline: 0,
    completed: 0, cycleCompleted: 0, minutes: 0, date: day(time()),
    durations: { focus: 25, short: 5, long: 15 }, face: 'analog', intention: '', pinned: false,
    encouragementEnabled: true, extension: false, reminder: false, marks: [], encouragement: '', encouragementUntil: 0 };
  let readBlocked = false, closed = false;
  function getSnapshot() {
    const { marks, encouragementUntil, ...snapshot } = copy(state);
    return { ...snapshot, quiet: state.mode === 'focus' && ['running', 'paused'].includes(state.status) };
  }
  const publish = () => { const snapshot = getSnapshot(); try { onChange(snapshot); } catch (error) { report(error); } return getSnapshot(); };
  const silence = next => { next.encouragement = ''; next.encouragementUntil = 0; };
  function reset(next, mode = next.mode) {
    Object.assign(next, { mode, status: 'idle', total: next.durations[mode] * 60,
      remaining: next.durations[mode] * 60, deadline: 0, extension: false, reminder: false, marks: [] });
    silence(next);
  }
  function start(next, stamp) {
    if (next.mode === 'focus' && !next.extension && next.cycleCompleted === 4) next.cycleCompleted = 0;
    next.status = 'running'; next.deadline = stamp + next.remaining * 1000;
  }
  function finish(next, stamp) {
    const completedAt = next.deadline || stamp;
    if (next.mode === 'focus') {
      if (!next.extension) next.cycleCompleted = Math.min(4, next.cycleCompleted + 1);
      if (day(completedAt) === next.date) {
        if (!next.extension) next.completed++;
        next.minutes += next.total / 60;
      }
    }
    next.status = 'complete'; next.remaining = 0; next.deadline = 0; next.reminder = true; silence(next);
  }
  function advance(next, stamp) {
    let save = false;
    if (next.date !== day(stamp)) { next.date = day(stamp); next.completed = 0; next.minutes = 0; save = true; }
    if (next.status === 'running') {
      next.remaining = Math.max(0, Math.min(next.total, Math.ceil((next.deadline - stamp) / 1000)));
      if (next.remaining === 0) { finish(next, stamp); save = true; }
    }
    return save;
  }
  function consumeMilestones(next) {
    milestones(next.total).forEach((mark, index) => {
      if (next.total - next.remaining >= mark && !next.marks.includes(index)) next.marks.push(index);
    });
  }
  function encourage(next, stamp) {
    if (next.status !== 'running' || next.mode !== 'focus') { silence(next); return; }
    let visible = false;
    try { visible = canEncourage() === true; } catch (error) { report(error); }
    if (!visible || !next.encouragementEnabled || stamp >= next.encouragementUntil) silence(next);
    const elapsed = next.total - (next.deadline - stamp) / 1000;
    milestones(next.total).forEach((mark, index) => {
      if (elapsed < mark || next.marks.includes(index)) return;
      next.marks.push(index);
      if (elapsed - mark <= 2 && next.remaining >= 180 && visible && next.encouragementEnabled && !next.encouragement) {
        next.encouragement = LINES[index]; next.encouragementUntil = stamp + 5000;
      }
    });
  }
  function write(next) {
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    const { encouragement, encouragementUntil, ...saved } = next;
    let fd;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ schema: 1, ...saved }), 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, filePath);
    } catch (cause) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
      try { fs.unlinkSync(temporary); } catch (_) {}
      throw new Error('番茄钟暂时无法保存，请检查本机存储后重试。', { cause });
    }
  }
  function validateSaved(value) {
    requireValid(object(value) && value.schema === 1 && MODES.includes(value.mode) &&
      ['idle', 'running', 'paused', 'complete'].includes(value.status));
    const savedKeys = ['schema', ...Object.keys(state).filter(key => !['encouragement', 'encouragementUntil'].includes(key))];
    requireValid(Object.keys(value).every(key => savedKeys.includes(key)));
    requireValid(object(value.durations) && MODES.every(mode => integer(value.durations[mode], 1, LIMITS[mode])));
    requireValid(FACES.includes(value.face) && validIntention(value.intention));
    requireValid(['pinned', 'encouragementEnabled', 'extension', 'reminder'].every(key => typeof value[key] === 'boolean'));
    requireValid(integer(value.total, 60, 10800) && value.total % 60 === 0 && integer(value.remaining, 0, value.total));
    requireValid(integer(value.deadline, 0, 253402310800000) && (value.status === 'running' ? value.deadline > 0 : value.deadline === 0));
    requireValid(value.status === 'complete' ? value.remaining === 0 : value.remaining > 0);
    requireValid(value.status !== 'idle' || value.remaining === value.total);
    requireValid(!value.extension || value.mode === 'focus' && value.total === 300);
    requireValid(value.total === (value.extension ? 300 : value.durations[value.mode] * 60));
    requireValid(value.status === 'complete' || !value.reminder);
    requireValid(integer(value.completed, 0, 1000000) && integer(value.cycleCompleted, 0, 4) && integer(value.minutes, 0, 1000000000));
    requireValid(typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && day(new Date(`${value.date}T12:00:00`).getTime()) === value.date);
    requireValid(Array.isArray(value.marks) && value.marks.length <= 2 && value.marks.every(mark => mark === 0 || mark === 1) && new Set(value.marks).size === value.marks.length);
    const { schema, ...clean } = value;
    return { ...copy(clean), encouragement: '', encouragementUntil: 0 };
  }
  try {
    const stat = fs.lstatSync(filePath);
    requireValid(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, '番茄钟记录文件不合法。');
    state = validateSaved(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') { readBlocked = true; report(new Error('番茄钟记录读取失败，原文件已保留；当前使用默认设置。', { cause: error })); }
  }
  if (!readBlocked) {
    const stamp = time(), save = advance(state, stamp), running = state.status === 'running';
    if (running) {
      consumeMilestones(state);
      state.status = 'paused'; state.deadline = 0; silence(state);
    }
    if (save || running) { try { write(state); } catch (error) { report(error); } }
  }
  function tick() {
    if (closed) return getSnapshot();
    try {
      const next = copy(state), stamp = time(), save = advance(next, stamp);
      encourage(next, stamp);
      if (save && !readBlocked) { try { write(next); } catch (error) { report(error); } }
      state = next;
    } catch (error) { report(error); }
    return publish();
  }
  function action(type, value) {
    if (closed) return { ok: false, message: '番茄钟已关闭。' };
    try {
      requireValid(typeof type === 'string' && ['toggle', 'reset', 'mode', 'settings', 'intention', 'pin', 'rest', 'extend', 'dismiss'].includes(type));
      if (['toggle', 'reset', 'rest', 'extend', 'dismiss'].includes(type)) requireValid(value === undefined);
      if (type === 'mode') requireValid(MODES.includes(value));
      if (type === 'intention') requireValid(validIntention(value), '专注目标最多 60 个字符，不能包含控制字符。');
      if (type === 'pin') requireValid(value === undefined || typeof value === 'boolean');
      if (type === 'settings') {
        requireValid(object(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => ['durations', 'face', 'encouragementEnabled'].includes(key)));
        if (Object.hasOwn(value, 'durations')) requireValid(object(value.durations) && Object.keys(value.durations).length > 0 &&
          Object.keys(value.durations).every(mode => MODES.includes(mode) && integer(value.durations[mode], 1, LIMITS[mode])), '计时时长超出允许范围。');
        if (Object.hasOwn(value, 'face')) requireValid(FACES.includes(value.face), '展示样式无效。');
        if (Object.hasOwn(value, 'encouragementEnabled')) requireValid(typeof value.encouragementEnabled === 'boolean');
      }
      const next = copy(state), stamp = time();
      const wasRunning = next.status === 'running';
      advance(next, stamp); encourage(next, stamp);
      const rest = () => { reset(next, next.mode === 'focus' ? next.cycleCompleted === 4 ? 'long' : 'short' : 'focus'); start(next, stamp); };
      if (type === 'toggle') {
        if (wasRunning && next.status === 'complete') { /* The pause click observes completion without starting a break. */ }
        else if (next.status === 'complete') rest();
        else if (next.status === 'running') { next.status = 'paused'; next.deadline = 0; silence(next); }
        else start(next, stamp);
      }
      if (type === 'reset') reset(next);
      if (type === 'mode') reset(next, value);
      if (type === 'settings') {
        const changed = value.durations && Object.keys(value.durations).some(mode => next.durations[mode] !== value.durations[mode]);
        Object.assign(next.durations, value.durations);
        if (Object.hasOwn(value, 'face')) next.face = value.face;
        if (Object.hasOwn(value, 'encouragementEnabled')) next.encouragementEnabled = value.encouragementEnabled;
        if (changed) reset(next); else if (!next.encouragementEnabled) silence(next);
      }
      if (type === 'intention') next.intention = value;
      if (type === 'pin') next.pinned = value === undefined ? !next.pinned : value;
      if (type === 'rest') { requireValid(next.status === 'complete', '当前计时尚未完成。'); rest(); }
      if (type === 'extend') {
        requireValid(next.mode === 'focus' && next.status === 'complete', '请完成本次专注后再加时。');
        Object.assign(next, { mode: 'focus', status: 'idle', total: 300, remaining: 300, extension: true, reminder: false, marks: [] });
        silence(next); start(next, stamp);
      }
      if (type === 'dismiss') next.reminder = false;
      write(next); readBlocked = false; state = next;
      return { ok: true, state: publish() };
    } catch (error) { report(error); publish(); return { ok: false, message: error.message }; }
  }
  const timer = setTimer(tick, 1000);
  timer?.unref?.();
  return { getSnapshot, action, tick, close() {
    if (closed) return { ok: true, state: getSnapshot() };
    const next = copy(state);
    try {
      advance(next, time());
      if (next.status === 'running') { consumeMilestones(next); next.status = 'paused'; next.deadline = 0; }
      silence(next);
      if (!readBlocked) write(next);
      state = next; closed = true; clearTimer(timer);
      return { ok: true, state: publish() };
    } catch (error) { report(error); return { ok: false, message: error.message }; }
  } };
}

module.exports = { createPomodoro };
