const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { NAME, PROFILE, preparePreview } = require('../scripts/package-quota-guard-preview');

test('普通候选入口强制隔离所有进程，smoke仅允许显式临时目录', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-guard-package-'));
  try {
    preparePreview(root, staging);
    for (const file of ['lib/quota-guard-window.js', 'quota-guard-preload.js', 'quota-guard.html',
      'quota-guard.css', 'quota-guard-renderer.js', 'assets/quota-guard/zombie-data.js',
      'assets/quota-guard/crown.svg', 'assets/quota-guard/tombstone.svg']) {
      assert.deepEqual(fs.readFileSync(path.join(staging, 'desktop-pet', file)),
        fs.readFileSync(path.join(root, 'desktop-pet', file)), file + ' must ship unchanged');
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json')));
    assert.equal(pkg.productName, NAME);
    assert.notEqual(pkg.name, require('../../package.json').name);
    assert.equal(pkg.version, require('../../package.json').version);
    const wrapper = fs.readFileSync(path.join(staging, pkg.main), 'utf8');
    function run(smoke, requested) {
      let profile, helperProfile, started = false;
      const app = { getPath: () => '/isolated-appdata', setName: name => assert.equal(name, NAME),
        setPath: (key, value) => { assert.equal(key, 'userData'); profile = value; },
        commandLine: { getSwitchValue: () => requested,
          appendSwitch: (key, value) => { assert.equal(key, 'user-data-dir'); helperProfile = value; } } };
      vm.runInNewContext(wrapper, { process: { env: { PET_SMOKE_TEST: smoke ? '1' : '' } },
        require: name => {
          if (name === 'electron') return { app };
          if (name === 'node:fs') return { mkdirSync() {} };
          if (name === 'node:path') return path;
          assert.equal(name, './desktop-pet/main.js');
          assert.ok(profile && profile === helperProfile); started = true;
        } });
      assert.ok(started);
      return profile;
    }
    assert.equal(run(false, '/formal-profile'), path.join('/isolated-appdata', PROFILE));
    assert.equal(run(true, '/explicit-smoke-profile'), '/explicit-smoke-profile');
    assert.throws(() => run(true, ''), /隔离目录/);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});
