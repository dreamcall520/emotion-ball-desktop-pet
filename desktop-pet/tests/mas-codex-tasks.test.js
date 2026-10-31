const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMasCodexTasks } = require('../lib/mas-codex-tasks');
const NOW = 1793390400000;
const meta = (id, extra = {}) => ({ timestamp: new Date(NOW - 100000).toISOString(), type: 'session_meta',
  payload: { id, cwd: '/synthetic/project', source: 'vscode', ...extra } });
const event = (type, turn, at, extra = {}) => ({ timestamp: new Date(at).toISOString(), type: 'event_msg',
  payload: { type, ...(turn ? { turn_id: turn } : {}), ...extra } });
const encode = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
function fixture(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-codex-tasks-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, '.codex'), day = path.join(root, 'sessions/2026/10/31');
  fs.mkdirSync(day, { recursive: true });
  const calls = []; let authorized = true;
  const reader = createMasCodexTasks({ directoryAccess: { withAccess: async (provider, operation) => {
    assert.equal(provider, 'codex');
    if (!authorized) throw Object.assign(new Error('re-authorize'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
    calls.push('start'); try { return await operation(root); } finally { calls.push('stop'); }
  } }, now: () => NOW, ...options });
  const write = (name, records) => {
    const file = path.join(day, name + '.jsonl'); fs.writeFileSync(file, Array.isArray(records) ? encode(records) : records); return file;
  };
  return { temp, root, day, reader, calls, write, revoke: () => { authorized = false; } };
}

test('精确start→complete与abort证据驱动状态，输出无原始消息或路径', async t => {
  const f = fixture(t);
  const file = f.write('task', [meta('task-a'), event('task_started', 'turn-a', NOW - 1000)]);
  let [row] = await f.reader.read();
  assert.deepEqual(row, { id: 'task-a', title: 'Codex 任务', state: 'active', turnId: 'turn-a',
    updatedAt: NOW - 1000, partial: true, source: 'codex-session-log' });
  fs.appendFileSync(file, encode([event('task_complete', 'turn-a', NOW - 100, { last_agent_message: 'PRIVATE_RAW_TEXT' })]));
  [row] = await f.reader.read(); assert.equal(row.state, 'completed');
  fs.appendFileSync(file, encode([event('task_started', 'turn-b', NOW - 50), event('turn_aborted', 'turn-b', NOW - 10)]));
  [row] = await f.reader.read(); assert.equal(row.state, 'interrupted'); assert.equal(row.turnId, 'turn-b');
  assert.equal(JSON.stringify(row).includes('PRIVATE_RAW_TEXT'), false);
  assert.equal(JSON.stringify(row).includes('/synthetic'), false);
  assert.deepEqual(f.calls, ['start', 'stop', 'start', 'stop', 'start', 'stop']);
});

test('旧start即使文件mtime新也为unknown，工具失败不等于整轮failed', async t => {
  const f = fixture(t);
  f.write('old', [meta('old'), event('task_started', 'old-turn', NOW - 300000)]);
  f.write('tool-failed', [meta('tool-failed'), event('task_started', 'current', NOW - 100),
    event('error', 'current', NOW - 20, { message: 'tool failed' }),
    { timestamp: new Date(NOW - 10).toISOString(), type: 'response_item', payload: { type: 'function_call_output', output: 'exit code 1' } }]);
  const rows = await f.reader.read();
  assert.equal(rows.find(row => row.id === 'old').state, 'unknown');
  assert.equal(rows.find(row => row.id === 'tool-failed').state, 'active');
  assert.ok(rows.every(row => row.partial));
});

test('完整换行才是证据，半行与畸形JSON不能误标完成', async t => {
  const f = fixture(t);
  const text = encode([meta('half'), event('task_started', 'turn', NOW - 100)]) + '{bad json}\n' + JSON.stringify(event('task_complete', 'turn', NOW - 10));
  const file = f.write('half', text);
  assert.equal((await f.reader.read())[0].state, 'active');
  fs.appendFileSync(file, '\n');
  assert.equal((await f.reader.read())[0].state, 'completed');
});

test('以事件时间而非文件顺序还原同轮状态，迟到的旧轮完成不覆盖新轮start', async t => {
  const f = fixture(t);
  f.write('order', [meta('out-of-order'), event('task_complete', 'old', NOW - 100, { started_at: (NOW - 10000) / 1000 }),
    event('task_started', 'new', NOW - 200), event('task_started', 'old', NOW - 10000)]);
  const [row] = await f.reader.read();
  assert.equal(row.state, 'active'); assert.equal(row.turnId, 'new');
});

test('副agent、父线程、未知来源和球球聊天workspace均可排除', async t => {
  const filtered = [];
  const f = fixture(t, { ignoreTask: id => id === 'ignored-id', ignoreThread: thread => {
    filtered.push(thread); return thread.cwd === '/synthetic/qiuqiu-chat';
  } });
  for (const [id, extra] of [
    ['subagent', { source: { subagent: { thread_spawn: {} } } }], ['child', { parent_thread_id: 'parent' }],
    ['unknown', { source: 'unknown' }], ['hidden-child', { thread_source: { subagent: {} } }], ['ignored-id', {}], ['chat', { cwd: '/synthetic/qiuqiu-chat' }], ['main', {}]
  ]) f.write(id, [meta(id, extra), event('task_started', id + '-turn', NOW - 100)]);
  assert.deepEqual((await f.reader.read()).map(row => row.id), ['main']);
  assert.equal(filtered.some(thread => thread.cwd === '/synthetic/qiuqiu-chat'), true);
});

test('超过8KB的真实metadata形态仍可解析，未知/半截metadata不猜线程', async t => {
  const f = fixture(t);
  f.write('large-meta', [meta('large-meta', { base_instructions: 'x'.repeat(30000) }), event('task_complete', 'turn', NOW - 10)]);
  f.write('no-meta', [event('task_started', 'unknown', NOW - 10)]);
  const rows = await f.reader.read();
  assert.deepEqual(rows.map(row => row.id), ['large-meta']);
  assert.equal(rows[0].state, 'completed');
});

test('超大日志只读首尾，保留尾部完成且严格受每段与总字节数限制', async t => {
  let maximumRead = 0, totalRead = 0;
  const io = { ...fs.promises, open: async (...args) => {
    const handle = await fs.promises.open(...args), read = handle.read.bind(handle);
    handle.read = async (buffer, offset, length, position) => {
      maximumRead = Math.max(maximumRead, length); const result = await read(buffer, offset, length, position);
      totalRead += result.bytesRead; return result;
    };
    return handle;
  } };
  const f = fixture(t, { io, headBytes: 1024, tailBytes: 2048, maxTotalBytes: 3072 });
  const text = encode([meta('large'), event('task_started', 'turn', NOW - 1000)]) +
    encode([{ type: 'response_item', payload: { type: 'message', content: 'DO_NOT_OUTPUT_' + 'x'.repeat(2000000) } }]) +
    encode([event('task_complete', 'turn', NOW - 10)]);
  f.write('large', text);
  const rows = await f.reader.read();
  assert.equal(rows[0].state, 'completed');
  assert.ok(maximumRead <= 2048); assert.ok(totalRead <= 3072);
  assert.equal(f.reader.getDiagnostics().bytesRead, totalRead);
  assert.equal(JSON.stringify(rows).includes('DO_NOT_OUTPUT'), false);
});

test('限制目录深度、文件数与条目数量，跳过所有符号链接', async t => {
  const f = fixture(t, { maxFiles: 1 });
  f.write('a', [meta('a')]); f.write('z', [meta('z')]);
  const outside = path.join(f.temp, 'outside.jsonl'); fs.writeFileSync(outside, encode([meta('outside')]));
  fs.symlinkSync(outside, path.join(f.day, 'zz-symlink.jsonl'));
  fs.mkdirSync(path.join(f.day, 'too-deep')); fs.writeFileSync(path.join(f.day, 'too-deep/a.jsonl'), encode([meta('deep')]));
  assert.deepEqual((await f.reader.read()).map(row => row.id), ['z']);
  assert.equal(f.reader.getDiagnostics().filesRead, 1);
  assert.equal(f.reader.getDiagnostics().bounded, true);
  const shallow = createMasCodexTasks({ directoryAccess: { withAccess: (_, fn) => fn(f.root) }, maxDepth: 1, now: () => NOW });
  assert.deepEqual(await shallow.read(), []);
  const entries = createMasCodexTasks({ directoryAccess: { withAccess: (_, fn) => fn(f.root) }, maxEntries: 1, now: () => NOW });
  assert.deepEqual(await entries.read(), []); assert.equal(entries.getDiagnostics().bounded, true);
});

test('授权撤销、abort会明确失败并释放作用域，不能回落默认home', async t => {
  const f = fixture(t);
  f.write('a', [meta('a')]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reader.read({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.deepEqual(f.calls, []);
  f.revoke(); await assert.rejects(f.reader.read(), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.throws(() => createMasCodexTasks(), /Explicit directoryAccess/);
});

test('缺少turn_id的abort只归于已经观察到的当前轮，未知abort不猜turn', async t => {
  const f = fixture(t);
  f.write('abort', [meta('abort'), event('task_started', 'turn', NOW - 100), event('turn_aborted', null, NOW - 10)]);
  f.write('unknown', [meta('unknown'), event('turn_aborted', null, NOW - 10)]);
  const rows = await f.reader.read();
  assert.equal(rows.find(row => row.id === 'abort').state, 'interrupted');
  assert.equal(rows.find(row => row.id === 'unknown').state, 'unknown');
});


test('读取中途abort也拒绝结果并释放授权scope', async t => {
  const controller = new AbortController();
  const io = { ...fs.promises, open: async (...args) => {
    const handle = await fs.promises.open(...args), read = handle.read.bind(handle);
    handle.read = async (...readArgs) => { const result = await read(...readArgs); controller.abort(); return result; };
    return handle;
  } };
  const f = fixture(t, { io }); f.write('abort-read', [meta('abort-read')]);
  await assert.rejects(f.reader.read({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.deepEqual(f.calls, ['start', 'stop']);
});

test('长任务只有明确同轮活动时间才能续active：显式turn或连续turn_context均支持', async t => {
  const f = fixture(t);
  f.write('explicit-heartbeat', [meta('explicit'), event('task_started', 'turn', NOW - 300000),
    event('agent_reasoning', 'turn', NOW - 10, { text: 'PRIVATE_REASONING' })]);
  f.write('context-heartbeat', [meta('context'), event('task_started', 'turn', NOW - 300000),
    { timestamp: new Date(NOW - 299999).toISOString(), type: 'turn_context', payload: { turn_id: 'turn' } },
    { timestamp: new Date(NOW - 10).toISOString(), type: 'response_item', payload: { type: 'function_call_output', output: 'PRIVATE_TOOL_OUTPUT' } }]);
  f.write('unattributed', [meta('unattributed'), event('task_started', 'turn', NOW - 300000), event('agent_reasoning', null, NOW - 10)]);
  f.write('wrong-turn', [meta('wrong-turn'), event('task_started', 'turn', NOW - 300000), event('agent_reasoning', 'other', NOW - 10)]);
  const rows = await f.reader.read();
  assert.equal(rows.find(row => row.id === 'explicit').state, 'active');
  assert.equal(rows.find(row => row.id === 'context').state, 'active');
  assert.equal(rows.find(row => row.id === 'context').updatedAt, NOW - 10);
  assert.equal(rows.find(row => row.id === 'unattributed').state, 'unknown');
  assert.equal(rows.find(row => row.id === 'wrong-turn').state, 'unknown');
  assert.equal(JSON.stringify(rows).includes('PRIVATE_'), false);
});

test('完成/中断后迟到reasoning或重复start都不复活，user_message不让idle变active', async t => {
  const f = fixture(t);
  f.write('completed-heartbeat', [meta('completed-heartbeat'), event('task_started', 'turn', NOW - 300000),
    event('task_complete', 'turn', NOW - 100), event('agent_reasoning', 'turn', NOW - 10), event('task_started', 'turn', NOW - 5)]);
  f.write('interrupted-heartbeat', [meta('interrupted-heartbeat'), event('task_started', 'turn', NOW - 300000),
    event('turn_aborted', 'turn', NOW - 100), event('agent_reasoning', 'turn', NOW - 10)]);
  f.write('user-only', [meta('user-only'), event('user_message', 'turn', NOW - 10, { message: 'do work' })]);
  f.write('context-only', [meta('context-only'),
    { timestamp: new Date(NOW - 100).toISOString(), type: 'turn_context', payload: { turn_id: 'turn' } },
    event('agent_reasoning', null, NOW - 10)]);
  const rows = await f.reader.read();
  assert.equal(rows.find(row => row.id === 'completed-heartbeat').state, 'completed');
  assert.equal(rows.find(row => row.id === 'interrupted-heartbeat').state, 'interrupted');
  assert.equal(rows.find(row => row.id === 'user-only').state, 'unknown');
  assert.equal(rows.find(row => row.id === 'context-only').state, 'unknown');
});

test('首尾跳段清空上下文，尾部无turn_id的活动不能续旧任务active', async t => {
  const f = fixture(t, { headBytes: 1024, tailBytes: 1024 });
  f.write('gap', encode([meta('gap'), event('task_started', 'old-turn', NOW - 300000),
    { timestamp: new Date(NOW - 299999).toISOString(), type: 'turn_context', payload: { turn_id: 'old-turn' } }]) +
    encode([{ type: 'response_item', payload: { type: 'message', content: 'x'.repeat(30000) } }]) +
    encode([event('agent_reasoning', null, NOW - 10)]));
  const [row] = await f.reader.read();
  assert.equal(row.state, 'unknown'); assert.equal(row.turnId, 'old-turn');
});

test('近期mtime只用于优先读取：旧大日志和新文件名不能饿死仍在追加的旧会话', async t => {
  const f = fixture(t, { maxFiles: 1, headBytes: 1024, tailBytes: 1024, maxTotalBytes: 2048 });
  for (let n = 0; n < 8; n++) {
    const old = f.write('z-old-' + n, encode([meta('old-' + n)]) +
      encode([{ type: 'response_item', payload: { type: 'message', content: 'x'.repeat(10000) } }]));
    fs.utimesSync(old, (NOW - 500000) / 1000, (NOW - 500000) / 1000);
  }
  const recent = f.write('a-old-session-still-appending', [meta('recent'), event('task_started', 'turn', NOW - 100)]);
  fs.utimesSync(recent, NOW / 1000, NOW / 1000);
  const rows = await f.reader.read();
  assert.deepEqual(rows.map(row => row.id), ['recent']);
  assert.equal(rows[0].state, 'active');
  assert.equal(f.reader.getDiagnostics().filesRead, 1);
  assert.ok(f.reader.getDiagnostics().bytesRead <= 2048);
});

test('被排除的子agent只花metadata分段预算，不能消耗整段head挤掉主任务', async t => {
  const f = fixture(t, { maxFiles: 8, maxTotalBytes: 70000, headBytes: 65536, tailBytes: 1024 });
  for (let n = 0; n < 2; n++) {
    const child = f.write('z-child-' + n, encode([meta('child-' + n, { source: { subagent: {} }, base_instructions: 'x'.repeat(20000) })]) +
      encode([{ type: 'response_item', payload: { content: 'x'.repeat(100000) } }]));
    fs.utimesSync(child, NOW / 1000, NOW / 1000);
  }
  const main = f.write('a-main', [meta('main'), event('task_started', 'main-turn', NOW - 100)]);
  fs.utimesSync(main, (NOW - 1000) / 1000, (NOW - 1000) / 1000);
  const rows = await f.reader.read();
  assert.equal(rows.find(row => row.id === 'main')?.state, 'active');
  assert.ok(f.reader.getDiagnostics().bytesRead < 70000);
});
