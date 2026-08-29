const INVALID_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DEFAULT_MAXIMUM = 40;
const TITLE_MAXIMUM = 18;

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
  const title = plainText(value, TITLE_MAXIMUM);
  const reliable = title.replace(DEFAULT_IGNORABLE, '');
  return reliable && reliable !== '未命名任务' ? title : null;
}

function genericCompletion(count) {
  return count > 1 ? `有 ${count} 轮出结果啦\n去看看？` : '这轮有结果啦，去看看？';
}

function completionText(titles, count, showNames) {
  const taskCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  if (showNames !== true || !Array.isArray(titles)) return genericCompletion(taskCount);
  const names = [...new Set(titles.map(alertTaskTitle).filter(Boolean))];
  if (taskCount === 1 && names.length) return `《${names[0]}》有结果啦\n去看看？`;
  if (taskCount <= 1 || !names.length) return genericCompletion(taskCount);

  const withTwo = `《${names.slice(0, 2).join('》《')}》等 ${taskCount} 个任务有结果啦\n去看看？`;
  if (Array.from(withTwo).length <= 48) return withTwo;
  const withOne = `《${names[0]}》等 ${taskCount} 个任务有结果啦\n去看看？`;
  return Array.from(withOne).length <= 48 ? withOne : genericCompletion(taskCount);
}

module.exports = { plainText, menuText, alertTaskTitle, completionText };
