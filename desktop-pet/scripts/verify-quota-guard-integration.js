const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, label) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await wait(25); }
  throw new Error(label + '超时');
}

async function verifyQuotaGuardIntegration({ pet, label, guard, prepare, getCompanion, getSettings,
  sync, setPreference, setTopmost, hidePet, restorePet, ipcMain, powerMonitor }) {
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
  await card.webContents.executeJavaScript('window.petQuotaLabel.openGuard()');
  const panel = await until(() => guard.getWindow(), value => guard.isVisible() && value?.isVisible(), '可信入口打开守护战');
  const state = () => panel.webContents.executeJavaScript('window.quotaGuardView?.state');
  await until(state, value => value?.spritesReady && value.ready && value.visible && value.quota === 77, '守护战接收所选真实模型');
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('#guard-number').textContent"), '77%');
  await capture(panel, 'main-route-panel');
  const before = await state();
  callbacks.onQuota(fixture());
  await wait(150);
  assert.equal((await state()).round, before.round, '同值定时刷新不能重开局');
  ipcMain.emit('pet:quota-guard-close', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame });
  assert.equal(guard.isVisible(), true, '其它窗口不能冒充关闭来源');
  setTopmost(false); assert.equal(panel.isAlwaysOnTop(), false);
  setTopmost(true); assert.equal(panel.isAlwaysOnTop(), true);
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
  process.stdout.write('PET_QUOTA_GUARD_INTEGRATION_OK\n');
}
module.exports = { verifyQuotaGuardIntegration };
