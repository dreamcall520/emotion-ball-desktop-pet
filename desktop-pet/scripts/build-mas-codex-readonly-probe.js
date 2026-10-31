#!/usr/bin/env node
'use strict';
// Build only. Does not launch the App or read credentials.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-mas-codex-readonly-'));
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr}`);
}
try {
  const app = path.join(scratch, 'QiuqiuCodexReadOnlyProbe.app');
  const contents = path.join(app, 'Contents');
  const binary = path.join(contents, 'MacOS/probe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  run('xcrun', ['swiftc', path.join(root, 'docs/mac-app-store/probe/CodexReadOnlyProbe.swift'), '-o', binary]);
  fs.writeFileSync(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.mascodexreadonlyprobe</string><key>CFBundleName</key><string>QiuqiuCodexReadOnlyProbe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  run('codesign', ['--force', '--sign', '-', '--entitlements', path.join(root, 'docs/mac-app-store/probe/sandbox.entitlements.plist'), app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  process.stdout.write(JSON.stringify({ app, binary, built: true, signatureVerified: true,
    launched: false, accountRead: false, modelCalls: 0, distributionSigned: false }, null, 2) + '\n');
} catch (error) {
  fs.rmSync(scratch, { recursive: true, force: true });
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
}
