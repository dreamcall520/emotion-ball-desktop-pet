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

function prepareStaging(root, staging = path.join(root, 'desktop-pet/build/staging')) {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const files = [
    'desktop-pet/main.js',
    'desktop-pet/color-mode.css',
    'desktop-pet/ui-theme-blue.css',
    'desktop-pet/color-mode.js',
    'desktop-pet/lib/color-mode.js',
    'desktop-pet/preload.js',
    'desktop-pet/index.html',
    'desktop-pet/pet.css',
    'desktop-pet/aurora-click-visual.css',
    'desktop-pet/aurora-rive.css',
    'desktop-pet/renderer.js',
    'desktop-pet/customize.html',
    'desktop-pet/customize.css',
    'desktop-pet/customize-blue.css',
    'desktop-pet/codex-pets.css',
    'desktop-pet/lib/codex-pets.js',
    'desktop-pet/lib/codex-pet-player.js',
    'desktop-pet/customize-preload.js',
    'desktop-pet/customize-renderer.js',
    'desktop-pet/lib/customization.js',
    'desktop-pet/bubble.html',
    'desktop-pet/bubble.css',
    'desktop-pet/bubble-preload.js',
    'desktop-pet/bubble-renderer.js',
    'desktop-pet/chat.html',
    'desktop-pet/chat.css',
    'desktop-pet/chat-blue.css',
    'desktop-pet/chat-preload.js',
    'desktop-pet/chat-renderer.js',
    'desktop-pet/notes.html',
    'desktop-pet/notes.css',
    'desktop-pet/notes-blue.css',
    'desktop-pet/notes-preload.js',
    'desktop-pet/notes-renderer.js',
    'desktop-pet/lib/notes-model.js',
    'desktop-pet/lib/notes-store.js',
    'desktop-pet/lib/notes-companion.js',
    'desktop-pet/lib/notes-organizer.js',
    'desktop-pet/about.html',
    'desktop-pet/about.css',
    'desktop-pet/about-preload.js',
    'desktop-pet/about-renderer.js',
    'desktop-pet/api-usage.html',
    'desktop-pet/api-usage.css',
    'desktop-pet/api-usage-blue.css',
    'desktop-pet/api-usage-preload.js',
    'desktop-pet/api-usage-renderer.js',
    'desktop-pet/lib/api-usage.js',
    'desktop-pet/lib/app-update.js',
    'desktop-pet/lib/api-usage-label-window.js',
    'desktop-pet/api-usage-label.html',
    'desktop-pet/api-usage-label.css',
    'desktop-pet/api-usage-label-preload.js',
    'desktop-pet/api-usage-label-renderer.js',
    'desktop-pet/lib/chat-avatar.js',
    'desktop-pet/lib/chat-window.js',
    'desktop-pet/lib/chat-store.js',
    'desktop-pet/lib/chat-companion.js',
    'desktop-pet/lib/chat-models.js',
    'desktop-pet/lib/codex-chat-rpc.js',
    'desktop-pet/assets/tray-iconTemplate.png',
    'desktop-pet/assets/tray-iconTemplate@2x.png',
    'desktop-pet/assets/aurora-six-lobe-body.png',
    'desktop-pet/assets/aurora-six-lobe-icon.png',
    'desktop-pet/lib/settings.js',
    'desktop-pet/lib/window-bounce.js',
    'desktop-pet/lib/interaction-motion.js',
    'desktop-pet/lib/aurora-click-visual.js',
    'desktop-pet/lib/rive.js',
    'desktop-pet/lib/RIVE-LICENSE.txt',
    'desktop-pet/lib/boo-binary.js',
    'desktop-pet/lib/aurora-rive.js',
    'desktop-pet/lib/companion-motion.js',
    'desktop-pet/lib/pet-facing.js',
    'desktop-pet/lib/thought-window.js',
    'desktop-pet/lib/thought-flow.js',
    'desktop-pet/thought.html',
    'desktop-pet/thought.css',
    'desktop-pet/thought-preload.js',
    'desktop-pet/thought-renderer.js',
    'desktop-pet/lib/window-motion.js',
    'desktop-pet/lib/window-placement.js',
    'desktop-pet/lib/edge-tuck.js',
    'desktop-pet/lib/edge-notice.js',
    'desktop-pet/lib/edge-notice-window.js',
    'desktop-pet/edge-notice.html',
    'desktop-pet/edge-notice.css',
    'desktop-pet/edge-notice-preload.js',
    'desktop-pet/edge-notice-renderer.js',
    'desktop-pet/scripts/verify-edge-tuck.js',
    'desktop-pet/scripts/verify-edge-companion.js',
    'desktop-pet/lib/pet-behavior.js',
    'desktop-pet/lib/activity-monitor.js',
    'desktop-pet/lib/companion-behavior.js',
    'desktop-pet/lib/codex-state.js',
    'desktop-pet/lib/codex-rpc.js',
    'desktop-pet/lib/codex-usage-history.js',
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
    'desktop-pet/lib/pet-visual-bounds.js',
    'desktop-pet/lib/bubble-window.js',
    'desktop-pet/lib/quota-label-placement.js',
    'desktop-pet/lib/quota-label-window.js',
    'desktop-pet/quota-label.html',
    'desktop-pet/quota-label.css',
    'desktop-pet/quota-label-preload.js',
    'desktop-pet/quota-label-renderer.js',
    'desktop-pet/credit-balance.js',
    'desktop-pet/lib/codex-quota-history.js',
    'desktop-pet/lib/codex-details-window.js',
    'desktop-pet/codex-details.html',
    'desktop-pet/codex-details.css',
    'desktop-pet/codex-details-preload.js',
    'desktop-pet/codex-details-renderer.js',
    'desktop-pet/scripts/verify-codex-status-v20.js',
    'desktop-pet/scripts/verify-companion.js',
    'desktop-pet/scripts/verify-body-motion.js',
    'desktop-pet/scripts/verify-codex-companion.js',
    'desktop-pet/scripts/verify-chat-integration.js',
    'desktop-pet/scripts/verify-api-usage-integration.js',
    'desktop-pet/scripts/verify-aurora-six-lobe.js',
    'desktop-pet/scripts/verify-customize-unified.js',
    'desktop-pet/scripts/verify-ui-theme.js',
    'desktop-pet/scripts/verify-codex-pets.js',
    'emotion-ball/js/rings.js',
    'emotion-ball/js/custom-shapes.js',
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

async function packageMac(root = path.resolve(__dirname, '../..'), { website = false } = {}) {
  const icon = makeIcon(root);
  const staging = prepareStaging(root, website ? path.join(root, 'desktop-pet/build/website-staging') : undefined);
  const electronZipDir = findElectronZipDir();
  const options = buildPackagerOptions(root, icon, electronZipDir);
  options.dir = staging;
  if (website) options.out = path.join(root, 'dist/website');
  const paths = await packager(options);
  if (!paths.length) throw new Error('未生成 macOS 应用');
  const appPath = path.join(paths[0], '球球桌宠.app');
  if (!fs.existsSync(appPath)) throw new Error(`找不到打包后的应用: ${appPath}`);
  adhocSign(appPath);
  process.stdout.write(`${appPath}\n`);
  return appPath;
}

if (require.main === module) {
  packageMac(undefined, { website: process.argv.includes('--website') }).catch(error => {
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
