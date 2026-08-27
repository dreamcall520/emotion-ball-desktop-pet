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
