const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeAppearance } = require('../lib/customization');
const { prepareStaging } = require('../scripts/package-mac');

test('公开源码保留四形态、六瓣配置与内嵌主体，打包文件和本地依赖完整', t => {
  const root = path.resolve(__dirname, '../..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const renderer = read('desktop-pet/customize-renderer.js');
  const cards = vm.runInNewContext(`[${renderer.match(/const shapeNames = \[([\s\S]*?)\n  \];/)[1]}]`);
  assert.deepEqual(Array.from(cards, card => card[1]), ['经典', '云朵', '幻彩', '方糖']);
  assert.equal(cards.filter(card => card[0] === 'aurora-cloud').length, 1);
  for (const auroraContour of [undefined, 'original', 'six-lobe', 'invalid']) {
    assert.equal(normalizeAppearance({ shape: 'aurora-cloud', auroraContour }).auroraContour, 'six-lobe');
  }

  const riv = Buffer.from(read('desktop-pet/lib/boo-binary.js').match(/\briv:"([^"]+)"/)[1], 'base64');
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const outlines = [];
  for (let start = riv.indexOf(signature); start !== -1; start = riv.indexOf(signature, start + 8)) {
    if (riv.readUInt32BE(start + 16) !== 550 || riv.readUInt32BE(start + 20) !== 500) continue;
    let end = start + 8;
    while (end + 12 <= riv.length) {
      const kind = riv.toString('ascii', end + 4, end + 8);
      end += riv.readUInt32BE(end) + 12;
      assert.ok(end <= riv.length, '内嵌 PNG 完整');
      if (kind === 'IEND') break;
    }
    outlines.push(riv.subarray(start, end));
  }
  assert.equal(outlines.length, 1);
  assert.deepEqual(outlines[0], fs.readFileSync(path.join(root, 'desktop-pet/assets/aurora-six-lobe-body.png')));

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-public-staging-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  prepareStaging(root, staging);
  for (const relative of fs.readdirSync(staging, { recursive: true })) {
    const file = path.join(staging, relative);
    if (!fs.statSync(file).isFile()) continue;
    if (relative !== 'package.json') assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(root, relative)), relative);
    const text = /\.(?:js|html)$/.test(relative) ? fs.readFileSync(file, 'utf8') : '';
    const refs = relative.endsWith('.js') ? [...text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)] :
      [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].filter(match => !/^(?:\w+:|#)/.test(match[1]));
    for (const [, ref] of refs) {
      const local = path.resolve(path.dirname(file), ref);
      assert.ok(fs.existsSync(local) || fs.existsSync(`${local}.js`), `${relative} 缺少 ${ref}`);
    }
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(staging, 'package.json'))).version,
    JSON.parse(read('package.json')).version);
});
