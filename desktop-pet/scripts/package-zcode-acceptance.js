const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, adhocSign, signWeatherApp } = require('./package-mac');
const { makeIcon } = require('./make-icon');

function acceptanceOptions(root, icon, kind = 'zcode') {
  const key = ['combined', 'bubble'].includes(kind) ? kind : 'zcode';
  const name = key === 'bubble' ? '球球桌宠-气泡验收' : key === 'combined' ? '球球桌宠-联动整合验收' : '球球桌宠-ZCode验收';
  return { ...buildPackagerOptions(root, icon, findElectronZipDir()),
    dir: path.join(root, `desktop-pet/build/${key}-acceptance-staging`),
    out: path.join(root, `dist/${key}-acceptance`), name,
    appBundleId: `local.xiaokun.emotionball.pet.${key}-acceptance` };
}

async function packageAcceptance(root = path.resolve(__dirname, '../..'), kind = 'zcode') {
  const options = acceptanceOptions(root, makeIcon(root), kind);
  prepareStaging(root, options.dir);
  const file = path.join(options.dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...pkg, productName: options.name, qiuqiuAcceptance: kind }, null, 2));
  const outputs = await packager(options);
  const appPath = path.join(outputs[0], `${options.name}.app`);
  if (kind === 'bubble') signWeatherApp(appPath);
  else adhocSign(appPath);
  return appPath;
}

if (require.main === module) packageAcceptance().then(appPath => process.stdout.write(`${appPath}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { acceptanceOptions, packageAcceptance };
