'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanTitle } = require('./workbuddy-tasks-reader');
const REQUIRED = ['id', 'user_id', 'title', 'custom_title', 'status', 'unread', 'updated_at', 'deleted_at', 'transport'];
const SOURCE = 'workbuddy-session-cache';
const SAFE_CODES = new Set(['CLOSED', 'ABORT_ERR', 'DIRECTORY_ACCESS_REQUIRED', 'DIRECTORY_STORAGE_FAILED',
  'WORKBUDDY_DIRECTORY_REQUIRED', 'UNSAFE_TASK_CACHE', 'TASK_CACHE_UNAVAILABLE', 'TASK_CACHE_TOO_LARGE',
  'TASK_CACHE_CHANGED', 'TASK_CACHE_UNSUPPORTED', 'PARTITION_REQUIRED', 'PARTITION_NOT_FOUND']);
const failure = code => Object.assign(new Error(SAFE_CODES.has(code) ? code : 'TASK_CACHE_UNAVAILABLE'),
  { code: SAFE_CODES.has(code) ? code : 'TASK_CACHE_UNAVAILABLE' });
const validUid = value => typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const baseReport = observedAt => ({ source: SOURCE, scope: 'authorized-device-cache',
  accountAttributionVerified: false, running: null, partial: true, observedAt });
const partitionId = (root, uid) => 'wbp-' + createHash('sha256').update('qiuqiu-workbuddy-device-cache-v1\0' + root + '\0' + uid).digest('hex');
function cachedState(status) {
  if (status === 'completed') return 'last-completed';
  if (['terminated', 'cancelled', 'interrupted'].includes(status)) return 'last-interrupted';
  if (['failed', 'error'].includes(status)) return 'last-failed';
  return 'unknown';
}

// No login files, bindings, auth, external tools, model traffic or automatic home discovery.
// DatabaseSync does not expose SQLITE_OPEN_NOFOLLOW. Guard handles use O_NOFOLLOW,
// with inode checks before/after the read; this is not a custom race-proof SQLite VFS.
function createMasWorkBuddyTasks({ directoryAccess, Database = require('node:sqlite').DatabaseSync,
  now = Date.now, maxItems = 100, maxPartitions = 100, maxDatabaseBytes = 64 * 1024 * 1024 } = {}) {
  if (!directoryAccess || typeof directoryAccess.withAccess !== 'function') throw new TypeError('Explicit workbuddy directoryAccess.withAccess is required');
  const limit = Number.isSafeInteger(maxItems) ? Math.max(1, Math.min(100, maxItems)) : 100;
  const partitionLimit = Number.isSafeInteger(maxPartitions) ? Math.max(1, Math.min(100, maxPartitions)) : 100;
  const byteLimit = Number.isSafeInteger(maxDatabaseBytes) ? Math.max(1, Math.min(128 * 1024 * 1024, maxDatabaseBytes)) : 64 * 1024 * 1024;
  let closed = false;
  function check(signal) {
    if (closed) throw failure('CLOSED');
    if (signal?.aborted) throw failure('ABORT_ERR');
  }
  async function inspect(signal, operation) {
    check(signal);
    try {
      return await directoryAccess.withAccess('workbuddy', async directory => {
        check(signal);
        if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.basename(directory) !== '.workbuddy') throw failure('WORKBUDDY_DIRECTORY_REQUIRED');
        const selected = fs.lstatSync(directory);
        if (!selected.isDirectory() || selected.isSymbolicLink()) throw failure('WORKBUDDY_DIRECTORY_REQUIRED');
        const root = fs.realpathSync(directory), file = path.join(root, 'workbuddy.db');
        const guards = []; let db;
        function guard(filename, optional = false) {
          let stat;
          try { stat = fs.lstatSync(filename); }
          catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
          if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(filename)) !== root) throw failure('UNSAFE_TASK_CACHE');
          if (stat.size > byteLimit) throw failure('TASK_CACHE_TOO_LARGE');
          const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          guards.push({ filename, fd });
          const opened = fs.fstatSync(fd);
          if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw failure('TASK_CACHE_CHANGED');
        }
        function unchanged() {
          check(signal);
          for (const item of guards) {
            const stat = fs.lstatSync(item.filename), opened = fs.fstatSync(item.fd);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.ino !== opened.ino || stat.dev !== opened.dev) throw failure('TASK_CACHE_CHANGED');
            if (stat.size > byteLimit) throw failure('TASK_CACHE_TOO_LARGE');
          }
        }
        try {
          guard(file);
          for (const suffix of ['-wal', '-shm', '-journal']) guard(file + suffix, true);
          check(signal);
          db = new Database(file, { readOnly: true });
          unchanged();
          db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000; BEGIN;');
          const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(row => row.name));
          const schemaSupported = REQUIRED.every(name => columns.has(name));
          const observedAt = now();
          const value = operation({ db, root, schemaSupported, observedAt, check: () => check(signal) });
          unchanged();
          return value;
        } finally {
          try { db?.close(); } finally { for (const item of guards) try { fs.closeSync(item.fd); } catch (_) {} }
        }
      });
    } catch (error) { throw failure(error?.code); }
  }
  function summary(db) {
    const row = db.prepare(`SELECT COUNT(*) AS records,
      COUNT(DISTINCT CASE WHEN typeof(user_id)='text' AND length(user_id) BETWEEN 1 AND 256 THEN user_id END) AS partitions
      FROM sessions WHERE deleted_at IS NULL`).get();
    return { recordCount: Number(row.records), partitionCount: Number(row.partitions) };
  }
  function partitions(db, root) {
    return db.prepare(`SELECT user_id, COUNT(*) AS records, MAX(updated_at) AS latest
      FROM sessions WHERE deleted_at IS NULL AND typeof(user_id)='text' AND length(user_id) BETWEEN 1 AND 256
      GROUP BY user_id ORDER BY latest DESC, user_id ASC LIMIT ${partitionLimit}`).all()
      .filter(row => validUid(row.user_id)).map(row => ({ uid: row.user_id,
        partitionId: partitionId(root, row.user_id), count: Number(row.records), latestUpdatedAt: validTime(row.latest) }));
  }
  async function probe({ signal } = {}) {
    return inspect(signal, ({ db, schemaSupported, observedAt }) => ({ ...baseReport(observedAt), schemaSupported,
      ...(schemaSupported ? summary(db) : { recordCount: null, partitionCount: null, code: 'TASK_CACHE_UNSUPPORTED' }) }));
  }
  async function listPartitions({ signal } = {}) {
    return inspect(signal, ({ db, root, schemaSupported, observedAt }) => {
      if (!schemaSupported) throw failure('TASK_CACHE_UNSUPPORTED');
      const totals = summary(db), groups = partitions(db, root);
      return { ...baseReport(observedAt), ...totals, truncated: totals.partitionCount > groups.length,
        partitions: groups.map(({ uid: _ignored, ...safe }) => safe) };
    });
  }
  async function read({ partitionId: selectedPartition, signal } = {}) {
    check(signal);
    if (typeof selectedPartition !== 'string' || !/^wbp-[a-f0-9]{64}$/.test(selectedPartition)) throw failure('PARTITION_REQUIRED');
    return inspect(signal, ({ db, root, schemaSupported, observedAt, check: stillOpen }) => {
      if (!schemaSupported) throw failure('TASK_CACHE_UNSUPPORTED');
      const selected = partitions(db, root).find(group => group.partitionId === selectedPartition);
      if (!selected) throw failure('PARTITION_NOT_FOUND');
      stillOpen();
      const counts = db.prepare('SELECT COUNT(*) AS records, SUM(CASE WHEN unread=1 THEN 1 ELSE 0 END) AS unread FROM sessions WHERE user_id=? AND deleted_at IS NULL').get(selected.uid);
      const rows = db.prepare(`SELECT id,title,custom_title,status,unread,updated_at,transport FROM sessions
        WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id ASC LIMIT ${limit}`).all(selected.uid);
      const items = rows.flatMap(row => {
        if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || ![0, 1].includes(row.unread) || validTime(row.updated_at) === null) return [];
        return [{ id: row.id, title: cleanTitle(row.custom_title || row.title), state: cachedState(row.status),
          unread: row.unread === 1, updatedAt: row.updated_at,
          transport: ['local', 'remote', 'cloud'].includes(row.transport) ? row.transport : 'unknown',
          partial: true, source: SOURCE }];
      });
      return { ...baseReport(observedAt), partitionId: selectedPartition, total: Number(counts.records),
        pendingReview: Number(counts.unread || 0), pendingReviewSource: 'cached-unread',
        truncated: Number(counts.records) > items.length, items };
    });
  }
  return { probe, listPartitions, read, close() { closed = true; } };
}

module.exports = { createMasWorkBuddyTasks };
