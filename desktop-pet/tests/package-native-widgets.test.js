'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plist = require('plist');
const api = require('../scripts/package-native-widgets');

const child = { 'com.apple.security.app-sandbox': true, 'com.apple.security.inherit': true };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-widget-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Ball.app'), signing = path.join(root, 'signing');
  const extension = path.join(root, 'source/Widgets.appex');
  fs.mkdirSync(path.join(extension, 'Contents/MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true }); fs.mkdirSync(signing);
  fs.writeFileSync(path.join(extension, 'Contents/MacOS/Widgets'), 'fixture widget');
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), plist.build({ CFBundleIdentifier: 'com.example.ball',
    CFBundleURLTypes: [{ CFBundleURLName: 'existing', CFBundleURLSchemes: ['existing'] }] }));
  const helper = path.join(root, 'bridge'), config = helper + '.json';
  fs.writeFileSync(helper, 'fixture helper'); fs.writeFileSync(config, JSON.stringify({ appGroup: 'ABCDEF1234.com.example.ball' }));
  const widgetCenterPath = path.join(root, 'widget-center.node'); fs.writeFileSync(widgetCenterPath, 'fixture module');
  const artifacts = { extensionPath: extension, helperPath: helper, helperConfigPath: config,
    widgetCenterPath, appGroup: 'ABCDEF1234.com.example.ball', widgetBundleId: 'com.example.ball.widgets', urlScheme: 'qiuqiu-widget' };
  return { root, app, signing, artifacts };
}
test('old package profiles do not compile or embed native widgets implicitly', async () => {
  assert.equal(await api.prepareNativeWidgets('/unused', {}, {}, () => { throw Error('unexpected compile'); }), null);
});
test('native widget compilation uses the parent identity and the same package version/build', async () => {
  const config = { bundleId: 'com.example.ball', teamId: 'ABCDEF1234', marketingVersion: '1.0.4', buildVersion: '123', arch: 'arm64' };
  let received;
  const result = await api.prepareNativeWidgets('/root', { qiuqiuNativeWidgets: true }, config,
    (root, options) => { received = [root, options]; return { built: true }; });
  assert.deepEqual(result, { built: true });
  assert.deepEqual(received, ['/root', { bundleId: config.bundleId, teamId: config.teamId,
    version: '1.0.4', buildVersion: '123', targetArch: 'arm64' }]);
});
test('extension is a real PlugIns appex and helper is outside ASAR with its own config', t => {
  const f = fixture(t), embedded = api.embedNativeWidgets(f.app, f.artifacts, f.signing);
  assert.equal(fs.readFileSync(path.join(embedded.extensionPath, 'Contents/MacOS/Widgets'), 'utf8'), 'fixture widget');
  assert.equal(fs.readFileSync(embedded.helperPath, 'utf8'), 'fixture helper');
  assert.equal(fs.statSync(embedded.helperPath).mode & 0o777, 0o755);
  assert.deepEqual(plist.parse(fs.readFileSync(embedded.entitlementsFile, 'utf8')), {
    'com.apple.security.app-sandbox': true, 'com.apple.security.application-groups': [f.artifacts.appGroup]
  });
  const info = plist.parse(fs.readFileSync(path.join(f.app, 'Contents/Info.plist'), 'utf8'));
  assert.deepEqual(info.CFBundleURLTypes.map(type => type.CFBundleURLSchemes[0]), ['existing', 'qiuqiu-widget']);
  assert.equal(JSON.parse(fs.readFileSync(embedded.configPath)).appGroup, f.artifacts.appGroup);
});
test('parent native module is staged before ASAR creation and remains resolvable as an unpacked module', async t => {
  const f = fixture(t), staging = path.join(f.root, 'staging');
  api.stageWidgetModule(staging, f.artifacts);
  const archive = path.join(f.root, 'app.asar'), asar = require('@electron/asar');
  await asar.createPackageWithOptions(staging, archive, { unpack: '**/*.node' });
  assert.equal(asar.statFile(archive, 'desktop-pet/native/widget-center.node').unpacked, true);
  assert.equal(asar.extractFile(archive, 'desktop-pet/native/widget-center.node').toString(), 'fixture module');
});
test('extension gets independent sandbox rights, never the Electron child inherit template', t => {
  const f = fixture(t), e = api.embedNativeWidgets(f.app, f.artifacts, f.signing);
  for (const file of [e.extensionPath, path.join(e.extensionPath, 'Contents/MacOS/Widgets')]) {
    assert.equal(api.entitlementFileFor(file, f.app, 'main', 'child', e), e.entitlementsFile);
  }
  assert.equal(api.entitlementFileFor(e.helperPath, f.app, 'main', 'child', e), 'child');
  assert.equal(api.entitlementFileFor(e.extensionPath + '-other', f.app, 'main', 'child', e), 'child');
  assert.equal(api.entitlementFileFor(f.app, f.app, 'main', 'child', e), 'main');
});
test('signature readback rejects inherit on the extension and any extra entitlement', t => {
  const f = fixture(t), e = api.embedNativeWidgets(f.app, f.artifacts, f.signing), calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    return args.includes('--display') ? plist.build(args.at(-1) === e.extensionPath ? e.entitlements : child) : '';
  };
  assert.equal(api.verifyNativeWidgets(e, run, child).extensionEntitlementsValidated, true);
  assert.equal(calls.filter(([, args]) => args.includes('--verify')).length, 2);
  assert.throws(() => api.verifyNativeWidgets(e, (_command, args) => args.includes('--display') ?
    plist.build({ ...e.entitlements, 'com.apple.security.inherit': true }) : '', child), { code: 'MAS_WIDGET_ENTITLEMENTS_UNVERIFIED' });
});
