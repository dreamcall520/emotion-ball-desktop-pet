const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { feedbackAcceptanceOptions } = require('../scripts/package-feedback-acceptance');
const { prepareStaging, buildPackagerOptions } = require('../scripts/package-mac');

test('feedback acceptance keeps its own identity, output and native-weather signing requirements', () => {
  const options = feedbackAcceptanceOptions('/repo', '/icon.icns', null);
  const normal = buildPackagerOptions('/repo', '/icon.icns', null);
  assert.equal(options.name, '球球桌宠-反馈验收');
  assert.equal(options.appBundleId, 'local.xiaokun.emotionball.pet.feedback-acceptance');
  assert.equal(options.dir, '/repo/desktop-pet/build/feedback-acceptance-staging');
  assert.equal(options.out, '/repo/dist/feedback-acceptance');
  assert.equal(options.arch, 'arm64');
  assert.deepEqual(options.asar, { unpack: '**/*.node' });
  assert.deepEqual(options.extendInfo, normal.extendInfo);
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.match(main, /const IS_ACCEPTANCE = \[[^;]*'feedback'[^;]*includes\(ACCEPTANCE_KIND\)/);
  assert.match(main, /ACCEPTANCE_KIND === 'feedback' \? '球球桌宠-反馈验收'/);
});

test('feedback staging contains the exact feedback UI/module and no customer data or reporting queue', t => {
  const root = path.resolve(__dirname, '../..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-feedback-package-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  prepareStaging(root, temporary, { weatherNative: false });
  for (const file of ['main.js', 'global-settings.html', 'global-settings.css', 'global-settings-preload.js',
    'global-settings-renderer.js', 'global-settings-feedback.js', 'lib/feedback-reporting.js', 'lib/settings.js']) {
    assert.deepEqual(fs.readFileSync(path.join(temporary, 'desktop-pet', file)), fs.readFileSync(path.join(root, 'desktop-pet', file)), file);
  }
  const files = fs.readdirSync(temporary, { recursive: true });
  assert.equal(files.some(file => /(?:^|\/)(?:settings\.json|errors\.log|feedback-outbox\.json|diagnostics|admin-token|\.dev\.vars|\.env)(?:\/|$)/.test(file)), false);
  assert.equal(files.some(file => /(?:^|\/)(?:feedback-server|tests|node_modules|output)(?:\/|$)/.test(file)), false);
});
