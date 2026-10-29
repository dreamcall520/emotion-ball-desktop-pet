const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStaging, buildPackagerOptions } = require('../scripts/package-mac');
const { weatherAcceptanceOptions } = require('../scripts/package-weather-acceptance');

test('weather acceptance unpacks the native bridge and formal packages share native requirements with distinct identities', () => {
  const normal = buildPackagerOptions('/repo', '/icon.icns', null), weather = weatherAcceptanceOptions('/repo', '/icon.icns', null);
  assert.deepEqual(normal.asar, { unpack: '**/*.node' });
  assert.deepEqual(normal.extendInfo, weather.extendInfo);
  assert.equal(normal.appBundleId, 'local.xiaokun.emotionball.pet');
  assert.equal(weather.name, '球球桌宠-天气验收');
  assert.equal(weather.appBundleId, 'local.xiaokun.emotionball.pet.weather-acceptance');
  assert.deepEqual(weather.asar, { unpack: '**/*.node' });
  assert.equal(weather.out, '/repo/dist/weather-acceptance');
  assert.match(weather.extendInfo.NSLocationWhenInUseUsageDescription, /手动/);
});
test('weather staging includes every local icon and license, and the native bridge by default', () => {
  const root = path.resolve(__dirname, '../..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-weather-package-'));
  const staged = path.join(temporary, 'weather'), standard = path.join(temporary, 'standard');
  try {
    prepareStaging(root, staged, { weatherNative: true });
    const prefix = 'desktop-pet/assets/weather/meteocons';
    const manifest = JSON.parse(fs.readFileSync(path.join(root, prefix, 'SOURCE.json'), 'utf8'));
    assert.equal(manifest.files.length, 48);
    for (const file of [...manifest.files.map(entry => `${prefix}/${entry.path}`), `${prefix}/LICENSE`, `${prefix}/SOURCE.json`, 'desktop-pet/lib/weather-location.js', 'desktop-pet/native/weather-location.node'])
      assert.deepEqual(fs.readFileSync(path.join(staged, file)), fs.readFileSync(path.join(root, file)), file);
    prepareStaging(root, standard);
    assert.equal(fs.existsSync(path.join(standard, 'desktop-pet/native/weather-location.node')), true);
    assert.equal(fs.existsSync(path.join(standard, 'desktop-pet/lib/weather-location.js')), true);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
