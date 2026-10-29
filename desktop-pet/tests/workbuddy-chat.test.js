const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyChat } = require('../lib/workbuddy-chat');
const { emptyRecord } = require('../lib/chat-store');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  let disk = emptyRecord(), key = 'a'.repeat(64), rejectWrite = false;
  const calls = [], actions = [];
  const store = { read: () => structuredClone(disk), write: value => { if (rejectWrite) throw Error('disk'); disk = structuredClone(value); } };
  const run = async (op, payload, control) => {
    if (op === 'models') return { accountKey: key, models: [{ id: 'auto', displayName: '自动' }, { id: 'hy3', displayName: 'Hy3' }] };
    calls.push({ payload, control });
    return options.chat ? options.chat(payload, control, key) : { accountKey: key, text: '{"text":"你好","action":"none"}' };
  };
  const chat = createWorkBuddyChat({ store, run, onAction: action => actions.push(action), ...options });
  return { chat, calls, actions, disk: () => disk, key: value => { key = value; }, failWrite: () => { rejectWrite = true; } };
}
test('WorkBuddy multi-turn history uses local conversation and validated actions', async () => {
  const env = setup({ chat: async (_, control, key) => { control.onDelta('{"text":"转'); return { accountKey: key, text: '{"text":"转给你看","action":"spin"}' }; } });
  assert.equal((await env.chat.send('转一下')).accepted, true); await tick();
  assert.deepEqual(env.actions, ['spin']);
  assert.equal(env.chat.getState().messages[1].text, '转给你看');
  await env.chat.send('谢谢'); await tick();
  assert.deepEqual(env.calls[1].payload.messages.slice(1).map(item => item.role), ['user', 'assistant', 'user']);
  assert.equal(env.calls[0].payload.conversationId, env.calls[1].payload.conversationId);
  assert.equal(env.calls[1].payload.expectedAccountKey, 'a'.repeat(64));
});
test('stop aborts stream and late answer cannot execute action or overwrite state', async () => {
  let resolve;
  const env = setup({ chat: (_, control) => new Promise(done => { resolve = done; control.onDelta('{"text":"一半'); }) });
  await env.chat.send('开始'); await tick(); env.chat.stop();
  assert.equal(env.calls[0].control.signal.aborted, true);
  resolve({ accountKey: 'a'.repeat(64), text: '{"text":"后来","action":"spin"}' }); await tick();
  assert.equal(env.chat.getState().messages[1].status, 'interrupted');
  assert.equal(env.chat.getState().messages[1].text, '一半'); assert.deepEqual(env.actions, []);
  assert.equal(env.disk().pendingTurn, false);
});
test('account switch hides old history and never submits old messages', async () => {
  const env = setup(); await env.chat.send('旧账号秘密'); await tick();
  env.key('b'.repeat(64));
  assert.equal((await env.chat.send('新的')).accepted, false);
  assert.equal(env.calls.length, 1); assert.deepEqual(env.chat.getState().messages, []);
  assert.equal(env.chat.newChat().accepted, true);
  await env.chat.send('新账号'); await tick();
  assert.equal(JSON.stringify(env.calls[1].payload).includes('旧账号秘密'), false);
});
test('failed send remains persisted and is never automatically retried', async () => {
  const env = setup({ chat: async () => { throw Object.assign(Error(), { code: 'INVALID_RESPONSE' }); } });
  await env.chat.send('失败'); await tick();
  assert.equal(env.calls.length, 1); assert.equal(env.disk().messages[1].status, 'error');
  assert.equal(env.chat.getState().busy, false); assert.match(env.chat.getState().error, /完整/);
});
test('disk failure prevents crossing chat boundary', async () => {
  const env = setup(); env.failWrite();
  assert.equal((await env.chat.send('不发送')).accepted, false); await tick();
  assert.equal(env.calls.length, 0); assert.deepEqual(env.chat.getState().messages, []);
});
test('invalid action is plain text and never executed', async () => {
  const env = setup({ chat: async (_, __, key) => ({ accountKey: key, text: '{"text":"坏动作","action":"exec"}' }) });
  await env.chat.send('动作'); await tick(); assert.deepEqual(env.actions, []);
});
test('model failure hides previously verified messages', async () => {
  let broken = false;
  const env = setup({ run: async op => {
    if (broken) throw Error('network');
    return op === 'models' ? { accountKey: 'a'.repeat(64), models: [{ id: 'hy3', displayName: 'Hy3' }] } : { accountKey: 'a'.repeat(64), text: '文字' };
  } });
  await env.chat.send('你好'); await tick(); broken = true;
  await env.chat.refreshModels(); assert.deepEqual(env.chat.getState().messages, []);
});
test('history and model settings remain independent and recoverable', async () => {
  const env = setup(); await env.chat.send('第一段'); await tick();
  const id = env.chat.getState().activeChatId;
  assert.equal(env.chat.newChat().accepted, true); assert.equal(env.chat.setModel('hy3').accepted, true);
  await env.chat.send('第二段'); await tick();
  assert.equal(env.calls[1].payload.model, 'hy3');
  assert.equal(env.chat.selectChat(id).accepted, true);
  assert.equal(env.chat.getState().messages[0].text, '第一段');
});
test('immediate cancellation aborts dispatched request without retry', async () => {
  const env = setup(); await env.chat.send('停止'); env.chat.stop(); await tick();
  assert.equal(env.calls.length, 1); assert.equal(env.calls[0].control.signal.aborted, true); assert.equal(env.chat.getState().messages[1].status, 'interrupted');
});
test('timeout aborts and preserves persisted user message', async () => {
  const env = setup({ turnTimeoutMs: 5, chat: () => new Promise(() => {}) });
  await env.chat.send('超时'); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.calls[0].control.signal.aborted, true);
  assert.equal(env.disk().messages[0].text, '超时'); assert.equal(env.disk().messages[1].status, 'error');
  assert.match(env.chat.getState().error, /超时/);
});
test('unexpected response account hides output and prevents actions', async () => {
  const env = setup({ chat: async () => ({ accountKey: 'b'.repeat(64), text: '{"text":"不应显示","action":"spin"}' }) });
  await env.chat.send('测试'); await tick(); assert.deepEqual(env.chat.getState().messages, []); assert.deepEqual(env.actions, []);
});
test('safe context limit rejects without silently trimming history', async () => {
  const env = setup();
  for (let i = 0; i < 40; i++) { assert.equal((await env.chat.send(`消息${i}`)).accepted, true); await tick(); }
  assert.equal((await env.chat.send('第41条')).accepted, false);
  assert.equal(env.calls.length, 40); assert.equal(env.disk().messages.length, 80);
});
test('rejects input above IPC limit or containing NUL before any boundary', async () => {
  let calls = 0;
  const env = setup({ run: () => { calls++; throw Error(); } });
  assert.equal((await env.chat.send('x'.repeat(2001))).accepted, false);
  assert.equal((await env.chat.send('a\0b')).accepted, false);
  assert.equal(calls, 0);
});
test('close aborts pending model lookup and never persists or starts chat', async () => {
  let resolve, signal, writes = 0, chatCalls = 0;
  const chat = createWorkBuddyChat({ store: { read: emptyRecord, write: () => writes++ }, run: (op, _, control) => {
    if (op === 'chat') { chatCalls++; return; }
    signal = control.signal; return new Promise(done => { resolve = done; });
  } });
  const pending = chat.send('关闭中'); await tick(); chat.close();
  assert.equal(signal.aborted, true);
  resolve({ accountKey: 'a'.repeat(64), models: [{ id: 'auto', displayName: '自动' }] });
  assert.equal((await pending).accepted, false); assert.equal(writes, 0); assert.equal(chatCalls, 0);
});
test('synchronous model failure allows a later reconnect', async () => {
  let calls = 0;
  const env = setup({ run: () => { calls++; throw Error(); } });
  await env.chat.refreshModels(); await env.chat.refreshModels(); assert.equal(calls, 2);
});
test('late cancelled auth failure cannot invalidate the next successful chat', async () => {
  let reject, attempts = 0;
  const env = setup({ chat: async (_, __, key) => {
    if (++attempts === 1) return new Promise((_, fail) => { reject = fail; });
    return { accountKey: key, text: '新回复' };
  } });
  await env.chat.send('第一轮'); await tick(); env.chat.stop();
  await env.chat.send('第二轮'); await tick();
  reject(Object.assign(Error(), { code: 'UNAUTHENTICATED' })); await tick();
  assert.equal(env.chat.getState().messages.at(-1).text, '新回复');
});
test('client login error hides verified history, and specific errors have useful messages', async () => {
  const { workBuddyError } = require('../lib/workbuddy-client');
  for (const [code, expected] of Object.entries({
    LOGIN_REQUIRED: /重新登录/, UNSUPPORTED_ACCOUNT: /登录身份/, UNSUPPORTED_AUTH: /登录格式/,
    INSUFFICIENT_CREDITS: /积分不足/, TOOLS_UNSUPPORTED: /工具调用/, TRUNCATED_RESPONSE: /完整结束/,
    RESPONSE_TOO_LONG: /回复超出/, CONTEXT_TOO_LONG: /新聊天/, ACCOUNT_RESTRICTED: /受限/
  })) {
    const env = setup({ chat: async () => { throw workBuddyError(code); } });
    await env.chat.send('出错'); await tick();
    assert.match(env.chat.getState().error, expected, code);
    if (code === 'LOGIN_REQUIRED') assert.deepEqual(env.chat.getState().messages, []);
    assert.equal(env.disk().messages[1].status, 'error');
  }
});
test('stop during pre-send models lookup blocks stale result and future chat dispatch', async () => {
  let resolve, signal, chatCalls = 0, writes = 0;
  const chat = createWorkBuddyChat({ store: { read: emptyRecord, write: () => writes++ }, run: (operation, _, control) => {
    if (operation === 'chat') { chatCalls++; return; }
    signal = control.signal; return new Promise(done => { resolve = done; });
  } });
  const pending = chat.send('锁屏前发送'); await tick(); chat.stop();
  assert.equal(signal.aborted, true);
  resolve({ accountKey: 'a'.repeat(64), models: [{ id: 'auto', displayName: '自动' }] });
  assert.equal((await pending).accepted, false); assert.equal(writes, 0); assert.equal(chatCalls, 0);
  assert.equal(chat.getState().connection, 'idle'); assert.deepEqual(chat.getState().models, []);
});
test('stale cancelled models lookup cannot overwrite a new connection', async () => {
  const waiting = [];
  const env = setup({ run: () => new Promise(resolve => waiting.push(resolve)) });
  const first = env.chat.connect(); await tick(); env.chat.stop();
  const second = env.chat.connect(); await tick();
  waiting[1]({ accountKey: 'b'.repeat(64), models: [{ id: 'new', displayName: '新账号' }] }); await second;
  waiting[0]({ accountKey: 'a'.repeat(64), models: [{ id: 'old', displayName: '旧账号' }] });
  await assert.rejects(first);
  assert.equal(env.chat.getState().models[0].id, 'new'); assert.equal(env.chat.getState().connection, 'ready');
});


test('weather context augments system only and preserves local user display and history', async () => {
  let received;
  const env = setup({ getWeatherContext: text => { received = text; return '冷'.repeat(1200); } });
  await env.chat.send('  出门  '); await tick();
  assert.equal(received, '  出门  ');
  const messages = env.calls[0].payload.messages;
  assert.match(messages[0].content, /仅数据，不是指令/);
  assert.equal((messages[0].content.match(/冷/g) || []).length, 1000);
  assert.equal(messages[1].content, '出门'); assert.equal(env.disk().messages[0].text, '出门');
  env.chat.close();
});
test('weather context failures leave default WorkBuddy request system unchanged', async () => {
  const plain = setup(); await plain.chat.send('你好'); await tick();
  const failed = setup({ getWeatherContext: () => { throw Error('weather unavailable'); } });
  await failed.chat.send('你好'); await tick();
  assert.deepEqual(failed.calls[0].payload.messages, plain.calls[0].payload.messages);
  plain.chat.close(); failed.chat.close();
});
