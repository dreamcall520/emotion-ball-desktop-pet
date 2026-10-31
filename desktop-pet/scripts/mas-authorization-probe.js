#!/usr/bin/env node
'use strict';
// Tests synthetic resources only. Native ad-hoc sandbox evidence, not MAS acceptance.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
async function run(command, args) {
  return (await execute(command, args, { timeout: 60000, maxBuffer: 1024 * 1024 })).stdout;
}
function listen(server, ...args) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(...args, resolve); });
}
function makeServer() {
  return net.createServer(socket => {
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', data => socket.end(data.toString() === 'ping\n' ? 'pong\n' : 'invalid\n'));
  });
}
async function main() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-mas-auth-'));
  const unix = makeServer(), tcp = makeServer();
  try {
    const fixture = path.join(scratch, 'fixture');
    const bundle = path.join(scratch, 'QiuqiuAuthorizationProbe.app');
    const contents = path.join(bundle, 'Contents');
    const binary = path.join(contents, 'MacOS/probe');
    const helper = path.join(contents, 'Helpers/ping-helper');
    const probe = path.join(root, 'docs/mac-app-store/probe');
    await fs.mkdir(fixture, { recursive: true });
    await fs.mkdir(path.dirname(binary), { recursive: true });
    await fs.mkdir(path.dirname(helper), { recursive: true });
    await fs.writeFile(path.join(fixture, 'fixture.json'), '{"synthetic":true}\n');
    await run('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table tasks(id integer)"); c.executemany("insert into tasks values (?)",[(1,),(2,)]); c.commit(); c.close()', path.join(fixture, 'fixture.sqlite')]);
    await fs.writeFile(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.xiaokun.emotionball.masauthorizationprobe</string><key>CFBundleName</key><string>QiuqiuAuthorizationProbe</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
    await run('xcrun', ['swiftc', path.join(probe, 'AuthorizedProbe.swift'), '-o', binary, '-lsqlite3']);
    await fs.copyFile(binary, helper);
    await listen(unix, path.join(fixture, 'ipc.sock'));
    await listen(tcp, 0, '127.0.0.1');
    const port = String(tcp.address().port);
    const baseline = JSON.parse(await run(binary, ['child', fixture, port]));
    await run('codesign', ['--force', '--sign', '-', '--entitlements', path.join(probe, 'inherit.entitlements.plist'), helper]);
    await run('codesign', ['--force', '--sign', '-', '--entitlements', path.join(probe, 'sandbox.entitlements.plist'), bundle]);
    await run('codesign', ['--verify', '--deep', '--strict', bundle]);
    const sandbox = JSON.parse(await run(binary, ['inspect', fixture, port]));
    const expectedBoundaryObserved = baseline.jsonReadable && baseline.sqliteReadOnlyRowCount === 2 &&
      baseline.unixSocket.pong && baseline.loopbackTCP.pong &&
      !sandbox.after.jsonReadable && sandbox.after.sqliteReadOnlyRowCount === -1 &&
      !sandbox.after.unixSocket.connected && sandbox.after.loopbackTCP.pong &&
      sandbox.bundledInheritedHelper.exitCode === 0 &&
      sandbox.bundledInheritedHelper.result.loopbackTCP.pong &&
      !sandbox.bundledInheritedHelper.result.jsonReadable &&
      !sandbox.bundledInheritedHelper.result.unixSocket.connected;
    const report = { checkedAt: new Date().toISOString(),
      sourceCommit: (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).trim(),
      diagnostic: 'native ad-hoc sandbox and inherited helper; not Electron MAS acceptance',
      expectedBoundaryObserved: Boolean(expectedBoundaryObserved), baseline, sandbox,
      directoryAuthorization: 'not-tested: native UI control timed out in separate interactive attempt',
      notTested: ['bookmark persistence/revocation', 'provider authentication and APIs', 'real provider CLI/socket', 'Electron MAS runtime', 'App Review'] };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!expectedBoundaryObserved) process.exitCode = 2;
  } finally {
    await Promise.all([unix, tcp].map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
