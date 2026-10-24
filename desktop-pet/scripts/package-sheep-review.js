const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { makeIcon } = require('./make-icon');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, adhocSign } = require('./package-mac');

const NAME = '球球桌宠-咩咩验收';
const PROFILE = '球球桌宠-咩咩集中验收-20261024';
const BUNDLE_ID = 'local.xiaokun.emotionball.sheepreview';
const DEFAULTS = {
  size: 'large', keepAwake: true, codexEnabled: false, bubblesEnabled: true, autoUpdateCheck: false,
  customization: { appearance: { shape: 'new-year-sheep', sheepTheme: 'auto' } },
  startupAppearance: { shape: 'new-year-sheep', sheepTheme: 'auto' }
};

function preparePreview(root, staging = path.join(root, 'desktop-pet/build/sheep-review')) {
  prepareStaging(root, staging);
  const packagePath = path.join(staging, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  Object.assign(pkg, { name: 'emotion-ball-sheep-review', productName: NAME, main: 'review-main.js' });
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(staging, 'review-main.js'), `const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = path.resolve(app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), ${JSON.stringify(PROFILE)}));
fs.mkdirSync(profile, { recursive: true });
app.setName(${JSON.stringify(NAME)});
app.setPath('userData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
// Preserve previous review settings; never copy or write the installed app's profile.
try {
  fs.writeFileSync(path.join(profile, 'settings.json'), ${JSON.stringify(JSON.stringify(DEFAULTS) + '\n')}, { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
require('./desktop-pet/main.js');
`);
  const mainPath = path.join(staging, 'desktop-pet/main.js');
  const main = fs.readFileSync(mainPath, 'utf8');
  const declaration = "const APP_NAME = '球球桌宠';";
  if (main.split(declaration).length !== 2) throw new Error('验收版应用名称入口已变化');
  fs.writeFileSync(mainPath, main.replace(declaration, `const APP_NAME = '${NAME}';`));
  return staging;
}

async function packagePreview(root = path.resolve(__dirname, '../..')) {
  const staging = preparePreview(root);
  const outputs = await packager({
    ...buildPackagerOptions(root, makeIcon(root), findElectronZipDir()),
    dir: staging, name: NAME, appBundleId: BUNDLE_ID,
    out: path.join(root, 'dist/sheep-review')
  });
  if (!outputs.length) throw new Error('未生成咩咩验收版');
  const appPath = path.join(outputs[0], `${NAME}.app`);
  adhocSign(appPath);
  process.stdout.write(appPath + '\n');
  return appPath;
}
if (require.main === module) packagePreview().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1;
});
module.exports = { NAME, PROFILE, BUNDLE_ID, DEFAULTS, preparePreview, packagePreview };
