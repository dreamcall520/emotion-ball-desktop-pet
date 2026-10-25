const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('settings keeps independent WorkBuddy navigation and the native checkbox action id', () => {
  const source = fs.readFileSync(path.join(__dirname, '../global-settings-renderer.js'), 'utf8');
  const start = source.indexOf('  function groups() {'), end = source.indexOf('  function externalIcon()', start);
  assert.ok(start >= 0 && end > start);
  const toggle = { id: '/workbuddy-enabled', label: '启用 WorkBuddy 联动', type: 'checkbox', checked: false };
  const snapshot = { entries: [{ id: '/codex-menu', label: 'Codex 与 API', children: [] }, toggle] };
  const groups = vm.runInNewContext(`${source.slice(start, end)};groups()`, { snapshot });
  assert.deepEqual(Array.from(groups, g => g.label), ['Codex 与 API', 'WorkBuddy']);
  assert.equal(groups[1].children[0], toggle);
  assert.match(source, /'启用 WorkBuddy 联动':/);
});
