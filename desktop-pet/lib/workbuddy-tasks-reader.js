const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fail = code => { throw Object.assign(new Error(code), { code }); };
function cleanTitle(value) {
  return String(value || '未命名任务').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[已隐藏]')
    .replace(/\s+/g, ' ').trim().slice(0, 160) || '未命名任务';
}
function readWorkBuddyTasks({ uid, accountKey, file = path.join(os.homedir(), '.workbuddy/workbuddy.db'),
  Database = require('node:sqlite').DatabaseSync, now = Date.now } = {}) {
  if (typeof uid !== 'string' || !uid || !/^[0-9a-f]{64}$/.test(accountKey || '')) fail('LOGIN_REQUIRED');
  if (!fs.existsSync(file)) fail('TASK_CACHE_UNAVAILABLE');
  let db;
  try {
    db = new Database(file, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
    const required = ['id', 'user_id', 'title', 'custom_title', 'status', 'unread', 'updated_at', 'deleted_at', 'transport'];
    const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(value => value.name));
    if (!required.every(name => columns.has(name))) fail('TASK_CACHE_UNSUPPORTED');
    db.exec('BEGIN');
    const summary = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN unread = 1 THEN 1 ELSE 0 END) AS unread FROM sessions WHERE user_id = ? AND deleted_at IS NULL').get(uid);
    const rows = db.prepare('SELECT id, title, custom_title, status, unread, updated_at, transport FROM sessions WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT 100').all(uid);
    const items = rows.map(row => {
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || ![0, 1].includes(row.unread) ||
          !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) fail('TASK_CACHE_UNSUPPORTED');
      return { id: row.id, title: cleanTitle(row.custom_title || row.title),
        status: typeof row.status === 'string' && /^[a-z_-]{1,40}$/.test(row.status) ? row.status : 'unknown',
        unread: row.unread === 1, updatedAt: row.updated_at,
        transport: ['local', 'remote', 'cloud'].includes(row.transport) ? row.transport : 'unknown' };
    });
    return { accountKey, source: 'local-session-cache', scope: 'current-account', observedAt: now(), running: null,
      pendingReview: Number(summary.unread || 0), pendingReviewSource: 'cached-unread', total: Number(summary.total),
      truncated: Number(summary.total) > items.length, items };
  } catch (error) {
    if (['TASK_CACHE_UNSUPPORTED', 'LOGIN_REQUIRED'].includes(error.code)) throw error;
    fail('TASK_CACHE_UNAVAILABLE');
  } finally { try { db?.close(); } catch (_) {} }
}
module.exports = { readWorkBuddyTasks, cleanTitle };
