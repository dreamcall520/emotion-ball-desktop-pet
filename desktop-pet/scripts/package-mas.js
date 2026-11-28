#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, X509Certificate } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const release = require('./mas-release-profile');
const APP_NAME = '球球桌宠';
// Explicit cache opt-in is pinned to a separately verified official MAS archive.
const MAS_RUNTIME_SHA256 = Object.freeze({ '43.4.1/arm64': '84e562785040616029df3d562f3193c8b3953948a095d8b8611c990b45a69b98' });
const REQUIRED = ['MAS_BUNDLE_ID', 'MAS_TEAM_ID', 'MAS_PROFILE', 'MAS_SIGN_IDENTITY', 'MAS_INSTALLER_IDENTITY', 'MAS_BUILD_VERSION'];
function failure(code) { return Object.assign(new Error(code), { code }); }
function marketingVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw failure('MAS_VERSION_INVALID');
  const parts = version.split('.').map(Number);
  if (!parts.every(value => Number.isSafeInteger(value) && value >= 0)) throw failure('MAS_VERSION_INVALID');
  return parts.join('.');
}
function configFor(pkg, env = {}, arch = env.MAS_ARCH || 'arm64') {
  const missing = REQUIRED.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  const errors = [];
  let version = null;
  try { version = marketingVersion(pkg.version); } catch (_) { errors.push('MAS_VERSION_INVALID'); }
  const config = { releaseProfile: pkg.qiuqiuReleaseProfile, arch, marketingVersion: version, electronVersion: pkg.devDependencies?.electron,
    bundleId: env.MAS_BUNDLE_ID, teamId: env.MAS_TEAM_ID, profile: env.MAS_PROFILE,
    signIdentity: env.MAS_SIGN_IDENTITY, installerIdentity: env.MAS_INSTALLER_IDENTITY, buildVersion: env.MAS_BUILD_VERSION, runtimeZipDir: env.MAS_ELECTRON_ZIP_DIR };
  if (!['arm64', 'x64'].includes(arch)) errors.push('MAS_ARCH_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(config.electronVersion || '')) errors.push('MAS_ELECTRON_VERSION_INVALID');
  if (config.bundleId && !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(config.bundleId)) errors.push('MAS_BUNDLE_ID_INVALID');
  if (config.teamId && !/^[A-Z0-9]{10}$/.test(config.teamId)) errors.push('MAS_TEAM_ID_INVALID');
  if (config.runtimeZipDir !== undefined && (typeof config.runtimeZipDir !== 'string' || !path.isAbsolute(config.runtimeZipDir) || /[\r\n\0]/.test(config.runtimeZipDir))) errors.push('MAS_RUNTIME_CACHE_DIRECTORY_INVALID');
  if (config.runtimeZipDir !== undefined && !MAS_RUNTIME_SHA256[`${config.electronVersion}/${config.arch}`]) errors.push('MAS_RUNTIME_CACHE_ARCHIVE_UNPINNED');
  if (config.profile && !path.isAbsolute(config.profile)) errors.push('MAS_PROFILE_PATH_INVALID');
  if (config.buildVersion && (!/^[1-9]\d*$/.test(config.buildVersion) || !Number.isSafeInteger(Number(config.buildVersion)))) errors.push('MAS_BUILD_VERSION_INVALID');
  const identity = (value, prefixes) => typeof value === 'string' && value.length <= 256 && !/[\r\n\0]/.test(value) && prefixes.some(prefix => value.startsWith(prefix + ': ') && value.length > prefix.length + 2);
  if (config.signIdentity && !identity(config.signIdentity, ['Apple Distribution', '3rd Party Mac Developer Application', 'Mac App Distribution'])) errors.push('MAS_DISTRIBUTION_IDENTITY_REQUIRED');
  if (config.installerIdentity && !identity(config.installerIdentity, ['Mac Installer Distribution', '3rd Party Mac Developer Installer'])) errors.push('MAS_INSTALLER_DISTRIBUTION_IDENTITY_REQUIRED');
  return { config, missing, errors };
}
function planFor(pkg, env = {}, arch) {
  const { config, missing, errors } = configFor(pkg, env, arch);
  return { mode: 'plan', platform: 'mas', releaseProfile: config.releaseProfile || null, ...release.providerRuntimeMetadata(config), arch: config.arch,
    marketingVersion: config.marketingVersion, buildVersion: config.buildVersion || null,
    electronVersion: config.electronVersion || null,
    configured: Object.fromEntries(REQUIRED.map(name => [name, !missing.includes(name)])),
    missingConfiguration: missing, configurationErrors: errors,
    configurationReady: missing.length === 0 && errors.length === 0,
    runtimeSource: config.runtimeZipDir === undefined ? 'official-mas-download' : 'explicit-pinned-mas-cache',
    cachedRuntimeValidated: false,
    profileValidated: false, signingIdentitiesValidated: false, submissionReady: false,
    note: 'Plan only; no profile/keychain read, runtime download, signing, upload or submission.' };
}
function identities(output) {
  return String(output).split('\n').flatMap(line => {
    const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"\s*$/);
    return match ? [{ fingerprint: match[1].toUpperCase(), name: match[2] }] : [];
  });
}
function validateProfile(profile, config, fingerprint, now = Date.now()) {
  const entitlements = profile?.Entitlements;
  if (!profile || typeof profile !== 'object' || !entitlements ||
      !(profile.ExpirationDate instanceof Date) || !Number.isFinite(profile.ExpirationDate.getTime())) throw failure('MAS_PROFILE_INVALID');
  if (profile.ExpirationDate.getTime() <= now) throw failure('MAS_PROFILE_EXPIRED');
  if (profile.CreationDate instanceof Date && profile.CreationDate.getTime() > now) throw failure('MAS_PROFILE_NOT_YET_VALID');
  if (!Array.isArray(profile.Platform) || !profile.Platform.some(value => ['OSX', 'macOS'].includes(value))) throw failure('MAS_PROFILE_PLATFORM_MISMATCH');
  if (!Array.isArray(profile.TeamIdentifier) || !profile.TeamIdentifier.includes(config.teamId) ||
      entitlements['com.apple.developer.team-identifier'] !== config.teamId) throw failure('MAS_PROFILE_TEAM_MISMATCH');
  const appId = entitlements['com.apple.application-identifier'] || entitlements['application-identifier'];
  if (appId !== `${config.teamId}.${config.bundleId}`) throw failure('MAS_PROFILE_APP_ID_MISMATCH');
  if (entitlements['get-task-allow'] === true || entitlements['com.apple.security.get-task-allow'] === true ||
      profile.ProvisionsAllDevices === true || Array.isArray(profile.ProvisionedDevices) && profile.ProvisionedDevices.length > 0) {
    throw failure('MAS_APP_STORE_DISTRIBUTION_PROFILE_REQUIRED');
  }
  const groups = entitlements['com.apple.security.application-groups'];
  if (!Array.isArray(groups) || !groups.includes(`${config.teamId}.${config.bundleId}`) && !groups.includes(`${config.teamId}.*`)) {
    throw failure('MAS_PROFILE_APP_GROUP_MISMATCH');
  }
  const certificate = Array.isArray(profile.DeveloperCertificates) && profile.DeveloperCertificates.find(value =>
    (Buffer.isBuffer(value) || value instanceof Uint8Array) && createHash('sha1').update(value).digest('hex').toUpperCase() === fingerprint);
  if (!certificate) throw failure('MAS_PROFILE_CERTIFICATE_MISMATCH');
  validateCertificate(certificate, config.signIdentity, config.teamId, 'application');
  return { profileValidated: true };
}
function validateCertificate(certificate, identity, teamId, purpose) {
  let subject; try { subject = new X509Certificate(certificate).toLegacyObject().subject; }
  catch (_) { throw failure('MAS_CERTIFICATE_INVALID'); }
  if (typeof subject?.OU !== 'string' || subject.OU !== teamId) throw failure('MAS_CERTIFICATE_TEAM_MISMATCH');
  const prefixes = purpose === 'installer' ? ['Mac Installer Distribution', '3rd Party Mac Developer Installer'] : ['Apple Distribution', '3rd Party Mac Developer Application', 'Mac App Distribution'];
  if (typeof subject.CN !== 'string' || !prefixes.some(prefix => subject.CN.startsWith(prefix + ': '))) throw failure('MAS_DISTRIBUTION_CERTIFICATE_REQUIRED');
  if (subject.CN !== identity) throw failure('MAS_CERTIFICATE_IDENTITY_MISMATCH');
  return { certificateValidated: true };
}
function installerCertificate(pem, fingerprint) {
  for (const block of String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []) {
    try { const value = new X509Certificate(block); if (value.fingerprint.replace(/:/g, '').toUpperCase() === fingerprint) return value.raw; } catch (_) {}
  }
  throw failure('MAS_INSTALLER_CERTIFICATE_UNAVAILABLE');
}
function entitlementsFor(config) {
  const rights = { main: { 'com.apple.security.app-sandbox': true,
    'com.apple.application-identifier': `${config.teamId}.${config.bundleId}`,
    'com.apple.developer.team-identifier': config.teamId, 'com.apple.security.application-groups': [`${config.teamId}.${config.bundleId}`],
    'com.apple.security.files.user-selected.read-write': true, 'com.apple.security.files.user-selected.executable': true,
    'com.apple.security.files.bookmarks.app-scope': true, 'com.apple.security.network.client': true,
    'com.apple.security.network.server': true, 'com.apple.security.personal-information.location': true, 'com.apple.security.personal-information.calendars': true },
    child: { 'com.apple.security.app-sandbox': true, 'com.apple.security.inherit': true } };
  // Also required by the opt-in WorkBuddy filter script and loopback receiver.
  return rights;
}
function distributionEntry() { return "'use strict';\nif(process.mas!==true){process.stderr.write('MAS_RUNTIME_REQUIRED\\n');process.exit(2);}else require('./desktop-pet/main.js');\n"; }
function command(commandName, args) {
  try { return execFileSync(commandName, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (_) { throw failure(`MAS_TOOL_FAILED_${path.basename(commandName).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`); }
}
function validateMasRuntimeCache(config, io = fs) {
  if (config.runtimeZipDir === undefined) return { used: false, validated: false };
  const expected = MAS_RUNTIME_SHA256[`${config.electronVersion}/${config.arch}`];
  if (!expected) throw failure('MAS_RUNTIME_CACHE_ARCHIVE_UNPINNED');
  if (typeof config.runtimeZipDir !== 'string' || !path.isAbsolute(config.runtimeZipDir) || /[\r\n\0]/.test(config.runtimeZipDir)) throw failure('MAS_RUNTIME_CACHE_DIRECTORY_INVALID');
  const name = `electron-v${config.electronVersion}-mas-${config.arch}.zip`, archive = path.join(config.runtimeZipDir, name);
  let descriptor;
  try {
    const directory = io.lstatSync(config.runtimeZipDir), file = io.lstatSync(archive);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || file.size < 1) throw failure('MAS_RUNTIME_CACHE_ARCHIVE_UNAVAILABLE');
    descriptor = io.openSync(archive, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let length; while ((length = io.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
    if (hash.digest('hex') !== expected) throw failure('MAS_RUNTIME_CACHE_SHA256_MISMATCH');
    return { used: true, validated: true, archive: name, sha256: expected };
  } catch (error) {
    if (error?.code?.startsWith('MAS_RUNTIME_CACHE_')) throw error;
    throw failure('MAS_RUNTIME_CACHE_ARCHIVE_UNAVAILABLE');
  } finally { if (descriptor !== undefined) io.closeSync(descriptor); }
}
function packagerOptions(root, config, staging, icon, baseOptions = {}) {
  const options = { ...baseOptions, dir: staging, out: path.join(root, 'dist/mas', config.arch),
    name: APP_NAME, platform: 'mas', arch: config.arch, appBundleId: config.bundleId,
    appVersion: config.marketingVersion, buildVersion: config.buildVersion, electronVersion: config.electronVersion,
    appCategoryType: 'public.app-category.entertainment', icon,
    asar: { unpack: '**/*.node' }, overwrite: true, prune: true, quiet: true,
    extraResource: release.resourceNames(config).map(name => path.join(root, 'desktop-pet/build', name)),
    extendInfo: { ...baseOptions.extendInfo, ElectronTeamID: config.teamId },
    // Sign explicitly after staging every helper; refresh signed binary hashes
    // before the final outer seal, preserving all nested signatures.
    osxSign: false
  };
  // A normal Electron ZIP is never a fallback for the MAS runtime.
  delete options.electronZipDir;
  if (config.runtimeZipDir !== undefined) options.electronZipDir = config.runtimeZipDir;
  delete options.osxNotarize;
  return options;
}
async function buildMas({ root = DEFAULT_ROOT, env = process.env, arch } = {}, dependencies = {}) {
  const io = dependencies.fs || fs;
  const pkg = JSON.parse(io.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const parsed = configFor(pkg, env, arch);
  if (parsed.missing.length || parsed.errors.length) throw failure('MAS_CONFIGURATION_REQUIRED');
  const config = parsed.config;
  if ((dependencies.hostPlatform || process.platform) !== 'darwin') throw failure('MAS_MACOS_BUILD_HOST_REQUIRED');
  // Existing native weather compiler targets the build host. Never package an
  // arm64 .node into x64 or vice versa; cross-architecture build is not implied.
  if ((dependencies.hostArch || process.arch) !== config.arch) throw failure('MAS_MATCHING_NATIVE_BUILD_HOST_REQUIRED');
  const run = dependencies.command || command;
  (dependencies.validateBuildTools || require('./mas-development-tools').validateMasDevelopmentTools)({ run, io });
  let profileInfo;
  try { const stat = io.lstatSync(config.profile); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error(); }
  catch (_) { throw failure('MAS_PROFILE_UNAVAILABLE'); }
  const application = identities(run('security', ['find-identity', '-v', '-p', 'codesigning'])).find(value => value.name === config.signIdentity);
  if (!application) throw failure('MAS_DISTRIBUTION_IDENTITY_UNAVAILABLE');
  const installer = identities(run('security', ['find-identity', '-v', '-p', 'basic'])).find(value => value.name === config.installerIdentity);
  if (!installer) throw failure('MAS_INSTALLER_IDENTITY_UNAVAILABLE');
  try {
    const decoded = run('security', ['cms', '-D', '-i', config.profile]);
    const parseProfile = dependencies.parseProfile || require('plist').parse;
    profileInfo = parseProfile(decoded);
  } catch (_) { throw failure('MAS_PROFILE_INVALID'); }
  validateProfile(profileInfo, config, application.fingerprint, dependencies.now?.() ?? Date.now());
  validateCertificate(installerCertificate(run('security', ['find-certificate', '-a', '-c', config.installerIdentity, '-p']), installer.fingerprint), config.installerIdentity, config.teamId, 'installer');
  const runtimeCache = validateMasRuntimeCache(config, io);
  if (!release.isFirstRelease(config)) await (dependencies.validateResources || (async () => { const resourcesPath=path.join(root,'desktop-pet/build'); await require('../lib/mas-bundled-codex').resolveBundledCodex({resourcesPath,arch:config.arch}); if (!release.isFirstRelease(config)) await require('../lib/mas-bundled-workbuddy').resolveBundledWorkBuddy({resourcesPath}); }))();
  // All signing/profile checks precede imports that may download runtimes or build.
  const mac = dependencies.mac || require('./package-mac');
  const makeIcon = dependencies.makeIcon || require('./make-icon').makeIcon;
  const buildWeatherLocation = dependencies.buildWeatherLocation || require('./build-weather-location').buildWeatherLocation;
  const packageApp = dependencies.packager || (await import('@electron/packager')).packager;
  const signing = dependencies.signing || await import('@electron/osx-sign');
  // osx-sign 2.7.0 exports Promise-based `flat`; older API names use `flatAsync`.
  const flatAsync = signing.flatAsync || signing.flat;
  if (typeof flatAsync !== 'function') throw failure('MAS_FLAT_API_UNAVAILABLE');
  const sign = signing.signAsync || signing.sign; if (typeof sign !== 'function') throw failure('MAS_SIGN_API_UNAVAILABLE');
  buildWeatherLocation(root);
  (dependencies.buildCalendarEvents || require('./build-calendar-events').buildCalendarEvents)(root, { targetArch: config.arch });
  (dependencies.buildPluginHost || require('./build-plugin-host').buildPluginHost)(root);
  const icon = makeIcon(root);
  const staging = mac.prepareStaging(root, path.join(root, 'desktop-pet/build/mas-staging', config.arch), {pluginNative:true});
  const stagedPackage = JSON.parse(io.readFileSync(path.join(staging, 'package.json'), 'utf8'));
  stagedPackage.version = config.marketingVersion;
  delete stagedPackage.qiuqiuAcceptance;
  release.trimStaging(staging, config, io);
  if (release.isFirstRelease(config)) stagedPackage.qiuqiuReleaseProfile = release.FIRST_RELEASE;
  stagedPackage.qiuqiuDistribution = 'mas'; stagedPackage.main = 'mas-distribution-entry.js';
  io.writeFileSync(path.join(staging,'mas-distribution-entry.js'), distributionEntry());
  io.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(stagedPackage, null, 2) + '\n');
  const options = packagerOptions(root, config, staging, icon, mac.buildPackagerOptions(root, icon));
  const results = await packageApp(options);
  if (!Array.isArray(results) || results.length !== 1) throw failure('MAS_PACKAGE_OUTPUT_INVALID');
  const appPath = path.join(results[0], `${APP_NAME}.app`);
  if (!io.existsSync(appPath)) throw failure('MAS_APP_OUTPUT_MISSING');
  release.assertNoBundledProviders(appPath, config, io);
  const languageResources = release.trimElectronLocales(appPath, config, io);
  const plist = dependencies.buildPlist || require('plist').build, parseSealed = dependencies.parsePlist || require('plist').parse;
  const rights = entitlementsFor(config), signingDirectory = path.join(options.out,'signing'); io.mkdirSync(signingDirectory,{recursive:true,mode:0o700});
  const mainFile = path.join(signingDirectory,'main.entitlements.plist'), childFile = path.join(signingDirectory,'child.entitlements.plist');
  io.writeFileSync(mainFile,plist(rights.main)); io.writeFileSync(childFile,plist(rights.child));
  if (release.isFirstRelease(config)) {
    const manifest = path.join(DEFAULT_ROOT, 'desktop-pet/native/PrivacyInfo.xcprivacy');
    io.copyFileSync(manifest, path.join(appPath, 'Contents/Resources/PrivacyInfo.xcprivacy'));
  }
  io.copyFileSync(config.profile,path.join(appPath,'Contents/embedded.provisionprofile'));
  const codexBinary = path.join(appPath,'Contents/Resources/qiuqiu-codex',`darwin-${config.arch}`,'codex');
  await sign({ app:appPath,platform:'mas',type:'distribution',batchCodesignCalls:true,identity:application.fingerprint,
    identityValidation:true,provisioningProfile:config.profile,preEmbedProvisioningProfile:true,preAutoEntitlements:false,strictVerify:true,
    binaries:release.isFirstRelease(config)?[]:[codexBinary],optionsForFile:file=>({entitlements:file===appPath?mainFile:childFile,hardenedRuntime:false}) });
  let bundledManifestRefresh; try { bundledManifestRefresh = require('./package-mas-development').refreshBundledManifests(appPath,io,config.arch,config); }
  catch (_) { throw failure('MAS_BUNDLED_MANIFEST_REFRESH_FAILED'); }
  run('codesign',['--force','--sign',application.fingerprint,'--entitlements',mainFile,appPath]);
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  const ownTargets=release.isFirstRelease(config)?release.ownSigningTargets(appPath,io):[];
  for(const target of ownTargets)run('codesign',['--verify','--strict',target.path]);
  for(const file of [appPath,...(release.isFirstRelease(config)?ownTargets.filter(t=>t.entitlements).map(t=>t.path):[codexBinary,path.join(appPath,'Contents/Frameworks',APP_NAME+' Helper.app')])]) {
    let actual; try { actual=parseSealed(run('codesign',['--display','--entitlements',':-',file])); } catch (_) { throw failure('MAS_ENTITLEMENTS_UNVERIFIED'); }
    const expected=file===appPath?rights.main:rights.child;
    if(Object.entries(expected).some(([key,value])=>JSON.stringify(actual?.[key])!==JSON.stringify(value))||['get-task-allow','com.apple.security.get-task-allow'].some(key=>actual?.[key]===true))throw failure('MAS_ENTITLEMENTS_UNVERIFIED');
  }
  const pkgPath = path.join(options.out, `Qiuqiu-${config.marketingVersion}-${config.buildVersion}-mas-${config.arch}.pkg`);
  await flatAsync({ app: appPath, pkg: pkgPath, platform: 'mas', identity: config.installerIdentity,
    identityValidation: true, install: '/Applications' });
  if (!io.existsSync(pkgPath)) throw failure('MAS_PKG_OUTPUT_MISSING');
  run('pkgutil', ['--check-signature', pkgPath]);
  return { platform: 'mas', releaseProfile: config.releaseProfile || null, ...release.providerRuntimeMetadata(config), arch: config.arch, marketingVersion: config.marketingVersion, buildVersion: config.buildVersion,
    appPath, pkgPath, signedDistributionPackage: true, profileValidated: true, runtimeCache, bundledManifestRefresh, languageResources, signedEntitlementsValidated:true, runtimeAcceptancePassed:false,
    submissionReady: false, note: 'Signed build only; runtime acceptance, App Store processing/review and release are separate.' };
}
function argumentsFor(argv) {
  let mode = 'plan', arch, specified = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--plan' || arg === '--build') {
      if (specified) throw failure('MAS_ARGUMENTS_INVALID');
      specified = true; mode = arg.slice(2);
    } else if (arg === '--arch' && argv[index + 1] && arch === undefined) arch = argv[++index];
    else throw failure('MAS_ARGUMENTS_INVALID');
  }
  return { mode, arch };
}
if (require.main === module) {
  (async () => {
    const { mode, arch } = argumentsFor(process.argv.slice(2));
    if (mode === 'plan') {
      const pkg = JSON.parse(fs.readFileSync(path.join(DEFAULT_ROOT, 'package.json'), 'utf8'));
      process.stdout.write(JSON.stringify(planFor(pkg, process.env, arch), null, 2) + '\n');
    } else process.stdout.write(JSON.stringify(await buildMas({ arch }), null, 2) + '\n');
  })().catch(error => { process.stderr.write(`${error?.code?.startsWith('MAS_') ? error.code : 'MAS_BUILD_FAILED'}\n`); process.exitCode = 2; });
}
module.exports = { marketingVersion, configFor, planFor, identities, validateProfile, validateCertificate, installerCertificate, entitlementsFor, distributionEntry, validateMasRuntimeCache, packagerOptions, buildMas, argumentsFor };
