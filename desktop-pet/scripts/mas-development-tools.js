'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// These paths match build-weather-location.js and build-plugin-host.js. Full
// Xcode is not used to compile either N-API bridge or to sign the Electron App.
const COMPILER = '/Library/Developer/CommandLineTools/usr/bin/clang++';
const SDK = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
const TOOLS = ['/usr/bin/xcrun', '/usr/bin/iconutil', '/usr/bin/codesign', '/usr/bin/security', '/usr/sbin/system_profiler'];
const fail = () => Object.assign(new Error('Required macOS development tools or SDK are unavailable.'), { code: 'MAS_DEV_BUILD_TOOLS_UNAVAILABLE' });
function validateMasDevelopmentTools({ run = (name, args) => execFileSync(name, args, { encoding: 'utf8', timeout: 15000 }), io = fs } = {}) {
  try {
    for (const file of [COMPILER, ...TOOLS]) {
      if (!io.statSync(file).isFile()) throw fail();
      io.accessSync(file, fs.constants.X_OK);
    }
    if (!/clang version\s+\d/i.test(run(COMPILER, ['--version']))) throw fail();
    // xcrun must resolve a real SDK under the active developer selection. The
    // native builders themselves use the fixed CLT SDK validated separately.
    const resolved = run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).trim();
    if (!path.isAbsolute(resolved) || /[\r\n\0]/.test(resolved)) throw fail();
    for (const sdk of new Set([SDK, resolved])) {
      if (!io.statSync(sdk).isDirectory() || !io.statSync(path.join(sdk, 'SDKSettings.plist')).isFile()) throw fail();
      for (const framework of ['Foundation', 'CoreLocation', 'AppKit', 'Security']) {
        if (!io.statSync(path.join(sdk, 'System/Library/Frameworks', framework + '.framework')).isDirectory()) throw fail();
      }
    }
    return { compilerVerified: true, sdkVerified: true, signingToolsPresent: true, fullXcodeRequired: false };
  } catch { throw fail(); }
}
module.exports = { validateMasDevelopmentTools, COMPILER, SDK, TOOLS };
