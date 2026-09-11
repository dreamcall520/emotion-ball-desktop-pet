/* V5 独立文案试听：仅供设计评审，不读取任务，也不修改正式应用词库。 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QiuqiuDialoguePreview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function entries(existing, additions) {
    return Object.freeze(existing.map(function (text) { return Object.freeze({ text: text, status: '现有' }); })
      .concat(additions.map(function (text) { return Object.freeze({ text: text, status: '新增' }); })));
  }

  var GROUPS = Object.freeze({
    thought: Object.freeze({ label: '思考中', note: '新增 8 句', phrases: entries([], [
      '我把思路理一理。', '一点点把线索串起来。', '先让想法绕一小圈。', '认真想想，再往前走。',
      '思路还在慢慢成形。', '先把这一段想清楚。', '想法正在排好队。', '先安静一下，让想法落稳。'
    ]) }),
    nuzzle: Object.freeze({ label: '摸头', note: '新增 8 句', phrases: entries([], [
      '这边靠着刚刚好。', '软乎乎地贴一下。', '头顶暖乎乎的。', '轻轻一摸，我就安心啦。',
      '摸得我眯起眼啦。', '我乖乖靠一会儿。', '整颗球都放松啦。', '这一会儿，很舒服。'
    ]) }),
    land: Object.freeze({ label: '放下', note: '新增 8 句', phrases: entries([], [
      '我转回来站好啦。', '新视角，记住啦。', '转回来，正好看见你。', '圆心停好，不晃啦。',
      '这次停得很端正。', '换个角度，也挺新鲜。', '好，这边看得清楚。', '落在这里，也很舒服。'
    ]) }),
    stretch: Object.freeze({ label: '唤醒', note: '新增 8 句', phrases: entries([], [
      '睡意跑掉，我醒啦。', '眼睛一亮，清醒啦。', '醒醒脑袋，继续陪你。', '绕完小圈，精神到位。',
      '眨眨眼，今天继续。', '睁开眼，又见到你啦。', '睡意已经躲起来啦。', '醒着陪你，再待一会儿。'
    ]) }),
    complete: Object.freeze({ label: '任务完成', note: '新增 8 句', phrases: entries([], [
      '结果来啦，去看看？', '这一轮跑完啦，去看看？', '新的结果到啦，去看看？', '这一轮有回应啦，去看看？',
      '任务完成啦，去看看？', '这次有新进展啦，去看看？', '球球来报个信，去看看？', '这一轮落定啦，去看看？'
    ]) }),
    hello: Object.freeze({ label: '日常问候', note: '新增 6 句', phrases: entries([], [
      '屏幕角落，多了一点圆。', '今日圆度，状态良好。', '嗨，今天也碰面啦。',
      '小球今天依旧圆圆的。', '嗨，我来冒个泡。', '先送你一个小小问候。'
    ]) }),
    work: Object.freeze({ label: '工作陪伴', note: '新增 6 句', phrases: entries([], [
      '一件一件来，节奏刚好。', '专注也有自己的节奏。', '球球在这儿，稳稳待着。',
      '按自己的步子往前走。', '思路慢慢理，我就慢慢等。', '忙里也留一点呼吸。'
    ]) }),
    sleep: Object.freeze({ label: '睡眠', note: '新增 8 句', phrases: entries([], [
      '困意落在眼皮上啦。', '呼吸放慢一点点。', '梦里也要圆滚滚。', '把这一刻轻轻收好。',
      '我先安静窝一会儿。', '安静慢慢落下来啦。', '这一会儿，先停在这里。', '让脑袋也休息一会儿。'
    ]) }),
    hop: Object.freeze({ label: '开心连跳', note: '现有 2 + 新增 2', phrases: entries([
      '看我蹦两下！', '快乐，起飞！'
    ], [
      '第一下！第二下！', '高一点，下一拍轻一点。'
    ]) }),
    jelly: Object.freeze({ label: '果冻抖抖', note: '现有 2 + 新增 2', phrases: entries([
      '我是软乎乎的！', '晃一晃，烦恼散掉。'
    ], [
      '软一下，又圆回来啦。', '揉圆，再慢慢弹回来。'
    ]) }),
    sway: Object.freeze({ label: '左右扭扭', note: '现有 2 + 新增 2', phrases: entries([
      '给你跳个小舞～', '左一下，右一下。'
    ], [
      '圆滚滚也会踩拍子。', '晃两下，再慢慢回正。'
    ]) }),
    peek: Object.freeze({ label: '歪头探望', note: '现有 2 + 新增 2', phrases: entries([
      '让我瞅瞅～', '这边看看，那边看看。'
    ], [
      '探出去，再悄悄回来。', '好奇心露出来啦。'
    ]) }),
    bow: Object.freeze({ label: '点头鞠躬', note: '现有 2 + 新增 2', phrases: entries([
      '收到，向你致意！', '谢谢你来陪我。'
    ], [
      '鞠个圆圆的躬。', '把认真轻轻送给你。'
    ]) }),
    spin: Object.freeze({ label: '旋转彩带', note: '现有 2 + 新增 2', phrases: entries([
      '转一圈，快乐加倍。', '这一招，专门给你看。'
    ], [
      '画个圆，再稳稳停下。', '这一转，眼睛可别跟丢。'
    ]) })
  });

  var lastPicked = new Map();
  var cursors = new Map();
  var lastText = '';

  function group(name) { return Object.prototype.hasOwnProperty.call(GROUPS, name) ? GROUPS[name] : null; }

  function pick(name, random) {
    var selected = group(name);
    if (!selected || !selected.phrases.length) return null;
    var value = typeof random === 'function' ? random() : Math.random();
    var finite = Number.isFinite(value) ? value : 0;
    var index = Math.max(0, Math.min(selected.phrases.length - 1, Math.floor(finite * selected.phrases.length)));
    if (selected.phrases.length > 1 && (index === lastPicked.get(name) || selected.phrases[index].text === lastText)) {
      index = (index + 1) % selected.phrases.length;
    }
    lastPicked.set(name, index);
    lastText = selected.phrases[index].text;
    return Object.freeze({ category: name, index: index, total: selected.phrases.length, label: selected.label,
      note: selected.note, text: selected.phrases[index].text, status: selected.phrases[index].status });
  }

  function next(name) {
    var selected = group(name);
    if (!selected || !selected.phrases.length) return null;
    var index = ((cursors.get(name) || 0) + selected.phrases.length) % selected.phrases.length;
    cursors.set(name, (index + 1) % selected.phrases.length);
    lastText = selected.phrases[index].text;
    return Object.freeze({ category: name, index: index, total: selected.phrases.length, label: selected.label,
      note: selected.note, text: selected.phrases[index].text, status: selected.phrases[index].status });
  }

  function reset() { lastPicked.clear(); cursors.clear(); lastText = ''; }

  return Object.freeze({ groups: GROUPS, group: group, pick: pick, next: next, reset: reset });
}));
