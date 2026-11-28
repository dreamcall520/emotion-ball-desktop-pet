'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNativeWidgetOptions } = require('../../scripts/build-native-widgets');
const options = { bundleId:'local.example.qiuqiu',teamId:'SUUX53KQQV',version:'1.0.4',buildVersion:1795434099 };
test('inherits containing app identity and version',()=>assert.deepEqual(normalizeNativeWidgetOptions(options), {...options,buildVersion:'1795434099',targetArch:'arm64',appGroup:'SUUX53KQQV.local.example.qiuqiu',widgetBundleId:'local.example.qiuqiu.widgets',urlScheme:'qiuqiu-widget'}));
for (const [key,value] of [['bundleId','../bad'],['teamId','bad'],['version','1.0'],['buildVersion','1;rm'],['targetArch','x64'],['appGroup','OTHERTEAM0.other']]) test(`reject invalid ${key}`,()=>assert.throws(()=>normalizeNativeWidgetOptions({...options,[key]:value})));
