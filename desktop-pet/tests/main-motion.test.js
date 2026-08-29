const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');

// 真实 main、动作控制器和对白规则；只替代 Electron、系统采样和磁盘设置。
async function fixture({ codexEnabled = false, codexTaskNameInAlerts = false,
  consent = async () => ({ response: 1 }), openExternal = async () => {}, saveError = null } = {}) {
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const windows = [];
  const saved = [];
  const commands = [];
  const connections = [];
  const dialogs = [];
  const external = [];
  const popups = [];
  const app = Object.assign(new EventEmitter(), { setName() {}, getPath: () => '/fixture',
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), setActivationPolicy() {},
    quit() {}, exit(code) { throw new Error(`unexpected exit ${code}`); } });
  const ipcMain = new EventEmitter();
  const powerMonitor = new EventEmitter();
  const display = { id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, workArea: { x: -800, y: 0, width: 800, height: 600 } };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display });
  class NativeWindow extends EventEmitter {
    constructor(options) {
      super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false; this.destroyed = false;
      this.messages = [];
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {},
        send: (channel, packet) => { this.messages.push({ channel, packet }); if (channel === 'pet:command') commands.push(packet); } });
      windows.push(this);
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {} moveTop() {}
    getBounds() { return { ...this.bounds }; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; }
    setPosition(x, y, animate) { assert.equal(animate, false); Object.assign(this.bounds, { x, y }); this.emit('move'); }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); }
    loadFile() { return Promise.resolve(); }
    showInactive() { this.visible = true; } hide() { this.visible = false; this.emit('hide'); }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const bubble = { shows: [], hides: 0, moves: 0, show(payload) { this.shows.push(payload); }, hide() { this.hides++; },
    reposition() { this.moves++; }, destroy() {}, setAlwaysOnTop() {}, getWindow: () => ({ isDestroyed: () => false, webContents: bubble }) };
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
        bubblesEnabled: true, keepAwake: false, alwaysOnTop: true, codexEnabled, codexTaskNameInAlerts }),
        saveSettings: (_file, settings) => { if (saveError) throw saveError; saved.push({ ...settings }); return settings; } };
      if (name === './lib/codex-companion') return { createCodexCompanion: options => realRequire(name).createCodexCompanion({ ...options,
        createConnection(callbacks) {
          const connection = { callbacks, closed: false, async start() {
            callbacks.onAccount({ accountKey: 'account-one' });
            callbacks.onStatus({ channel: 'quota', state: 'connected' });
            callbacks.onStatus({ channel: 'tasks', state: 'connected' });
          }, async refresh() {}, async retry() {}, close() { this.closed = true; } };
          connections.push(connection);
          return connection;
        }
      }) };
      if (name === './lib/bubble-window') return { createBubbleWindow: () => bubble };
      if (name === './lib/activity-monitor') return { ...realRequire(name), createActivityMonitor: () => ({ start() {}, stop() {}, pause() {}, resume() {} }) };
      return realRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8'), context);
  await flush();
  const pet = windows[0];
  pet.emit('ready-to-show');
  pet.webContents.emit('did-finish-load');
  return { pet, bubble, commands, saved, screen, powerMonitor, app, timers, connections, dialogs, external, popups,
    call: expression => vm.runInContext(expression, context),
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
  const item = f.call("menuTemplate().find(item => item.id === 'codex-enabled')");
  assert.ok(item, '菜单必须有可选开关');
  assert.equal(item.checked, false);
  const names = f.call("menuTemplate().find(item => item.id === 'codex-task-names')");
  assert.equal(names.checked, false);
  assert.equal(names.enabled, false);
  assert.equal(f.call('setCodexTaskNameInAlerts(true)'), false);
  assert.equal(f.saved.length, 0);
  assert.equal(f.call("menuTemplate().find(item => item.id === 'codex-task-names').checked"), false);
  assert.equal(f.call("menuTemplate().some(item => item.id === 'codex-status')"), false);
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

test('任务名称开关保存成功才更新偏好和菜单，失败时完整回滚', async () => {
  const f = await fixture({ codexEnabled: true });
  const ack = queueCodexCompletion(f);
  f.send('pet:codex-motion-ready', ack);
  const shown = f.bubble.shows.at(-1);
  const commands = f.commands.length;
  const timers = f.timers.size;
  assert.equal(f.call('setCodexTaskNameInAlerts(true)'), true);
  assert.equal(f.saved.at(-1).codexTaskNameInAlerts, true);
  assert.equal(f.call("menuTemplate().find(item => item.id === 'codex-task-names').checked"), true);
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
  assert.equal(failed.call("menuTemplate().find(item => item.id === 'codex-task-names').checked"), false);
  assert.equal(failed.bubble.shows.length, beforeShows);
  assert.equal(failed.bubble.shows.at(-1).id, failedShown.id);
});

test('已保存的任务名称开关启动即生效', async () => {
  const f = await fixture({ codexEnabled: true, codexTaskNameInAlerts: true });
  const ack = queueCodexCompletion(f);
  f.send('pet:codex-motion-ready', ack);
  assert.equal(f.bubble.shows.at(-1).text, '《测试任务》有结果啦\n去看看？');
  assert.equal(f.call("menuTemplate().find(item => item.id === 'codex-task-names').checked"), true);
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
  const menu = f.call('menuTemplate()');
  assert.equal(menu.find(item => item.id === 'codex-enabled').checked, false);
  assert.equal(menu.some(item => item.id === 'codex-status'), false);
  const warning = menu.find(item => item.id === 'codex-preference-warning');
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
  assert.equal(menu.find(item => item.id === 'codex-enabled').checked, false);
  const warning = menu.find(item => item.id === 'codex-preference-warning');
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
  const item = f.call("menuTemplate().find(item => item.id === 'codex-status').submenu.find(item => item.id === 'codex-tasks').submenu[0]");
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
  assert.equal(f.call("menuTemplate().some(item => item.id === 'codex-status')"), true);
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
