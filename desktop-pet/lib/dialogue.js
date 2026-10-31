const { getMotion } = require('./interaction-motion');
const SheepSkin = require('./sheep-skin');
const MOTION_PHRASES = Object.freeze({
  hop: Object.freeze(['看我蹦两下！', '快乐，起飞！', '第一下！第二下！', '高一点，下一拍轻一点。']),
  jelly: Object.freeze(['我是软乎乎的！', '晃一晃，烦恼散掉。', '软一下，又圆回来啦。', '揉圆，再慢慢弹回来。']),
  sway: Object.freeze(['给你跳个小舞～', '左一下，右一下。', '圆滚滚也会踩拍子。', '晃两下，再慢慢回正。']),
  peek: Object.freeze(['让我瞅瞅～', '这边看看，那边看看。', '探出去，再悄悄回来。', '好奇心露出来啦。']),
  bow: Object.freeze(['收到，向你致意！', '谢谢你来陪我。', '鞠个圆圆的躬。', '把认真轻轻送给你。']),
  spin: Object.freeze(['转一圈，快乐加倍。', '这一招，专门给你看。', '画个圆，再稳稳停下。', '这一转，眼睛可别跟丢。'])
});
const PHRASES = Object.freeze({
  hello: Object.freeze([
    '我在呢。', '嗯？叫我啦。', '小球报到。', '目光锁定你。',
    '嘿，碰个眼神。', '被你发现啦。', '今天也请多关照。', '你的跟屁球上线。',
    '你一来，我就精神了。', '我有认真看着哦。', '靠近一点点。', '你好呀，我的小伙伴。',
    '屏幕角落，多了一点圆。', '今日圆度，状态良好。', '嗨，今天也碰面啦。',
    '小球今天依旧圆圆的。', '嗨，我来冒个泡。', '先送你一个小小问候。'
  ]),
  pet: Object.freeze([
    '嘿嘿，再摸一下。', '头顶有点痒。', '这手法，可以。', '舒服得想原地融化。',
    '收到一份温柔。', '好感度偷偷加一。', '摸摸头，烦恼溜走。', '再来两下也行。',
    '今天也是被宠的小球。', '谢谢，电量加满了。',
    '这边靠着刚刚好。', '软乎乎地贴一下。', '头顶暖乎乎的。', '轻轻一摸，我就安心啦。',
    '摸得我眯起眼啦。', '我乖乖靠一会儿。', '整颗球都放松啦。', '这一会儿，很舒服。'
  ]),
  drag: Object.freeze([
    '欸，起飞了。', '慢点，球晕。', '抓稳我呀。', '小球专机出发。',
    '目的地由你决定。', '今天去哪个角落？', '带上我，算你有眼光。', '悬空也要保持可爱。'
  ]),
  drop: Object.freeze([
    '着陆，稳稳的。', '这儿也不错。', '落地，满分。', '新工位，已就绪。',
    '就这儿，风景不错。', '小球搬家成功。', '脚踏实地的感觉。', '这个角落归我啦。',
    '我转回来站好啦。', '新视角，记住啦。', '转回来，正好看见你。', '圆心停好，不晃啦。',
    '这次停得很端正。', '换个角度，也挺新鲜。', '好，这边看得清楚。', '落在这里，也很舒服。'
  ]),
  welcome: Object.freeze([
    '回来啦。', '我还在这儿。', '你回来，刚刚好。', '欢迎回到小球频道。',
    '今天有什么新鲜事？', '见到你，开心加一。', '搭档，继续出发吧。', '你的快乐搭子上线。',
    '位置给你留着呢。', '看到你就有精神。'
  ]),
  wake: Object.freeze([
    '睡意跑掉，我醒啦。', '眼睛一亮，清醒啦。', '醒醒脑袋，继续陪你。', '绕完小圈，精神到位。',
    '眨眨眼，今天继续。', '睁开眼，又见到你啦。', '睡意已经躲起来啦。', '醒着陪你，再待一会儿。'
  ]),
  // 仅由用户主动查看进行中任务触发，不能跟随周期思考动效自动播报。
  thought: Object.freeze([
    '我把思路理一理。', '一点点把线索串起来。', '先让想法绕一小圈。', '认真想想，再往前走。',
    '思路还在慢慢成形。', '先把这一段想清楚。', '想法正在排好队。', '先安静一下，让想法落稳。'
  ]),
  work: Object.freeze([
    '你忙，我陪着。', '我先安静一会儿。', '小球在线，勿念。', '你负责忙，我负责萌。',
    '慢慢来，我不催你。', '认真陪伴也是工作。', '给你一颗无声的赞。', '今天也一起加油。',
    '不打扰，偷偷打气。', '忙完记得伸个懒腰。',
    '一件一件来，节奏刚好。', '专注也有自己的节奏。', '球球在这儿，稳稳待着。',
    '按自己的步子往前走。', '思路慢慢理，我就慢慢等。', '忙里也留一点呼吸。'
  ]),
  play: Object.freeze([
    '来，接住我的开心。', '要看小球耍个宝吗？', '我有一点点厉害。', '收到，你的快乐订单。',
    '你一戳，我就来劲。', '今日份可爱已送达。', '这一招，专门给你看。', '被选中的小球好开心。',
    '快乐就这么简单。', '别光看，也夸夸我嘛。', '再陪你玩一小会儿。', '互动成功，默契加一。'
  ]),
  sleep: Object.freeze([
    '我先眯一会儿。', '晚安，球先睡了。', '呼……小声一点。', '小球充电中，待会见。',
    '困意落在眼皮上啦。', '呼吸放慢一点点。', '梦里也要圆滚滚。', '把这一刻轻轻收好。',
    '我先安静窝一会儿。', '安静慢慢落下来啦。', '这一会儿，先停在这里。', '让脑袋也休息一会儿。'
  ])
});
const SHEEP_PHRASES = Object.freeze({
  hello: Object.freeze([
    '咩咩来报到', '嗨，小毛团来了', '给你一个软软的嗨', '今天也请多关照',
    '耳朵竖好，问个好', '和你碰个眼神', '一团可爱已就位', '小铃铛向你问好'
  ]),
  pet: Object.freeze([
    '摸摸收好啦', '耳根也想被揉揉', '羊毛借你摸摸', '小角要轻一点哦',
    '摸得耳朵软啦', '再揉一下下嘛', '嘿嘿，好舒服呀', '这边也想被摸摸'
  ]),
  drag: Object.freeze([
    '抱紧这团软乎乎', '搬家专车出发', '去哪儿溜达呀', '小蹄子悬空啦',
    '铃铛还没跟上呢', '带我换个风景吧', '耳朵收好，抱抱', '咩，慢一点点呀'
  ]),
  drop: Object.freeze([
    '落稳啦，刚刚好', '这里够我待着啦', '新角落，收到了', '小蹄子站稳啦',
    '羊毛都没弄乱', '换个地方眨眨眼', '这个位置真不错', '铃铛也摆正啦'
  ]),
  welcome: Object.freeze([
    '回来啦，见到你啦', '又见面，好开心呀', '老地方，小毛团在', '给你留了个笑脸',
    '咩，欢迎回来呀', '有新鲜事要说吗', '屏幕边向你招手', '小角落还是暖的'
  ]),
  wake: Object.freeze([
    '醒啦，耳朵慢半拍', '哈欠先打一个', '小眼睛开门啦', '睡意溜走一点点',
    '羊毛睡翘起来啦', '等耳朵醒一醒', '从软软的梦里回来', '眨眨眼，见到你啦'
  ]),
  thought: Object.freeze([
    '小脑袋转个弯', '找找思路的线头', '想法正在排队呢', '先琢磨这一点',
    '把线索捋一捋', '这团思路慢慢理', '耳朵也来帮忙听', '咩，还在想一想'
  ]),
  work: Object.freeze([
    '和你待着就很好', '你专心，我不打岔', '不用回应我呀', '抬头时就能看见我',
    '有话想说时我听着', '想笑一笑就看看我', '不想说话也没关系', '等你忙完，我也在',
    '思路可以慢慢理', '给你留一点空白', '不用一下想得周全', '小小的想法也很好',
    '绕个弯也不算白走', '先留个问号也可以', '想明白一点也算数', '不必和谁比快慢',
    '等结果时，我陪你', '不用一直盯着呀', '有结果再一起看', '等一等也没关系',
    '要是卡住了，我陪你', '思路先歇一小会', '没头绪也别为难自己', '想说说难处，我听着',
    '答案不必一下找到', '放一放再回来也行', '想歇会儿，我陪你', '歇一歇，心也松一点',
    '眼睛也值得歇一歇', '喝口水也算照顾自己', '肩膀累了就松一松', '想发会儿呆也很好',
    '休息不用找理由', '不忙着把休息填满', '今天也值得被温柔对待', '你比进度更重要',
    '认真之外也可以轻松', '不顺的时候也值得被喜欢', '愿你忙完还有小开心', '平常的一天也想陪你'
  ]),
  play: Object.freeze([
    '小蹄子有两下子', '这点可爱分给你', '嘿嘿，被你发现啦', '藏不住的小得意',
    '软毛团也会耍宝', '给你看看小调皮', '陪你玩一小会儿', '咩，有点想显摆'
  ]),
  sleep: Object.freeze([
    '羊毛当小被子', '小脑袋先歇歇', '眼皮想打烊啦', '收好小蹄子，晚安',
    '去做个软软的梦', '铃铛也要睡啦', '咩，先眯一小会儿', '小毛团充电中'
  ])
});
const SHEEP_MOTION_PHRASES = Object.freeze({
  hop: Object.freeze(['小羊的开心，被你看见啦。', '咩，这会儿特别有精神。', '陪你笑一下，心情就暖啦。', '这一点小快乐，也分给你。']),
  jelly: Object.freeze(['咩～听见你叫我啦。', '耳朵朝你这边，认真听你说。', '这声小小的咩，专门回应你。', '咩问题，我在这里呢。']),
  sway: Object.freeze(['小羊和你待着，就很开心。', '左边咩，右边也咩。', '一点点开心，慢慢攒起来。', '这颗小铃铛，也想陪着你。']),
  peek: Object.freeze(['小脑袋好奇，想听听你的事。', '咩，你刚刚叫我了吗？', '小羊就在旁边，随时听你说。', '被你发现，小羊有点得意。']),
  bow: Object.freeze(['小羊认真和你打个招呼。', '咩，今天也请多陪陪我。', '谢谢你，把时间分给小羊。', '这一声问好，暖暖送给你。']),
  spin: Object.freeze(['这会儿有点小得意，咩。', '收到你的喜欢，小羊开心啦。', '小羊乖乖陪着，也很拿手。', '给你看看今天的好心情。'])
});
const SHEEP_HOLIDAY_PHRASES = Object.freeze({
  halloween: Object.freeze(['咩？糖果可以分我一颗吗？', '小巫师到啦，今天只变开心。', '披肩一抖，藏着的糖掉出来啦。', '南瓜篮给你挑，最甜的那颗归你。', '别怕别怕，是戴帽子的小羊呀。']),
  christmas: Object.freeze(['铃铛叮一下，圣诞快乐呀。', '围巾暖好了，给你靠一会儿。', '帽尖晃一晃，今天也有点小得意。', '冬青戴端正，小羊来陪你过节。', '咩，愿你今晚有个暖暖的梦。']),
  'spring-festival': Object.freeze(['咩咩来拜年，新年好呀。', '新的一年，愿你每天都有小欢喜。', '春节也陪着你，把日子过得暖暖的。', '咩，给你送一声平平安安的新年祝福。', '过年啦，今天的好心情分你一半。'])
});
const SHEEP_SPRING_ACTION_PHRASES = Object.freeze({
  fortune: Object.freeze(['福到啦，咩咩把好运送给你。', '这张小小的福，愿你每天都有好事。', '接住咩咩的福气，新的一年顺顺利利。', '把福捧到你面前，平安喜乐都归你。']),
  firecrackers: Object.freeze(['咩咩放一串小鞭炮，热热闹闹迎新年。', '红红的小鞭炮，替你迎来新年的好彩头。', '新年开门红，咩咩陪你一起庆祝。', '鞭炮开花啦，愿你的好事也接连不断。']),
  dumplings: Object.freeze(['热乎乎的饺子，咩咩先尝一口。', '一口小饺子，吃进新年的暖和气。', '咩，这只饺子真香，也想分给你。', '饺子圆鼓鼓，今天也要好好吃饭呀。'])
});
const SHEEP_ACTION_PHRASES = Object.freeze({
  none: Object.freeze({
    ear: Object.freeze(['耳根揉揉，好舒服', '小耳朵也要摸摸', '嘿嘿，挠到啦', '咩，轻一点点']),
    bell: Object.freeze(['抱住我的小铃铛', '这点暖暖收好啦', '铃铛安静，抱抱', '小蹄子抱个满怀']),
    stretch: Object.freeze(['小蹄子伸一伸', '慢半拍，伸个懒腰', '羊毛也松快啦', '伸完继续软乎乎'])
  }),
  halloween: Object.freeze({
    candy: Object.freeze(['糖果分我一颗嘛', '南瓜篮接住甜甜', '咩，这颗糖好甜', '谢谢你的糖呀']),
    magic: Object.freeze(['变一颗小星星', '小魔法来啦', '一点星光分给你', '咩，亮晶晶的']),
    pumpkin: Object.freeze(['抱住我的小南瓜', '南瓜也软乎乎', '和小南瓜贴贴', '这颗可爱收好啦'])
  }),
  christmas: Object.freeze({
    gift: Object.freeze(['小礼物，送给你', '拆开一点小惊喜', '暖暖心意装好啦', '这份可爱请收下']),
    scarf: Object.freeze(['小围巾裹好啦', '把暖和留一点', '围巾软软，刚刚好', '咩，暖到耳朵啦']),
    snow: Object.freeze(['小雪花落下来啦', '接住一朵小雪花', '给你看看亮晶晶', '雪花在蹄尖歇歇'])
  }),
  'spring-festival': SHEEP_SPRING_ACTION_PHRASES
});
const DIRECT_EVENTS = new Set(['hello', 'pet', 'drag', 'drop', 'play', 'thought']);
const PRIORITY = { work: 0, hello: 1, welcome: 2, wake: 2, sleep: 2, pet: 3, drag: 3, drop: 3, play: 3, thought: 3 };
const PLAY_ACTIONS = Object.freeze([
  Object.freeze({ id: 'again', label: '再来一次' }),
  Object.freeze({ id: 'rest', label: '你歇会儿' })
]);
const TEN_MINUTES = 600000;
const CODEX_TONES = new Set(['normal', 'strong', 'urgent']);
const codexTone = value => CODEX_TONES.has(value) ? value : 'normal';

function validCodexText(text) {
  if (typeof text !== 'string' || Array.from(text).length > 48) return false;
  const lines = text.split('\n');
  return lines.length <= 2 && lines.every(line => line.trim());
}

function validCodexDetail(alert) {
  const text = alert.detailText;
  return text === undefined || (['waiting', 'completed', 'failed'].includes(alert.kind) && typeof text === 'string' &&
    text.length <= 10000 && text.trim().length > 0 && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(text));
}

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

  offerUpdate(version, nowMs) {
    if (!this.enabled || !Number.isFinite(nowMs) || typeof version !== 'string' || version.length > 64 ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
    this._expire(nowMs);
    if (this._current) return null;
    const id = this._nextId++, durationMs = 10000;
    const actions = [{ id: 'app-update-open', label: '查看更新' }, { id: 'app-update-dismiss', label: '稍后再说' }];
    this._current = { id, event: 'app-update', version, actions, priority: -1, expiresAt: nowMs + durationMs };
    this._lastBubbleAt = nowMs;
    return { id, text: `球球有新版本 ${version}`, actions: actions.map(action => ({ ...action })), durationMs };
  }

  offerCodex(alert, nowMs, durationMs = 8000) {
    if (!this.enabled || !Number.isFinite(nowMs) || !Number.isFinite(durationMs) || durationMs <= 0 ||
      !Number.isSafeInteger(alert?.id) || !Number.isSafeInteger(alert.generation) ||
      !['waiting', 'completed', 'failed', 'quota'].includes(alert.kind) ||
      !validCodexText(alert.text) || !validCodexDetail(alert) || !Array.isArray(alert.taskIds)) return null;
    this._expire(nowMs);
    if (this._current) return null;
    const actions = [];
    const descriptors = {};
    const descriptor = type => ({ scope: 'alert', type, generation: alert.generation, alertId: alert.id });
    if (alert.taskIds.length === 1) {
      actions.push({ id: 'codex-open', label: '去看看' });
      descriptors['codex-open'] = { ...descriptor('open-task'), taskId: alert.taskIds[0] };
    } else if (alert.taskIds.length > 1) {
      actions.push({ id: 'codex-results', label: '查看结果' });
      descriptors['codex-results'] = descriptor('show-results');
    }
    actions.push({ id: 'codex-dismiss', label: '知道啦' });
    descriptors['codex-dismiss'] = descriptor('dismiss');
    const id = this._nextId++;
    durationMs = Math.min(12000, durationMs);
    const tone = codexTone(alert.severity);
    this._current = { id, event: 'codex', sourceAlertId: alert.id, sourceGeneration: alert.generation,
      priority: -1, tone, actions, descriptors, expiresAt: nowMs + durationMs };
    this._lastBubbleAt = nowMs;
    return { id, text: alert.detailText ?? alert.text, tone, actions: actions.map(action => ({ ...action })), durationMs };
  }

  updateCodex(alert, nowMs) {
    if (!Number.isFinite(nowMs)) return null;
    this._expire(nowMs);
    if (this._current?.event !== 'codex' || this._current.sourceAlertId !== alert?.id ||
      this._current.sourceGeneration !== alert?.generation || !validCodexText(alert?.text) || !validCodexDetail(alert)) return null;
    const tone = codexTone(alert.severity);
    this._current.tone = tone;
    return {
      id: this._current.id,
      text: alert.detailText ?? alert.text,
      tone,
      actions: this._current.actions.map(action => ({ ...action })),
      durationMs: this._current.expiresAt - nowMs
    };
  }

  offer(request, nowMs, context = {}) {
    const motion = request && typeof request === 'object' ? request.motion : null;
    const event = typeof request === 'string' ? request : request?.event;
    const actionPhrases = SHEEP_ACTION_PHRASES[context.sheepTheme || 'none'];
    const sheepAction = event === 'play' && context.shape === 'new-year-sheep' &&
      SheepSkin.supportsAction(context.sheepAction, context.sheepTheme) ? context.sheepAction : null;
    if (typeof request !== 'string' && (event !== 'play' || !getMotion(motion))) return null;
    if (!this.enabled || !Number.isFinite(nowMs) || typeof event !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PHRASES, event)) return null;
    this._expire(nowMs);
    if (DIRECT_EVENTS.has(event)) this.dismissCodex();
    // 新的直接互动即使遇到六秒冷却，也不能留下已被取代的动作专属文案。
    if (DIRECT_EVENTS.has(event) && this._current?.event === 'play' &&
      ((motion || this._current.motion) && motion !== this._current.motion ||
        (sheepAction || this._current.sheepAction) && sheepAction !== this._current.sheepAction)) this.dismiss();
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

    const sheep = context?.shape === 'new-year-sheep';
    const sheepTheme = sheep && ['halloween', 'christmas', 'spring-festival'].includes(context?.sheepTheme) ? context.sheepTheme : 'none';
    let phrases = sheepAction && actionPhrases?.[sheepAction] ? actionPhrases[sheepAction] : motion ? (sheep ? SHEEP_MOTION_PHRASES : MOTION_PHRASES)[motion] : (sheep ? SHEEP_PHRASES : PHRASES)[event];
    if (!sheepAction && sheepTheme !== 'none' && ['hello', 'pet', 'play'].includes(event)) {
      const holiday = SHEEP_HOLIDAY_PHRASES[sheepTheme];
      phrases = motion ? [...holiday.slice(0, 2), ...phrases.slice(0, 2)] : [...holiday, ...phrases.slice(0, 3)];
    }
    const phraseKey = `${sheep ? `new-year-sheep:${sheepTheme}:` : ''}${sheepAction ? `play:${sheepAction}` : motion ? `play:${motion}` : event}`;
    const randomValue = this._random();
    let index = Number.isFinite(randomValue) ? Math.max(0, Math.min(phrases.length - 1, Math.floor(randomValue * phrases.length))) : 0;
    if (index === this._lastPhrase.get(phraseKey)) index = (index + 1) % phrases.length;
    this._lastPhrase.set(phraseKey, index);

    const id = this._nextId++;
    const durationMs = event === 'play' ? 8000 : 4000;
    const actions = event === 'play' ? PLAY_ACTIONS : [];
    this._current = { id, event, motion, sheepAction, actions, priority: PRIORITY[event], expiresAt: nowMs + durationMs };
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
    const updateVersion = this._current.event === 'app-update' ? this._current.version : null;
    const motion = this._current.motion;
    const sheepAction = this._current.sheepAction;
    this.dismiss();
    if (updateVersion) return { command: 'app-update', version: updateVersion, open: action === 'app-update-open' };
    if (descriptor) return { command: 'codex', descriptor: { ...descriptor } };
    if (action === 'rest') this._workQuietUntil = nowMs + TEN_MINUTES;
    if (action === 'again' && sheepAction) return { command: 'sheep-action', action: sheepAction };
    return action === 'again' && motion ? { command: 'again', motion } : action;
  }
}
module.exports = { PHRASES, DialogueDirector };
