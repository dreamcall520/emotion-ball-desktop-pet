const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { capturePaintedWindow } = require('./verify-codex-companion');

const counts = { connections: 0, threads: 0, turns: 0, interrupts: 0 };
const nextVersion = require('../../package.json').version.replace(/\d+$/, patch => Number(patch) + 1);
async function getSmokeRelease(url) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CHAT_ONLY, '1');
  assert.equal(url, 'https://api.github.com/repos/dreamcall520/emotion-ball-desktop-pet/releases/latest');
  return { tag_name: `v${nextVersion}`, draft: false, prerelease: false };
}

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

async function verifyChatIntegration({ pet, chat, chatWindow, screen, getMenu, getPresentation, hidePet, restorePet,
  powerMonitor, checkUpdates, getAboutWindow, getBubbleWindow }) {
  const poll = async (read, test, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const value = await read(); if (test(value)) return value; await wait(30); }
    assert.fail(label);
  };
  assert.equal(counts.connections, 0, 'boot must not connect');
  await checkUpdates();
  await poll(() => getBubbleWindow()?.isVisible(), Boolean, 'desktop update bubble appears');
  const bubble = getBubbleWindow();
  await poll(() => bubble.webContents.executeJavaScript('document.querySelector("#message").textContent'),
    value => value === `球球有新版本 ${nextVersion}`, 'bubble shows the release');
  assert.equal(getAboutWindow(), null, 'bubble delivers the automatic reminder');
  assert.equal(counts.connections, 0, 'bubble starts no Codex connection');
  if (process.env.PET_SMOKE_CHAT_SCREENSHOT) await capturePaintedWindow({ win: bubble,
    artifactPath: process.env.PET_SMOKE_CHAT_SCREENSHOT.replace(/\.png$/, '-bubble.png') });
  await bubble.webContents.executeJavaScript('document.querySelector("[data-action=app-update-open]").click()');
  await poll(() => getAboutWindow()?.isVisible(), Boolean, 'bubble button opens About');
  getAboutWindow().close();
  process.stdout.write(`PET_DESKTOP_UPDATE_BUBBLE_OK ${nextVersion} (simulated release)\n`);
  const open = () => {
    const item = getMenu().getMenuItemById('chat-open');
    assert.ok(item?.enabled);
    item.click(item, pet, {});
  };
  open();
  await poll(() => chatWindow.isVisible() && chat.getState().connection, value => value === 'ready', 'open panel and connect');
  await poll(() => chat.getState().modelsStatus, value => value === 'ready', 'load current model catalog');
  const win = chatWindow.getWindow(), page = code => win.webContents.executeJavaScript(code);
  const beforeUpdate = { ...counts };
  await checkUpdates();
  await poll(() => page('document.querySelector("#app-update").hidden'), value => value === false, 'show update reminder');
  assert.equal(await page('document.querySelector("#app-update-text").textContent'), `球球有新版本 ${nextVersion}`);
  assert.equal(getAboutWindow(), null, 'visible chat receives update without an automatic About popup');
  assert.equal(getMenu().getMenuItemById('update-check').label, `● 有新版本 ${nextVersion}…`);
  assert.equal(await page('document.querySelector("#messages").children.length'), 0, 'reminder is outside conversation history');
  assert.deepEqual(counts, beforeUpdate, 'update checking consumes no model turn');
  if (process.env.PET_SMOKE_CHAT_SCREENSHOT) await capturePaintedWindow({ win,
    artifactPath: process.env.PET_SMOKE_CHAT_SCREENSHOT });
  await page('document.querySelector("#open-app-update").click()');
  await poll(() => getAboutWindow()?.isVisible(), Boolean, 'update reminder opens About');
  const about = getAboutWindow();
  await poll(() => about.webContents.executeJavaScript('document.body.innerText'),
    value => value.includes(nextVersion) && value.includes('发现新版本'), 'About shows the same release');
  if (process.env.PET_SMOKE_CHAT_SCREENSHOT) await capturePaintedWindow({ win: about,
    artifactPath: process.env.PET_SMOKE_CHAT_SCREENSHOT.replace(/\.png$/, '-about.png') });
  about.close();
  process.stdout.write(`PET_CHAT_UPDATE_REMINDER_OK ${nextVersion} (simulated release)\n`);
  if (process.env.PET_SMOKE_CHAT_AVATAR === '1') {
    await poll(() => page("Boolean(document.querySelector('#chat-avatar .eb-rive-aurora.ready'))"),
      Boolean, 'current aurora avatar animation');
    if (process.env.PET_SMOKE_CHAT_SCREENSHOT) {
      const fs = require('node:fs');
      fs.writeFileSync(process.env.PET_SMOKE_CHAT_SCREENSHOT,
        (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.PET_SMOKE_CHAT_SCREENSHOT.replace(/\.png$/, '-pet.png'),
        (await pet.webContents.capturePage()).toPNG());
    }
    process.stdout.write('PET_CHAT_AVATAR_ANIMATED_OK\n');
  }
  const initialOffset = { x: pet.getBounds().x - win.getBounds().x, y: pet.getBounds().y - win.getBounds().y };
  for (const side of ['left', 'right']) {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const bounds = win.getBounds();
    const x = side === 'left' ? area.x + 12 : area.x + area.width - bounds.width - 12;
    win.setPosition(x, bounds.y, false);
    await wait(260);
    const chatBounds = win.getBounds(), petBounds = pet.getBounds();
    const visibleArea = screen.getDisplayMatching(chatBounds).workArea;
    for (const item of [chatBounds, petBounds]) {
      assert.ok(item.x >= visibleArea.x + 12 && item.x + item.width <= visibleArea.x + visibleArea.width - 12);
      assert.ok(item.y >= visibleArea.y + 12 && item.y + item.height <= visibleArea.y + visibleArea.height - 12);
    }
    assert.deepEqual({ x: petBounds.x - chatBounds.x, y: petBounds.y - chatBounds.y }, initialOffset,
      '拖到屏幕边缘后聊天窗与球球仍相邻');
  }
  process.stdout.write('PET_CHAT_EDGE_DRAG_OK\n');
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
  win.setPosition(win.getBounds().x + 100, win.getBounds().y, false);
  await poll(() => getPresentation().side, side => side === null, 'moving chat from tucked pet restores full pet');
  assert.equal(await pet.webContents.executeJavaScript("document.querySelector('#pet').dataset.presentation"), 'free');
  await send('靠左');
  assert.equal(getPresentation().side, 'left');
  await page('window.qiuqiuChat.close()');
  open();
  await poll(() => chatWindow.isVisible(), Boolean, 'reopen from tucked pet');
  assert.equal(getPresentation().side, null, 'opening chat from tucked pet reveals the whole pet');
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

module.exports = { createSmokeChatRpc, verifyChatIntegration, getSmokeRelease };
