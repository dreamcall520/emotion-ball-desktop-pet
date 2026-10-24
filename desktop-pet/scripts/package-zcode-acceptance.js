const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, adhocSign } = require('./package-mac');
const { makeIcon } = require('./make-icon');

function acceptanceOptions(root, icon) {
  return { ...buildPackagerOptions(root, icon, findElectronZipDir()),
    dir: path.join(root, 'desktop-pet/build/zcode-acceptance-staging'),
    out: path.join(root, 'dist/zcode-acceptance'), name: '球球桌宠-ZCode验收',
    appBundleId: 'local.xiaokun.emotionball.pet.zcode-acceptance' };
}

async function packageAcceptance(root = path.resolve(__dirname, '../..')) {
  const options = acceptanceOptions(root, makeIcon(root));
  prepareStaging(root, options.dir);
  const file = path.join(options.dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...pkg, productName: options.name, qiuqiuAcceptance: 'zcode' }, null, 2));
  const outputs = await packager(options);
  const appPath = path.join(outputs[0], `${options.name}.app`);
  adhocSign(appPath);
  return appPath;
}

if (require.main === module) packageAcceptance().then(appPath => process.stdout.write(`${appPath}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { acceptanceOptions, packageAcceptance };
