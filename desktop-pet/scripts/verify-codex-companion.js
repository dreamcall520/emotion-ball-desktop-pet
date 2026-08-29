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

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertQuotaLabelWindow(controller, expectedWindow, petBounds, options = {}) {
  assert.ok(controller && typeof controller.getWindow === 'function', '额度标签控制器必须存在');
  assert.equal(controller.getWindow(), expectedWindow, '验收对象必须是额度标签当前窗口');
  assert.ok(expectedWindow && typeof expectedWindow.getBounds === 'function', '额度标签窗口必须存在');
  assert.equal(expectedWindow.isFocusable(), false, '额度标签不能聚焦');
  assert.equal(expectedWindow.isVisible(), true, '额度标签必须可见');
  const bounds = expectedWindow.getBounds();
  assert.deepEqual({ width: bounds.width, height: bounds.height }, { width: 176, height: 54 },
    '额度标签必须保持 176×54');
  assert.equal(intersects(bounds, petBounds), false, '额度标签不能与球球相交');
  if (options.obstacleBounds) {
    assert.equal(intersects(bounds, options.obstacleBounds), false, '额度标签不能与可见气泡相交');
  }
  if (options.workArea) {
    const area = options.workArea;
    assert.ok(bounds.x >= area.x && bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height,
    '额度标签必须完整位于当前显示器工作区');
  }
  assert.equal(controller.getWindow(), expectedWindow, '验收期间额度标签当前窗口不能被替换');
  return bounds;
}

async function applyPetSize({ setSize, getSettings, pet, poll, sizeName, pixels }) {
  setSize(sizeName);
  const value = await poll(async () => ({
    bounds: pet.getBounds(),
    configuredSize: getSettings().size
  }), current => current?.bounds?.width === pixels && current.bounds.height === pixels &&
    current.configuredSize === sizeName, `${sizeName} 真实尺寸入口`);
  assert.deepEqual({ width: value.bounds.width, height: value.bounds.height },
    { width: pixels, height: pixels });
  assert.equal(value.configuredSize, sizeName);
  return value.bounds;
}

async function verifyNegativeDisplay({ screen, pet, quotaLabel, bubble, poll }) {
  const displays = screen.getAllDisplays();
  const display = displays.find(item => item?.workArea &&
    (item.workArea.x < 0 || item.workArea.y < 0));
  if (!display) return { skipped: true };
  const area = display.workArea;
  const original = pet.getBounds();
  const target = {
    ...original,
    x: Math.round(area.x + Math.max(0, Math.min(240, area.width - original.width))),
    y: Math.round(area.y + Math.max(0, Math.min(240, area.height - original.height)))
  };
  let primaryError = null;
  let result = null;
  try {
    pet.setBounds(target, false);
    const petBounds = await poll(() => Promise.resolve(pet.getBounds()), value =>
      value.x === target.x && value.y === target.y &&
      value.width === original.width && value.height === original.height,
    '球球移入负坐标显示器');
    const expectedWindow = await poll(() => Promise.resolve(quotaLabel.getWindow()),
      value => value?.isVisible(), '负坐标显示器额度标签');
    await poll(() => {
      if (quotaLabel.getWindow() !== expectedWindow) return null;
      const labelBounds = expectedWindow.getBounds();
      const bubbleWindow = bubble?.getWindow?.();
      const obstacleBounds = bubbleWindow?.isVisible?.() ? bubbleWindow.getBounds() : null;
      const inside = labelBounds.x >= area.x && labelBounds.y >= area.y &&
        labelBounds.x + labelBounds.width <= area.x + area.width &&
        labelBounds.y + labelBounds.height <= area.y + area.height;
      return { labelBounds, obstacleBounds, inside };
    }, value => Boolean(value?.inside && !intersects(value.labelBounds, petBounds) &&
      (!value.obstacleBounds || !intersects(value.labelBounds, value.obstacleBounds))),
    '负坐标显示器标签重排');
    const bubbleWindow = bubble?.getWindow?.();
    const obstacleBounds = bubbleWindow?.isVisible?.() ? bubbleWindow.getBounds() : null;
    const labelBounds = assertQuotaLabelWindow(quotaLabel, expectedWindow, petBounds,
      { obstacleBounds, workArea: area });
    result = { skipped: false, workArea: { ...area }, labelBounds };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      pet.setBounds(original, false);
      await poll(() => Promise.resolve(pet.getBounds()), value =>
        value.x === original.x && value.y === original.y &&
        value.width === original.width && value.height === original.height,
      '恢复负坐标检查前位置');
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], primaryError.message);
      throw cleanupError;
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

async function runCleanupSteps(steps) {
  const errors = [];
  for (const [label, callback] of steps) {
    try { await callback(); } catch (error) { errors.push({ label, error }); }
  }
  return errors;
}

async function restoreSmokeState({ original, getSettings, setEnabled, setQuotaPreference, command,
  clearDialogue, page, setSetting, setSize, restorePetSettings, pet, bubble, quotaLabel,
  prepareSynthetic, prepare }) {
  const restorePreference = (name, value) => {
    setQuotaPreference(name, value);
    assert.equal(getSettings()[name], value, `${name} 未恢复`);
  };
  const detachDebugger = owner => {
    if (!owner || owner.isDestroyed?.()) return;
    const debuggerApi = owner.webContents?.debugger;
    if (debuggerApi?.isAttached?.()) debuggerApi.detach();
  };
  return runCleanupSteps([
    ['临时开启合成联动', async () => {
      prepareSynthetic();
      await setEnabled(true);
      assert.equal(getSettings().codexEnabled, true, '合成联动未临时开启');
    }],
    ['恢复额度周期', () => restorePreference('codexQuotaPeriod', original.settings.codexQuotaPeriod)],
    ['恢复额度常驻开关', () => restorePreference('codexQuotaAlwaysVisible', original.settings.codexQuotaAlwaysVisible)],
    ['恢复任务名称隐私开关', () => restorePreference('codexTaskNameInAlerts', original.settings.codexTaskNameInAlerts)],
    ['恢复 Codex 总开关', async () => {
      await setEnabled(original.settings.codexEnabled === true);
      assert.equal(getSettings().codexEnabled, original.settings.codexEnabled === true, 'Codex 总开关未恢复');
    }],
    ['停止动作', () => command('rest')],
    ['清理对话', () => clearDialogue()],
    ['清理页面验收追踪', () => page('window.__removeCodexNativeTrace?.(); delete window.__removeCodexNativeTrace; delete window.__codexNativeFrames; true')],
    ['恢复保持清醒', () => {
      setSetting('keepAwake', original.settings.keepAwake);
      assert.equal(getSettings().keepAwake, original.settings.keepAwake);
    }],
    ['恢复互动气泡', () => {
      setSetting('bubblesEnabled', original.settings.bubblesEnabled);
      assert.equal(getSettings().bubblesEnabled, original.settings.bubblesEnabled);
    }],
    ['恢复球球真实位置', () => {
      pet.setBounds(original.bounds, false);
      assert.deepEqual(pet.getBounds(), original.bounds, '球球真实 bounds 未恢复');
    }],
    ['恢复球球尺寸与落盘位置', () => {
      setSize(original.settings.size);
      assert.deepEqual(pet.getBounds(), original.bounds, '真实尺寸入口改变了原始 bounds');
      const current = getSettings();
      assert.deepEqual({ size: current.size, x: current.x, y: current.y },
        { size: original.settings.size, x: original.bounds.x, y: original.bounds.y },
      '真实尺寸入口未按原始 bounds 持久化尺寸与位置');
    }],
    ['恢复初始球球设置', () => {
      const expected = {
        size: original.settings.size,
        x: original.settings.x,
        y: original.settings.y
      };
      assert.equal(restorePetSettings(expected), true, '受控 smoke 设置恢复入口失败');
      const restored = getSettings();
      assert.deepEqual({ size: restored.size, x: restored.x, y: restored.y }, expected,
        '球球初始尺寸与位置设置未精确恢复');
      assert.deepEqual(pet.getBounds(), original.bounds, '恢复原始设置不能改变真实 bounds');
    }],
    ['最终核对球球恢复', () => {
      assert.deepEqual(pet.getBounds(), original.bounds, '球球最终 bounds 与初始值不一致');
      const current = getSettings();
      assert.deepEqual({ size: current.size, x: current.x, y: current.y }, {
        size: original.settings.size, x: original.settings.x, y: original.settings.y
      }, '球球最终设置与初始值不一致');
    }],
    ['断开球球调试器', () => detachDebugger(pet)],
    ['断开气泡调试器', () => detachDebugger(bubble.getWindow())],
    ['断开额度标签调试器', () => detachDebugger(quotaLabel.getWindow())],
    ['重建关闭态联动', () => prepare()]
  ]);
}

function combinedSmokeError(primaryError, cleanupErrors) {
  if (!primaryError && !cleanupErrors.length) return null;
  const errors = [...(primaryError ? [primaryError] : []), ...cleanupErrors.map(item => item.error)];
  const message = primaryError?.message || '原生验收清理失败';
  const combined = new AggregateError(errors, message, primaryError ? { cause: primaryError } : undefined);
  combined.cleanupErrors = cleanupErrors.map(item => ({ label: item.label, error: item.error }));
  return combined;
}

function syntheticQuotaSteps(used) {
  return used < 80 ? [100, 100 - used] : [100 - used];
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
  getMenu, getSettings, prepare, setEnabled, getController, canPresent, getMotionOwner, clearDialogue,
  quotaLabel, setQuotaPreference, restorePetSettings }) {
  if (process.env.PET_SMOKE_TEST !== '1') throw new Error('Codex 验收只允许在显式冒烟模式运行');
  const original = { bounds: pet.getBounds(), settings: { ...getSettings() } };
  assert.equal(original.settings.codexEnabled, false, '冒烟初始设置必须默认关闭');
  const initialMenu = getMenu();
  assert.equal(initialMenu.getMenuItemById('codex-enabled').checked, false);
  assert.equal(initialMenu.getMenuItemById('codex-task-names').checked, false);
  assert.equal(initialMenu.getMenuItemById('codex-task-names').enabled, false,
    'Codex 总开关关闭时任务名称开关必须禁用');
  assert.equal(initialMenu.getMenuItemById('codex-quota-visible').checked, false);
  assert.equal(initialMenu.getMenuItemById('codex-quota-visible').enabled, false,
    'Codex 总开关关闭时常驻额度开关必须禁用');
  assert.equal(initialMenu.getMenuItemById('codex-quota-period').enabled, false,
    'Codex 总开关关闭时额度周期必须禁用');
  assert.equal(initialMenu.getMenuItemById('codex-status'), null);
  assert.equal(initialMenu.getMenuItemById('codex-recent'), null, '原生菜单不能保留最近提醒');
  const clock = policyClock();
  const connections = [];
  let callbacks;
  let sequence = 0;
  const resetAt = clock.now() + 86400000;
  let quotaSequence = 0;
  const quotaWindow = (remaining, options = {}) => ({
    id: options.id || `fixture:quota:${++quotaSequence}`,
    label: options.label || '测试额度',
    windowMinutes: options.windowMinutes || 300,
    remaining,
    resetsAt: options.resetsAt || resetAt + quotaSequence
  });
  const emitQuota = windows => callbacks.onQuota({ windows, updatedAt: clock.now() });
  const quota = remaining => emitQuota([quotaWindow(remaining, {
    id: 'fixture:primary', resetsAt: resetAt, label: '5 小时额度'
  })]);
  const quotaPeriods = () => [
    quotaWindow(64, { id: 'fixture:five-hour',
      label: '超长恶意标签<script>alert(1)</script>还有更多文字', windowMinutes: 300,
      resetsAt: resetAt + 300000 }),
    quotaWindow(78, { id: 'fixture:weekly',
      label: '周额度详情名称也可以很长很长很长', windowMinutes: 10080,
      resetsAt: resetAt + 10080 })
  ];
  const syntheticOptions = { now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
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
  };
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
  const labelView = async win => {
    assert.equal(quotaLabel.getWindow(), win, '读取标签前必须仍是当前窗口');
    const view = await win.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('quota-label');
    return {
      state: root.dataset.state,
      severity: root.dataset.severity,
      rows: [...document.querySelectorAll('#items li')].map(row => row.textContent),
      cores: [...document.querySelectorAll('.quota-remaining')].map(node => {
        const rect = node.getBoundingClientRect();
        const row = node.parentElement.getBoundingClientRect();
        return { text: node.textContent, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
          left: rect.left, right: rect.right, rowLeft: row.left, rowRight: row.right };
      }),
      details: [...document.querySelectorAll('.quota-detail')].map(node => ({
        text: node.textContent, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth
      })),
      controls: document.querySelectorAll('button,input,select,textarea,a[href],[tabindex]').length
    };
  })()`);
    assert.equal(quotaLabel.getWindow(), win, '读取标签后必须仍是当前窗口');
    return view;
  };
  const visibleLabel = label => poll(() => Promise.resolve(quotaLabel?.getWindow()),
    value => value?.isVisible(), label);
  const waitForLabelView = (predicate, label) => poll(async () => {
    const win = quotaLabel?.getWindow();
    return win?.isVisible() ? { win, view: await labelView(win) } : null;
  }, value => value && predicate(value.view), label);
  const waitForLabelRows = (expected, label) => waitForLabelView(
    view => view.rows.length === expected, label);
  const captureColorSchemes = async win => {
    if (!artifacts) return;
    assertQuotaLabelWindow(quotaLabel, win, pet.getBounds());
    const debuggerApi = win.webContents.debugger;
    const attachedHere = !debuggerApi.isAttached();
    if (attachedHere) debuggerApi.attach('1.3');
    try {
      for (const scheme of ['light', 'dark']) {
        assert.equal(quotaLabel.getWindow(), win, `${scheme} 截图前标签窗口不能被替换`);
        await debuggerApi.sendCommand('Emulation.setEmulatedMedia', {
          media: '', features: [{ name: 'prefers-color-scheme', value: scheme }]
        });
        await wait(50);
        assert.equal(quotaLabel.getWindow(), win, `${scheme} 截图时标签窗口不能被替换`);
        await capture(win, `quota-label-${scheme}`);
        assert.equal(quotaLabel.getWindow(), win, `${scheme} 截图后标签窗口不能被替换`);
      }
      await debuggerApi.sendCommand('Emulation.setEmulatedMedia', { media: '', features: [] });
      assertQuotaLabelWindow(quotaLabel, win, pet.getBounds());
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
    }
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
  const verifyQuotaAlert = async (used, severity, alwaysVisible) => {
    const beforeVisible = getSettings().codexQuotaAlwaysVisible;
    assert.equal(setQuotaPreference('codexQuotaAlwaysVisible', alwaysVisible),
      beforeVisible !== alwaysVisible,
      '额度常驻设置只应在值变化时返回 true');
    assert.equal(getSettings().codexQuotaAlwaysVisible, alwaysVisible);
    clock.advanceBy(31000);
    await ready();
    const remaining = 100 - used;
    const synthetic = quotaWindow(remaining, { label: `模拟已用 ${used}%` });
    for (const stepRemaining of syntheticQuotaSteps(used)) {
      emitQuota([{ ...synthetic, remaining: stepRemaining }]);
    }
    clock.advanceBy(5000);
    const alert = await poll(() => Promise.resolve(getController().getSnapshot().currentAlert),
      value => value?.kind === 'quota', `${used}% 额度提醒`);
    assert.equal(alert.severity, severity, `已用 ${used}% 提醒强度不正确`);
    assert.equal(alert.durationMs, severity === 'normal' ? 6000 : 12000);
    const win = await poll(() => Promise.resolve(bubble.getWindow()), value => value?.isVisible(),
      `${used}% 额度气泡`);
    const tone = await poll(
      () => win.webContents.executeJavaScript("document.getElementById('bubble').dataset.tone"),
      value => value === severity,
      `${used}% 气泡强弱样式`
    );
    assert.equal(tone, severity, `${used}% 气泡强弱样式未到达真实页面`);
    if (alwaysVisible) {
      const labelWindow = await visibleLabel(`${used}% 常驻额度标签`);
      assertQuotaLabelWindow(quotaLabel, labelWindow, pet.getBounds());
    } else {
      assert.equal(quotaLabel.getWindow()?.isVisible() === true, false,
        '关闭常驻时普通额度提醒不能偷偷显示标签');
    }
    assert.equal(getController().dismiss(alert.id, alert.generation), true);
    await poll(() => Promise.resolve(bubble.getWindow()?.isVisible()), value => value !== true,
      `${used}% 额度气泡关闭`);
    results.push({ used, remaining, severity, durationMs: alert.durationMs,
      alwaysVisible, source: 'synthetic-quota-real-ui' });
  };

  let primaryError = null;
  let cleanupErrors = [];
  try {
    monitor.stop();
    prepare(syntheticOptions);
    assert.equal(connections.length, 0, '准备关闭态不能创建连接');
    setSetting('keepAwake', true);
    setSetting('bubblesEnabled', true);
    command('wake');
    await setEnabled(true);
    assert.equal(connections.length, 1);
    assert.equal(getMenu().getMenuItemById('codex-enabled').checked, true);
    assert.ok(getMenu().getMenuItemById('codex-tasks'));
    assert.equal(getMenu().getMenuItemById('codex-task-names').enabled, true);
    assert.equal(getMenu().getMenuItemById('codex-task-names').checked, false);
    assert.equal(getMenu().getMenuItemById('codex-quota-visible').enabled, true);
    assert.equal(getMenu().getMenuItemById('codex-quota-visible').checked, false);
    assert.equal(getMenu().getMenuItemById('codex-recent'), null, '开启后也不能出现最近提醒');

    assert.equal(typeof setQuotaPreference, 'function', '原生验收必须使用真实额度设置入口');
    assert.equal(setQuotaPreference('codexQuotaAlwaysVisible', true), true);
    emitQuota(quotaPeriods());
    let labelResult = await waitForLabelRows(2, '自动周期两项额度标签');
    assertQuotaLabelWindow(quotaLabel, labelResult.win, pet.getBounds());
    assert.equal(labelResult.view.controls, 0, '额度标签必须只读，不能包含交互控件');
    assert.match(labelResult.view.rows.join('\n'), /5 小时/);
    assert.match(labelResult.view.rows.join('\n'), /周额度/);
    assert.deepEqual(labelResult.view.cores.map(item => item.text), ['剩余 64%', '剩余 78%']);
    assert.ok(labelResult.view.cores.every(item => item.scrollWidth <= item.clientWidth &&
      item.left >= item.rowLeft && item.right <= item.rowRight),
    '核心剩余比例必须在 176 宽标签中完整可见');
    assert.ok(labelResult.view.details.every(item => item.text.startsWith(' · ')) &&
      labelResult.view.details.some(item => item.scrollWidth > item.clientWidth),
    '超长恶意标签只能在详情区域省略');
    await captureColorSchemes(labelResult.win);

    clock.advanceBy(300001);
    const staleLabelResult = await waitForLabelView(view => view.state === 'stale' &&
      view.rows.length === 2, '过期长名称额度标签');
    assertQuotaLabelWindow(quotaLabel, staleLabelResult.win, pet.getBounds());
    assert.deepEqual(staleLabelResult.view.cores.map(item => item.text), [
      '已过期 · 剩余 64%', '已过期 · 剩余 78%'
    ]);
    assert.ok(staleLabelResult.view.cores.every(item => item.scrollWidth <= item.clientWidth &&
      item.left >= item.rowLeft && item.right <= item.rowRight),
    '过期标识与核心比例必须在 176 宽标签中同时完整可见');
    assert.ok(staleLabelResult.view.details.every(item => !item.text.includes('已过期')) &&
      staleLabelResult.view.details.some(item => item.scrollWidth > item.clientWidth),
    '过期标识不能落入可省略详情区');
    assert.equal(quotaLabel.getWindow(), staleLabelResult.win, '过期截图前标签窗口不能被替换');
    await capture(staleLabelResult.win, 'quota-label-stale-long');
    assertQuotaLabelWindow(quotaLabel, staleLabelResult.win, pet.getBounds());
    emitQuota(quotaPeriods());
    labelResult = await waitForLabelRows(2, '恢复新鲜额度标签');

    for (const [setting, menuId, expected] of [
      ['fiveHour', 'codex-quota-five-hour', /5 小时/],
      ['weekly', 'codex-quota-weekly', /周额度/]
    ]) {
      assert.equal(setQuotaPreference('codexQuotaPeriod', setting), true);
      labelResult = await waitForLabelView(view => view.rows.length === 1 &&
        expected.test(view.rows[0]), `${setting} 单周期额度标签`);
      assert.equal(getMenu().getMenuItemById(menuId).checked, true);
    }
    assert.equal(setQuotaPreference('codexQuotaPeriod', 'auto'), true);
    labelResult = await waitForLabelRows(2, '切回自动周期额度标签');
    assert.equal(getMenu().getMenuItemById('codex-quota-auto').checked, true);
    assert.equal(setQuotaPreference('codexQuotaAlwaysVisible', false), true);
    await poll(() => Promise.resolve(quotaLabel.getWindow()?.isVisible()), value => value !== true,
      '关闭常驻额度标签');
    assert.equal(getMenu().getMenuItemById('codex-quota-visible').checked, false);
    assert.equal(setQuotaPreference('codexQuotaAlwaysVisible', true), true);
    await visibleLabel('重新开启常驻额度标签');

    for (const [sizeName, pixels] of [['tiny', 80], ['small', 120], ['medium', 180], ['large', 260]]) {
      await applyPetSize({ setSize, getSettings, pet, poll, sizeName, pixels });
      const labelWindow = await visibleLabel(`${pixels} 尺寸额度标签`);
      await poll(() => Promise.resolve(labelWindow.getBounds()),
        bounds => quotaLabel.getWindow() === labelWindow && !intersects(bounds, pet.getBounds()),
      `${pixels} 尺寸额度标签避让球球`);
      assertQuotaLabelWindow(quotaLabel, labelWindow, pet.getBounds());
      assert.equal(quotaLabel.getWindow(), labelWindow, `${pixels} 截图前不能替换标签窗口`);
      await capture(labelWindow, `codex-quota-${pixels}`);
      assertQuotaLabelWindow(quotaLabel, labelWindow, pet.getBounds());
      const marker = {
        80: 'PET_CODEX_QUOTA_SIZE_80_OK', 120: 'PET_CODEX_QUOTA_SIZE_120_OK',
        180: 'PET_CODEX_QUOTA_SIZE_180_OK', 260: 'PET_CODEX_QUOTA_SIZE_260_OK'
      }[pixels];
      process.stdout.write(`${marker}\n`);
    }
    const negativeDisplay = await verifyNegativeDisplay({ screen, pet, quotaLabel, bubble, poll });
    process.stdout.write(negativeDisplay.skipped
      ? 'PET_CODEX_QUOTA_NEGATIVE_DISPLAY_SKIPPED\n'
      : 'PET_CODEX_QUOTA_NEGATIVE_DISPLAY_OK\n');
    process.stdout.write('PET_CODEX_QUOTA_LABEL_OK\n');

    await verifyQuotaAlert(10, 'normal', false);
    await verifyQuotaAlert(80, 'strong', true);
    await verifyQuotaAlert(90, 'urgent', true);
    await verifyQuotaAlert(100, 'urgent', true);
    process.stdout.write('PET_CODEX_QUOTA_POLICY_OK\n');

    await page('window.__codexNativeFrames = []; window.__removeCodexNativeTrace = window.petDesktop.onMotion(packet => window.__codexNativeFrames.push(packet)); true');
    const focusBefore = BrowserWindow.getFocusedWindow();
    for (const [size, pixels, kind] of [['tiny', 80, 'completed'], ['small', 120, 'quota'], ['medium', 180, 'waiting'], ['large', 260, 'failed']]) {
      await applyPetSize({ setSize, getSettings, pet, poll, sizeName: size, pixels });
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
      const labelWindow = await visibleLabel(`${pixels} Codex 气泡期间额度标签`);
      const labelBounds = await poll(() => Promise.resolve(labelWindow.getBounds()), bounds =>
        quotaLabel.getWindow() === labelWindow && !intersects(bounds, pet.getBounds()) && !intersects(bounds, win.getBounds()),
      `${pixels} 额度标签避让气泡`);
      assertQuotaLabelWindow(quotaLabel, labelWindow, pet.getBounds(), { obstacleBounds: win.getBounds() });
      assert.deepEqual({ width: labelBounds.width, height: labelBounds.height }, { width: 176, height: 54 });
      await capture(win, `codex-bubble-${pixels}`);
      await capture(pet, `codex-pet-${pixels}`);
      assertQuotaLabelWindow(quotaLabel, labelWindow, pet.getBounds(), { obstacleBounds: win.getBounds() });
      const packets = await poll(() => page('window.__codexNativeFrames'), value => value.some(packet => packet.frame.done), 'Codex 动作完整结束');
      const expected = { completed: 'hop', quota: 'jelly', waiting: 'peek', failed: 'jelly' }[kind];
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
  } catch (error) {
    primaryError = error;
  } finally {
    cleanupErrors = await restoreSmokeState({ original, getSettings, setEnabled,
      setQuotaPreference, command, clearDialogue, page, setSetting, setSize, restorePetSettings,
      pet, bubble, quotaLabel, prepareSynthetic: () => prepare(syntheticOptions), prepare });
  }
  const finalError = combinedSmokeError(primaryError, cleanupErrors);
  if (finalError) throw finalError;
}

module.exports = {
  verifyCodexCompanion, assertBubbleLayout, assertQuotaLabelWindow, syntheticQuotaSteps,
  applyPetSize, verifyNegativeDisplay, restoreSmokeState, combinedSmokeError
};
