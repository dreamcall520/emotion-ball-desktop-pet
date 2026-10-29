const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'dist/球球桌宠-darwin-arm64/球球桌宠.app');
const archive = path.join(app, 'Contents/Resources/app.asar');
const staging = path.join(root, 'desktop-pet/build/staging');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
function walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) walk(path.join(dir, item.name), relative + '/');
    else if (item.isFile()) files.push(relative);
    else throw Error('Unexpected staging file type: ' + relative);
  }
}
walk(staging);
for (const file of files) {
  const bytes = asar.extractFile(archive, file);
  const staged = fs.readFileSync(path.join(staging, file));
  if (file === 'package.json') {
    // Electron Packager removes the development-only private flag.
    const expected = JSON.parse(staged); delete expected.private;
    assert.deepEqual(JSON.parse(bytes), expected, 'packaged metadata changed unexpectedly');
  } else assert.equal(hash(bytes), hash(staged), file + ' archive mismatch');
  const integrity = asar.statFile(archive, file).integrity;
  if (integrity) assert.equal(hash(bytes), integrity.hash, file + ' integrity mismatch');
}
const changed = ['desktop-pet/main.js', 'desktop-pet/customize.html', 'desktop-pet/lib/codex-pets.js', 'desktop-pet/lib/codex-pet-player.js'];
const production = changed.map(file => {
  const digest = hash(asar.extractFile(archive, file));
  assert.equal(digest, hash(fs.readFileSync(path.join(root, file))), file + ' source mismatch');
  return { file, sha256: digest };
});
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
const result = { base: '1dcdbf8', app, archive, archiveSha256: hash(fs.readFileSync(archive)),
  comparedStagingFiles: files.length, production, codesign: 'adhoc deep strict verify passed',
  installed: false, launchedNormally: false, installedProfileChanged: false };
fs.writeFileSync(path.join(__dirname, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
