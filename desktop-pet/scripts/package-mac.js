const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.ELECTRON_GET_USE_PROXY ||= '1';
const { packager } = require('@electron/packager');
const { makeIcon } = require('./make-icon');

const ELECTRON_ZIP = 'electron-v43.4.1-darwin-arm64.zip';

function copyFile(root, staging, relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(staging, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function prepareStaging(root) {
  const staging = path.join(root, 'desktop-pet/build/staging');
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const files = [
    'desktop-pet/main.js',
    'desktop-pet/preload.js',
    'desktop-pet/index.html',
    'desktop-pet/pet.css',
    'desktop-pet/renderer.js',
    'desktop-pet/bubble.html',
    'desktop-pet/bubble.css',
    'desktop-pet/bubble-preload.js',
    'desktop-pet/bubble-renderer.js',
    'desktop-pet/assets/tray-iconTemplate.png',
    'desktop-pet/assets/tray-iconTemplate@2x.png',
    'desktop-pet/lib/settings.js',
    'desktop-pet/lib/window-bounce.js',
    'desktop-pet/lib/interaction-motion.js',
    'desktop-pet/lib/window-motion.js',
    'desktop-pet/lib/window-placement.js',
    'desktop-pet/lib/pet-behavior.js',
    'desktop-pet/lib/activity-monitor.js',
    'desktop-pet/lib/companion-behavior.js',
    'desktop-pet/lib/codex-state.js',
    'desktop-pet/lib/codex-rpc.js',
    'desktop-pet/lib/codex-frame.js',
    'desktop-pet/lib/codex-stream.js',
    'desktop-pet/lib/codex-connection.js',
    'desktop-pet/lib/codex-companion.js',
    'desktop-pet/lib/codex-quota-view.js',
    'desktop-pet/lib/codex-quota-alerts.js',
    'desktop-pet/lib/codex-menu.js',
    'desktop-pet/lib/codex-text.js',
    'desktop-pet/lib/dialogue.js',
    'desktop-pet/lib/bubble-placement.js',
    'desktop-pet/lib/bubble-window.js',
    'desktop-pet/lib/quota-label-placement.js',
    'desktop-pet/lib/quota-label-window.js',
    'desktop-pet/quota-label.html',
    'desktop-pet/quota-label.css',
    'desktop-pet/quota-label-preload.js',
    'desktop-pet/quota-label-renderer.js',
    'desktop-pet/scripts/verify-companion.js',
    'desktop-pet/scripts/verify-body-motion.js',
    'desktop-pet/scripts/verify-codex-companion.js',
    'emotion-ball/js/rings.js',
    'emotion-ball/js/emotions.js',
    'emotion-ball/js/ball.js',
    'emotion-ball/js/engine.js',
    'emotion-ball/assets/img/favicon.png',
    'LICENSE',
    'NOTICE.md'
  ];
  files.forEach(relativePath => copyFile(root, staging, relativePath));

  const packageJson = {
    name: 'emotion-ball-desktop-pet',
    productName: '球球桌宠',
    version: rootPackage.version,
    private: true,
    main: 'desktop-pet/main.js'
  };
  fs.writeFileSync(
    path.join(staging, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8'
  );
  return staging;
}

function findElectronZipDir(
  cacheRoot = path.join(os.homedir(), 'Library/Caches/electron')
) {
  if (!fs.existsSync(cacheRoot)) return null;
  if (fs.existsSync(path.join(cacheRoot, ELECTRON_ZIP))) return cacheRoot;

  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name);
    if (fs.existsSync(path.join(candidate, ELECTRON_ZIP))) return candidate;
  }
  return null;
}

function buildPackagerOptions(root, icon, electronZipDir = null) {
  const options = {
    dir: path.join(root, 'desktop-pet/build/staging'),
    out: path.join(root, 'dist'),
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: '43.4.1',
    name: '球球桌宠',
    appBundleId: 'local.xiaokun.emotionball.pet',
    appCategoryType: 'public.app-category.entertainment',
    icon,
    asar: true,
    overwrite: true,
    prune: true,
    quiet: true
  };
  if (electronZipDir) options.electronZipDir = electronZipDir;
  return options;
}

function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} 执行失败\n${result.stdout || ''}${result.stderr || ''}`.trim()
    );
  }
}

function adhocSign(appPath) {
  runTool('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath
  ]);
  runTool('codesign', ['--verify', '--deep', '--strict', appPath]);
}

async function packageMac(root = path.resolve(__dirname, '../..')) {
  const icon = makeIcon(root);
  prepareStaging(root);
  const electronZipDir = findElectronZipDir();
  const paths = await packager(
    buildPackagerOptions(root, icon, electronZipDir)
  );
  if (!paths.length) throw new Error('未生成 macOS 应用');
  const appPath = path.join(paths[0], '球球桌宠.app');
  if (!fs.existsSync(appPath)) throw new Error(`找不到打包后的应用: ${appPath}`);
  adhocSign(appPath);
  process.stdout.write(`${appPath}\n`);
  return appPath;
}

if (require.main === module) {
  packageMac().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPackagerOptions,
  adhocSign,
  findElectronZipDir,
  prepareStaging,
  packageMac
};
