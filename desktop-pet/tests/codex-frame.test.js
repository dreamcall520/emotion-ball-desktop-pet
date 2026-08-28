const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
const OWNER = '019fae37-6bb8-7873-8873-14a6661bd1f2';
function api() {
  const file = path.resolve(__dirname, '../lib/codex-frame.js');
  assert.ok(fs.existsSync(file), '需要有界协议头识别与大帧丢弃模块');
  return require(file);
}
function frame(value) { const data = Buffer.from(JSON.stringify(value)); const head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]); }
function prefix(params = { conversationId: ID, hostId: 'local' }, extra = {}) {
  return JSON.stringify({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: OWNER, ...extra, params }).slice(0, -2) + ',"change":';
}
function feedLarge(parser, start, { length = 198189762, forgedBody = false } = {}) {
  const beginning = Buffer.from(start + (forgedBody ? `{"conversationId":"${OWNER}","params":{"conversationId":"${OWNER}"},"body":"` : '{"type":"snapshot","conversationState":{"body":"'));
  const ending = Buffer.from(forgedBody ? '"}},"version":11}' : '"}}},"version":11}');
  const header = Buffer.alloc(4); header.writeUInt32LE(length); parser.push(header);
  // Reuse a small chunk: no fixture constructs or retains a giant conversation body.
  parser.push(beginning);
  const body = Buffer.alloc(65536, 97);
  let remaining = length - beginning.length - ending.length;
  while (remaining > 0) { const size = Math.min(body.length, remaining); parser.push(body.subarray(0, size)); remaining -= size; }
  parser.push(ending);
}

test('真实字段顺序的189MiB状态包只解析协议头，version在尾部仍可隔离', () => {
  const seen = []; const packets = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: p => packets.push(p), onError: e => errors.push(e), onOversized: p => { seen.push(p); return true; } });
  feedLarge(parser, prefix());
  parser.push(frame({ small: true }));
  assert.deepEqual(errors, []); assert.deepEqual(packets, [{ small: true }]);
  assert.deepEqual(seen, [{ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: OWNER, conversationId: ID, hostId: 'local', targetClientIds: null, paramTargetClientIds: null }]);
  parser.close();
});

test('大包正文伪造ID、深层同名字段不改变真正协议头ID', () => {
  const seen = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e), onOversized: p => { seen.push(p); return true; }, maxFrameBytes: 1024 });
  feedLarge(parser, prefix({ conversationId: ID, hostId: 'local', nested: { conversationId: OWNER, change: 'not-envelope' } }), { length: 4096, forgedBody: true });
  assert.deepEqual(errors, []); assert.equal(seen[0].conversationId, ID); assert.equal(seen.length, 1);
  parser.close();
});

test('协议头内的转义字符串不能伪造结构路径或会话ID', () => {
  const seen = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e), onOversized: p => { seen.push(p); return true; }, maxFrameBytes: 1024 });
  const note = `\"},\"params\":{\"conversationId\":\"${OWNER}\",\"change\":{`;
  feedLarge(parser, prefix({ note, conversationId: ID, hostId: 'local' }), { length: 4096 });
  assert.deepEqual(errors, []); assert.equal(seen[0].conversationId, ID);
  assert.equal(JSON.stringify(seen).includes('note'), false); parser.close();
});

for (const params of [
  { hostId: 'local', nested: { conversationId: ID } },
  { conversationId: 'not-a-uuid', hostId: 'local' },
  { conversationId: ID, hostId: 'remote' }
]) test('缺少可信头部字段时断开，绝不从正文补猜ID', () => {
  const seen = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e), onOversized: p => { seen.push(p); return true; }, maxFrameBytes: 1024 });
  feedLarge(parser, prefix(params), { length: 4096, forgedBody: true });
  assert.deepEqual(errors, ['INVALID_FRAME']); assert.deepEqual(seen, []);
});

test('协议前缀超过8KiB、重复字段或错误type/method拒绝路由', () => {
  const values = [prefix({ note: 'x'.repeat(9000), conversationId: ID, hostId: 'local' }),
    prefix().replace('"hostId":"local"', '"hostId":"local","hostId":"local"'),
    prefix(undefined, { type: 'response' }), prefix(undefined, { method: 'other' })];
  for (const start of values) {
    const errors = [];
    const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e), onOversized: () => assert.fail('不应接受这个前缀'), maxFrameBytes: 1024 });
    feedLarge(parser, start, { length: 16384 }); assert.deepEqual(errors, ['INVALID_FRAME']);
  }
});

test('大于256MiB只读头部就拒绝；未授权大帧处理的普通解析器仍限制16MiB', () => {
  for (const [length, options] of [[256 * 1024 * 1024 + 1, { onOversized: () => true }], [16 * 1024 * 1024 + 1, {}]]) {
    const errors = []; const parser = api().createFrameParser({ onMessage: () => {}, onError: e => errors.push(e), ...options });
    const head = Buffer.alloc(4); head.writeUInt32LE(length); parser.push(head); assert.deepEqual(errors, ['INVALID_FRAME']);
  }
});

test('大帧按任意分片读取协议头，关闭后剩余正文不产生回调', () => {
  const seen = []; const errors = [];
  const parser = api().createFrameParser({ onMessage: () => assert.fail('不应解析正文'), onError: e => errors.push(e), onOversized: p => { seen.push(p); return true; }, maxFrameBytes: 1024 });
  const head = Buffer.alloc(4); head.writeUInt32LE(20000); parser.push(head);
  for (const byte of Buffer.from(prefix())) parser.push(Buffer.from([byte]));
  assert.equal(seen.length, 1); parser.close(); parser.push(Buffer.alloc(20000)); assert.deepEqual(errors, []);
});

for (const kind of ['header', 'normal', 'oversized']) test(`${kind}半包最多等待指定上限，不无限保留缓存`, async () => {
  const errors = [];
  const parser = api().createFrameParser({ onMessage: () => assert.fail('不完整包不应成功'), onError: e => errors.push(e), onOversized: () => true, frameTimeoutMs: 20 });
  if (kind === 'header') parser.push(Buffer.from([1]));
  else {
    const head = Buffer.alloc(4); head.writeUInt32LE(kind === 'normal' ? 1000 : 198189762); parser.push(head);
    parser.push(Buffer.from(kind === 'normal' ? '{"partial":' : prefix()));
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(errors, ['TIMEOUT']); parser.close();
});

test('正常或巨帧收取一半时close立即取消截止计时与迟到数据', async () => {
  for (const length of [1000, 198189762]) {
    const errors = []; const seen = [];
    const parser = api().createFrameParser({ onMessage: p => seen.push(p), onError: e => errors.push(e), onOversized: () => true, frameTimeoutMs: 20 });
    const head = Buffer.alloc(4); head.writeUInt32LE(length); parser.push(head); parser.push(Buffer.from(prefix()));
    parser.close(); parser.push(Buffer.alloc(1000));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(errors, []); assert.deepEqual(seen, []);
  }
});
