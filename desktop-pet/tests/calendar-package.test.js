'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const mac = require('../scripts/package-mac');
const release = require('../scripts/mas-release-profile');
const { calendarCandidateOptions, NAME, BUNDLE_ID } = require('../scripts/package-calendar-candidate');

const scriptPath = path.resolve(__dirname, '../scripts/package-calendar-candidate.js');
function fixture(t, { profile = 'mas-first', outputs = 'one', plugin = true, bundled = false, platform = 'darwin', arch = 'arm64', buildError = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-calendar-package-'));
  const original = JSON.stringify({ name: 'source-project', version: '1.0.3', productName: '球球桌宠', qiuqiuReleaseProfile: profile });
  fs.writeFileSync(path.join(root, 'package.json'), original);
  const calls = [], module = { exports: {} }; let receivedOptions, stagedPackage;
  const build = name => (directory, options) => { calls.push({ name, directory, options }); if (buildError) throw Error('native build failed'); };
  const mockMac = {
    buildPackagerOptions: mac.buildPackagerOptions, findElectronZipDir: () => '/electron-cache',
    prepareStaging(directory, staging, options) {
      calls.push({ name: 'staging', directory, staging, options });
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'emotion-ball-desktop-pet', version: '0.0.0', main: 'desktop-pet/main.js', dependencies: { ws: '8.18.3' } }));
    },
    adhocSign: target => calls.push({ name: 'sign-plugin', target }),
    signWeatherApp: target => calls.push({ name: 'sign-app-and-bridges', target })
  };
  const mockRelease = { ...release,
    trimStaging(staging, config) { calls.push({ name: 'trim', staging, config }); return []; },
    assertNoBundledProviders(appPath, config) { calls.push({ name: 'no-bundled-providers', appPath, config }); release.assertNoBundledProviders(appPath, config); }
  };
  const packager = async options => {
    receivedOptions = options; stagedPackage = JSON.parse(fs.readFileSync(path.join(options.dir, 'package.json'), 'utf8'));
    calls.push({ name: 'packager' });
    if (outputs === 'none') return [];
    if (outputs === 'multiple') return ['/one', '/two'];
    const output = path.join(options.out, options.name + '-darwin-arm64');
    if (outputs === 'missing-app') return [output];
    const app = path.join(output, options.name + '.app');
    const native = path.join(app, 'Contents/Resources/app.asar.unpacked/desktop-pet/native');
    fs.mkdirSync(native, { recursive: true });
    for (const name of ['weather-location', 'calendar-events', ...(plugin ? ['plugin-host'] : [])]) fs.writeFileSync(path.join(native, name + '.node'), 'native-fixture');
    if (bundled) fs.mkdirSync(path.join(app, 'Contents/Resources/qiuqiu-codex'), { recursive: true });
    return [output];
  };
  const modules = {
    '@electron/packager': { packager }, './package-mac': mockMac, './mas-release-profile': mockRelease,
    './build-weather-location': { buildWeatherLocation: build('weather') }, './build-calendar-events': { buildCalendarEvents: build('calendar') },
    './build-plugin-host': { buildPluginHost: build('plugin') }, './make-icon': { makeIcon: directory => { calls.push({ name: 'icon', directory }); return '/original-icon.icns'; } }
  };
  vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), {
    module, __dirname: path.dirname(scriptPath), process: { platform, arch },
    require: name => Object.hasOwn(modules, name) ? modules[name] : require(name)
  }, { filename: scriptPath });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, original, calls, run: () => module.exports.packageCalendar(root),
    options: () => receivedOptions, staged: () => stagedPackage };
}

test('calendar candidate has an isolated identity and output while retaining native bridge permissions', () => {
  const normal = mac.buildPackagerOptions('/repo', '/existing-icon.icns', null);
  const candidate = calendarCandidateOptions('/repo', '/existing-icon.icns', '/cache');
  assert.equal(NAME, '球球桌宠-日历开发候选'); assert.equal(BUNDLE_ID, 'local.xiaokun.emotionball.pet.calendar.v7');
  assert.equal(candidate.name, NAME); assert.equal(candidate.appBundleId, BUNDLE_ID);
  assert.notEqual(candidate.appBundleId, normal.appBundleId); assert.notEqual(candidate.out, normal.out);
  assert.equal(candidate.dir, '/repo/desktop-pet/build/calendar-candidate-staging'); assert.equal(candidate.out, '/repo/dist/calendar-candidate');
  assert.equal(candidate.platform, 'darwin'); assert.equal(candidate.arch, 'arm64'); assert.equal(candidate.electronVersion, '43.4.1');
  assert.deepEqual(candidate.asar, { unpack: '**/*.node' }); assert.deepEqual(candidate.extendInfo, normal.extendInfo);
  assert.match(candidate.extendInfo.NSCalendarsFullAccessUsageDescription, /日历/);
  assert.match(candidate.extendInfo.NSCalendarsUsageDescription, /日历/);
  assert.equal(candidate.icon, '/existing-icon.icns'); assert.equal(candidate.electronZipDir, '/cache');
  assert.equal(candidate.extraResource, undefined);
});

test('candidate keeps the store version/profile and installed-provider capability without bundling provider CLIs', async t => {
  const f = fixture(t), app = await f.run(), staged = f.staged();
  assert.equal(staged.version, '1.0.3'); assert.equal(staged.productName, NAME);
  assert.equal(staged.qiuqiuAcceptance, 'calendar'); assert.equal(staged.qiuqiuDistribution, 'mas-candidate');
  assert.equal(staged.qiuqiuReleaseProfile, 'mas-first'); assert.equal(staged.main, 'desktop-pet/main.js');
  assert.equal(staged.dependencies.ws, '8.18.3'); assert.equal(f.options().extraResource, undefined);
  assert.equal(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'), f.original);
  const staging = f.calls.find(call => call.name === 'staging'), trim = f.calls.find(call => call.name === 'trim');
  assert.equal(staging.options.pluginNative, true); assert.equal(trim.config.releaseProfile, 'mas-first');
  for (const name of ['weather', 'calendar', 'plugin']) assert.ok(f.calls.findIndex(call => call.name === name) < f.calls.indexOf(staging));
  assert.equal(f.calls.find(call => call.name === 'calendar').options.targetArch, 'arm64');
  const plugin = f.calls.find(call => call.name === 'sign-plugin'), complete = f.calls.find(call => call.name === 'sign-app-and-bridges');
  assert.equal(plugin.target, path.join(app, 'Contents/Resources/app.asar.unpacked/desktop-pet/native/plugin-host.node'));
  assert.ok(f.calls.indexOf(plugin) < f.calls.indexOf(complete)); assert.equal(complete.target, app);
});

test('candidate rejects a website profile before building or staging', async t => {
  const f = fixture(t, { profile: 'website' });
  await assert.rejects(f.run(), /mas-first/); assert.equal(f.calls.length, 0);
});

test('candidate cannot silently combine an x64 host native bridge with an arm64 runtime', async t => {
  for (const options of [{ arch: 'x64' }, { platform: 'linux' }]) {
    const f = fixture(t, options); await assert.rejects(f.run(), /Apple 芯片 Mac/); assert.equal(f.calls.length, 0);
  }
});

test('native build failure never produces or signs a partial candidate', async t => {
  const f = fixture(t, { buildError: true }); await assert.rejects(f.run(), /native build failed/);
  assert.equal(f.calls.some(call => ['staging', 'packager', 'sign-plugin', 'sign-app-and-bridges'].includes(call.name)), false);
});

test('missing, ambiguous or incomplete packager output is rejected before signing', async t => {
  for (const outputs of ['none', 'multiple', 'missing-app']) {
    const f = fixture(t, { outputs }); await assert.rejects(f.run(), /日历开发候选应用/);
    assert.equal(f.calls.some(call => call.name.startsWith('sign-')), false);
  }
  const missingNative = fixture(t, { plugin: false }); await assert.rejects(missingNative.run(), /插件桥组件未解包/);
  assert.equal(missingNative.calls.some(call => call.name.startsWith('sign-')), false);
});

test('a bundled provider runtime is a build failure for the mas-first calendar candidate', async t => {
  const f = fixture(t, { bundled: true });
  await assert.rejects(f.run(), error => error.code === 'MAS_FIRST_BUNDLED_RUNTIME_PRESENT');
  assert.equal(f.calls.some(call => call.name.startsWith('sign-')), false);
});
