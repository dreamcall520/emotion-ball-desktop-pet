const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Codex 原生验收助手只在显式 smoke 模式下可运行', async () => {
  const file = path.resolve(__dirname, '../scripts/verify-codex-companion.js');
  assert.equal(fs.existsSync(file), true, '需要明确使用模拟数据的原生验收助手');
  const { verifyCodexCompanion } = require(file);
  await assert.rejects(verifyCodexCompanion({}), /显式冒烟/);
});

test('原生布局校验拒绝第三行、溢出按钮与过小字体', () => {
  const file = path.resolve(__dirname, '../scripts/verify-codex-companion.js');
  assert.equal(fs.existsSync(file), true);
  const { assertBubbleLayout } = require(file);
  const fixture = { font: '14px', lineCount: 2, fits: true, buttons: ['去看看', '知道啦'] };
  assert.doesNotThrow(() => assertBubbleLayout(fixture));
  for (const patch of [{ lineCount: 3 }, { fits: false }, { font: '10px' }, { buttons: [] }]) {
    assert.throws(() => assertBubbleLayout({ ...fixture, ...patch }));
  }
});

test('真实启动流程必须调用并要求 Codex 模拟验收完成标记', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const smoke = fs.readFileSync(path.resolve(__dirname, '../scripts/smoke-electron.js'), 'utf8');
  assert.match(main, /verifyCodexCompanion\(/);
  assert.match(main, /verifyCodexCompanion\(\{[\s\S]*?\bquotaLabel\b[\s\S]*?\}\)/,
    '原生验收入口必须传入当前额度标签控制器');
  assert.match(smoke, /CODEX_SIMULATED/);
  assert.match(smoke, /CODEX_SIZE_/);
  for (const marker of [
    'CODEX_QUOTA_SIZE_80', 'CODEX_QUOTA_SIZE_120', 'CODEX_QUOTA_SIZE_180',
    'CODEX_QUOTA_SIZE_260', 'CODEX_QUOTA_POLICY', 'CODEX_QUOTA_LABEL'
  ]) assert.match(smoke, new RegExp(marker));
});

test('额度标签原生校验要求可见、不聚焦、176×54 且不与球球相交', () => {
  const { assertQuotaLabelWindow } = require('../scripts/verify-codex-companion');
  const petBounds = { x: 300, y: 300, width: 80, height: 80 };
  const win = {
    isFocusable: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 252, y: 388, width: 176, height: 54 })
  };
  assert.doesNotThrow(() => assertQuotaLabelWindow(win, petBounds));
  assert.throws(() => assertQuotaLabelWindow({ ...win, isFocusable: () => true }, petBounds), /聚焦/);
  assert.throws(() => assertQuotaLabelWindow({ ...win, getBounds: () => ({ x: 300, y: 300, width: 176, height: 54 }) }, petBounds), /相交/);
  assert.throws(() => assertQuotaLabelWindow({ ...win, getBounds: () => ({ x: 252, y: 388, width: 175, height: 54 }) }, petBounds), /176×54/);
});

test('普通 10% 合成额度先建立 100% 基线，80% 以上可直接合成', () => {
  const { syntheticQuotaSteps } = require('../scripts/verify-codex-companion');
  assert.deepEqual(syntheticQuotaSteps(10), [100, 90]);
  assert.deepEqual(syntheticQuotaSteps(80), [20]);
  assert.deepEqual(syntheticQuotaSteps(90), [10]);
  assert.deepEqual(syntheticQuotaSteps(100), [0]);
});

test('原生助手验收任务菜单与名称开关且不具备真实任务写入行为', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../scripts/verify-codex-companion.js'),
    'utf8'
  );
  assert.match(source, /PET_CODEX_TASK_MENU_OK/);
  assert.match(source, /PET_CODEX_TASK_TITLE_OK/);
  assert.match(source, /getMenuItemById\('codex-recent'\)/);
  assert.match(source, /getMenuItemById\('codex-task-names'\)/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_80_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_120_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_180_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_260_OK/);
  assert.match(source, /PET_CODEX_QUOTA_POLICY_OK/);
  assert.match(source, /PET_CODEX_QUOTA_LABEL_OK/);
  assert.match(source, /codex-quota-visible/);
  assert.match(source, /codex-quota-auto/);
  assert.match(source, /codex-quota-five-hour/);
  assert.match(source, /codex-quota-weekly/);
  assert.match(source, /\['light', 'dark'\]/);
  assert.match(source, /quota-label-\$\{scheme\}/);
  assert.match(source, /severity/);
  assert.doesNotMatch(source, /createThread|create_thread|sendMessageToThread|send_message_to_thread|turn\/start|model\/start/);
});
