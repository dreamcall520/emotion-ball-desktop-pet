#!/usr/bin/env node
'use strict';

// Build-time only. Never require this from main.js or include it in a MAS app.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const VERSION = '0.166.0';
const SOURCES = Object.freeze({
  arm64: { triple: 'aarch64-apple-darwin', integrity: 'sha512-5fWH6qqUInACcRADIewjlnRxDb4QLe0uriwehiZz0+viuAAB8I+WWefqw4xwHvyKaxeiGX4uK56+vrgfvFk3FQ==' },
  x64: { triple: 'x86_64-apple-darwin', integrity: 'sha512-Vj5wXJPizKmrzNtnRNQf9PP6FJkG3iJU/UO3NE4WvkENZGoQfmImdwf4MVRI5NgwjSuC6LT0HbBRHPVVnwGHuw==' }
});
const LICENSES = Object.freeze({ LICENSE: 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc',
  NOTICE: '9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915' });
const fail = code => Object.assign(new Error(code), { code });
async function download(url, maxSize) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw fail('DOWNLOAD_FAILED');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    if ((total += chunk.length) > maxSize) throw fail('DOWNLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function prepareMasCodexHelper({ arch = process.arch,
  outputRoot = path.resolve(__dirname, '../build/qiuqiu-codex'), archivePath } = {}) {
  const source = SOURCES[arch];
  if (!source || !path.isAbsolute(outputRoot)) throw fail('INVALID_INPUT');
  const url = `https://registry.npmjs.org/@openai/codex/-/codex-${VERSION}-darwin-${arch}.tgz`;
  const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qiuqiu-codex-build-'));
  try {
    const archive = archivePath ? await fs.promises.readFile(archivePath) : await download(url, 256 * 1024 * 1024);
    if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== source.integrity) throw fail('INTEGRITY_MISMATCH');
    const tgz = path.join(scratch, 'package.tgz'); await fs.promises.writeFile(tgz, archive, { mode: 0o600 });
    const member = `package/vendor/${source.triple}/bin/codex`;
    // Exact known members only. No package install/lifecycle scripts, no arbitrary extraction.
    execFileSync('/usr/bin/tar', ['-xzf', tgz, '-C', scratch, member, 'package/package.json'], { stdio: 'pipe' });
    const pkg = JSON.parse(await fs.promises.readFile(path.join(scratch, 'package/package.json'), 'utf8'));
    if (pkg.name !== '@openai/codex' || pkg.version !== `${VERSION}-darwin-${arch}` || pkg.license !== 'Apache-2.0') throw fail('PACKAGE_MISMATCH');
    const directory = path.join(outputRoot, `darwin-${arch}`); await fs.promises.mkdir(directory, { recursive: true });
    const binaryPath = path.join(directory, 'codex');
    await fs.promises.copyFile(path.join(scratch, member), binaryPath); await fs.promises.chmod(binaryPath, 0o755);
    for (const [name, sha256] of Object.entries(LICENSES)) {
      const content = await download(`https://raw.githubusercontent.com/openai/codex/rust-v${VERSION}/${name}`, 128 * 1024);
      if (createHash('sha256').update(content).digest('hex') !== sha256) throw fail('LICENSE_MISMATCH');
      await fs.promises.writeFile(path.join(directory, name), content);
    }
    const binarySha256 = createHash('sha256').update(await fs.promises.readFile(binaryPath)).digest('hex');
    const manifest = { schemaVersion: 1, provider: 'codex', version: VERSION, platform: 'darwin', arch,
      license: 'Apache-2.0', source: url, integrity: source.integrity, binary: 'codex', binarySha256 };
    await fs.promises.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { directory, version: VERSION, arch, binarySha256 };
  } finally { await fs.promises.rm(scratch, { recursive: true, force: true }); }
}
if (require.main === module) {
  const arch = process.argv[2] || process.arch, archivePath = process.argv[3];
  prepareMasCodexHelper({ arch, archivePath }).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write(JSON.stringify({ code: error.code || 'PREPARE_FAILED' }) + '\n'); process.exitCode = 1; });
}
module.exports = { prepareMasCodexHelper, VERSION, SOURCES };
