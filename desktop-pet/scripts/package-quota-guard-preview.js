const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { makeIcon } = require('./make-icon');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, adhocSign } = require('./package-mac');

const NAME = '球球额度守护候选';
const PROFILE = 'qiuqiu-quota-guard-preview';
function preparePreview(root, staging = path.join(root, 'desktop-pet/build/quota-guard-preview')) {
  prepareStaging(root, staging);
  const pkgPath = path.join(staging, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  Object.assign(pkg, { name: 'emotion-ball-quota-guard-preview', productName: NAME, main: 'preview-main.js' });
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  // The ordinary app icon and all renderer helpers must also use the isolated profile.
  fs.writeFileSync(path.join(staging, 'preview-main.js'), `const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const smoke = process.env.PET_SMOKE_TEST === '1';
const profile = smoke ? app.commandLine.getSwitchValue('user-data-dir') : path.join(app.getPath('appData'), '${PROFILE}');
if (!profile) throw new Error('候选验收缺少隔离目录');
fs.mkdirSync(profile, { recursive: true });
app.setName('${NAME}');
app.setPath('userData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
require('./desktop-pet/main.js');
`);
  const mainPath = path.join(staging, 'desktop-pet/main.js');
  const main = fs.readFileSync(mainPath, 'utf8');
  const declaration = "const APP_NAME = '球球桌宠';";
  if (main.split(declaration).length !== 2) throw new Error('候选应用名称入口已变化');
  fs.writeFileSync(mainPath, main.replace(declaration, `const APP_NAME = '${NAME}';`));
  return staging;
}

async function packagePreview(root = path.resolve(__dirname, '../..')) {
  const staging = preparePreview(root);
  const outputs = await packager({
    ...buildPackagerOptions(root, makeIcon(root), findElectronZipDir()),
    dir: staging, name: NAME, appBundleId: 'local.xiaokun.emotionball.quotaguardpreview',
    out: path.join(root, 'dist/quota-guard-preview')
  });
  if (!outputs.length) throw new Error('未生成额度守护候选包');
  const appPath = path.join(outputs[0], `${NAME}.app`);
  adhocSign(appPath);
  process.stdout.write(appPath + '\n');
  return appPath;
}
if (require.main === module) packagePreview().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1;
});
module.exports = { NAME, PROFILE, preparePreview, packagePreview };
