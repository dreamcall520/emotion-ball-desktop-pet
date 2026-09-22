const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChatStore, emptyRecord, normalizeRecord, MAX_MESSAGES, MAX_TEXT } = require('../lib/chat-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-chat-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'private', 'conversation.json');
  return { directory, file, store: createChatStore(file) };
}
function recordWithThread() {
  return { ...emptyRecord(), accountKey: 'a'.repeat(64), threadId: 'saved-thread', messages: [
    { id: 'fake-user', role: 'user', text: '测试消息', status: 'complete' },
    { id: 'fake-answer', role: 'assistant', text: '测试回复', status: 'complete' }
  ] };
}

test('文件不存在返回空聊天，但不会创建任何文件', t => {
  const f = fixture(t);
  assert.deepEqual(f.store.read(), emptyRecord());
  assert.equal(fs.existsSync(f.file), false);
});

test('账号、thread 和未确认创建标记可以完整往返', t => {
  const f = fixture(t);
  const record = recordWithThread(); record.creationPending = true; record.pendingTurn = true;
  f.store.write(record);
  assert.deepEqual(f.store.read(), record);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['conversation.json']);
});

test('覆盖保存后不遗留临时文件，并保留同一 thread', t => {
  const f = fixture(t), record = recordWithThread();
  f.store.write(record);
  record.messages.push({ id: 'second-user', role: 'user', text: '继续测试', status: 'complete' });
  f.store.write(record);
  assert.equal(f.store.read().threadId, 'saved-thread');
  assert.equal(f.store.read().messages.length, 3);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['conversation.json']);
});

test('合法上限的中文聊天写入后仍可读取，不能被字节限制锁死', t => {
  const f = fixture(t), record = recordWithThread(); record.messages = [];
  for (let n = 0; n < Math.floor(MAX_MESSAGES / 2); n++) {
    record.messages.push({ id: `user-${n}`, role: 'user', text: '中'.repeat(2000), status: 'complete' },
      { id: `assistant-${n}`, role: 'assistant', text: '中'.repeat(MAX_TEXT), status: 'complete' });
  }
  f.store.write(record);
  const restored = f.store.read();
  assert.equal(restored.threadId, record.threadId);
  assert.equal(restored.accountKey, record.accountKey);
  assert.ok(restored.messages.length > 0);
  assert.ok(restored.messages.length <= MAX_MESSAGES);
  assert.equal(restored.messages.at(-1).text, record.messages.at(-1).text);
});

test('大量需 JSON 转义的合法文本也能往返，不能只按字符数估算文件大小', t => {
  const f = fixture(t), record = recordWithThread(); record.messages = [];
  for (let n = 0; n < MAX_MESSAGES; n++) {
    record.messages.push({ id: `escaped-${n}`, role: n % 2 ? 'assistant' : 'user', text: '\u0001'.repeat(MAX_TEXT), status: 'complete' });
  }
  f.store.write(record);
  const restored = f.store.read();
  assert.equal(restored.threadId, record.threadId);
  assert.ok(restored.messages.length > 0);
  assert.equal(restored.messages.at(-1).text, record.messages.at(-1).text);
});

test('损坏文件抛存储错误，原文件不被当作空聊天覆盖', t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.file)); fs.writeFileSync(f.file, '{broken-json');
  assert.throws(() => f.store.read(), { code: 'STORAGE' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{broken-json');
});

test('不接受符号链接或目录作为聊天记录', t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.file));
  const target = path.join(f.directory, 'target.json'); fs.writeFileSync(target, JSON.stringify(emptyRecord()));
  fs.symlinkSync(target, f.file);
  assert.throws(() => f.store.read(), { code: 'STORAGE' });
  fs.unlinkSync(f.file); fs.mkdirSync(f.file);
  assert.throws(() => f.store.read(), { code: 'STORAGE' });
});

test('无效版本、账号、thread 或消息 ID 均不能保存', t => {
  const f = fixture(t);
  for (const patch of [{ version: 2 }, { accountKey: 'another-user' }, { threadId: '../thread' },
    { messages: [{ id: '../message', role: 'assistant', text: 'test' }] }]) {
    assert.throws(() => f.store.write({ ...recordWithThread(), ...patch }), { code: 'STORAGE' });
  }
  assert.equal(fs.existsSync(f.file), false);
});

test('归一化只保留有限消息和允许字段，不改变 thread 身份', () => {
  const record = recordWithThread(); record.untrusted = 'extra';
  record.messages = Array.from({ length: MAX_MESSAGES + 3 }, (_, n) => ({ id: `message-${n}`, role: 'assistant', text: 'x'.repeat(MAX_TEXT + 1), status: 'unknown', command: 'extra' }));
  const normalized = normalizeRecord(record);
  assert.equal(normalized.threadId, 'saved-thread');
  assert.equal(normalized.messages.length, MAX_MESSAGES);
  assert.equal(normalized.messages[0].id, 'message-3');
  assert.equal(normalized.messages.at(-1).text.length, MAX_TEXT);
  assert.equal(normalized.messages.at(-1).status, 'complete');
  assert.equal(Object.hasOwn(normalized, 'untrusted'), false);
  assert.equal(Object.hasOwn(normalized.messages[0], 'command'), false);
});
