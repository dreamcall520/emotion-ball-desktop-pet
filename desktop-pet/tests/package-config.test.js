const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('桌宠项目固定入口、测试和打包脚本', () => {
  const pkg = require(path.resolve(__dirname, '../../package.json'));
  assert.equal(pkg.main, 'desktop-pet/main.js');
  assert.equal(pkg.scripts.start, 'electron .');
  assert.equal(pkg.scripts.test, 'node --test desktop-pet/tests/*.test.js');
  assert.equal(pkg.scripts['package:mac'], 'node desktop-pet/scripts/package-mac.js');
  assert.equal(
    pkg.scripts['package:mac:intel'],
    'node desktop-pet/scripts/package-mac.js --arch=x64'
  );
  assert.equal(
    pkg.scripts.postinstall,
    'ELECTRON_GET_USE_PROXY=1 node node_modules/electron/install.js'
  );
  assert.equal(pkg.devDependencies.electron, '43.4.1');
  assert.equal(pkg.devDependencies['@electron/packager'], '20.3.0');
});
