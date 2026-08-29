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
  assert.match(smoke, /CODEX_SIMULATED/);
  assert.match(smoke, /CODEX_SIZE_/);
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
  assert.doesNotMatch(source, /createThread|create_thread|sendMessageToThread|send_message_to_thread|turn\/start|model\/start/);
});
