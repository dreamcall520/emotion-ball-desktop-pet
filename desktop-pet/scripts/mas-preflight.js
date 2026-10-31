#!/usr/bin/env node
'use strict';
// Read-only inventory. Passing this check never means App Review approval.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
function probe(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
  return { ok: !r.error && r.status === 0, output: r.stdout || '' };
}
function inspect({ root = DEFAULT_ROOT, run = probe, io = fs } = {}) {
  const pkg = JSON.parse(io.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packaging = io.readFileSync(path.join(root, 'desktop-pet/scripts/package-mac.js'), 'utf8');
  const signing = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  const identitySummary = signing.ok ? signing.output.match(/(\d+) valid identities found/) : null;
  const identityCount = identitySummary ? Number(identitySummary[1]) : null;
  const xcode = run('xcodebuild', ['-version']);
  const git = run('git', ['-C', root, 'rev-parse', 'HEAD']);
  const entrypoint = (name, buildExport) => {
    const file = path.join(root, 'desktop-pet/scripts', name);
    let source; try { source = io.readFileSync(file, 'utf8'); } catch (_) { return { entrypoint: name, implementationPresent: false, executedByPreflight: false }; }
    return { entrypoint: name, implementationPresent: source.includes(`function ${buildExport}(`) && /platform:\s*['"]mas['"]/.test(source) && source.includes('module.exports'), executedByPreflight: false };
  };
  const development = entrypoint('package-mas-development.js', 'buildMasDevelopment');
  const distribution = entrypoint('package-mas.js', 'buildMas');
  return {
    checkedAt: new Date().toISOString(), sourceCommit: git.ok ? git.output.trim() : null,
    version: pkg.version, electron: pkg.devDependencies.electron,
    xcodeAvailable: xcode.ok, xcodeVersion: xcode.ok ? xcode.output.trim() : null,
    signingCheckAvailable: signing.ok, validCodeSigningIdentityCount: identityCount,
    // A local identity does not establish membership, distribution eligibility or a matching profile.
    developerMembership: 'not-verified', provisioningProfile: 'not-verified',
    currentPackagerUsesDarwin: /platform:\s*['"]darwin['"]/.test(packaging),
    currentPackagerUsesAdhocSigning: /'--sign',\s*'-'/.test(packaging),
    packagerInventoryScope: 'The default Darwin/ad-hoc packager is separate from the dedicated MAS entrypoints.',
    masBuildPipeline: { development, distribution },
    signingReadiness: 'not-verified; identity count does not validate the required identity type, profile, team, app or device',
    signedMasRuntimeAcceptance: 'not-verified-by-preflight',
    chatTaskAndDirectorySandboxAcceptance: 'not-verified-by-preflight',
    appStoreConnectMetadata: 'not-verified',
    submissionReady: false,
    blockers: [
      ...(!xcode.ok ? ['Xcode command-line build unavailable'] : []),
      ...(!signing.ok ? ['Code signing identity check unavailable'] : []),
      ...(identityCount === 0 ? ['No valid local code signing identity'] : []),
      ...(!development.implementationPresent ? ['MAS development build entrypoint missing or incomplete'] : []),
      ...(!distribution.implementationPresent ? ['MAS distribution signing and installer entrypoint missing or incomplete'] : []),
      'Required MAS signing identities, matching provisioning profile and development device registration still require validation',
      'Actual signed MAS runtime and chat/task/directory sandbox acceptance require separate evidence',
      'Automatic external plugin installation remains gated pending MAS permission and review validation',
      'App Store Connect metadata, processing and review readiness require separate validation'
    ]
  };
}
if (require.main === module) {
  const report = inspect();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.submissionReady ? 0 : 2;
}
module.exports = { inspect };
