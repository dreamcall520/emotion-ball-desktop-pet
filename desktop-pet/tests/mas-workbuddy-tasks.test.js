const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createMasWorkBuddyTasks } = require('../lib/mas-workbuddy-tasks');
const NOW = 1793390400000;
function fixture(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-workbuddy-tasks-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, '.workbuddy'); fs.mkdirSync(root);
  const file = path.join(root, 'workbuddy.db'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions(id TEXT,user_id TEXT,title TEXT,custom_title TEXT,status TEXT,unread INTEGER,updated_at INTEGER,deleted_at INTEGER,transport TEXT,body TEXT,access_token TEXT)');
  const insert = db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const add = (id, uid, row = {}) => insert.run(id, uid, row.title || 'PRIVATE_TITLE', row.custom || '', row.status || 'running',
    row.unread ?? 1, row.at ?? NOW, row.deleted ?? null, row.transport || 'local', 'SECRET_BODY', 'SECRET_TOKEN');
  const calls = []; let permitted = true;
  const directoryAccess = { withAccess: async (provider, operation) => {
    assert.equal(provider, 'workbuddy'); if (!permitted) throw Object.assign(new Error(), { code: 'DIRECTORY_ACCESS_REQUIRED' });
    calls.push('start'); try { return await operation(root); } finally { calls.push('stop'); }
  } };
  const reader = createMasWorkBuddyTasks({ directoryAccess, now: () => NOW, ...options });
  return { temp, root, file, db, add, reader, calls, directoryAccess, revoke: () => { permitted = false; } };
}

test('默认probe仅统计schema/分区/记录，不读取标题/正文或猜当前账户', async t => {
  const queries = [];
  class InspectDatabase extends DatabaseSync { prepare(query) { queries.push(query); return super.prepare(query); } }
  const f = fixture(t, { Database: InspectDatabase });
  f.add('a', 'PRIVATE_UID_A'); f.add('b', 'PRIVATE_UID_B'); f.add('deleted', 'PRIVATE_UID_A', { deleted: NOW });
  f.db.close();
  const report = await f.reader.probe();
  assert.equal(report.schemaSupported, true); assert.equal(report.partitionCount, 2); assert.equal(report.recordCount, 2);
  assert.equal(report.scope, 'authorized-device-cache'); assert.equal(report.accountAttributionVerified, false);
  assert.equal(report.running, null); assert.equal(report.partial, true); assert.equal(Object.hasOwn(report, 'items'), false);
  assert.ok(queries.every(query => !/SELECT.*(?:title|body|access_token)/i.test(query)));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|SECRET_|workbuddy\.db/);
  await assert.rejects(f.reader.read(), { code: 'PARTITION_REQUIRED' });
});

test('分区列表只返回opaque标识与数量/时间，只有显式选择才能读其metadata', async t => {
  const f = fixture(t);
  f.add('a', 'PRIVATE_UID_A', { title: 'A selected', at: NOW });
  f.add('b', 'PRIVATE_UID_B', { title: 'B unselected', at: NOW - 1 }); f.db.close();
  const partitions = await f.reader.listPartitions();
  assert.equal(partitions.partitions.length, 2);
  assert.ok(partitions.partitions.every(row => /^wbp-[a-f0-9]{64}$/.test(row.partitionId)));
  assert.deepEqual(Object.keys(partitions.partitions[0]).sort(), ['count', 'latestUpdatedAt', 'partitionId']);
  assert.doesNotMatch(JSON.stringify(partitions), /PRIVATE_|selected/);
  const selected = partitions.partitions[0].partitionId;
  const report = await f.reader.read({ partitionId: selected });
  assert.equal(report.items.length, 1); assert.equal(report.items[0].id, 'a');
  assert.equal(report.items[0].title, 'A selected'); assert.equal(report.items[0].state, 'unknown');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_UID|SECRET_|B unselected/);
  assert.equal(report.accountAttributionVerified, false); assert.equal(report.running, null);
  const reopened = createMasWorkBuddyTasks({ directoryAccess: f.directoryAccess });
  assert.equal((await reopened.listPartitions()).partitions[0].partitionId, selected);
});

test('历史running/waiting/idle均unknown，终态明确last-标签，不由mtime推活跃', async t => {
  const f = fixture(t);
  for (const status of ['running', 'waiting', 'idle', 'completed', 'terminated', 'failed']) f.add(status, 'one', { status });
  f.db.close(); fs.utimesSync(f.file, Date.now() / 1000, Date.now() / 1000);
  const id = (await f.reader.listPartitions()).partitions[0].partitionId;
  const report = await f.reader.read({ partitionId: id });
  for (const status of ['running', 'waiting', 'idle']) assert.equal(report.items.find(row => row.id === status).state, 'unknown');
  assert.equal(report.items.find(row => row.id === 'completed').state, 'last-completed');
  assert.equal(report.items.find(row => row.id === 'terminated').state, 'last-interrupted');
  assert.equal(report.items.find(row => row.id === 'failed').state, 'last-failed');
  assert.equal(report.running, null);
});

test('metadata最多100行，缓存未读统计不受列表截断影响且不修改数据库', async t => {
  const f = fixture(t, { maxItems: 1000 });
  for (let n = 0; n < 105; n++) f.add('task-' + n, 'one', { at: NOW - n, title: 'Bearer synthetic-secret-token sk-abcdefghijklmnop' });
  f.db.close(); const before = fs.readFileSync(f.file);
  const id = (await f.reader.listPartitions()).partitions[0].partitionId;
  const report = await f.reader.read({ partitionId: id });
  assert.equal(report.items.length, 100); assert.equal(report.total, 105); assert.equal(report.pendingReview, 105);
  assert.equal(report.pendingReviewSource, 'cached-unread'); assert.equal(report.truncated, true);
  assert.doesNotMatch(JSON.stringify(report.items), /synthetic-secret-token|sk-abcdefghijklmnop/);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('分区选择受所选目录绑定，未知/其他目录的opaque标识不能读账户', async t => {
  const one = fixture(t), two = fixture(t);
  one.add('one', 'same-user'); two.add('two', 'same-user'); one.db.close(); two.db.close();
  const id = (await one.reader.listPartitions()).partitions[0].partitionId;
  await assert.rejects(two.reader.read({ partitionId: id }), { code: 'PARTITION_NOT_FOUND' });
  await assert.rejects(one.reader.read({ partitionId: 'same-user' }), { code: 'PARTITION_REQUIRED' });
});

test('缺schema不伪装空任务，缺数据库/过大数据库明确失败', async t => {
  const f = fixture(t); f.db.exec('ALTER TABLE sessions RENAME COLUMN user_id TO obsolete'); f.db.close();
  const report = await f.reader.probe();
  assert.equal(report.schemaSupported, false); assert.equal(report.partitionCount, null); assert.equal(report.recordCount, null);
  assert.equal(report.code, 'TASK_CACHE_UNSUPPORTED');
  await assert.rejects(f.reader.listPartitions(), { code: 'TASK_CACHE_UNSUPPORTED' });
  const small = createMasWorkBuddyTasks({ directoryAccess: f.directoryAccess, maxDatabaseBytes: 1 });
  await assert.rejects(small.probe(), { code: 'TASK_CACHE_TOO_LARGE' });
  fs.unlinkSync(f.file); await assert.rejects(f.reader.probe(), { code: 'TASK_CACHE_UNAVAILABLE' });
});

test('拒绝DB和WAL/SHM符号链接，拒绝把普通home作为授权目录', async t => {
  const f = fixture(t); f.db.close();
  const outside = path.join(f.temp, 'outside.db'); fs.copyFileSync(f.file, outside); fs.unlinkSync(f.file); fs.symlinkSync(outside, f.file);
  await assert.rejects(f.reader.probe(), { code: 'UNSAFE_TASK_CACHE' });
  fs.unlinkSync(f.file); fs.copyFileSync(outside, f.file);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    fs.symlinkSync(outside, f.file + suffix);
    await assert.rejects(f.reader.probe(), { code: 'UNSAFE_TASK_CACHE' }); fs.unlinkSync(f.file + suffix);
  }
  const wrong = createMasWorkBuddyTasks({ directoryAccess: { withAccess: (_, operation) => operation(f.temp) } });
  await assert.rejects(wrong.probe(), { code: 'WORKBUDDY_DIRECTORY_REQUIRED' });
});

test('读活动WAL缓存仍只返回metadata，连接以readOnly打开且无外部工具', async t => {
  const modes = [];
  class InspectDatabase extends DatabaseSync { constructor(file, options) { modes.push(options); super(file, options); } }
  const f = fixture(t, { Database: InspectDatabase });
  f.db.exec('PRAGMA journal_mode=WAL'); f.add('wal-task', 'one', { status: 'completed' });
  const id = (await f.reader.listPartitions()).partitions[0].partitionId;
  const report = await f.reader.read({ partitionId: id });
  assert.equal(report.items[0].id, 'wal-task'); assert.equal(report.items[0].state, 'last-completed');
  assert.ok(modes.every(options => options.readOnly === true));
  assert.doesNotMatch(JSON.stringify(report), /SECRET_BODY|SECRET_TOKEN/);
  f.db.close();
});

test('授权撤销/取消/关闭明确失败，不自动扫home或回落其他账号', async t => {
  const f = fixture(t); f.db.close();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reader.probe({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.deepEqual(f.calls, []);
  f.revoke(); await assert.rejects(f.reader.listPartitions(), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  f.reader.close(); await assert.rejects(f.reader.probe(), { code: 'CLOSED' });
  await assert.rejects(f.reader.read({ partitionId: 'wbp-' + 'a'.repeat(64) }), { code: 'CLOSED' });
  assert.throws(() => createMasWorkBuddyTasks(), /Explicit workbuddy/);
});

test('授权等待期间close不会再打开数据库，取消查询后作用域仍释放', async t => {
  const f = fixture(t); f.db.close(); let release;
  const waiting = createMasWorkBuddyTasks({ directoryAccess: { withAccess: (_, operation) => new Promise(resolve => { release = () => resolve(operation(f.root)); }) } });
  const pending = waiting.probe(); waiting.close(); release(); await assert.rejects(pending, { code: 'CLOSED' });
  const controller = new AbortController();
  class AbortingDatabase extends DatabaseSync { prepare(query) { if (query.startsWith('SELECT COUNT')) controller.abort(); return super.prepare(query); } }
  const aborting = createMasWorkBuddyTasks({ directoryAccess: f.directoryAccess, Database: AbortingDatabase });
  await assert.rejects(aborting.probe({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.deepEqual(f.calls, ['start', 'stop']);
});


test('数据库在打开时被替换则拒绝结果，不能把旧guard当作新路径授权', async t => {
  const f = fixture(t); f.add('one', 'one'); f.db.close();
  class ReplacingDatabase extends DatabaseSync {
    constructor(file, options) {
      super(file, options); fs.renameSync(file, file + '.rotated'); fs.copyFileSync(file + '.rotated', file);
    }
  }
  const replaced = createMasWorkBuddyTasks({ directoryAccess: f.directoryAccess, Database: ReplacingDatabase });
  await assert.rejects(replaced.probe(), { code: 'TASK_CACHE_CHANGED' });
  assert.deepEqual(f.calls, ['start', 'stop']);
});
