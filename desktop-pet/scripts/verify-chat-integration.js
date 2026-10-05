const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { capturePaintedWindow } = require('./verify-codex-companion');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// These checks observe the actual renderer and content area, rather than the
// macOS frame. They are also exported for Node tests of the acceptance boundary.
function readChatSurface() {
  const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
  const style = selector => getComputedStyle(document.querySelector(selector));
  const visible = selector => Boolean(document.querySelector(selector)?.getClientRects().length);
  return { width: innerWidth, height: innerHeight, scrollWidth: document.body.scrollWidth,
    panel: rect('.chat-panel'), header: rect('.chat-header'), avatar: rect('#chat-avatar'),
    title: document.querySelector('h1').textContent, titleFont: style('h1').fontSize,
    statusHidden: document.querySelector('#connection-status').classList.contains('sr-only'),
    update: visible('#app-update') ? rect('#app-update') : null,
    conversation: visible('#conversation') ? rect('#conversation') : null,
    history: visible('#history-view') ? rect('#history-view') : null,
    composer: rect('#composer'), input: rect('#message-input'),
    inputScroll: document.querySelector('#message-input').scrollHeight,
    inputClient: document.querySelector('#message-input').clientHeight,
    send: rect('#send-message'), sendLabel: rect('#send-message .button-label'), sendIcon: rect('#send-message svg'),
    updateInMessages: document.querySelector('#messages').contains(document.querySelector('#app-update')),
    roles: [...document.querySelectorAll('#messages .message')].map(row => ({ role: row.dataset.role,
      label: row.querySelector('.message-label').textContent,
      background: getComputedStyle(row.querySelector('.message-text')).backgroundColor,
      border: getComputedStyle(row.querySelector('.message-text')).borderTopWidth })),
    avatarState: { ...document.querySelector('#chat-avatar').dataset },
    headerButtons: ['#new-chat', '#chat-history', '#close-chat'].filter(visible).map(selector => ({ selector, rect: rect(selector) })) };
}

function assertChatSurface(view, content, { width = 360, height = 480, appearance = 'light', mode = 'standard', longInput = false } = {}) {
  assert.equal(view.width, width, '聊天实际内容宽度');
  assert.equal(view.height, height, '聊天实际内容高度');
  assert.ok(Math.abs(content.width - view.width) <= 1 && Math.abs(content.height - view.height) <= 1, 'native content 必须与 DOM 一致');
  assert.ok(view.scrollWidth <= width + 1, '聊天不能横向溢出');
  assert.ok(Math.abs(view.panel.left) <= 1 && Math.abs(view.panel.top) <= 1 &&
    Math.abs(view.panel.right - width) <= 1 && Math.abs(view.panel.bottom - height) <= 1, '聊天面板填满 native content');
  assert.equal(view.title.trim(), '聊一会儿');
  assert.equal(view.titleFont, '16px');
  assert.equal(view.statusHidden, true, '连接状态不占标题第二行');
  assert.ok(Math.abs(view.header.height - 52) <= 1, '聊天标题行 52px');
  assert.ok(Math.abs(view.avatar.width - 32) <= 1 && Math.abs(view.avatar.height - 32) <= 1, '聊天头像 32px');
  for (const button of view.headerButtons) assert.ok(button.rect.left >= 0 && button.rect.right <= width &&
    button.rect.top >= view.header.top && button.rect.bottom <= view.header.bottom, `${button.selector} 留在标题行`);
  if (view.update) {
    assert.ok(Math.abs(view.update.height - 36) <= 1 && view.update.top >= view.header.bottom, '更新提示独立 36px');
    assert.ok(view.update.right <= width && view.update.left >= 0, '更新提示不裁切');
  }
  assert.equal(view.updateInMessages, false, '更新提示不进入聊天记录');
  if (view.conversation) assert.ok(view.conversation.top >= (view.update?.bottom || view.header.bottom) - 1 &&
    view.conversation.bottom <= view.composer.top + 1 && view.conversation.height > 0, '聊天区域与输入框不重叠');
  assert.ok(view.composer.left >= 0 && view.composer.right <= width && view.composer.bottom <= height && view.composer.top >= 0, '输入区完整可见');
  assert.ok(view.input.height >= 39 && view.input.height <= 107, '输入框在 40 至 106px 内');
  if (longInput) assert.ok(view.inputScroll > view.inputClient && Math.abs(view.input.height - 106) <= 1, '超过四行在输入框内部滚动');
  const send = view.send, label = view.sendLabel, icon = view.sendIcon;
  assert.ok(label && icon && send, '发送保留文字与图标');
  assert.ok(Math.abs((Math.min(label.left, icon.left) + Math.max(label.right, icon.right)) / 2 - (send.left + send.right) / 2) <= 2,
    '发送文字与图标组合水平居中');
  for (const item of [label, icon]) assert.ok(Math.abs((item.top + item.bottom) / 2 - (send.top + send.bottom) / 2) <= 1.5, '发送文字与图标垂直居中');
  for (const row of view.roles) {
    assert.equal(row.label, row.role === 'user' ? '你' : '球球', '每条消息明确角色');
    if (row.role === 'user') {
      assert.equal(row.border, '0px', '用户气泡无描边');
      if (mode === 'standard') assert.equal(row.background, appearance === 'dark' ? 'rgb(37, 69, 63)' : 'rgb(225, 244, 236)', '用户气泡沿用认可配色');
    } else assert.equal(row.background, 'rgba(0, 0, 0, 0)', '球球回复保持纯正文');
  }
}

async function pointerClick(win, selector) {
  const r = await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  assert.ok(r.width > 0 && r.height > 0, `${selector} 可点击`);
  const x = Math.round((r.left + r.right) / 2), y = Math.round((r.top + r.bottom) / 2);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(80);
}

async function verifyChatUnified({ win, pet, getMenu, chat, poll }) {
  const output = process.env.PET_CHAT_SMOKE_OUT || path.join(os.tmpdir(), `qiuqiu-chat-unified-${process.pid}`);
  fs.mkdirSync(output, { recursive: true });
  const page = code => win.webContents.executeJavaScript(code, true), surfaces = [], screenshots = [];
  const bounds = win.getBounds();
  const preferences = win.webContents.getLastWebPreferences();
  assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true);
  const select = id => { const item = getMenu().getMenuItemById(id); assert.ok(item?.enabled, id); item.click(item, pet, {}); };
  for (const width of [360, 320]) for (const mode of ['standard', 'accessible']) for (const appearance of ['light', 'dark']) {
    select('color-accessible'); select(`color-appearance-${appearance}`); select(`color-${mode}`);
    win.setContentSize(width, 480);
    await poll(() => page(`innerWidth === ${width} && document.documentElement.dataset.colorMode === '${mode}' && document.documentElement.dataset.accessibleAppearance === '${appearance}'`), Boolean, '聊天主题与尺寸同步');
    await page("document.querySelector('#message-input').value = Array(7).fill('四行之后继续在输入框内滚动').join('\\n'); document.querySelector('#message-input').dispatchEvent(new Event('input'))");
    await wait(80);
    await pointerClick(win, '#chat-model');
    const modelDescription = await page(`(() => {
      const node = document.querySelector('.model-option-description');
      return { text: node.textContent, rect: node.getBoundingClientRect().toJSON(),
        menu: document.querySelector('#model-menu').getBoundingClientRect().toJSON(),
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, whiteSpace: getComputedStyle(node).whiteSpace };
    })()`);
    assert.equal(modelDescription.whiteSpace, 'nowrap', '自动模型说明保持一行');
    assert.ok(modelDescription.rect.height <= 18 && modelDescription.scrollWidth <= modelDescription.clientWidth + 1 &&
      modelDescription.rect.right <= modelDescription.menu.right && modelDescription.menu.right <= width,
    '自动模型说明在 320/360 窄宽菜单内完整展示');
    if (width === 320 && mode === 'standard' && appearance === 'light') {
      const file = path.join(output, 'chat-320-model-menu.png');
      await capturePaintedWindow({ win, artifactPath: file }); screenshots.push(file);
    }
    await pointerClick(win, '#chat-model');
    const view = await page(`(${readChatSurface.toString()})()`), content = win.getContentBounds();
    assertChatSurface(view, content, { width, mode, appearance, longInput: true });
    assert.deepEqual(view.headerButtons.map(button => button.selector), ['#new-chat', '#chat-history', '#close-chat'], '新聊天、历史和关闭始终留在标题行');
    surfaces.push({ width, mode, appearance, nativeContent: content, nativeOuter: win.getBounds(), modelDescription, view });
    const file = path.join(output, `chat-${width}-${mode}-${appearance}.png`);
    await capturePaintedWindow({ win, artifactPath: file }); screenshots.push(file);
  }
  // Real pointer events through the production IPC retain the exact draft on
  // a rejected synthetic turn. No personal conversation or Codex process runs.
  select('color-standard'); select('color-appearance-light'); win.setContentSize(360, 480);
  await poll(() => page('innerWidth'), value => value === 360, '恢复聊天宽度');
  const unsafe = '<img src=x onerror="window.chatSmokeInjected=true"><script>window.chatSmokeInjected=true</script>';
  const beforeSafeSend = counts.turns;
  await page(`document.querySelector('#message-input').value=${JSON.stringify(unsafe)};document.querySelector('#message-input').dispatchEvent(new Event('input'))`);
  await pointerClick(win, '#send-message svg');
  await poll(() => chat.getState().busy, busy => !busy && counts.turns === beforeSafeSend + 1, '真实发送图标只触发一次模拟回复');
  await poll(() => page("[...document.querySelectorAll('#messages .message-text')].some(node=>node.textContent.includes('<script>'))"), Boolean, '消息按纯文本展示');
  assert.equal(await page("document.querySelectorAll('#messages img, #messages script').length"), 0);
  assert.equal(await page('Boolean(window.chatSmokeInjected)'), false);
  await page("window.qiuqiuChat.send('模拟下一次连接失败')");
  await poll(() => chat.getState().busy, busy => !busy, '模拟断连完成');
  const draft = '  发送失败验收  ', before = { ...counts };
  await page(`document.querySelector('#message-input').value = ${JSON.stringify(draft)}; document.querySelector('#message-input').dispatchEvent(new Event('input'))`);
  await pointerClick(win, '#send-message .button-label');
  await poll(() => page("!document.querySelector('#error-banner').hidden && !document.querySelector('#send-message').disabled"), Boolean, '发送失败可继续编辑');
  assert.equal(await page("document.querySelector('#message-input').value"), draft, '失败保留空格和原始输入');
  assert.equal(counts.turns, before.turns, '拒绝后不自动重试');
  // Account verification intentionally hides history on a disconnected client.
  // Reconnect the synthetic client before checking history; this creates no turn.
  await chat.connect();
  await poll(() => chat.getState().connection, value => value === 'ready', '模拟账号重新核验');
  assert.equal(await page("document.querySelector('#message-input').value"), draft, '重新连接保留失败草稿');
  await pointerClick(win, '#chat-history');
  await poll(() => page("!document.querySelector('#history-view').hidden"), Boolean, '真实历史入口');
  assert.ok((await page("document.querySelectorAll('#history-list .history-item').length")) >= 1);
  await pointerClick(win, '#history-back');
  await pointerClick(win, '#new-chat');
  await poll(() => page("!document.querySelector('#new-chat-confirmation').hidden"), Boolean, '真实新聊确认');
  assert.equal(await page('document.activeElement.id'), 'cancel-new-chat');
  await pointerClick(win, '#cancel-new-chat');
  assert.equal(await page("document.querySelector('#message-input').value"), draft);
  assert.equal(counts.threads, before.threads, '取消新聊不创建线程');
  await page("document.querySelector('#message-input').value = ''; document.querySelector('#message-input').dispatchEvent(new Event('input'))");
  await pointerClick(win, '#new-chat');
  await pointerClick(win, '#confirm-new-chat');
  await poll(() => page("!document.querySelector('#new-chat').hidden && document.querySelector('#new-chat').disabled && document.querySelector('#conversation').getClientRects().length > 0"), Boolean, '新建后空聊天仍显示置灰入口');
  assert.equal(counts.threads, before.threads, '空聊天在首次发送前不创建线程');
  const emptyHeader = await page(`(${readChatSurface.toString()})()`);
  fs.writeFileSync(path.join(output, 'empty-new-chat-header.json'), JSON.stringify(emptyHeader, null, 2));
  await capturePaintedWindow({ win, artifactPath: path.join(output, 'chat-empty-new-entry.png') });
  await pointerClick(win, '#chat-history');
  await pointerClick(win, '.history-item');
  await poll(() => page("!document.querySelector('#new-chat').disabled"), Boolean, '回到原聊天后新建入口恢复可点');
  win.setBounds(bounds, false); select('color-appearance-system');
  const report = { ok: true, packaged: require('electron').app.isPackaged, actualModelCalls: 0,
    surfaces, screenshots, checks: ['native content bounds', '320/360 standard/accessible light/dark', '36px update outside log',
      'roles and user bubble', '40–106px scrolling input', 'centered send label/icon', 'pointer send and safe text',
      'pointer send rejection preserves draft', 'history and cancel new chat', 'isolated sandboxed renderer'] };
  fs.writeFileSync(path.join(output, 'unified-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`PET_CHAT_UI_SMOKE_OK ${JSON.stringify({ surfaces: surfaces.length, report: path.join(output, 'unified-report.json') })}\n`);
}

const counts = { connections: 0, threads: 0, turns: 0, interrupts: 0 };
let rejectNextAccount = false;
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
    readAccount: async () => {
      if (rejectNextAccount) { rejectNextAccount = false; throw new Error('模拟连接失败，消息没有发出。'); }
      return { authenticated: true, accountKey: 'a'.repeat(64) };
    },
    listModels: async () => ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].map(id => ({ id, displayName: id,
      supportedReasoningEfforts: ['low', 'medium'], defaultReasoningEffort: 'medium' })),
    startThread: async () => ({ id: `smoke-chat-${++counts.threads}` }),
    resumeThread: async id => ({ id, status: 'idle' }),
    async startTurn(threadId, text, selection) {
      assert.ok(selection && ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'].includes(selection.model));
      assert.ok(['low', 'medium'].includes(selection.effort));
      if (text === '模拟下一次连接失败') {
        rejectNextAccount = true;
        throw new Error('模拟连接中断。');
      }
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
  assert.equal(getMenu().getMenuItemById('update-check').label, `更新球球至 ${nextVersion}`);
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
  await verifyChatUnified({ win, pet, getMenu, chat, poll });
  const originalChatId = chat.getState().activeChatId;
  const retainedMessageCount = chat.getState().messages.length;
  await page('window.qiuqiuChat.close()');
  await poll(() => chatWindow.isVisible(), visible => !visible, 'close hides panel');
  open();
  await poll(() => chatWindow.isVisible(), Boolean, 'reopen');
  assert.equal(chatWindow.getWindow(), win);
  assert.equal((await page('window.qiuqiuChat.getState()')).messages.length, retainedMessageCount, '隐藏重开保留全部已接收消息');
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

module.exports = { createSmokeChatRpc, verifyChatIntegration, getSmokeRelease, readChatSurface, assertChatSurface, pointerClick, verifyChatUnified };
