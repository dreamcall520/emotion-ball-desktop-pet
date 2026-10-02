const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('aurora animation remains active when style and colors change', () => {
  const window = { rive: {}, BOO_ASSETS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/aurora-rive.js'), 'utf8'), { window });
  const appearance = {
    shape: 'aurora-cloud', auroraStyle: 'simple', bodyColor: '#9878E7',
    eyeColor: '#1A3444', glowPinkColor: '#EA75C7', glowGoldColor: '#F1C977',
    eyeScale: 1, eyeSpacing: 1, eyeHeight: 0, idleEyes: 'original'
  };
  assert.equal(window.AuroraRive.eligible(appearance), true);
  assert.equal(window.AuroraRive.eligible({ ...appearance, auroraStyle: 'dimensional' }), true);
  assert.equal(window.AuroraRive.eligible({ ...appearance, shape: 'cloud' }), false);
});
