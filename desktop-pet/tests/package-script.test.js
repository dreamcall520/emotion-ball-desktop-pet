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
    'desktop-pet/lib/codex-state.js',
    'desktop-pet/lib/codex-rpc.js',
    'desktop-pet/lib/codex-frame.js',
    'desktop-pet/lib/codex-stream.js',
    'desktop-pet/lib/codex-connection.js',
    'desktop-pet/lib/codex-companion.js',
    'desktop-pet/lib/codex-menu.js',
    'desktop-pet/bubble.html',
    'desktop-pet/bubble.css',
    'desktop-pet/bubble-renderer.js',
    'desktop-pet/bubble-preload.js'
  ]) {
    assert.equal(fs.readFileSync(path.join(staging, relativePath), 'utf8'),
      fs.readFileSync(path.join(root, relativePath), 'utf8'));
  }
  const controller = require(path.join(staging, 'desktop-pet/lib/codex-companion.js')).createCodexCompanion({
    createConnection: () => assert.fail('仅加载关闭态不能连接 Codex')
  });
  assert.equal(controller.getSnapshot().enabled, false);
  assert.deepEqual(require(path.join(staging, 'desktop-pet/lib/codex-menu.js')).buildCodexMenu(controller.getSnapshot()), []);
  controller.close();
});

test('打包暂存区包含任务名称清理模块且菜单与控制器可加载', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  const relative = 'desktop-pet/lib/codex-text.js';
  assert.deepEqual(
    fs.readFileSync(path.join(staging, relative)),
    fs.readFileSync(path.join(root, relative))
  );
  assert.equal(
    typeof require(path.join(staging, 'desktop-pet/lib/codex-companion.js')).createCodexCompanion,
    'function'
  );
  assert.equal(
    typeof require(path.join(staging, 'desktop-pet/lib/codex-menu.js')).buildCodexMenu,
    'function'
  );
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

test('真实动作验收助手进入显式打包清单且可以加载', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  const relative = 'desktop-pet/scripts/verify-body-motion.js';
  const staged = path.join(staging, relative);
  assert.ok(fs.existsSync(staged), '安装包缺少真实身体动作验收助手');
  assert.equal(fs.readFileSync(staged, 'utf8'), fs.readFileSync(path.join(root, relative), 'utf8'));
  assert.equal(typeof require(staged).verifyBodyMotion, 'function');
  const codexHelper = 'desktop-pet/scripts/verify-codex-companion.js';
  assert.ok(fs.existsSync(path.join(staging, codexHelper)), '安装包缺少显式模拟 Codex 原生验收助手');
  assert.equal(fs.readFileSync(path.join(staging, codexHelper), 'utf8'), fs.readFileSync(path.join(root, codexHelper), 'utf8'));
  assert.equal(typeof require(path.join(staging, codexHelper)).verifyCodexCompanion, 'function');
});
