const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ICON_FILES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} 执行失败\n${result.stdout || ''}${result.stderr || ''}`.trim()
    );
  }
}

function makeIcon(root = path.resolve(__dirname, '../..')) {
  const source = path.join(root, 'emotion-ball/assets/img/favicon.png');
  const buildDir = path.join(root, 'desktop-pet/build');
  const iconset = path.join(buildDir, 'AppIcon.iconset');
  const output = path.join(buildDir, 'app.icns');

  if (!fs.existsSync(source)) throw new Error(`找不到球球图标: ${source}`);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  for (const [fileName, size] of ICON_FILES) {
    run('sips', [
      '-z',
      String(size),
      String(size),
      source,
      '--out',
      path.join(iconset, fileName)
    ]);
  }

  run('iconutil', ['-c', 'icns', iconset, '-o', output]);
  fs.rmSync(iconset, { recursive: true, force: true });
  return output;
}

if (require.main === module) {
  try {
    process.stdout.write(`${makeIcon()}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { makeIcon };
