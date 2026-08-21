const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('尺寸菜单依次显示极小、小、中、大', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const sizeMenu = main.match(/function sizeMenu\(\)[\s\S]*?\n}/)?.[0] || '';
  const entries = [...sizeMenu.matchAll(/\['([^']+)', '([^']+)'\]/g)]
    .map(([, value, label]) => [value, label]);

  assert.deepEqual(entries, [
    ['tiny', '极小（80 × 80）'],
    ['small', '小（120 × 120）'],
    ['medium', '中（180 × 180）'],
    ['large', '大（260 × 260）']
  ]);
});
