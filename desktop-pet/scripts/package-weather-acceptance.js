const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const { prepareStaging, buildPackagerOptions, findElectronZipDir, signWeatherApp } = require('./package-mac');
const { buildWeatherLocation } = require('./build-weather-location');
const { makeIcon } = require('./make-icon');
function weatherAcceptanceOptions(root, icon, electronZipDir = findElectronZipDir()) {
  return { ...buildPackagerOptions(root, icon, electronZipDir),
    dir: path.join(root, 'desktop-pet/build/weather-acceptance-staging'),
    out: path.join(root, 'dist/weather-acceptance'), name: '球球桌宠-天气验收',
    appBundleId: 'local.xiaokun.emotionball.pet.weather-acceptance' };
}
async function packageWeather(root = path.resolve(__dirname, '../..')) {
  buildWeatherLocation(root);
  const options = weatherAcceptanceOptions(root, makeIcon(root));
  prepareStaging(root, options.dir, { weatherNative: true });
  const pkg = path.join(options.dir, 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), productName: options.name, qiuqiuAcceptance: 'weather' }, null, 2));
  const outputs = await packager(options);
  if (!outputs.length) throw new Error('未生成天气验收应用');
  const appPath = path.join(outputs[0], options.name + '.app');
  signWeatherApp(appPath);
  return appPath;
}
if (require.main === module) packageWeather().then(result => process.stdout.write(result + '\n')).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { packageWeather, weatherAcceptanceOptions };
