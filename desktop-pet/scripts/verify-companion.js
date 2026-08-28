const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

// 仅在显式冒烟模式调用；通过真实 IPC、渲染页面和原生输入验收。
async function verifyCompanion({ pet, bubble, monitor, screen, BrowserWindow, command, setSetting, showDialogue }) {
  const page = code => pet.webContents.executeJavaScript(code);
  const state = () => page('({...document.getElementById("pet").dataset})');
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  const original = pet.getBounds();
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR;
  const hostTrace = [];
  const observeHost = (type, detail) => {
    if (hostTrace.length < 100) hostTrace.push({ type, at: performance.now(), detail,
      cursor: screen.getCursorScreenPoint(), petBounds: pet.getBounds() });
  };
  const applySetting = setSetting;
  setSetting = (name, value) => { observeHost('setting-request', { name, value }); applySetting(name, value); };
  observeHost('start', {});
  await page(`window.__companionFailureTrace = {events:[],received:[],errors:[]};
    window.__companionDiagnosticCleanup = [];
    for (const type of ['pointerenter','pointerleave','pointermove']) {
      const listener = event => {
        const pet = document.getElementById('pet'); const rect = pet.getBoundingClientRect();
        if (window.__companionFailureTrace.events.length < 200) window.__companionFailureTrace.events.push({
          type,at:performance.now(),x:event.clientX,y:event.clientY,buttons:event.buttons,trusted:event.isTrusted,
          onPet:pet.contains(event.target),target:event.target.tagName,
          rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},state:{...pet.dataset}
        });
      };
      window.addEventListener(type,listener,true);
      window.__companionDiagnosticCleanup.push(() => window.removeEventListener(type,listener,true));
    }
    const record = (type,packet) => {
      if (window.__companionFailureTrace.received.length < 160) window.__companionFailureTrace.received.push({
        type,at:performance.now(),packet,state:{...document.getElementById('pet').dataset}
      });
    };
    window.__companionDiagnosticCleanup.push(window.petDesktop.onActivity(packet => record('activity', packet)));
    window.__companionDiagnosticCleanup.push(window.petDesktop.onSettings(packet => record('settings', packet)));
    window.__companionDiagnosticCleanup.push(window.petDesktop.onCommand(packet => record('command', packet)));
    const errorListener = event => window.__companionFailureTrace.errors.push({at:performance.now(),message:event.message});
    window.addEventListener('error',errorListener);
    window.__companionDiagnosticCleanup.push(() => window.removeEventListener('error',errorListener)); true`);
  try {
  monitor.stop();
  pet.setBounds({ x: area.x + 240, y: area.y + 240, width: 80, height: 80 });
  await wait(150);
  let packet = {
    idleSeconds: 0, locked: false, sameDisplay: true,
    cursor: { x: area.x + 420, y: area.y + 280 }, petBounds: pet.getBounds()
  };
  const sample = async patch => {
    packet = { ...packet, ...patch, petBounds: pet.getBounds() };
    observeHost('activity-request', packet);
    pet.webContents.send('pet:activity', packet);
    await wait(90);
    return state();
  };
  async function capture(win, name) {
    if (!artifacts) return;
    fs.mkdirSync(path.resolve(artifacts), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(artifacts), `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  async function assertFixedColor() {
    const colors = await page(`({
      body: document.querySelectorAll('radialGradient stop')[1].getAttribute('stop-color'),
      eyes: [...document.querySelectorAll('.eb-eye')].map(eye => eye.getAttribute('fill'))
    })`);
    assert.equal(colors.body.toUpperCase(), '#EEEBE4', '实际球体必须保持睡眠灰白');
    assert.deepEqual(colors.eyes.map(color => color.toUpperCase()), ['#1A1A1A', '#1A1A1A']);
  }
  await assertFixedColor();
  for (const [seconds, mode] of [[301, 'spacing'], [601, 'tired'], [901, 'sleep']]) {
    assert.equal((await sample({ idleSeconds: seconds })).mode, mode);
    await assertFixedColor();
  }
  setSetting('keepAwake', true);
  assert.equal((await sample({ idleSeconds: 901 })).mode, 'awake');
  setSetting('keepAwake', false);
  assert.equal((await sample({ idleSeconds: 901 })).mode, 'sleep');
  assert.equal((await sample({ idleSeconds: 0 })).mode, 'awake');
  await wait(2400);
  assert.notEqual((await state()).emotion, '00');
  command('sleep');
  assert.equal((await sample({ idleSeconds: 0 })).mode, 'manual-sleep');
  assert.equal((await state()).emotion, '00');
  command('wake');
  await wait(2400);
  await page(`window.__focusTrace = []; window.petDesktop.onActivity(p => {
    window.__focusTrace.push({at:performance.now(), idle:p.idleSeconds, locked:p.locked, mode:document.getElementById('pet').dataset.mode});
  }); document.getElementById('pet').addEventListener('pointerenter',()=>window.__focusTrace.push({at:performance.now(),event:'pointerenter'})); true`);
  // 真实鼠标偶尔进入测试窗口会重新计时，等待实际状态而不是卡固定帧。
  const focusDeadline = performance.now() + 8000;
  let focused;
  do {
    focused = await sample({ idleSeconds: 0 });
    if (focused.mode === 'focus') break;
    await wait(160);
  } while (performance.now() < focusDeadline);
  assert.equal(focused.mode, 'focus', JSON.stringify(await page('window.__focusTrace')));
  assert.equal((await state()).emotion, '16');
  await assertFixedColor();
  await capture(pet, 'focus-80');
  process.stdout.write('PET_ACTIVITY_STATES_OK\n');

  const eyesX = () => page('[...document.querySelectorAll(".eb-eye")].map(el=>el.getBoundingClientRect().x).reduce((a,b)=>a+b,0)/2');
  await sample({ cursor: { x: area.x + 10, y: area.y + 280 } });
  await wait(350);
  const leftX = await eyesX();
  await capture(pet, 'gaze-left-80');
  await sample({ cursor: { x: area.x + 650, y: area.y + 280 } });
  await wait(350);
  assert.ok(await eyesX() > leftX + 3, '实际眼睛应随鼠标向右移动');
  await capture(pet, 'gaze-right-80');
  assert.equal((await sample({ sameDisplay: false })).gaze, '0,0');
  await sample({ sameDisplay: true });
  process.stdout.write('PET_GAZE_OK\n');

  // sendInputEvent 要求原生窗口聚焦；CDP 输入不改变生产窗口的非激活属性。
  const inputWindow = async (win, type, x, y, extra = {}) => {
    const debuggerApi = win.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    const pressed = type === 'mouseDown' || extra.modifiers?.includes('leftButtonDown');
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
      type: { mouseDown: 'mousePressed', mouseUp: 'mouseReleased', mouseMove: 'mouseMoved' }[type],
      x, y, button: extra.button || (pressed ? 'left' : 'none'),
      buttons: pressed ? 1 : 0, clickCount: extra.clickCount || 0
    });
  };
  const input = (type, x, y, extra) => inputWindow(pet, type, x, y, extra);
  // 失败时保留实际事件边界，区分未送达、移出重置、坐标和调度间隔；不改变抚摸规则。
  await page(`window.__pettingTrace = {events:[],errors:[]};
    window.__pettingListeners = [];
    for (const type of ['pointerenter','pointerleave','pointermove']) {
      const listener = event => {
        const pet = document.getElementById('pet');
        const rect = pet.getBoundingClientRect();
        if (window.__pettingTrace.events.length < 120) window.__pettingTrace.events.push({
          type,at:performance.now(),x:event.clientX,y:event.clientY,buttons:event.buttons,
          trusted:event.isTrusted,onPet:pet.contains(event.target),target:event.target.tagName,
          rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},state:{...pet.dataset}
        });
      };
      window.addEventListener(type, listener, true);
      window.__pettingListeners.push([type,listener]);
    }
    window.__pettingError = event => window.__pettingTrace.errors.push({at:performance.now(),message:event.message});
    window.addEventListener('error',window.__pettingError); true`);
  for (let index = 0; index < 10; index++) {
    await input('mouseMove', index % 2 ? 48 : 28, 25);
    await wait(100);
  }
  const pettingState = await state();
  const pettingTrace = await page(`(() => {
    for(const [type,listener] of window.__pettingListeners) window.removeEventListener(type,listener,true);
    window.removeEventListener('error',window.__pettingError);
    const result = window.__pettingTrace;
    delete window.__pettingListeners; delete window.__pettingError; delete window.__pettingTrace;
    return result;
  })()`);
  if (pettingState.lastAction !== 'pet' && artifacts) {
    fs.mkdirSync(path.resolve(artifacts), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(artifacts), 'petting-failure.json'), JSON.stringify({ state: pettingState, ...pettingTrace }, null, 2));
  }
  assert.equal(pettingState.lastAction, 'pet', `连续摸头应触发舒服表情：${JSON.stringify({ state: pettingState, ...pettingTrace })}`);
  await assertFixedColor();
  await capture(pet, 'petting-80');
  await page(`window.__dragTrace = []; for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) {
    document.getElementById('pet').addEventListener(type, e => window.__dragTrace.push({type, x:e.screenX, y:e.screenY, buttons:e.buttons}));
  } true`);
  await input('mouseDown', 40, 40, { button: 'left', clickCount: 1 });
  await wait(50);
  await input('mouseMove', 60, 40, { modifiers: ['leftButtonDown'] });
  await wait(150);
  await input('mouseUp', 60, 40, { button: 'left', clickCount: 1 });
  await wait(200);
  assert.equal((await state()).lastAction, 'drop', `拖动后应触发落地反馈：${JSON.stringify(await page('window.__dragTrace'))}`);
  process.stdout.write('PET_TOUCH_DRAG_OK\n');

  // 让真实互动冷却结束，不绕过生产对白节流。
  await wait(6100);
  const focusBefore = BrowserWindow.getFocusedWindow();
  assert.ok(showDialogue('play'));
  await wait(350);
  let bubbleWin = bubble.getWindow();
  assert.ok(bubbleWin?.isVisible());
  assert.equal(bubbleWin.isFocusable(), false);
  assert.equal(pet.isFocusable(), false);
  assert.equal(BrowserWindow.getFocusedWindow(), focusBefore, '气泡不得抢走窗口焦点');
  const content = await bubbleWin.webContents.executeJavaScript(`(() => {
    const text = document.getElementById('message');
    const card = document.getElementById('bubble');
    const cardRect = card.getBoundingClientRect();
    const button = document.querySelector('[data-action="rest"]').getBoundingClientRect();
    return { text:text.textContent, font:getComputedStyle(text).fontSize,
      buttons:[...document.querySelectorAll('button')].map(el=>el.textContent),
      fits:[text,...document.querySelectorAll('button')].every(el=>{
        const rect=el.getBoundingClientRect();
        return rect.left>=cardRect.left && rect.top>=cardRect.top && rect.right<=cardRect.right && rect.bottom<=cardRect.bottom;
      }),
      point:{x:Math.round(button.x+button.width/2),y:Math.round(button.y+button.height/2)} };
  })()`);
  assert.equal(content.font, '14px');
  assert.deepEqual(content.buttons, ['再来一次', '你歇会儿']);
  await capture(bubbleWin, 'bubble-play');
  assert.ok(content.fits, JSON.stringify(content));
  const restY = pet.getBounds().y;
  await page('window.petDesktop.bounce(); true');
  await wait(150);
  assert.ok(pet.getBounds().y < restY);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    await inputWindow(bubbleWin, type, content.point.x, content.point.y, { button: 'left', clickCount: 1 });
    await wait(60);
  }
  await wait(150);
  assert.equal((await state()).lastAction, 'rest', '气泡按钮必须真正发回宠物动作');
  assert.equal(bubbleWin.isVisible(), false);
  assert.equal(pet.getBounds().y, restY, '休息应立即结束原生弹跳并回到原位');
  await wait(6100);
  assert.ok(showDialogue('play'));
  await wait(150);
  const againPoint = await bubbleWin.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-action="again"]').getBoundingClientRect();
    window.__replyTrace = [];
    for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type,e=>window.__replyTrace.push({type,action:e.target.dataset.action,disabled:e.target.disabled}));
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    await inputWindow(bubbleWin, type, againPoint.x, againPoint.y, { button: 'left', clickCount: 1 });
    await wait(60);
  }
  await wait(120);
  assert.ok(['bounce', 'spin', 'happy'].includes((await state()).lastAction), `再来一次按钮应触发新的玩耍动作：${JSON.stringify({pet:await state(),visible:bubbleWin.isVisible(),trace:await bubbleWin.webContents.executeJavaScript('window.__replyTrace')})}`);
  await assertFixedColor();
  await capture(pet, 'happy-80');
  assert.equal(bubbleWin.isVisible(), false);
  command('rest');
  await wait(150);
  assert.equal(BrowserWindow.getFocusedWindow(), focusBefore, '回应按钮不能激活原生窗口');
  process.stdout.write('PET_BUBBLE_REPLY_OK\n');

  await require('./verify-body-motion').verifyBodyMotion({
    pet, bubble, screen, command, setSetting, sample, inputWindow
  });

  let id = 10000;
  for (const [corner, x, y, placement] of [
    ['top-left', area.x + 8, area.y + 8, 'below'],
    ['top-right', area.x + area.width - 88, area.y + 8, 'below'],
    ['bottom-left', area.x + 8, area.y + area.height - 88, 'above'],
    ['bottom-right', area.x + area.width - 88, area.y + area.height - 88, 'above']
  ]) {
    pet.setBounds({ x, y, width: 80, height: 80 });
    bubble.show({ id: ++id, text: '你忙，我陪着。', actions: [], durationMs: 4000 });
    await wait(160);
    const bounds = bubbleWin.getBounds();
    assert.ok(bounds.x >= area.x && bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height, `${corner}气泡不应越界`);
    assert.equal(await bubbleWin.webContents.executeJavaScript('document.getElementById("bubble").dataset.placement'), placement);
    await capture(bubbleWin, `bubble-${corner}`);
  }
  bubble.hide();
  showDialogue('sleep');
  await wait(160);
  setSetting('bubblesEnabled', false);
  assert.equal(bubbleWin.isVisible(), false);
  assert.equal(showDialogue('play'), null);
  setSetting('bubblesEnabled', true);
  process.stdout.write('PET_BUBBLE_EDGES_SETTINGS_OK\n');
  await sample({ locked: true });
  assert.equal((await state()).emotion, '00');
  await page('window.__realActivity = null; window.petDesktop.onActivity(p => { window.__realActivity = p; }); true');
  monitor.start();
  await wait(200);
  const realSample = await page('window.__realActivity');
  assert.ok(realSample && Number.isFinite(realSample.idleSeconds), '实际系统空闲检测必须可用');
  assert.equal(realSample.locked, false);
  monitor.stop();
  pet.setBounds(original);
  pet.webContents.debugger.detach();
  bubbleWin.webContents.debugger.detach();
  process.stdout.write('PET_FIXED_COLOR_OK\n');
  process.stdout.write('PET_NATIVE_ACTIVITY_OK\n');
  } catch (error) {
    const rendererTrace = await page('window.__companionFailureTrace').catch(() => null);
    if (artifacts) {
      fs.mkdirSync(path.resolve(artifacts), { recursive: true });
      const file = path.join(path.resolve(artifacts), 'companion-failure.json');
      fs.writeFileSync(file, JSON.stringify({ host: hostTrace, renderer: rendererTrace }, null, 2));
      process.stdout.write(`PET_COMPANION_FAILURE_DIAGNOSTIC=${file}\n`);
    }
    throw error;
  } finally {
    await page(`window.__companionDiagnosticCleanup?.forEach(remove => remove());
      delete window.__companionDiagnosticCleanup; delete window.__companionFailureTrace; true`).catch(() => {});
  }
}

module.exports = { verifyCompanion };
