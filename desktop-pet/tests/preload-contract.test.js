const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('预加载动作接口仅发送白名单字段且回帧可取消订阅', () => {
  let desktop;
  const messages = [];
  const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, api) { desktop = api; } },
      ipcRenderer: { send: (...args) => messages.push(args), on: (name, callback) => listeners.set(name, callback),
        removeListener: name => listeners.delete(name) } })
  });
  assert.equal(typeof desktop.playMotion, 'function');
  desktop.playMotion({ token: 3, action: 'hop', unexpected: 'ignored' });
  desktop.playMotion({ token: 0, action: 'hop' });
  desktop.playMotion({ token: 4, action: '__proto__' });
  desktop.say({ event: 'play', motion: 'bow', unexpected: 'ignored' });
  desktop.say({ event: 'sleep', motion: 'bow' });
  assert.equal(JSON.stringify(messages), JSON.stringify([
    ['pet:motion-start', { token: 3, action: 'hop' }], ['pet:say', { event: 'play', motion: 'bow' }]
  ]));
  let frame;
  const remove = desktop.onMotion(packet => { frame = packet; });
  listeners.get('pet:motion-frame')({}, { token: 3 });
  assert.equal(frame.token, 3);
  remove();
  assert.equal(listeners.has('pet:motion-frame'), false);
});

test('预加载层只暴露设计内的桌宠接口', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8');
  for (const name of ['beginDrag', 'dragTo', 'endDrag', 'bounce', 'showContextMenu', 'onCommand']) {
    assert.match(text, new RegExp(name));
  }
  assert.doesNotMatch(text, /nodeIntegration\s*:\s*true/);
});

test('桌宠弹跳交给原生窗口执行，避免 SVG 越界裁切', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../renderer.js'), 'utf8');
  assert.match(text, /ball\.bounce\s*=\s*\(\)\s*=>/);
  assert.match(text, /desktop\.bounce\(\)/);
});

test('桌宠窗口启用隔离并以非激活方式首次展示', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.match(text, /contextIsolation:\s*true/);
  assert.match(text, /nodeIntegration:\s*false/);
  assert.match(text, /sandbox:\s*true/);
  assert.match(text, /closable:\s*true/);
  assert.match(text, /showInactive\(\)/);
  assert.match(text, /setActivationPolicy\('accessory'\)/);
  assert.match(text, /getLoginItemSettings\(\)\.openAtLogin/);
});

test('桌宠阴影在浅色背景下保持轻量', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../pet.css'), 'utf8');
  const match = css.match(
    /drop-shadow\(0\s+(\d+)px\s+(\d+)px\s+rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)\)/
  );
  assert.ok(match, '需要保留一层轻量阴影');
  assert.ok(Number(match[2]) <= 6, '阴影模糊范围不能超过 6px');
  assert.ok(Number(match[3]) <= 0.1, '阴影透明度不能超过 10%');
});
