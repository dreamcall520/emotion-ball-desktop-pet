'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createMasZcodeTurnStatusReader } = require('../lib/mas-zcode-turn-status');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qiuqiu-zcode-turn-')), root = path.join(temp, '.zcode');
  fs.mkdirSync(path.join(root, 'cli/db'), { recursive: true }); const file = path.join(root, 'cli/db/db.sqlite');
  const db = new DatabaseSync(file); db.exec('CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER)');
  const insert = (...values) => db.prepare('INSERT INTO turn_usage VALUES(?,?,?,?,?)').run(...values);
  let accesses = 0; const read = createMasZcodeTurnStatusReader({ directoryAccess: { withAccess: async (provider, run) => { assert.equal(provider, 'zcode'); accesses++; return run(root); } } });
  t.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  return { root, temp, file, db, insert, read, get accesses() { return accesses; } };
}
test('reads only the exact terminal pair and never guesses from a running or neighboring turn', async t => {
  const f = fixture(t); f.insert('sess_one', 'turn_one', 'running', 10, null); f.insert('sess_one', 'turn_other', 'completed', 10, 20);
  assert.equal(await f.read({ sessionId: 'sess_one', turnId: 'turn_one' }), null);
  f.db.exec("UPDATE turn_usage SET status='completed',completed_at=25 WHERE turn_id='turn_one'");
  assert.deepEqual(await f.read({ sessionId: 'sess_one', turnId: 'turn_one' }), { sessionId: 'sess_one', turnId: 'turn_one', status: 'completed', startedAt: 10, completedAt: 25,
    source: 'zcode-authorized-turn-usage', scope: 'authorized-device-observed-turns', accountAttributionVerified: false });
});
test('SQL is parameterized and reads no title, prompt, reply, message table or credentials', async t => {
  const f = fixture(t), queries = [];
  class TracedDatabase {
    constructor(file, options) { assert.equal(options.readOnly, true); this.db = new DatabaseSync(file, options); }
    exec(query) { assert.match(query, /query_only = ON/); this.db.exec(query); }
    prepare(query) { queries.push(query); return this.db.prepare(query); }
    close() { this.db.close(); }
  }
  const read = createMasZcodeTurnStatusReader({ Database: TracedDatabase, directoryAccess: { withAccess: (_, run) => run(f.root) } });
  await read({ sessionId: 'sess_one', turnId: 'turn_one' }); assert.equal(queries.length, 1);
  assert.match(queries[0], /WHERE session_id=\? AND turn_id=\?/); assert.doesNotMatch(queries[0], /\b(message|title|response|prompt|token|account)\b/);
  await assert.rejects(read({ sessionId: "bad' OR 1", turnId: 'turn_one' }), { code: 'INVALID_TURN' });
});
test('cancellation avoids the grant and symlinked cache or journal cannot escape the selected directory', async t => {
  const f = fixture(t), abort = new AbortController(); abort.abort();
  await assert.rejects(f.read({ sessionId: 'sess_one', turnId: 'turn_one', signal: abort.signal }), { code: 'CANCELLED' }); assert.equal(f.accesses, 0);
  const outside = path.join(f.temp, 'outside'); fs.writeFileSync(outside, 'private'); fs.symlinkSync(outside, f.file + '-journal');
  await assert.rejects(f.read({ sessionId: 'sess_one', turnId: 'turn_one' }), { code: 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY' });
});
