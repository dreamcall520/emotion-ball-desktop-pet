const INVALID_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DEFAULT_MAXIMUM = 40;
const TITLE_MAXIMUM = 18;
// 变体由一次真实完成提醒固定选定，刷新任务名称时沿用，避免同一气泡换词。
const COMPLETION_VARIANTS = Object.freeze([
  { single: '这轮有结果啦', named: '有结果啦', multiple: '出结果啦' },
  { single: '结果来啦', named: '结果来啦', multiple: '出结果啦' },
  { single: '这一轮跑完啦', named: '这一轮跑完啦', multiple: '跑完啦' },
  { single: '新的结果到啦', named: '新的结果到啦', multiple: '新结果到啦' },
  { single: '这一轮有回应啦', named: '这一轮有回应啦', multiple: '有回应啦' },
  // Codex 的完成事件代表一轮运行完成，不代表整个任务已经全部做完。
  { single: '这一轮完成啦', named: '这一轮完成啦', multiple: '完成啦' },
  { single: '这次有新进展啦', named: '这次有新进展啦', multiple: '有新进展啦' },
  { single: '球球来报个信', named: '有消息啦', multiple: '有消息啦', invitation: '球球来报个信，去看看？' },
  { single: '这一轮落定啦', named: '这一轮落定啦', multiple: '落定啦' }
].map(Object.freeze));
const COMPLETION_VARIANT_COUNT = COMPLETION_VARIANTS.length;

function limit(value, maximum = DEFAULT_MAXIMUM, fallback = '') {
  const cleaned = typeof value === 'string' ? value.replace(INVALID_TEXT, ' ').replace(/\s+/gu, ' ').trim() : '';
  const source = cleaned || (typeof fallback === 'string'
    ? fallback.replace(INVALID_TEXT, ' ').replace(/\s+/gu, ' ').trim() : '');
  if (!Number.isFinite(maximum)) maximum = DEFAULT_MAXIMUM;
  maximum = Math.floor(maximum);
  if (maximum <= 0) return '';
  const points = Array.from(source);
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : points.join('');
}

function plainText(value, maximum = DEFAULT_MAXIMUM, fallback = '') {
  return limit(value, maximum, fallback);
}

function menuText(value, maximum = DEFAULT_MAXIMUM, fallback = '') {
  return plainText(value, maximum, fallback).replace(/&/g, '&&');
}

function alertTaskTitle(value) {
  const fullTitle = plainText(value, Number.MAX_SAFE_INTEGER);
  const reliable = fullTitle.replace(DEFAULT_IGNORABLE, '');
  if (!reliable || reliable === '未命名任务') return null;
  const preview = plainText(fullTitle, TITLE_MAXIMUM);
  const previewPoints = Array.from(preview);
  const fullPoints = Array.from(fullTitle);
  const visiblePreview = previewPoints
    .slice(0, fullPoints.length > TITLE_MAXIMUM && previewPoints.at(-1) === '…' ? -1 : undefined)
    .join('').replace(DEFAULT_IGNORABLE, '').replace(/\s+/gu, '').trim();
  return visiblePreview && visiblePreview !== '未命名任务' ? preview : null;
}

function genericCompletion(count, variant) {
  return count > 1 ? `有 ${count} 轮${variant.multiple}\n去看看？` : `${variant.single}，去看看？`;
}

function completionText(titles, count, showNames, variantIndex = 0) {
  const variant = Number.isInteger(variantIndex) && variantIndex >= 0 && variantIndex < COMPLETION_VARIANT_COUNT
    ? COMPLETION_VARIANTS[variantIndex] : COMPLETION_VARIANTS[0];
  const taskCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  if (showNames !== true || !Array.isArray(titles)) return genericCompletion(taskCount, variant);
  const names = [...new Set(titles.map(alertTaskTitle).filter(Boolean))];
  const suffix = `${variant.named}\n${variant.invitation || '去看看？'}`;
  if (taskCount === 1 && names.length) return `《${names[0]}》${suffix}`;
  if (taskCount <= 1 || !names.length) return genericCompletion(taskCount, variant);

  const withTwo = `《${names.slice(0, 2).join('》《')}》等 ${taskCount} 个任务${suffix}`;
  if (Array.from(withTwo).length <= 48) return withTwo;
  const withOne = `《${names[0]}》等 ${taskCount} 个任务${suffix}`;
  return Array.from(withOne).length <= 48 ? withOne : genericCompletion(taskCount, variant);
}

module.exports = { plainText, menuText, alertTaskTitle, completionText, COMPLETION_VARIANT_COUNT };
