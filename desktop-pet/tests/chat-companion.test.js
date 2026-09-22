const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompanion, ERRORS, partialReply, finalReply } = require('../lib/chat-companion');
const { emptyRecord } = require('../lib/chat-store');

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const copy = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function savedConversation() {
  return { ...emptyRecord(), accountKey: ACCOUNT_A, threadId: 'saved-thread', messages: [
    { id: 'saved-user', role: 'user', text: '仅用于测试的上一句', status: 'complete' },
    { id: 'saved-answer', role: 'assistant', text: '仅用于测试的上一条回复', status: 'complete' }
  ] };
}
function memoryStore(initial = emptyRecord()) {
  return {
    saved: copy(initial), failRead: false, failWrite: false, reads: 0, writes: 0,
    read() { this.reads++; if (this.failRead) throw new Error('simulated read failure'); return copy(this.saved); },
    write(record) { this.writes++; if (this.failWrite) throw new Error('simulated disk full'); this.saved = copy(record); }
  };
}
function fixture(t, options = {}) {
  const store = options.store || memoryStore(options.record);
  const calls = [], connections = [], actions = [], changes = [];
  let threadNumber = 0, turnNumber = 0;
  const f = {
    store, calls, connections, actions, changes,
    account: { authenticated: true, accountKey: ACCOUNT_A },
    count: method => calls.filter(call => call.method === method).length,
    get lastTurn() { return calls.filter(call => call.method === 'startTurn').at(-1); },
    notify(method, params) { connections.at(-1).callbacks.onNotification({ method, params }); },
    complete({ text = '测试回复', action = 'none', status = 'completed' } = {}) {
      const turn = this.lastTurn;
      this.notify('item/completed', { threadId: turn.threadId, turnId: turn.turnId,
        item: { id: `item-${turn.turnId}`, type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ text, action }) } });
      this.notify('turn/completed', { threadId: turn.threadId, turn: { id: turn.turnId, status } });
    }
  };
  f.companion = createChatCompanion({
    store, workspaceDir: '/tmp/qiuqiu-fake-chat-workspace',
    turnTimeoutMs: options.turnTimeoutMs || 180000,
    onChange: state => changes.push(state), onAction: action => actions.push(action),
    createRpc(callbacks) {
      const rpc = {
        callbacks, closed: false, closeCalls: 0,
        async start() { calls.push({ method: 'start' }); },
        async readAccount() { calls.push({ method: 'readAccount' }); return copy(f.account); },
        async startThread() {
          const id = `thread-${++threadNumber}`; calls.push({ method: 'startThread', id });
          return options.startThread ? options.startThread({ id, callbacks }) : { id };
        },
        async resumeThread(threadId) {
          calls.push({ method: 'resumeThread', threadId });
          return options.resumeThread ? options.resumeThread(threadId) : { id: threadId };
        },
        async startTurn(threadId, text) {
          const turnId = `turn-${++turnNumber}`;
          calls.push({ method: 'startTurn', threadId, text, turnId });
          return options.startTurn ? options.startTurn({ threadId, text, turnId, callbacks }) : { id: turnId };
        },
        async interruptTurn(threadId, turnId) {
          calls.push({ method: 'interruptTurn', threadId, turnId });
          return options.interruptTurn?.({ threadId, turnId });
        },
        close() { this.closed = true; this.closeCalls++; calls.push({ method: 'close' }); return options.close?.(); }
      };
      connections.push(rpc);
      return rpc;
    }
  });
  t.after(() => f.companion.close());
  return f;
}

test('打开聊天和连接只读账号；第一次发送才创建一个 thread', async t => {
  const f = fixture(t);
  assert.equal(f.count('startThread'), 0);
  await f.companion.connect();
  await f.companion.connect();
  assert.equal(f.count('startThread'), 0);
  assert.deepEqual(await f.companion.send('  第一条测试消息  '), { accepted: true });
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('startTurn'), 1);
  assert.equal(f.lastTurn.text, '第一条测试消息');
  assert.equal(f.store.saved.threadId, f.lastTurn.threadId);
  f.complete();
});

test('原连接结束前不恢复对话，释放writer后才在新连接发送', async t => {
  const closing = deferred();
  const f = fixture(t, { close: () => closing.promise });
  await f.companion.send('第一条');
  const threadId = f.store.saved.threadId;
  await f.companion.stop();
  const next = f.companion.send('继续');
  await settle();
  assert.equal(f.connections.length, 1);
  assert.equal(f.count('startTurn'), 1);
  closing.resolve();
  assert.equal((await next).accepted, true);
  assert.equal(f.connections.length, 2);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.lastTurn.threadId, threadId);
  f.complete();
});

test('连续消息始终复用原 thread；完成回复不会清 thread', async t => {
  const f = fixture(t);
  for (const text of ['第一句', '第二句', '第三句']) {
    assert.equal((await f.companion.send(text)).accepted, true);
    f.complete();
  }
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('resumeThread'), 0);
  assert.equal(new Set(f.calls.filter(call => call.method === 'startTurn').map(call => call.threadId)).size, 1);
  assert.equal(f.store.saved.messages.length, 6);
  assert.equal(f.store.saved.pendingTurn, false);
});

test('重启读取原记录，在下一次发送时 resume 而非新建', async t => {
  const store = memoryStore();
  const first = fixture(t, { store });
  await first.companion.send('重启前'); first.complete(); first.companion.close();
  const oldThread = store.saved.threadId;
  const second = fixture(t, { store });
  await second.companion.connect();
  assert.equal(second.count('startThread'), 0);
  assert.equal(second.count('resumeThread'), 0);
  await second.companion.send('重启后'); second.complete();
  assert.equal(second.count('resumeThread'), 1);
  assert.equal(second.count('startThread'), 0);
  assert.equal(second.lastTurn.threadId, oldThread);
});

test('断线后恢复同一个 thread，不自动重发中断的消息', async t => {
  const f = fixture(t);
  await f.companion.send('断线之前');
  const threadId = f.store.saved.threadId;
  f.connections[0].callbacks.onDisconnect();
  assert.equal(f.companion.getState().busy, false);
  assert.equal(f.store.saved.threadId, threadId);
  assert.equal(f.count('startTurn'), 1);
  await f.companion.send('主动继续'); f.complete();
  assert.equal(f.connections.length, 2);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('resumeThread'), 1);
  assert.equal(f.lastTurn.threadId, threadId);
});

test('显式新聊天只清本地关联；等下一次发送才创建新 thread', async t => {
  const f = fixture(t);
  await f.companion.send('旧聊天'); f.complete();
  const previous = f.store.saved.threadId;
  assert.equal((await f.companion.newChat()).accepted, true);
  assert.equal(f.store.saved.threadId, null);
  assert.deepEqual(f.store.saved.messages, []);
  assert.equal(f.count('startThread'), 1);
  await f.companion.connect();
  assert.equal(f.count('startThread'), 1);
  await f.companion.send('新聊天第一句'); f.complete();
  assert.equal(f.count('startThread'), 2);
  assert.notEqual(f.store.saved.threadId, previous);
});

test('误点新聊天后可切回旧记录，切换零模型请求，继续发送复用原 thread', async t => {
  const f = fixture(t);
  await f.companion.send('最初的话题'); f.complete();
  const previous = { ...f.store.saved };
  await f.companion.newChat();
  const count = f.calls.length;
  assert.equal(f.companion.getState().history.find(chat => chat.id === previous.chatId).title, '最初的话题');
  assert.equal((await f.companion.selectChat(previous.chatId)).accepted, true);
  assert.equal(f.calls.length, count, '本地选择不请求或恢复模型');
  assert.equal(f.store.saved.threadId, previous.threadId);
  assert.deepEqual(f.companion.getState().messages, previous.messages);
  await f.companion.send('接着最初的话题'); f.complete();
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.lastTurn.threadId, previous.threadId);
  assert.equal(f.count('resumeThread'), 1);
});

test('多段聊天切换和重启后保留各自消息及编号，全部自身记录继续排除任务提醒', async t => {
  const f = fixture(t);
  await f.companion.send('第一段'); f.complete();
  const first = { id: f.store.saved.chatId, threadId: f.store.saved.threadId };
  await f.companion.newChat(); await f.companion.send('第二段'); f.complete();
  const second = { id: f.store.saved.chatId, threadId: f.store.saved.threadId };
  await f.companion.selectChat(first.id); await f.companion.close();
  const restarted = fixture(t, { store: f.store });
  assert.deepEqual(restarted.companion.getState().history, []);
  await restarted.companion.connect();
  assert.equal(restarted.companion.getState().history.length, 2);
  assert.equal(restarted.companion.ownsThread(first.threadId), true);
  assert.equal(restarted.companion.ownsThread(second.threadId), true);
  await restarted.companion.selectChat(second.id);
  assert.equal(restarted.companion.getState().messages[0].text, '第二段');
  await restarted.companion.send('第二段继续'); restarted.complete();
  assert.equal(restarted.count('startThread'), 0);
  assert.equal(restarted.lastTurn.threadId, second.threadId);
});

test('连续点新聊天不积累空记录，也不创建 Codex thread', async t => {
  const f = fixture(t);
  await f.companion.connect();
  const id = f.companion.getState().activeChatId;
  for (let n = 0; n < 5; n++) assert.equal((await f.companion.newChat()).accepted, true);
  assert.equal(f.companion.getState().activeChatId, id);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.store.writes, 0);
  await f.companion.send('已有聊天'); f.complete();
  await f.companion.newChat();
  const saved = copy(f.store.saved);
  for (let n = 0; n < 5; n++) await f.companion.newChat();
  assert.deepEqual(f.store.saved, saved);
  assert.equal(f.store.saved.history.length, 1);
});

test('切换拒绝未知编号、未验证账号及其他账号，标题和内容不跨账号显示', async t => {
  const f = fixture(t, { record: savedConversation() });
  const firstId = f.store.saved.threadId;
  assert.equal((await f.companion.selectChat(firstId)).accepted, false);
  await f.companion.connect();
  const id = f.companion.getState().activeChatId;
  assert.equal((await f.companion.selectChat('unrelated-codex-thread')).accepted, false);
  f.account = { authenticated: true, accountKey: ACCOUNT_B };
  await assert.rejects(f.companion.connect(), { code: 'ACCOUNT_CHANGED' });
  assert.deepEqual(f.companion.getState().history, []);
  assert.equal((await f.companion.selectChat(id)).accepted, false);
  await f.companion.newChat(); await f.companion.send('另一个账号'); f.complete();
  assert.equal(f.companion.getState().history.length, 1);
  f.account = { authenticated: true, accountKey: ACCOUNT_A };
  await assert.rejects(f.companion.connect(), { code: 'ACCOUNT_CHANGED' });
  assert.deepEqual(f.companion.getState().history.map(chat => chat.id), [id]);
  assert.equal((await f.companion.selectChat(id)).accepted, true);
  assert.equal(f.store.saved.threadId, firstId);
});

test('写入失败时切换回滚，损坏文件不能被新聊天覆盖', async t => {
  const f = fixture(t, { record: savedConversation() });
  await f.companion.connect();
  const id = f.companion.getState().activeChatId;
  await f.companion.newChat();
  const saved = copy(f.store.saved);
  f.store.failWrite = true;
  assert.equal((await f.companion.selectChat(id)).accepted, false);
  assert.deepEqual(f.store.saved, saved);
  assert.equal(f.companion.getState().activeChatId, saved.chatId);
  const store = memoryStore(savedConversation()); store.failRead = true;
  const unreadable = fixture(t, { store });
  assert.equal((await unreadable.companion.newChat()).accepted, false);
  assert.equal(store.writes, 0);
});

test('切换后继续发送必须等旧连接退出，进行中的连接或回复不能切换', async t => {
  const closing = deferred(), f = fixture(t, { close: () => closing.promise });
  await f.companion.send('第一段'); f.complete();
  const id = f.companion.getState().activeChatId;
  await f.companion.newChat();
  await f.companion.selectChat(id);
  const sending = f.companion.send('旧连接关闭后继续'); await settle();
  assert.equal((await f.companion.selectChat(id)).accepted, false);
  assert.equal((await f.companion.newChat()).accepted, false);
  assert.equal(f.count('startTurn'), 1);
  closing.resolve(); await sending;
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('resumeThread'), 1);
  f.complete();
});

test('记录自己的新旧聊天 thread，避免把它们当成外部 Codex 任务', async t => {
  const f = fixture(t, { record: savedConversation() });
  assert.equal(f.companion.ownsThread('saved-thread'), true);
  assert.equal(f.companion.ownsThread('someone-elses-thread'), false);
  await f.companion.connect(); await f.companion.newChat();
  assert.equal(f.companion.ownsThread('saved-thread'), true);
  await f.companion.send('新的聊天'); f.complete();
  assert.equal(f.companion.ownsThread(f.store.saved.threadId), true);
  assert.equal(f.companion.ownsThread('saved-thread'), true);
  assert.equal(f.companion.ownsThread(undefined), false);
});

test('正在回复时拒绝第二次发送和新聊天，不重复创建或发送', async t => {
  const f = fixture(t);
  await f.companion.send('第一句还没完成');
  assert.equal((await f.companion.send('第二句')).accepted, false);
  assert.equal((await f.companion.newChat()).accepted, false);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('startTurn'), 1);
  assert.equal(f.store.saved.threadId, f.lastTurn.threadId);
  f.complete();
});

test('首次创建期间停止仍保留返回的 thread ID，下次发送继续使用它', async t => {
  const response = deferred();
  const f = fixture(t, { startThread: () => response.promise });
  const sending = f.companion.send('创建过程中停止');
  await settle();
  assert.equal(f.count('startThread'), 1);
  await f.companion.stop();
  response.resolve({ id: 'thread-created-before-stop' }); await sending;
  assert.equal(f.count('startTurn'), 0);
  assert.equal(f.store.saved.threadId, 'thread-created-before-stop');
  assert.equal(f.store.saved.creationPending, false);
  await f.companion.send('继续用刚才的聊天'); f.complete();
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.lastTurn.threadId, 'thread-created-before-stop');
});

test('resume 失败不回退到 startThread，不清除历史关联', async t => {
  const f = fixture(t, { record: savedConversation(), resumeThread: async () => { throw new Error('missing thread'); } });
  const result = await f.companion.send('接着聊');
  assert.equal(result.accepted, false);
  assert.equal(f.count('resumeThread'), 1);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.count('startTurn'), 0);
  assert.equal(f.store.saved.threadId, 'saved-thread');
  assert.equal(f.companion.getState().error, ERRORS.THREAD_UNAVAILABLE);
});

test('原 thread 仍在执行时拒绝发送，不另开聊天', async t => {
  const f = fixture(t, { record: savedConversation(), resumeThread: async id => ({ id, activeTurnId: 'other-turn' }) });
  assert.equal((await f.companion.send('等一下')).accepted, false);
  assert.equal(f.count('startTurn'), 0);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.companion.getState().error, ERRORS.ACTIVE_THREAD);
});

test('首次创建结果不确定，重试和重启都保留护栏', async t => {
  const store = memoryStore();
  const first = fixture(t, { store, startThread: async () => { throw Object.assign(new Error('lost reply'), { code: 'TIMEOUT' }); } });
  await first.companion.send('首次');
  assert.equal(store.saved.creationPending, true);
  await first.companion.send('重试');
  assert.equal(first.count('startThread'), 1);
  assert.equal(first.count('startTurn'), 0);
  first.companion.close();
  const second = fixture(t, { store });
  assert.equal((await second.companion.send('重启后重试')).accepted, false);
  assert.equal(second.count('startThread'), 0);
  assert.equal(second.companion.getState().error, ERRORS.CREATION_UNCERTAIN);
  await second.companion.newChat();
  await second.companion.send('明确开始新的'); second.complete();
  assert.equal(second.count('startThread'), 1);
});

test('账号改变不展示旧记录、不 resume、不新建；显式新聊天可绑定新账号', async t => {
  const f = fixture(t, { record: savedConversation() });
  f.account = { authenticated: true, accountKey: ACCOUNT_B };
  assert.equal((await f.companion.send('另一个账号')).accepted, false);
  assert.deepEqual(f.companion.getState().messages, []);
  assert.equal(f.count('resumeThread'), 0);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.store.saved.threadId, 'saved-thread');
  assert.equal(f.companion.getState().error, ERRORS.ACCOUNT_CHANGED);
  await f.companion.newChat();
  await f.companion.send('新账号聊天'); f.complete();
  assert.equal(f.store.saved.accountKey, ACCOUNT_B);
  assert.equal(f.count('startThread'), 1);
});

test('未收到 account/updated 时，下一次登录校验失败也隐藏旧记录', async t => {
  const f = fixture(t, { record: savedConversation() });
  await f.companion.connect();
  assert.equal(f.companion.getState().messages.length, 2);
  f.account = { authenticated: false };
  await assert.rejects(f.companion.connect());
  assert.deepEqual(f.companion.getState().messages, []);
  assert.equal(f.store.saved.threadId, 'saved-thread');
});

test('完整回复通知早于 startTurn 响应，也只执行一次动作', async t => {
  const f = fixture(t, { startTurn: async ({ threadId, turnId, callbacks }) => {
    callbacks.onNotification({ method: 'item/completed', params: { threadId, turnId,
      item: { type: 'agentMessage', phase: 'final_answer', text: '{"text":"测试跳一下","action":"hop"}' } } });
    callbacks.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
    return { id: turnId };
  } });
  assert.equal((await f.companion.send('跳一下')).accepted, true);
  assert.deepEqual(f.actions, ['hop']);
  assert.equal(f.companion.getState().busy, false);
  f.notify('turn/completed', { threadId: f.lastTurn.threadId, turn: { id: f.lastTurn.turnId, status: 'completed' } });
  assert.deepEqual(f.actions, ['hop']);
});

test('流式完整 JSON 和 item/completed 都不能提前执行动作', async t => {
  const f = fixture(t);
  await f.companion.send('伸个懒腰');
  const { threadId, turnId } = f.lastTurn;
  const text = '{"text":"我动一下","action":"jelly"}';
  f.notify('item/agentMessage/delta', { threadId, turnId, itemId: 'reply', delta: text });
  assert.deepEqual(f.actions, []);
  assert.equal(f.companion.getState().messages.at(-1).text, '我动一下');
  f.notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text } });
  assert.deepEqual(f.actions, []);
  f.notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
  assert.deepEqual(f.actions, ['jelly']);
});

test('失败回合和畸形回复均不执行动作，也不改 thread', async t => {
  const f = fixture(t);
  await f.companion.send('失败'); f.complete({ action: 'hop', status: 'failed' });
  assert.deepEqual(f.actions, []);
  await f.companion.send('畸形回复');
  const { threadId, turnId } = f.lastTurn;
  f.notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text: '{"text":"还没结束","action":"hop"' } });
  f.notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
  assert.deepEqual(f.actions, []);
  assert.equal(f.companion.getState().error, ERRORS.INVALID_RESPONSE);
  assert.equal(f.count('startThread'), 1);
});

test('停止回复后，迟到的完整回复不能执行动作', async t => {
  const f = fixture(t);
  await f.companion.send('停止前的消息');
  await f.companion.stop();
  assert.equal(f.count('interruptTurn'), 1);
  f.complete({ action: 'hop' });
  assert.deepEqual(f.actions, []);
  assert.equal(f.store.saved.messages.at(-1).status, 'interrupted');
  assert.equal(f.store.saved.threadId, f.lastTurn.threadId);
});

test('interrupt 只有 ACK 没有完成通知时，关闭旧 RPC 后在新连接恢复同一 thread', async t => {
  const f = fixture(t);
  await f.companion.send('停止这次回复');
  const oldRpc = f.connections[0], original = { ...f.lastTurn };
  await f.companion.stop();
  assert.equal(f.count('interruptTurn'), 1);
  assert.equal(f.companion.getState().busy, false);
  assert.equal(oldRpc.closed, true);
  assert.equal(f.store.saved.threadId, original.threadId);
  assert.equal(f.store.saved.messages.at(-1).status, 'interrupted');
  assert.equal((await f.companion.send('停止后继续')).accepted, true);
  assert.equal(f.connections.length, 2);
  assert.notEqual(f.connections[1], oldRpc);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('resumeThread'), 1);
  assert.equal(f.lastTurn.threadId, original.threadId);
  oldRpc.callbacks.onNotification({ method: 'turn/completed', params: {
    threadId: original.threadId, turn: { id: original.turnId, status: 'completed' }
  } });
  assert.equal(f.companion.getState().busy, true, '旧连接迟到完成不能结束新回复');
  assert.deepEqual(f.actions, []);
  f.complete();
  assert.equal(f.companion.getState().busy, false);
});

test('取消先于 startTurn 响应，turn/started 通知带来 ID 后立即 interrupt', async t => {
  const response = deferred();
  const f = fixture(t, { startTurn: () => response.promise });
  const sending = f.companion.send('尚未确认启动');
  await settle();
  assert.equal(f.count('startTurn'), 1);
  await f.companion.stop();
  const { threadId, turnId } = f.lastTurn;
  f.notify('turn/started', { threadId, turn: { id: turnId } });
  await settle();
  assert.equal(f.count('interruptTurn'), 1);
  assert.equal(f.companion.getState().busy, false);
  response.resolve({ id: turnId }); await sending;
  f.complete({ action: 'spin' });
  assert.deepEqual(f.actions, []);
});

test('启动超时后才返回 turn ID，仍补发取消且不执行动作', async t => {
  const response = deferred();
  const f = fixture(t, { startTurn: ({ turnId }) => turnId === 'turn-1' ? response.promise : { id: turnId }, turnTimeoutMs: 10 });
  const sending = f.companion.send('慢启动');
  await settle();
  const oldRpc = f.connections[0], original = { ...f.lastTurn };
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.companion.getState().busy, false);
  assert.equal(f.companion.getState().error, ERRORS.TIMEOUT);
  assert.equal(oldRpc.closed, true, '超时必须丢弃旧连接，不能继续使用可能仍 busy 的 RPC');
  response.resolve({ id: f.lastTurn.turnId }); await sending; await settle();
  assert.equal(f.count('interruptTurn'), 1);
  f.complete({ action: 'spin' });
  assert.deepEqual(f.actions, []);
  assert.equal(f.store.saved.threadId, original.threadId);
  assert.equal((await f.companion.send('超时后主动继续')).accepted, true);
  assert.equal(f.connections.length, 2);
  assert.notEqual(f.connections[1], oldRpc);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('resumeThread'), 1);
  assert.equal(f.lastTurn.threadId, original.threadId);
  f.complete();
});

test('账号更新会停止当前回复，隐藏旧内容并禁止迟到动作', async t => {
  const f = fixture(t);
  await f.companion.send('切账号之前');
  f.notify('account/updated', {}); await settle();
  assert.equal(f.count('interruptTurn'), 1);
  assert.deepEqual(f.companion.getState().messages, []);
  f.complete({ action: 'wake' });
  assert.deepEqual(f.actions, []);
  assert.equal(f.store.saved.threadId, f.lastTurn.threadId);
});

test('account/updated 作废旧 RPC，下次经新连接校验账号并 resume 同一 thread', async t => {
  const f = fixture(t);
  await f.companion.send('账号事件前');
  const oldRpc = f.connections[0], original = { ...f.lastTurn };
  f.notify('account/updated', {}); await settle();
  assert.equal(f.companion.getState().busy, false);
  assert.deepEqual(f.companion.getState().messages, []);
  assert.equal(oldRpc.closed, true);
  assert.equal(f.store.saved.threadId, original.threadId);
  assert.equal((await f.companion.send('相同账号重新确认后继续')).accepted, true);
  assert.equal(f.connections.length, 2);
  assert.notEqual(f.connections[1], oldRpc);
  assert.equal(f.count('readAccount'), 2);
  assert.equal(f.count('resumeThread'), 1);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.lastTurn.threadId, original.threadId);
  oldRpc.callbacks.onNotification({ method: 'account/updated', params: {} });
  oldRpc.callbacks.onDisconnect();
  assert.equal(f.companion.getState().busy, true, '旧连接账号或断开事件不得中止新回复');
  assert.equal(f.connections[1].closed, false);
  f.complete();
  assert.equal(f.companion.getState().busy, false);
});

test('账号更新后未重新校验就点新聊天，不沿用缓存的旧 accountKey', async t => {
  const f = fixture(t, { record: savedConversation() });
  await f.companion.connect();
  f.notify('account/updated', {}); await settle();
  assert.equal((await f.companion.newChat()).accepted, true);
  assert.equal(f.store.saved.accountKey, null);
  assert.equal(f.store.saved.threadId, null);
  assert.equal(f.count('startThread'), 0);
});

test('创建前存储失败不发送模型请求，恢复存储后仍可首次创建', async t => {
  const store = memoryStore(); store.failWrite = true;
  const f = fixture(t, { store });
  assert.equal((await f.companion.send('磁盘故障时')).accepted, false);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.count('startTurn'), 0);
  store.failWrite = false;
  assert.equal((await f.companion.send('磁盘恢复后')).accepted, true);
  assert.equal(f.count('startThread'), 1);
  assert.equal(f.count('startTurn'), 1);
  f.complete();
});

test('已有 thread 保存失败不发送模型请求，恢复后复用原 thread', async t => {
  const store = memoryStore(savedConversation()); store.failWrite = true;
  const f = fixture(t, { store });
  await f.companion.send('磁盘故障时');
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.count('startTurn'), 0);
  store.failWrite = false;
  assert.equal((await f.companion.send('磁盘恢复后')).accepted, true);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.count('startTurn'), 1);
  assert.equal(f.lastTurn.threadId, 'saved-thread');
  f.complete();
});

test('最终回复保存失败时不执行动作', async t => {
  const f = fixture(t);
  await f.companion.send('接收时磁盘故障');
  f.store.failWrite = true;
  f.complete({ action: 'hop' });
  assert.deepEqual(f.actions, []);
  assert.equal(f.companion.getState().error, ERRORS.STORAGE);
});

test('读取失败不覆盖原记录、不创建或发送', async t => {
  const store = memoryStore(savedConversation()); store.failRead = true;
  const f = fixture(t, { store });
  await f.companion.connect();
  assert.equal((await f.companion.send('不能覆盖')).accepted, false);
  assert.equal(store.saved.threadId, 'saved-thread');
  assert.equal(store.writes, 0);
  assert.equal(f.count('startThread'), 0);
  assert.equal(f.count('startTurn'), 0);
});

test('解码展示文本但拒绝未知动作和未结束的 JSON', () => {
  assert.equal(partialReply('{"text":"你好\\n球球\\u0021'), '你好\n球球!');
  assert.equal(partialReply('{"action":"hop"'), '');
  assert.equal(finalReply('{"text":"测试","action":"arbitrary-command"}'), null);
  assert.equal(finalReply('{"text":"测试","action":"hop"'), null);
  assert.deepEqual(finalReply('{"text":"测试","action":"hop"}'), { text: '测试', action: 'hop' });
});
