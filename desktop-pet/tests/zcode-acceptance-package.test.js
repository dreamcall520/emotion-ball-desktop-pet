const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptanceOptions } = require('../scripts/package-zcode-acceptance');

test('acceptance build has a distinct application identity and output directory', () => {
  const options = acceptanceOptions('/tmp/qiuqiu', '/tmp/icon.icns');
  assert.equal(options.name, '球球桌宠-ZCode验收');
  assert.equal(options.appBundleId, 'local.xiaokun.emotionball.pet.zcode-acceptance');
  assert.equal(options.dir, '/tmp/qiuqiu/desktop-pet/build/zcode-acceptance-staging');
  assert.equal(options.out, '/tmp/qiuqiu/dist/zcode-acceptance');
  assert.equal(options.arch, 'arm64');
});


test('combined acceptance build keeps its own identity and staging apart from both candidates', () => {
  const options = acceptanceOptions('/tmp/qiuqiu', '/tmp/icon.icns', 'combined');
  assert.equal(options.name, '球球桌宠-联动整合验收');
  assert.equal(options.appBundleId, 'local.xiaokun.emotionball.pet.combined-acceptance');
  assert.equal(options.dir, '/tmp/qiuqiu/desktop-pet/build/combined-acceptance-staging');
  assert.equal(options.out, '/tmp/qiuqiu/dist/combined-acceptance');
});
