'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function buildCalendarEvents(root = path.resolve(__dirname, '../..'), { targetArch = process.arch } = {}) {
  if (process.platform !== 'darwin') throw new Error('The calendar bridge must be built on macOS.');
  const arch = targetArch === 'arm64' ? 'arm64' : targetArch === 'x64' ? 'x86_64' : null;
  if (!arch) throw new Error('The calendar bridge supports only arm64 and x64.');
  const source = path.join(root, 'desktop-pet/native/calendar-events.mm');
  const output = path.join(root, 'desktop-pet/native/calendar-events.node');
  const include = [process.env.CALENDAR_NODE_INCLUDE, process.env.WEATHER_NODE_INCLUDE, path.resolve(process.execPath, '../../include/node'), '/opt/homebrew/include/node', '/usr/local/include/node'].filter(Boolean).find(dir => fs.existsSync(path.join(dir, 'node_api.h')));
  if (!include) throw new Error('node_api.h is required. Set CALENDAR_NODE_INCLUDE to the Node.js include/node directory.');
  const sdk = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  const temporary = output + '.tmp-' + process.pid;
  try {
    execFileSync('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-mmacosx-version-min=12.0', '-arch', arch,
      '-isysroot', sdk, '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=calendar_events',
      '-I', include, '-framework', 'Foundation', '-framework', 'EventKit', '-framework', 'CoreGraphics', source, '-o', temporary], { stdio: 'inherit' });
    fs.renameSync(temporary, output);
  } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
  return output;
}
if (require.main === module) {
  try { process.stdout.write(buildCalendarEvents() + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { buildCalendarEvents };
