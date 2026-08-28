const { getMotion } = require('./interaction-motion');
const MOTION_PHRASES = Object.freeze({
  hop: Object.freeze(['看我蹦两下！', '快乐，起飞！']),
  jelly: Object.freeze(['我是软乎乎的！', '晃一晃，烦恼散掉。']),
  sway: Object.freeze(['给你跳个小舞～', '左一下，右一下。']),
  peek: Object.freeze(['让我瞅瞅～', '这边看看，那边看看。']),
  bow: Object.freeze(['收到，向你致意！', '谢谢你来陪我。']),
  spin: Object.freeze(['转一圈，快乐加倍。', '这一招，专门给你看。'])
});
const PHRASES = Object.freeze({
  hello: Object.freeze([
    '我在呢。', '嗯？叫我啦。', '小球报到。', '目光锁定你。',
    '嘿，碰个眼神。', '被你发现啦。', '今天也请多关照。', '你的跟屁球上线。',
    '你一来，我就精神了。', '我有认真看着哦。', '靠近一点点。', '你好呀，我的小伙伴。'
  ]),
  pet: Object.freeze([
    '嘿嘿，再摸一下。', '头顶有点痒。', '这手法，可以。', '舒服得想原地融化。',
    '收到一份温柔。', '好感度偷偷加一。', '摸摸头，烦恼溜走。', '再来两下也行。',
    '今天也是被宠的小球。', '谢谢，电量加满了。'
  ]),
  drag: Object.freeze([
    '欸，起飞了。', '慢点，球晕。', '抓稳我呀。', '小球专机出发。',
    '目的地由你决定。', '今天去哪个角落？', '带上我，算你有眼光。', '悬空也要保持可爱。'
  ]),
  drop: Object.freeze([
    '着陆，稳稳的。', '这儿也不错。', '落地，满分。', '新工位，已就绪。',
    '就这儿，风景不错。', '小球搬家成功。', '脚踏实地的感觉。', '这个角落归我啦。'
  ]),
  welcome: Object.freeze([
    '回来啦。', '我还在这儿。', '你回来，刚刚好。', '欢迎回到小球频道。',
    '今天有什么新鲜事？', '见到你，开心加一。', '搭档，继续出发吧。', '你的快乐搭子上线。',
    '位置给你留着呢。', '看到你就有精神。'
  ]),
  work: Object.freeze([
    '你忙，我陪着。', '我先安静一会儿。', '小球在线，勿念。', '你负责忙，我负责萌。',
    '慢慢来，我不催你。', '认真陪伴也是工作。', '给你一颗无声的赞。', '今天也一起加油。',
    '不打扰，偷偷打气。', '忙完记得伸个懒腰。'
  ]),
  play: Object.freeze([
    '来，接住我的开心。', '要看小球耍个宝吗？', '我有一点点厉害。', '收到，你的快乐订单。',
    '你一戳，我就来劲。', '今日份可爱已送达。', '这一招，专门给你看。', '被选中的小球好开心。',
    '快乐就这么简单。', '别光看，也夸夸我嘛。', '再陪你玩一小会儿。', '互动成功，默契加一。'
  ]),
  sleep: Object.freeze(['我先眯一会儿。', '晚安，球先睡了。', '呼……小声一点。', '小球充电中，待会见。'])
});
const DIRECT_EVENTS = new Set(['hello', 'pet', 'drag', 'drop', 'play']);
const PRIORITY = { work: 0, hello: 1, welcome: 2, sleep: 2, pet: 3, drag: 3, drop: 3, play: 3 };
const PLAY_ACTIONS = Object.freeze([
  Object.freeze({ id: 'again', label: '再来一次' }),
  Object.freeze({ id: 'rest', label: '你歇会儿' })
]);
const TEN_MINUTES = 600000;

class DialogueDirector {
  constructor({ random = Math.random, now = 0, enabled = true } = {}) {
    this.enabled = Boolean(enabled);
    this._random = random;
    this._startedAt = now;
    this._lastDirectAt = -Infinity;
    this._lastWorkAt = -Infinity;
    this._lastBubbleAt = -Infinity;
    this._workQuietUntil = -Infinity;
    this._lastPhrase = new Map();
    this._nextId = 1;
    this._current = null;
    this._dropPending = false;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.dismiss();
  }

  dismiss() {
    this._current = null;
    this._dropPending = false;
  }

  _expire(nowMs) {
    if (this._current && nowMs >= this._current.expiresAt) this._current = null;
  }

  hasBubble(nowMs) {
    if (!Number.isFinite(nowMs)) return false;
    this._expire(nowMs);
    return this._current !== null;
  }

  dismissCodex() {
    if (this._current?.event !== 'codex') return false;
    this.dismiss();
    return true;
  }

  offerCodex(alert, nowMs, durationMs = 8000) {
    if (!this.enabled || !Number.isFinite(nowMs) || !Number.isFinite(durationMs) || durationMs <= 0 ||
      !Number.isSafeInteger(alert?.id) || !Number.isSafeInteger(alert.generation) ||
      !['waiting', 'completed', 'failed', 'quota'].includes(alert.kind) ||
      typeof alert.text !== 'string' || !alert.text.trim() || alert.text.length > 48 ||
      alert.text.split('\n').length > 2 || !Array.isArray(alert.taskIds)) return null;
    this._expire(nowMs);
    if (this._current) return null;
    const actions = [];
    const descriptors = {};
    const descriptor = type => ({ scope: 'alert', type, generation: alert.generation, alertId: alert.id });
    if (alert.taskIds.length === 1) {
      actions.push({ id: 'codex-open', label: '去看看' });
      descriptors['codex-open'] = { ...descriptor('open-task'), taskId: alert.taskIds[0] };
    } else if (alert.taskIds.length > 1) {
      actions.push({ id: 'codex-list', label: '查看任务' });
      descriptors['codex-list'] = descriptor('show-tasks');
    }
    actions.push({ id: 'codex-dismiss', label: '知道啦' });
    descriptors['codex-dismiss'] = descriptor('dismiss');
    const id = this._nextId++;
    durationMs = Math.min(8000, durationMs);
    this._current = { id, event: 'codex', priority: -1, actions, descriptors, expiresAt: nowMs + durationMs };
    this._lastBubbleAt = nowMs;
    return { id, text: alert.text, actions: actions.map(action => ({ ...action })), durationMs };
  }

  offer(request, nowMs) {
    const motion = request && typeof request === 'object' ? request.motion : null;
    const event = typeof request === 'string' ? request : request?.event;
    if (typeof request !== 'string' && (event !== 'play' || !getMotion(motion))) return null;
    if (!this.enabled || !Number.isFinite(nowMs) || typeof event !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PHRASES, event)) return null;
    this._expire(nowMs);
    if (DIRECT_EVENTS.has(event)) this.dismissCodex();
    // 新的直接互动即使遇到六秒冷却，也不能留下已被取代的动作专属文案。
    if (DIRECT_EVENTS.has(event) && this._current?.event === 'play' &&
      (motion || this._current.motion) && motion !== this._current.motion) this.dismiss();
    // 睡眠是状态切换：先让旧玩耍按钮失效，醒来后的欢迎仍可正常接上。
    if (event === 'sleep') this.dismiss();
    if (this._current && PRIORITY[event] < this._current.priority) return null;

    if (event === 'work') {
      if (this._current || nowMs - this._startedAt < TEN_MINUTES ||
        nowMs - this._lastWorkAt < TEN_MINUTES || nowMs - this._lastBubbleAt < 15000 ||
        nowMs < this._workQuietUntil) return null;
    } else if (DIRECT_EVENTS.has(event)) {
      const continuingDrop = event === 'drop' && this._dropPending;
      if (!continuingDrop && nowMs - this._lastDirectAt < 6000) return null;
    }

    const phrases = motion ? MOTION_PHRASES[motion] : PHRASES[event];
    const phraseKey = motion ? `play:${motion}` : event;
    const randomValue = this._random();
    let index = Number.isFinite(randomValue) ? Math.max(0, Math.min(phrases.length - 1, Math.floor(randomValue * phrases.length))) : 0;
    if (index === this._lastPhrase.get(phraseKey)) index = (index + 1) % phrases.length;
    this._lastPhrase.set(phraseKey, index);

    const id = this._nextId++;
    const durationMs = event === 'play' ? 8000 : 4000;
    const actions = event === 'play' ? PLAY_ACTIONS : [];
    this._current = { id, event, motion, actions, priority: PRIORITY[event], expiresAt: nowMs + durationMs };
    this._lastBubbleAt = nowMs;
    if (DIRECT_EVENTS.has(event)) {
      this._lastDirectAt = nowMs;
      this._dropPending = event === 'drag';
    }
    if (event === 'work') this._lastWorkAt = nowMs;
    return { id, text: phrases[index], actions: actions.map(action => ({ ...action })), durationMs };
  }

  respond(id, action, nowMs) {
    if (!Number.isFinite(nowMs)) return null;
    this._expire(nowMs);
    if (!this._current || id !== this._current.id || !this._current.actions.some(item => item.id === action)) return null;
    const descriptor = this._current.descriptors?.[action];
    const motion = this._current.motion;
    this.dismiss();
    if (descriptor) return { command: 'codex', descriptor: { ...descriptor } };
    if (action === 'rest') this._workQuietUntil = nowMs + TEN_MINUTES;
    return action === 'again' && motion ? { command: 'again', motion } : action;
  }
}
module.exports = { PHRASES, DialogueDirector };
