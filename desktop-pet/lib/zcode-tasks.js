const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const FRESH_MS = 120000;
const QUERY = 'SELECT task_id,title,task_status,provider,updated_at,cli_updated_at,cli_last_outcome,meta_json FROM tasks WHERE deleted = 0 AND archived = 0 ORDER BY updated_at DESC LIMIT 256';
async function queryTaskRows(file, query) {
  const { stdout } = await runFile('/usr/bin/sqlite3', ['-readonly', '-json', '-cmd', '.timeout 1000', file, query],
    { timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout || '[]');
}
function projectZcodeTasks(rows, now = Date.now()) {
  const items = [], results = [];
  for (const row of (Array.isArray(rows) ? rows.slice(0, 256) : [])) {
    if (row.provider && !['zcode', 'glm'].includes(row.provider) || typeof row.task_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(row.task_id)) continue;
    const updatedAt = Number(row.cli_updated_at || row.updated_at);
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) continue;
    const terminal = { completed: 'completed', error: 'failed', failed: 'failed', interrupted: 'interrupted', cancelled: 'interrupted' };
    const recorded = row.task_status || row.cli_last_outcome;
    const fresh = updatedAt <= now && now - updatedAt <= FRESH_MS;
    const state = terminal[recorded] || (fresh && ['running', 'working', 'active'].includes(recorded) ? 'active'
      : fresh && ['waiting', 'blocked'].includes(recorded) ? 'waiting' : 'unknown');
    const projected = { id: row.task_id, title: typeof row.title === 'string' && row.title.trim() ? row.title.slice(0, 140) : '未命名任务',
      state, updatedAt, turnId: null, source: 'zcode-task-index', liveVerified: false };
    (terminal[recorded] ? results : items).push(projected);
  }
  // The durable index has no cross-process heartbeat. It cannot certify idle or
  // the absence of tasks, even when every stored row is terminal.
  return { state: 'unknown', items, tasks: items, results, updatedAt: now,
    activity: { runningCount: null, unreadCount: null }, source: 'zcode-task-index', partial: true };
}
const RUNTIME_QUERY = `WITH facts AS (
  SELECT s.id AS task_id,s.title,s.directory,json_extract(m.data,'$.anchor.turnId') AS turn_id,
    'running' AS status,m.time_created AS started_at,NULL AS completed_at,
    EXISTS(SELECT 1 FROM tool_usage u WHERE u.session_id=s.id
      AND u.turn_id=json_extract(m.data,'$.anchor.turnId') AND u.status='running' AND u.approval_status='requested') AS waiting
  FROM message m JOIN session s ON s.id=m.session_id
  WHERE s.time_deleted IS NULL AND s.time_archived IS NULL AND json_extract(m.data,'$.role')='user'
    AND json_extract(m.data,'$.semantics.kind')='user_prompt' AND json_extract(m.data,'$.anchor.turnId') IS NOT NULL
    AND m.time_created=(SELECT MAX(n.time_created) FROM message n WHERE n.session_id=s.id AND json_extract(n.data,'$.role')='user')
    AND NOT EXISTS(SELECT 1 FROM turn_usage t WHERE t.session_id=s.id
      AND t.turn_id=json_extract(m.data,'$.anchor.turnId') AND t.status IN ('completed','error','cancelled'))
  UNION ALL
  SELECT s.id,s.title,s.directory,t.turn_id,t.status,t.started_at,t.completed_at,0
  FROM turn_usage t JOIN session s ON s.id=t.session_id
  WHERE s.time_deleted IS NULL AND s.time_archived IS NULL
    AND t.started_at=(SELECT MAX(n.started_at) FROM turn_usage n WHERE n.session_id=t.session_id)
) SELECT * FROM facts WHERE started_at=(SELECT MAX(n.started_at) FROM facts n WHERE n.task_id=facts.task_id)
ORDER BY started_at DESC LIMIT 256`;
function canonicalPath(value) {
  if (typeof value !== 'string') return null;
  try { return require('node:fs').realpathSync(value); } catch { return path.resolve(value); }
}
function elapsedMillis(value) {
  const match = /^(?:(\d+)-)?(\d+):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, days, first, second, third] = match;
  return ((Number(days || 0) * 86400) + (third === undefined ? Number(first) * 60 + Number(second)
    : Number(first) * 3600 + Number(second) * 60 + Number(third))) * 1000;
}
async function readRuntimeOwners(file, now = Date.now()) {
  let stdout;
  try { ({ stdout } = await runFile('/usr/sbin/lsof', ['-Fpc', file], { timeout: 3000, maxBuffer: 65536 })); }
  catch (error) { if (error.code === 1) return []; throw error; }
  const pids = [...new Set([...stdout.matchAll(/^p(\d+)$/gm)].map(match => Number(match[1])))].slice(0, 32);
  const results = await Promise.allSettled(pids.map(async pid => {
    const [{ stdout: processInfo }, { stdout: cwdInfo }] = await Promise.all([
      runFile('/bin/ps', ['-p', String(pid), '-o', 'pid=,etime=,comm='], { timeout: 2000, maxBuffer: 4096 }),
      runFile('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000, maxBuffer: 8192 })
    ]);
    const match = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(processInfo);
    const cwd = /^n(.+)$/m.exec(cwdInfo)?.[1], elapsed = match && elapsedMillis(match[2]);
    if (!match || Number(match[1]) !== pid || match[3] !== 'zcode-cli' || !cwd || elapsed === null) return null;
    return { pid, cwd, startedAt: now - elapsed };
  }));
  return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
}
function projectRuntimeTasks(rows, owners, now = Date.now()) {
  const items = [], results = [];
  for (const row of (Array.isArray(rows) ? rows.slice(0, 256) : [])) {
    if (typeof row.task_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(row.task_id) || !Number.isSafeInteger(row.started_at)) continue;
    const terminal = { completed: 'completed', error: 'failed', cancelled: 'interrupted' };
    const matching = owners.filter(owner => canonicalPath(owner.cwd) === canonicalPath(row.directory) && row.started_at >= owner.startedAt - 1500);
    const live = row.status === 'running' && matching.length === 1 && row.started_at <= now;
    const state = terminal[row.status] || (live ? row.waiting === 1 ? 'waiting' : 'active' : 'unknown');
    const projected = { id: row.task_id, title: typeof row.title === 'string' && row.title.trim() ? row.title.slice(0, 140) : '未命名任务',
      state, turnId: (live || terminal[row.status]) && /^[a-zA-Z0-9_-]{1,160}$/.test(row.turn_id || '') ? row.turn_id : null,
      updatedAt: terminal[row.status] ? row.completed_at || row.started_at : row.started_at,
      source: 'zcode-message-turn', liveVerified: live };
    if (terminal[row.status]) results.push(projected);
    else items.push(projected);
  }
  return { state: 'unknown', items, tasks: items, results, updatedAt: now,
    activity: { runningCount: null, unreadCount: null }, source: 'zcode-message-turn', partial: true };
}
async function readZcodeRuntime({ account, now = Date.now(), home = os.homedir(), env = process.env,
  sessionDbPath, queryRows = queryTaskRows, readOwners = readRuntimeOwners } = {}) {
  let file = sessionDbPath || env.ZCODE_SESSION_DB_PATH || env.ZCODE_SESSION_DB;
  if (!file) {
    try { file = JSON.parse(require('node:fs').readFileSync(path.join(home, '.zcode/cli/config.json'), 'utf8')).storage?.sessionDbPath; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  file = file || path.join(home, '.zcode/cli/db/db.sqlite');
  if (file.startsWith('~/')) file = path.join(home, file.slice(2));
  if (!path.isAbsolute(file)) throw new Error('ZCODE_TASKS_UNAVAILABLE');
  const [rows, owners] = await Promise.all([queryRows(file, RUNTIME_QUERY), readOwners(file, now)]);
  return projectRuntimeTasks(rows, owners, now);
}
async function readZcodeTasks({ account, now = Date.now(), home = os.homedir(), env = process.env,
  queryRows = queryTaskRows, readRuntime = readZcodeRuntime } = {}) {
  const observedAt = typeof now === 'function' ? now() : now;
  const base = account?.baseDir || home;
  const file = path.join(base, '.zcode/v2/tasks-index.sqlite');
  const [index, runtime] = await Promise.allSettled([
    queryRows(file, QUERY).then(rows => projectZcodeTasks(rows, observedAt)),
    readRuntime({ account, home, env, now: observedAt })
  ]);
  const stored = index.status === 'fulfilled' ? index.value : null;
  const live = runtime.status === 'fulfilled' ? runtime.value : null;
  if (live) {
    const ids = new Set([...live.items, ...live.results].map(row => row.id));
    return { ...live, items: [...live.items, ...(stored?.items || []).filter(row => !ids.has(row.id))],
      results: [...live.results, ...(stored?.results || []).filter(row => !ids.has(row.id))] };
  }
  if (stored) return stored;
  return { state: 'unknown', items: [], tasks: [], results: [], activity: { runningCount: null, unreadCount: null },
    updatedAt: observedAt, source: 'zcode-task-index', code: 'ZCODE_TASKS_UNAVAILABLE', partial: true };
}
// ZCode has no verified public per-task deep link; the UI can offer its normal app entry.
async function openZcodeTask() { return { opened: false, code: 'UNSUPPORTED' }; }
module.exports = { readZcodeTasks, projectZcodeTasks, projectRuntimeTasks, readZcodeRuntime, readRuntimeOwners,
  elapsedMillis, openZcodeTask, FRESH_MS };
