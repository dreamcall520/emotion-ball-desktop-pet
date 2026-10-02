const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('尺寸菜单按大小命名并保留紧凑尺寸', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const sizeMenu = main.match(/function sizeMenu\(\)[\s\S]*?\n}/)?.[0] || '';
  const entries = [...sizeMenu.matchAll(/\['([^']+)', '([^']+)'\]/g)]
    .map(([, value, label]) => [value, label]);

  assert.deepEqual(entries, [
    ['micro', '袖珍（60 × 60）'],
    ['tiny', '迷你（80 × 80）'],
    ['compact', '紧凑（108 × 108）'],
    ['small', '标准（120 × 120）'],
    ['medium', '大（180 × 180）'],
    ['large', '特大（260 × 260）']
  ]);
});
