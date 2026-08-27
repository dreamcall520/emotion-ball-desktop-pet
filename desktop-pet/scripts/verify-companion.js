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
  monitor.stop();
  pet.setBounds({ x: area.x + 240, y: area.y + 240, width: 80, height: 80 });
  await wait(150);
  let packet = {
    idleSeconds: 0, locked: false, sameDisplay: true,
    cursor: { x: area.x + 420, y: area.y + 280 }, petBounds: pet.getBounds()
  };
  const sample = async patch => {
    packet = { ...packet, ...patch, petBounds: pet.getBounds() };
    pet.webContents.send('pet:activity', packet);
    await wait(90);
    return state();
  };
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR;
  async function capture(win, name) {
    if (!artifacts) return;
    fs.mkdirSync(path.resolve(artifacts), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(artifacts), `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  for (const [seconds, mode] of [[301, 'spacing'], [601, 'tired'], [901, 'sleep']]) {
    assert.equal((await sample({ idleSeconds: seconds })).mode, mode);
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
  for (let count = 0; count < 5; count++) {
    await sample({ idleSeconds: 0 });
    await wait(900);
  }
  assert.equal((await sample({ idleSeconds: 0 })).mode, 'focus');
  assert.equal((await state()).emotion, '16');
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

  const input = (type, x, y, extra = {}) => {
    const bounds = pet.getBounds();
    pet.webContents.sendInputEvent({ type, x, y, globalX: bounds.x + x, globalY: bounds.y + y, ...extra });
  };
  for (let index = 0; index < 10; index++) {
    input('mouseMove', index % 2 ? 48 : 28, 25);
    await wait(100);
  }
  assert.equal((await state()).lastAction, 'pet', '连续摸头应触发舒服表情');
  await capture(pet, 'petting-80');
  await page(`window.__dragTrace = []; for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) {
    document.getElementById('pet').addEventListener(type, e => window.__dragTrace.push({type, x:e.screenX, y:e.screenY, buttons:e.buttons}));
  } true`);
  input('mouseDown', 40, 40, { button: 'left', clickCount: 1 });
  await wait(50);
  input('mouseMove', 60, 40, { modifiers: ['leftButtonDown'] });
  await wait(150);
  input('mouseUp', 60, 40, { button: 'left', clickCount: 1 });
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
    bubbleWin.webContents.sendInputEvent({ type, ...content.point, button: 'left', clickCount: 1 });
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
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    bubbleWin.webContents.sendInputEvent({ type, ...againPoint, button: 'left', clickCount: 1 });
    await wait(60);
  }
  await wait(120);
  assert.ok(['bounce', 'spin', 'happy'].includes((await state()).lastAction), '再来一次按钮应触发新的玩耍动作');
  assert.equal(bubbleWin.isVisible(), false);
  command('rest');
  await wait(150);
  process.stdout.write('PET_BUBBLE_REPLY_OK\n');

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
  process.stdout.write('PET_NATIVE_ACTIVITY_OK\n');
}

module.exports = { verifyCompanion };
