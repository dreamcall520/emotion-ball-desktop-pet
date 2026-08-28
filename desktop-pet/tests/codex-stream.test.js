const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
const OWNER = '019fae37-6bb8-7873-8873-14a6661bd1f2';
const CLIENT = '019fae37-6bb8-7873-8873-14a6661bd1f3';
const SECRET = 'SECRET_BODY_OR_CREDENTIAL';
const flush = () => new Promise(resolve => setImmediate(resolve));
function api() {
  const file = path.resolve(__dirname, '../lib/codex-stream.js');
  assert.ok(fs.existsSync(file), '需要已有桌面socket的只读状态连接');
  return require(file);
}
function wire(value) { const data = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(data.length); return Buffer.concat([header, data]); }
function broadcast(change, extra = {}) { return { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: OWNER, params: { conversationId: ID, hostId: 'local', change }, ...extra }; }
function snapshot(revision = 1, raw = {}) { return broadcast({ type: 'snapshot', revision, conversationState: { id: ID, source: 'vscode', title: '任务', threadRuntimeStatus: { type: 'active' }, ...raw } }); }
function receiveLarge(h, id) {
  const prefix = Buffer.from(JSON.stringify({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: OWNER, params: { conversationId: id, hostId: 'local' } }).slice(0, -2) + ',"change":{"type":"snapshot","conversationState":{"body":"');
  const suffix = Buffer.from('"}}},"version":11}');
  const length = 16 * 1024 * 1024 + 1024; const head = Buffer.alloc(4); head.writeUInt32LE(length);
  h.socket.emit('data', head); h.socket.emit('data', prefix);
  const body = Buffer.alloc(65536, 97); let remaining = length - prefix.length - suffix.length;
  while (remaining > 0) { const size = Math.min(remaining, body.length); h.socket.emit('data', body.subarray(0, size)); remaining -= size; }
  h.socket.emit('data', suffix);
}
function fakeStat(socket = false, overrides = {}) { return { uid: 501, mode: 0o700, dev: 1, ino: socket ? 2 : 1, isSymbolicLink: () => false, isDirectory: () => !socket, isSocket: () => socket, ...overrides }; }
function harness({ stat, handshake = true, timeoutMs = 1000 } = {}) {
  const sent = []; const statuses = []; const tasks = []; const discoveries = []; const probes = [];
  let connects = 0; let tick = 10000;
  const socket = new EventEmitter(); socket.writable = true; socket.destroyed = false;
  socket.write = data => {
    const message = JSON.parse(data.subarray(4)); sent.push(message);
    if (handshake && message.method === 'initialize') queueMicrotask(() => socket.emit('data', wire({ type: 'response', method: 'initialize', resultType: 'success', requestId: message.requestId, result: { clientId: CLIENT } })));
    return true;
  };
  socket.destroy = () => { socket.destroyed = true; socket.writable = false; };
  const stream = api().createCodexStream({
    fs: { promises: { lstat: async file => { probes.push(file); return stat ? stat(file) : fakeStat(file.endsWith('.sock')); } } },
    connect: () => { connects++; queueMicrotask(() => socket.emit('connect')); return socket; },
    homedir: () => '/private/test-user', getuid: () => 501, now: () => tick, timeoutMs,
    onTask: value => tasks.push(value), onStatus: value => statuses.push(value), onDiscovered: id => discoveries.push(id)
  });
  const receive = value => socket.emit('data', wire(value));
  return { stream, socket, tasks, sent, statuses, discoveries, probes, receive, connections: () => connects, tick: value => { tick = value; } };
}

test('真实4字节LE帧支持每字节拆包、多帧与中文，不缓存已完成帧', () => {
  const packets = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: value => packets.push(value), onError: code => errors.push(code) });
  const first = wire({ title: '中文标题' });
  for (const byte of first) parser.push(Buffer.from([byte]));
  parser.push(Buffer.concat([wire({ value: 2 }), wire({ value: 3 })]));
  assert.deepEqual(packets, [{ title: '中文标题' }, { value: 2 }, { value: 3 }]);
  assert.deepEqual(errors, []);
  parser.close(); parser.push(wire({ value: 4 }));
  assert.equal(packets.length, 3);
});

for (const payload of [Buffer.from('{bad}'), Buffer.from('[]'), Buffer.from([0xff]), Buffer.alloc(0)]) {
  test(`非法JSON/UTF8/空帧(${payload.length}字节)终止解析且不回传原文`, () => {
    const errors = []; const packets = [];
    const parser = api().createFrameParser({ onMessage: v => packets.push(v), onError: e => errors.push(e) });
    const head = Buffer.alloc(4); head.writeUInt32LE(payload.length);
    parser.push(Buffer.concat([head, payload, wire({ text: SECRET })]));
    assert.deepEqual(errors, ['INVALID_FRAME']); assert.equal(packets.length, 0);
  });
}

test('大于16MB帧在只有头部时就拒绝；原型污染JSON不污染对象', () => {
  const errors = [];
  const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e) });
  const head = Buffer.alloc(4); head.writeUInt32LE(16 * 1024 * 1024 + 1); parser.push(head);
  assert.deepEqual(errors, ['INVALID_FRAME']);
  const packets = []; const safe = api().createFrameParser({ onMessage: p => packets.push(p), onError: () => {} });
  safe.push(wire(JSON.parse('{"__proto__":{"polluted":true},"type":"unknown"}')));
  assert.equal({}.polluted, undefined); assert.equal(packets.length, 1);
  safe.close();
});

test('构造零I/O，握手完成无snapshot不能报告任务已连接', async () => {
  const h = harness();
  assert.equal(h.connections(), 0); assert.equal(h.probes.length, 0);
  h.stream.setThreads([{ id: ID, title: '任务' }]);
  await h.stream.start();
  assert.equal(h.statuses.some(s => s.state === 'connected'), false);
  assert.equal(h.sent[0].method, 'initialize'); assert.equal(h.sent[0].version, 0);
  assert.equal(h.sent[0].sourceClientId, 'emotion-ball-readonly');
  assert.deepEqual(h.sent[0].params, { clientType: 'emotion-ball-desktop-pet' });
  assert.equal(h.sent.find(s => s.method === 'thread-stream-following-changed').sourceClientId, CLIENT);
  h.receive(snapshot());
  assert.equal(h.statuses.at(-1).state, 'connected'); assert.equal(h.tasks.at(-1).state, 'active');
  assert.equal(h.tasks.at(-1).baseline, true);
  h.receive(snapshot(2)); assert.equal(h.tasks.at(-1).baseline, false);
  h.stream.close();
});

for (const overrides of [ { uid: 502 }, { mode: 0o722 }, { isSymbolicLink: () => true }, { isSocket: () => false } ]) {
  test(`不安全socket拒绝连接：${Object.keys(overrides)[0]}`, async () => {
    const h = harness({ stat: file => fakeStat(file.endsWith('.sock'), file.endsWith('.sock') ? overrides : {}) });
    await assert.rejects(h.stream.start(), { code: 'UNSAFE_SOCKET' });
    assert.equal(h.connections(), 0); assert.equal(h.statuses.at(-1).state, 'unsupported');
    h.stream.close();
  });
}

test('符号链接或可被别的用户写入的父目录也被拒绝', async () => {
  for (const overrides of [{ mode: 0o777 }, { isSymbolicLink: () => true }]) {
    const h = harness({ stat: file => fakeStat(file.endsWith('.sock'), file.endsWith('/ipc') ? overrides : {}) });
    await assert.rejects(h.stream.start(), { code: 'UNSAFE_SOCKET' });
    assert.equal(h.connections(), 0); h.stream.close();
  }
});

test('不存在socket显示missing，不创建目录、socket或服务器', async () => {
  const h = harness({ stat: () => { throw Object.assign(new Error(SECRET), { code: 'ENOENT' }); } });
  await assert.rejects(h.stream.start(), { code: 'MISSING' });
  assert.equal(h.connections(), 0); assert.deepEqual(h.statuses.at(-1), { state: 'missing', code: 'MISSING', partial: true });
});

test('发现请求永远拒绝控制；外部following只能提示元数据核验', async () => {
  const h = harness(); await h.stream.start();
  h.receive({ type: 'client-discovery-request', requestId: 'discovery-1', request: { method: 'thread-follower-start-turn', params: SECRET } });
  assert.deepEqual(h.sent.at(-1), { type: 'client-discovery-response', requestId: 'discovery-1', response: { canHandle: false } });
  h.receive({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, params: { conversationId: ID, hostId: 'local', following: true } });
  assert.deepEqual(h.discoveries, [ID]);
  assert.equal(h.sent.some(p => p.params?.conversationId === ID), false);
  h.stream.close();
});

test('仅订阅最多20个合规ID，移出的任务发removed且取消订阅', async () => {
  const h = harness();
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `019fae37-6bb8-7873-8873-${String(i).padStart(12, '0')}`, title: '标题' }));
  h.stream.setThreads([...rows, { id: 'bad' }, { id: ID, parentThreadId: OWNER }]);
  await h.stream.start();
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 20);
  h.stream.setThreads([rows[0]]);
  assert.equal(h.tasks.filter(p => p.removed).length, 19);
  assert.equal(h.sent.filter(p => p.params?.following === false).length, 19);
  h.stream.close();
});

test('未知/远端/归档/子代理snapshot不能加入任务；正文永不离开连接', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID, title: '标题' }]); await h.stream.start();
  h.receive(snapshot(1, { turns: [{ turnId: 'one', status: 'inProgress', items: [{ text: SECRET }] }], requests: [{ method: SECRET, params: SECRET }], cwd: SECRET }));
  assert.equal(h.tasks.at(-1).state, 'active');
  const total = h.tasks.length;
  h.receive(snapshot(2));
  h.receive(broadcast({ type: 'snapshot', revision: 2, conversationState: { id: OWNER } }, { params: { conversationId: OWNER, hostId: 'local' } }));
  h.receive(broadcast({ type: 'snapshot', revision: 2, conversationState: { id: ID } }, { params: { conversationId: ID, hostId: 'remote' } }));
  assert.equal(h.tasks.length, total + 1); // duplicate own valid snapshot remains safe
  h.receive(snapshot(3, { parentThreadId: OWNER }));
  assert.equal(h.tasks.at(-1).removed, true);
  assert.equal(JSON.stringify(h.tasks).includes(SECRET), false);
  h.stream.close();
});

test('连续patch更新当前轮次，丢掉正文；revision缺口改unknown并限频重拉', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID, title: '标题' }]); await h.stream.start();
  h.receive(snapshot(1, { threadRuntimeStatus: { type: 'idle' }, turns: [{ turnId: 'one', status: 'inProgress' }] }));
  h.receive(broadcast({ type: 'patches', baseRevision: 1, revision: 2, patches: [
    { op: 'replace', path: ['turns', 0, 'items'], value: [SECRET] },
    { op: 'replace', path: ['turns', 0, 'status'], value: 'completed' }
  ] }));
  assert.equal(h.tasks.at(-1).state, 'completed');
  h.receive(broadcast({ type: 'patches', baseRevision: 4, revision: 5, patches: [] }));
  assert.equal(h.tasks.at(-1).state, 'unknown');
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 1);
  h.tick(15000); h.stream.refresh();
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 2);
  h.receive(snapshot(6)); assert.equal(h.tasks.at(-1).state, 'active'); assert.equal(h.tasks.at(-1).baseline, true);
  assert.equal(JSON.stringify(h.tasks).includes(SECRET), false);
  h.stream.close();
});

test('周期元数据刷新不重新索取已有有效snapshot，也不重设任务基线', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID, title: '标题' }]); await h.stream.start(); h.receive(snapshot());
  h.tick(25000); h.stream.setThreads([{ id: ID, title: '标题' }]);
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 1);
  h.receive(snapshot(2)); assert.equal(h.tasks.at(-1).baseline, false);
  h.stream.close();
});

for (const cause of ['revision-gap', 'owner-change']) test(`唯一可靠任务因${cause}失效后，通道退出connected并等待新快照`, async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }]); await h.stream.start(); h.receive(snapshot());
  assert.equal(h.statuses.at(-1).state, 'connected');
  if (cause === 'revision-gap') h.receive(broadcast({ type: 'patches', baseRevision: 4, revision: 5, patches: [] }));
  else h.receive({ ...snapshot(2), sourceClientId: CLIENT });
  assert.equal(h.tasks.at(-1).state, 'unknown'); assert.equal(h.tasks.at(-1).baseline, true);
  assert.equal(h.statuses.at(-1).state, 'connecting'); assert.equal(h.socket.destroyed, false);
  h.receive({ ...snapshot(6), sourceClientId: cause === 'owner-change' ? CLIENT : OWNER });
  assert.equal(h.statuses.at(-1).state, 'connected');
});

test('最近任务集合清空后，不继续显示拥有有效snapshot的connected', async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }]); await h.stream.start(); h.receive(snapshot());
  h.stream.setThreads([]);
  assert.equal(h.tasks.at(-1).removed, true); assert.equal(h.tasks.at(-1).state, 'unknown');
  assert.equal(h.statuses.at(-1).state, 'connecting'); assert.equal(h.socket.destroyed, false);
});

test('单个任务失效或移除不拖掉另一个仍有有效snapshot的连接', async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }, { id: OWNER }]); await h.stream.start(); h.receive(snapshot());
  const other = snapshot(1, { id: OWNER }); other.params.conversationId = OWNER; h.receive(other);
  h.receive(broadcast({ type: 'patches', baseRevision: 4, revision: 5, patches: [] }));
  assert.equal(h.statuses.at(-1).state, 'connected');
  h.stream.setThreads([{ id: OWNER }]);
  assert.equal(h.statuses.at(-1).state, 'connected'); assert.equal(h.socket.destroyed, false);
  assert.equal(h.tasks.filter(task => task.id === OWNER).at(-1).state, 'active');
});

test('正常新轮次开始和快速结束不重设基线，仍能收到本轮结束事件', async t => {
  const h = harness(); h.stream.setThreads([{ id: ID }]); await h.stream.start();
  t.after(() => h.stream.close());
  h.receive(snapshot(1, { threadRuntimeStatus: { type: 'idle' }, turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:one': { turnId: 'one', status: 'completed', turnStartedAtMs: 100 }
  } } } }));
  const path = ['turnHistory', 'history', 'entitiesByKey', 'turn:two'];
  h.receive(broadcast({ type: 'patches', baseRevision: 1, revision: 2, patches: [
    { op: 'add', path, value: { turnId: 'two', status: 'inProgress', turnStartedAtMs: 200, items: [SECRET] } },
    { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'active' }
  ] }));
  assert.equal(h.tasks.at(-1).state, 'active'); assert.equal(h.tasks.at(-1).baseline, false);
  h.receive(broadcast({ type: 'patches', baseRevision: 2, revision: 3, patches: [
    { op: 'replace', path: [...path, 'status'], value: 'completed' },
    { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'idle' }
  ] }));
  assert.equal(h.tasks.at(-1).state, 'completed'); assert.equal(h.tasks.at(-1).baseline, false);
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 1);
  h.stream.close();
});

test('连续旧轮次增量不能把排序不明的快照变成完成，后续有序快照才恢复', async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }]); await h.stream.start();
  const history = { kind: 'canonical', history: { entitiesByKey: {
    'turn:old': { turnId: 'old', status: 'completed', turnStartedAtMs: 100 },
    'turn:new': { turnId: 'new', status: 'inProgress' }
  } } };
  h.receive(snapshot(1, { threadRuntimeStatus: undefined, turnHistory: history }));
  assert.equal(h.tasks.at(-1).state, 'unknown');
  const path = ['turnHistory', 'history', 'entitiesByKey', 'turn:old'];
  h.receive(broadcast({ type: 'patches', baseRevision: 1, revision: 2, patches: [{ op: 'replace', path: [...path, 'status'], value: 'completed' }] }));
  assert.equal(h.tasks.at(-1).state, 'unknown');
  h.receive(broadcast({ type: 'patches', baseRevision: 2, revision: 3, patches: [{ op: 'replace', path, value: { turnId: 'old', status: 'completed', turnStartedAtMs: 100 } }] }));
  assert.equal(h.tasks.at(-1).state, 'unknown');
  assert.equal(h.sent.filter(packet => packet.params?.following === true).length, 1);
  history.history.entitiesByKey['turn:new'].turnStartedAtMs = 200;
  h.receive(snapshot(4, { threadRuntimeStatus: undefined, turnHistory: history }));
  assert.equal(h.tasks.at(-1).state, 'active'); assert.equal(h.tasks.at(-1).turnId, 'new');
});

test('进入与解除审批等待的增量不丢通知基线或请求额外快照', async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }]); await h.stream.start(); h.receive(snapshot());
  h.receive(broadcast({ type: 'patches', baseRevision: 1, revision: 2, patches: [{ op: 'add', path: ['requests', 0], value: { method: 'item/commandExecution/requestApproval', params: SECRET } }] }));
  assert.equal(h.tasks.at(-1).state, 'waiting'); assert.equal(h.tasks.at(-1).baseline, false);
  h.receive(broadcast({ type: 'patches', baseRevision: 2, revision: 3, patches: [{ op: 'remove', path: ['requests', 0] }] }));
  assert.equal(h.tasks.at(-1).state, 'active'); assert.equal(h.tasks.at(-1).baseline, false);
  assert.equal(h.sent.filter(p => p.params?.following === true).length, 1);
});

test('close发生在socket连接之前，不发送握手、不接受迟到数据', async () => {
  let finish; let connects = 0;
  const stream = api().createCodexStream({ fs: { promises: { lstat: () => new Promise(resolve => { finish = resolve; }) } }, connect: () => { connects++; }, homedir: () => '/private/test-user', getuid: () => 501 });
  const opening = stream.start(); stream.close(); finish(fakeStat());
  await assert.rejects(opening, { code: 'CLOSED' }); await flush(); assert.equal(connects, 0);
});

test('有效来源的协议版本不兼容只返回固定unsupported，不误报完成', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID }]); await h.stream.start();
  h.receive({ ...snapshot(), version: 12 });
  assert.equal(h.statuses.at(-1).state, 'unsupported'); assert.equal(h.statuses.at(-1).code, 'UNSUPPORTED');
  assert.equal(h.tasks.at(-1).state, 'unknown');
});

test('owner切换先unknown，新快照前不报完成；owner断连使全部unknown并断开', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID, title: '标题' }]); await h.stream.start();
  h.receive(snapshot());
  h.receive({ ...snapshot(2, { threadRuntimeStatus: { type: 'idle' }, turns: [{ turnId: 'one', status: 'completed' }] }), sourceClientId: CLIENT });
  assert.equal(h.tasks.at(-1).state, 'unknown');
  h.receive({ type: 'broadcast', method: 'client-status-changed', version: 0, params: { clientId: CLIENT, status: 'disconnected' } });
  assert.equal(h.tasks.at(-1).state, 'unknown'); assert.equal(h.statuses.at(-1).state, 'disconnected');
  assert.equal(h.socket.destroyed, true);
});

test('ipc reset清除任务状态，close后迟到包不产生回调', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID, title: '标题' }]); await h.stream.start(); h.receive(snapshot());
  h.receive({ type: 'broadcast', method: 'ipc-connection-reset', version: 1, params: {} });
  assert.equal(h.tasks.at(-1).state, 'unknown'); assert.equal(h.socket.destroyed, true);
  const count = h.tasks.length; h.receive(snapshot()); h.stream.close();
  assert.equal(h.tasks.length, count); assert.equal(h.socket.listenerCount('data'), 0); assert.equal(h.socket.listenerCount('connect'), 0);
});

test('关闭时取消订阅写入失败不递归报错，也不产生迟到状态回调', async () => {
  const h = harness(); h.stream.setThreads([{ id: ID }]); await h.stream.start(); h.receive(snapshot());
  const taskCount = h.tasks.length; const statusCount = h.statuses.length;
  h.socket.write = () => { throw new Error(SECRET); };
  assert.doesNotThrow(() => h.stream.close());
  assert.equal(h.socket.destroyed, true); assert.equal(h.tasks.length, taskCount); assert.equal(h.statuses.length, statusCount);
});

test('巨大状态只隔离对应任务，保留其它可靠状态且本连接内不自动重拉巨包', async t => {
  const h = harness(); t.after(() => h.stream.close());
  h.stream.setThreads([{ id: ID }, { id: OWNER }]); await h.stream.start(); h.receive(snapshot());
  receiveLarge(h, OWNER);
  assert.equal(h.socket.destroyed, false);
  assert.equal(h.tasks.filter(p => p.id === ID).at(-1).state, 'active');
  assert.equal(h.tasks.filter(p => p.id === OWNER).at(-1).state, 'unknown');
  assert.equal(h.tasks.filter(p => p.id === OWNER).at(-1).unavailable, 'STATE_TOO_LARGE');
  assert.equal(h.statuses.at(-1).state, 'connected'); assert.equal(h.statuses.at(-1).code, 'PARTIAL_STATE');
  h.tick(30000); h.stream.setThreads([{ id: ID }]); h.stream.setThreads([{ id: ID }, { id: OWNER }]); h.stream.refresh();
  assert.equal(h.sent.filter(p => p.params?.conversationId === OWNER && p.params?.following === true).length, 1);
  assert.ok(h.sent.some(p => p.params?.conversationId === OWNER && p.params?.following === false));
});

test('只有巨包没有有效snapshot时显示不可用，未订阅ID的大包不能猜测路由', async t => {
  const h = harness(); t.after(() => h.stream.close()); h.stream.setThreads([{ id: ID }]); await h.stream.start();
  receiveLarge(h, ID);
  assert.equal(h.statuses.at(-1).state, 'unsupported'); assert.equal(h.statuses.at(-1).code, 'STATE_TOO_LARGE');
  assert.equal(h.socket.destroyed, false);
  const total = h.tasks.length; h.receive(snapshot()); assert.equal(h.tasks.length, total);
  receiveLarge(h, OWNER);
  assert.equal(h.socket.destroyed, true); assert.equal(h.statuses.at(-1).code, 'INVALID_FRAME');
});

test('握手及等待首个snapshot均有超时上限', async () => {
  const noHandshake = harness({ handshake: false, timeoutMs: 20 });
  await assert.rejects(noHandshake.stream.start(), { code: 'TIMEOUT' }); assert.equal(noHandshake.socket.destroyed, true);
  const noSnapshot = harness({ timeoutMs: 20 }); noSnapshot.stream.setThreads([{ id: ID }]); await noSnapshot.stream.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(noSnapshot.statuses.at(-1).code, 'TIMEOUT'); assert.equal(noSnapshot.socket.destroyed, true);
});

test('真实临时本机socket可拆包握手与快照，关闭后资源全释放', async () => {
  const moduleApi = api();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ball-ipc-test-'));
  const directory = path.join(root, '.codex', 'ipc'); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const socketPath = path.join(directory, 'ipc.sock'); const tasks = []; const peers = new Set();
  const server = net.createServer(peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer));
    const parser = moduleApi.createFrameParser({ onMessage: message => {
      if (message.method === 'initialize') {
        const packet = wire({ type: 'response', resultType: 'success', method: 'initialize', requestId: message.requestId, result: { clientId: CLIENT } });
        peer.write(packet.subarray(0, 2)); setImmediate(() => peer.write(packet.subarray(2)));
      } else if (message.params?.following) peer.write(wire(snapshot()));
    }, onError: () => peer.destroy() });
    peer.on('data', parser.push); peer.on('close', parser.close);
  });
  server.listen(socketPath); await once(server, 'listening'); fs.chmodSync(socketPath, 0o600);
  const stream = moduleApi.createCodexStream({ homedir: () => root, onTask: value => tasks.push(value), timeoutMs: 1000 });
  try {
    stream.setThreads([{ id: ID, title: '标题' }]); await stream.start();
    for (let i = 0; i < 10 && !tasks.some(t => t.state === 'active'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(tasks.at(-1).state, 'active');
  } finally {
    stream.close(); for (const peer of peers) peer.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
