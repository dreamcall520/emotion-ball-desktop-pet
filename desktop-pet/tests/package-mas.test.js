'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, X509Certificate } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { marketingVersion, configFor, planFor, identities, validateProfile, validateCertificate, entitlementsFor, distributionEntry, validateMasRuntimeCache, packagerOptions, buildMas, argumentsFor } = require('../scripts/package-mas');
const pkg = { version: '0.4.09', devDependencies: { electron: '43.4.1' } };
const env = { MAS_BUNDLE_ID: 'com.example.qiuqiu', MAS_TEAM_ID: 'ABCDEF1234', MAS_PROFILE: '/synthetic/qiuqiu.provisionprofile',
  MAS_SIGN_IDENTITY: 'Apple Distribution: Synthetic Person (PERSON9999)',
  MAS_INSTALLER_IDENTITY: 'Mac Installer Distribution: Synthetic Person (PERSON9999)', MAS_BUILD_VERSION: '1' };
// Self-signed public test certificates only; fixture private keys were discarded.
const publicFixtures = {"application": "MIICNDCCAdmgAwIBAgIUe/xT7KtwZikQH0JJSVDtrgD5W/UwCgYIKoZIzj0EAwIwbzE6MDgGA1UEAwwxQXBwbGUgRGlzdHJpYnV0aW9uOiBTeW50aGV0aWMgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKQUJDREVGMTIzNDEcMBoGA1UECgwTU3ludGhldGljIFRlc3QgT25seTAeFw0yNjExMDEwMDQ3NDNaFw0zNjEwMjkwMDQ3NDNaMG8xOjA4BgNVBAMMMUFwcGxlIERpc3RyaWJ1dGlvbjogU3ludGhldGljIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMCkFCQ0RFRjEyMzQxHDAaBgNVBAoME1N5bnRoZXRpYyBUZXN0IE9ubHkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQG3nrvgYSNOipVtqhwNYuyEoqJR0ctIk1YMy62wGv1p/f43Ew+k+BsSuvQojwHlZY5elSxAn1KwsDsdurGIA4Do1MwUTAdBgNVHQ4EFgQUCvB7qipLJbH3SGhhBAAhR6YZ0eowHwYDVR0jBBgwFoAUCvB7qipLJbH3SGhhBAAhR6YZ0eowDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAxRw8YoFBSfwGg8gcl0PxpxRPPkJDEUKR9KwH/nilzSYCIQC9/dfWMvhb4weO8aOHTuivHbjHDmtjoz9xcHipeBlG2g==", "installer": "MIICQzCCAemgAwIBAgIUc/COihdyvXHn3S9IZr1iwCWlotwwCgYIKoZIzj0EAwIwdzFCMEAGA1UEAww5TWFjIEluc3RhbGxlciBEaXN0cmlidXRpb246IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MB4XDTI2MTEwMTAwNDc0M1oXDTM2MTAyOTAwNDc0M1owdzFCMEAGA1UEAww5TWFjIEluc3RhbGxlciBEaXN0cmlidXRpb246IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUhsfdChXMmQrAXXsC/GwOF804k7qvcMlMO/jPudzZH0oxF8yzRKJ4IhpinlE9F0pN3tYnywmipeuxiQLQw1zyaNTMFEwHQYDVR0OBBYEFO4+IIJf6WaqiIZSKWD6OZVJRIcvMB8GA1UdIwQYMBaAFO4+IIJf6WaqiIZSKWD6OZVJRIcvMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgGuC5cjnnRW69nHar02m5R6RW2aEbjcOerfihJT7kU9wCIQCI1pue92pUaElxFFWoomYggzf2/vKLyWsWvp42uaAEJA==", "wrongTeam": "MIICMzCCAdmgAwIBAgIUfBa4k6jeqVlBZxFU2R92xfntA0cwCgYIKoZIzj0EAwIwbzE6MDgGA1UEAwwxQXBwbGUgRGlzdHJpYnV0aW9uOiBTeW50aGV0aWMgUGVyc29uIChQRVJTT045OTk5KTETMBEGA1UECwwKWlpaWlpaOTk5OTEcMBoGA1UECgwTU3ludGhldGljIFRlc3QgT25seTAeFw0yNjExMDEwMDQ3NDNaFw0zNjEwMjkwMDQ3NDNaMG8xOjA4BgNVBAMMMUFwcGxlIERpc3RyaWJ1dGlvbjogU3ludGhldGljIFBlcnNvbiAoUEVSU09OOTk5OSkxEzARBgNVBAsMClpaWlpaWjk5OTkxHDAaBgNVBAoME1N5bnRoZXRpYyBUZXN0IE9ubHkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQxfiuGfVE0gA6KtA9fQfw53z7VQAnRD4Vw326LjcHAS4fvOIjCupK7PaEIerDLkFsMmoVtUlUPKsqU1Ah0oyDho1MwUTAdBgNVHQ4EFgQUhqvTVyUCO03K/YwsS8Ngu4jwzqUwHwYDVR0jBBgwFoAUhqvTVyUCO03K/YwsS8Ngu4jwzqUwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBv3iySLmIoipZEtmUmBqBXiqzZAZeGSWl5Wg8FsKB2vAIhAJzryg8Giir5VIpgfJcEw07X0G4L7auP6/ImQTZ0jVrN", "development": "MIICMTCCAdegAwIBAgIUL9KMlU6de645mWZxD2C2JUBqjTUwCgYIKoZIzj0EAwIwbjE5MDcGA1UEAwwwQXBwbGUgRGV2ZWxvcG1lbnQ6IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MB4XDTI2MTEwMTAwNDc0M1oXDTM2MTAyOTAwNDc0M1owbjE5MDcGA1UEAwwwQXBwbGUgRGV2ZWxvcG1lbnQ6IFN5bnRoZXRpYyBQZXJzb24gKFBFUlNPTjk5OTkpMRMwEQYDVQQLDApBQkNERUYxMjM0MRwwGgYDVQQKDBNTeW50aGV0aWMgVGVzdCBPbmx5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMl0koXGsx6FpbaQB+nO6J8idQNkYWfs9bFgWRWUYvGWwmRqubJy472hQAh5yj2oOQ03+/jV2moASADqW7/qiMKNTMFEwHQYDVR0OBBYEFM4KqaMeZ+Nm7I0ZrLZu/q5iQ0RNMB8GA1UdIwQYMBaAFM4KqaMeZ+Nm7I0ZrLZu/q5iQ0RNMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAMKRkwYG6RNpIvF5SGw/pytgGN0dpXTX+7jDpn0Io/JuAiAQR/YEKUKCNR/Hovt4E19Xxvw3oGl5BxaFBsvHWWEwoQ=="};
const certificate=Buffer.from(publicFixtures.application,'base64'), installerPublic=Buffer.from(publicFixtures.installer,'base64');
const installerFingerprint=createHash('sha1').update(installerPublic).digest('hex').toUpperCase();
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

test('不接受adhoc/Developer ID/开发证书类型；team归属由公钥OU核对', () => {
  for (const identity of ['-', 'Developer ID Application: Synthetic Person (ABCDEF1234)', 'Apple Development: Synthetic Person (ABCDEF1234)']) {
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
  assert.equal(options.osxSign,false);assert.deepEqual(options.extraResource,['/synthetic/desktop-pet/build/qiuqiu-codex','/synthetic/desktop-pet/build/qiuqiu-workbuddy']);
  assert.equal(options.extendInfo.ITSAppUsesNonExemptEncryption, undefined);
});

function buildFixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-mas-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  const profilePath = path.join(root, 'synthetic.provisionprofile'); fs.writeFileSync(profilePath, 'synthetic fixture');
  const configured = { ...env, MAS_PROFILE: profilePath };
  const calls = [], captured = {};
  function resources(app,arch){const base=path.join(app,'Contents/Resources'),codex=path.join(base,'qiuqiu-codex',`darwin-${arch}`),wb=path.join(base,'qiuqiu-workbuddy');fs.mkdirSync(codex,{recursive:true});fs.mkdirSync(path.join(wb,'node_modules/fixture'),{recursive:true});fs.writeFileSync(path.join(codex,'codex'),'before-sign');fs.writeFileSync(path.join(codex,'manifest.json'),JSON.stringify({provider:'codex',binary:'codex',binarySha256:'old'}));fs.writeFileSync(path.join(wb,'node_modules/fixture/native.node'),'before-sign');fs.writeFileSync(path.join(wb,'manifest.json'),JSON.stringify({provider:'workbuddy-cli',files:{'node_modules/fixture/native.node':'old'}}));}

  const dep = {
    hostPlatform: 'darwin', hostArch: 'arm64', now: () => Date.parse('2026-10-31'),
    command(name, args) {
      calls.push([name, args]);
      if(name==='security'&&args[0]==='find-certificate')return new X509Certificate(installerPublic).toString();
      if(name==='codesign'&&args[0]==='--display'){const rights=captured.sign.optionsForFile(args.at(-1));return fs.readFileSync(rights.entitlements,'utf8');}
      if (name === 'security' && args[0] === 'find-identity') return args.includes('codesigning')
        ? ` 1) ${fingerprint} "${env.MAS_SIGN_IDENTITY}"\n 1 valid identities found`
        : ` 1) ${installerFingerprint} "${env.MAS_INSTALLER_IDENTITY}"\n 1 valid identities found`;
      return 'synthetic-captured-result';
    },
    parseProfile: () => validProfile(),
    mac: {
      prepareStaging(_root, staging, flags) { captured.stagingFlags=flags;calls.push(['staging']); fs.mkdirSync(staging, { recursive: true }); fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: pkg.version, main: 'desktop-pet/main.js' })); captured.staging = staging; return staging; },
      buildPackagerOptions() { return { platform: 'darwin' }; }
    },
    makeIcon() { calls.push(['icon']); return '/synthetic/icon.icns'; },
    buildWeatherLocation() { calls.push(['weather']); },
    buildPluginHost() { calls.push(['plugin-native']); },
    validateBuildTools() { calls.push(['validate-build-tools']); },
    validateResources:async()=>{calls.push(['resources-validated']);},
    async packager(options) { calls.push(['packager']); captured.options = options; const output = path.join(options.out, '球球桌宠-mas-' + options.arch); const app=path.join(output,'球球桌宠.app');fs.mkdirSync(app,{recursive:true});if(options.extraResource.length)resources(app,options.arch);else{fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});fs.mkdirSync(path.join(app,'Contents/Frameworks/Fixture Helper.app'),{recursive:true});fs.mkdirSync(path.join(app,'Contents/Library/LoginItems/Fixture Login Helper.app'),{recursive:true});const native=path.join(app,'Contents/Resources/app.asar.unpacked/desktop-pet/native');fs.mkdirSync(native,{recursive:true});fs.writeFileSync(path.join(native,'weather-location.node'),'native');}captured.app=app;return [output]; },
    signing: { async sign(options){calls.push(['sign']);captured.sign=options;if(options.binaries.length){fs.appendFileSync(options.binaries[0],'-signed');fs.appendFileSync(path.join(options.app,'Contents/Resources/qiuqiu-workbuddy/node_modules/fixture/native.node'),'-signed');}else assert.equal(fs.existsSync(path.join(options.app,'Contents/Resources/qiuqiu-codex')),false);},async flat(options) { calls.push(['flat']); captured.flat = options; fs.writeFileSync(options.pkg, 'synthetic-not-a-package'); } },
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

test('正式MAS复用必需工具与SDK预检，不因只有CLT而强求Xcode版本', async t => {
  const h=buildFixture(t),run=h.dep.command;
  h.dep.command=(name,args)=>{if(name==='xcodebuild')throw Error('Full Xcode unavailable');return run(name,args);};
  const result=await buildMas({root:h.root,env:h.env},h.dep);
  const names=h.calls.map(([name])=>name);
  assert.equal(result.signedDistributionPackage,true);assert.equal(result.profileValidated,true);assert.equal(result.signedEntitlementsValidated,true);
  assert.ok(names.includes('validate-build-tools'));
  assert.ok(names.indexOf('validate-build-tools')<names.indexOf('weather'));
  assert.ok(names.indexOf('validate-build-tools')<names.indexOf('plugin-native'));
  assert.ok(names.indexOf('validate-build-tools')<names.indexOf('packager'));
  assert.equal(names.includes('xcodebuild'),false);
});

test('正式MAS缺少真实必需工具时仍在任何编译打包签名前停止', async t => {
  const h=buildFixture(t,{validateBuildTools(){throw Object.assign(Error(),{code:'MAS_DEV_BUILD_TOOLS_UNAVAILABLE'});}});
  await assert.rejects(buildMas({root:h.root,env:h.env},h.dep),{code:'MAS_DEV_BUILD_TOOLS_UNAVAILABLE'});
  assert.equal(h.calls.some(([name])=>['weather','plugin-native','icon','staging','packager','sign','flat'].includes(name)),false);
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
  assert.equal(staged.version, '0.4.9'); assert.equal(staged.qiuqiuDistribution, 'mas');assert.equal(staged.main,'mas-distribution-entry.js');assert.equal(staged.qiuqiuAcceptance,undefined);assert.deepEqual(h.captured.stagingFlags,{pluginNative:true});
  assert.equal(h.captured.sign.type,'distribution');assert.equal(h.captured.sign.preAutoEntitlements,false);assert.equal(h.captured.sign.identity,fingerprint);assert.equal(result.signedEntitlementsValidated,true);assert.equal(result.runtimeAcceptancePassed,false);
  const resources=path.join(h.captured.app,'Contents/Resources');const codex=path.join(resources,'qiuqiu-codex/darwin-arm64');assert.equal(JSON.parse(fs.readFileSync(path.join(codex,'manifest.json'))).binarySha256,createHash('sha256').update(fs.readFileSync(path.join(codex,'codex'))).digest('hex'));const wb=path.join(resources,'qiuqiu-workbuddy');assert.equal(JSON.parse(fs.readFileSync(path.join(wb,'manifest.json'))).files['node_modules/fixture/native.node'],createHash('sha256').update(fs.readFileSync(path.join(wb,'node_modules/fixture/native.node'))).digest('hex'));
  const outerResign=h.calls.find(([n,a])=>n==='codesign'&&a[0]==='--force');assert.ok(outerResign);assert.equal(outerResign[1].includes('--deep'),false);assert.ok(names.indexOf('sign')<names.indexOf('codesign'));
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
  assert.deepEqual(Object.keys(main).sort(), ['com.apple.security.app-sandbox', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.network.client', 'com.apple.security.network.server', 'com.apple.security.personal-information.location'].sort());
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


test('分发证书严格核对匹配公钥CN/OU，括号个人标识不冒充团队；开发证书不能混入',()=>{
 assert.equal(configFor(pkg,env).errors.length,0);const wrong=Buffer.from(publicFixtures.wrongTeam,'base64'),development=Buffer.from(publicFixtures.development,'base64');
 assert.throws(()=>validateCertificate(wrong,env.MAS_SIGN_IDENTITY,env.MAS_TEAM_ID,'application'),{code:'MAS_CERTIFICATE_TEAM_MISMATCH'});
 assert.throws(()=>validateCertificate(development,'Apple Development: Synthetic Person (PERSON9999)',env.MAS_TEAM_ID,'application'),{code:'MAS_DISTRIBUTION_CERTIFICATE_REQUIRED'});
 assert.throws(()=>validateCertificate(certificate,'Apple Distribution: Other Person (PERSON9999)',env.MAS_TEAM_ID,'application'),{code:'MAS_CERTIFICATE_IDENTITY_MISMATCH'});
 assert.throws(()=>validateCertificate(Buffer.from('bad'),env.MAS_SIGN_IDENTITY,env.MAS_TEAM_ID,'application'),{code:'MAS_CERTIFICATE_INVALID'});
});
test('生成的分发权限与已审模板一致并有精确AppID/team/group，没有开发调试权限',()=>{
 const rights=entitlementsFor(config),main=require('plist').parse(fs.readFileSync(path.join(__dirname,'../packaging/mas/main.entitlements.plist'),'utf8'));
 for(const [key,value]of Object.entries(main))assert.deepEqual(rights.main[key],value);assert.equal(rights.main['com.apple.application-identifier'],env.MAS_TEAM_ID+'.'+env.MAS_BUNDLE_ID);assert.deepEqual(rights.main['com.apple.security.application-groups'],[env.MAS_TEAM_ID+'.'+env.MAS_BUNDLE_ID]);assert.equal(rights.main['com.apple.security.get-task-allow'],undefined);assert.deepEqual(rights.child,{'com.apple.security.app-sandbox':true,'com.apple.security.inherit':true});
});
test('正式分发入口拒绝Darwin，不开放开发候选标志或探针',()=>{
 const entry=distributionEntry();assert.doesNotMatch(entry,/qiuqiuMasDevelopmentCandidate|probe|mas-development/);const output=[];assert.throws(()=>require('node:vm').runInNewContext(entry,{process:{mas:false,stderr:{write:s=>output.push(s)},exit:()=>{throw Error('EXIT');}}}),/EXIT/);assert.equal(output.join(''),'MAS_RUNTIME_REQUIRED\n');
});
test('资源缺失、签名API缺失、签后权限不匹配在生成installer前失败',async t=>{
 const a=buildFixture(t,{validateResources:async()=>{throw Object.assign(Error(),{code:'BUNDLED_RUNTIME_MISSING'});}});await assert.rejects(buildMas({root:a.root,env:a.env},a.dep),{code:'BUNDLED_RUNTIME_MISSING'});assert.equal(a.calls.some(([n])=>['weather','packager','flat'].includes(n)),false);
 const b=buildFixture(t,{signing:{flat:async()=>assert.fail('must not flat')}});await assert.rejects(buildMas({root:b.root,env:b.env},b.dep),{code:'MAS_SIGN_API_UNAVAILABLE'});
 const c=buildFixture(t);const original=c.dep.command;c.dep.command=(name,args)=>name==='codesign'&&args[0]==='--display'?require('plist').build({'com.apple.security.app-sandbox':true,'get-task-allow':true}):original(name,args);await assert.rejects(buildMas({root:c.root,env:c.env},c.dep),{code:'MAS_ENTITLEMENTS_UNVERIFIED'});assert.equal(c.calls.some(([n])=>n==='flat'),false);
});


test('installer公钥不匹配或签后manifest损坏时不生成分发包',async t=>{
 const a=buildFixture(t);const run=a.dep.command;a.dep.command=(name,args)=>name==='security'&&args[0]==='find-certificate'?new X509Certificate(certificate).toString():run(name,args);
 await assert.rejects(buildMas({root:a.root,env:a.env},a.dep),{code:'MAS_INSTALLER_CERTIFICATE_UNAVAILABLE'});assert.equal(a.calls.some(([n])=>['weather','packager','flat'].includes(n)),false);
 const b=buildFixture(t),sign=b.dep.signing.sign;b.dep.signing.sign=async options=>{await sign(options);fs.writeFileSync(path.join(options.app,'Contents/Resources/qiuqiu-workbuddy/manifest.json'),'{}');};
 await assert.rejects(buildMas({root:b.root,env:b.env},b.dep),{code:'MAS_BUNDLED_MANIFEST_REFRESH_FAILED'});assert.equal(b.calls.some(([n])=>n==='flat'),false);
});


test('显式缓存只接收已固定官方SHA的MAS版本架构，不默认复用Darwin缓存',()=>{
 const custom=configFor(pkg,{...env,MAS_ELECTRON_ZIP_DIR:'/synthetic/verified-mas-cache'});assert.equal(custom.errors.length,0);
 const options=packagerOptions('/synthetic',custom.config,'/synthetic/stage','/synthetic/icon',{electronZipDir:'/synthetic/darwin-cache'});assert.equal(options.platform,'mas');assert.equal(options.electronZipDir,'/synthetic/verified-mas-cache');
 assert.equal(packagerOptions('/synthetic',config,'/synthetic/stage','/synthetic/icon',{electronZipDir:'/synthetic/darwin-cache'}).electronZipDir,undefined);
 assert.equal(planFor(pkg,env).runtimeSource,'official-mas-download');const plan=planFor(pkg,{...env,MAS_ELECTRON_ZIP_DIR:'/synthetic/private-cache-path'});assert.equal(plan.runtimeSource,'explicit-pinned-mas-cache');assert.equal(plan.cachedRuntimeValidated,false);assert.equal(JSON.stringify(plan).includes('/synthetic/private-cache-path'),false);
 assert.ok(configFor(pkg,{...env,MAS_ELECTRON_ZIP_DIR:'relative'}).errors.includes('MAS_RUNTIME_CACHE_DIRECTORY_INVALID'));
 assert.ok(configFor(pkg,{...env,MAS_ELECTRON_ZIP_DIR:''}).errors.includes('MAS_RUNTIME_CACHE_DIRECTORY_INVALID'));
 assert.ok(configFor({...pkg,devDependencies:{electron:'43.4.2'}},{...env,MAS_ELECTRON_ZIP_DIR:'/synthetic'}).errors.includes('MAS_RUNTIME_CACHE_ARCHIVE_UNPINNED'));
 assert.ok(configFor(pkg,{...env,MAS_ELECTRON_ZIP_DIR:'/synthetic'},'x64').errors.includes('MAS_RUNTIME_CACHE_ARCHIVE_UNPINNED'));
});
test('错SHA、仅有Darwin归档或链接缓存明确拒绝，在任何编译打包前停止',async t=>{
 const h=buildFixture(t),directory=path.join(h.root,'mas-cache');fs.mkdirSync(directory);const configured={...h.env,MAS_ELECTRON_ZIP_DIR:directory};
 fs.writeFileSync(path.join(directory,'electron-v43.4.1-darwin-arm64.zip'),'not-a-mas-archive');await assert.rejects(buildMas({root:h.root,env:configured},h.dep),{code:'MAS_RUNTIME_CACHE_ARCHIVE_UNAVAILABLE'});
 const archive=path.join(directory,'electron-v43.4.1-mas-arm64.zip');fs.writeFileSync(archive,'corrupt-or-untrusted-MAS-bytes');await assert.rejects(buildMas({root:h.root,env:configured},h.dep),{code:'MAS_RUNTIME_CACHE_SHA256_MISMATCH'});
 assert.equal(h.calls.some(([n])=>['weather','plugin-native','resources-validated','packager','flat'].includes(n)),false);
 fs.unlinkSync(archive);fs.symlinkSync(path.join(directory,'electron-v43.4.1-darwin-arm64.zip'),archive);assert.throws(()=>validateMasRuntimeCache(configFor(pkg,configured).config),{code:'MAS_RUNTIME_CACHE_ARCHIVE_UNAVAILABLE'});
 assert.throws(()=>validateMasRuntimeCache({...config,runtimeZipDir:directory,arch:'x64'}),{code:'MAS_RUNTIME_CACHE_ARCHIVE_UNPINNED'});
 assert.deepEqual(validateMasRuntimeCache(config),{used:false,validated:false});
});

test('商店分发不携带厂商组件或可执行写权限，动画提醒仅写配置',()=>{
 const config={...configFor(pkg,env).config,releaseProfile:'mas-first'};
 assert.deepEqual(packagerOptions('/root',config,'/stage','/icon').extraResource,[]);
 assert.equal(Object.hasOwn(entitlementsFor(config).main,'com.apple.security.files.user-selected.executable'),false,'event filters remain inside the signed App');
 assert.equal(entitlementsFor(config).main['com.apple.security.network.server'],true,'required for the fixed loopback WorkBuddy metadata receiver');
});

 test('首发正式流水线可以无厂商helper产物，并验证自有Electron/native/loginhelper签名',async t=>{
 const h=buildFixture(t);fs.writeFileSync(path.join(h.root,'package.json'),JSON.stringify({...pkg,qiuqiuReleaseProfile:'mas-first'}));
 const result=await buildMas({root:h.root,env:h.env},h.dep);
 assert.equal(result.signedDistributionPackage,true);assert.equal(result.codexRuntime,'user-installed');assert.equal(result.bundled,false);assert.equal(result.installedProviderAcceptance,false);assert.deepEqual(result.bundledManifestRefresh,{codexFiles:0,workbuddyFiles:0});assert.deepEqual(h.captured.options.extraResource,[]);assert.deepEqual(h.captured.sign.binaries,[]);assert.equal(h.calls.some(([name])=>name==='resources-validated'),false);
 for(const name of ['qiuqiu-codex','qiuqiu-workbuddy'])assert.equal(fs.existsSync(path.join(h.captured.app,'Contents/Resources',name)),false);
 for(const name of ['Frameworks/Fixture Helper.app','Library/LoginItems/Fixture Login Helper.app','Resources/app.asar.unpacked/desktop-pet/native/weather-location.node'])assert.ok(h.calls.some(([cmd,args])=>cmd==='codesign'&&args[0]==='--verify'&&args.at(-1)===path.join(h.captured.app,'Contents',name)));
 });

// The App Review rejection must be checked against the actual signed payload,
// not merely the template supplied to the signing tool.
test('实际主App或Helper签名意外保留被拒可执行写权限时不得生成installer',async t=>{
 for(const target of ['main','helper']){
  const f=buildFixture(t),run=f.dep.command,plist=require('plist');
  fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({...pkg,qiuqiuReleaseProfile:'mas-first'}));
  f.dep.command=(name,args)=>{
   const result=run(name,args);
   if(name==='codesign'&&args[0]==='--display'&&((args.at(-1)===f.captured.app)===(target==='main'))){
    const rights=plist.parse(result);rights['com.apple.security.files.user-selected.executable']=true;return plist.build(rights);
   }
   return result;
  };
  await assert.rejects(buildMas({root:f.root,env:f.env},f.dep),{code:'MAS_ENTITLEMENTS_UNVERIFIED'});
  assert.equal(f.calls.some(([name])=>name==='flat'),false,target+' must fail before installer');
 }
});
