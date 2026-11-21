'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateMasDevelopmentTools, COMPILER, SDK, TOOLS } = require('../scripts/mas-development-tools');
function fixture() {
  const files = new Set([COMPILER, ...TOOLS]), directories = new Set(), commands = [], accesses = [];
  for (const sdk of [SDK, '/active/MacOSX.sdk']) {
    directories.add(sdk); files.add(path.join(sdk, 'SDKSettings.plist'));
    for (const name of ['Foundation', 'CoreLocation', 'AppKit', 'Security']) directories.add(path.join(sdk, 'System/Library/Frameworks', name + '.framework'));
  }
  const options = { io: { statSync(file) { if (!files.has(file) && !directories.has(file)) throw Error('missing'); return { isFile: () => files.has(file), isDirectory: () => directories.has(file) }; },
    accessSync(file) { accesses.push(file); if (!files.has(file)) throw Error('missing executable'); } },
    run(name, args) { commands.push([name, args]); return name === COMPILER ? 'Apple clang version 21.0.0' : '/active/MacOSX.sdk\n'; } };
  return { options, files, directories, commands, accesses };
}
test('真实CLT编译器、SDK框架和签名工具齐全时通过，不运行xcodebuild或签名', () => {
  const f = fixture(), result = validateMasDevelopmentTools(f.options);
  assert.equal(result.fullXcodeRequired, false); assert.equal(result.compilerVerified, true);
  assert.deepEqual(f.commands, [[COMPILER, ['--version']], ['/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']]]);
  assert.deepEqual(f.accesses, [COMPILER, ...TOOLS]);
});
test('缺少任一真实工具或执行权限时拒绝，不按Xcode版本字符串放行', () => {
  for (const file of [COMPILER, ...TOOLS]) {
    const f = fixture(); f.files.delete(file);
    assert.throws(() => validateMasDevelopmentTools(f.options), { code: 'MAS_DEV_BUILD_TOOLS_UNAVAILABLE' });
  }
  const denied = fixture(); denied.options.io.accessSync = () => { throw Error('not executable'); };
  assert.throws(() => validateMasDevelopmentTools(denied.options), { code: 'MAS_DEV_BUILD_TOOLS_UNAVAILABLE' });
});
test('运行编译器失败、无法解析真实SDK或缺少所需framework均拒绝', () => {
  for (const change of [
    f => { f.options.run = () => { throw Error('tool failed'); }; },
    f => { f.options.run = name => name === COMPILER ? 'not a compiler' : SDK; },
    f => { f.options.run = name => name === COMPILER ? 'Apple clang version 21' : 'relative/sdk'; },
    f => { f.files.delete(path.join(SDK, 'SDKSettings.plist')); },
    f => { f.directories.delete(path.join(SDK, 'System/Library/Frameworks/CoreLocation.framework')); }
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => validateMasDevelopmentTools(f.options), { code: 'MAS_DEV_BUILD_TOOLS_UNAVAILABLE' });
  }
});
