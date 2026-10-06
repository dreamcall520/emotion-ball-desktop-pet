const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeAppearance, appearanceContentKey } = require('../lib/customization');
const { normalizeSettings, normalizeAppearancePresets, saveSettings, loadSettings } = require('../lib/settings');

const id = `codex-${'a'.repeat(64)}`, otherId = `codex-${'b'.repeat(64)}`;
const pet = { shape: 'codex-pet', codexPetId: id, auroraTransparency: 22 };
const runtime = { spritesheetPath: '/private/runtime-only.webp', imageURL: 'file:///private/runtime-only.webp',
  codexPet: { id, name: '临时描述', imageURL: 'file:///private/runtime-only.webp' } };

test('Codex 外观只接受 opaque id，隐藏球球颜色不参与内容重复判断', () => {
  assert.equal(normalizeAppearance(pet).shape, 'codex-pet');
  assert.equal(normalizeAppearance(pet).codexPetId, id);
  for (const codexPetId of ['../pet.json', 'codex-abc', `codex-${'A'.repeat(64)}`, null]) {
    const invalid = normalizeAppearance({ ...pet, codexPetId });
    assert.equal(invalid.shape, 'blob'); assert.equal(Object.hasOwn(invalid, 'codexPetId'), false);
  }
  assert.equal(normalizeAppearance({ ...pet, auroraTransparency: 99 }).auroraTransparency, 60);
  assert.equal(appearanceContentKey(pet), appearanceContentKey({ ...pet, bodyColor: '#123456', eyeColor: '#FEDCBA', ...runtime }));
  assert.notEqual(appearanceContentKey(pet), appearanceContentKey({ ...pet, codexPetId: otherId }));
  assert.notEqual(appearanceContentKey(pet), appearanceContentKey({ ...pet, auroraTransparency: 23 }));
});

test('当前与启动外观分别保存并重读，路径、URL 与 runtime 描述不进入设置或预设', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-codex-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const startup = { ...pet, codexPetId: otherId, auroraTransparency: 41 };
  const preset = { id: '00000000-0000-4000-8000-000000000001', name: '宠物预设', ...runtime, appearance: { ...pet, ...runtime } };
  const normalized = normalizeSettings({ customization: { appearance: { ...pet, ...runtime } },
    startupAppearance: { ...startup, ...runtime }, appearancePresets: [preset], ...runtime });
  saveSettings(file, normalized);
  const saved = loadSettings(file);
  assert.equal(saved.customization.appearance.codexPetId, id);
  assert.equal(saved.customization.appearance.auroraTransparency, 22);
  assert.equal(saved.startupAppearance.codexPetId, otherId);
  assert.equal(saved.startupAppearance.auroraTransparency, 41);
  assert.equal(saved.appearancePresets[0].appearance.codexPetId, id);
  assert.equal(saved.appearancePresets[0].appearance.shape, 'codex-pet');
  assert.deepEqual(saved.appearancePresets, normalizeAppearancePresets([preset]));
  for (const key of Object.keys(runtime)) {
    assert.equal(Object.hasOwn(saved, key), false);
    for (const appearance of [saved.customization.appearance, saved.startupAppearance, saved.appearancePresets[0].appearance]) assert.equal(Object.hasOwn(appearance, key), false);
    assert.equal(Object.hasOwn(saved.appearancePresets[0], key), false);
  }
  assert.equal(fs.readFileSync(file, 'utf8').includes('runtime-only'), false);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('旧四种球球设置照常读取，切回球球不覆盖已指定的 Codex 启动外观', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-codex-legacy-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  for (const shape of ['blob', 'cloud', 'aurora-cloud', 'square']) {
    fs.writeFileSync(file, JSON.stringify({ customization: { appearance: { shape } } }));
    const legacy = loadSettings(file);
    assert.equal(legacy.customization.appearance.shape, shape);
    assert.equal(legacy.startupAppearance.shape, shape);
    saveSettings(file, { ...legacy, startupAppearance: pet });
    const current = loadSettings(file);
    assert.equal(current.customization.appearance.shape, shape);
    assert.equal(current.startupAppearance.codexPetId, id);
  }
});
