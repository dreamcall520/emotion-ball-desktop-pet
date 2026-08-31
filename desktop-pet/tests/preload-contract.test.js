const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Codex 预加载只发送最小状态与受控动作确认', () => {
  let desktop;
  const messages = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, api) { desktop = api; } },
      ipcRenderer: { send: (...args) => messages.push(args) } })
  });
  assert.equal(typeof desktop.codexMotionReady, 'function');
  assert.equal(typeof desktop.codexAvailability, 'function');
  desktop.codexMotionReady({ token: 4, action: 'hop', alertId: 2, generation: 1, pageEpoch: 3, secret: 'no' });
  desktop.codexMotionReady({ token: 4, action: '__proto__', alertId: 2, generation: 1 });
  desktop.codexAvailability({ generation: 1, pageEpoch: 3, available: true, secret: 'no' });
  desktop.codexAvailability({ generation: 1, available: 'true' });
  assert.equal(JSON.stringify(messages), JSON.stringify([
    ['pet:codex-motion-ready', { token: 4, action: 'hop', alertId: 2, generation: 1, pageEpoch: 3 }],
    ['pet:codex-availability', { generation: 1, pageEpoch: 3, available: true }]
  ]));
});

test('气泡只允许当前普通或 Codex 固定按钮动作', () => {
  let api;
  const messages = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../bubble-preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { send: (...args) => messages.push(args) } })
  });
  for (const action of ['again', 'rest', 'codex-open', 'codex-results', 'codex-list', 'codex-dismiss', 'shell', 'https://invalid']) api.reply(1, action);
  assert.equal(messages.length, 5);
  assert.deepEqual(messages.map(item => item[1].action), ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss']);
});

test('气泡同ID先更新文字，动作不变时保留按钮、变化时才重建', () => {
  let receive;
  const replies = [];
  const bubble = { dataset: {}, style: { setProperty() {} } };
  const message = {};
  const actions = { children: [], replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../bubble-renderer.js'), 'utf8'), {
    document: { getElementById: id => ({ bubble, message, actions })[id], createElement: () => ({ dataset: {}, addEventListener(_name, callback) { this.click = callback; } }) },
    window: { addEventListener() {}, petBubble: { onMessage(callback) { receive = callback; }, reply: (...args) => replies.push(args) } }
  });
  const payload = { id: 4, text: '<b>这轮有结果啦</b>', tone: 'strong', actions: [{ id: 'codex-open', label: '去看看' }, { id: 'codex-dismiss', label: '知道啦' }], anchorX: 30 };
  receive(payload);
  assert.equal(message.textContent, payload.text);
  assert.equal(bubble.dataset.tone, 'strong');
  assert.equal(actions.children.length, 2);
  const button = actions.children[0];
  receive({ ...payload, text: '已显示任务名称', tone: 'javascript:bad', anchorX: 40 });
  assert.equal(message.textContent, '已显示任务名称');
  assert.equal(bubble.dataset.tone, 'normal');
  assert.equal(actions.children[0], button);
  receive({ ...payload, text: '动作已变', actions: [{ id: 'codex-results', label: '查看结果' }, { id: 'codex-dismiss', label: '知道啦' }] });
  assert.equal(message.textContent, '动作已变');
  assert.notEqual(actions.children[0], button);
  assert.deepEqual(actions.children.map(item => item.dataset.action), ['codex-results', 'codex-dismiss']);
  button.click();
  assert.deepEqual(replies, [[4, 'codex-open']]);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../bubble-renderer.js'), 'utf8'), /innerHTML/);
});

test('气泡自适应高度必须在主进程回传尺寸后收敛，不能持续拉高闪烁', () => {
  let receive;
  let windowHeight = 118;
  let frameId = 0;
  const frames = [];
  const requestedHeights = [];
  const bubble = {
    dataset: {},
    style: { bottom: '', height: '', setProperty() {} },
    // 真实页面的箭头会让 scrollHeight 比可见卡片多出几像素；旧算法因此每轮继续增长。
    get scrollHeight() { return windowHeight - 17; },
    getBoundingClientRect() {
      return { height: this.style.bottom === 'auto' && this.style.height === 'max-content'
        ? 96 : windowHeight - 22 };
    }
  };
  const message = {};
  const actions = {
    children: [], replaceChildren() { this.children = []; },
    appendChild(node) { this.children.push(node); }
  };
  const payload = { id: 9, text: '我有一点点厉害。', tone: 'normal',
    actions: [{ id: 'again', label: '再来一次' }, { id: 'rest', label: '你歇会儿' }], anchorX: 112 };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../bubble-renderer.js'), 'utf8'), {
    document: {
      getElementById: id => ({ bubble, message, actions })[id],
      createElement: () => ({ dataset: {}, addEventListener() {} })
    },
    requestAnimationFrame(callback) { frames.push(callback); return ++frameId; },
    cancelAnimationFrame() {},
    window: {
      addEventListener() {},
      petBubble: {
        onMessage(callback) { receive = callback; return () => {}; },
        reply() {},
        resize(_id, height) {
          requestedHeights.push(height);
          if (height === windowHeight) return;
          windowHeight = height;
          receive(payload);
        }
      }
    }
  });

  receive(payload);
  for (let index = 0; index < 6 && frames.length; index++) frames.shift()();
  assert.deepEqual(requestedHeights, [118]);
  assert.equal(windowHeight, 118);
});

test('强额度提醒只强化气泡边框和文字，不闪烁不改球球颜色', () => {
  const bubbleCss = fs.readFileSync(path.resolve(__dirname, '../bubble.css'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname, '../renderer.js'), 'utf8');
  assert.match(bubbleCss, /data-tone="strong"/);
  assert.match(bubbleCss, /data-tone="urgent"/);
  assert.doesNotMatch(bubbleCss, /animation\s*:/);
  assert.match(renderer, /#EEEBE4/i);
});

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
