const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULTS,
  normalizeSettings,
  loadSettings,
  saveSettings
} = require('../lib/settings');

test('无效设置回退默认值', () => {
  assert.deepEqual(
    normalizeSettings({ size: 'huge', x: 'bad', alwaysOnTop: 0 }),
    DEFAULTS
  );
});

test('损坏文件回退且有效设置可回读', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');

  fs.writeFileSync(file, '{bad json');
  assert.deepEqual(loadSettings(file), DEFAULTS);

  saveSettings(file, { size: 'tiny', x: 12, y: 20, alwaysOnTop: false });
  assert.deepEqual(loadSettings(file), {
    size: 'tiny',
    x: 12,
    y: 20,
    alwaysOnTop: false
  });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
