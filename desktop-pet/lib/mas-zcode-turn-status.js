'use strict';
const fs = require('node:fs');
const path = require('node:path');
const fail = code => Object.assign(new Error(code), { code });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const QUERY = `SELECT session_id,turn_id,status,started_at,completed_at FROM turn_usage
  WHERE session_id=? AND turn_id=? AND status IN ('completed','error','cancelled') LIMIT 1`;

// Only terminal metadata for an already observed exact turn. No message, title,
// prompt, response, token or account field is queried. This device cache has no
// account ownership column; caller identity guards do not change that fact.
function createMasZcodeTurnStatusReader({ directoryAccess,
  Database = require('node:sqlite').DatabaseSync, io = fs } = {}) {
  if (typeof directoryAccess?.withAccess !== 'function') throw new TypeError('directoryAccess.withAccess required');
  return async function readTurnStatus({ sessionId, turnId, signal } = {}) {
    if (!validId(sessionId) || !validId(turnId)) throw fail('INVALID_TURN');
    if (signal?.aborted) throw fail('CANCELLED');
    return directoryAccess.withAccess('zcode', directory => {
      if (signal?.aborted) throw fail('CANCELLED');
      if (!path.isAbsolute(directory || '') || path.basename(directory) !== '.zcode') throw fail('ZCODE_DIRECTORY_REQUIRED');
      const root = io.realpathSync(directory), file = path.join(directory, 'cli/db/db.sqlite');
      function checked(candidate) {
        let at = directory;
        for (const part of path.relative(directory, candidate).split(path.sep)) {
          at = path.join(at, part);
          if (io.lstatSync(at).isSymbolicLink()) throw fail('ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY');
        }
        const real = io.realpathSync(candidate);
        if (!real.startsWith(root + path.sep)) throw fail('ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY');
        return real;
      }
      const canonical = checked(file);
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try { checked(file + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      let db;
      try {
        db = new Database(canonical, { readOnly: true });
        db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
        const row = db.prepare(QUERY).get(sessionId, turnId);
        if (signal?.aborted) throw fail('CANCELLED');
        if (!row || row.session_id !== sessionId || row.turn_id !== turnId ||
          !['completed', 'error', 'cancelled'].includes(row.status) ||
          !Number.isSafeInteger(row.started_at) || row.started_at < 0 ||
          !Number.isSafeInteger(row.completed_at) || row.completed_at < row.started_at) return null;
        return { sessionId, turnId, status: row.status, startedAt: row.started_at, completedAt: row.completed_at,
          source: 'zcode-authorized-turn-usage', scope: 'authorized-device-observed-turns', accountAttributionVerified: false };
      } finally { db?.close(); }
    });
  };
}
module.exports = { createMasZcodeTurnStatusReader };
