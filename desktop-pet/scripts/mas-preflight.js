#!/usr/bin/env node
'use strict';
// Read-only inventory. Passing this check never means App Review approval.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
function probe(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
  return { ok: !r.error && r.status === 0, output: r.stdout || '' };
}
function inspect() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packaging = fs.readFileSync(path.join(root, 'desktop-pet/scripts/package-mac.js'), 'utf8');
  const signing = probe('security', ['find-identity', '-v', '-p', 'codesigning']);
  const identityCount = Number(signing.output.match(/(\d+) valid identities found/)?.[1] || 0);
  const xcode = probe('xcodebuild', ['-version']);
  const git = probe('git', ['-C', root, 'rev-parse', 'HEAD']);
  return {
    checkedAt: new Date().toISOString(), sourceCommit: git.ok ? git.output.trim() : null,
    version: pkg.version, electron: pkg.devDependencies.electron,
    xcodeAvailable: xcode.ok, xcodeVersion: xcode.ok ? xcode.output.trim() : null,
    signingCheckAvailable: signing.ok, validCodeSigningIdentityCount: identityCount,
    // A local identity does not establish membership, distribution eligibility or a matching profile.
    developerMembership: 'not-verified', provisioningProfile: 'not-verified',
    currentPackagerUsesDarwin: /platform:\s*['"]darwin['"]/.test(packaging),
    currentPackagerUsesAdhocSigning: /'--sign',\s*'-'/.test(packaging),
    submissionReady: false,
    blockers: [
      ...(!xcode.ok ? ['Xcode command-line build unavailable'] : []),
      ...(!signing.ok ? ['Code signing identity check unavailable'] : []),
      ...(identityCount === 0 ? ['No valid local code signing identity'] : []),
      'MAS runtime, sandbox, distribution signing and installer pipeline not implemented',
      'External tool integrations and independent updater require MAS adaptation',
      'Signed sandbox runtime acceptance and App Store Connect metadata not completed'
    ]
  };
}
if (require.main === module) {
  const report = inspect();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.submissionReady ? 0 : 2;
}
module.exports = { inspect };
