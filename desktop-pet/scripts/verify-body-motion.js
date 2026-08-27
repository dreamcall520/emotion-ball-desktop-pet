const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { MOTIONS } = require('../lib/interaction-motion');

// 只在显式冒烟模式使用；不新增生产测试入口，不直接调用动作启动接口。
function contourBounds(d, matrix) {
  const points = [...d.matchAll(/[ML]\s*(-?[\d.]+(?:e[-+]?\d+)?)[,\s]+(-?[\d.]+(?:e[-+]?\d+)?)/gi)];
  if (points.length < 3) throw new Error('球体轮廓点不可用');
  const xs = [], ys = [];
  for (const point of points) {
    const x = Number(point[1]), y = Number(point[2]);
    xs.push(matrix.a * x + matrix.c * y + matrix.e);
    ys.push(matrix.b * x + matrix.d * y + matrix.f);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), pointCount: points.length };
}

function assertVisibleFrame(frame, bounds, area, label) {
  const { contour: c, viewport } = frame;
  assert.ok(c.pointCount >= 3 && [c.minX, c.maxX, c.minY, c.maxY].every(Number.isFinite), `${label}轮廓无效`);
  assert.ok(c.minX >= -0.25 && c.minY >= -0.25 && c.maxX <= viewport.width + 0.25 && c.maxY <= viewport.height + 0.25,
    `${label}身体被裁切：${JSON.stringify(frame)}`);
  assert.equal(frame.bodyColor.toUpperCase(), '#EEEBE4', `${label}身体颜色改变`);
  assert.deepEqual(frame.eyeColors.map(color => color.toUpperCase()), ['#1A1A1A', '#1A1A1A'], `${label}眼睛颜色改变`);
  assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height,
    `${label}窗口越过屏幕工作区：${JSON.stringify({ bounds, area })}`);
}

function randomForMotion(id, previous) {
  const candidates = MOTIONS.filter(motion => motion.id !== previous);
  const index = candidates.findIndex(motion => motion.id === id);
  assert.ok(index >= 0, `${id}不可选：上一动作被排除`);
  const before = candidates.slice(0, index).reduce((sum, motion) => sum + motion.weight, 0);
  const total = candidates.reduce((sum, motion) => sum + motion.weight, 0);
  return (before + candidates[index].weight / 2) / total;
}

function isRestingTransform(transform) {
  const values = (transform || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (values?.length !== 7) return false;
  const [x, y, rotate, sx, sy, cx, cy] = values;
  // 安静陪伴沿用 breathe=0.012：缩放最多1.2%，上下浮动最多0.66个SVG单位。
  return Math.abs(x + cx) <= 0.1 && Math.abs(y + cy) <= 0.8 && Math.abs(rotate) <= 0.1 &&
    Math.abs(sx - 1) <= 0.015 && Math.abs(sy - 1) <= 0.015 && Math.abs(sx - sy) <= 0.01;
}

async function verifyBodyMotion({ pet, bubble, screen, command, setSetting, sample, inputWindow }) {
  const page = async code => {
    const result = await pet.webContents.executeJavaScript(`try { ${code}\n }
      catch (error) { ({__motionReadError:error.stack || error.message}); }`);
    assert.ok(!result?.__motionReadError, `实际页面取帧失败：${result?.__motionReadError}\n${code.slice(0, 180)}`);
    return result;
  };
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR ? path.resolve(process.env.PET_SMOKE_ARTIFACT_DIR) : null;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const recordings = [], results = [];
  let previous = null;
  let lastDirectAt = performance.now();
  const state = () => page('({...document.getElementById("pet").dataset})');
  const input = (type, x, y, extra) => inputWindow(pet, type, x, y, extra);
  const poll = async (read, predicate, label, timeout = 2500) => {
    const deadline = performance.now() + timeout;
    let value;
    do {
      value = await read();
      if (predicate(value)) return value;
      await wait(25);
    } while (performance.now() < deadline);
    assert.fail(`${label}超时：${JSON.stringify(value)}`);
  };
  await page(`window.__contourBounds = ${contourBounds.toString()};
    window.__readBody = () => {
      // 大尺寸旋转会在前景/背景生成渐变彩带；从眼睛所在的身体组定位头部。
      const head = document.querySelector('.eb-eye').parentElement.firstElementChild;
      const m = head.getScreenCTM();
      return { at:performance.now(), viewport:{width:innerWidth,height:innerHeight},
        contour:window.__contourBounds(head.getAttribute('d'), m),
        transform:head.parentElement.getAttribute('transform'),
        bodyColor:document.querySelectorAll('radialGradient stop')[1].getAttribute('stop-color'),
        eyeColors:[...document.querySelectorAll('.eb-eye')].map(eye=>eye.getAttribute('fill')) };
    };
    window.__motionQA = { frames:[], packets:[], collecting:false };
    window.__motionUnsubscribe = window.petDesktop.onMotion(packet => {
      if (window.__motionQA.collecting) window.__motionQA.packets.push({...packet, at:performance.now()});
    });
    window.__motionTick = () => {
      if (window.__motionQA.collecting) window.__motionQA.frames.push(window.__readBody());
      window.__motionRAF = requestAnimationFrame(window.__motionTick);
    };
    window.__motionRAF = requestAnimationFrame(window.__motionTick); true`);

  const resetTrace = () => page('window.__motionQA = {frames:[],packets:[],collecting:true}; true');
  const trace = () => page('({frames:window.__motionQA.frames,packets:window.__motionQA.packets})');
  const startDouble = async id => {
    const value = randomForMotion(id, previous);
    await page(`window.__originalMotionRandom = Math.random; Math.random = () => ${value}; true`);
    try {
      const center = pet.getBounds().width / 2;
      for (const clickCount of [1, 2]) {
        await input('mouseDown', center, center, { button: 'left', clickCount });
        await input('mouseUp', center, center, { button: 'left', clickCount });
        if (clickCount === 1) await wait(35);
      }
      await poll(state, value => value.lastAction === id && value.mode !== 'manual-sleep', `${id}真实双击`);
      previous = id;
      lastDirectAt = performance.now();
    } finally {
      await page('Math.random = window.__originalMotionRandom; delete window.__originalMotionRandom; true');
    }
  };
  const clickReply = async action => {
    const win = bubble.getWindow();
    assert.ok(win?.isVisible(), '动作气泡必须可见');
    const point = await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('[data-action="${action}"]').getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      await inputWindow(win, type, point.x, point.y, { button: 'left', clickCount: 1 });
    }
    await poll(() => Promise.resolve(win.isVisible()), visible => !visible, `${action}气泡收起`);
  };
  const capture = async (recording, started) => {
    if (!recording || !artifacts) return;
    const file = `${recording.action}-${String(recording.frames.length).padStart(3, '0')}.png`;
    const bounds = pet.getBounds();
    const at = Math.round(performance.now() - started);
    const png = (await pet.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(artifacts, file), png);
    recording.frames.push({ file, at, bounds });
  };
  const run = async (id, trigger, { record = false, label = id } = {}) => {
    await resetTrace();
    const anchor = pet.getBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const recording = record && artifacts ? { action: id, anchor: { x: anchor.x, y: anchor.y }, frames: [] } : null;
    const started = performance.now();
    await capture(recording, started);
    await trigger();
    const deadline = started + 5000;
    const nativeFrames = [];
    let packets = [];
    do {
      const frame = await page('window.__readBody()');
      const bounds = pet.getBounds();
      assertVisibleFrame(frame, bounds, area, label);
      nativeFrames.push({ at: Math.round(performance.now() - started), bounds });
      await capture(recording, started);
      packets = await page('window.__motionQA.packets');
      if (packets.some(packet => packet.action === id && packet.frame.done)) break;
      await wait(recording ? 45 : 25);
    } while (performance.now() < deadline);
    assert.ok(packets.some(packet => packet.action === id && packet.frame.done), `${label}未完整结束`);
    const settled = await poll(() => page('window.__readBody()'), frame => isRestingTransform(frame.transform), `${label}身体恢复轻微呼吸`, 2000);
    await wait(45);
    await capture(recording, started);
    const evidence = await trace();
    await page('window.__motionQA.collecting = false; true');
    results.push({ label, action: id, anchor, workArea: area, renderedFrames: evidence.frames.length, packets, nativeFrames, frames: evidence.frames, firstTransform: evidence.frames[0]?.transform, settledTransform: settled.transform });
    if (recording) {
      recordings.push(recording);
      fs.writeFileSync(path.join(artifacts, 'motion-frames.json'), JSON.stringify(recordings, null, 2));
    }
    assert.ok(evidence.frames.length >= 7, `${label}真实逐帧不足`);
    for (const frame of evidence.frames) assertVisibleFrame(frame, anchor, area, label);
    assert.ok(new Set(evidence.frames.map(frame => frame.transform)).size > 5, `${label}身体没有实际连续变形`);
    assert.deepEqual(pet.getBounds(), anchor, `${label}结束未归位`);
    const tokens = [...new Set(packets.map(packet => packet.token))];
    assert.equal(tokens.length, 1, `${label}发生混合动作`);
    assert.ok(packets.every(packet => packet.action === id), `${label}动作错配`);
    const motion = MOTIONS.find(motion => motion.id === id);
    assert.ok(packets.at(-1).at - packets[0].at >= motion.durationMs - 100, `${label}重播或动作被提前截断`);
    assert.deepEqual(packets.at(-1).frame, { body: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0 }, window: { x: 0, y: 0 }, gaze: { x: 0, y: 0 }, done: true }, `${label}结束包必须精确中性`);
    assert.ok(isRestingTransform(evidence.frames.at(-1).transform), `${label}结束身体残留动作：${JSON.stringify({ first: evidence.frames[0].transform, last: evidence.frames.at(-1).transform })}`);
    if (recording) {
      assert.ok(recording.frames.length >= 7, `${label}截图不足`);
    }
    return tokens[0];
  };
  const place = async (area, size, x, y) => {
    command('rest');
    await wait(80);
    pet.setBounds({ x, y, width: size, height: size });
    await poll(() => page('({width:innerWidth,height:innerHeight})'), value => value.width === size && value.height === size, '窗口尺寸');
    await sample({ idleSeconds: 0, locked: false, sameDisplay: true, cursor: { x: area.x + area.width / 2, y: area.y + area.height / 2 } });
    await wait(60);
  };
  const cooldown = async () => {
    const remaining = lastDirectAt + 6100 - performance.now();
    if (remaining > 0) await wait(remaining);
  };
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  await place(area, 80, area.x + Math.round(area.width / 2), area.y + Math.round(area.height / 2));
  const phrases = {
    hop: ['看我蹦两下！', '快乐，起飞！'], jelly: ['我是软乎乎的！', '晃一晃，烦恼散掉。'],
    sway: ['给你跳个小舞～', '左一下，右一下。'], peek: ['让我瞅瞅～', '这边看看，那边看看。'],
    bow: ['收到，向你致意！', '谢谢你来陪我。'], spin: ['转一圈，快乐加倍。', '这一招，专门给你看。']
  };
  try {
    for (const { id } of MOTIONS) {
      await cooldown();
      const token = await run(id, () => startDouble(id), { record: true, label: `${id}-80` });
      const win = bubble.getWindow();
      assert.ok(win?.isVisible(), `${id}动作气泡未出现`);
      const text = await win.webContents.executeJavaScript('document.getElementById("message").textContent');
      assert.ok(phrases[id].includes(text), `${id}气泡错配：${text}`);
      const replay = await run(id, () => clickReply('again'), { label: `${id}-replay-80` });
      assert.ok(replay > token, `${id}重播没有新动作令牌`);
      process.stdout.write(`PET_BODY_MOTION_${id.toUpperCase()}_OK\n`);
    }
    // 真正点击当前动作气泡的休息按钮，不直接调用 renderer 内部函数。
    await cooldown();
    await resetTrace();
    const restAnchor = pet.getBounds();
    await startDouble('hop');
    await poll(() => Promise.resolve(pet.getBounds().y), y => y < restAnchor.y, '休息前原生跳跃');
    await clickReply('rest');
    await poll(state, value => value.lastAction === 'rest', '休息回应');
    assert.deepEqual(pet.getBounds(), restAnchor, '休息必须立即归位');
    const stoppedAt = performance.now();
    while (performance.now() - stoppedAt < 2000) {
      assert.deepEqual(pet.getBounds(), restAnchor, '旧动作定时器不应在休息后再次移动窗口');
      await wait(40);
    }
    setSetting('bubblesEnabled', false);
    await resetTrace();
    await startDouble('sway');
    await poll(() => Promise.resolve(pet.getBounds().x), x => x !== restAnchor.x, '拖动前原生扭动');
    await input('mouseDown', 40, 40, { button: 'left', clickCount: 1 });
    await input('mouseMove', 65, 55, { modifiers: ['leftButtonDown'] });
    await wait(120);
    await input('mouseUp', 65, 55, { button: 'left', clickCount: 1 });
    await poll(state, value => value.lastAction === 'drop', '拖动中断');
    const dropAnchor = pet.getBounds();
    assert.notDeepEqual(dropAnchor, restAnchor, '真实拖动必须改变位置');
    const droppedAt = performance.now();
    while (performance.now() - droppedAt < 2000) {
      assert.deepEqual(pet.getBounds(), dropAnchor, '旧动作不应把拖动后的窗口拉回');
      await wait(40);
    }
    process.stdout.write('PET_BODY_MOTION_INTERRUPTS_OK\n');

    for (const size of [120, 180, 240]) {
      await place(area, size, area.x + 240, area.y + 240);
      for (const { id } of MOTIONS) await run(id, () => startDouble(id), { label: `${id}-${size}` });
      process.stdout.write(`PET_BODY_MOTION_SIZE_${size}_OK\n`);
    }
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      const work = display.workArea;
      for (const [corner, x, y, id] of [
        ['top-left', work.x, work.y, 'hop'],
        ['top-right', work.x + work.width - 80, work.y, 'peek'],
        ['bottom-left', work.x, work.y + work.height - 80, 'sway'],
        ['bottom-right', work.x + work.width - 80, work.y + work.height - 80, 'bow']
      ]) {
        await place(work, 80, x, y);
        await run(id, () => startDouble(id), { label: `${id}-80-display-${display.id}-${corner}` });
      }
    }
    process.stdout.write(`PET_BODY_MOTION_DISPLAYS ${JSON.stringify(displays.map(display => ({id:display.id, workArea:display.workArea})))}\n`);
    if (!displays.some(display => display.workArea.x < 0 || display.workArea.y < 0)) {
      process.stdout.write('PET_BODY_MOTION_NEGATIVE_DISPLAY_NOT_AVAILABLE\n');
    }
    process.stdout.write('PET_BODY_MOTION_EDGES_OK\n');
    process.stdout.write('PET_BODY_MOTION_OK\n');
    process.stdout.write('PET_DOUBLE_CLICK_OK\n');
  } finally {
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'motion-verification.json'), JSON.stringify({ displays: screen.getAllDisplays().map(display => ({ id: display.id, workArea: display.workArea })), results }, null, 2));
    command('rest');
    await page('window.__motionUnsubscribe(); cancelAnimationFrame(window.__motionRAF); window.__motionQA.collecting = false; true');
    setSetting('bubblesEnabled', true);
  }
}

module.exports = { contourBounds, assertVisibleFrame, randomForMotion, isRestingTransform, verifyBodyMotion };
