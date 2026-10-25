const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readWorkBuddyTasks } = require('../lib/workbuddy-tasks-reader');
const accountKey = 'a'.repeat(64);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-task-reader-test-')), file = path.join(dir, 'tasks.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions(id TEXT, user_id TEXT, title TEXT, custom_title TEXT, status TEXT, unread INTEGER, updated_at INTEGER, deleted_at INTEGER, transport TEXT, body TEXT)');
  const insert = db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)');
  return { file, db, add(id, uid, { unread = 0, deleted = null, title = '任务标题', custom = '', status = 'completed', at = 1000, transport = 'local' } = {}) {
    insert.run(id, uid, title, custom, status, unread, at, deleted, transport, 'SECRET_BODY_MUST_NOT_BE_READ');
  } };
}
test('cached tasks bind current account, exclude deleted and never expose credentials, user IDs or bodies', t => {
  const f = fixture(t); f.add('task-a', 'current', { unread: 1, custom: '自定义\n标题', status: 'running' });
  f.add('task-b', 'other', { unread: 1, title: 'OTHER_ACCOUNT_SECRET' }); f.add('task-deleted', 'current', { deleted: 123, unread: 1 });
  f.db.close();
  const result = readWorkBuddyTasks({ uid: 'current', accountKey, file: f.file, now: () => 2000 });
  assert.equal(result.total, 1); assert.equal(result.pendingReview, 1); assert.equal(result.running, null);
  assert.equal(result.scope, 'current-account'); assert.equal(result.source, 'local-session-cache'); assert.equal(result.observedAt, 2000);
  assert.equal(result.items[0].title, '自定义 标题'); assert.equal(result.items[0].status, 'running'); assert.equal(result.items[0].unread, true);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['id', 'title', 'status', 'unread', 'updatedAt', 'transport'].sort());
  const serialized = JSON.stringify(result); assert(!serialized.includes('SECRET')); assert(!serialized.includes('user_id'));
  const check = new DatabaseSync(f.file, { readOnly: true }); assert.equal(check.prepare('SELECT unread FROM sessions WHERE id=?').get('task-a').unread, 1); check.close();
});
test('list is bounded at 100 while cached unread count includes all current-account nondeleted tasks', t => {
  const f = fixture(t); for (let index = 0; index < 105; index++) f.add('task-' + index, 'current', { at: index, unread: 1 });
  f.db.close();
  const result = readWorkBuddyTasks({ uid: 'current', accountKey, file: f.file });
  assert.equal(result.items.length, 100); assert.equal(result.total, 105); assert.equal(result.pendingReview, 105); assert.equal(result.truncated, true);
  assert.equal(result.items[0].updatedAt, 104); assert.equal(result.items.at(-1).updatedAt, 5);
});
test('missing, malformed schema and missing account fail safely; no unfiltered fallback', t => {
  const f = fixture(t); f.add('task-a', 'other'); f.db.close();
  assert.throws(() => readWorkBuddyTasks({ uid: '', accountKey, file: f.file }), { code: 'LOGIN_REQUIRED' });
  assert.equal(readWorkBuddyTasks({ uid: 'absent', accountKey, file: f.file }).items.length, 0);
  assert.throws(() => readWorkBuddyTasks({ uid: 'current', accountKey, file: f.file + '-missing' }), { code: 'TASK_CACHE_UNAVAILABLE' });
  const db = new DatabaseSync(f.file); db.exec('ALTER TABLE sessions RENAME COLUMN user_id TO obsolete'); db.close();
  assert.throws(() => readWorkBuddyTasks({ uid: 'current', accountKey, file: f.file }), { code: 'TASK_CACHE_UNSUPPORTED' });
});
test('title is bounded plain metadata with credential-shaped substrings redacted', t => {
  const f = fixture(t); f.add('task-a', 'current', { title: 'Bearer test-token-value sk-abcdefghijklmnop\u0000' + '长'.repeat(200) }); f.db.close();
  const title = readWorkBuddyTasks({ uid: 'current', accountKey, file: f.file }).items[0].title;
  assert(title.length <= 160); assert(!title.includes('test-token-value')); assert(!title.includes('sk-')); assert(!title.includes('\u0000'));
});
