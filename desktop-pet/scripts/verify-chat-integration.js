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
    listModels: async () => ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].map(id => ({ id, displayName: id,
      supportedReasoningEfforts: ['low', 'medium'], defaultReasoningEffort: 'medium' })),
    startThread: async () => ({ id: `smoke-chat-${++counts.threads}` }),
    resumeThread: async id => ({ id, status: 'idle' }),
    async startTurn(threadId, text, selection) {
      assert.ok(selection && ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].includes(selection.model));
      assert.ok(['low', 'medium'].includes(selection.effort));
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
  await poll(() => chat.getState().modelsStatus, value => value === 'ready', 'load current model catalog');
  const win = chatWindow.getWindow(), page = code => win.webContents.executeJavaScript(code);
  const chooseColor = mode => {
    const item = getMenu().getMenuItemById(`color-${mode}`);
    assert.ok(item?.enabled, 'global color menu is independent of Codex monitoring');
    item.click(item, pet, {});
  };
  const petPaint = () => pet.webContents.executeJavaScript(`(() => {
    const head = getComputedStyle(document.querySelector('#pet .eb-head'));
    const eye = getComputedStyle(document.querySelector('#pet .eb-eye'));
    return { fill: head.fill, stroke: head.stroke, eye: eye.fill,
      filter: getComputedStyle(document.querySelector('#pet svg')).filter };
  })()`);
  const originalPaint = await petPaint();
  const chooseAppearance = value => {
    const item = getMenu().getMenuItemById(`color-appearance-${value}`);
    assert.ok(item?.enabled);
    item.click(item, pet, {});
  };
  chooseColor('accessible');
  chooseAppearance('dark');
  await poll(() => page('document.documentElement.dataset.colorMode'), value => value === 'accessible', 'chat receives accessible colors');
  assert.equal(await pet.webContents.executeJavaScript('document.documentElement.dataset.colorMode'), 'accessible');
  assert.equal(await page('getComputedStyle(document.querySelector(".chat-panel")).backgroundColor'), 'rgb(16, 24, 32)');
  assert.deepEqual(await petPaint(), originalPaint, 'dark accessible mode preserves original pet paint');
  chooseAppearance('light');
  await poll(() => page('document.documentElement.dataset.accessibleAppearance'), value => value === 'light', 'light accessible theme arrives');
  assert.equal(await page('getComputedStyle(document.querySelector(".chat-panel")).backgroundColor'), 'rgb(255, 255, 255)');
  assert.deepEqual(await petPaint(), originalPaint, 'light accessible mode preserves original pet paint');
  chooseAppearance('system');
  chooseColor('standard');
  await poll(() => page('document.documentElement.dataset.colorMode'), value => value === 'standard', 'chat restores standard colors');
  assert.equal(await pet.webContents.executeJavaScript('document.documentElement.dataset.colorMode'), 'standard');
  process.stdout.write('PET_COLOR_MODE_OK\n');
  process.stdout.write('PET_COLOR_APPEARANCE_PET_UNCHANGED_OK\n');
  const send = async text => {
    const result = await page(`window.qiuqiuChat.send(${JSON.stringify(text)})`);
    assert.equal(result.accepted, true, result.error);
    await poll(() => chat.getState().busy, busy => !busy, 'reply completes');
  };
  assert.equal(counts.threads, 0, 'open must not create thread');
  assert.equal((await page('window.qiuqiuChat.setModel("gpt-6-astra")')).accepted, true);
  assert.equal(await page('document.querySelector("#chat-model").value'), 'gpt-6-astra');
  assert.equal(counts.threads, 0, 'model selection creates no thread');
  assert.equal(counts.turns, 0, 'model selection sends no messages');
  await send('你好');
  assert.equal(chat.getState().activeModel.model, 'gpt-6-astra');
  assert.equal((await page('window.qiuqiuChat.setModel("auto")')).accepted, true);
  await send('请帮我分析一下周末安排');
  assert.equal(chat.getState().activeModel.model, 'gpt-6-sol');
  assert.equal(counts.threads, 1);
  const originalChatId = chat.getState().activeChatId;
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
  assert.ok(chat.getState().history.some(item => item.id === originalChatId && !item.current));
  assert.equal((await page(`window.qiuqiuChat.selectChat(${JSON.stringify(originalChatId)})`)).accepted, true);
  assert.equal(counts.threads, 1, 'selecting history creates no thread');
  assert.equal(chat.getState().activeChatId, originalChatId);
  await send('继续原聊天');
  assert.equal(counts.threads, 1, 'sending after switching resumes the original thread');
  await page('window.qiuqiuChat.newChat()');
  await send('新开始');
  assert.equal(counts.threads, 2);
  hidePet();
  assert.equal(chatWindow.isVisible(), false);
  assert.equal((await page('window.qiuqiuChat.send("隐藏时拒绝")')).accepted, false);
  assert.equal((await page('window.qiuqiuChat.setModel("gpt-6-astra")')).accepted, false);
  assert.equal((await page('window.qiuqiuChat.refreshModels()')).accepted, false);
  restorePet(); open();
  await poll(() => chatWindow.isVisible(), Boolean, 'open after restore');
  const lockResult = await page('window.qiuqiuChat.send("停止验收")');
  assert.equal(lockResult.accepted, true, lockResult.error);
  powerMonitor.emit('lock-screen');
  await poll(() => chat.getState().busy, busy => !busy, 'lock interrupts');
  assert.equal(chatWindow.isVisible(), false);
  assert.equal(await page('window.qiuqiuChat.getState()'), null);
  assert.equal((await page('window.qiuqiuChat.send("锁屏时拒绝")')).accepted, false);
  assert.equal((await page('window.qiuqiuChat.setModel("gpt-6-astra")')).accepted, false);
  assert.equal((await page('window.qiuqiuChat.refreshModels()')).accepted, false);
  assert.equal((await page(`window.qiuqiuChat.selectChat(${JSON.stringify(originalChatId)})`)).accepted, false);
  powerMonitor.emit('unlock-screen');
  assert.equal(counts.threads, 2);
  process.stdout.write(`PET_CHAT_INTEGRATION_OK ${JSON.stringify(counts)}\n`);
}

module.exports = { createSmokeChatRpc, verifyChatIntegration };
