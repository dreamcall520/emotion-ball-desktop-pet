#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const APP_NAME = '球球桌宠';
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
  const config = { arch, marketingVersion: version, electronVersion: pkg.devDependencies?.electron,
    bundleId: env.MAS_BUNDLE_ID, teamId: env.MAS_TEAM_ID, profile: env.MAS_PROFILE,
    signIdentity: env.MAS_SIGN_IDENTITY, installerIdentity: env.MAS_INSTALLER_IDENTITY, buildVersion: env.MAS_BUILD_VERSION };
  if (!['arm64', 'x64'].includes(arch)) errors.push('MAS_ARCH_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(config.electronVersion || '')) errors.push('MAS_ELECTRON_VERSION_INVALID');
  if (config.bundleId && !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(config.bundleId)) errors.push('MAS_BUNDLE_ID_INVALID');
  if (config.teamId && !/^[A-Z0-9]{10}$/.test(config.teamId)) errors.push('MAS_TEAM_ID_INVALID');
  if (config.profile && !path.isAbsolute(config.profile)) errors.push('MAS_PROFILE_PATH_INVALID');
  if (config.buildVersion && (!/^[1-9]\d*$/.test(config.buildVersion) || !Number.isSafeInteger(Number(config.buildVersion)))) errors.push('MAS_BUILD_VERSION_INVALID');
  const identity = (value, prefixes) => typeof value === 'string' && prefixes.some(prefix => value.startsWith(prefix + ': ')) && value.endsWith(` (${config.teamId})`);
  if (config.signIdentity && !identity(config.signIdentity, ['Apple Distribution', '3rd Party Mac Developer Application', 'Mac App Distribution'])) errors.push('MAS_DISTRIBUTION_IDENTITY_REQUIRED');
  if (config.installerIdentity && !identity(config.installerIdentity, ['Mac Installer Distribution', '3rd Party Mac Developer Installer'])) errors.push('MAS_INSTALLER_DISTRIBUTION_IDENTITY_REQUIRED');
  return { config, missing, errors };
}
function planFor(pkg, env = {}, arch) {
  const { config, missing, errors } = configFor(pkg, env, arch);
  return { mode: 'plan', platform: 'mas', arch: config.arch,
    marketingVersion: config.marketingVersion, buildVersion: config.buildVersion || null,
    electronVersion: config.electronVersion || null,
    configured: Object.fromEntries(REQUIRED.map(name => [name, !missing.includes(name)])),
    missingConfiguration: missing, configurationErrors: errors,
    configurationReady: missing.length === 0 && errors.length === 0,
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
  if (!Array.isArray(profile.DeveloperCertificates) || !profile.DeveloperCertificates.some(certificate => {
    if (!Buffer.isBuffer(certificate) && !(certificate instanceof Uint8Array)) return false;
    return createHash('sha1').update(certificate).digest('hex').toUpperCase() === fingerprint;
  })) throw failure('MAS_PROFILE_CERTIFICATE_MISMATCH');
  return { profileValidated: true };
}
function command(commandName, args) {
  try { return execFileSync(commandName, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (_) { throw failure(`MAS_TOOL_FAILED_${path.basename(commandName).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`); }
}
function packagerOptions(root, config, staging, icon, baseOptions = {}) {
  const permissions = path.join(root, 'desktop-pet/packaging/mas');
  const options = { ...baseOptions, dir: staging, out: path.join(root, 'dist/mas', config.arch),
    name: APP_NAME, platform: 'mas', arch: config.arch, appBundleId: config.bundleId,
    appVersion: config.marketingVersion, buildVersion: config.buildVersion, electronVersion: config.electronVersion,
    appCategoryType: 'public.app-category.entertainment', icon,
    asar: { unpack: '**/*.node' }, overwrite: true, prune: true, quiet: true,
    extendInfo: { ...baseOptions.extendInfo, ElectronTeamID: config.teamId },
    osxSign: { platform: 'mas', type: 'distribution', identity: config.signIdentity,
      provisioningProfile: config.profile, identityValidation: true, preEmbedProvisioningProfile: true,
      preAutoEntitlements: true, strictVerify: true,
      optionsForFile(filePath) { return {
        entitlements: path.join(permissions, path.basename(filePath) === `${APP_NAME}.app` ? 'main.entitlements.plist' : 'child.entitlements.plist'),
        hardenedRuntime: false
      }; }
    }
  };
  // A normal Electron ZIP is never a fallback for the MAS runtime.
  delete options.electronZipDir;
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
  run('xcodebuild', ['-version']);
  let profileInfo;
  try { const stat = io.statSync(config.profile); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error(); }
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
  // All signing/profile checks precede imports that may download runtimes or build.
  const mac = dependencies.mac || require('./package-mac');
  const makeIcon = dependencies.makeIcon || require('./make-icon').makeIcon;
  const buildWeatherLocation = dependencies.buildWeatherLocation || require('./build-weather-location').buildWeatherLocation;
  const packageApp = dependencies.packager || (await import('@electron/packager')).packager;
  const signing = dependencies.signing || await import('@electron/osx-sign');
  // osx-sign 2.7.0 exports Promise-based `flat`; older API names use `flatAsync`.
  const flatAsync = signing.flatAsync || signing.flat;
  if (typeof flatAsync !== 'function') throw failure('MAS_FLAT_API_UNAVAILABLE');
  buildWeatherLocation(root);
  const icon = makeIcon(root);
  const staging = mac.prepareStaging(root, path.join(root, 'desktop-pet/build/mas-staging', config.arch));
  const stagedPackage = JSON.parse(io.readFileSync(path.join(staging, 'package.json'), 'utf8'));
  stagedPackage.version = config.marketingVersion;
  stagedPackage.qiuqiuDistribution = 'mas';
  io.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(stagedPackage, null, 2) + '\n');
  const options = packagerOptions(root, config, staging, icon, mac.buildPackagerOptions(root, icon));
  const results = await packageApp(options);
  if (!Array.isArray(results) || results.length !== 1) throw failure('MAS_PACKAGE_OUTPUT_INVALID');
  const appPath = path.join(results[0], `${APP_NAME}.app`);
  if (!io.existsSync(appPath)) throw failure('MAS_APP_OUTPUT_MISSING');
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  const pkgPath = path.join(options.out, `Qiuqiu-${config.marketingVersion}-${config.buildVersion}-mas-${config.arch}.pkg`);
  await flatAsync({ app: appPath, pkg: pkgPath, platform: 'mas', identity: config.installerIdentity,
    identityValidation: true, install: '/Applications' });
  if (!io.existsSync(pkgPath)) throw failure('MAS_PKG_OUTPUT_MISSING');
  run('pkgutil', ['--check-signature', pkgPath]);
  return { platform: 'mas', arch: config.arch, marketingVersion: config.marketingVersion, buildVersion: config.buildVersion,
    appPath, pkgPath, signedDistributionPackage: true, profileValidated: true,
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
module.exports = { marketingVersion, configFor, planFor, identities, validateProfile, packagerOptions, buildMas, argumentsFor };
