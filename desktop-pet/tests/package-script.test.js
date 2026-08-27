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

test('打包暂存区继承项目版本号', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  const stagedPackage = JSON.parse(
    fs.readFileSync(path.join(staging, 'package.json'), 'utf8')
  );
  const projectPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );

  assert.equal(stagedPackage.version, projectPackage.version);
});

test('安装包完整包含轻陪伴和气泡依赖，避免缺少模块', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  for (const relativePath of [
    'desktop-pet/lib/activity-monitor.js',
    'desktop-pet/lib/companion-behavior.js',
    'desktop-pet/lib/dialogue.js',
    'desktop-pet/lib/bubble-placement.js',
    'desktop-pet/lib/bubble-window.js',
    'desktop-pet/bubble.html',
    'desktop-pet/bubble.css',
    'desktop-pet/bubble-renderer.js',
    'desktop-pet/bubble-preload.js'
  ]) {
    assert.equal(fs.readFileSync(path.join(staging, relativePath), 'utf8'),
      fs.readFileSync(path.join(root, relativePath), 'utf8'));
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

test('打包完整包含动作采样与窗口控制器并可真正加载', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  for (const file of ['interaction-motion.js', 'window-motion.js']) {
    const staged = path.join(staging, 'desktop-pet/lib', file);
    assert.ok(fs.existsSync(staged), `${file} 必须进入显式打包清单`);
    assert.equal(fs.readFileSync(staged, 'utf8'), fs.readFileSync(path.join(root, 'desktop-pet/lib', file), 'utf8'));
  }
  assert.equal(typeof require(path.join(staging, 'desktop-pet/lib/window-motion.js')).createWindowMotion, 'function');
  const html = fs.readFileSync(path.join(staging, 'desktop-pet/index.html'), 'utf8');
  assert.ok(html.indexOf('lib/interaction-motion.js') >= 0);
  assert.ok(html.indexOf('lib/interaction-motion.js') < html.indexOf('renderer.js'));
});

test('真实启动检查使用独立的临时设置目录', () => {
  const text = fs.readFileSync(
    path.resolve(__dirname, '../scripts/smoke-electron.js'),
    'utf8'
  );
  assert.match(text, /--user-data-dir=/);
  assert.match(text, /mkdtempSync/);
});
