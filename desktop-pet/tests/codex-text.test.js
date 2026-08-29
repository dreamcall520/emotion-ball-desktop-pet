const test = require('node:test');
const assert = require('node:assert/strict');
const {
  plainText, menuText, alertTaskTitle, completionText
} = require('../lib/codex-text');

test('纯文本清理会移除控制符和方向控制符并合并空白', () => {
  assert.equal(plainText('  A\n\tB\u0000\u202e C\u0085  '), 'A B C');
});

test('纯文本截断按 Unicode code point 保留 emoji 完整字符', () => {
  assert.equal(plainText('😀😀😀', 2), '😀…');
});

test('纯文本超长时使用安全 fallback 并按上限截断', () => {
  assert.equal(plainText(null, 4, '默认任务'), '默认任务');
  assert.equal(plainText('', 3, '默认任务'), '默认…');
});

test('菜单文本转义和纯文本清理后的和号', () => {
  assert.equal(menuText(' A&B\nC ', 40), 'A&&B C');
});

test('提醒标题最多18个 Unicode 字符且过滤未命名兜底', () => {
  assert.equal(alertTaskTitle('😀'.repeat(20)), '😀'.repeat(17) + '…');
  assert.equal(alertTaskTitle('  未命名任务\n'), null);
  assert.equal(alertTaskTitle('\u0000\u202e\n'), null);
});

test('关闭名称或无可靠名称时保持通用完成文案', () => {
  assert.equal(completionText(['任务A'], 1, false), '这轮有结果啦，去看看？');
  assert.equal(completionText([null, '未命名任务'], 2, true), '有 2 轮出结果啦\n去看看？');
});

test('单任务开启名称时展示清理后的标题', () => {
  assert.equal(completionText(['  任务A\n'], 1, true), '《任务A》有结果啦\n去看看？');
});

test('多任务最多展示两个去重名称并保留真实任务数', () => {
  assert.equal(completionText(['任务A', '任务A', '任务B', '任务C'], 4, true), '《任务A》《任务B》等 4 个任务有结果啦\n去看看？');
});

test('多任务名称过长时回退到一个名称加总数，再放不下时使用通用文案', () => {
  assert.equal(completionText(['甲'.repeat(18), '乙'.repeat(18)], 2, true), `《${'甲'.repeat(18)}》等 2 个任务有结果啦\n去看看？`);
  assert.equal(completionText(['甲'.repeat(18), '乙'.repeat(18)], Number.MAX_SAFE_INTEGER, true), `有 ${Number.MAX_SAFE_INTEGER} 轮出结果啦\n去看看？`);
});

test('无输入数组和非法 maximum 安全返回', () => {
  assert.equal(plainText('任务', 'bad'), '任务');
  assert.equal(plainText('任务', 0), '');
  assert.equal(menuText(undefined, NaN), '');
  assert.equal(alertTaskTitle(undefined), null);
  assert.equal(completionText(undefined, 'bad', true), '这轮有结果啦，去看看？');
});
