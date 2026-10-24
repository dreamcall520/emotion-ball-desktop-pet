const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings } = require('../lib/settings');

test('ZCode settings default off and do not change existing Codex preferences', () => {
  const state = normalizeSettings({ codexEnabled: true, codexQuotaAlwaysVisible: false });
  assert.equal(state.zcodeEnabled, false);
  assert.equal(state.zcodeQuotaAlwaysVisible, true);
  assert.equal(state.zcodeQuotaLabelSize, 'compact');
  assert.equal(state.chatSource, 'codex');
  assert.equal(state.codexEnabled, true);
  assert.equal(state.codexQuotaAlwaysVisible, false);
});

test('ZCode settings and model/source choice survive normalization independently', () => {
  const state = normalizeSettings({ zcodeEnabled: true, zcodeQuotaAlwaysVisible: false,
    zcodeQuotaLabelSize: 'standard', zcodeChatModel: 'glm-5.3-flash', chatSource: 'zcode', chatModel: 'gpt-6-sol', codexEnabled: false });
  assert.equal(state.zcodeEnabled, true);
  assert.equal(state.zcodeQuotaAlwaysVisible, false);
  assert.equal(state.zcodeQuotaLabelSize, 'standard');
  assert.equal(state.zcodeChatModel, 'glm-5.3-flash');
  assert.equal(state.chatSource, 'zcode');
  assert.equal(state.chatModel, 'gpt-6-sol');
  assert.equal(state.codexEnabled, false);
  assert.equal(normalizeSettings({ chatSource: 'other', zcodeChatModel: '\n' }).chatSource, 'codex');
});
