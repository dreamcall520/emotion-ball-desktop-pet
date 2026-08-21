const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopPetRoot = path.resolve(__dirname, '..');

function readPngHeader(file) {
  const data = fs.readFileSync(file);
  assert.deepEqual(
    data.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25]
  };
}

function readDpi(file) {
  const output = execFileSync('/usr/bin/sips', ['-g', 'dpiWidth', '-g', 'dpiHeight', file], {
    encoding: 'utf8'
  });
  return {
    width: Number(output.match(/dpiWidth: ([\d.]+)/)?.[1]),
    height: Number(output.match(/dpiHeight: ([\d.]+)/)?.[1])
  };
}

test('菜单栏使用独立的 macOS Template Image', () => {
  const main = fs.readFileSync(path.join(desktopPetRoot, 'main.js'), 'utf8');
  const createTray = main.match(/function createTray\(\)[\s\S]*?\n}/)?.[0] || '';

  assert.match(createTray, /tray-iconTemplate\.png/);
  assert.doesNotMatch(createTray, /favicon\.png/);
  assert.match(createTray, /setTemplateImage\(true\)/);
});

test('菜单栏图标提供 1x 和 Retina 2x 透明资源', () => {
  const oneX = path.join(desktopPetRoot, 'assets/tray-iconTemplate.png');
  const twoX = path.join(desktopPetRoot, 'assets/tray-iconTemplate@2x.png');

  assert.deepEqual(
    readPngHeader(oneX),
    { width: 16, height: 16, bitDepth: 8, colorType: 6 }
  );
  assert.deepEqual(
    readPngHeader(twoX),
    { width: 32, height: 32, bitDepth: 8, colorType: 6 }
  );
  assert.deepEqual(readDpi(oneX), { width: 72, height: 72 });
  assert.deepEqual(readDpi(twoX), { width: 144, height: 144 });
});

test('菜单栏图标使用清晰线稿并由独立 Retina 源图生成', () => {
  const oneX = fs.readFileSync(
    path.join(desktopPetRoot, 'assets/tray-iconTemplate.svg'),
    'utf8'
  );
  const twoX = fs.readFileSync(
    path.join(desktopPetRoot, 'assets/tray-iconTemplate@2x.svg'),
    'utf8'
  );

  assert.match(oneX, /viewBox="0 0 16 16"/);
  assert.match(oneX, /<circle[^>]+fill="none"[^>]+stroke="black"[^>]+stroke-width="1\.5"/);
  assert.doesNotMatch(oneX, /<mask/);
  assert.equal(
    twoX.replace('width="32" height="32"', 'width="16" height="16"'),
    oneX
  );
});
