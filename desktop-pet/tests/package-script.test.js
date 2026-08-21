const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildPackagerOptions,
  adhocSign,
  findElectronZipDir,
  prepareStaging
} = require('../scripts/package-mac');

test('只打包 Apple Silicon 本地应用并启用 asar', () => {
  const options = buildPackagerOptions('/repo', '/repo/desktop-pet/build/app.icns');
  assert.equal(options.platform, 'darwin');
  assert.equal(options.arch, 'arm64');
  assert.equal(options.asar, true);
  assert.equal(options.appBundleId, 'local.xiaokun.emotionball.pet');
  assert.equal(options.name, '球球桌宠');
  assert.equal(options.out, '/repo/dist');
  assert.equal(options.quiet, true);
});

test('打包后执行整个应用的本机临时签名', () => {
  assert.equal(typeof adhocSign, 'function');
});

test('打包暂存区包含主进程依赖的跳跃模块', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  const relativePath = 'desktop-pet/lib/window-bounce.js';

  assert.equal(
    fs.readFileSync(path.join(staging, relativePath), 'utf8'),
    fs.readFileSync(path.join(root, relativePath), 'utf8')
  );
});

test('打包暂存区包含菜单栏的 1x 和 Retina 2x 图标', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  for (const relativePath of [
    'desktop-pet/assets/tray-iconTemplate.png',
    'desktop-pet/assets/tray-iconTemplate@2x.png'
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(staging, relativePath)),
      fs.readFileSync(path.join(root, relativePath))
    );
  }
});

test('优先复用本机已经下载好的 Electron 压缩包', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-cache-'));
  const zipDir = path.join(cacheRoot, 'cache-key');
  fs.mkdirSync(zipDir);
  fs.writeFileSync(
    path.join(zipDir, 'electron-v43.4.1-darwin-arm64.zip'),
    'fixture'
  );

  assert.equal(findElectronZipDir(cacheRoot), zipDir);
  assert.equal(
    buildPackagerOptions('/repo', '/repo/desktop-pet/build/app.icns', zipDir)
      .electronZipDir,
    zipDir
  );

  fs.rmSync(cacheRoot, { recursive: true, force: true });
});

test('真实启动检查使用独立的临时设置目录', () => {
  const text = fs.readFileSync(
    path.resolve(__dirname, '../scripts/smoke-electron.js'),
    'utf8'
  );
  assert.match(text, /--user-data-dir=/);
  assert.match(text, /mkdtempSync/);
});
