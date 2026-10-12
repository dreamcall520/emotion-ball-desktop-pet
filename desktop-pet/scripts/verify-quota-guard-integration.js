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
  if (shortcuts) {
    const readCursor = screen.getCursorScreenPoint;
    const bounds = pet.getBounds(), cursor = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    try {
      screen.getCursorScreenPoint = () => cursor;
      shortcuts.sampleCursor(cursor); await wait(550);
      assert.equal(shortcuts.isOpen(), false, '守护战打开时悬停不覆盖游戏');
      const round = (await state()).round;
      openShortcuts();
      await until(() => ({ visible: shortcuts.getWindow()?.isVisible(), opened: shortcuts.isOpen(), state: shortcuts.getState() }),
        value => value.visible, '主动打开快捷入口');
      await until(() => separated(shortcuts.getWindow()), Boolean, '已打开番茄钟避让快捷面板');
      assert.equal(guard.isVisible(), false, '主动快捷入口先收起守护战');
      await until(() => card.isVisible(), Boolean, '主动快捷入口恢复额度卡');
      await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
      await until(() => guard.isVisible(), Boolean, '快捷后恢复守护战');
      assert.equal(shortcuts.isOpen(), false, '守护战打开立即收起快捷入口');
      assert.equal((await state()).round, round, '切换面板不重开游戏');
    } finally { screen.getCursorScreenPoint = readCursor; }
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
    ok: true, crossPanelSwitch: Boolean(shortcuts), panelLayout, automatic, won,
    checks: ['trusted-entry-and-selected-quota', 'shortcut-hover-suppression-and-explicit-switch',
      'same-value-refresh-keeps-round', 'foreign-close-rejected', 'always-on-top',
      'automatic-hits-do-not-score', '30-manual-hits-and-victory-animation',
      'close-freezes-and-reopen-keeps-round', 'period-switch-resets-round',
      'quota-disable-and-pet-hide', 'lock-screen-closes', 'real-quota-unchanged']
  }, null, 2) + '\n');
  process.stdout.write('PET_QUOTA_GUARD_INTEGRATION_OK\n');
}
module.exports = { verifyQuotaGuardIntegration };
