'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { marketingVersion, configFor, planFor, identities, validateProfile, packagerOptions, buildMas, argumentsFor } = require('../scripts/package-mas');
const pkg = { version: '0.4.09', devDependencies: { electron: '43.4.1' } };
const env = { MAS_BUNDLE_ID: 'com.example.qiuqiu', MAS_TEAM_ID: 'ABCDEF1234', MAS_PROFILE: '/synthetic/qiuqiu.provisionprofile',
  MAS_SIGN_IDENTITY: 'Apple Distribution: Synthetic Person (ABCDEF1234)',
  MAS_INSTALLER_IDENTITY: 'Mac Installer Distribution: Synthetic Person (ABCDEF1234)', MAS_BUILD_VERSION: '1' };
const certificate = Buffer.from('synthetic-certificate-not-a-real-credential');
const fingerprint = createHash('sha1').update(certificate).digest('hex').toUpperCase();
const config = configFor(pkg, env).config;
const validProfile = () => ({ ExpirationDate: new Date('2030-01-01T00:00:00Z'), Platform: ['OSX'], TeamIdentifier: [env.MAS_TEAM_ID],
  Entitlements: { 'com.apple.developer.team-identifier': env.MAS_TEAM_ID, 'com.apple.application-identifier': `${env.MAS_TEAM_ID}.${env.MAS_BUNDLE_ID}`,
    'com.apple.security.application-groups': [`${env.MAS_TEAM_ID}.${env.MAS_BUNDLE_ID}`], 'get-task-allow': false }, DeveloperCertificates: [certificate] });

test('MAS版本规范化移除leading zero；构建号必须显式正整数', () => {
  assert.equal(marketingVersion('0.4.09'), '0.4.9'); assert.equal(marketingVersion('01.002.003'), '1.2.3');
  for (const value of ['0.4.9-beta', 'v0.4.9', '1.2', null]) assert.throws(() => marketingVersion(value), { code: 'MAS_VERSION_INVALID' });
  for (const value of ['0', '-1', '01', '1.2', 'abc', '9007199254740992']) assert.ok(configFor(pkg, { ...env, MAS_BUILD_VERSION: value }).errors.includes('MAS_BUILD_VERSION_INVALID'));
});

test('默认只plan，缺配置不声称profile或签名已通过；不输出identity/profile内容', () => {
  assert.deepEqual(argumentsFor([]), { mode: 'plan', arch: undefined });
  assert.deepEqual(argumentsFor(['--plan', '--arch', 'x64']), { mode: 'plan', arch: 'x64' });
  assert.equal(argumentsFor(['--build']).mode, 'build');
  for (const args of [['--build', '--plan'], ['--upload'], ['--arch'], ['--arch', 'arm64', '--arch', 'x64']]) assert.throws(() => argumentsFor(args), { code: 'MAS_ARGUMENTS_INVALID' });
  const plan = planFor(pkg, {});
  assert.equal(plan.platform, 'mas'); assert.equal(plan.marketingVersion, '0.4.9'); assert.equal(plan.missingConfiguration.length, 6);
  assert.equal(plan.configurationReady, false); assert.equal(plan.profileValidated, false); assert.equal(plan.submissionReady, false);
  const configured = planFor(pkg, env);
  assert.equal(configured.configurationReady, true); assert.equal(configured.signingIdentitiesValidated, false);
  assert.ok(!JSON.stringify(configured).includes('Synthetic Person')); assert.ok(!JSON.stringify(configured).includes('/synthetic'));
});

test('真实CLI --plan接受不存在profile路径且不读profile/钥匙串/下载runtime', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/package-mas.js'), '--plan'], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0); const value = JSON.parse(result.stdout);
  assert.equal(value.configurationReady, true); assert.equal(value.profileValidated, false);
  assert.equal(result.stderr, '');
});

test('不接受adhoc/Developer ID/开发证书或不匹配team的签名配置', () => {
  for (const identity of ['-', 'Developer ID Application: Synthetic Person (ABCDEF1234)', 'Apple Development: Synthetic Person (ABCDEF1234)', 'Apple Distribution: Synthetic Person (OTHER12345)']) {
    assert.ok(configFor(pkg, { ...env, MAS_SIGN_IDENTITY: identity }).errors.includes('MAS_DISTRIBUTION_IDENTITY_REQUIRED'));
  }
  assert.ok(configFor(pkg, { ...env, MAS_INSTALLER_IDENTITY: 'Developer ID Installer: Synthetic Person (ABCDEF1234)' }).errors.includes('MAS_INSTALLER_DISTRIBUTION_IDENTITY_REQUIRED'));
  assert.ok(configFor(pkg, { ...env, MAS_PROFILE: 'relative.provisionprofile' }).errors.includes('MAS_PROFILE_PATH_INVALID'));
  assert.ok(configFor(pkg, { ...env, MAS_BUNDLE_ID: 'com.example.*' }).errors.includes('MAS_BUNDLE_ID_INVALID'));
  assert.ok(configFor(pkg, { ...env, MAS_TEAM_ID: 'incorrect' }).errors.includes('MAS_TEAM_ID_INVALID'));
  assert.ok(configFor(pkg, env, 'universal').errors.includes('MAS_ARCH_INVALID'));
});

test('profile核对过期、Mac平台、team、精确AppID、商店分发、证书和group', () => {
  assert.deepEqual(validateProfile(validProfile(), config, fingerprint, Date.parse('2026-10-31')), { profileValidated: true });
  const cases = [
    [p => { p.ExpirationDate = new Date('2000-01-01'); }, 'MAS_PROFILE_EXPIRED'],
    [p => { p.Platform = ['iOS']; }, 'MAS_PROFILE_PLATFORM_MISMATCH'],
    [p => { p.TeamIdentifier = ['OTHER12345']; }, 'MAS_PROFILE_TEAM_MISMATCH'],
    [p => { p.Entitlements['com.apple.developer.team-identifier'] = 'OTHER12345'; }, 'MAS_PROFILE_TEAM_MISMATCH'],
    [p => { p.Entitlements['com.apple.application-identifier'] = 'ABCDEF1234.com.example.*'; }, 'MAS_PROFILE_APP_ID_MISMATCH'],
    [p => { p.Entitlements['get-task-allow'] = true; }, 'MAS_APP_STORE_DISTRIBUTION_PROFILE_REQUIRED'],
    [p => { p.ProvisionsAllDevices = true; }, 'MAS_APP_STORE_DISTRIBUTION_PROFILE_REQUIRED'],
    [p => { p.ProvisionedDevices = ['SYNTHETIC_DEVICE']; }, 'MAS_APP_STORE_DISTRIBUTION_PROFILE_REQUIRED'],
    [p => { p.DeveloperCertificates = [Buffer.from('different-certificate')]; }, 'MAS_PROFILE_CERTIFICATE_MISMATCH'],
    [p => { p.Entitlements['com.apple.security.application-groups'] = ['ABCDEF1234.com.different']; }, 'MAS_PROFILE_APP_GROUP_MISMATCH']
  ];
  for (const [mutate, code] of cases) { const profile = validProfile(); mutate(profile); assert.throws(() => validateProfile(profile, config, fingerprint), { code }); }
});

test('签名身份解析只接受有效列表行，不把无效或部分名称匹配当有效证书', () => {
  assert.deepEqual(identities(` 1) ${fingerprint} "${env.MAS_SIGN_IDENTITY}"\n 2) ${'A'.repeat(40)} "expired" (CSSMERR_TP_CERT_EXPIRED)\n 1 valid identities found`), [{ fingerprint, name: env.MAS_SIGN_IDENTITY }]);
});

test('打包选项强制MASruntime/分发签名/主子权限，不复用Darwin缓存或公证', () => {
  const options = packagerOptions('/synthetic', config, '/synthetic/stage', '/synthetic/icon.icns', {
    platform: 'darwin', electronZipDir: '/synthetic/darwin-cache', osxNotarize: { password: 'SECRET' }, extendInfo: { NSLocationUsageDescription: 'existing-purpose' }
  });
  assert.equal(options.platform, 'mas'); assert.equal(options.arch, 'arm64'); assert.equal(options.appVersion, '0.4.9'); assert.equal(options.buildVersion, '1');
  assert.equal(options.appBundleId, env.MAS_BUNDLE_ID); assert.equal(options.extendInfo.ElectronTeamID, env.MAS_TEAM_ID);
  assert.equal(options.extendInfo.NSLocationUsageDescription, 'existing-purpose');
  assert.equal(options.electronZipDir, undefined); assert.equal(options.osxNotarize, undefined);
  assert.equal(options.osxSign.type, 'distribution'); assert.equal(options.osxSign.identityValidation, true); assert.equal(options.osxSign.preEmbedProvisioningProfile, true);
  assert.match(options.osxSign.optionsForFile('/out/球球桌宠.app').entitlements, /main\.entitlements\.plist$/);
  assert.match(options.osxSign.optionsForFile('/out/球球桌宠.app/Contents/Frameworks/球球桌宠 Helper.app').entitlements, /child\.entitlements\.plist$/);
  assert.match(options.osxSign.optionsForFile('/out/球球桌宠.app/Contents/Resources/native.node').entitlements, /child\.entitlements\.plist$/);
  assert.equal(options.osxSign.optionsForFile('/out/球球桌宠.app').hardenedRuntime, false);
  assert.equal(options.extendInfo.ITSAppUsesNonExemptEncryption, undefined);
});

function buildFixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-mas-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  const profilePath = path.join(root, 'synthetic.provisionprofile'); fs.writeFileSync(profilePath, 'synthetic fixture');
  const configured = { ...env, MAS_PROFILE: profilePath };
  const calls = [], captured = {};
  const dep = {
    hostPlatform: 'darwin', hostArch: 'arm64', now: () => Date.parse('2026-10-31'),
    command(name, args) {
      calls.push([name, args]);
      if (name === 'security' && args[0] === 'find-identity') return args.includes('codesigning')
        ? ` 1) ${fingerprint} "${env.MAS_SIGN_IDENTITY}"\n 1 valid identities found`
        : ` 1) ${'A'.repeat(40)} "${env.MAS_INSTALLER_IDENTITY}"\n 1 valid identities found`;
      return 'synthetic-captured-result';
    },
    parseProfile: () => validProfile(),
    mac: {
      prepareStaging(_root, staging) { calls.push(['staging']); fs.mkdirSync(staging, { recursive: true }); fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: pkg.version, main: 'desktop-pet/main.js' })); captured.staging = staging; return staging; },
      buildPackagerOptions() { return { platform: 'darwin' }; }
    },
    makeIcon() { calls.push(['icon']); return '/synthetic/icon.icns'; },
    buildWeatherLocation() { calls.push(['weather']); },
    async packager(options) { calls.push(['packager']); captured.options = options; const output = path.join(options.out, '球球桌宠-mas-' + options.arch); fs.mkdirSync(path.join(output, '球球桌宠.app'), { recursive: true }); return [output]; },
    signing: { async flat(options) { calls.push(['flat']); captured.flat = options; fs.writeFileSync(options.pkg, 'synthetic-not-a-package'); } },
    ...overrides
  };
  return { root, env: configured, calls, captured, dep };
}

test('缺配置或证书就明确停止，绝不降级Darwin/adhoc或先下载编译', async t => {
  const h = buildFixture(t);
  await assert.rejects(buildMas({ root: h.root, env: {} }, h.dep), { code: 'MAS_CONFIGURATION_REQUIRED' }); assert.deepEqual(h.calls, []);
  h.dep.command = (name, args) => { h.calls.push([name, args]); return '0 valid identities found'; };
  await assert.rejects(buildMas({ root: h.root, env: h.env }, h.dep), { code: 'MAS_DISTRIBUTION_IDENTITY_UNAVAILABLE' });
  assert.equal(h.calls.some(([name]) => ['weather', 'icon', 'staging', 'packager', 'flat'].includes(name)), false);
});

test('不在macOS或native架构不匹配时明确停止，x64不会混入arm64天气组件', async t => {
  const h = buildFixture(t);
  await assert.rejects(buildMas({ root: h.root, env: h.env }, { ...h.dep, hostPlatform: 'linux' }), { code: 'MAS_MACOS_BUILD_HOST_REQUIRED' });
  await assert.rejects(buildMas({ root: h.root, env: h.env, arch: 'x64' }, h.dep), { code: 'MAS_MATCHING_NATIVE_BUILD_HOST_REQUIRED' });
  assert.deepEqual(h.calls, []);
});

test('模拟构建严格先验profile和证书，再MAS打包签名与installer校验；不上传', async t => {
  const h = buildFixture(t);
  const result = await buildMas({ root: h.root, env: h.env }, h.dep);
  assert.equal(result.platform, 'mas'); assert.equal(result.signedDistributionPackage, true); assert.equal(result.submissionReady, false);
  const names = h.calls.map(([name]) => name);
  assert.ok(names.indexOf('security') < names.indexOf('weather')); assert.ok(names.indexOf('weather') < names.indexOf('packager')); assert.ok(names.indexOf('codesign') < names.indexOf('flat')); assert.equal(names.at(-1), 'pkgutil');
  assert.equal(h.captured.options.platform, 'mas'); assert.equal(h.captured.flat.platform, 'mas'); assert.equal(h.captured.flat.identity, env.MAS_INSTALLER_IDENTITY);
  assert.equal(h.captured.flat.identityValidation, true); assert.equal(h.captured.flat.install, '/Applications');
  const staged = JSON.parse(fs.readFileSync(path.join(h.captured.staging, 'package.json')));
  assert.equal(staged.version, '0.4.9'); assert.equal(staged.qiuqiuDistribution, 'mas');
  assert.equal(names.some(name => /upload|transporter|altool/.test(name)), false);
});

test('缺installer或坏profile也在任何编译/下载前失败', async t => {
  const h = buildFixture(t);
  const original = h.dep.command;
  const badInstaller = { ...h.dep, command: (name, args) => name === 'security' && args.includes('basic') ? '0 valid identities found' : original(name, args) };
  await assert.rejects(buildMas({ root: h.root, env: h.env }, badInstaller), { code: 'MAS_INSTALLER_IDENTITY_UNAVAILABLE' });
  await assert.rejects(buildMas({ root: h.root, env: h.env }, { ...h.dep, parseProfile: () => { throw new Error('PRIVATE_PROFILE_CONTENT'); } }), { code: 'MAS_PROFILE_INVALID' });
  assert.equal(h.calls.some(([name]) => name === 'packager' || name === 'weather'), false);
});

test('权限模板仅包含所需主权限，child为sandbox+inherit，没有临时例外或多余设备权限', () => {
  const plist = require('plist');
  const permissionRoot = path.join(__dirname, '../packaging/mas');
  const main = plist.parse(fs.readFileSync(path.join(permissionRoot, 'main.entitlements.plist'), 'utf8'));
  const child = plist.parse(fs.readFileSync(path.join(permissionRoot, 'child.entitlements.plist'), 'utf8'));
  assert.deepEqual(Object.keys(main).sort(), ['com.apple.security.app-sandbox', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.files.user-selected.executable', 'com.apple.security.network.client', 'com.apple.security.network.server', 'com.apple.security.personal-information.location'].sort());
  assert.deepEqual(child, { 'com.apple.security.app-sandbox': true, 'com.apple.security.inherit': true });
  assert.equal(main['com.apple.security.network.server'],true,'required for fixed-loopback bundled service and official login callback; native probe verifies denial without it');
  assert.equal(Object.keys(main).some(key => /temporary|camera|microphone|disable-library-validation/.test(key)), false);
});

test('x64参数在匹配的Intel构建host上进入同一MAS链路，不降级Darwin', async t => {
  const h = buildFixture(t, { hostArch: 'x64' });
  const result = await buildMas({ root: h.root, env: h.env, arch: 'x64' }, h.dep);
  assert.equal(result.arch, 'x64'); assert.equal(h.captured.options.platform, 'mas'); assert.equal(h.captured.options.arch, 'x64');
  assert.match(result.pkgPath, /mas-x64\.pkg$/);
});
