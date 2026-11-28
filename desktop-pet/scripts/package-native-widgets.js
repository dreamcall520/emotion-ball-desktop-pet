'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plist = require('plist');

async function prepareNativeWidgets(root, pkg, config, build) {
  if (pkg.qiuqiuNativeWidgets !== true) return null;
  return (build || require('./build-native-widgets').buildNativeWidgets)(root, {
    bundleId: config.bundleId, teamId: config.teamId, version: config.version || config.marketingVersion,
    buildVersion: config.buildVersion, targetArch: config.arch
  });
}

function stageWidgetModule(staging, artifacts, io = fs) {
  if (!artifacts) return;
  const destination = path.join(staging, 'desktop-pet/native/widget-center.node');
  io.mkdirSync(path.dirname(destination), { recursive: true });
  io.copyFileSync(artifacts.widgetCenterPath, destination);
}

function embedNativeWidgets(appPath, artifacts, signingDirectory, io = fs) {
  if (!artifacts) return null;
  const extensionPath = path.join(appPath, 'Contents/PlugIns/QiuqiuCalendarWidgets.appex');
  const helperPath = path.join(appPath, 'Contents/Helpers/QiuqiuWidgetBridge');
  const configPath = helperPath + '.json';
  io.mkdirSync(path.dirname(extensionPath), { recursive: true });
  io.mkdirSync(path.dirname(helperPath), { recursive: true });
  io.cpSync(artifacts.extensionPath, extensionPath, { recursive: true, dereference: false });
  io.copyFileSync(artifacts.helperPath, helperPath);
  io.copyFileSync(artifacts.helperConfigPath, configPath);
  io.chmodSync(helperPath, 0o755);
  const infoFile = path.join(appPath, 'Contents/Info.plist');
  const info = plist.parse(io.readFileSync(infoFile, 'utf8'));
  const types = Array.isArray(info.CFBundleURLTypes) ? info.CFBundleURLTypes : [];
  info.CFBundleURLTypes = [...types.filter(type => !type.CFBundleURLSchemes?.includes(artifacts.urlScheme)), {
    CFBundleURLName: '球球系统小组件', CFBundleURLSchemes: [artifacts.urlScheme]
  }];
  io.writeFileSync(infoFile, plist.build(info));
  const entitlements = { 'com.apple.security.app-sandbox': true,
    'com.apple.security.application-groups': [artifacts.appGroup] };
  const entitlementsFile = path.join(signingDirectory, 'widget.entitlements.plist');
  io.writeFileSync(entitlementsFile, plist.build(entitlements));
  return { extensionPath, helperPath, configPath, entitlementsFile, entitlements,
    widgetBundleId: artifacts.widgetBundleId, appGroup: artifacts.appGroup, urlScheme: artifacts.urlScheme };
}

function entitlementFileFor(file, appPath, mainFile, childFile, embedded) {
  if (file === appPath) return mainFile;
  if (embedded && (file === embedded.extensionPath || file.startsWith(embedded.extensionPath + path.sep))) {
    return embedded.entitlementsFile;
  }
  return childFile;
}

function verifyNativeWidgets(embedded, run, childEntitlements, parse = plist.parse) {
  if (!embedded) return null;
  for (const [target, expected] of [[embedded.extensionPath, embedded.entitlements], [embedded.helperPath, childEntitlements]]) {
    run('codesign', ['--verify', '--strict', target]);
    const actual = parse(run('codesign', ['--display', '--entitlements', ':-', target]));
    if (!actual || Object.keys(actual).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value))) {
      throw Object.assign(new Error('Native widget signature entitlements do not match'), { code: 'MAS_WIDGET_ENTITLEMENTS_UNVERIFIED' });
    }
  }
  return { embedded: true, widgetBundleId: embedded.widgetBundleId, appGroup: embedded.appGroup,
    extensionEntitlementsValidated: true, helperEntitlementsValidated: true, runtimeValidated: false };
}

module.exports = { prepareNativeWidgets, stageWidgetModule, embedNativeWidgets, entitlementFileFor, verifyNativeWidgets };
