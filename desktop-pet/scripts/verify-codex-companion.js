const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

function assertBubbleLayout(layout) {
  assert.equal(layout.font, '14px', 'Codex 气泡不能随球球缩小字体');
  assert.ok(layout.lineCount >= 1 && layout.lineCount <= 2, 'Codex 文案应不超过两行');
  assert.equal(layout.fits, true, 'Codex 文字和按钮不能超出气泡');
  assert.ok(layout.buttons.length >= 1 && layout.buttons.length <= 2, 'Codex 气泡仅有受控按钮');
}

function policyClock() {
  let time = Date.now();
  let serial = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule(callback, delay) { timers.set(++serial, { at: time + delay, callback }); return serial; },
    cancel(id) { timers.delete(id); },
    advanceBy(delay) {
      const target = time + delay;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        timers.delete(next[0]); time = next[1].at; next[1].callback();
      }
      time = target;
    }
  };
}

// 仅显式冒烟时使用模拟连接与策略时钟；不读取真实 Codex，不创建或操作真实任务。
// 页面、预加载、IPC、对白和窗口动作均为实际应用代码。
async function verifyCodexCompanion({ pet, bubble, monitor, screen, BrowserWindow, command, setSetting, setSize,
  getMenu, getSettings, prepare, setEnabled, getController, canPresent, getMotionOwner, clearDialogue }) {
  if (process.env.PET_SMOKE_TEST !== '1') throw new Error('Codex 验收只允许在显式冒烟模式运行');
  const original = { bounds: pet.getBounds(), settings: { ...getSettings() } };
  assert.equal(original.settings.codexEnabled, false, '冒烟初始设置必须默认关闭');
  const initialMenu = getMenu();
  assert.equal(initialMenu.getMenuItemById('codex-enabled').checked, false);
  assert.equal(initialMenu.getMenuItemById('codex-task-names').checked, false);
  assert.equal(initialMenu.getMenuItemById('codex-task-names').enabled, false,
    'Codex 总开关关闭时任务名称开关必须禁用');
  assert.equal(initialMenu.getMenuItemById('codex-status'), null);
  assert.equal(initialMenu.getMenuItemById('codex-recent'), null, '原生菜单不能保留最近提醒');
  monitor.stop();
  const clock = policyClock();
  const connections = [];
  let callbacks;
  let sequence = 0;
  const resetAt = clock.now() + 86400000;
  const quota = remaining => callbacks.onQuota({ windows: [{ id: 'fixture:primary', label: '测试额度',
    windowMinutes: 300, remaining, resetsAt: resetAt }], updatedAt: clock.now() });
  prepare({ now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    createConnection(next) {
      callbacks = next;
      const connection = { closed: false, async start() {
        next.onAccount({ accountKey: 'native-smoke-fixture-only' });
        next.onStatus({ channel: 'quota', state: 'connected' });
        next.onStatus({ channel: 'tasks', state: 'connected' });
        quota(92);
      }, async refresh() {}, async retry() {}, close() { this.closed = true; } };
      connections.push(connection);
      return connection;
    }
  });
  assert.equal(connections.length, 0, '准备关闭态不能创建连接');
  const page = code => pet.webContents.executeJavaScript(code);
  const state = () => page('({...document.getElementById("pet").dataset})');
  const poll = async (read, predicate, label, timeout = 3500) => {
    const deadline = performance.now() + timeout;
    let value;
    do {
      value = await read();
      if (predicate(value)) return value;
      await wait(25);
    } while (performance.now() < deadline);
    assert.fail(`${label}超时：${JSON.stringify(value)}`);
  };
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR ? path.resolve(process.env.PET_SMOKE_ARTIFACT_DIR) : null;
  const results = [];
  const capture = async (win, name) => {
    if (!artifacts) return;
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  const sample = async () => {
    const bounds = pet.getBounds();
    pet.webContents.send('pet:activity', { idleSeconds: 0, locked: false, sameDisplay: true,
      cursor: { x: area.x + area.width - 100, y: area.y + 100 }, petBounds: bounds });
    await wait(80);
  };
  const ready = async () => {
    command('rest');
    clearDialogue();
    await sample();
    await page('document.getElementById("pet").dispatchEvent(new PointerEvent("pointerleave")); true');
    await poll(() => Promise.resolve(canPresent()), Boolean, 'Codex 可展示状态');
  };
  const input = async (win, type, x, y, count = 1) => {
    const debuggerApi = win.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0, clickCount: count });
  };
  const emitTask = (kind, count = 1, title = null) => {
    for (let index = 0; index < count; index++) {
      const serial = String(++sequence).padStart(12, '0');
      const task = { id: `11111111-1111-4111-8111-${serial}`, title: title || `模拟验收任务 ${sequence}`,
        turnId: `fixture-turn-${sequence}`, updatedAt: clock.now() };
      callbacks.onTask({ ...task, state: kind === 'active' ? 'idle' : 'active', baseline: true });
      callbacks.onTask({ ...task, state: kind });
    }
  };
  const begin = async (kind, count = 1, title = null) => {
    clock.advanceBy(31000);
    await ready();
    await page('window.__codexNativeFrames = []; true');
    if (kind === 'quota') quota(10); else emitTask(kind, count, title);
    clock.advanceBy(5000);
    await poll(state, value => value.motionOwner === 'codex', '真实 Codex 动作确认');
  };

  try {
    setSetting('keepAwake', true);
    setSetting('bubblesEnabled', true);
    command('wake');
    await setEnabled(true);
    assert.equal(connections.length, 1);
    assert.equal(getMenu().getMenuItemById('codex-enabled').checked, true);
    assert.ok(getMenu().getMenuItemById('codex-tasks'));
    assert.equal(getMenu().getMenuItemById('codex-task-names').enabled, true);
    assert.equal(getMenu().getMenuItemById('codex-task-names').checked, false);
    assert.equal(getMenu().getMenuItemById('codex-recent'), null, '开启后也不能出现最近提醒');
    await page('window.__codexNativeFrames = []; window.__removeCodexNativeTrace = window.petDesktop.onMotion(packet => window.__codexNativeFrames.push(packet)); true');
    const focusBefore = BrowserWindow.getFocusedWindow();
    for (const [size, pixels, kind] of [['tiny', 80, 'completed'], ['small', 120, 'quota'], ['medium', 180, 'waiting'], ['large', 260, 'failed']]) {
      setSize(size);
      pet.setBounds({ x: area.x + 240, y: area.y + 240, width: pixels, height: pixels });
      await wait(120);
      await begin(kind, kind === 'waiting' ? 2 : 1);
      const win = await poll(() => Promise.resolve(bubble.getWindow()), value => value?.isVisible(), 'Codex 气泡显示');
      const layout = await win.webContents.executeJavaScript(`(() => {
        const message = document.getElementById('message');
        const card = document.getElementById('bubble').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('button')];
        const range = document.createRange(); range.selectNodeContents(message);
        const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
        const fits = rect => rect.left >= card.left && rect.right <= card.right && rect.top >= card.top && rect.bottom <= card.bottom;
        const dismiss = buttons.find(button => button.dataset.action === 'codex-dismiss').getBoundingClientRect();
        return { text:message.textContent, font:getComputedStyle(message).fontSize,
          lineCount:new Set(rects.map(rect => Math.round(rect.top))).size,
          fits:rects.every(fits) && buttons.every(button => fits(button.getBoundingClientRect())),
          buttons:buttons.map(button => button.textContent), point:{x:dismiss.x+dismiss.width/2,y:dismiss.y+dismiss.height/2} };
      })()`);
      assertBubbleLayout(layout);
      assert.equal(win.isFocusable(), false);
      assert.equal(BrowserWindow.getFocusedWindow(), focusBefore, '自动 Codex 提醒不能抢焦点');
      assert.equal(pet.getBounds().width, pixels);
      await capture(win, `codex-bubble-${pixels}`);
      await capture(pet, `codex-pet-${pixels}`);
      const packets = await poll(() => page('window.__codexNativeFrames'), value => value.some(packet => packet.frame.done), 'Codex 动作完整结束');
      const expected = { completed: 'hop', quota: 'bow', waiting: 'peek', failed: 'jelly' }[kind];
      assert.ok(packets.length > 5 && packets.every(packet => packet.action === expected));
      const alertId = getController().getSnapshot().currentAlert.id;
      await input(win, 'mouseMoved', layout.point.x, layout.point.y);
      await input(win, 'mousePressed', layout.point.x, layout.point.y);
      await input(win, 'mouseReleased', layout.point.x, layout.point.y);
      await poll(() => Promise.resolve(getController().getSnapshot().currentAlert), value => value === null, 'Codex 按钮真实 IPC 回应');
      assert.equal(win.isVisible(), false);
      results.push({ size: pixels, kind, alertId, layout, frameCount: packets.length, source: 'simulated-connection-real-ui' });
      process.stdout.write(`PET_CODEX_SIZE_${pixels}_OK\n`);
    }

    await begin('active');
    assert.equal(bubble.getWindow()?.isVisible(), false, '处理中只轻动作，不弹气泡');
    const nativeMenu = getMenu();
    const taskItems = nativeMenu.getMenuItemById('codex-tasks').submenu.items;
    const taskLabels = taskItems.map(item => item.label);
    assert.deepEqual(taskLabels, [
      '模拟验收任务 2 · 等你确认',
      '模拟验收任务 3 · 等你确认',
      '模拟验收任务 5 · 处理中'
    ], '真实菜单只应列出处理中与等你确认');
    assert.equal(nativeMenu.getMenuItemById('codex-recent'), null);
    assert.doesNotMatch(taskLabels.join('\n'), /模拟验收任务 1|模拟验收任务 4|完成|失败|最近提醒/);
    process.stdout.write('PET_CODEX_TASK_MENU_OK\n');
    await setEnabled(false);
    await poll(state, value => value.motionOwner === 'none', '关闭清理 Codex 动作');
    assert.equal(getMotionOwner(), null);
    assert.ok(!getMenu().getMenuItemById('codex-status'));
    assert.equal(getMenu().getMenuItemById('codex-task-names').enabled, false);

    await setEnabled(true);
    await begin('completed', 1, '  原生\n验收\u202e任务  ');
    const titleWindow = await poll(() => Promise.resolve(bubble.getWindow()), value => value?.isVisible(), '名称气泡显示');
    const bubbleText = () => titleWindow.webContents.executeJavaScript("document.getElementById('message').textContent");
    assert.equal(await bubbleText(), '这轮有结果啦，去看看？', '名称开关默认关闭时必须显示通用文案');
    const beforeToggle = getController().getSnapshot().currentAlert;
    const motionBeforeToggle = { ...getMotionOwner() };
    let titleItem = getMenu().getMenuItemById('codex-task-names');
    assert.equal(titleItem.checked, false);
    // Electron 的原生 checkbox click 会先反转 checked，再调用业务 click。
    titleItem.checked = false;
    titleItem.click({}, pet, pet.webContents);
    assert.equal(getSettings().codexTaskNameInAlerts, true, '真实菜单 click 必须开启任务名称设置');
    await poll(bubbleText, text => text === '《原生 验收 任务》有结果啦\n去看看？', '真实菜单开启任务名称');
    const namedAlert = getController().getSnapshot().currentAlert;
    assert.equal(namedAlert.id, beforeToggle.id, '名称开关不能替换当前气泡');
    assert.equal(namedAlert.expiresAt, beforeToggle.expiresAt, '名称开关不能延长提醒时限');
    assert.deepEqual(getMotionOwner(), motionBeforeToggle, '名称开关不能增加或重播身体动作');
    assert.equal(bubble.getWindow(), titleWindow, '名称开关必须原位更新同一个气泡窗口');
    assert.equal(getMenu().getMenuItemById('codex-task-names').checked, true);
    titleItem = getMenu().getMenuItemById('codex-task-names');
    titleItem.checked = true;
    titleItem.click({}, pet, pet.webContents);
    assert.equal(getSettings().codexTaskNameInAlerts, false, '真实菜单 click 必须关闭任务名称设置');
    await poll(bubbleText, text => text === '这轮有结果啦，去看看？', '真实菜单关闭任务名称');
    const genericAlert = getController().getSnapshot().currentAlert;
    assert.equal(genericAlert.id, beforeToggle.id);
    assert.equal(genericAlert.expiresAt, beforeToggle.expiresAt);
    assert.deepEqual(getMotionOwner(), motionBeforeToggle);
    assert.equal(getMenu().getMenuItemById('codex-task-names').checked, false);
    process.stdout.write('PET_CODEX_TASK_TITLE_OK\n');
    const center = pet.getBounds().width / 2;
    for (const count of [1, 2]) {
      await input(pet, 'mousePressed', center, center, count);
      await input(pet, 'mouseReleased', center, center, count);
      if (count === 1) await wait(35);
    }
    await poll(state, value => value.motionOwner === 'user', '用户双击优先于 Codex');
    await setEnabled(false);
    await wait(150);
    assert.equal((await state()).motionOwner, 'user', '关闭联动不能停止用户新动作');
    assert.equal(getMotionOwner()?.owner, 'user');
    const normal = bubble.getWindow();
    assert.ok(normal?.isVisible(), '用户普通气泡应保留');
    assert.ok(await normal.webContents.executeJavaScript('Boolean(document.querySelector("[data-action=again]"))'));
    assert.equal(BrowserWindow.getFocusedWindow(), focusBefore);
    assert.ok(connections.every(connection => connection.closed), '所有模拟连接应已关闭');
    process.stdout.write('PET_CODEX_SIMULATED_OK\n');
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'codex-native-results.json'), JSON.stringify(results, null, 2));
  } finally {
    await setEnabled(false);
    command('rest'); clearDialogue();
    await page('window.__removeCodexNativeTrace?.(); delete window.__removeCodexNativeTrace; delete window.__codexNativeFrames; true');
    setSetting('keepAwake', original.settings.keepAwake);
    setSetting('bubblesEnabled', original.settings.bubblesEnabled);
    setSize(original.settings.size);
    pet.setBounds(original.bounds);
    if (pet.webContents.debugger.isAttached()) pet.webContents.debugger.detach();
    const win = bubble.getWindow();
    if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    prepare();
  }
}

module.exports = { verifyCodexCompanion, assertBubbleLayout };
