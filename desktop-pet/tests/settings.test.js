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
    alwaysOnTop: false,
    keepAwake: false,
    bubblesEnabled: true,
    codexEnabled: false
  });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('旧配置保留尺寸位置置顶并补齐陪伴开关默认值', () => {
  assert.deepEqual(normalizeSettings({ size: 'small', x: -102.3, y: 81.8, alwaysOnTop: false }), {
    size: 'small', x: -102, y: 82, alwaysOnTop: false,
    keepAwake: false, bubblesEnabled: true, codexEnabled: false
  });
});

test('陪伴开关只接受布尔值且不保存输入信息', () => {
  assert.deepEqual(normalizeSettings({
    keepAwake: true, bubblesEnabled: false, inputText: '不保存', cursor: { x: 1, y: 2 }, idleSeconds: 99
  }), { ...DEFAULTS, keepAwake: true, bubblesEnabled: false });
  assert.deepEqual(normalizeSettings({ keepAwake: 'true', bubblesEnabled: 0 }), DEFAULTS);
});

test('陪伴开关保存后可回读且仅写入允许设置', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-companion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, { keepAwake: true, bubblesEnabled: false, inputText: '不保存' });
  assert.deepEqual(saved, { ...DEFAULTS, keepAwake: true, bubblesEnabled: false });
  assert.deepEqual(loadSettings(file), saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved);
  assert.equal(fs.readFileSync(file, 'utf8').includes('inputText'), false);
});

test('Codex 联动默认关闭且只接受布尔值', () => {
  assert.equal(DEFAULTS.codexEnabled, false);
  assert.equal(normalizeSettings({}).codexEnabled, false);
  for (const codexEnabled of ['true', 1, null, {}, []]) {
    assert.equal(normalizeSettings({ codexEnabled }).codexEnabled, false);
  }
  assert.deepEqual(normalizeSettings({ size: 'tiny', x: 12, y: 34, keepAwake: true, codexEnabled: true }), {
    ...DEFAULTS, size: 'tiny', x: 12, y: 34, keepAwake: true, codexEnabled: true
  });
});

test('Codex 只持久化开关，不保存账号或快照', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, { codexEnabled: true, accountKey: 'private', quota: {}, tasks: ['private'] });
  assert.deepEqual(saved, { ...DEFAULTS, codexEnabled: true });
  assert.deepEqual(loadSettings(file), saved);
  assert.equal(fs.readFileSync(file, 'utf8').includes('private'), false);
});
