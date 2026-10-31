#!/usr/bin/env node
'use strict';
// Native diagnostic only. No provider files, credentials, model calls or app settings.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-mas-probe-'));
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) throw new Error(`${command} failed (${r.status}): ${r.error?.message || r.stderr}`);
  return r.stdout;
}
try {
  const bundle = path.join(dir, 'QiuqiuSandboxProbe.app');
  const contents = path.join(bundle, 'Contents');
  const binary = path.join(contents, 'MacOS/probe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.masprobe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
  const fixture = path.join(dir, 'fixture.txt'), helper = path.join(dir, 'helper.sh');
  fs.writeFileSync(fixture, 'synthetic fixture only\n');
  fs.writeFileSync(helper, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const probeRoot = path.join(root, 'docs/mac-app-store/probe');
  run('xcrun', ['swiftc', path.join(probeRoot, 'SandboxProbe.swift'), '-o', binary]);
  const baseline = JSON.parse(run(binary, [fixture, helper]));
  run('codesign', ['--force', '--sign', '-', '--entitlements', path.join(probeRoot, 'sandbox.entitlements.plist'), bundle]);
  run('codesign', ['--verify', '--strict', bundle]);
  const sandbox = JSON.parse(run(binary, [fixture, helper]));
  const expectedBoundaryObserved = baseline.syntheticExternalFileReadable === true &&
    baseline.syntheticExternalHelper.exitCode === 0 && sandbox.syntheticExternalFileReadable === false &&
    sandbox.syntheticExternalHelper.launched === false && sandbox.systemTrue.exitCode === 0;
  process.stdout.write(JSON.stringify({ checkedAt: new Date().toISOString(),
    sourceCommit: run('git', ['-C', root, 'rev-parse', 'HEAD']).trim(),
    diagnostic: 'native App Sandbox with ad-hoc signing; not Electron MAS acceptance',
    expectedBoundaryObserved, baseline, sandbox,
    notTested: ['user-selected security-scoped bookmarks', 'provider sockets', 'provider CLI execution',
      'provider authentication and live data', 'Electron MAS runtime', 'App Review eligibility'] }, null, 2) + '\n');
  if (!expectedBoundaryObserved) process.exitCode = 2;
} catch (error) {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
