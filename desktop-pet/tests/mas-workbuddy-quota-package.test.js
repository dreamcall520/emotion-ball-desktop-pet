'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const release = require('../scripts/mas-release-profile');
const files = [
  'desktop-pet/workbuddy-label.html', 'desktop-pet/workbuddy-label-renderer.js',
  'desktop-pet/workbuddy-label-preload.js', 'desktop-pet/workbuddy-label.css',
  'desktop-pet/workbuddy-details.html', 'desktop-pet/workbuddy-details-renderer.js',
  'desktop-pet/workbuddy-details-preload.js', 'desktop-pet/workbuddy-details.css',
  'desktop-pet/lib/workbuddy-quota.js', 'desktop-pet/lib/workbuddy-quota-status.js',
  'desktop-pet/lib/workbuddy-auth-watch.js', 'desktop-pet/lib/workbuddy-client.js',
  'desktop-pet/lib/workbuddy-helper.cjs', 'desktop-pet/lib/workbuddy-usage.js',
  'desktop-pet/lib/workbuddy-usage-reader.js', 'desktop-pet/lib/workbuddy-label-window.js',
  'desktop-pet/lib/workbuddy-details-window.js', 'desktop-pet/lib/workbuddy-website-summary.js',
  'desktop-pet/lib/mas-workbuddy-details.js', 'desktop-pet/lib/mas-workbuddy-quota-connection.js',
  'desktop-pet/lib/mas-installed-workbuddy-access.js', 'desktop-pet/lib/mas-installed-workbuddy.js',
  'desktop-pet/assets/integrations/workbuddy.png'
];
const excluded = [
  'desktop-pet/workbuddy-consent.html', 'desktop-pet/workbuddy-tasks-renderer.js',
  'desktop-pet/workbuddy-guard-entry.html', 'desktop-pet/lib/workbuddy-chat.js',
  'desktop-pet/lib/workbuddy-tasks-reader.js', 'desktop-pet/lib/workbuddy-guard-entry-window.js',
  'desktop-pet/lib/mas-workbuddy-provider.js', 'desktop-pet/lib/workbuddy-web-quota.js',
  'desktop-pet/lib/workbuddy-official-connection.js', 'desktop-pet/lib/workbuddy-cli-connection.js',
  'desktop-pet/lib/mas-bundled-workbuddy.js', 'desktop-pet/lib/mas-workbuddy-tasks.js',
  'desktop-pet/scripts/verify-workbuddy-integration.js', 'desktop-pet/scripts/prepare-mas-workbuddy-helper.js',
  'desktop-pet/assets/workbuddy-desktop-hook/metadata.sh', 'desktop-pet/vendor/workbuddy-cli/package.json'
];
function staging(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-workbuddy-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of [...files, ...excluded]) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, name === 'desktop-pet/workbuddy-details.html'
      ? '<script src="workbuddy-tasks-renderer.js"></script><script src="workbuddy-details-renderer.js"></script>' : name);
  }
  fs.writeFileSync(path.join(root, 'NOTICE.md'), '# Notice\n\n## WorkBuddy integration reference\nMIT credit\n');
  return root;
}
test('MAS staging保留额度和用量依赖，剔除网站/CLI/任务/游戏及厂商运行时', t => {
  const root = staging(t);
  release.trimStaging(root, { releaseProfile: 'mas-first' });
  for (const name of files) assert.ok(fs.existsSync(path.join(root, name)), name);
  for (const name of excluded) assert.equal(fs.existsSync(path.join(root, name)), false, name);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'desktop-pet/workbuddy-details.html'), 'utf8'), /workbuddy-tasks-renderer/);
  assert.match(fs.readFileSync(path.join(root, 'desktop-pet/workbuddy-details.html'), 'utf8'), /workbuddy-details-renderer/);
  assert.match(fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), /WorkBuddy integration reference/);
  assert.deepEqual(release.resourceNames({ releaseProfile: 'mas-first' }), []);
});
test('非MAS首发裁剪不改变官网WorkBuddy资源', t => {
  const root = staging(t);
  assert.deepEqual(release.trimStaging(root, {}), []);
  for (const name of [...files, ...excluded]) assert.ok(fs.existsSync(path.join(root, name)), name);
  assert.match(fs.readFileSync(path.join(root, 'desktop-pet/workbuddy-details.html'), 'utf8'), /workbuddy-tasks-renderer/);
});
test('真实额度模块在裁剪后的目录可加载，quotaOnly卡片无需被剔除的游戏模块', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-workbuddy-require-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '../lib'), path.join(root, 'desktop-pet/lib'), { recursive: true });
  release.trimStaging(root, { releaseProfile: 'mas-first' });
  for (const name of ['workbuddy-quota', 'workbuddy-usage', 'workbuddy-helper.cjs', 'workbuddy-label-window', 'workbuddy-details-window', 'mas-workbuddy-quota-connection', 'mas-installed-workbuddy-access', 'mas-installed-workbuddy']) {
    assert.doesNotThrow(() => require(path.join(root, 'desktop-pet/lib', name)), name);
  }
  const card = require(path.join(root, 'desktop-pet/lib/workbuddy-label-window')).createWorkBuddyLabelWindow({ quotaOnly: true });
  card.destroy();
});
