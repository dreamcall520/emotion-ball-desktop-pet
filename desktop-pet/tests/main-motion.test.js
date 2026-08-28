const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');

// 真实 main、动作控制器和对白规则；只替代 Electron、系统采样和磁盘设置。
async function fixture() {
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const windows = [];
  const saved = [];
  const commands = [];
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
    setTimeout(callback, delay) { timers.set(++serial, { callback, at: now + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'electron') return { app, ipcMain, powerMonitor, screen, BrowserWindow: NativeWindow, Tray,
        Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) } };
      if (name === './lib/settings') return { loadSettings: () => ({ size: 'tiny', x: -600, y: 100, bubblesEnabled: true }),
        saveSettings: (_file, settings) => { saved.push({ ...settings }); return settings; } };
      if (name === './lib/bubble-window') return { createBubbleWindow: () => bubble };
      if (name === './lib/activity-monitor') return { ...realRequire(name), createActivityMonitor: () => ({ start() {}, stop() {}, pause() {}, resume() {} }) };
      return realRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8'), context);
  await flush();
  const pet = windows[0];
  pet.emit('ready-to-show');
  return { pet, bubble, commands, saved, screen, powerMonitor, app, timers,
    call: expression => vm.runInContext(expression, context),
    send(channel, packet, sender = pet.webContents) { ipcMain.emit(channel, { sender }, packet); },
    at(time) { now = time; const queue = [...timers.values()]; timers.clear(); queue.forEach(item => item.callback()); }
  };
}

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
