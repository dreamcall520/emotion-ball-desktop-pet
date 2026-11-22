'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStaging } = require('../scripts/package-mac');
const release = require('../scripts/mas-release-profile');
const ROOT = path.resolve(__dirname, '../..');
const MODULES = [
  'mas-installed-zcode-access.js', 'mas-installed-zcode.js', 'zcode-helper.cjs',
  'mas-zcode-provider.js', 'mas-zcode-quota-connection.js', 'mas-zcode-event-installation.js',
  'mas-zcode-task-notifications.js', 'mas-zcode-turn-status.js', 'zcode-desktop-task-state.js',
  'zcode-desktop-event-bridge.js', 'zcode-account.js', 'zcode-usage.js', 'zcode-team-auth.js',
  'zcode-companion.js', 'zcode-quota-history.js', 'zcode-quota-view.js'
];
const HOOK_ROOT = 'desktop-pet/assets/zcode-desktop-hook';
const HOOK_FILES = ['plugins/qiuqiu-zcode-task-events/scripts/emit-metadata.sh', 'plugins/qiuqiu-zcode-task-events/hooks/hooks.json'];
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-zcode-staging-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(root, relative, content = 'fixture') {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
function filesIn(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? filesIn(root, relative) : [relative];
  }).sort();
}

test('真实staging裁剪后可加载ZCode额度/任务模块且只保留两份自有hook资源', t => {
  const staging = temporary(t);
  prepareStaging(ROOT, staging, { weatherNative: false, pluginNative: false });
  release.trimStaging(staging, { releaseProfile: 'mas-first' });
  for (const name of MODULES) {
    const relative = 'desktop-pet/lib/' + name;
    assert.deepEqual(fs.readFileSync(path.join(staging, relative)), fs.readFileSync(path.join(ROOT, relative)), relative);
    assert.doesNotThrow(() => require(path.join(staging, relative)), relative);
  }
  for (const relative of HOOK_FILES) assert.deepEqual(fs.readFileSync(path.join(staging, HOOK_ROOT, relative)), fs.readFileSync(path.join(ROOT, HOOK_ROOT, relative)));
  assert.deepEqual(filesIn(path.join(staging, HOOK_ROOT)), [...HOOK_FILES].sort());
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(staging, HOOK_ROOT, HOOK_FILES[1]), 'utf8')));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8')).dependencies), ['ws']);
  assert.deepEqual(fs.readdirSync(path.join(staging, 'node_modules')), ['ws']);
  assert.deepEqual(release.resourceNames({ releaseProfile: 'mas-first' }), []);
  for (const name of ['mas-installed-workbuddy', 'mas-workbuddy-quota-connection', 'mas-workbuddy-task-notifications', 'mas-installed-codex', 'mas-installed-codex-access']) {
    assert.doesNotThrow(() => require(path.join(staging, 'desktop-pet/lib', name)), name);
  }
  for (const name of ['codex-details.html', 'quota-card-group.html', 'quota-label.html', 'quota-guard.html', 'chat.html', 'global-settings.html']) {
    const relative = 'desktop-pet/' + name, content = fs.readFileSync(path.join(staging, relative), 'utf8');
    assert.equal(content, fs.readFileSync(path.join(ROOT, relative), 'utf8'));
    for (const [, ref] of content.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (!/^(?:\w+:|#)/.test(ref)) assert.ok(fs.existsSync(path.resolve(staging, 'desktop-pet', ref)), relative + ' -> ' + ref);
    }
  }
  const icon = 'desktop-pet/assets/integrations/zcode.png';
  assert.deepEqual(fs.readFileSync(path.join(staging, icon)), fs.readFileSync(path.join(ROOT, icon)));
});

test('MAS仅带来源过滤脚本与hook声明，删除marketplace和任何额外同级资源', t => {
  const staging = temporary(t);
  const excluded = ['.claude-plugin/marketplace.json', 'plugins/qiuqiu-zcode-task-events/.zcode-plugin/plugin.json',
    'plugins/qiuqiu-zcode-task-events/scripts/extra.sh', 'plugins/qiuqiu-zcode-task-events/README.md', 'metadata.sh'];
  for (const relative of [...HOOK_FILES, ...excluded]) write(staging, path.posix.join(HOOK_ROOT, relative));
  for (const relative of ['desktop-pet/vendor/zcode/package.json', 'desktop-pet/vendor/zcode-runtime/bin/node']) write(staging, relative);
  release.trimStaging(staging, { releaseProfile: 'mas-first' });
  assert.deepEqual(filesIn(path.join(staging, HOOK_ROOT)), [...HOOK_FILES].sort());
  for (const relative of ['desktop-pet/vendor/zcode', 'desktop-pet/vendor/zcode-runtime']) assert.equal(fs.existsSync(path.join(staging, relative)), false);
});

test('厂商ZCode应用与运行时不能进入MAS首发Resources', t => {
  const root = temporary(t), config = { releaseProfile: 'mas-first' };
  assert.doesNotThrow(() => release.assertNoBundledProviders(root, config));
  for (const name of ['qiuqiu-codex', 'qiuqiu-workbuddy', 'qiuqiu-zcode', 'ZCode.app', 'glm']) {
    const directory = path.join(root, 'Contents/Resources', name); fs.mkdirSync(directory, { recursive: true });
    assert.throws(() => release.assertNoBundledProviders(root, config), { code: 'MAS_FIRST_BUNDLED_RUNTIME_PRESENT' }, name);
    fs.rmSync(directory, { recursive: true });
  }
});

test('非MAS首发不裁剪官网既有ZCode插件资源或改变原有bundled来源', t => {
  const staging = temporary(t);
  const files = [...HOOK_FILES, '.claude-plugin/marketplace.json', 'plugins/qiuqiu-zcode-task-events/.zcode-plugin/plugin.json'];
  for (const relative of files) write(staging, path.posix.join(HOOK_ROOT, relative));
  assert.deepEqual(release.trimStaging(staging, {}), []);
  for (const relative of files) assert.ok(fs.existsSync(path.join(staging, HOOK_ROOT, relative)));
  assert.deepEqual(release.resourceNames({}), ['qiuqiu-codex', 'qiuqiu-workbuddy']);
});
