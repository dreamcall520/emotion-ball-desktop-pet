const PHRASES = Object.freeze({
  hello: Object.freeze(['我在呢。', '嗯？叫我啦。', '小球报到。']),
  pet: Object.freeze(['嘿嘿，再摸一下。', '头顶有点痒。', '这手法，可以。']),
  drag: Object.freeze(['欸，起飞了。', '慢点，球晕。', '抓稳我呀。']),
  drop: Object.freeze(['着陆，稳稳的。', '这儿也不错。', '落地，满分。']),
  welcome: Object.freeze(['回来啦。', '我还在这儿。', '刚刚眯了一下。']),
  work: Object.freeze(['你忙，我陪着。', '我先安静一会儿。', '小球在线，勿念。']),
  play: Object.freeze(['来，接住我的开心。', '要看小球耍个宝吗？', '我有一点点厉害。']),
  sleep: Object.freeze(['我先眯一会儿。', '晚安，球先睡了。', '呼……小声一点。'])
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
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.dismiss();
  }

  dismiss() {
    this._current = null;
  }

  _expire(nowMs) {
    if (this._current && nowMs >= this._current.expiresAt) this.dismiss();
  }

  offer(event, nowMs) {
    if (!this.enabled || !Number.isFinite(nowMs) || typeof event !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PHRASES, event)) return null;
    this._expire(nowMs);
    if (this._current && PRIORITY[event] < this._current.priority) return null;

    if (event === 'work') {
      if (this._current || nowMs - this._startedAt < TEN_MINUTES ||
        nowMs - this._lastWorkAt < TEN_MINUTES || nowMs - this._lastBubbleAt < 15000 ||
        nowMs < this._workQuietUntil) return null;
    } else if (DIRECT_EVENTS.has(event)) {
      const continuingDrop = event === 'drop' && this._current?.event === 'drag';
      if (!continuingDrop && nowMs - this._lastDirectAt < 6000) return null;
    }

    const phrases = PHRASES[event];
    const randomValue = this._random();
    let index = Number.isFinite(randomValue) ? Math.max(0, Math.min(phrases.length - 1, Math.floor(randomValue * phrases.length))) : 0;
    if (index === this._lastPhrase.get(event)) index = (index + 1) % phrases.length;
    this._lastPhrase.set(event, index);

    const id = this._nextId++;
    const durationMs = event === 'play' ? 8000 : 4000;
    const actions = event === 'play' ? PLAY_ACTIONS : [];
    this._current = { id, event, actions, priority: PRIORITY[event], expiresAt: nowMs + durationMs };
    this._lastBubbleAt = nowMs;
    if (DIRECT_EVENTS.has(event)) this._lastDirectAt = nowMs;
    if (event === 'work') this._lastWorkAt = nowMs;
    return { id, text: phrases[index], actions: actions.map(action => ({ ...action })), durationMs };
  }

  respond(id, action, nowMs) {
    if (!Number.isFinite(nowMs)) return null;
    this._expire(nowMs);
    if (!this._current || id !== this._current.id || !this._current.actions.some(item => item.id === action)) return null;
    this.dismiss();
    if (action === 'rest') this._workQuietUntil = nowMs + TEN_MINUTES;
    return action;
  }
}
module.exports = { PHRASES, DialogueDirector };
