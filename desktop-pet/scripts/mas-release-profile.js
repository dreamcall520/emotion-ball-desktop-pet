'use strict';
const fs = require('node:fs');
const path = require('node:path');
const FIRST_RELEASE = 'mas-first';
const isFirstRelease = config => config?.releaseProfile === FIRST_RELEASE;
const resourceNames = config => isFirstRelease(config) ? ['qiuqiu-codex'] : ['qiuqiu-codex', 'qiuqiu-workbuddy'];
// Build-time filtering only. Runtime modules still statically imported by main
// remain until their call sites are removed; first-release startup disables them.
function trimStaging(staging, config, io = fs) {
  if (!isFirstRelease(config)) return [];
  const removed = [
    'desktop-pet/assets/workbuddy-desktop-hook',
    'desktop-pet/assets/zcode-desktop-hook',
    'desktop-pet/lib/mas-plugin-install-probe.js',
    'desktop-pet/lib/mas-helper-probe.js'
  ];
  for (const name of removed) io.rmSync(path.join(staging, name), { recursive: true, force: true });
  return removed;
}
module.exports = { FIRST_RELEASE, isFirstRelease, resourceNames, trimStaging };
