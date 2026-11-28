'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');
const mac = require('./package-mac');
const release = require('./mas-release-profile');
const { buildWeatherLocation } = require('./build-weather-location');
const { buildCalendarEvents } = require('./build-calendar-events');
const { buildPluginHost } = require('./build-plugin-host');
const { makeIcon } = require('./make-icon');

const NAME = '球球桌宠-日历开发候选';
const BUNDLE_ID = 'local.xiaokun.emotionball.pet.calendar.v7';

function calendarCandidateOptions(root, icon, electronZipDir = mac.findElectronZipDir()) {
  return {
    ...mac.buildPackagerOptions(root, icon, electronZipDir),
    dir: path.join(root, 'desktop-pet/build/calendar-candidate-staging'),
    out: path.join(root, 'dist/calendar-candidate'),
    name: NAME,
    appBundleId: BUNDLE_ID
  };
}

async function packageCalendar(root = path.resolve(__dirname, '../..')) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('日历开发候选需要在 Apple 芯片 Mac 上构建。');
  const original = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (original.qiuqiuReleaseProfile !== release.FIRST_RELEASE) throw new Error('日历开发候选必须基于 mas-first 商店版本构建。');
  buildWeatherLocation(root);
  buildCalendarEvents(root, { targetArch: 'arm64' });
  buildPluginHost(root);
  const options = calendarCandidateOptions(root, makeIcon(root));
  mac.prepareStaging(root, options.dir, { pluginNative: true });
  const config = { releaseProfile: original.qiuqiuReleaseProfile };
  release.trimStaging(options.dir, config);
  const packageFile = path.join(options.dir, 'package.json');
  const staged = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  fs.writeFileSync(packageFile, JSON.stringify({ ...staged, productName: NAME, version: original.version,
    qiuqiuAcceptance: 'calendar', qiuqiuDistribution: 'mas-candidate', qiuqiuReleaseProfile: original.qiuqiuReleaseProfile }, null, 2) + '\n');
  const outputs = await packager(options);
  if (!Array.isArray(outputs) || outputs.length !== 1) throw new Error('未生成唯一的日历开发候选应用。');
  const appPath = path.join(outputs[0], NAME + '.app');
  if (!fs.existsSync(appPath)) throw new Error('找不到打包后的日历开发候选应用。');
  release.assertNoBundledProviders(appPath, config);
  const pluginPath = path.join(appPath, 'Contents/Resources/app.asar.unpacked/desktop-pet/native/plugin-host.node');
  if (!fs.existsSync(pluginPath)) throw new Error('插件桥组件未解包。');
  mac.adhocSign(pluginPath);
  mac.signWeatherApp(appPath);
  return appPath;
}

if (require.main === module) packageCalendar().then(result => process.stdout.write(result + '\n')).catch(error => {
  process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1;
});

module.exports = { packageCalendar, calendarCandidateOptions, NAME, BUNDLE_ID };
