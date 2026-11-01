const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, signWeatherApp } = require('./package-mac');
const { buildWeatherLocation } = require('./build-weather-location');
const { makeIcon } = require('./make-icon');

function feedbackAcceptanceOptions(root, icon, electronZipDir = findElectronZipDir()) {
  return { ...buildPackagerOptions(root, icon, electronZipDir),
    dir: path.join(root, 'desktop-pet/build/feedback-acceptance-staging'),
    out: path.join(root, 'dist/feedback-acceptance'), name: '球球桌宠-反馈验收',
    appBundleId: 'local.xiaokun.emotionball.pet.feedback-acceptance' };
}
async function packageFeedback(root = path.resolve(__dirname, '../..')) {
  buildWeatherLocation(root);
  const options = feedbackAcceptanceOptions(root, makeIcon(root));
  prepareStaging(root, options.dir, { weatherNative: true });
  const file = path.join(options.dir, 'package.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), productName: options.name, qiuqiuAcceptance: 'feedback' }, null, 2));
  const outputs = await packager(options);
  if (!outputs.length) throw new Error('未生成反馈验收应用');
  const appPath = path.join(outputs[0], `${options.name}.app`);
  signWeatherApp(appPath);
  return appPath;
}
if (require.main === module) packageFeedback().then(result => process.stdout.write(result + '\n'))
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { packageFeedback, feedbackAcceptanceOptions };
