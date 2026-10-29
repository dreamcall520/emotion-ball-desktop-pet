'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function buildWeatherLocation(root = path.resolve(__dirname, '../..')) {
  if (process.platform !== 'darwin') throw new Error('The weather location bridge must be built on macOS.');
  const source = path.join(root, 'desktop-pet/native/weather-location.mm');
  const output = path.join(root, 'desktop-pet/native/weather-location.node');
  const include = [process.env.WEATHER_NODE_INCLUDE, path.resolve(process.execPath, '../../include/node'),
    '/opt/homebrew/include/node', '/usr/local/include/node'].filter(Boolean).find(dir => fs.existsSync(path.join(dir, 'node_api.h')));
  if (!include) throw new Error('node_api.h is required. Set WEATHER_NODE_INCLUDE to the Node.js include/node directory.');
  const compiler = '/Library/Developer/CommandLineTools/usr/bin/clang++';
  const temporary = output + '.tmp';
  try {
    execFileSync(compiler, ['-std=c++17', '-fobjc-arc', '-fblocks', '-mmacosx-version-min=11.0', '-arch', process.arch,
      '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=weather_location',
      '-I', include, '-framework', 'Foundation', '-framework', 'CoreLocation', source, '-o', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, output);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return output;
}
if (require.main === module) {
  try { process.stdout.write(buildWeatherLocation() + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { buildWeatherLocation };
