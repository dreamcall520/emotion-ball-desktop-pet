const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const isModelId = value => typeof value === 'string' && value !== 'auto' && MODEL_ID.test(value);
const modelError = code => Object.assign(new Error(code), { code });

function normalizeModelSelection(value) {
  return isModelId(value) ? value : 'auto';
}

// These are routing hints only. No additional model request is made to classify a message.
function requestedDepth(text) {
  const input = typeof text === 'string' ? text.slice(0, 2000) : '';
  if (/(?:深入|深度|全面|严谨|详细).{0,12}(?:分析|推导|论证|研究)|复杂.{0,12}(?:推导|推理|问题|分析)|(?:证明|推导).{0,12}(?:定理|公式)|\b(?:in.depth analysis|deep research|complex reasoning|rigorous proof)\b/i.test(input)) return 'deep';
  if (/^\s*(?:分析|比较|对比|规划|制定|计划)|(?:帮我|请|需要|能否|可以|给我).{0,16}(?:分析|比较|对比|规划|计划|方案)|(?:分析|比较|对比|规划|计划|方案).{0,12}(?:一下|一下子|两种|这|优缺点|怎么|如何)|\b(?:analy[sz]e|compare|plan|trade.off)\b/i.test(input)) return 'balanced';
  return 'chat';
}

function familyVersion(id, family) {
  const match = new RegExp(`^gpt-(\\d+(?:\\.\\d+)*)-${family}(?:-(\\d{4}-?\\d{2}-?\\d{2}))?$`, 'i').exec(id);
  return match ? { numbers: match[1].split('.').map(Number), date: Number((match[2] || '').replaceAll('-', '')) || 0 } : null;
}

function latestInFamily(models, family) {
  return models.map(model => ({ model, version: familyVersion(model.id, family) })).filter(entry => entry.version)
    .sort((a, b) => {
      const count = Math.max(a.version.numbers.length, b.version.numbers.length);
      for (let i = 0; i < count; i++) {
        const difference = (b.version.numbers[i] || 0) - (a.version.numbers[i] || 0);
        if (difference) return difference;
      }
      if (b.version.date !== a.version.date) return b.version.date - a.version.date;
      return a.model.id.localeCompare(b.model.id);
    })[0]?.model;
}

function resolveChatModel(models, selection, text) {
  const available = Array.isArray(models) ? models.filter(model => model && isModelId(model.id) && model.hidden !== true &&
    typeof model.displayName === 'string' && Array.isArray(model.supportedReasoningEfforts)) : [];
  if (!available.length) throw modelError('MODELS_UNAVAILABLE');
  const selected = normalizeModelSelection(selection), automatic = selected === 'auto';
  const depth = automatic ? requestedDepth(text) : 'chat';
  let model;
  if (!automatic) {
    model = available.find(candidate => candidate.id === selected);
    if (!model) throw modelError('MODEL_UNAVAILABLE');
  } else {
    const families = depth === 'deep' ? ['astra', 'sol', 'luna'] : depth === 'balanced' ? ['sol', 'astra', 'luna'] : ['luna', 'sol', 'astra'];
    model = families.map(family => latestInFamily(available, family)).find(Boolean) || available.find(candidate => candidate.isDefault === true) || available[0];
  }
  // Never omit effort and thereby inherit a coding session's expensive reasoning level.
  const preference = depth === 'deep' ? ['medium', 'low', 'minimal', 'none'] : ['low', 'minimal', 'none', 'medium'];
  const effort = preference.find(value => model.supportedReasoningEfforts.includes(value));
  if (!effort) throw modelError('MODEL_UNAVAILABLE');
  return { model: model.id, effort, displayName: model.displayName, automatic,
    reason: automatic ? depth : 'manual' };
}

module.exports = { normalizeModelSelection, resolveChatModel, isModelId };
