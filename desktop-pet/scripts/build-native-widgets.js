'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function normalizeNativeWidgetOptions(options = {}) {
  const { bundleId, teamId, version, buildVersion, targetArch = 'arm64' } = options;
  if (typeof bundleId !== 'string' || !/^[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error('Invalid native widget bundle ID');
  if (typeof teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Invalid native widget team ID');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid native widget version');
  const build = String(buildVersion ?? '');
  if (!/^\d+(?:\.\d+){0,2}$/.test(build)) throw new Error('Invalid native widget build version');
  if (targetArch !== 'arm64') throw new Error('Native widgets currently require arm64');
  const appGroup = options.appGroup ?? `${teamId}.${bundleId}`;
  if (typeof appGroup !== 'string' || !appGroup.startsWith(`${teamId}.`) || !/^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]{1,200}$/.test(appGroup)) throw new Error('Invalid native widget app group');
  return { bundleId, teamId, version, buildVersion: build, targetArch, appGroup, widgetBundleId: `${bundleId}.widgets`, urlScheme: 'qiuqiu-widget' };
}
function xml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function plist(values) {
  const encode = value => typeof value === 'object' ? `<dict>${Object.entries(value).map(([k,v])=>`<key>${xml(k)}</key>${encode(v)}`).join('')}</dict>` : `<string>${xml(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${encode(values)}</plist>\n`;
}
function buildWidgetCenter(root, { targetArch = 'arm64' } = {}) {
  if (process.platform !== 'darwin') throw new Error('The widget refresh module must be built on macOS.');
  if (!path.isAbsolute(root)) throw new Error('Native widget root must be absolute');
  if (targetArch !== 'arm64') throw new Error('Native widgets currently require arm64');
  const source = path.join(root, 'desktop-pet', 'native-widgets');
  const outputDirectory = path.join(root, 'desktop-pet', 'build', 'native-widgets');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const include = [process.env.WIDGET_NODE_INCLUDE, process.env.CALENDAR_NODE_INCLUDE, process.env.WEATHER_NODE_INCLUDE,
    path.resolve(process.execPath, '../../include/node'), '/opt/homebrew/include/node', '/usr/local/include/node']
    .filter(Boolean).find(dir => fs.existsSync(path.join(dir, 'node_api.h')));
  if (!include) throw new Error('node_api.h is required. Set WIDGET_NODE_INCLUDE to the Node.js include/node directory.');
  const sdk = childProcess.execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  const object = path.join(outputDirectory, 'widget-center.' + process.pid + '.o');
  const output = path.join(outputDirectory, 'widget-center.node');
  const temporary = output + '.tmp-' + process.pid;
  try {
    childProcess.execFileSync('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks',
      '-target', 'arm64-apple-macosx14.0', '-isysroot', sdk, '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=widget_center',
      '-I', include, '-c', path.join(source, 'widget-center.mm'), '-o', object], { stdio: 'inherit' });
    childProcess.execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macosx14.0', '-emit-library',
      path.join(source, 'WidgetCenter.swift'), object, '-lc++', '-Xlinker', '-undefined', '-Xlinker', 'dynamic_lookup',
      '-Xlinker', '-install_name', '-Xlinker', '@rpath/widget-center.node', '-o', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, output);
  } finally {
    for (const file of [object, temporary]) { try { fs.unlinkSync(file); } catch {} }
  }
  return output;
}
function buildNativeWidgets(root, options) {
  const config = normalizeNativeWidgetOptions(options);
  if (!path.isAbsolute(root)) throw new Error('Native widget root must be absolute');
  const source = path.join(root, 'desktop-pet', 'native-widgets');
  const outputDirectory = path.join(root, 'desktop-pet', 'build', 'native-widgets');
  const extensionPath = path.join(outputDirectory, 'QiuqiuWidgets.appex');
  const executableDirectory = path.join(extensionPath, 'Contents', 'MacOS');
  fs.mkdirSync(executableDirectory, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, 'Contents', 'Info.plist'), plist({
    CFBundleDevelopmentRegion: 'zh_CN', CFBundleDisplayName: '球球', CFBundleName: 'QiuqiuWidgets',
    CFBundleIdentifier: config.widgetBundleId, CFBundleExecutable: 'QiuqiuWidgets', CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: config.version, CFBundleVersion: config.buildVersion,
    LSMinimumSystemVersion: '14.0', QiuqiuWidgetAppGroup: config.appGroup,
    QiuqiuWidgetURLScheme: config.urlScheme,
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
  }));
  const shared = ['Shared.swift', 'TodoModel.swift', 'WeatherModel.swift'];
  const widget = ['AccentModel.swift', 'MonthWidget.swift', 'TodoWidgets.swift', 'AccentWidgets.swift', 'WeatherWeekWidget.swift', 'DualClockWidget.swift', 'BrandedCalendarWidgets.swift'];
  const run = args => childProcess.execFileSync('xcrun', args, { cwd: source, stdio: 'inherit' });
  const flags = ['swiftc', '-parse-as-library', '-O', '-target', 'arm64-apple-macosx14.0'];
  run([...flags, '-application-extension', '-Xlinker', '-e', '-Xlinker', '_NSExtensionMain', ...shared, ...widget, '-o', path.join(executableDirectory, 'QiuqiuWidgets')]);
  const helperPath = path.join(outputDirectory, 'QiuqiuWidgetBridge');
  run([...flags, ...shared, 'WidgetBridgeSync.swift', 'WidgetBridgeMain.swift', '-o', helperPath]);
  const helperConfigPath = path.join(outputDirectory, 'QiuqiuWidgetBridge.json');
  fs.writeFileSync(helperConfigPath, JSON.stringify({ schema: 1, appGroup: config.appGroup, urlScheme: config.urlScheme, containingBundleId: config.bundleId, widgetBundleId: config.widgetBundleId }, null, 2) + '\n');
  const widgetCenterPath = buildWidgetCenter(root, config);
  return { extensionPath, helperPath, helperConfigPath, widgetCenterPath, widgetBundleId: config.widgetBundleId, appGroup: config.appGroup, urlScheme: config.urlScheme };
}
module.exports = { buildNativeWidgets, buildWidgetCenter, normalizeNativeWidgetOptions };
if (require.main === module) {
  try {
    const [root, options] = process.argv.slice(2);
    console.log(JSON.stringify(buildNativeWidgets(path.resolve(root || path.join(__dirname, '..', '..')), JSON.parse(options || '{}')), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
