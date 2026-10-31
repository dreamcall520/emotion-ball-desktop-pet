const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCodexPetStore } = require('../lib/codex-pets');

test('小白最终素材可独立导入并重读，三种庆祝和宽转圈均保留', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-xiaobai-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(__dirname, '../assets/pets/xiaobai');
  const importRoot = path.join(root, 'imported');
  const options = { sourceRoot: path.join(root, 'empty-source'), importRoot, namespace: 'local' };
  const store = createCodexPetStore(options);
  const pet = store.importDirectory(source);
  assert.equal(pet.name, '小白');
  assert.equal(pet.characterId, 'xiaobai');
  assert.equal(Object.keys(pet.sheets).length, 12);

  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'pet.json'), 'utf8'));
  let bytes = 0;
  for (const sheet of Object.values(manifest.sheets)) {
    const file = path.join(source, sheet.path);
    const data = fs.readFileSync(file);
    bytes += data.length;
    assert.ok(data.length <= 16 * 1024 * 1024);
    assert.equal(data.readUInt32BE(16), (sheet.frameWidth || 192) * 8 * 2);
    assert.equal(data.readUInt32BE(20), 208 * sheet.rows * 2);
  }
  assert.ok(bytes <= 64 * 1024 * 1024);
  assert.equal(manifest.sheets.spin.frameWidth, 300);
  for (const name of ['jump', 'happy', 'spin']) {
    const clip = manifest.frameMap[name];
    assert.equal(clip.count, 40);
    assert.equal(clip.loop, false);
    assert.equal(clip.durations.reduce((sum, value) => sum + value, 0), 3063);
    assert.ok(pet.frameMap[name]);
  }
  assert.equal(manifest.frameMap.running.count, 14);
  assert.equal(manifest.frameMap.running.loop, true);
  assert.equal(manifest.frameMap.sleep.loop, false);
  assert.equal(manifest.frameMap['sleep-lying'].loop, false);

  const reopened = createCodexPetStore(options).getImported(pet.id);
  assert.deepEqual(reopened, pet);
  assert.notEqual(path.dirname(pet.spritesheetPath), source);
});
