// Native UI smoke test with fake IPC state only. This never starts a Codex client.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const outputDirectory = process.env.PET_CHAT_SMOKE_OUT || path.resolve(__dirname, '../output/chat-smoke');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const electronBinary = process.env.PET_CHAT_SMOKE_ELECTRON || require('electron');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-chat-ui-smoke-'));
  const child = spawn(electronBinary, [`--user-data-dir=${userData}`, __filename], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PET_CHAT_SMOKE_USER_DATA: userData },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const capture = chunk => { output += chunk.toString(); process.stdout.write(chunk); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('close', code => {
    clearTimeout(timer);
    fs.rmSync(userData, { recursive: true, force: true });
    process.exitCode = code === 0 && output.includes('PET_CHAT_UI_SMOKE_OK') ? 0 : 1;
  });
} else {
  const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
  const { createChatWindow } = require('../lib/chat-window');
  if (!process.env.PET_CHAT_SMOKE_USER_DATA) throw new Error('请通过 node 运行本脚本，以隔离用户数据。');
  app.setPath('userData', process.env.PET_CHAT_SMOKE_USER_DATA);
  app.setActivationPolicy('accessory');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  app.whenReady().then(async () => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const checks = [], screenshots = [], errors = [], visibility = [];
    let chat, focusWindow;
    let state = { messages: [], history: [], activeChatId: 'empty-draft', canStartNewChat: false, busy: false, connection: 'idle', error: null, hasConversation: false };
    const calls = { send: 0, stop: 0, newChat: 0, selectChat: 0, close: 0 };
    let rejectSelection = false;
    const history = [
      { id: 'chat-a', title: '今天忙了一整天，想跟你歇一会儿。', updatedAt: '2026-09-22T12:00:00.000Z', current: true },
      { id: 'chat-b', title: '陪我想想周末怎么过', updatedAt: '2026-09-21T10:30:00.000Z', current: false },
      { id: 'chat-c', title: '晚安，球球', updatedAt: '2026-09-20T14:05:00.000Z', current: false }
    ];
    const workArea = screen.getPrimaryDisplay().workArea;
    let petBounds = { x: workArea.x + workArea.width - 90, y: workArea.y + workArea.height / 2 - 40, width: 80, height: 80 };
    const allow = event => assert.equal(event.sender, chat.getWindow().webContents);
    const update = next => { state = next; chat.update(state); };
    const mark = name => checks.push(name);
    const js = code => chat.getWindow().webContents.executeJavaScript(code, true);
    const waitFor = async (code, label) => {
      for (let index = 0; index < 40; index += 1) {
        if (await js(code)) return;
        await delay(50);
      }
      throw new Error(`等待失败：${label}`);
    };
    const capture = async name => {
      await delay(100);
      const file = path.join(outputDirectory, `${name}.png`);
      fs.writeFileSync(file, (await chat.getWindow().webContents.capturePage()).toPNG());
      screenshots.push(file);
    };
    try {
      nativeTheme.themeSource = 'light';
      chat = createChatWindow({ BrowserWindow, screen, getPetWindow: () => ({ isDestroyed: () => false, getBounds: () => petBounds }), onError: error => errors.push(error.message), onVisibilityChange: visible => visibility.push(visible) });
      ipcMain.handle('pet:chat-get', event => { allow(event); return state; });
      ipcMain.handle('pet:chat-send', (event, text) => {
        allow(event);
        calls.send += 1;
        update({ messages: [{ id: 'user-1', role: 'user', text, status: 'complete' }, { id: 'answer-1', role: 'assistant', text: '', status: 'streaming' }], history, activeChatId: 'chat-a', canStartNewChat: true, busy: true, connection: 'ready', error: null, hasConversation: true });
        return { accepted: true };
      });
      ipcMain.handle('pet:chat-stop', event => {
        allow(event);
        calls.stop += 1;
        update({ ...state, busy: false, messages: state.messages.map(message => message.role === 'assistant' ? { ...message, status: 'interrupted' } : message) });
        return { accepted: true };
      });
      ipcMain.handle('pet:chat-new', event => {
        allow(event);
        calls.newChat += 1;
        update({ messages: [], history: history.map(item => ({ ...item, current: false })), activeChatId: 'new-empty-draft', canStartNewChat: false, busy: false, connection: 'idle', error: null, hasConversation: false });
        return { accepted: true };
      });
      ipcMain.handle('pet:chat-select', (event, id) => {
        allow(event);
        calls.selectChat += 1;
        if (rejectSelection) return { accepted: false, error: '这次没能打开聊天，原来的内容还在。' };
        assert.ok(history.some(item => item.id === id));
        update({ ...state, messages: [{ id: `${id}-u`, role: 'user', text: '陪我想想周末怎么过', status: 'complete' }, { id: `${id}-a`, role: 'assistant', text: '去公园慢慢走一圈，再找一家喜欢的小店坐坐？', status: 'complete' }], history: history.map(item => ({ ...item, current: item.id === id })), activeChatId: id, hasConversation: true, error: null });
        return { accepted: true };
      });
      ipcMain.on('pet:chat-close', event => { allow(event); calls.close += 1; chat.hide(); });
      chat.show(state);
      // The user's physical keyboard must not alter isolated test drafts while
      // this short-lived window checks native focus. DOM test events still run.
      chat.getWindow().webContents.on('before-input-event', event => event.preventDefault());
      await new Promise(resolve => chat.getWindow().webContents.once('did-finish-load', resolve));
      await waitFor("Boolean(window.qiuqiuChat && !document.getElementById('empty-state').hidden)", '空态加载');
      assert.equal(calls.send, 0);
      assert.equal(calls.newChat, 0);
      const layout = await js(`({ width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, composer: document.getElementById('composer').getBoundingClientRect().toJSON(), footer: document.querySelector('.privacy-note').getBoundingClientRect().toJSON(), textColor: getComputedStyle(document.querySelector('.chat-panel')).color })`);
      assert.equal(layout.width, 360);
      assert.equal(layout.height, 480);
      assert.ok(layout.bodyWidth <= layout.width);
      assert.ok(layout.composer.bottom < layout.height && layout.footer.bottom <= layout.height);
      await capture('01-light-empty');
      mark('浅色空态、360×480 布局与无自动发消息');

      await js(`(() => { const input = document.getElementById('message-input'); input.value = '今天忙了一整天，想跟你歇一会儿。'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new CompositionEvent('compositionstart')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); input.dispatchEvent(new CompositionEvent('compositionend')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); })()`);
      await delay(80);
      assert.equal(calls.send, 0);
      await js("document.getElementById('composer').requestSubmit()");
      await waitFor("document.getElementById('new-chat').disabled && !document.getElementById('stop-message').hidden", '发送后忙碌状态');
      assert.equal(calls.send, 1);
      update({ ...state, messages: [state.messages[0], { id: 'answer-1', role: 'assistant', text: '那就先把肩膀放松一点，我陪你待一会儿。\n今天有什么想跟我说的吗？', status: 'streaming' }] });
      await waitFor("document.querySelector('[data-role=assistant] .message-text').textContent.includes('肩膀')", '流式文字');
      await capture('02-light-streaming');
      mark('中文输入法、Shift+Enter 不误发与流式显示');
      await js("document.getElementById('stop-message').click()");
      await waitFor("!document.getElementById('new-chat').disabled && document.getElementById('stop-message').hidden", '停止回复');
      assert.equal(calls.stop, 1);
      assert.equal(await js("document.querySelector('[data-role=assistant] .message-status').textContent"), '已停止回复');
      mark('停止与中断状态反馈');

      nativeTheme.themeSource = 'dark';
      update({ ...state, messages: [state.messages[0], { id: 'answer-1', role: 'assistant', text: '那就先把肩膀放松一点，我陪你待一会儿。\n今天有什么想跟我说的吗？', status: 'complete' }] });
      await waitFor(`getComputedStyle(document.querySelector('.chat-panel')).color !== ${JSON.stringify(layout.textColor)}`, '深色主题');
      await capture('03-dark-conversation');
      mark('系统深色主题');

      const unsafe = '<img src=x onerror="window.chatSmokeInjected=true"><script>window.chatSmokeInjected=true</script>';
      update({ ...state, messages: [{ id: 'user-long', role: 'user', text: '可以陪我聊得久一点吗？', status: 'complete' }, { id: 'answer-long', role: 'assistant', text: `${unsafe}\n${'长消息也会留在聊天区域里，不挤掉输入框。'.repeat(100)}`, status: 'complete' }] });
      await waitFor("document.querySelector('[data-role=assistant] .message-text').textContent.includes('<img')", '长消息和安全文本');
      assert.equal(await js("document.querySelectorAll('#messages img, #messages script').length"), 0);
      assert.equal(await js('Boolean(window.chatSmokeInjected)'), false);
      assert.equal(await js('document.body.scrollWidth <= innerWidth'), true);
      assert.equal(await js("document.getElementById('conversation').scrollHeight > document.getElementById('conversation').clientHeight"), true);
      assert.equal(await js("document.getElementById('composer').getBoundingClientRect().bottom < innerHeight"), true);
      await js("document.getElementById('conversation').scrollTop = 0");
      await capture('04-dark-long-safe-text');
      mark('长回复滚动与 HTML/脚本纯文本展示');

      update({ ...state, error: '连接中断了。这段聊天会保留，你可以重新编辑上一条消息后再发送。' });
      await waitFor("!document.getElementById('error-banner').hidden", '错误提示');
      const restored = await js("(() => { document.getElementById('message-input').value = ''; document.getElementById('retry-message').click(); return document.getElementById('message-input').value; })()");
      assert.equal(calls.send, 1);
      assert.equal(restored, '可以陪我聊得久一点吗？');
      await capture('05-dark-error-draft');
      mark('错误保留聊天与显式编辑重试，不自动重发');

      const beforeId = chat.getWindow().webContents.id;
      await js("document.getElementById('message-input').value = '下次回来继续这句话'; document.getElementById('close-chat').click()");
      await delay(100);
      assert.equal(chat.isVisible(), false);
      focusWindow = new BrowserWindow({ width: 240, height: 100, show: false, webPreferences: { nodeIntegration: false, sandbox: true, contextIsolation: true } });
      await focusWindow.loadURL('data:text/html;charset=utf-8,<title>Chat smoke focus sentinel</title><p>聊天面板焦点测试</p>');
      focusWindow.show();
      focusWindow.focus();
      await delay(150);
      let unexpectedFocus = 0;
      const recordFocus = () => { unexpectedFocus += 1; };
      chat.getWindow().on('focus', recordFocus);
      update({ ...state, error: null });
      await delay(100);
      assert.equal(chat.isVisible(), false);
      assert.equal(chat.getWindow().isFocused(), false);
      assert.equal(unexpectedFocus, 0);
      chat.getWindow().removeListener('focus', recordFocus);
      chat.show(state);
      for (let index = 0; index < 40 && !chat.getWindow().isFocused(); index += 1) await delay(50);
      assert.equal(chat.getWindow().webContents.id, beforeId);
      assert.equal(await js("document.getElementById('message-input').value"), '下次回来继续这句话');
      assert.equal(BrowserWindow.getFocusedWindow(), chat.getWindow());
      for (let index = 0; index < 40 && visibility.length < 3; index += 1) await delay(50);
      assert.deepEqual(visibility, [true, false, true]);
      mark('隐藏期间更新不抢焦点，重新打开保留草稿和同一渲染器');
      mark('原生显示隐藏回调仅在可见性改变时触发');

      nativeTheme.themeSource = 'light';
      await js("document.getElementById('chat-history').click()");
      await waitFor("!document.getElementById('history-view').hidden && document.querySelectorAll('.history-item').length === 3", '历史列表');
      assert.equal(calls.selectChat, 0);
      assert.equal(calls.newChat, 0);
      assert.equal(await js("document.querySelector('.history-item[aria-current=true] .history-current').textContent"), '当前聊天');
      assert.equal(await js("document.getElementById('new-chat').getBoundingClientRect().bottom < innerHeight"), true);
      assert.equal(await js('document.body.scrollWidth <= innerWidth'), true);
      await capture('06-light-history');
      mark('历史列表显示标题、时间和当前聊天，打开不创建聊天');

      await js("document.querySelector('.history-item[aria-current=true]').click()");
      await waitFor("document.getElementById('history-view').hidden", '返回当前聊天');
      assert.equal(calls.selectChat, 0);
      assert.equal(await js("document.getElementById('message-input').value"), '下次回来继续这句话');
      await js("document.getElementById('chat-history').click()");
      rejectSelection = true;
      await js("document.querySelectorAll('.history-item')[1].click()");
      await waitFor("document.getElementById('error-text').textContent.includes('这次没能打开')", '切换失败提示');
      assert.equal(await js("document.getElementById('history-view').hidden"), false);
      assert.equal(await js("document.getElementById('message-input').value"), '下次回来继续这句话');
      rejectSelection = false;
      await js("document.querySelectorAll('.history-item')[1].click()");
      await waitFor("document.getElementById('history-view').hidden && document.querySelector('[data-role=assistant] .message-text').textContent.includes('公园')", '切换历史聊天');
      assert.equal(calls.selectChat, 2);
      assert.equal(calls.send, 1);
      assert.equal(await js("document.getElementById('message-input').value"), '');
      assert.equal(await js("document.activeElement.id"), 'message-input');
      mark('切换失败保留草稿，成功才清空草稿并恢复输入焦点；当前项不调用切换');

      nativeTheme.themeSource = 'dark';
      await js("document.getElementById('message-input').value = '误点也留住草稿'; document.getElementById('chat-history').click()");
      await waitFor(`getComputedStyle(document.querySelector('.chat-panel')).color !== ${JSON.stringify(layout.textColor)}`, '历史深色主题');
      await capture('07-dark-history');
      update({ ...state, connection: 'connecting' });
      await waitFor("document.getElementById('new-chat').disabled && [...document.querySelectorAll('.history-item')].every(item => item.disabled)", '连接中禁用切换');
      await js("document.querySelectorAll('.history-item')[0].click(); document.getElementById('new-chat').click()");
      assert.equal(calls.selectChat, 2);
      assert.equal(calls.newChat, 0);
      update({ ...state, connection: 'ready' });
      await waitFor("!document.getElementById('new-chat').disabled", '恢复可选');
      await js("document.getElementById('new-chat').click()");
      await waitFor("!document.getElementById('new-chat-confirmation').hidden", '新聊天确认');
      assert.equal(calls.newChat, 0);
      assert.equal(await js('document.activeElement.id'), 'cancel-new-chat');
      await capture('08-dark-new-confirmation');
      await js("document.getElementById('cancel-new-chat').click()");
      assert.equal(await js("document.getElementById('message-input').value"), '误点也留住草稿');
      assert.equal(calls.newChat, 0);
      await js("document.getElementById('new-chat').click(); document.getElementById('confirm-new-chat').click()");
      await waitFor("!document.getElementById('empty-state').hidden", '主动新聊天');
      assert.equal(calls.newChat, 1);
      assert.equal(calls.send, 1);
      assert.equal(await js("document.getElementById('message-input').value"), '');
      mark('新聊天在列表底部，二次确认默认取消，确认才清空面板，不自动发送消息');
      await js("document.getElementById('chat-history').click()");
      await waitFor("document.getElementById('new-chat').disabled", '空聊天不可重复新建');
      await js("document.getElementById('new-chat').click(); document.getElementById('confirm-new-chat').click()");
      assert.equal(calls.newChat, 1);
      assert.equal(await js("document.querySelectorAll('.history-item').length"), 3);
      await js("document.getElementById('history-back').click()");
      mark('新建后历史仍保留，空聊天不会重复新建；连接中禁止切换');
      for (const side of ['left', 'right']) {
        petBounds = { ...petBounds, x: side === 'left' ? workArea.x - 40 : workArea.x + workArea.width - 40 };
        chat.reposition();
        const bounds = chat.getWindow().getBounds();
        assert.ok(bounds.x >= workArea.x && bounds.x + bounds.width <= workArea.x + workArea.width);
        assert.ok(bounds.y >= workArea.y && bounds.y + bounds.height <= workArea.y + workArea.height);
      }
      mark('实际显示器左右靠边位置均留在工作区');
      assert.deepEqual(errors, []);
      const report = { ok: true, at: new Date().toISOString(), electron: process.versions.electron, isolatedUserData: true, actualModelCalls: 0, calls, checks, screenshots };
      fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`PET_CHAT_UI_SMOKE_OK ${JSON.stringify(report)}`);
    } finally {
      if (focusWindow && !focusWindow.isDestroyed()) focusWindow.destroy();
      chat?.destroy();
    }
    app.quit();
  }).catch(error => { console.error(error.stack || error); app.exit(1); });
}
