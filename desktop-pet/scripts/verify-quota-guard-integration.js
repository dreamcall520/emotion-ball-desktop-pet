const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { quotaLabelBounds } = require('../lib/quota-label-placement');
const { readQuotaLabelGeometry } = require('./verify-codex-companion');
const { pointerClick } = require('./verify-chat-integration');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, label) {
  const deadline = Date.now() + 6000;
  let value;
  while (Date.now() < deadline) { value = await read(); if (accept(value)) return value; await wait(25); }
  throw new Error(label + '超时：' + JSON.stringify(value));
}

async function verifyQuotaGuardIntegration({ pet, label, guard, prepare, getCompanion, getSettings,
  sync, setPreference, setTopmost, hidePet, restorePet, ipcMain, powerMonitor,
  shortcuts, openShortcuts, screen, windows, BrowserWindow,
  getMenuTemplate, readSettings }) {
  const settings = getSettings();
  assert.equal(settings.codexQuotaFunEnabled, true, '新设置默认开启趣味互动');
  assert.equal(readSettings().codexQuotaFunEnabled, true, '未配置时从设置文件读取默认开启');
  function funMenu() {
    const find = (items, id) => {
      for (const item of items) {
        if (item.id === id) return item;
        if (Array.isArray(item.submenu)) { const child = find(item.submenu, id); if (child) return child; }
      }
      return null;
    };
    const section = find(getMenuTemplate(), 'codex-menu');
    assert.equal(section?.label, 'Codex 与 API');
    const item = section.submenu.find(value => value.id === 'codex-quota-fun');
    assert.equal(item?.label, '额度趣味互动');
    assert.equal(item.type, 'checkbox');
    assert.equal(item.enabled, true);
    return item;
  }
  settings.codexEnabled = true; settings.codexQuotaAlwaysVisible = true;
  settings.codexQuotaLabelSize = 'compact'; settings.codexQuotaPeriod = 'fiveHour';
  let callbacks;
  const fixture = () => ({ windows: [
    { id: 'codex:fiveHour', label: 'Codex', windowMinutes: 300, remaining: 77, resetsAt: Date.now() + 3600000 },
    { id: 'codex:weekly', label: 'Codex', windowMinutes: 10080, remaining: 62, resetsAt: Date.now() + 86400000 }
  ], updatedAt: Date.now() });
  prepare({ createConnection(next) {
    callbacks = next;
    return { async start() {
      next.onAccount({ accountKey: 'quota-guard-integration-fixture' });
      next.onStatus({ channel: 'quota', state: 'connected' }); next.onStatus({ channel: 'tasks', state: 'connected' });
      next.onQuota(fixture());
    }, async refresh() {}, async retry() {}, close() {} };
  } });
  await getCompanion().setEnabled(true);
  sync();
  const card = await until(() => label.getWindow(), value => value?.isVisible(), '原生额度卡');
  await until(() => card.webContents.executeJavaScript('window.quotaGuardEntry?.state'), value => value?.ready && value.visible, '原生角色入口');
  const originalPet = pet.getBounds(), cursorReader = screen.getCursorScreenPoint;
  const ignoreMouse = card.setIgnoreMouseEvents;
  let ignored = null;
  const cardSpacing = [];
  card.setIgnoreMouseEvents = function(value, options) { ignored = value; return ignoreMouse.call(this, value, options); };
  try {
    const area = screen.getDisplayMatching(originalPet).workArea;
    for (const [name, x] of [['center', area.x + Math.floor(area.width / 2) - 40],
      ['left-edge', area.x], ['near-right', area.x + area.width - 115], ['right-edge', area.x + area.width - 80]]) {
      pet.setBounds({ x, y: area.y + 180, width: 80, height: 80 }, false); sync();
      const baseline = quotaLabelBounds(pet.getBounds(), area, null, 'compact', false, 1,
        { shape: settings.customization?.appearance?.shape, mode: 'free' });
      const geometry = await until(() => card.webContents.executeJavaScript(`(()=>{
        const face=document.getElementById('quota-beam').getBoundingClientRect();
        return {x:face.x,y:face.y,width:face.width,height:face.height,side:document.body.dataset.guardSide};
      })()`), value => value.width === 128 && value.height === 32, '原生卡面布局');
      const bounds = card.getBounds();
      assert.equal(bounds.x + geometry.x, Math.min(area.x + area.width - bounds.width,
        baseline.x - (baseline.placement === 'left' ? 72 : 0)),
        '可见卡 x 保持线上基线，右屏缘不足只整体最小平移');
      assert.equal(bounds.y + geometry.y, baseline.y, '可见卡 y 与线上卡面基线一致');
      assert.equal(geometry.side, 'right', '角色在所有位置均固定卡右');
      const paintedFrames = [];
      for (let frame = 0; frame < 4; frame++) {
        const value = await readQuotaLabelGeometry(card);
        assert.equal(value.guard.role, 'roaming');
        assert.ok(Number.isFinite(value.guard.paintedLeft) && Math.abs(value.guard.paintedLeft - value.beam.x - value.beam.width - 8) < .01,
          '僵尸动画实际可见轮廓固定卡右8DIP，不能只校验透明按钮');
        paintedFrames.push(value.guard.paintedLeft); await wait(80);
      }
      const cursor = { x: bounds.x + 4, y: bounds.y + 1 }; // Transparent corner stays outside the pet's hover target.
      screen.getCursorScreenPoint = () => cursor; sync();
      assert.equal(ignored, true, '透明顶沿初始化穿透');
      cursor.x = bounds.x + geometry.x + 64; cursor.y = bounds.y + geometry.y + 16;
      card.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(geometry.x + 64), y: Math.round(geometry.y + 16) });
      await until(() => ignored, value => value === false, '进入可见卡面恢复鼠标命中');
      await pointerClick(card, '#quota-label');
      await until(() => card.getBounds().height, value => value === 144, '双周期可见卡点击仍可展开');
      await pointerClick(card, '#quota-label');
      await until(() => card.getBounds().height, value => value === 50, '可见卡正常收起');
      cardSpacing.push({ name, baseline, bounds, geometry, paintedFrames, transparentTopPassesMouse: true, cardClickExpands: true });
    }
  } finally {
    card.setIgnoreMouseEvents = ignoreMouse; screen.getCursorScreenPoint = cursorReader;
    pet.setBounds(originalPet, false); sync();
  }
  const directory = process.env.PET_SMOKE_ARTIFACT_DIR;
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'quota-spacing-native.json'), JSON.stringify(cardSpacing, null, 2));
  }
  async function capture(win, name) { if (directory) {
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await wait(40);
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG());
  } }
  await capture(card, 'main-route-card');
  settings.codexQuotaLabelSize = 'standard';
  const exhausted = fixture(); exhausted.windows[0].remaining = 0;
  callbacks.onQuota(exhausted); sync();
  await until(() => card.webContents.executeJavaScript('window.quotaGuardEntry?.state'),
    value => value?.role === 'empty' && value.visible, '截图同场景标准卡0%角色');
  const standardFace = await card.webContents.executeJavaScript(`(() => {const r=document.getElementById('quota-label').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,side:document.body.dataset.guardSide};})()`);
  assert.deepEqual(standardFace, { x: 0, y: 6, width: 168, height: 58, side: 'right' }, '角色固定卡右，不改标准卡尺寸和垂直间距');
  await capture(card, 'main-route-standard-exhausted');
  settings.codexQuotaLabelSize = 'compact'; callbacks.onQuota(fixture()); sync();
  await until(() => card.webContents.executeJavaScript('window.quotaGuardEntry?.state'),
    value => value?.role === 'roaming' && value.visible, '恢复小巧卡主流程');
  windows.open();
  const timerPanel = await until(() => BrowserWindow.getAllWindows().find(win =>
    !win.isDestroyed() && /pomodoro\.html\?view=panel$/.test(win.webContents.getURL())),
    value => value?.isVisible(), '先打开番茄钟面板');
  const separated = win => {
    const a = timerPanel.getBounds(), b = win.getBounds();
    return a.x >= b.x + b.width || a.x + a.width <= b.x || a.y >= b.y + b.height || a.y + a.height <= b.y;
  };
  const retainedTimerPanel = timerPanel.getBounds();
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  const panel = await until(() => guard.getWindow(), value => guard.isVisible() && value?.isVisible(), '可信入口打开守护战');
  const state = () => panel.webContents.executeJavaScript('window.quotaGuardView?.state');
  await until(state, value => value?.spritesReady && value.ready && value.visible && value.quota === 77, '守护战接收所选真实模型');
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('#guard-number').textContent"), '77%');
  await until(() => separated(panel), Boolean, '守护战避让已定位番茄钟');
  assert.deepEqual(timerPanel.getBounds(), retainedTimerPanel, '打开守护战不移动番茄钟主面板');
  const panelLayout = { pomodoro: timerPanel.getBounds(), guard: panel.getBounds() };
  await capture(panel, 'main-route-panel');
  const shortcutQuota = [];
  if (shortcuts) {
    const readCursor = screen.getCursorScreenPoint;
    const bounds = pet.getBounds(), cursor = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const entryTime = () => card.webContents.executeJavaScript('window.quotaGuardEntry?.state.entryTime');
    let earliestShow = Infinity, closeStarted = null;
    const nativeShows = [], prematureShows = [];
    const originalShow = card.show, originalShowInactive = card.showInactive;
    const { app } = require('electron');
    const focusEvents = [], watched = new Map();
    const describe = win => !win || win.isDestroyed() ? null : ({ id: win.id, url: win.webContents.getURL(), visible: win.isVisible(), focused: win.isFocused() });
    const focusSnapshot = (event, target) => {
      const current = shortcuts.getState();
      return { at: performance.now(), event, target: describe(target), focusedWindow: describe(BrowserWindow.getFocusedWindow()),
        shortcut: describe(shortcuts.getWindow()), guard: describe(panel), opened: shortcuts.isOpen(), presenting: shortcuts.isPresenting(),
        view: current.view, session: current.session, animation: current.animation };
    };
    const watch = win => {
      if (watched.has(win)) return;
      const focus = () => focusEvents.push(focusSnapshot('window:focus', win)), blur = () => focusEvents.push(focusSnapshot('window:blur', win));
      win.on('focus', focus); win.on('blur', blur); watched.set(win, { focus, blur });
    };
    const appFocus = (_event, win) => focusEvents.push(focusSnapshot('app:focus', win));
    const observeShow = () => {
      const at = performance.now(), presenting = shortcuts.isPresenting();
      const value = { at, presenting, elapsed: closeStarted === null ? null : at - closeStarted };
      nativeShows.push(value);
      if (at < earliestShow || presenting) prematureShows.push(value);
    };
    try {
      screen.getCursorScreenPoint = () => cursor;
      shortcuts.sampleCursor(cursor); await wait(550);
      assert.equal(shortcuts.isOpen(), false, '守护战打开时悬停不覆盖游戏');
      const round = (await state()).round;
      app.on('browser-window-focus', appFocus); watch(panel);
      // macOS showInactive need not synchronously emit the generic `show`
      // event. Observe the actual native presentation calls on this card only.
      card.show = function (...args) { const result = originalShow.apply(this, args); if (this.isVisible()) observeShow(); return result; };
      card.showInactive = function (...args) { const result = originalShowInactive.apply(this, args); if (this.isVisible()) observeShow(); return result; };
      for (const view of ['floating', 'list', 'settings']) {
        earliestShow = Infinity; closeStarted = null;
        openShortcuts(view === 'settings');
        assert.equal(card.isVisible(), false, `${view} 展开立即隐藏原卡与内嵌角色`);
        await until(() => ({ opened: shortcuts.isOpen(), visible: shortcuts.getWindow()?.isVisible(),
          focused: shortcuts.getWindow()?.isFocused(), loading: shortcuts.getWindow()?.webContents.isLoading(),
          guard: guard.isVisible(), view: shortcuts.getState().view }),
        value => value.opened && value.visible && value.focused && !value.loading, '主动打开可交互快捷入口');
        const quick = shortcuts.getWindow();
        watch(quick);
        if (view !== 'settings' && shortcuts.getState().view !== view) {
          const result = await quick.webContents.executeJavaScript(`window.qiuShortcuts.setShape(${JSON.stringify(view)})`);
          assert.equal(result.ok, true, `${result.error || ''} ${JSON.stringify(focusSnapshot('shape-result', quick))}`);
        }
        await until(() => shortcuts.getState().view, value => value === view, `${view} 快捷形态`);
        assert.deepEqual(timerPanel.getBounds(), panelLayout.pomodoro, '快捷面板切换不得移动已打开的番茄钟主面板');
        assert.equal(guard.isVisible(), false, '主动快捷入口先收起守护战');
        assert.equal(shortcuts.isPresenting(), true, '展开保持呈现 pin');
        await wait(50);
        const pausedEntry = await entryTime();
        assert.equal(typeof pausedEntry, 'number', '复用已有角色入口');
        callbacks.onQuota(fixture()); sync(); shortcuts.sync();
        await wait(110);
        assert.deepEqual(timerPanel.getBounds(), retainedTimerPanel, '额度与快捷刷新不移动番茄钟主面板');
        assert.equal(card.isVisible(), false, '同值额度刷新及窗口同步不能重显原卡');
        // The entry's state.visible denotes available content; the hidden native
        // card hosts both it and the quota. Its stopped clock verifies concealment.
        assert.equal(await entryTime(), pausedEntry, '快捷展开时内嵌角色停止动画');
        assert.deepEqual(prematureShows, [], '切换到快捷入口期间原卡不能闪现');
        const showCount = nativeShows.length;
        closeStarted = performance.now();
        shortcuts.close();
        const duration = shortcuts.getState().animation.duration;
        assert.equal(shortcuts.getState().animation.phase, 'closing');
        assert.equal(duration, 180);
        earliestShow = closeStarted + duration - 2;
        assert.equal(shortcuts.isOpen(), false);
        assert.equal(shortcuts.isPresenting(), true, '收起动画结束前保留呈现 pin');
        assert.equal(card.isVisible(), false, '收起开始不恢复额度卡');
        callbacks.onQuota(fixture()); sync();
        await wait(75);
        assert.equal(shortcuts.isPresenting(), true);
        assert.equal(card.isVisible(), false, '收起动画中刷新仍隐藏额度卡');
        await until(() => card.isVisible(), Boolean, '收起动画结束后原卡恢复');
        assert.equal(shortcuts.isPresenting(), false);
        assert.deepEqual(timerPanel.getBounds(), retainedTimerPanel, '快捷收起后番茄钟主面板保持位置');
        assert.deepEqual(prematureShows, [], '额度卡只能在收起动画完成后恢复');
        const restored = nativeShows[showCount];
        assert.ok(restored, '记录原卡原生显示调用');
        assert.ok(restored.elapsed >= duration - 2, '180ms 收起期内不提前显示（2ms 时钟取样容差）');
        await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
        await until(() => guard.isVisible() && panel.isVisible() && panel.isFocused(), Boolean, '快捷收起后恢复可交互守护战');
        assert.equal((await state()).round, round, '切换面板不重开游戏');
        shortcutQuota.push({ view, closeDuration: duration, restoredAfter: restored.elapsed, round, hiddenDuringRefresh: true, entryPaused: true });
      }
      setPreference('codexQuotaAlwaysVisible', false);
      await until(() => guard.isVisible(), value => !value, '用户关闭原额度卡');
      earliestShow = Infinity; closeStarted = null;
      openShortcuts();
      await until(() => shortcuts.isOpen() && shortcuts.getWindow()?.isVisible(), Boolean, '原卡关闭时仍可展开快捷入口');
      callbacks.onQuota(fixture()); sync();
      assert.equal(card.isVisible(), false);
      shortcuts.close();
      await until(() => shortcuts.isPresenting(), value => !value, '原卡关闭时快捷收起完成');
      callbacks.onQuota(fixture()); sync(); await wait(50);
      assert.equal(card.isVisible(), false, '收起快捷不强制打开用户已关闭的原卡');
      assert.equal(getSettings().codexQuotaAlwaysVisible, false, '原显示偏好保持关闭');
      assert.deepEqual(prematureShows, []);
      card.show = originalShow; card.showInactive = originalShowInactive;
      setPreference('codexQuotaAlwaysVisible', true); sync();
      await until(() => card.isVisible(), Boolean, '恢复测试前原卡显示偏好');
      await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
      await until(() => guard.isVisible(), Boolean, '快捷后恢复守护战');
      assert.equal(shortcuts.isOpen(), false, '守护战打开立即收起快捷入口');
      assert.equal((await state()).round, round, '切换面板不重开游戏');
      if (directory) fs.writeFileSync(path.join(directory, 'shortcut-focus-diagnostic.json'), JSON.stringify({
        ok: true, shortcutQuota, nativeShows, prematureShows, focusEvents
      }, null, 2) + '\n');
    } catch (error) {
      if (directory) fs.writeFileSync(path.join(directory, 'shortcut-focus-diagnostic.json'), JSON.stringify({
        ok: false, error: error.message, current: focusSnapshot('failure', shortcuts.getWindow()), shortcutQuota, nativeShows, prematureShows, focusEvents
      }, null, 2) + '\n');
      throw error;
    } finally {
      app.removeListener('browser-window-focus', appFocus);
      for (const [win, events] of watched) { win.removeListener('focus', events.focus); win.removeListener('blur', events.blur); }
      card.show = originalShow; card.showInactive = originalShowInactive; screen.getCursorScreenPoint = readCursor;
    }
  }
  assert.equal(funMenu().checked, true, '额度趣味互动菜单默认勾选');
  const toggleBefore = await state();
  funMenu().click({ checked: false });
  assert.equal(getSettings().codexQuotaFunEnabled, false, '真实菜单回调关闭开关');
  assert.equal(readSettings().codexQuotaFunEnabled, false, '关闭后保存并 loadSettings 读回 false');
  assert.equal(funMenu().checked, false, '重新生成菜单保持未勾选');
  await until(() => guard.isVisible(), value => !value, '关闭趣味互动立即收起大游戏');
  await until(() => card.isVisible(), Boolean, '关闭趣味互动保留原额度卡');
  const offCard = await until(() => card.webContents.executeJavaScript(`(() => {
    const entry = document.querySelector('#quota-guard-entry');
    const beam = document.querySelector('#quota-beam').getBoundingClientRect();
    return { entryHidden: entry.hidden, entryDisplay: getComputedStyle(entry).display,
      entryState: window.quotaGuardEntry.state, guardEntry: document.body.dataset.guardEntry,
      viewport: [innerWidth, innerHeight], card: [beam.width, beam.height],
      summary: document.querySelector('#summary').textContent };
  })()`), value => value.entryHidden && value.entryDisplay === 'none' &&
    value.viewport[0] === 128 && value.viewport[1] === 32, '关闭后无透明入口占位');
  assert.deepEqual(offCard.card, [128, 32], '恢复原生小巧卡尺寸');
  assert.ok(offCard.summary.includes('77%'), '原卡额度文字保持');
  assert.equal(offCard.entryState.visible, false, '关闭时角色不接受点击');
  const offBounds = card.getContentBounds();
  assert.equal(offBounds.width, 128); assert.equal(offBounds.height, 32);
  const offGame = await until(state, value => value.visible === false, '隐藏模型到达游戏');
  await wait(220);
  assert.equal((await state()).time, offGame.time, '关闭开关时大游戏时钟冻结');
  assert.equal((await card.webContents.executeJavaScript('window.quotaGuardEntry.state')).entryTime,
    offCard.entryState.entryTime, '关闭开关时小角色时钟冻结');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await wait(80);
  assert.equal(guard.isVisible(), false, '关闭时可信原卡桥也不能打开游戏');
  assert.equal(panel.isVisible(), false, '关闭时无原生游戏窗口点击区');
  assert.equal((await state()).time, offGame.time, '可信被拒入口不会重新启动时钟');
  await capture(card, 'main-route-fun-off-card');
  funMenu().click({ checked: true });
  assert.equal(getSettings().codexQuotaFunEnabled, true, '真实菜单回调重新开启');
  assert.equal(readSettings().codexQuotaFunEnabled, true, '开启后保存并 loadSettings 读回 true');
  assert.equal(funMenu().checked, true, '重新生成菜单恢复勾选');
  const onEntry = await until(() => card.webContents.executeJavaScript('window.quotaGuardEntry.state'),
    value => value?.ready && value.visible, '开启后右侧角色恢复');
  assert.equal(guard.isVisible(), false, '开启开关不会自动弹出游戏');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await until(() => guard.isVisible(), Boolean, '开启后可信入口恢复可用');
  await until(state, value => value?.ready && value.visible, '重新开启游戏恢复模型');
  assert.equal(guard.getWindow(), panel, '开关切换重用原游戏窗口');
  assert.equal((await state()).round, toggleBefore.round, '开关切换保留同局');
  if (directory) fs.writeFileSync(path.join(directory, 'main-route-toggle.json'), JSON.stringify({
    passed: true, defaultChecked: true, savedOff: false, savedOn: true,
    offCard, offBounds, offGame, onEntry, reopened: await state()
  }, null, 2));
  process.stdout.write('PET_QUOTA_GUARD_TOGGLE_OK\n');
  const originalDisplay = { ...getSettings().quotaDisplay }, numericChecks = [];
  const ringVisible = () => pet.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('.quota-effects[data-style="ring"]');
    return Boolean(node && node.dataset.quotaAvailable === 'true' && node.getBoundingClientRect().width > 0 &&
      node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none');
  })()`);
  const numberView = () => card.webContents.executeJavaScript(`(() => {
    const entry = document.querySelector('#quota-guard-entry');
    return { display: document.querySelector('#quota-label').dataset.display,
      ready: document.querySelector('#quota-label').dataset.state === 'ready',
      numbersVisible: getComputedStyle(document.querySelector('#quota-numbers')).display !== 'none',
      periods: [...document.querySelectorAll('.quota-reading')].map(node => Number(node.dataset.period)),
      text: document.querySelector('#quota-numbers').textContent, hidden: entry.hidden,
      entry: window.quotaGuardEntry.state };
  })()`);
  try {
    guard.close();
    getSettings().quotaDisplay = { ...originalDisplay, style: 'ring', period: 'fiveHour', showNumbers: true }; sync();
    await until(() => card.isVisible(), Boolean, '光环数字原生窗显示');
    const ringNumbers = await until(numberView, value => value.display === 'numbers' && value.ready && value.numbersVisible &&
      value.text.includes('77%') && value.entry.visible,
      '光环真实数字及角色入口');
    assert.deepEqual(ringNumbers.periods, [300], '数字仅显示当前真实五小时周期');
    await until(ringVisible, Boolean, '光环样式在球球真实页面显示');
    assert.equal(funMenu().checked, true, '数字模式趣味菜单直接可达');
    await capture(card, 'main-route-ring-numbers');
    await capture(pet, 'main-route-ring-pet');
    await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
    const ringGame = await until(state, value => guard.isVisible() && value.visible && value.quota === 77 && value.period === 300,
      '数字入口沿用真实五小时额度');
    funMenu().click({ checked: false });
    assert.equal(readSettings().codexQuotaFunEnabled, false, '数字模式关闭保存可重读');
    assert.equal(readSettings().quotaDisplay.style, 'ring');
    await until(() => guard.isVisible(), value => !value, '数字模式关闭趣味立即隐藏游戏');
    await until(() => card.isVisible(), Boolean, '数字模式关闭趣味保留数字');
    const numericOff = await until(numberView, value => value.hidden && !value.entry.visible &&
      value.display === 'numbers' && value.text.includes('77%'), '数字模式隐藏角色并保留额度');
    const gameOff = await until(state, value => !value.visible, '数字模式游戏接收暂停');
    await wait(220);
    assert.equal((await state()).time, gameOff.time, '数字模式关闭趣味停游戏时钟');
    assert.equal((await numberView()).entry.entryTime, numericOff.entry.entryTime, '数字模式关闭趣味停角色时钟');
    await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()'); await wait(50);
    assert.equal(guard.isVisible(), false, '数字模式关闭后旧桥拒绝重开');
    funMenu().click({ checked: true });
    assert.equal(readSettings().codexQuotaFunEnabled, true, '数字模式恢复保存可重读');
    await until(numberView, value => !value.hidden && value.entry.visible, '数字模式恢复角色');
    assert.equal(guard.isVisible(), false, '数字模式恢复开关不自动弹游戏');
    await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
    await until(state, value => guard.isVisible() && value.visible, '数字模式重新进入游戏');
    assert.equal((await state()).round, ringGame.round, '数字模式趣味开关保留同局');
    numericChecks.push({ toggle: true, round: ringGame.round, savedOff: false, savedOn: true });
    if (shortcuts) for (const showNumbers of [true, false]) {
      guard.close();
      getSettings().quotaDisplay = { ...getSettings().quotaDisplay, showNumbers }; sync();
      await until(() => card.isVisible(), value => value === showNumbers, '数字显隐按样式偏好更新');
      await until(ringVisible, Boolean, '数字显隐不隐藏光环');
      assert.equal(funMenu().checked, true, '数字关闭时趣味菜单仍可达');
      if (!showNumbers) {
        for (const checked of [false, true]) {
          funMenu().click({ checked });
          assert.equal(readSettings().codexQuotaFunEnabled, checked);
          assert.equal(getSettings().quotaDisplay.showNumbers, false);
          assert.equal(card.isVisible(), false, '趣味开关不强制恢复用户已关闭的数字');
        }
      }
      openShortcuts();
      assert.equal(card.isVisible(), false, '光环快捷展开立即隐藏数字与角色');
      await until(() => shortcuts.isOpen() && shortcuts.getWindow()?.isVisible(), Boolean, '光环样式快捷展开');
      await until(ringVisible, Boolean, '快捷展开保留球球光环外观');
      const pausedEntry = (await numberView()).entry.entryTime;
      callbacks.onQuota(fixture()); sync(); await wait(100);
      assert.equal(card.isVisible(), false, '光环样式刷新不重显快捷下数字');
      assert.equal(await ringVisible(), true, '光环样式刷新保持快捷下球体外观');
      assert.equal((await numberView()).entry.entryTime, pausedEntry, '光环快捷下角色停钟');
      shortcuts.close();
      assert.equal(shortcuts.getState().animation.duration, 180);
      assert.equal(card.isVisible(), false);
      await wait(75);
      assert.equal(shortcuts.isPresenting(), true, '光环样式收起动画中仍持有呈现状态');
      assert.equal(card.isVisible(), false);
      assert.equal(await ringVisible(), true, '180ms收起动画期间保持光环外观');
      await until(() => shortcuts.isPresenting(), value => !value, '光环样式快捷收起完成');
      await until(ringVisible, Boolean, '收起结束后光环恢复');
      await until(() => card.isVisible(), value => value === showNumbers, '收起结束按原数字偏好恢复');
      assert.equal(getSettings().quotaDisplay.showNumbers, showNumbers);
      assert.equal(guard.isVisible(), false, '收起快捷不自动重开游戏');
      numericChecks.push({ showNumbers, shortcutHidden: true, restoredAfterClosing: true });
    }
    if (shortcuts) for (const style of ['pool', 'ring', 'duo', 'split', 'stages']) {
      guard.close(); getSettings().quotaDisplay = { ...getSettings().quotaDisplay, style }; sync();
      await until(() => pet.webContents.executeJavaScript(`Boolean(document.querySelector('.quota-effects[data-style="${style}"]'))`), Boolean, `${style} 真实球体额度效果显示`);
      await pet.webContents.executeJavaScript(`(() => {
        const node = document.querySelector('.quota-effects'); window.__r18QuotaRemovals = [];
        window.__r18QuotaObserver = new MutationObserver(records => {
          for (const record of records) if ([...record.removedNodes].includes(node)) window.__r18QuotaRemovals.push(performance.now());
        }); window.__r18QuotaObserver.observe(document.querySelector('#pet'), { childList: true, subtree: true });
      })()`);
      for (const settingsView of [false, true]) {
        openShortcuts(settingsView);
        await until(() => shortcuts.isOpen() && shortcuts.getWindow()?.isVisible(), Boolean, `${style} 快捷窗口显示`);
        assert.equal(await pet.webContents.executeJavaScript(`Boolean(document.querySelector('.quota-effects[data-style="${style}"]'))`), true);
        shortcuts.close(); await until(() => shortcuts.isPresenting(), value => !value, '额度外观检查收起完成');
      }
      const removed = await pet.webContents.executeJavaScript('window.__r18QuotaObserver.disconnect();window.__r18QuotaRemovals');
      assert.deepEqual(removed, [], `${style} 打开设置/按钮及收起全过程未恢复默认球体`);
      numericChecks.push({ style, quotaEffectRetainedThroughSettingsAndButtons: true, removed });
    }
  } finally {
    shortcuts?.interrupt(); guard.close();
    getSettings().quotaDisplay = originalDisplay; sync();
  }
  await until(() => card.isVisible(), Boolean, '恢复原经典卡配置');
  await until(() => card.webContents.executeJavaScript("document.querySelector('#quota-label').dataset.display"),
    value => value === 'card', '经典卡模型恢复');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await until(state, value => guard.isVisible() && value.visible && value.quota === 77 && value.period === 300, '恢复原经典卡游戏流程');
  if (directory) fs.writeFileSync(path.join(directory, 'main-route-numeric.json'), JSON.stringify({ passed: true, numericChecks }, null, 2));
  process.stdout.write('PET_QUOTA_GUARD_NUMERIC_OK\n');
  const before = await state();
  callbacks.onQuota(fixture());
  await wait(150);
  assert.equal((await state()).round, before.round, '同值定时刷新不能重开局');
  ipcMain.emit('pet:quota-guard-close', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame });
  assert.equal(guard.isVisible(), true, '其它窗口不能冒充关闭来源');
  setTopmost(false); assert.equal(panel.isAlwaysOnTop(), false);
  setTopmost(true); assert.equal(panel.isAlwaysOnTop(), true);
  await pointerClick(panel, '#guard-restart');
  await wait(1800);
  const automatic = await state();
  assert.ok(automatic.autoShots > 0 && automatic.hits > 0);
  assert.equal(automatic.playerHits, 0, '自动攻击不计手动命中');
  await pointerClick(panel, '#guard-qiuqiu');
  await until(state, value => value.playerHits > 0, '未结束局手动命中');
  await pointerClick(panel, '#guard-pause');
  const unfinished = await state();
  assert.equal(unfinished.paused, true); assert.equal(unfinished.outcome, null);
  await panel.webContents.executeJavaScript('window.petQuotaGuard.close()');
  await until(state, value => !value.visible, '未结束局可信关闭');
  await wait(220); assert.equal((await state()).time, unfinished.time, '未结束局关闭停钟');
  await until(() => card.isVisible(), Boolean, '未结束局关闭后原卡恢复');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  const continued = await until(state, value => guard.isVisible() && value.visible, '未结束局重开');
  for (const key of ['round', 'time', 'playerHits', 'outcome', 'paused', 'quota', 'period']) {
    assert.equal(continued[key], unfinished[key], '未结束局重开保留' + key);
  }
  await pointerClick(panel, '#guard-pause');
  await pointerClick(panel, '#guard-restart');
  for (let inputs = 0; (await state()).playerHits < 30 && inputs < 90; inputs++) {
    const previous = await state();
    await pointerClick(panel, '#guard-qiuqiu'); await wait(110);
    if ((await state()).clickShots === previous.clickShots) continue;
    const hit = await until(state, value => value.playerHits > previous.playerHits, '手动攻击命中');
    assert.equal(hit.quota, 77, '游戏不改额度');
    if (hit.playerHits < 30) assert.equal(hit.outcome, null);
  }
  const won = await until(state, value => value.outcome === 'qiuqiu', '三十次命中胜利');
  assert.equal(won.playerHits, 30); assert.equal(won.clickShots, 30);
  await until(state, value => value.endingProgress === 1, '胜利动画完成');
  assert.equal(await panel.webContents.executeJavaScript("getComputedStyle(document.querySelector('#guard-grave')).opacity"), '1');
  await capture(panel, 'main-route-victory');
  callbacks.onQuota(fixture()); await wait(150);
  assert.equal((await state()).round, won.round, '胜局可见时同值刷新不自动重开');
  assert.equal((await state()).outcome, 'qiuqiu');
  await panel.webContents.executeJavaScript('window.petQuotaGuard.close()');
  await until(() => guard.isVisible(), value => !value, '可信关闭');
  const closed = await state(); await wait(220);
  assert.equal((await state()).time, closed.time, '关闭时游戏时钟冻结');
  await until(() => card.isVisible(), Boolean, '关闭后原卡恢复');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  const reopened = await until(state, value => guard.isVisible() && value.visible && value.round === closed.round + 1 &&
    value.outcome === null && value.playerHits === 0, '已结束局重开自动开始新局');
  assert.equal(guard.getWindow(), panel, '重用同一窗口');
  assert.equal(reopened.quota, 77); assert.equal(reopened.period, 300); assert.equal(reopened.paused, false);
  setPreference('codexQuotaPeriod', 'weekly');
  await until(state, value => value.quota === 62 && value.period === 10080 && value.round > reopened.round, '原菜单切周期同步');
  setPreference('codexQuotaAlwaysVisible', false);
  await until(() => guard.isVisible(), value => !value, '原卡关闭同步隐藏游戏');
  setPreference('codexQuotaAlwaysVisible', true); sync();
  await until(() => card.isVisible(), Boolean, '原卡恢复显示');
  ipcMain.emit('pet:quota-guard-open', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame });
  assert.equal(guard.isVisible(), false, '其它窗口不能冒充入口来源');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await until(() => guard.isVisible(), Boolean, '第二次入口');
  hidePet(); await until(() => guard.isVisible(), value => !value, '宠物隐藏联动');
  restorePet(); sync(); await until(() => card.isVisible(), Boolean, '宠物恢复联动');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await until(() => guard.isVisible(), Boolean, '锁屏前入口');
  powerMonitor.emit('lock-screen'); assert.equal(guard.isVisible(), false, '锁屏关闭游戏');
  powerMonitor.emit('unlock-screen');
  assert.equal(getCompanion().getSnapshot().quota.windows.find(item => item.windowMinutes === 300).remaining, 77);
  assert.equal(getCompanion().getSnapshot().quota.windows.find(item => item.windowMinutes === 10080).remaining, 62);
  getSettings().codexEnabled = false;
  await getCompanion().setEnabled(false); sync();
  if (directory) fs.writeFileSync(path.join(directory, 'integration-checks.json'), JSON.stringify({
    ok: true, crossPanelSwitch: Boolean(shortcuts), shortcutQuota, numericChecks, panelLayout, automatic, unfinished, continued, won, reopened,
    checks: ['trusted-entry-and-selected-quota', 'shortcut-hover-suppression-and-explicit-switch',
      'shortcut-floating-list-settings-hide-quota-and-role', 'quota-refresh-does-not-reveal-during-shortcuts',
      'shortcut-close-180ms-keeps-quota-hidden', 'shortcut-close-preserves-user-disabled-quota',
      'numeric-quota-fun-toggle-saves-pauses-and-keeps-round', 'ring-shortcut-hide-restore-preserves-number-preference',
      'same-value-refresh-keeps-round', 'foreign-close-rejected', 'always-on-top',
      'automatic-hits-do-not-score', '30-manual-hits-and-victory-animation',
      'unfinished-close-freezes-and-reopen-keeps-round', 'completed-close-reopen-starts-new-round', 'period-switch-resets-round',
      'quota-disable-and-pet-hide', 'lock-screen-closes', 'real-quota-unchanged']
  }, null, 2) + '\n');
  process.stdout.write('PET_QUOTA_GUARD_INTEGRATION_OK\n');
}
module.exports = { verifyQuotaGuardIntegration };
