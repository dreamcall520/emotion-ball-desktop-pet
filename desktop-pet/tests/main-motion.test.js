const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');

// 真实 main、动作控制器和对白规则；替代 Electron、系统采样、磁盘设置及聊天服务边界。
async function fixture({ codexEnabled = false, codexTaskNameInAlerts = false,
  codexQuotaAlwaysVisible = false, codexQuotaPeriod = 'auto', codexQuotaLabelSize = 'standard',
  codexQuotaAppearance = 'system', bubblesEnabled = true, colorMode = 'standard',
  consent = async () => ({ response: 1 }), openExternal = async () => {}, saveError = null } = {}) {
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const windows = [];
  const saved = [];
  const commands = [];
  const connections = [];
  const preferences = [];
  const dialogs = [];
  const external = [];
  const popups = [];
  const trayMenus = [];
  const app = Object.assign(new EventEmitter(), { quitCalls: 0, setName() {}, getPath: () => '/fixture',
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), setActivationPolicy() {},
    quit() { this.quitCalls++; }, exit(code) { throw new Error(`unexpected exit ${code}`); } });
  const ipcMain = new EventEmitter();
  const ipcHandlers = new Map();
  ipcMain.handle = (channel, handler) => {
    assert.equal(ipcHandlers.has(channel), false, `${channel} must only be registered once`);
    ipcHandlers.set(channel, handler);
  };
  const powerMonitor = new EventEmitter();
  const display = { id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, workArea: { x: -800, y: 0, width: 800, height: 600 } };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display });
  class NativeWindow extends EventEmitter {
    constructor(options) {
      super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false; this.destroyed = false;
      this.messages = [];
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {},
        send: (channel, packet, appearance) => { if (channel === 'pet:color-mode') this.colorAppearance = appearance; this.messages.push({ channel, packet }); if (channel === 'pet:command') commands.push(packet); } });
      windows.push(this);
      app.emit('browser-window-created', {}, this);
      NativeWindow.onConstruct?.(this);
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {} moveTop() {}
    getBounds() { return { ...this.bounds }; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    setPosition(x, y, animate) { assert.equal(animate, false); Object.assign(this.bounds, { x, y }); this.emit('move'); }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); }
    loadFile() { return { catch: handler => { this.loadFailure = handler; } }; }
    showInactive() { this.visible = true; this.emit('show'); } hide() { this.visible = false; this.emit('hide'); }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  NativeWindow.onConstruct = null;
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(value) { trayMenus.push(value); } }
  function createNativeBubbleWindow() {
    return Object.assign(new EventEmitter(), {
      visible: false, destroyed: false, bounds: { x: -610, y: 0, width: 224, height: 118 },
      isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
      getBounds() { return { ...this.bounds }; }, webContents: null
    });
  }
  let bubbleWindow = createNativeBubbleWindow();
  const bubble = { shows: [], hides: 0, moves: 0, destroys: 0,
    show(payload) { this.shows.push(payload); bubbleWindow.visible = true; },
    hide() { this.hides++; bubbleWindow.visible = false; },
    reposition() { this.moves++; }, destroy() { this.destroys++; bubbleWindow.visible = false; }, setAlwaysOnTop() {}, getWindow: () => bubbleWindow,
    replaceWindow() {
      const previous = bubbleWindow;
      previous.destroyed = true;
      bubbleWindow = createNativeBubbleWindow();
      bubbleWindow.webContents = this;
      return { previous, current: bubbleWindow };
    } };
  bubbleWindow.webContents = bubble;
  const quotaLabel = { shows: [], hides: 0, moves: 0, destroys: 0, topmost: [], visible: false,
    show(model) { this.shows.push(model); this.visible = true; }, hide() { this.hides++; this.visible = false; },
    reposition() { this.moves++; }, destroy() { this.destroys++; this.visible = false; },
    setAlwaysOnTop(value) { this.topmost.push(value); }, getWindow: () => null };
  const edgeNoticeWindow = { shows: [], visible: false,
    show(payload) { this.shows.push(payload); this.visible = true; }, hide() { this.visible = false; },
    destroy() { this.visible = false; }, reposition() {}, setAlwaysOnTop() {}, getWindow: () => null };
  const activity = { starts: 0, stops: 0, pauses: 0, resumes: 0,
    start() { this.starts++; }, stop() { this.stops++; }, pause() { this.pauses++; }, resume() { this.resumes++; } };
  let chatNativeWindow = null;
  const chatWindow = { options: null, creations: 0, shows: [], updates: [], hides: 0, destroys: 0, moves: 0,
    show(state) {
      if (!chatNativeWindow || chatNativeWindow.destroyed) {
        chatNativeWindow = Object.assign(createNativeBubbleWindow(), { webContents: new EventEmitter() });
        this.creations++;
      }
      this.shows.push(state); chatNativeWindow.visible = true;
      this.options?.onVisibilityChange?.(true);
    },
    update(state) { this.updates.push(state); },
    hide() { this.hides++; if (chatNativeWindow) chatNativeWindow.visible = false; this.options?.onVisibilityChange?.(false); },
    destroy() { this.destroys++; if (chatNativeWindow) { chatNativeWindow.visible = false; chatNativeWindow.destroyed = true; } },
    isVisible: () => Boolean(chatNativeWindow?.visible && !chatNativeWindow.destroyed),
    getWindow: () => chatNativeWindow,
    reposition() { this.moves++; }, setAlwaysOnTop() {}
  };
  const chat = { options: null, storePaths: [], connects: 0, sends: [], selected: [], stops: 0, newChats: 0, closes: 0, ownedThreads: new Set(),
    state: { messages: [], busy: false, connection: 'idle', error: null, hasConversation: false },
    getState() { return this.state; },
    async connect() { this.connects++; return undefined; },
    async send(text) { this.sends.push(text); return { accepted: true }; },
    async stop() { this.stops++; },
    async newChat() { this.newChats++; return { accepted: true }; },
    async selectChat(id) { this.selected.push(id); return { accepted: true }; },
    close() { this.closes++; },
    ownsThread(id) { return this.ownedThreads.has(id); },
    change(state) { this.state = state; this.options.onChange(state); },
    action(action) { this.options.onAction(action); }
  };
  const realRequire = createRequire(path.resolve(__dirname, '../main.js'));
  const context = vm.createContext({ __dirname: path.resolve(__dirname, '..'), console,
    process: { env: {}, stderr: { write(message) { throw new Error(message); } } }, performance: { now: () => now },
    Date: class extends Date { static now() { return 1800000000000 + now; } },
    setTimeout(callback, delay) { timers.set(++serial, { callback, at: now + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'electron') return { app, ipcMain, powerMonitor, screen, BrowserWindow: NativeWindow, Tray,
        dialog: { showMessageBox: (...args) => { dialogs.push(args); return consent(...args); } },
        shell: { openExternal: url => { external.push(url); return openExternal(url); } },
        Menu: { buildFromTemplate: value => Object.assign(value, { popup: options => popups.push({ value, options }) }) }, nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) } };
      if (name === './lib/settings') return { loadSettings: () => ({ size: 'tiny', x: -600, y: 100,
        bubblesEnabled, colorMode, keepAwake: false, alwaysOnTop: true, codexEnabled, codexTaskNameInAlerts,
        codexQuotaAlwaysVisible, codexQuotaPeriod, codexQuotaLabelSize, codexQuotaAppearance }),
        saveSettings: (_file, settings) => { if (saveError) throw saveError; saved.push({ ...settings }); return settings; } };
      if (name === './lib/codex-companion') return { createCodexCompanion: options => {
        const controller = realRequire(name).createCodexCompanion({ ...options, random: () => 0, createConnection(callbacks) {
          const connection = { callbacks, closed: false, async start() {
            callbacks.onAccount({ accountKey: 'account-one' });
            callbacks.onStatus({ channel: 'quota', state: 'connected' });
            callbacks.onStatus({ channel: 'tasks', state: 'connected' });
          }, async refresh() {}, async retry() {}, close() { this.closed = true; } };
          connections.push(connection);
          return connection;
        } });
        const setPreferences = controller.setPreferences;
        controller.setPreferences = value => { preferences.push({ ...value }); return setPreferences(value); };
        return controller;
      } };
      if (name === './lib/bubble-window') return { createBubbleWindow: () => bubble };
      if (name === './lib/quota-label-window') return { createQuotaLabelWindow: () => quotaLabel };
      if (name === './lib/edge-notice-window') return { createEdgeNoticeWindow: () => edgeNoticeWindow };
      if (name === './lib/chat-window') return { createChatWindow: options => { chatWindow.options = options; return chatWindow; } };
      if (name === './lib/chat-store') return { createChatStore: file => {
        chat.storePaths.push(file);
        return { read() { throw new Error('chat disk access is forbidden in main fixture'); },
          write() { throw new Error('chat disk access is forbidden in main fixture'); } };
      } };
      if (name === './lib/chat-companion') return { createChatCompanion: options => { chat.options = options; return chat; } };
      if (name === './lib/codex-chat-rpc') return { createCodexChatRpc: () => { throw new Error('real Codex process is forbidden in main fixture'); } };
      if (name === './lib/activity-monitor') return { ...realRequire(name), createActivityMonitor: options => { activity.sample = options.onSample; return activity; } };
      return realRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8'), context);
  await flush();
  const pet = windows[0];
  pet.emit('ready-to-show');
  pet.webContents.emit('did-finish-load');
  return { pet, bubble, quotaLabel, edgeNoticeWindow, activity, windows, windowClass: NativeWindow, commands, saved, screen, powerMonitor, app, timers, connections, preferences, dialogs, external, popups, trayMenus, chat, chatWindow,
    call: expression => vm.runInContext(expression, context),
    invoke(channel, packet, sender = pet.webContents) {
      assert.ok(ipcHandlers.has(channel), `${channel} handler must be registered`);
      return Promise.resolve(ipcHandlers.get(channel)({ sender }, packet));
    },
    send(channel, packet, sender = pet.webContents) {
      // 与实际预加载一致，默认携带当前页面代次；显式传旧值可验迟到报文。
      if (channel.startsWith('pet:codex-') && packet) packet = { pageEpoch: vm.runInContext('typeof codexPageEpoch === "number" ? codexPageEpoch : 1', context), ...packet };
      ipcMain.emit(channel, { sender }, packet);
    },
    at(time) { now = time; const queue = [...timers.values()]; timers.clear(); queue.forEach(item => item.callback()); },
    advanceTo(target) {
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = target;
    }
  };
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';

test('靠边额度胶囊沿用最新真实主周期，关闭、锁屏及重载立即撤回', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true, bubblesEnabled: false });
  const emit = remaining => f.connections[0].callbacks.onQuota({ updatedAt: 1800000000000,
    windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining, resetsAt: 1800003600000 },
      { id: 'codex:secondary', label: 'Codex', windowMinutes: 10080, remaining: 65, resetsAt: 1800604800000 }] });
  emit(83); f.call("dockPet('left')"); f.call('edgeNoticeNow = () => 60000; tickEdgeNotice(true)');
  assert.equal(f.edgeNoticeWindow.visible, true);
  assert.equal(f.edgeNoticeWindow.shows.at(-1).remaining, 83);
  assert.equal(f.quotaLabel.visible, false);
  emit(79); assert.equal(f.edgeNoticeWindow.shows.at(-1).remaining, 79);
  f.call("setCodexPreference('codexQuotaPeriod', 'weekly')");
  assert.equal(f.edgeNoticeWindow.shows.at(-1).period, '周额度');
  assert.equal(f.edgeNoticeWindow.shows.at(-1).remaining, 65);
  f.call("setCodexPreference('codexQuotaAlwaysVisible', false)");
  assert.equal(f.edgeNoticeWindow.visible, false);
  f.call("setCodexPreference('codexQuotaAlwaysVisible', true); edgeNoticeNow = () => 180000; tickEdgeNotice(true)");
  assert.equal(f.edgeNoticeWindow.visible, true);
  f.powerMonitor.emit('lock-screen'); assert.equal(f.edgeNoticeWindow.visible, false);
  f.powerMonitor.emit('unlock-screen');
  f.call('edgeNoticeNow = () => 300000; tickEdgeNotice(true)');
  assert.equal(f.edgeNoticeWindow.visible, true);
  f.pet.webContents.emit('did-start-loading'); assert.equal(f.edgeNoticeWindow.visible, false);
  f.call('edgeNoticeNow = () => 600000; tickEdgeNotice(true)');
  assert.equal(f.edgeNoticeWindow.visible, false);
});

test('靠边短句独立于Codex，复用活动采样且气泡开关立即生效', async () => {
  const f = await fixture({ codexEnabled: false });
  f.call("dockPet('right'); edgeNoticeNow = () => 90000");
  f.activity.sample({ locked: false, cursor: { x: -500, y: 20 } });
  assert.equal(f.edgeNoticeWindow.shows.at(-1).kind, 'text');
  assert.equal(f.edgeNoticeWindow.shows.at(-1).side, 'right');
  f.call("setCompanionSetting('bubblesEnabled', false)");
  assert.equal(f.edgeNoticeWindow.visible, false);
  f.call('hidePet(); edgeNoticeNow = () => 900000; tickEdgeNotice(true)');
  assert.equal(f.edgeNoticeWindow.visible, false);
});
function findMenuItem(template, id) {
  const queue = [...template];
  while (queue.length) {
    const item = queue.shift();
    if (item?.id === id) return item;
    if (Array.isArray(item?.submenu)) queue.push(...item.submenu);
  }
  return null;
}

function menuItem(fixtureValue, id) {
  return findMenuItem(fixtureValue.call('menuTemplate()'), id);
}

test('聊天菜单复用同一个面板和控制器，打开关闭不会发送或新建聊天', async () => {
  const f = await fixture();
  assert.equal(f.chatWindow.getWindow(), null);
  assert.equal(f.chat.connects, 0);
  assert.deepEqual(f.chat.storePaths, ['/fixture/chat.json']);
  const item = menuItem(f, 'chat-open');
  assert.ok(item);
  item.click();
  const firstWindow = f.chatWindow.getWindow();
  assert.equal(f.chatWindow.isVisible(), true);
  item.click();
  assert.equal(f.chatWindow.getWindow(), firstWindow);
  assert.equal(f.chatWindow.creations, 1);
  assert.equal(f.chat.connects, 2);
  assert.deepEqual(f.chat.sends, []);
  assert.equal(f.chat.newChats, 0);
  f.send('pet:chat-close', undefined, firstWindow.webContents);
  assert.equal(f.chatWindow.isVisible(), false);
  assert.equal(f.chat.closes, 0);
  item.click();
  assert.equal(f.chatWindow.getWindow(), firstWindow);
  assert.equal(f.chatWindow.creations, 1);
  assert.equal(f.chat.connects, 3);
});

test('聊天 IPC 只接受当前聊天窗口；球球和其他窗口无法读记录、发送或停止', async () => {
  const f = await fixture();
  menuItem(f, 'chat-open').click();
  const sender = f.chatWindow.getWindow().webContents;
  for (const foreign of [f.pet.webContents, {}, f.bubble]) {
    assert.equal(await f.invoke('pet:chat-get', undefined, foreign), null);
    assert.equal((await f.invoke('pet:chat-send', '伪造发送', foreign)).accepted, false);
    assert.equal((await f.invoke('pet:chat-new', undefined, foreign)).accepted, false);
    assert.equal((await f.invoke('pet:chat-select', 'past-chat', foreign)).accepted, false);
    await f.invoke('pet:chat-stop', undefined, foreign);
    f.send('pet:chat-close', undefined, foreign);
  }
  assert.deepEqual(f.chat.sends, []);
  assert.equal(f.chat.newChats, 0);
  assert.equal(f.chat.stops, 0);
  assert.equal(f.chatWindow.isVisible(), true);
  assert.equal(await f.invoke('pet:chat-get', undefined, sender), f.chat.state);
  assert.equal((await f.invoke('pet:chat-send', '有效消息', sender)).accepted, true);
  assert.deepEqual(f.chat.sends, ['有效消息']);
  assert.equal((await f.invoke('pet:chat-new', undefined, sender)).accepted, true);
  assert.equal(f.chat.newChats, 1);
  assert.equal((await f.invoke('pet:chat-select', 'past-chat', sender)).accepted, true);
  assert.deepEqual(f.chat.selected, ['past-chat']);
  await f.invoke('pet:chat-stop', undefined, sender);
  assert.equal(f.chat.stops, 1);
});

test('聊天面板隐藏或锁屏期间拒绝发送和新聊天，锁屏也不推送历史', async () => {
  const f = await fixture();
  menuItem(f, 'chat-open').click();
  const sender = f.chatWindow.getWindow().webContents;
  f.send('pet:chat-close', undefined, sender);
  assert.equal((await f.invoke('pet:chat-send', '隐藏时发送', sender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-select', 'past-chat', sender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-new', undefined, sender)).accepted, false);
  menuItem(f, 'chat-open').click();
  f.powerMonitor.emit('lock-screen');
  assert.equal(f.chatWindow.isVisible(), false);
  assert.equal(f.chat.stops, 1);
  const updateCount = f.chatWindow.updates.length;
  f.chat.change({ messages: [{ text: '假回复' }], busy: false });
  assert.equal(f.chatWindow.updates.length, updateCount);
  assert.equal(await f.invoke('pet:chat-get', undefined, sender), null);
  assert.equal((await f.invoke('pet:chat-send', '锁屏时发送', sender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-select', 'past-chat', sender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-new', undefined, sender)).accepted, false);
  const opens = f.chatWindow.shows.length;
  menuItem(f, 'chat-open').click();
  assert.equal(f.chatWindow.shows.length, opens);
  assert.deepEqual(f.chat.sends, []);
  assert.equal(f.chat.newChats, 0);
  f.powerMonitor.emit('unlock-screen');
  menuItem(f, 'chat-open').click();
  assert.equal((await f.invoke('pet:chat-send', '解锁后主动发送', sender)).accepted, true);
  assert.deepEqual(f.chat.sends, ['解锁后主动发送']);
});

test('聊天窗口销毁重建后拒绝旧 sender，隐藏球球也同时隐藏聊天', async () => {
  const f = await fixture();
  menuItem(f, 'chat-open').click();
  const oldSender = f.chatWindow.getWindow().webContents;
  f.chatWindow.destroy();
  assert.equal((await f.invoke('pet:chat-send', '销毁后的发送', oldSender)).accepted, false);
  menuItem(f, 'chat-open').click();
  const sender = f.chatWindow.getWindow().webContents;
  assert.notEqual(sender, oldSender);
  assert.equal((await f.invoke('pet:chat-send', '旧窗口迟到消息', oldSender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-send', '当前窗口消息', sender)).accepted, true);
  f.call('hidePet()');
  assert.equal(f.pet.isVisible(), false);
  assert.equal(f.chatWindow.isVisible(), false);
  assert.equal((await f.invoke('pet:chat-send', '球球已隐藏', sender)).accepted, false);
  menuItem(f, 'chat-open').click();
  assert.equal(f.pet.isVisible(), true);
  assert.equal(f.chatWindow.isVisible(), true);
  assert.equal(f.chat.closes, 0);
});

test('聊天动作只调用现有动作白名单，隐藏、锁屏和退出后迟到动作不生效', async () => {
  const f = await fixture();
  const before = f.commands.length;
  f.chat.action('hop');
  const delivered = f.commands.slice(before);
  assert.ok(delivered.includes('wake'));
  assert.ok(delivered.some(command => command?.command === 'again' && command.motion === 'hop'));
  const acceptedCount = f.commands.length;
  f.chat.action('arbitrary-shell-command');
  assert.equal(f.commands.length, acceptedCount);
  f.chat.action('dockLeft');
  assert.equal(f.call('edgeTuck.getPresentation().mode'), 'tucked');
  assert.equal(f.call('edgeTuck.getPresentation().side'), 'left');
  f.chat.action('restore');
  assert.equal(f.call('edgeTuck.getPresentation().mode'), 'free');
  f.call('hidePet()');
  let count = f.commands.length;
  f.chat.action('hop'); f.chat.action('restore');
  assert.equal(f.commands.length, count);
  assert.equal(f.pet.isVisible(), false);
  f.call('restorePet()');
  f.powerMonitor.emit('lock-screen'); count = f.commands.length;
  f.chat.action('spin'); f.chat.action('wake');
  assert.equal(f.commands.length, count);
  f.powerMonitor.emit('unlock-screen');
  f.app.emit('before-quit'); count = f.commands.length;
  f.chat.action('hop');
  assert.equal(f.commands.length, count);
});

test('真实退出事件只清理一次聊天服务和窗口，退出后 IPC 与菜单都失效', async () => {
  const f = await fixture();
  const openItem = menuItem(f, 'chat-open');
  openItem.click();
  const sender = f.chatWindow.getWindow().webContents;
  f.app.emit('before-quit'); f.app.emit('before-quit');
  assert.equal(f.chat.closes, 1);
  assert.equal(f.chatWindow.destroys, 1);
  assert.equal(await f.invoke('pet:chat-get', undefined, sender), null);
  assert.equal((await f.invoke('pet:chat-send', '退出后发送', sender)).accepted, false);
  assert.equal((await f.invoke('pet:chat-new', undefined, sender)).accepted, false);
  const opens = f.chatWindow.shows.length, connects = f.chat.connects;
  openItem.click();
  assert.equal(f.chatWindow.shows.length, opens);
  assert.equal(f.chat.connects, connects);
  assert.deepEqual(f.chat.sends, []);
});

for (const fails of [false, true]) test(`退出等待聊天连接释放，并在下一轮事件循环继续系统退出（关闭失败=${fails}）`, async () => {
  const f = await fixture();
  let finishClose;
  f.chat.close = () => new Promise((resolve, reject) => {
    f.chat.closes++;
    finishClose = () => fails ? reject(new Error('close failed')) : resolve();
  });
  let prevented = false;
  f.app.emit('before-quit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await flush();
  assert.equal(f.app.quitCalls, 0, '连接尚未释放时不能继续退出');
  let repeatedPrevented = false;
  f.app.emit('before-quit', { preventDefault() { repeatedPrevented = true; } });
  assert.equal(repeatedPrevented, true, '重复退出不能跳过连接释放');
  assert.equal(f.chat.closes, 1);
  finishClose();
  await flush();
  assert.equal(f.app.quitCalls, 0, '微任务中不能重入尚未完成取消的原生退出事件');
  f.advanceTo(0);
  assert.equal(f.app.quitCalls, 1);
  f.app.emit('before-quit', { preventDefault() { assert.fail('清理完成后的退出不再拦截'); } });
});

test('球球自己的聊天 thread 不进入 Codex 任务状态和完成提醒', async () => {
  const f = await fixture({ codexEnabled: true });
  f.chat.ownedThreads.add(TASK_ID);
  const callbacks = f.connections[0].callbacks;
  const task = { id: TASK_ID, title: '球球自己的测试聊天', state: 'active', turnId: 'chat-turn', updatedAt: 1800000000000 };
  callbacks.onTask({ ...task, baseline: true });
  assert.equal(f.call('codexCompanion.getSnapshot().tasks.items.length'), 0);
  callbacks.onTask({ ...task, state: 'completed' });
  f.advanceTo(5000);
  assert.equal(f.call('codexCompanion.getSnapshot().tasks.items.length'), 0);
  assert.equal(f.commands.some(command => command?.command === 'codex'), false);
});

function queueCodexCompletion(f) {
  const generation = f.call('codexCompanion.getSnapshot().generation');
  f.send('pet:codex-availability', { generation, available: true });
  const callbacks = f.connections.at(-1).callbacks;
  const task = { id: TASK_ID, title: '测试任务', state: 'active', turnId: 'turn-1', updatedAt: 1800000000000 };
  callbacks.onTask({ ...task, baseline: true });
  callbacks.onTask({ ...task, state: 'completed' });
  f.advanceTo(5000);
  const pending = f.commands.findLast(command => command?.command === 'codex');
  assert.ok(pending, '须经过真实控制器合并窗口才发动作准备命令');
  return { token: 90, action: pending.motion, alertId: pending.alertId, generation: pending.generation };
}

function queueMultiCodexCompletion(f) {
  const generation = f.call('codexCompanion.getSnapshot().generation');
  f.send('pet:codex-availability', { generation, available: true });
  const callbacks = f.connections.at(-1).callbacks;
  for (const [index, id] of [TASK_ID, '22222222-2222-4222-8222-222222222222'].entries()) {
    const task = { id, title: `完成任务${index + 1}`, state: 'active', turnId: `turn-${index + 1}`, updatedAt: 1800000000000 };
    callbacks.onTask({ ...task, baseline: true });
    callbacks.onTask({ ...task, state: 'completed' });
  }
  f.advanceTo(5000);
  const pending = f.commands.findLast(command => command?.command === 'codex');
  assert.ok(pending);
  f.send('pet:codex-motion-ready', { token: 91, action: pending.motion, alertId: pending.alertId, generation: pending.generation });
  return f.bubble.shows.at(-1);
}

test('默认关闭和取消确认都零连接、零轮询，并保留原设置', async () => {
  const f = await fixture();
  assert.equal(f.connections.length, 0);
  const item = menuItem(f, 'codex-enabled');
  assert.ok(item, '菜单必须有可选开关');
  assert.equal(item.checked, false);
  const names = menuItem(f, 'codex-task-names');
  assert.equal(names.checked, false);
  assert.equal(names.enabled, false);
  assert.equal(f.call('setCodexTaskNameInAlerts(true)'), false);
  assert.equal(f.saved.length, 0);
  assert.equal(menuItem(f, 'codex-task-names').checked, false);
  assert.equal(menuItem(f, 'codex-status'), null);
  await f.call('setCodexEnabled(true)');
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.dialogs[0].length, 1, '小尺寸球球不能作为确认 sheet 宿主');
  const options = f.dialogs[0][0];
  assert.equal(options.defaultId, 1);
  assert.equal(options.cancelId, 1);
  assert.match(options.detail, /可能.*聊天内容/);
  assert.match(options.detail, /不保存.*不上传/);
  assert.equal(f.connections.length, 0);
  assert.equal(f.saved.length, 0);
  assert.equal(f.timers.size, 0);
});

test('所有 Codex 设置只保留一个顶层入口并完整归入子菜单', async () => {
  const f = await fixture({ codexEnabled: true });
  const menu = f.call('menuTemplate()');
  const group = menu.find(item => item.id === 'codex-menu');
  assert.ok(group);
  assert.equal(group.label, 'Codex 联动');
  assert.equal(JSON.stringify(menu.filter(item => String(item.id || '').startsWith('codex-')).map(item => item.id)),
    JSON.stringify(['codex-menu']));
  assert.equal(JSON.stringify(group.submenu.filter(item => item.id).map(item => item.id)), JSON.stringify([
    'codex-enabled', 'codex-task-names', 'codex-quota-visible', 'codex-quota-period',
    'codex-quota-label-size', 'codex-quota-appearance', 'codex-status'
  ]));
  assert.equal(group.submenu.find(item => item.id === 'codex-enabled').label, '启用 Codex 联动');
});

test('原生 smoke 的受控闭包可精确恢复尺寸与空坐标设置且不移动窗口', async () => {
  const f = await fixture();
  const before = f.pet.getBounds();
  assert.equal(f.call("restoreSmokePetSettings({ size: 'tiny', x: null, y: null })"), true);
  assert.deepEqual(f.pet.getBounds(), before, '设置恢复闭包不能替代真实窗口恢复入口');
  assert.deepEqual({ size: f.saved.at(-1).size, x: f.saved.at(-1).x, y: f.saved.at(-1).y },
    { size: 'tiny', x: null, y: null });
  const savedCount = f.saved.length;
  assert.equal(f.call("restoreSmokePetSettings({ size: 'invalid', x: 1, y: 2 })"), false);
  assert.equal(f.saved.length, savedCount, '非法恢复值不能落盘');
});

test('任务名称开关保存成功才更新偏好和菜单，失败时完整回滚', async () => {
  const f = await fixture({ codexEnabled: true });
  const ack = queueCodexCompletion(f);
  f.send('pet:codex-motion-ready', ack);
  const shown = f.bubble.shows.at(-1);
  const commands = f.commands.length;
  const timers = f.timers.size;
  assert.equal(f.call('setCodexTaskNameInAlerts(true)'), true);
  assert.equal(f.saved.at(-1).codexTaskNameInAlerts, true);
  assert.equal(menuItem(f, 'codex-task-names').checked, true);
  const updated = f.bubble.shows.at(-1);
  assert.equal(updated.id, shown.id);
  assert.equal(updated.text, '《测试任务》有结果啦\n去看看？');
  assert.equal(f.commands.length, commands, '原位更新不应新发身体动作命令');
  assert.equal(f.timers.size, timers, '原位更新不应重启身体动作');
  assert.equal(f.call('setCodexTaskNameInAlerts(false)'), true);
  assert.equal(f.bubble.shows.at(-1).id, shown.id);
  assert.equal(f.bubble.shows.at(-1).text, '这轮有结果啦，去看看？');

  const failed = await fixture({ codexEnabled: true, saveError: new Error('PRIVATE_SETTINGS_FAILURE') });
  const failedAck = queueCodexCompletion(failed);
  failed.send('pet:codex-motion-ready', failedAck);
  const failedShown = failed.bubble.shows.at(-1);
  const beforeShows = failed.bubble.shows.length;
  assert.equal(failed.call('setCodexTaskNameInAlerts(true)'), false);
  assert.equal(menuItem(failed, 'codex-task-names').checked, false);
  assert.equal(failed.bubble.shows.length, beforeShows);
  assert.equal(failed.bubble.shows.at(-1).id, failedShown.id);
});

test('已保存的任务名称开关启动即生效', async () => {
  const f = await fixture({ codexEnabled: true, codexTaskNameInAlerts: true });
  const ack = queueCodexCompletion(f);
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.bubble.shows.at(-1).text, '《测试任务》有结果啦\n去看看？');
  assert.equal(menuItem(f, 'codex-task-names').checked, true);
});

test('已有执行中任务会同步给球球页面，结束后归零', async () => {
  const f = await fixture({ codexEnabled: true });
  const settingsPackets = () => f.pet.messages.filter(message => message.channel === 'pet:codex-settings');
  assert.equal(settingsPackets().at(-1).packet.activeTaskCount, 0);
  f.connections[0].callbacks.onTask({
    id: TASK_ID, title: '正在处理', state: 'active', turnId: 'turn-working', baseline: true
  });
  assert.equal(settingsPackets().at(-1).packet.activeTaskCount, 1);
  f.connections[0].callbacks.onTask({
    id: TASK_ID, title: '正在处理', state: 'completed', turnId: 'turn-working'
  });
  assert.equal(settingsPackets().at(-1).packet.activeTaskCount, 0);
});

test('Codex 额度菜单只在总联动开启时可操作，周期为互斥单选', async () => {
  const off = await fixture();
  const offMenu = off.call('menuTemplate()');
  assert.equal(findMenuItem(offMenu, 'codex-quota-visible').enabled, false);
  assert.equal(findMenuItem(offMenu, 'codex-quota-period').enabled, false);
  assert.equal(off.call("setCodexPreference('codexQuotaAlwaysVisible', true)"), false);
  assert.equal(off.saved.length, 0);

  const f = await fixture({ codexEnabled: true, codexQuotaPeriod: 'weekly' });
  const menu = f.call('menuTemplate()');
  const visible = findMenuItem(menu, 'codex-quota-visible');
  const period = findMenuItem(menu, 'codex-quota-period');
  assert.equal(visible.checked, false);
  assert.equal(visible.enabled, true);
  assert.equal(period.enabled, true);
  assert.equal(JSON.stringify(period.submenu.filter(item => item.checked).map(item => item.id)), JSON.stringify(['codex-quota-weekly']));
  assert.equal(f.call("setCodexPreference('codexQuotaPeriod', 'fiveHour')"), true);
  assert.equal(f.saved.at(-1).codexQuotaPeriod, 'fiveHour');
  assert.deepEqual(f.preferences.at(-1), {
    taskNameInAlerts: false, quotaAlwaysVisible: false, quotaPeriod: 'fiveHour'
  });
  assert.equal(menuItem(f, 'codex-quota-period').submenu.find(item => item.checked).id, 'codex-quota-five-hour');
});

test('额度卡片大小为标准和小巧两档，只在保存成功后切换', async () => {
  const off = await fixture();
  assert.equal(menuItem(off, 'codex-quota-label-size').enabled, false);

  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const menu = menuItem(f, 'codex-quota-label-size');
  assert.equal(menu.label, '额度卡片大小');
  assert.equal(menu.submenu.find(item => item.checked).id, 'codex-quota-label-standard');
  assert.equal(f.call("setCodexPreference('codexQuotaLabelSize', 'compact')"), true);
  assert.equal(f.saved.at(-1).codexQuotaLabelSize, 'compact');
  assert.equal(menuItem(f, 'codex-quota-label-size').submenu.find(item => item.checked).id, 'codex-quota-label-compact');
  assert.ok(f.quotaLabel.shows.length > 0, '尺寸切换后应立即刷新常驻卡片');

  const failed = await fixture({ codexEnabled: true, saveError: new Error('SIZE_WRITE_FAILURE') });
  assert.equal(failed.call("setCodexPreference('codexQuotaLabelSize', 'compact')"), false);
  assert.equal(menuItem(failed, 'codex-quota-label-size').submenu.find(item => item.checked).id, 'codex-quota-label-standard');
});

test('额度卡片外观为跟随系统、浅色和深色三档，只在保存成功后切换', async () => {
  const off = await fixture();
  assert.equal(menuItem(off, 'codex-quota-appearance').enabled, false);

  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const menu = menuItem(f, 'codex-quota-appearance');
  assert.equal(menu.label, '额度卡片外观');
  assert.equal(menu.submenu.find(item => item.checked).id, 'codex-quota-appearance-system');
  assert.equal(f.call("setCodexPreference('codexQuotaAppearance', 'dark')"), true);
  assert.equal(f.saved.at(-1).codexQuotaAppearance, 'dark');
  assert.equal(menuItem(f, 'codex-quota-appearance').submenu.find(item => item.checked).id,
    'codex-quota-appearance-dark');
  assert.ok(f.quotaLabel.shows.length > 0, '外观切换后应立即刷新常驻卡片');

  const failed = await fixture({ codexEnabled: true, saveError: new Error('APPEARANCE_WRITE_FAILURE') });
  assert.equal(failed.call("setCodexPreference('codexQuotaAppearance', 'light')"), false);
  assert.equal(menuItem(failed, 'codex-quota-appearance').submenu.find(item => item.checked).id,
    'codex-quota-appearance-system');
});

test('常驻标签按当前卡片大小构建手动周期模型', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.connections[0].callbacks.onQuota({
    updatedAt: 1800000000000,
    windows: [
      { id: 'codex:primary', label: 'Codex 5 小时', windowMinutes: 300, remaining: 61, resetsAt: 1800003600000 },
      { id: 'codex:secondary', label: 'Codex 7 天', windowMinutes: 10080, remaining: 65, resetsAt: 1800604800000 },
      { id: 'gpt-reserve:primary', label: 'Reserve 5 小时', windowMinutes: 300, remaining: 22, resetsAt: 1800003600000 },
      { id: 'gpt-reserve:secondary', label: 'Reserve 7 天', windowMinutes: 10080, remaining: 100, resetsAt: 1800604800000 },
      { id: 'GPT-5.3-Codex-Spark:secondary', label: 'Spark', windowMinutes: 10080, remaining: 100, resetsAt: 1800604800000 }
    ]
  });
  assert.equal(f.quotaLabel.shows.at(-1).items.length, 2);
  assert.equal(f.call("setCodexPreference('codexQuotaPeriod', 'weekly')"), true);
  const standardModel = f.quotaLabel.shows.at(-1);
  assert.deepEqual(standardModel.items.map(item => [item.label, item.windowMinutes, item.remaining]), [
    ['Codex', 10080, 65]
  ], '标准卡片手动选周额度时只展示所选周期');

  assert.equal(f.call("setCodexPreference('codexQuotaLabelSize', 'compact')"), true);
  const compactModel = f.quotaLabel.shows.at(-1);
  assert.deepEqual(compactModel.items.map(item => [item.label, item.windowMinutes, item.remaining]), [
    ['Codex', 10080, 65], ['Codex', 300, 61]
  ]);
});

test('Codex 额度偏好只在原子保存成功后同步，失败完整回滚', async () => {
  const f = await fixture({ codexEnabled: true, saveError: new Error('PRIVATE_WRITE') });
  assert.equal(f.call("setCodexPreference('codexQuotaAlwaysVisible', true)"), false);
  assert.equal(menuItem(f, 'codex-quota-visible').checked, false);
  assert.equal(f.quotaLabel.shows.length, 0);
  assert.equal(f.call("setCodexPreference('codexQuotaPeriod', 'invalid')"), false);
  assert.equal(menuItem(f, 'codex-quota-period').submenu.find(item => item.checked).id, 'codex-quota-auto');
});

test('额度周期单选只在保存成功后切换，失败同时回滚点击项和新菜单', async () => {
  const failed = await fixture({ codexEnabled: true, saveError: new Error('PERIOD_WRITE_FAILURE') });
  const failedMenu = failed.call('menuTemplate()');
  const failedWeekly = findMenuItem(failedMenu, 'codex-quota-period').submenu
    .find(item => item.id === 'codex-quota-weekly');
  const failedRefreshes = failed.trayMenus.length;
  failedWeekly.checked = true;
  failedWeekly.click(failedWeekly);
  assert.equal(failedWeekly.checked, false, '当次点击项要立即恢复真实旧值');
  assert.ok(failed.trayMenus.length > failedRefreshes, '保存失败也要刷新整个托盘菜单');
  const failedFreshPeriod = findMenuItem(failed.trayMenus.at(-1), 'codex-quota-period');
  assert.equal(failedFreshPeriod.submenu.find(item => item.checked).id, 'codex-quota-auto');

  const success = await fixture({ codexEnabled: true });
  const successMenu = success.call('menuTemplate()');
  const successWeekly = findMenuItem(successMenu, 'codex-quota-period').submenu
    .find(item => item.id === 'codex-quota-weekly');
  successWeekly.checked = true;
  successWeekly.click(successWeekly);
  assert.equal(success.saved.at(-1).codexQuotaPeriod, 'weekly');
  const successFreshPeriod = findMenuItem(success.trayMenus.at(-1), 'codex-quota-period');
  assert.equal(successFreshPeriod.submenu.find(item => item.checked).id, 'codex-quota-weekly');
});

test('关闭 Codex 立即销毁额度标签，重开可自动重建且重复关闭不重复销毁', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true, bubblesEnabled: false,
    consent: async () => ({ response: 0 }) });
  assert.equal(f.quotaLabel.visible, true);
  assert.ok(f.quotaLabel.shows.length > 0);
  assert.equal(f.bubble.shows.length, 0);
  assert.equal(f.call("setCodexPreference('codexQuotaAlwaysVisible', false)"), true);
  assert.equal(f.quotaLabel.visible, false);
  assert.equal(f.call("setCodexPreference('codexQuotaAlwaysVisible', true)"), true);
  assert.equal(f.quotaLabel.visible, true);
  const shows = f.quotaLabel.shows.length;
  await f.call('setCodexEnabled(false)');
  assert.equal(f.quotaLabel.visible, false);
  assert.equal(f.quotaLabel.destroys, 1);
  await f.call('setCodexEnabled(false)');
  assert.equal(f.quotaLabel.destroys, 1, '重复关闭不应反复销毁已释放的标签');
  await f.call('setCodexEnabled(true)');
  assert.equal(f.quotaLabel.visible, true);
  assert.ok(f.quotaLabel.shows.length > shows, '重开后 show 应自动重建标签窗口');
  f.app.emit('before-quit');
  assert.equal(f.quotaLabel.destroys, 2, '退出只销毁重建后的当前标签一次');
});

test('额度标签跟随锁屏、休眠、隐藏、窗口和显示器生命周期', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const initialMoves = f.quotaLabel.moves;
  f.pet.emit('move');
  f.pet.emit('resize');
  f.screen.emit('display-added');
  assert.ok(f.quotaLabel.moves >= initialMoves + 3);
  f.powerMonitor.emit('lock-screen');
  assert.equal(f.quotaLabel.visible, false);
  f.powerMonitor.emit('unlock-screen');
  assert.equal(f.quotaLabel.visible, true);
  f.powerMonitor.emit('suspend');
  assert.equal(f.quotaLabel.visible, false);
  f.powerMonitor.emit('resume');
  assert.equal(f.quotaLabel.visible, true);
  f.pet.hide();
  assert.equal(f.quotaLabel.visible, false);
  f.pet.showInactive();
  f.call('syncQuotaLabel(codexCompanion.getSnapshot())');
  assert.equal(f.quotaLabel.visible, true);
  f.call('setAlwaysOnTop(false)');
  assert.equal(f.quotaLabel.topmost.at(-1), false);
  f.app.emit('before-quit');
  assert.ok(f.quotaLabel.destroys > 0);
});

test('额度标签只避让实际可见气泡，气泡显隐后立即重排', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  assert.equal(f.call('quotaObstacleBounds()'), null);
  f.send('pet:say', 'hello');
  assert.equal(JSON.stringify(f.call('quotaObstacleBounds()')), JSON.stringify({ x: -610, y: 0, width: 224, height: 118 }));
  const moves = f.quotaLabel.moves;
  f.call('hideBubble()');
  assert.equal(f.call('quotaObstacleBounds()'), null);
  assert.ok(f.quotaLabel.moves > moves);
});

test('气泡延迟显示和内部自动隐藏时，额度标签都跟随原生可见性事件重排', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const win = f.bubble.getWindow();
  f.bubble.show = function showLater(payload) {
    this.shows.push(payload);
    win.visible = false;
  };
  f.call("showBubble({ id: 'delayed', text: '稍后显示', actions: [], durationMs: 1000 })");
  await flush();
  const beforeShow = f.quotaLabel.moves;
  win.visible = true;
  win.emit('show');
  assert.equal(f.quotaLabel.moves, beforeShow + 1, '真正 show 时再重排');
  const beforeHide = f.quotaLabel.moves;
  win.visible = false;
  win.emit('hide');
  assert.equal(f.quotaLabel.moves, beforeHide + 1, '气泡内部定时 hide 时也重排');
});

test('气泡可见性监听每个窗口只绑定一次，重建后旧窗口事件不影响新窗口', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const first = f.bubble.getWindow();
  f.call("showBubble({ id: 'one', text: '第一次', actions: [], durationMs: 1000 })");
  f.call("showBubble({ id: 'two', text: '第二次', actions: [], durationMs: 1000 })");
  assert.equal(first.listenerCount('show'), 1);
  assert.equal(first.listenerCount('hide'), 1);
  assert.equal(first.listenerCount('closed'), 1);

  const { current } = f.bubble.replaceWindow();
  f.call("showBubble({ id: 'three', text: '新窗口', actions: [], durationMs: 1000 })");
  assert.equal(first.listenerCount('show'), 0, '旧窗口监听需要主动解除');
  assert.equal(current.listenerCount('show'), 1);
  const moves = f.quotaLabel.moves;
  first.emit('hide');
  assert.equal(f.quotaLabel.moves, moves, '旧窗口迟到事件不得扰动新窗口布局');
  current.visible = false;
  current.emit('hide');
  assert.equal(f.quotaLabel.moves, moves + 1);
  current.emit('closed');
  assert.equal(current.listenerCount('show'), 0, '窗口关闭后不留监听');
});

test('气泡显示抛错不穿透且不绑定假窗口，错误记录再抛错也仍重排额度标签', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  let reads = 0;
  f.bubble.show = () => { throw new Error('PRIVATE_BUBBLE_SHOW'); };
  f.bubble.getWindow = () => { reads++; throw new Error('PRIVATE_FAKE_WINDOW'); };
  const moves = f.quotaLabel.moves;
  assert.doesNotThrow(() => f.send('pet:say', 'hello'));
  assert.equal(reads, 0, '显示失败不得继续读取或绑定窗口');
  assert.equal(f.call('bubbleVisibilityBinding'), null);
  assert.ok(f.quotaLabel.moves > moves);
});

test('气泡窗口读取抛错不穿透，显示后仍重排额度标签', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.bubble.getWindow = () => { throw new Error('PRIVATE_BUBBLE_WINDOW'); };
  const moves = f.quotaLabel.moves;
  assert.doesNotThrow(() => f.send('pet:say', 'hello'));
  assert.equal(f.call('bubbleVisibilityBinding'), null);
  assert.ok(f.quotaLabel.moves > moves);
});

test('气泡隐藏抛错不阻断锁屏隐藏额度标签', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  assert.equal(f.quotaLabel.visible, true);
  f.bubble.hide = () => { throw new Error('PRIVATE_BUBBLE_HIDE'); };
  assert.doesNotThrow(() => f.powerMonitor.emit('lock-screen'));
  assert.equal(f.quotaLabel.visible, false);
});

test('气泡重排抛错不阻断窗口移动事件和额度标签重排', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.bubble.reposition = () => { throw new Error('PRIVATE_BUBBLE_REPOSITION'); };
  const moves = f.quotaLabel.moves;
  assert.doesNotThrow(() => f.pet.emit('move'));
  assert.ok(f.quotaLabel.moves > moves);
});

test('气泡销毁抛错不阻断关闭窗口的监听解绑和额度标签销毁', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const win = f.bubble.getWindow();
  f.call("showBubble({ id: 'bind-before-close', text: '绑定后关闭', actions: [], durationMs: 1000 })");
  let destroys = 0;
  f.bubble.destroy = () => { destroys++; throw new Error('PRIVATE_BUBBLE_DESTROY'); };
  f.pet.destroyed = true;
  assert.doesNotThrow(() => f.pet.emit('closed'));
  assert.equal(destroys, 1);
  assert.equal(win.listenerCount('show'), 0);
  assert.equal(win.listenerCount('hide'), 0);
  assert.equal(win.listenerCount('closed'), 0);
  assert.equal(f.quotaLabel.destroys, 1);
});

test('退出时气泡销毁抛错或重入都不阻断额度标签销毁', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  let destroys = 0;
  f.bubble.destroy = () => {
    destroys++;
    if (destroys === 1) f.app.emit('before-quit');
    throw new Error('PRIVATE_REENTRANT_BUBBLE_DESTROY');
  };
  assert.doesNotThrow(() => f.app.emit('before-quit'));
  assert.equal(destroys, 1, '重入退出不得重复销毁气泡');
  assert.equal(f.quotaLabel.destroys, 1);
});

test('置顶原生调用彼此隔离，即使错误记录抛错也仍保存并刷新', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const attempts = [];
  f.pet.setAlwaysOnTop = () => { attempts.push('pet'); throw new Error('PRIVATE_PET_TOPMOST'); };
  f.bubble.setAlwaysOnTop = () => { attempts.push('bubble'); throw new Error('PRIVATE_BUBBLE_TOPMOST'); };
  f.quotaLabel.setAlwaysOnTop = value => { attempts.push(`label:${value}`); throw new Error('PRIVATE_LABEL_TOPMOST'); };
  const saves = f.saved.length;
  const refreshes = f.trayMenus.length;
  assert.doesNotThrow(() => f.call('setAlwaysOnTop(false)'));
  assert.deepEqual(attempts, ['pet', 'bubble', 'label:false']);
  assert.equal(f.saved.length, saves + 1);
  assert.equal(f.saved.at(-1).alwaysOnTop, false);
  assert.ok(f.trayMenus.length > refreshes);
});

test('退出菜单只请求系统退出，真实 before-quit 才一次性安全清理全部资源', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  assert.ok(f.timers.size > 0);
  const exitItem = f.call("menuTemplate().find(item => item.label === '退出球球')");
  exitItem.click();
  assert.equal(f.app.quitCalls, 1);
  assert.equal(f.call('isQuitting'), false, '菜单不得抢先写入退出态');
  assert.equal(f.connections.at(-1).closed, false);
  assert.equal(f.bubble.destroys, 0);
  assert.equal(f.quotaLabel.destroys, 0);

  f.app.emit('before-quit');
  assert.equal(f.call('isQuitting'), true);
  assert.equal(f.connections.at(-1).closed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.activity.stops, 1);
  assert.equal(f.bubble.destroys, 1);
  assert.equal(f.quotaLabel.destroys, 1);
  const cleanup = { activity: f.activity.stops, bubble: f.bubble.destroys, label: f.quotaLabel.destroys };
  f.app.emit('before-quit');
  assert.deepEqual({ activity: f.activity.stops, bubble: f.bubble.destroys, label: f.quotaLabel.destroys }, cleanup,
    '重复 before-quit 不得二次伤害已清理资源');
});

test('旧球球窗口迟到的移动、缩放、隐藏和关闭事件不伤害新窗口资源', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const stale = f.call('petWindow = null; createPetWindow()');
  const current = f.call('petWindow = null; createPetWindow()');
  current.emit('ready-to-show');
  current.webContents.emit('did-finish-load');
  f.send('pet:motion-start', { token: 7, action: 'hop' }, current.webContents);
  f.send('pet:say', 'hello', current.webContents);
  const before = { moves: f.bubble.moves, hides: f.bubble.hides, destroys: f.bubble.destroys,
    labelMoves: f.quotaLabel.moves, labelHides: f.quotaLabel.hides, labelDestroys: f.quotaLabel.destroys,
    timers: f.timers.size };
  assert.doesNotThrow(() => stale.emit('move'));
  assert.doesNotThrow(() => stale.emit('resize'));
  assert.doesNotThrow(() => stale.emit('hide'));
  stale.destroyed = true;
  assert.doesNotThrow(() => stale.emit('closed'));
  assert.deepEqual({ moves: f.bubble.moves, hides: f.bubble.hides, destroys: f.bubble.destroys,
    labelMoves: f.quotaLabel.moves, labelHides: f.quotaLabel.hides, labelDestroys: f.quotaLabel.destroys,
    timers: f.timers.size }, before);
  assert.equal(f.call('petWindow') === current, true);
  assert.equal(f.call('codexPageReady'), true);
});

test('旧球球窗口迟到的加载和渲染事件不改写新窗口就绪状态', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const stale = f.call('petWindow = null; createPetWindow()');
  const current = f.call('petWindow = null; createPetWindow()');
  current.emit('ready-to-show');
  current.webContents.emit('did-finish-load');
  stale.visible = false;
  current.visible = false;
  const starts = f.activity.starts;
  assert.doesNotThrow(() => stale.emit('ready-to-show'));
  assert.equal(stale.visible, false);
  assert.equal(current.visible, false, '旧 ready 不得错误显示新窗口');
  assert.equal(f.call('codexPageReady'), true);
  stale.webContents.emit('did-start-loading');
  assert.equal(f.call('codexPageReady'), true);
  stale.webContents.emit('did-finish-load');
  assert.equal(f.activity.starts, starts, '旧页面完成不得重启活动监测');
  assert.doesNotThrow(() => stale.webContents.emit('did-fail-load', {}, -7, 'PRIVATE_OLD_LOAD'));
  assert.doesNotThrow(() => stale.webContents.emit('render-process-gone', {}, { reason: 'PRIVATE_OLD_RENDER' }));
  assert.equal(f.call('codexPageReady'), true);
  assert.equal(f.call('petWindow') === current, true);
});

test('旧窗口 loadFile 迟到拒绝不记错或退出，新窗口仍是唯一当前窗口', async () => {
  const f = await fixture();
  const stale = f.call('petWindow = null; createPetWindow()');
  const current = f.call('petWindow = null; createPetWindow()');
  assert.equal(typeof stale.loadFailure, 'function');
  assert.doesNotThrow(() => stale.loadFailure(new Error('PRIVATE_OLD_LOAD_REJECTION')));
  assert.equal(f.call('petWindow') === current, true);
  assert.equal(f.app.quitCalls, 0);
});

test('BrowserWindow 构造器同步重入创建时后一个窗口获胜，旧候选不得覆盖', async () => {
  const f = await fixture();
  let newest = null;
  let reentered = false;
  f.windowClass.onConstruct = () => {
    if (reentered) return;
    reentered = true;
    newest = f.call('createPetWindow()');
  };
  f.call('petWindow = null');
  const returned = f.call('createPetWindow()');
  const outerCandidate = f.windows.at(-2);
  assert.equal(returned, newest);
  assert.equal(f.call('petWindow') === newest, true);
  assert.equal(outerCandidate.destroyed, true, '同步重入后外层候选必须安全作废');
});

test('重复开启只弹一个确认，关闭及退出后的迟到确认不会连接', async () => {
  for (const reason of ['off', 'quit']) {
    let approve;
    const f = await fixture({ consent: () => new Promise(resolve => { approve = resolve; }) });
    assert.equal(f.call('typeof setCodexEnabled'), 'function');
    const pending = f.call('setCodexEnabled(true)');
    await f.call('setCodexEnabled(true)');
    assert.equal(f.dialogs.length, 1);
    if (reason === 'off') await f.call('setCodexEnabled(false)'); else f.app.emit('before-quit');
    approve({ response: 0 }); await pending;
    assert.equal(f.connections.length, 0);
    assert.equal(f.saved.some(value => value.codexEnabled), false);
  }
});

test('确认后才启用，已保存开启的重启不重复确认，关闭只清联动', async () => {
  const f = await fixture({ consent: async () => ({ response: 0 }) });
  assert.equal(f.call('typeof setCodexEnabled'), 'function');
  await f.call('setCodexEnabled(true)');
  assert.equal(f.connections.length, 1);
  assert.equal(f.saved.at(-1).codexEnabled, true);
  assert.equal(f.saved.at(-1).size, 'tiny');
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.send('pet:say', { event: 'play', motion: 'hop' });
  const ordinary = f.bubble.shows.at(-1);
  const hides = f.bubble.hides;
  await f.call('setCodexEnabled(false)');
  assert.equal(f.connections[0].closed, true);
  assert.equal(f.bubble.hides, hides);
  f.advanceTo(500);
  assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').at(-1).packet.frame.done, false);
  f.send('pet:bubble-reply', { id: ordinary.id, action: 'again' }, f.bubble);
  assert.equal(f.commands.at(-1).motion, 'hop');
  const restarted = await fixture({ codexEnabled: true });
  assert.equal(restarted.connections.length, 1);
  assert.equal(restarted.dialogs.length, 0);
  restarted.app.emit('before-quit');
  assert.equal(restarted.connections[0].closed, true);
  assert.equal(restarted.timers.size, 0);
});

test('关闭时写设置失败也立即清理连接与定时器，并在关闭态显示未保存警示', async () => {
  const f = await fixture({ codexEnabled: true, saveError: new Error('ENOSPC_PRIVATE_PATH') });
  assert.equal(f.connections.length, 1);
  assert.ok(f.timers.size > 0);
  await assert.doesNotReject(f.call('setCodexEnabled(false)'));
  assert.equal(f.call('codexCompanion.getSnapshot().enabled'), false);
  assert.equal(f.connections[0].closed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.quotaLabel.destroys, 1, '设置落盘失败也必须彻底释放额度标签');
  const menu = f.call('menuTemplate()');
  assert.equal(findMenuItem(menu, 'codex-enabled').checked, false);
  assert.equal(findMenuItem(menu, 'codex-status'), null);
  const warning = findMenuItem(menu, 'codex-preference-warning');
  assert.ok(warning, '关闭态仍须看见未保存风险');
  assert.match(warning.label, /已关闭.*未保存.*重启.*恢复/);
  assert.doesNotMatch(warning.label, /ENOSPC|PRIVATE/);
});

test('开启前设置保存失败维持关闭、零连接，警示不暴露原始错误', async () => {
  const f = await fixture({ consent: async () => ({ response: 0 }), saveError: new Error('PRIVATE_WRITE_FAILURE') });
  await assert.doesNotReject(f.call('setCodexEnabled(true)'));
  assert.equal(f.connections.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.call('codexCompanion.getSnapshot().enabled'), false);
  const menu = f.call('menuTemplate()');
  assert.equal(findMenuItem(menu, 'codex-enabled').checked, false);
  const warning = findMenuItem(menu, 'codex-preference-warning');
  assert.match(warning.label, /未能保存.*保持关闭/);
  assert.doesNotMatch(warning.label, /PRIVATE/);
});

test('动作确认前无气泡，确认来自球球且仍有效后才开始原生动作', async () => {
  const f = await fixture({ codexEnabled: true });
  assert.equal(f.connections.length, 1);
  const ack = queueCodexCompletion(f);
  assert.equal(f.bubble.shows.length, 0);
  f.send('pet:codex-motion-ready', ack, {});
  assert.equal(f.bubble.shows.length, 0);
  f.send('pet:codex-availability', { generation: ack.generation, available: false });
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.bubble.shows.length, 1, '自己的动作忙碌上报不能拒绝合法确认');
  assert.equal(f.call('hostMotion.owner'), 'codex');
  const first = f.bubble.shows[0];
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.bubble.shows.length, 1, '重复确认不能重播');
  f.send('pet:bubble-reply', { id: first.id, action: 'codex-open' }, {});
  assert.equal(f.external.length, 0);
  f.send('pet:bubble-reply', { id: first.id, action: 'codex-open' }, f.bubble);
  await flush();
  assert.deepEqual(f.external, [`codex://threads/${TASK_ID}`]);
  assert.equal(f.call('codexCompanion.getSnapshot().currentAlert'), null);
  await f.call('setCodexEnabled(false)');
});

for (const reason of ['off', 'account', 'drag', 'sleep', 'hide', 'lock', 'user-motion', 'expiry']) {
  test(`${reason} 后迟到 Codex 确认不复活或误停用户动作`, async () => {
    const f = await fixture({ codexEnabled: true });
    assert.equal(f.connections.length, 1);
    const ack = queueCodexCompletion(f);
    if (reason === 'off') await f.call('setCodexEnabled(false)');
    if (reason === 'account') f.connections[0].callbacks.onAccount({ accountKey: 'account-two' });
    if (reason === 'drag') f.send('pet:drag-start', { x: 20, y: 20 });
    if (reason === 'sleep') f.call("sendCommand('sleep')");
    if (reason === 'hide') f.pet.hide();
    if (reason === 'lock') f.powerMonitor.emit('lock-screen');
    if (reason === 'user-motion') f.send('pet:motion-start', { token: 91, action: 'bow' });
    if (reason === 'expiry') f.advanceTo(13000);
    const frames = f.pet.messages.filter(item => item.channel === 'pet:motion-frame').length;
    f.send('pet:codex-motion-ready', ack);
    assert.equal(f.bubble.shows.length, 0);
    assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').length, frames);
    if (reason === 'user-motion') assert.equal(f.call('hostMotion.token'), 91);
    await f.call('setCodexEnabled(false)');
  });
}

test('旧菜单闭包在账号切换、任务移出、联动关闭后不能打开任务', async () => {
  const f = await fixture({ codexEnabled: true });
  assert.equal(f.connections.length, 1);
  queueCodexCompletion(f);
  const activeId = '33333333-3333-4333-8333-333333333333';
  f.connections[0].callbacks.onTask({ id: activeId, title: '进行中任务', state: 'active', turnId: 'active-turn', baseline: true });
  const item = menuItem(f, 'codex-status').submenu.find(item => item.id === 'codex-tasks').submenu[0];
  f.connections[0].callbacks.onTask({ id: activeId, removed: true });
  await item.click();
  assert.equal(f.external.length, 0);
  f.connections[0].callbacks.onAccount({ accountKey: 'account-two' });
  await item.click();
  assert.equal(f.external.length, 0);
  await f.call('setCodexEnabled(false)');
  await item.click();
  assert.equal(f.external.length, 0);
});

test('气泡总开关关闭只禁气泡，仍有 Codex 动作与状态菜单', async () => {
  const f = await fixture({ codexEnabled: true });
  assert.equal(f.connections.length, 1);
  f.call("setCompanionSetting('bubblesEnabled', false)");
  const ack = queueCodexCompletion(f);
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.call('hostMotion.owner'), 'codex');
  assert.equal(f.bubble.shows.length, 0);
  assert.ok(menuItem(f, 'codex-status'));
  await f.call('setCodexEnabled(false)');
});

test('页面重新加载立即撤销旧页面的可用性和待确认提醒', async () => {
  const f = await fixture({ codexEnabled: true });
  const ack = queueCodexCompletion(f);
  f.pet.webContents.emit('did-start-loading');
  f.send('pet:codex-availability', { generation: ack.generation, available: true });
  assert.equal(f.call('codexRenderer'), null);
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.bubble.shows.length, 0);
  assert.equal(f.call('codexCompanion.getSnapshot().currentAlert'), null);
  await f.call('setCodexEnabled(false)');
});

test('页面重载完成后，同连接代次的旧页面 availability 仍不可恢复门禁', async () => {
  const f = await fixture({ codexEnabled: true });
  const old = f.pet.messages.filter(item => item.channel === 'pet:codex-settings').at(-1).packet;
  f.send('pet:codex-availability', { ...old, available: true });
  f.pet.webContents.emit('did-start-loading');
  f.pet.webContents.emit('did-finish-load');
  const fresh = f.pet.messages.filter(item => item.channel === 'pet:codex-settings').at(-1).packet;
  assert.equal(fresh.generation, old.generation, '页面重载不应重连 Codex');
  assert.ok(fresh.pageEpoch > old.pageEpoch, '每次加载须有独立页面代次');
  f.send('pet:codex-availability', { ...old, available: true });
  assert.equal(f.call('codexRenderer'), null);
  f.send('pet:codex-availability', { ...fresh, available: true });
  assert.equal(f.call('codexRenderer.pageEpoch'), fresh.pageEpoch);
  await f.call('setCodexEnabled(false)');
});

test('有当前提醒的页面重载清理不能把新页面代次提前泄给旧 renderer', async () => {
  const f = await fixture({ codexEnabled: true });
  queueCodexCompletion(f);
  assert.ok(f.call('codexCompanion.getSnapshot().currentAlert'));
  const before = f.pet.messages.filter(item => item.channel === 'pet:codex-settings');
  const old = before.at(-1).packet;
  f.pet.webContents.emit('did-start-loading');
  assert.equal(f.call('codexCompanion.getSnapshot().currentAlert'), null, '清理应触发真实 controller notify');
  const during = f.pet.messages.filter(item => item.channel === 'pet:codex-settings');
  assert.equal(during.length, before.length, '未 ready 不能发送带新代次的设置');
  assert.equal(f.call('codexSentSettings.pageEpoch'), old.pageEpoch, '未发送的代次也不能标为已发');
  f.pet.webContents.emit('did-finish-load');
  const after = f.pet.messages.filter(item => item.channel === 'pet:codex-settings');
  assert.equal(after.length, before.length + 1);
  assert.ok(after.at(-1).packet.pageEpoch > old.pageEpoch);
  f.send('pet:codex-availability', { ...old, available: true });
  assert.equal(f.call('codexRenderer'), null);
  await f.call('setCodexEnabled(false)');
});

test('动作确认必须属于命令对应页面，旧页面取消不能指向新页面', async () => {
  const f = await fixture({ codexEnabled: true });
  const ack = queueCodexCompletion(f);
  const settingsPacket = f.pet.messages.filter(item => item.channel === 'pet:codex-settings').at(-1).packet;
  f.send('pet:codex-motion-ready', { ...ack, pageEpoch: settingsPacket.pageEpoch + 1 });
  assert.equal(f.bubble.shows.length, 0);
  const cancel = f.commands.findLast(command => command?.command === 'codex-cancel');
  assert.equal(cancel.pageEpoch, settingsPacket.pageEpoch + 1);
  f.send('pet:codex-motion-ready', { ...ack, pageEpoch: settingsPacket.pageEpoch });
  assert.equal(f.bubble.shows.length, 1);
  await f.call('setCodexEnabled(false)');
});

test('任务增量只更新菜单，不反复向页面发送设置', async () => {
  const f = await fixture({ codexEnabled: true });
  queueCodexCompletion(f);
  const before = f.pet.messages.filter(item => ['pet:settings', 'pet:codex-settings'].includes(item.channel)).length;
  for (const title of ['一', '二', '三']) f.connections[0].callbacks.onTask({ id: TASK_ID, title, state: 'completed', turnId: 'turn-1' });
  assert.equal(f.pet.messages.filter(item => ['pet:settings', 'pet:codex-settings'].includes(item.channel)).length, before);
  await f.call('setCodexEnabled(false)');
});

test('打开失败只给固定说明，旧代次迟到错误不污染新菜单', async () => {
  let fail;
  const f = await fixture({ codexEnabled: true, openExternal: () => new Promise((_resolve, reject) => { fail = reject; }) });
  queueCodexCompletion(f);
  const descriptor = { scope: 'menu', type: 'open-task', generation: 1, taskId: TASK_ID, url: 'https://untrusted.invalid' };
  const pending = f.call(`routeCodexAction(${JSON.stringify(descriptor)})`);
  assert.deepEqual(f.external, [`codex://threads/${TASK_ID}`]);
  f.connections[0].callbacks.onAccount({ accountKey: 'new-account' });
  fail(new Error('PRIVATE_RAW_ERROR')); await pending;
  assert.equal(f.call('codexNotice'), null);
  f.connections[0].callbacks.onTask({ id: TASK_ID, title: '新任务', state: 'active', turnId: 'next', baseline: true });
  const second = f.call(`routeCodexAction(${JSON.stringify({ ...descriptor, generation: 2 })})`);
  fail(new Error('PRIVATE_RAW_ERROR')); await second;
  assert.equal(f.call('codexNotice.text'), '无法打开 Codex，请确认已安装');
  await f.call('setCodexEnabled(false)');
});

test('多任务完成提醒只弹当前结果，点有效结果才打开并关闭提醒', async () => {
  const f = await fixture({ codexEnabled: true });
  const shown = queueMultiCodexCompletion(f);
  assert.equal(shown.actions[0].id, 'codex-results');
  f.send('pet:bubble-reply', { id: shown.id, action: 'codex-results' }, f.bubble);
  assert.equal(f.popups.length, 1);
  assert.equal(f.popups[0].value.length, 2);
  assert.equal(f.external.length, 0);
  assert.ok(f.call('codexCompanion.getSnapshot().currentAlert'), '弹菜单时不能立即关闭当前提醒');
  await f.popups[0].value[0].click();
  assert.deepEqual(f.external, [`codex://threads/${TASK_ID}`]);
  assert.equal(f.call('codexCompanion.getSnapshot().currentAlert'), null);
});

for (const reason of ['expiry', 'account', 'removed', 'off']) {
  test(`临时结果菜单在${reason}后不能打开旧任务`, async () => {
    const f = await fixture({ codexEnabled: true });
    const shown = queueMultiCodexCompletion(f);
    f.send('pet:bubble-reply', { id: shown.id, action: 'codex-results' }, f.bubble);
    assert.equal(f.popups.length, 1);
    if (reason === 'expiry') f.advanceTo(13000);
    if (reason === 'account') f.connections[0].callbacks.onAccount({ accountKey: 'account-two' });
    if (reason === 'removed') f.connections[0].callbacks.onTask({ id: TASK_ID, removed: true });
    if (reason === 'off') await f.call('setCodexEnabled(false)');
    await f.popups[0].value[0].click();
    assert.equal(f.external.length, 0);
  });
}

test('当前结果不存在时不弹窗且如实返回 false', async () => {
  const f = await fixture({ codexEnabled: true });
  const shown = queueMultiCodexCompletion(f);
  const descriptor = f.call(`dialogue.respond(${shown.id}, 'codex-results', performance.now()).descriptor`);
  f.advanceTo(13000);
  assert.equal(await f.call(`routeCodexAction(${JSON.stringify(descriptor)})`), false);
  assert.equal(f.popups.length, 0);
});

test('旧 codex-list 按钮不能再触发任何结果', async () => {
  const f = await fixture({ codexEnabled: true });
  const shown = queueMultiCodexCompletion(f);
  f.send('pet:bubble-reply', { id: shown.id, action: 'codex-list' }, f.bubble);
  assert.equal(f.popups.length, 0);
  assert.equal(f.external.length, 0);
  await f.call('setCodexEnabled(false)');
});

test('主进程校验来源和白名单，窗口帧不写设置且气泡跟随移动', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' }, {});
  f.send('pet:motion-start', { token: 0, action: 'hop' });
  f.send('pet:motion-start', { token: 1, action: '__proto__' });
  assert.equal(f.timers.size, 0);
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  assert.ok(f.timers.size > 0, '主进程必须注册受控动作入口');
  f.at(540);
  assert.ok(f.pet.bounds.y < 100);
  assert.equal(f.saved.length, 0);
  assert.ok(f.bubble.moves > 0);
  assert.equal(f.pet.messages.at(-1).channel, 'pet:motion-frame');
  f.send('pet:stop-motion');
  assert.equal(f.pet.bounds.y, 100);
});

test('实机同型workArea高度加1事件不截断bow重播，也不落盘临时位置', async () => {
  const f = await fixture();
  const display = f.screen.getPrimaryDisplay();
  f.send('pet:motion-start', { token: 10, action: 'bow' });
  f.at(844);
  display.workArea.height += 1;
  f.screen.emit('display-metrics-changed', {}, display, ['workArea']);
  assert.equal(f.timers.size, 1, '无害工作区变化不能清掉动作计时器');
  assert.equal(f.commands.includes('stop'), false);
  assert.equal(f.saved.length, 0);
  f.at(1599);
  assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').at(-1).packet.frame.done, false);
  f.at(1600);
  const frames = f.pet.messages.filter(item => item.channel === 'pet:motion-frame');
  assert.ok(frames.every(item => item.packet.token === 10 && item.packet.action === 'bow'));
  assert.equal(frames.at(-1).packet.frame.done, true);
  assert.deepEqual(f.pet.getPosition(), [-600, 100]);
});

test('锚点仍安全时工作区收缩会约束未来hop轨迹，并保持完整时长', async () => {
  const f = await fixture();
  const display = f.screen.getPrimaryDisplay();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.at(100);
  Object.assign(display.workArea, { y: 95, height: 505 });
  f.screen.emit('display-metrics-changed', {}, display, ['workArea']);
  assert.equal(f.timers.size, 1);
  for (let at = 116; at < 1800; at += 16) {
    f.at(at);
    assert.ok(f.pet.bounds.y >= 95);
    assert.ok(f.pet.bounds.y + f.pet.bounds.height <= 600);
    assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').at(-1).packet.frame.done, false);
  }
  f.at(1800);
  assert.deepEqual(f.pet.getPosition(), [-600, 100]);
  assert.equal(f.saved.length, 0);
});

test('当前半空位置安全但原始归位锚点越界时，仍停止并按原始位置回收', async () => {
  const f = await fixture();
  f.pet.bounds.y = 520;
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.at(540);
  const old = [...f.timers.values()][0].callback;
  const display = f.screen.getPrimaryDisplay();
  display.workArea.height = 599;
  assert.ok(f.pet.bounds.y + f.pet.bounds.height <= 599);
  f.screen.emit('display-metrics-changed', {}, display, ['workArea']);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.pet.getPosition(), [-600, 519]);
  old();
  assert.deepEqual(f.pet.getPosition(), [-600, 519]);
  assert.ok(f.commands.includes('stop'));
});

for (const change of ['identity', 'removed', 'bounds', 'scaleFactor']) {
  test(`${change}真实屏幕变化仍停止动作并回收，旧回调不会复活`, async () => {
    const f = await fixture();
    f.send('pet:motion-start', { token: 1, action: 'hop' });
    f.at(540);
    const old = [...f.timers.values()][0].callback;
    const display = f.screen.getPrimaryDisplay();
    if (change === 'identity') {
      display.id = 2;
      f.screen.emit('display-metrics-changed', {}, display, ['workArea']);
    } else if (change === 'removed') {
      const replacement = { id: 2, workArea: { x: 0, y: 0, width: 1000, height: 600 } };
      f.screen.getAllDisplays = () => [replacement];
      f.screen.getPrimaryDisplay = () => replacement;
      f.screen.getDisplayMatching = () => replacement;
      f.screen.emit('display-removed', {}, display);
      assert.ok(f.pet.bounds.x >= 0 && f.pet.bounds.x + 80 <= 1000);
    } else f.screen.emit('display-metrics-changed', {}, display, [change]);
    assert.equal(f.timers.size, 0);
    assert.ok(f.commands.includes('stop'));
    const recovered = f.pet.getBounds();
    old();
    assert.deepEqual(f.pet.getBounds(), recovered);
  });
}

test('当前窗口换屏但原始锚点仍在旧屏时，也不能继续原动作', async () => {
  const f = await fixture();
  const firstDisplay = f.screen.getPrimaryDisplay();
  const secondDisplay = { id: 2, workArea: { x: 0, y: 0, width: 1000, height: 600 } };
  f.screen.getAllDisplays = () => [firstDisplay, secondDisplay];
  f.screen.getDisplayMatching = bounds => bounds.x < 0 ? firstDisplay : secondDisplay;
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.at(540);
  f.pet.bounds.x = 200;
  f.screen.emit('display-metrics-changed', {}, firstDisplay, ['workArea']);
  assert.equal(f.timers.size, 0);
  assert.ok(f.commands.includes('stop'));
});

test('其他显示器仅workArea改变不会截断当前屏幕的安全动作，混合几何变化仍恢复', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.at(540);
  const otherDisplay = { id: 2, workArea: { x: 0, y: 0, width: 1000, height: 599 } };
  f.screen.emit('display-metrics-changed', {}, otherDisplay, ['workArea']);
  assert.equal(f.timers.size, 1);
  assert.equal(f.commands.includes('stop'), false);
  assert.equal(f.saved.length, 0);
  f.screen.emit('display-metrics-changed', {}, f.screen.getPrimaryDisplay(), ['workArea', 'bounds']);
  assert.equal(f.timers.size, 0);
  assert.ok(f.commands.includes('stop'));
});

test('没有边界夹紧的旧单击bounce保留工作区变化时停止归位的安全行为', async () => {
  const f = await fixture();
  f.send('pet:bounce');
  f.at(200);
  assert.ok(f.pet.bounds.y < 100);
  const display = f.screen.getPrimaryDisplay();
  display.workArea.height += 1;
  f.screen.emit('display-metrics-changed', {}, display, ['workArea']);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.pet.getPosition(), [-600, 100]);
});

for (const reason of ['sleep', 'rest', 'hide', 'size', 'resize', 'display', 'lock', 'suspend', 'close', 'quit']) {
  test(`主进程${reason}路径停止动作，旧回调不再移动或发帧`, async () => {
    const f = await fixture();
    f.send('pet:motion-start', { token: 1, action: 'hop' });
    assert.ok(f.timers.size > 0);
    f.at(540);
    const old = [...f.timers.values()].map(item => item.callback);
    if (reason === 'sleep' || reason === 'rest') f.call(`sendCommand('${reason}')`);
    else if (reason === 'hide') f.pet.hide();
    else if (reason === 'size') f.call("setPetSize('small')");
    else if (reason === 'resize') f.pet.emit('resize');
    else if (reason === 'display') f.screen.emit('display-metrics-changed');
    else if (reason === 'lock') f.powerMonitor.emit('lock-screen');
    else if (reason === 'suspend') f.powerMonitor.emit('suspend');
    else if (reason === 'close') { f.pet.destroyed = true; f.pet.emit('closed'); }
    else f.app.emit('before-quit');
    const bounds = { ...f.pet.bounds };
    const count = f.pet.messages.length;
    old.forEach(callback => callback());
    assert.deepEqual(f.pet.bounds, bounds);
    assert.equal(f.pet.messages.length, count);
    assert.equal(f.timers.size, 0);
    if (reason !== 'close') assert.ok(f.commands.includes('stop') || f.commands.includes(reason));
  });
}

test('拖动在建立锚点前复原，旧动作不会拉回新位置且与单击跳互斥', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  assert.ok(f.timers.size > 0);
  f.at(540);
  const old = [...f.timers.values()][0].callback;
  f.send('pet:drag-start', { x: 20, y: 20 });
  f.send('pet:drag-move', { x: 70, y: 70 });
  assert.deepEqual(f.pet.getPosition(), [-550, 150]);
  old();
  assert.deepEqual(f.pet.getPosition(), [-550, 150]);
  f.send('pet:drag-end');
  f.send('pet:bounce');
  f.at(700);
  f.send('pet:motion-start', { token: 2, action: 'hop' });
  assert.equal(f.pet.bounds.y, 150);
  f.at(1240);
  f.send('pet:bounce');
  assert.equal(f.pet.bounds.y, 150);
  assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').at(-1).packet.frame.done, true);
});

test('双击的迟到 drag-end 不能截断已经开始的新动作', async () => {
  const f = await fixture();
  f.send('pet:drag-start', { x: 20, y: 20 });
  f.send('pet:motion-start', { token: 2, action: 'peek' });
  f.at(1100);
  const before = f.pet.messages.filter(item => item.channel === 'pet:motion-frame');
  assert.equal(before.at(-1).packet.frame.done, false);

  // macOS 屏幕边缘下 pointerup 对应的 IPC 可能比双击动作开始更晚到达。
  f.send('pet:drag-end');

  assert.equal(f.timers.size, 1, '迟到的抬手不应清掉新动作计时器');
  assert.equal(f.pet.messages.filter(item => item.channel === 'pet:motion-frame').at(-1).packet.frame.done, false);
  assert.deepEqual({ x: f.saved.at(-1).x, y: f.saved.at(-1).y }, { x: -600, y: 100 },
    '落盘必须使用动作锚点，不得保存中途帧位置');
  f.at(1900);
  const frames = f.pet.messages.filter(item => item.channel === 'pet:motion-frame');
  assert.equal(frames.at(-1).packet.token, 2);
  assert.equal(frames.at(-1).packet.frame.done, true);
  assert.deepEqual(f.pet.getPosition(), [-600, 100]);
});

test('越界锚点不能被动画夹紧帧伪装成安全位置', async () => {
  const f = await fixture();
  f.pet.bounds.x = 50;
  f.send('pet:drag-start', { x: 20, y: 20 });
  f.send('pet:motion-start', { token: 3, action: 'peek' });
  f.at(1100);
  assert.deepEqual(f.pet.getPosition(), [-80, 100], '动画帧会把当前窗口暂时夹紧到屏幕内');

  f.send('pet:drag-end');

  assert.equal(f.timers.size, 0, '真实锚点越界时必须终止动作并恢复安全位置');
  const recovered = f.pet.getBounds();
  const area = f.screen.getPrimaryDisplay().workArea;
  assert.ok(recovered.x >= area.x && recovered.y >= area.y &&
    recovered.x + recovered.width <= area.x + area.width && recovered.y + recovered.height <= area.y + area.height);
  assert.deepEqual({ x: f.saved.at(-1).x, y: f.saved.at(-1).y }, { x: recovered.x, y: recovered.y });
  f.at(1900);
  assert.deepEqual(f.pet.getBounds(), recovered, '旧动作回调不得复活越界锚点');
});

test('休息作废拖动会话后，迟到 drag-end 不得覆盖已恢复的空坐标设置', async () => {
  const f = await fixture();
  f.send('pet:drag-start', { x: 20, y: 20 });
  f.send('pet:motion-start', { token: 4, action: 'peek' });
  f.call("sendCommand('rest')");
  assert.equal(f.call("restoreSmokePetSettings({ size: 'tiny', x: null, y: null })"), true);
  assert.deepEqual({ x: f.saved.at(-1).x, y: f.saved.at(-1).y }, { x: null, y: null });

  f.send('pet:drag-end');

  assert.deepEqual({ x: f.saved.at(-1).x, y: f.saved.at(-1).y }, { x: null, y: null },
    '已失效的抬手消息不能再把真实 bounds 写回设置');
  assert.equal(f.timers.size, 0);
});

test('新动作在对白冷却期会关闭错配旧泡，again传递绑定动作，关闭泡不停止动作', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.send('pet:say', { event: 'play', motion: 'hop' });
  assert.equal(f.bubble.shows.length, 1);
  const first = f.bubble.shows[0];
  f.send('pet:bubble-reply', { id: first.id, action: 'again' }, f.bubble);
  assert.equal(JSON.stringify(f.commands.at(-1)), JSON.stringify({ command: 'again', motion: 'hop' }));
  assert.ok(f.timers.size > 0);
  f.at(6000);
  f.send('pet:say', { event: 'play', motion: 'bow' });
  const previousHide = f.bubble.hides;
  f.send('pet:say', { event: 'play', motion: 'jelly' });
  assert.equal(f.bubble.hides, previousHide + 1);
});

test('hop开始100ms后真实拖起与落地链路会隐藏专属旧泡，旧按钮不能重播', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.send('pet:say', { event: 'play', motion: 'hop' });
  const first = f.bubble.shows[0];
  assert.ok(first);
  f.at(100);
  const hides = f.bubble.hides;
  f.send('pet:drag-start', { x: 20, y: 20 });
  f.send('pet:drag-move', { x: 70, y: 70 });
  f.send('pet:say', 'drag');
  assert.equal(f.bubble.shows.length, 1, '拖起新文案仍遵守冷却');
  assert.equal(f.bubble.hides, hides + 1, '旧hop文案必须同步隐藏');
  const replies = f.commands.length;
  f.send('pet:bubble-reply', { id: first.id, action: 'again' }, f.bubble);
  assert.equal(f.commands.length, replies, '旧气泡不能发出重播命令');
  f.send('pet:drag-end');
  f.send('pet:say', 'drop');
  assert.equal(f.bubble.shows.length, 1);
  assert.equal(f.timers.size, 0);
});

test('专属play的rest按钮仍停止动作并失效，不留下可重播的旧回应', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.send('pet:say', { event: 'play', motion: 'hop' });
  const first = f.bubble.shows[0];
  f.at(100);
  const hides = f.bubble.hides;
  f.send('pet:bubble-reply', { id: first.id, action: 'rest' }, f.bubble);
  assert.equal(f.commands.at(-1), 'rest');
  assert.equal(f.bubble.hides, hides + 1);
  assert.equal(f.timers.size, 0);
  const replies = f.commands.length;
  f.send('pet:bubble-reply', { id: first.id, action: 'again' }, f.bubble);
  assert.equal(f.commands.length, replies);
});

test('渲染进程关闭后，主进程停止与退出不因发送通知而抛出', async () => {
  const f = await fixture();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  f.at(540);
  f.pet.webContents.send = () => { throw new Error('renderer destroyed'); };
  assert.doesNotThrow(() => f.app.emit('before-quit'));
  assert.equal(f.timers.size, 0);
  assert.equal(f.pet.bounds.y, 100);
});

test('快速隐藏再恢复后，迟到的原生hide不关闭新打开的聊天', async () => {
  const f = await fixture();
  f.call('openChat()');
  f.call('hidePet()');
  f.call('restorePet()');
  f.call('openChat()');
  f.pet.emit('hide');
  assert.equal(f.pet.isVisible(), true);
  assert.equal(f.chatWindow.isVisible(), true);
  assert.notEqual(edgeSnapshot(f).mode, 'hidden');
});

test('隐藏或锁屏不启动新动作，恢复后旧帧不复活', async () => {
  const f = await fixture();
  f.pet.hide();
  f.send('pet:motion-start', { token: 1, action: 'hop' });
  assert.equal(f.timers.size, 0);
  f.pet.showInactive();
  f.powerMonitor.emit('lock-screen');
  f.send('pet:motion-start', { token: 2, action: 'hop' });
  assert.equal(f.timers.size, 0);
  f.powerMonitor.emit('unlock-screen');
  assert.equal(f.timers.size, 0);
  f.send('pet:motion-start', { token: 3, action: 'hop' });
  assert.ok(f.timers.size > 0);
});

function edgeSnapshot(f) {
  return f.pet.messages.filter(item => item.channel === 'pet:presentation').at(-1)?.packet;
}

test('边缘菜单提供靠左、靠右、离开、隐藏恢复，并且状态不写入设置', async () => {
  const f = await fixture();
  assert.ok(menuItem(f, 'edge-left'), '存在靠左收起入口');
  menuItem(f, 'edge-left').click();
  assert.equal(edgeSnapshot(f).mode, 'tucked');
  assert.equal(f.pet.bounds.x, -800);
  assert.equal(menuItem(f, 'edge-leave').enabled, true);
  menuItem(f, 'edge-visibility').click();
  assert.equal(edgeSnapshot(f).mode, 'hidden');
  assert.equal(f.pet.isVisible(), false);
  assert.equal(menuItem(f, 'edge-visibility').label, '显示球球');
  menuItem(f, 'edge-visibility').click();
  assert.equal(edgeSnapshot(f).mode, 'free');
  assert.equal(edgeSnapshot(f).side, null);
  assert.equal(f.pet.isVisible(), true);
  assert.ok(f.saved.every(value => !('edge' in value) && !('hidden' in value) && !('side' in value)));
  assert.ok(f.saved.every(value => value.x >= -800 && value.x <= -80));
});

test('主进程真实拖动到边才吸附；点击松手不会收起，迟到land被状态挡住', async () => {
  const f = await fixture();
  f.pet.bounds.x = -784;
  f.send('pet:drag-start', { x: -744, y: 140 }); f.send('pet:drag-end');
  assert.equal(edgeSnapshot(f)?.mode, 'free');
  f.send('pet:drag-start', { x: -744, y: 140 });
  f.send('pet:drag-move', { x: -752, y: 140 }); f.send('pet:drag-end');
  assert.equal(edgeSnapshot(f).mode, 'tucked');
  const bounds = f.pet.getBounds();
  f.send('pet:motion-start', { token: 92, action: 'land' }); f.send('pet:bounce');
  f.advanceTo(2000);
  assert.deepEqual(f.pet.getBounds(), bounds);
  assert.equal(f.call('hostMotion'), null);
  assert.equal(f.timers.size, 0);
  assert.equal(f.saved.at(-1).x, -800);
});

test('收起及隐藏抑制附属窗口与动作，但继续更新Codex并在展开显示最新额度', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.call("showDialogue('play')");
  assert.ok(menuItem(f, 'edge-right'));
  menuItem(f, 'edge-right').click();
  assert.equal(f.quotaLabel.visible, false);
  assert.equal(f.call("showDialogue('play')"), null);
  const shows = f.bubble.shows.length;
  f.connections[0].callbacks.onQuota({ updatedAt: 1800000000000,
    windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 42, resetsAt: 1800003600000 }] });
  f.connections[0].callbacks.onTask({ id: TASK_ID, title: '新任务', state: 'active', turnId: 'edge', baseline: true });
  assert.equal(f.quotaLabel.visible, false);
  assert.equal(f.pet.messages.filter(item => item.channel === 'pet:codex-settings').at(-1).packet.activeTaskCount, 1);
  f.activity.sample({ cursor: { x: -20, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
  assert.equal(edgeSnapshot(f).mode, 'peeked');
  assert.equal(f.quotaLabel.visible, true);
  assert.equal(f.quotaLabel.shows.at(-1).items[0].remaining, 42);
  assert.equal(f.bubble.shows.length, shows, '旧气泡不能重放');
  menuItem(f, 'edge-visibility').click();
  f.activity.sample({ cursor: { x: -20, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
  f.send('pet:motion-start', { token: 93, action: 'hop' });
  assert.equal(edgeSnapshot(f).mode, 'hidden');
  assert.equal(f.quotaLabel.visible, false);
  assert.equal(f.call('hostMotion'), null);
  await f.call('setCodexEnabled(false)');
});

for (const reason of ['size', 'resize', 'display', 'lock', 'suspend', 'close', 'quit', 'reset']) {
  test(`边缘展开等待期间${reason}取消收回计时，旧回调不再作用`, async () => {
    const f = await fixture();
    assert.ok(menuItem(f, 'edge-left'));
    menuItem(f, 'edge-left').click();
    f.activity.sample({ cursor: { x: -780, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
    f.activity.sample({ cursor: { x: -500, y: 40 }, petBounds: f.pet.getBounds(), locked: false });
    const callbacks = [...f.timers.values()].map(item => item.callback);
    assert.equal(callbacks.length, 1);
    if (reason === 'size') f.call("setPetSize('large')");
    if (reason === 'resize') f.pet.emit('resize');
    if (reason === 'display') f.screen.emit('display-removed');
    if (reason === 'lock') f.powerMonitor.emit('lock-screen');
    if (reason === 'suspend') f.powerMonitor.emit('suspend');
    if (reason === 'close') f.pet.destroy();
    if (reason === 'quit') f.app.emit('before-quit');
    if (reason === 'reset') f.call('resetPosition()');
    const before = f.pet.messages.length;
    callbacks.forEach(callback => callback());
    assert.equal(f.pet.messages.length, before);
    assert.equal(f.timers.size, 0);
    if (!['close', 'quit'].includes(reason)) {
      assert.ok(f.pet.bounds.x >= -800 && f.pet.bounds.x + f.pet.bounds.width <= 0);
      assert.ok(f.pet.bounds.y >= 0 && f.pet.bounds.y + f.pet.bounds.height <= 600);
    }
  });
}

test('真实拖动的抬手迟于land启动时仍按拖动终点收起', async () => {
  const f = await fixture();
  f.pet.bounds.x = -770;
  f.send('pet:drag-start', { x: -730, y: 140 });
  f.send('pet:drag-move', { x: -755, y: 140 });
  f.send('pet:motion-start', { token: 101, action: 'land' });
  f.send('pet:drag-end');
  assert.equal(edgeSnapshot(f).mode, 'tucked');
  assert.equal(edgeSnapshot(f).side, 'left');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.pet.getPosition(), [-800, 100]);
});

test('拖动途中锁屏会取消拖动并恢复完整可见位置', async () => {
  const f = await fixture();
  f.send('pet:drag-start', { x: -560, y: 140 });
  f.send('pet:drag-move', { x: -900, y: 800 });
  assert.ok(f.pet.bounds.x < -800);
  f.powerMonitor.emit('lock-screen');
  assert.ok(f.pet.bounds.x >= -800 && f.pet.bounds.x + 80 <= 0);
  assert.ok(f.pet.bounds.y >= 0 && f.pet.bounds.y + 80 <= 600);
  assert.equal(edgeSnapshot(f).dragging, false);
  const bounds = f.pet.getBounds();
  f.send('pet:drag-end');
  assert.deepEqual(f.pet.getBounds(), bounds);
});

test('边缘展开时任务结果菜单保持展示，移出半球超过650ms仍能打开当前任务', async () => {
  const f = await fixture({ codexEnabled: true });
  menuItem(f, 'edge-left').click();
  f.activity.sample({ cursor: { x: -780, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
  const shown = queueMultiCodexCompletion(f);
  f.send('pet:bubble-reply', { id: shown.id, action: 'codex-results' }, f.bubble);
  assert.equal(f.popups.length, 1);
  f.activity.sample({ cursor: { x: -500, y: 40 }, petBounds: f.pet.getBounds(), locked: false });
  f.advanceTo(5800);
  assert.equal(edgeSnapshot(f).mode, 'peeked', '鼠标进入原生结果菜单不能收起并作废提醒');
  await f.popups[0].value[0].click();
  assert.deepEqual(f.external, [`codex://threads/${TASK_ID}`]);
  f.popups[0].options.callback();
  f.advanceTo(6449);
  assert.equal(edgeSnapshot(f).mode, 'peeked');
  f.advanceTo(6450);
  assert.equal(edgeSnapshot(f).mode, 'tucked', '结果菜单关闭后恢复650ms收起');
});

for (const replacement of ['menu', 'window']) {
  test(`旧菜单关闭不能解除新${replacement}菜单的展开保护`, async () => {
    const f = await fixture();
    menuItem(f, 'edge-left').click();
    f.activity.sample({ cursor: { x: -780, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
    f.call('showPetContextMenu()');
    const previousClose = f.popups[0].options.callback;
    let current = f.pet;
    if (replacement === 'window') {
      f.pet.destroy();
      current = f.call('createPetWindow()');
      current.emit('ready-to-show');
      current.webContents.emit('did-finish-load');
      menuItem(f, 'edge-left').click();
      f.activity.sample({ cursor: { x: -780, y: 140 }, petBounds: current.getBounds(), locked: false });
    }
    f.call('showPetContextMenu()');
    f.activity.sample({ cursor: { x: -500, y: 40 }, petBounds: current.getBounds(), locked: false });
    previousClose();
    f.advanceTo(800);
    assert.equal(f.call('edgeTuck.getPresentation().mode'), 'peeked');
    f.popups[1].options.callback();
    f.advanceTo(1450);
    assert.equal(f.call('edgeTuck.getPresentation().mode'), 'tucked');
  });
}

test('原生菜单打开失败会释放展开保护，不留下永久展开状态', async () => {
  const f = await fixture();
  menuItem(f, 'edge-left').click();
  f.activity.sample({ cursor: { x: -780, y: 140 }, petBounds: f.pet.getBounds(), locked: false });
  f.activity.sample({ cursor: { x: -500, y: 40 }, petBounds: f.pet.getBounds(), locked: false });
  f.call("Menu.buildFromTemplate = () => ({ popup() { throw new Error('popup failed'); } })");
  assert.throws(() => f.call('showPetContextMenu()'), /popup failed/);
  f.advanceTo(650);
  assert.equal(edgeSnapshot(f).mode, 'tucked');
});

test('监控按专用 workspace 提前排除球球聊天，不依赖新 thread ID 已登记', async () => {
  const f = await fixture({ codexEnabled: true });
  const { ignoreTask, ignoreThread } = f.connections[0].callbacks;
  assert.equal(ignoreTask(TASK_ID), false);
  assert.equal(ignoreThread({ id: TASK_ID, cwd: '/fixture/chat-workspace' }), true);
  assert.equal(ignoreThread({ cwd: '/fixture/chat-workspace/' }), true);
  for (const row of [null, {}, { cwd: '' }, { cwd: '/fixture/chat-workspace-other' }, { cwd: '/other/chat-workspace' }]) {
    assert.equal(ignoreThread(row), false);
  }
  f.chat.ownedThreads.add(TASK_ID);
  assert.equal(ignoreTask(TASK_ID), true);
});


test('界面配色在未开启Codex时可切换，持久化并同步已打开和后创建的窗口', async () => {
  const f = await fixture({ codexQuotaAppearance: 'light' });
  const menu = findMenuItem(f.call('menuTemplate()'), 'color-mode');
  assert.equal(menu.label, '界面配色');
  findMenuItem(menu.submenu, 'color-accessible').click();
  assert.equal(f.saved.at(-1).colorMode, 'accessible');
  assert.equal(f.saved.at(-1).codexQuotaAppearance, 'light');
  assert.equal(f.connections.length, 0);
  assert.deepEqual(f.pet.messages.filter(row => row.channel === 'pet:color-mode').at(-1), { channel: 'pet:color-mode', packet: 'accessible' });
  const late = new f.windowClass({ x: 0, y: 0, width: 100, height: 100 });
  late.webContents.emit('did-finish-load');
  assert.equal(late.messages.at(-1).packet, 'accessible');
  f.call("setColorMode('standard')");
  assert.equal(late.messages.at(-1).packet, 'standard');
  assert.equal(f.saved.at(-1).codexQuotaAppearance, 'light');
  assert.equal(findMenuItem(f.call('menuTemplate()'), 'color-standard').checked, true);
});

test('保存配色失败时保留原有选择，不向窗口广播未保存的模式', async () => {
  const f = await fixture({ colorMode: 'accessible', saveError: new Error('COLOR_WRITE_FAILURE') });
  f.call('writeError = () => {}');
  const count = f.pet.messages.length;
  assert.equal(f.call("setColorMode('standard')"), false);
  assert.equal(f.call('settings.colorMode'), 'accessible');
  assert.equal(f.pet.messages.length, count);
  assert.equal(findMenuItem(f.call('menuTemplate()'), 'color-accessible').checked, true);
});


test('色弱友好外观在Codex关闭时也能切换并保存，原额度外观入口与之同步', async () => {
  const f=await fixture({colorMode:'accessible',codexQuotaAppearance:'dark'});
  findMenuItem(f.call('menuTemplate()'),'color-appearance-light').click();
  assert.equal(f.saved.at(-1).codexQuotaAppearance,'light');assert.equal(f.saved.at(-1).colorMode,'accessible');
  assert.equal(f.pet.colorAppearance,'light');assert.equal(f.connections.length,0);
  assert.equal(findMenuItem(f.call('menuTemplate()'),'color-appearance-light').checked,true);
  const connected=await fixture({colorMode:'accessible',codexEnabled:true,codexQuotaAppearance:'dark'});
  connected.call("setCodexPreference('codexQuotaAppearance','light')");assert.equal(connected.pet.colorAppearance,'light');
});

test('外观保存失败时保留原有配色且不广播', async () => {
  const f=await fixture({colorMode:'accessible',codexQuotaAppearance:'dark',saveError:new Error('APPEARANCE_WRITE')});
  f.call('writeError=()=>{}');const count=f.pet.messages.length;
  assert.equal(f.call("setInterfaceAppearance('light')"),false);
  assert.equal(f.call('settings.codexQuotaAppearance'),'dark');assert.equal(f.pet.messages.length,count);
});
