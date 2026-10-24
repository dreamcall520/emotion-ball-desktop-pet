const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { NAME, PROFILE, BUNDLE_ID, DEFAULTS, preparePreview } = require('../scripts/package-sheep-review');

test('全新验收配置默认自动换装，当前与启动外观保持一致',()=>{
  assert.equal(DEFAULTS.customization.appearance.sheepTheme,'auto');
  assert.equal(DEFAULTS.startupAppearance.sheepTheme,'auto');
});

test('咩咩安装候选隔离配置、保留已有设置、透传真实写入错误且不改变产品行为', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sheep-review-package-'));
  try {
    preparePreview(root, staging);
    const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json')));
    assert.equal(pkg.productName, NAME);
    assert.notEqual(pkg.name, require('../../package.json').name);
    assert.notEqual(BUNDLE_ID, 'local.xiaokun.emotionball.pet');
    const main = fs.readFileSync(path.join(staging, 'desktop-pet/main.js'), 'utf8');
    assert.equal(main.replace(`const APP_NAME = '${NAME}';`, "const APP_NAME = '球球桌宠';"),
      fs.readFileSync(path.join(root, 'desktop-pet/main.js'), 'utf8'));
    for (const file of ['renderer.js', 'lib/sheep-offering.js', 'lib/sheep-offering-window.js', 'sheep-offering.html', 'sheep-offering-renderer.js', 'sheep-offering-preload.js', 'lib/sheep-skin.js', 'assets/sheep/manifest.json']) {
      assert.deepEqual(fs.readFileSync(path.join(staging, 'desktop-pet', file)), fs.readFileSync(path.join(root, 'desktop-pet', file)));
    }
    const wrapper = fs.readFileSync(path.join(staging, pkg.main), 'utf8');
    function run(requested = '', errorCode) {
      let profile, helperProfile, started = false, written;
      const app = { getPath: () => '/review-appdata', setName: name => assert.equal(name, NAME),
        setPath: (key, value) => { assert.equal(key, 'userData'); profile = value; },
        commandLine: { getSwitchValue: () => requested,
          appendSwitch: (key, value) => { assert.equal(key, 'user-data-dir'); helperProfile = value; } } };
      vm.runInNewContext(wrapper, { require: name => {
        if (name === 'electron') return { app };
        if (name === 'node:path') return path;
        if (name === 'node:fs') return { mkdirSync() {}, writeFileSync(file, contents, options) {
          assert.equal(file, path.join(profile, 'settings.json')); assert.equal(options.flag, 'wx');
          if (errorCode) throw Object.assign(new Error(errorCode), { code: errorCode });
          written = JSON.parse(contents);
        } };
        assert.equal(name, './desktop-pet/main.js');
        assert.ok(profile && profile === helperProfile); started = true;
      } });
      assert.ok(started); return { profile, written };
    }
    assert.deepEqual(run(), { profile: path.join('/review-appdata', PROFILE), written: DEFAULTS });
    assert.equal(run('/explicit-qa-profile').profile, '/explicit-qa-profile');
    assert.equal(run('', 'EEXIST').written, undefined);
    assert.throws(() => run('', 'EACCES'), /EACCES/);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});
