const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');

const counts = { connections: 0, threads: 0, turns: 0, interrupts: 0 };
function createSmokeChatRpc({ onNotification }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CHAT_ONLY, '1');
  counts.connections++;
  let closed = false, timer;
  const emit = (method, params) => { if (!closed) onNotification({ method, params }); };
  return {
    start: async () => {},
    readAccount: async () => ({ authenticated: true, accountKey: 'a'.repeat(64) }),
    startThread: async () => ({ id: `smoke-chat-${++counts.threads}` }),
    resumeThread: async id => ({ id, status: 'idle' }),
    async startTurn(threadId, text) {
      const id = `smoke-turn-${++counts.turns}`;
      emit('turn/started', { threadId, turn: { id, status: 'inProgress' } });
      if (text !== '停止验收') timer = setTimeout(() => {
        const action = text === '靠左' ? 'dockLeft' : text === '回来' ? 'restore' : 'none';
        const reply = JSON.stringify({ text: `收到：${text}`, action });
        emit('item/agentMessage/delta', { threadId, turnId: id, itemId: 'reply', delta: reply });
        emit('item/completed', { threadId, turnId: id, item: { type: 'agentMessage', text: reply, phase: 'final_answer' } });
        emit('turn/completed', { threadId, turn: { id, status: 'completed' } });
      }, 100);
      return { id, status: 'inProgress' };
    },
    async interruptTurn(threadId, turnId) {
      counts.interrupts++;
      clearTimeout(timer);
      emit('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } });
    },
    close() { closed = true; clearTimeout(timer); }
  };
}

async function verifyChatIntegration({ pet, chat, chatWindow, getMenu, getPresentation, hidePet, restorePet, powerMonitor }) {
  const poll = async (read, test, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const value = await read(); if (test(value)) return value; await wait(30); }
    assert.fail(label);
  };
  assert.equal(counts.connections, 0, 'boot must not connect');
  const open = () => {
    const item = getMenu().getMenuItemById('chat-open');
    assert.ok(item?.enabled);
    item.click(item, pet, {});
  };
  open();
  await poll(() => chatWindow.isVisible() && chat.getState().connection, value => value === 'ready', 'open panel and connect');
  const win = chatWindow.getWindow(), page = code => win.webContents.executeJavaScript(code);
  const send = async text => {
    const result = await page(`window.qiuqiuChat.send(${JSON.stringify(text)})`);
    assert.equal(result.accepted, true, result.error);
    await poll(() => chat.getState().busy, busy => !busy, 'reply completes');
  };
  assert.equal(counts.threads, 0, 'open must not create thread');
  await send('你好');
  await send('继续聊');
  assert.equal(counts.threads, 1);
  await page('window.qiuqiuChat.close()');
  await poll(() => chatWindow.isVisible(), visible => !visible, 'close hides panel');
  open();
  await poll(() => chatWindow.isVisible(), Boolean, 'reopen');
  assert.equal(chatWindow.getWindow(), win);
  assert.equal((await page('window.qiuqiuChat.getState()')).messages.length, 4);
  await send('靠左');
  assert.equal(getPresentation().side, 'left', 'chat action routes to existing edge controller');
  await send('回来');
  assert.equal(getPresentation().side, null);
  assert.equal(counts.threads, 1);
  const stopResult = await page('window.qiuqiuChat.send("停止验收")');
  assert.equal(stopResult.accepted, true, stopResult.error);
  await page('window.qiuqiuChat.stop()');
  assert.equal(chat.getState().busy, false);
  assert.equal(counts.interrupts, 1);
  await page('window.qiuqiuChat.newChat()');
  assert.equal(counts.threads, 1, 'new chat only clears pointer');
  await send('新开始');
  assert.equal(counts.threads, 2);
  hidePet();
  assert.equal(chatWindow.isVisible(), false);
  assert.equal((await page('window.qiuqiuChat.send("隐藏时拒绝")')).accepted, false);
  restorePet(); open();
  await poll(() => chatWindow.isVisible(), Boolean, 'open after restore');
  const lockResult = await page('window.qiuqiuChat.send("停止验收")');
  assert.equal(lockResult.accepted, true, lockResult.error);
  powerMonitor.emit('lock-screen');
  await poll(() => chat.getState().busy, busy => !busy, 'lock interrupts');
  assert.equal(chatWindow.isVisible(), false);
  assert.equal(await page('window.qiuqiuChat.getState()'), null);
  assert.equal((await page('window.qiuqiuChat.send("锁屏时拒绝")')).accepted, false);
  powerMonitor.emit('unlock-screen');
  assert.equal(counts.threads, 2);
  process.stdout.write(`PET_CHAT_INTEGRATION_OK ${JSON.stringify(counts)}\n`);
}

module.exports = { createSmokeChatRpc, verifyChatIntegration };
