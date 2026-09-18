const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { makeIcon } = require('./make-icon');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, adhocSign } = require('./package-mac');

// Local review build: separate app name, bundle id and default userData directory.
// Production source/version and the installed application remain untouched.
async function packageEdgePreview(root = path.resolve(__dirname, '../..')) {
  const name = '球球靠边体验版';
  const staging = prepareStaging(root);
  const packagePath = path.join(staging, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.name = 'emotion-ball-edge-preview';
  pkg.productName = name;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  const mainPath = path.join(staging, 'desktop-pet/main.js');
  const original = fs.readFileSync(mainPath, 'utf8');
  const declaration = "const APP_NAME = '球球桌宠';";
  if (original.split(declaration).length !== 2) throw new Error('Preview app name declaration changed');
  fs.writeFileSync(mainPath, original.replace(declaration, `const APP_NAME = '${name}';`));
  const localCache = path.join(root, 'desktop-pet/build/edge-electron-cache');
  const cache = fs.existsSync(path.join(localCache, 'electron-v43.4.1-darwin-arm64.zip'))
    ? localCache : findElectronZipDir();
  const output = await packager({
    ...buildPackagerOptions(root, makeIcon(root), cache), name,
    appBundleId: 'local.xiaokun.emotionball.edgepreview',
    out: path.join(root, 'desktop-pet/output/edge-preview')
  });
  if (!output.length) throw new Error('Preview package missing');
  const appPath = path.join(output[0], `${name}.app`);
  adhocSign(appPath);
  process.stdout.write(`${appPath}\n`);
  return appPath;
}
if (require.main === module) packageEdgePreview().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
});
module.exports = { packageEdgePreview };
