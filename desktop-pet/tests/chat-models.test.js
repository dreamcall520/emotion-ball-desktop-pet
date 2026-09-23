const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModelSelection, resolveChatModel } = require('../lib/chat-models');
const model = (id, extra = {}) => ({ id, displayName: id.toUpperCase(), description: '',
  supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', isDefault: false, ...extra });
const models = ['gpt-5.6-luna', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-6-sol'].map(id => model(id));

test('选择值仅保留安全模型id，非法输入归一为auto', () => {
  for (const value of [undefined, null, {}, [], 1, '', 'auto', ' gpt-6-luna', '--config', '../model', 'x\nSECRET', '<img>', 'a'.repeat(129)]) assert.equal(normalizeModelSelection(value), 'auto');
  assert.equal(normalizeModelSelection('gpt-6-luna'), 'gpt-6-luna');
});

test('自动按消息深度选当前目录中的最新模型，闲聊/计划/深入分别luna/sol/astra', () => {
  assert.deepEqual(resolveChatModel(models, 'auto', '我还在加班'), { model: 'gpt-6-luna', effort: 'low', displayName: 'GPT-6-LUNA', automatic: true, reason: 'chat' });
  for (const text of ['帮我分析两种方案', '比较这两个方案', '规划一个周末旅行', '请给我一个学习计划']) {
    assert.equal(resolveChatModel(models, 'auto', text).model, 'gpt-6-sol', text);
    assert.equal(resolveChatModel(models, 'auto', text).effort, 'low');
  }
  for (const text of ['请深入分析这个问题', '帮我严谨推导这个公式', 'complex reasoning about this problem']) {
    assert.equal(resolveChatModel(models, 'auto', text).model, 'gpt-6-astra', text);
    assert.equal(resolveChatModel(models, 'auto', text).effort, 'medium');
  }
  assert.equal(resolveChatModel(models, 'auto', '我的计划泡汤了，好难过').model, 'gpt-6-luna');
});

test('版本按数值选择，同版本按日期选择，不依赖目录顺序', () => {
  const catalog = ['gpt-6.2-luna', 'gpt-6.10-luna-20260801', 'gpt-6.10-luna-20260901', 'gpt-6.10-luna'].map(id => model(id));
  assert.equal(resolveChatModel(catalog, 'auto', '你好').model, 'gpt-6.10-luna-20260901');
  catalog.push(model('gpt-6.10.1-luna'));
  assert.equal(resolveChatModel(catalog, 'auto', '你好').model, 'gpt-6.10.1-luna');
});

test('手选始终固定模型，复杂消息不切模型或沿用高推理', () => {
  const selected = resolveChatModel(models, 'gpt-5.6-luna', '请深入分析复杂问题');
  assert.deepEqual(selected, { model: 'gpt-5.6-luna', effort: 'low', displayName: 'GPT-5.6-LUNA', automatic: false, reason: 'manual' });
  assert.throws(() => resolveChatModel(models, 'gpt-5.5', '你好'), { code: 'MODEL_UNAVAILABLE' });
});

test('缺少目标family时只在可用目录回退，未知目录选默认或第一项', () => {
  assert.equal(resolveChatModel([model('gpt-6-sol')], 'auto', '你好').model, 'gpt-6-sol');
  const unknown = [model('other-one'), model('other-two', { isDefault: true })];
  assert.equal(resolveChatModel(unknown, 'auto', '你好').model, 'other-two');
  assert.equal(resolveChatModel(unknown.map(item => ({ ...item, isDefault: false })), 'auto', '你好').model, 'other-one');
});

test('努力必须受支持，不继承default xhigh，也不猜测不认识的努力名', () => {
  assert.equal(resolveChatModel([model('gpt-6-luna', { defaultReasoningEffort: 'xhigh' })], 'auto', '你好').effort, 'low');
  assert.equal(resolveChatModel([model('gpt-6-luna', { supportedReasoningEfforts: ['none', 'medium'] })], 'auto', '你好').effort, 'none');
  assert.equal(resolveChatModel([model('gpt-6-astra', { supportedReasoningEfforts: ['low'] })], 'auto', '请深入分析').effort, 'low');
  for (const efforts of [[], ['xhigh'], ['turbo']]) assert.throws(() => resolveChatModel([model('gpt-6-luna', { supportedReasoningEfforts: efforts })], 'auto', '你好'), { code: 'MODEL_UNAVAILABLE' });
});

test('没有目录或仅隐藏/非法项时不凭空猜模型', () => {
  for (const catalog of [null, {}, [], [model('../bad')], [model('gpt-6-luna', { hidden: true })]]) assert.throws(() => resolveChatModel(catalog, 'auto', '你好'), { code: 'MODELS_UNAVAILABLE' });
});
