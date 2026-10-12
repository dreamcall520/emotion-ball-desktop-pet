const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  shortcuts, openShortcuts, screen, windows, BrowserWindow }) {
  const settings = getSettings();
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
  const directory = process.env.PET_SMOKE_ARTIFACT_DIR;
  async function capture(win, name) { if (directory) {
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await wait(40);
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG());
  } }
  await capture(card, 'main-route-card');
  windows.open();
  const timerPanel = await until(() => BrowserWindow.getAllWindows().find(win =>
    !win.isDestroyed() && /pomodoro\.html\?view=panel$/.test(win.webContents.getURL())),
    value => value?.isVisible(), '先打开番茄钟面板');
  const separated = win => {
    const a = timerPanel.getBounds(), b = win.getBounds();
    return a.x >= b.x + b.width || a.x + a.width <= b.x || a.y >= b.y + b.height || a.y + a.height <= b.y;
  };
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  const panel = await until(() => guard.getWindow(), value => guard.isVisible() && value?.isVisible(), '可信入口打开守护战');
  const state = () => panel.webContents.executeJavaScript('window.quotaGuardView?.state');
  await until(state, value => value?.spritesReady && value.ready && value.visible && value.quota === 77, '守护战接收所选真实模型');
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('#guard-number').textContent"), '77%');
  await until(() => separated(panel), Boolean, '已打开番茄钟避让后来守护战');
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
        await until(() => separated(quick), Boolean, '已打开番茄钟避让快捷面板');
        assert.equal(guard.isVisible(), false, '主动快捷入口先收起守护战');
        assert.equal(shortcuts.isPresenting(), true, '展开保持呈现 pin');
        await wait(50);
        const pausedEntry = await entryTime();
        assert.equal(typeof pausedEntry, 'number', '复用已有角色入口');
        callbacks.onQuota(fixture()); sync(); shortcuts.sync();
        await wait(110);
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
  await panel.webContents.executeJavaScript('window.petQuotaGuard.close()');
  await until(() => guard.isVisible(), value => !value, '可信关闭');
  const closed = await state(); await wait(220);
  assert.equal((await state()).time, closed.time, '关闭时游戏时钟冻结');
  await until(() => card.isVisible(), Boolean, '关闭后原卡恢复');
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  await until(() => guard.isVisible(), Boolean, '重开');
  assert.equal(guard.getWindow(), panel, '重用同一窗口');
  assert.equal((await state()).round, closed.round, '重开继续同局');
  setPreference('codexQuotaPeriod', 'weekly');
  await until(state, value => value.quota === 62 && value.period === 10080 && value.round > closed.round, '原菜单切周期同步');
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
    ok: true, crossPanelSwitch: Boolean(shortcuts), shortcutQuota, panelLayout, automatic, won,
    checks: ['trusted-entry-and-selected-quota', 'shortcut-hover-suppression-and-explicit-switch',
      'shortcut-floating-list-settings-hide-quota-and-role', 'quota-refresh-does-not-reveal-during-shortcuts',
      'shortcut-close-180ms-keeps-quota-hidden', 'shortcut-close-preserves-user-disabled-quota',
      'same-value-refresh-keeps-round', 'foreign-close-rejected', 'always-on-top',
      'automatic-hits-do-not-score', '30-manual-hits-and-victory-animation',
      'close-freezes-and-reopen-keeps-round', 'period-switch-resets-round',
      'quota-disable-and-pet-hide', 'lock-screen-closes', 'real-quota-unchanged']
  }, null, 2) + '\n');
  process.stdout.write('PET_QUOTA_GUARD_INTEGRATION_OK\n');
}
module.exports = { verifyQuotaGuardIntegration };
