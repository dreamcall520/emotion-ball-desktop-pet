const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PHRASES, DialogueDirector } = require('../lib/dialogue');
const { completionText } = require('../lib/codex-text');

const events = ['hello', 'pet', 'drag', 'drop', 'welcome', 'wake', 'thought', 'work', 'play', 'sleep'];

const codexAlert = (overrides = {}) => ({ id: 7, generation: 2, kind: 'completed',
  text: '这轮有结果啦，去看看？', taskIds: ['11111111-1111-4111-8111-111111111111'], ...overrides });

test('新版气泡复用对白编号和按钮权限，过期、关闭、已被替换的按钮失效', () => {
  const director = new DialogueDirector();
  assert.equal(director.offerUpdate('https://untrusted.invalid/', 0), null);
  const first = director.offerUpdate('0.3.27', 0);
  assert.equal(director.offerUpdate('0.3.27', 1), null, '不抢占当前气泡');
  assert.equal(director.respond(first.id + 1, 'app-update-open', 2), null);
  assert.equal(director.respond(first.id, 'codex-open', 3), null);
  assert.deepEqual(director.respond(first.id, 'app-update-open', 4), { command: 'app-update', version: '0.3.27', open: true });
  assert.equal(director.respond(first.id, 'app-update-open', 5), null);
  const dismissed = director.offerUpdate('0.3.27', 10);
  assert.deepEqual(director.respond(dismissed.id, 'app-update-dismiss', 11), { command: 'app-update', version: '0.3.27', open: false });
  const expired = director.offerUpdate('0.3.27', 20);
  assert.equal(director.respond(expired.id, 'app-update-open', 10020), null);
  const replaced = director.offerUpdate('0.3.27', 10021);
  assert.ok(director.offer('hello', 10022));
  assert.equal(director.respond(replaced.id, 'app-update-open', 10023), null);
  director.setEnabled(false);
  assert.equal(director.offerUpdate('0.3.27', 20000), null);
});

test('Codex 气泡共享编号，只返回受控且绑定提醒的操作', () => {
  const director = new DialogueDirector();
  assert.equal(typeof director.offerCodex, 'function');
  const first = director.offerCodex(codexAlert(), 0);
  assert.equal(first.durationMs, 8000);
  assert.deepEqual(first.actions, [{ id: 'codex-open', label: '去看看' }, { id: 'codex-dismiss', label: '知道啦' }]);
  assert.equal(director.respond(first.id, 'again', 100), null);
  assert.deepEqual(director.respond(first.id, 'codex-open', 100), { command: 'codex', descriptor: {
    scope: 'alert', type: 'open-task', generation: 2, alertId: 7, taskId: codexAlert().taskIds[0] } });
  assert.equal(director.respond(first.id, 'codex-open', 101), null);
  assert.ok(director.offer('hello', 102).id > first.id);
});

test('普通气泡优先，直接互动即使冷却也撤销 Codex 按钮', () => {
  const director = new DialogueDirector();
  assert.equal(typeof director.offerCodex, 'function');
  const ordinary = director.offer('play', 0);
  assert.equal(director.offerCodex(codexAlert(), 100), null);
  assert.equal(director.dismissCodex(), false);
  assert.equal(director.respond(ordinary.id, 'rest', 200), 'rest');
  const alert = director.offerCodex(codexAlert(), 300);
  assert.equal(director.offer('hello', 400), null, '原直接互动冷却不变');
  assert.equal(director.hasBubble(400), false);
  assert.equal(director.respond(alert.id, 'codex-open', 401), null);
});

test('Codex 多任务、额度、过期与关闭不混入普通对白状态', () => {
  const director = new DialogueDirector();
  assert.equal(typeof director.offerCodex, 'function');
  const multi = director.offerCodex(codexAlert({ taskIds: ['a', 'b'] }), 0);
  assert.deepEqual(multi.actions, [
    { id: 'codex-results', label: '查看结果' }, { id: 'codex-dismiss', label: '知道啦' }
  ]);
  assert.equal(director.respond(multi.id, 'codex-list', 100), null);
  assert.deepEqual(director.respond(multi.id, 'codex-results', 100), { command: 'codex', descriptor: {
    scope: 'alert', type: 'show-results', generation: 2, alertId: 7
  } });
  const quota = director.offerCodex(codexAlert({ kind: 'quota', text: '额度剩余 10%\n详情见 Codex 状态', taskIds: [] }), 8000, 500);
  assert.equal(quota.durationMs, 500);
  assert.deepEqual(quota.actions, [{ id: 'codex-dismiss', label: '知道啦' }]);
  director.setEnabled(false);
  assert.equal(director.respond(quota.id, 'codex-dismiss', 8001), null);
  assert.equal(director.offerCodex(codexAlert(), 8002), null);
  director.setEnabled(true);
  assert.equal(director.offerCodex(codexAlert({ text: null }), 8003), null);
  assert.equal(director.offerCodex(codexAlert({ text: '一\n二\n三' }), 8004), null);
  assert.ok(director.offer('play', 8005));
});

test('Codex 额度提醒保留普通、强提醒和紧急层级及六或十二秒时长', () => {
  for (const [severity, durationMs] of [['normal', 6000], ['strong', 12000], ['urgent', 12000]]) {
    const director = new DialogueDirector();
    const result = director.offerCodex(codexAlert({ kind: 'quota', severity, taskIds: [] }), 0, durationMs);
    assert.equal(result.durationMs, durationMs);
    assert.equal(result.tone, severity);
    const updated = director.updateCodex(codexAlert({ kind: 'quota', severity, taskIds: [] }), 1000);
    assert.equal(updated.durationMs, durationMs - 1000);
    assert.equal(updated.tone, severity);
  }
  const safe = new DialogueDirector().offerCodex(codexAlert({ severity: '<script>' }), 0, 12000);
  assert.equal(safe.tone, 'normal');
});

test('当前 Codex 气泡原位更新文案且不延长时限', () => {
  const director = new DialogueDirector({ now: 0 });
  const first = director.offerCodex(codexAlert({ text: '《任务A》有结果啦\n去看看？' }), 1000, 8000);
  const originalActions = first.actions.map(item => ({ ...item }));
  const updated = director.updateCodex(codexAlert({ text: '这轮有结果啦，去看看？' }), 2000);
  assert.equal(updated.id, first.id);
  assert.equal(updated.text, '这轮有结果啦，去看看？');
  assert.equal(updated.durationMs, 7000);
  assert.deepEqual(updated.actions, originalActions);
  updated.actions.push({ id: 'forged', label: '伪造' });
  assert.deepEqual(director.respond(first.id, 'codex-open', 2001)?.descriptor, {
    scope: 'alert', type: 'open-task', generation: 2, alertId: 7, taskId: codexAlert().taskIds[0]
  });
});

test('Codex 气泡更新拒绝错提醒、错代次、过期、非法文案和普通气泡且不污染状态', () => {
  const invalid = [
    codexAlert({ id: 8 }), codexAlert({ generation: 3 }), codexAlert({ text: '' }),
    codexAlert({ text: '一\n二\n三' }), codexAlert({ text: '长'.repeat(49) })
  ];
  for (const alert of invalid) {
    const director = new DialogueDirector();
    const first = director.offerCodex(codexAlert(), 0, 8000);
    assert.equal(director.updateCodex(alert, 100), null);
    assert.deepEqual(director.respond(first.id, 'codex-open', 101)?.descriptor.taskId, codexAlert().taskIds[0]);
  }
  const expired = new DialogueDirector();
  expired.offerCodex(codexAlert(), 0, 8000);
  assert.equal(expired.updateCodex(codexAlert(), 8000), null);
  assert.equal(expired.hasBubble(8000), false);
  const ordinary = new DialogueDirector();
  const first = ordinary.offer('play', 0);
  assert.equal(ordinary.updateCodex(codexAlert(), 100), null);
  assert.equal(ordinary.respond(first.id, 'again', 101), 'again');
});

test('18个 emoji 任务名生成的合并文案按 Unicode 字符通过气泡校验', () => {
  const text = completionText(['😀'.repeat(18), '任务B'], 2, true);
  assert.ok(Array.from(text).length <= 48);
  assert.ok(text.length > 48, '该用例必须暴露 UTF-16 长度误判');
  const director = new DialogueDirector();
  assert.ok(director.offerCodex(codexAlert({ text, taskIds: ['a', 'b'] }), 0));
});

for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) {
  test(`${motion}专属气泡保留旧词且再来一次绑定原动作`, () => {
    const director = new DialogueDirector({ random: () => 0 });
    const first = director.offer({ event: 'play', motion }, 0);
    assert.ok(first, '动作应有专属气泡');
    assert.equal(first.durationMs, 8000);
    assert.equal(first.actions.length, 2);
    assert.doesNotMatch(first.text, /睡|眠|眯|晚安/);
    assert.deepEqual(director.respond(first.id, 'again', 100), { command: 'again', motion });
    assert.equal(director.respond(first.id, 'again', 101), null);
    const second = director.offer({ event: 'play', motion }, 6000);
    assert.notEqual(first.text, second.text);
    assert.equal(director.respond(second.id, 'again', 14000), null);
  });
}

test('冷却期切换动作会收起旧动作气泡并使旧按钮失效', () => {
  const director = new DialogueDirector();
  const first = director.offer({ event: 'play', motion: 'hop' }, 0);
  assert.ok(first);
  assert.equal(director.hasBubble(10), true);
  assert.equal(director.offer({ event: 'play', motion: 'bow' }, 100), null);
  assert.equal(director.hasBubble(100), false);
  assert.equal(director.respond(first.id, 'again', 101), null);
  assert.ok(director.offer({ event: 'play', motion: 'bow' }, 6000));
});

for (const event of ['hello', 'pet', 'drag', 'drop']) {
  test(`${event}新互动遇到冷却也会使旧专属play失效，但不改变普通play`, () => {
    const director = new DialogueDirector();
    const first = director.offer({ event: 'play', motion: 'hop' }, 0);
    assert.ok(first);
    assert.equal(director.offer(event, 100), null, '保留六秒冷却');
    assert.equal(director.hasBubble(100), false, '不能留下已被新互动取代的动作专属气泡');
    assert.equal(director.respond(first.id, 'again', 101), null);
    assert.equal(director.offer(event, 5999), null);
    assert.ok(director.offer(event, 6000), '冷却基准不因拒绝事件而延长');

    const generic = new DialogueDirector();
    const ordinary = generic.offer('play', 0);
    assert.equal(generic.offer(event, 100), null);
    assert.equal(generic.hasBubble(100), true, '原通用气泡兼容行为不变');
    assert.equal(generic.respond(ordinary.id, 'again', 101), 'again');
  });
}

test('未知动作对象不占冷却，通用play兼容且不能留下错配专属文案', () => {
  const director = new DialogueDirector();
  for (const motion of ['unknown', '__proto__', null, 1]) assert.equal(director.offer({ event: 'play', motion }, 0), null);
  const first = director.offer({ event: 'play', motion: 'hop' }, 0);
  assert.ok(first);
  assert.equal(director.offer('play', 10), null);
  assert.equal(director.hasBubble(10), false);
  const generic = director.offer('play', 6000);
  assert.equal(director.respond(generic.id, 'again', 6100), 'again');
});

test('对白规则模块存在', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../lib/dialogue.js')), true);
});

test('每个场景至少有三句不同的短中文', () => {
  assert.deepEqual(Object.keys(PHRASES).sort(), [...events].sort());
  for (const event of events) {
    assert.ok(new Set(PHRASES[event]).size >= 3, event);
    assert.ok(PHRASES[event].every(text => typeof text === 'string' && /[\u4e00-\u9fff]/u.test(text) && text.length <= 24));
  }
});

test('日常互动每个场景至少八句，清醒对白不再混入睡觉文案', () => {
  for (const event of events.filter(value => value !== 'sleep')) {
    assert.ok(new Set(PHRASES[event]).size >= 8, `${event} 需要更多日常回应`);
    if (event !== 'wake') {
      // 摸头时眯眼是放松回应，仍禁止混入入睡文案。
      const sleeping = event === 'pet' ? /睡|眠|晚安/ : /睡|眠|眯|晚安/;
      assert.ok(PHRASES[event].every(text => !sleeping.test(text)), event);
    }
  }
});

test('新增摸头与唤醒文案只描述对应动作，普通欢迎不混入刚醒来的状态', () => {
  assert.ok(PHRASES.pet.includes('摸得我眯起眼啦。'));
  assert.ok(PHRASES.wake.includes('睡意跑掉，我醒啦。'));
  assert.ok(PHRASES.welcome.every(text => !/睡|醒|眯/.test(text)));
  for (const event of events) assert.equal(new Set(PHRASES[event]).size, PHRASES[event].length, event);
});

test('用户主动查询的思考文案沿用六秒节流并与工作陪伴分开', () => {
  const director = new DialogueDirector({ random: () => 0 });
  const first = director.offer('thought', 0);
  assert.ok(PHRASES.thought.includes(first.text));
  assert.equal(director.offer('thought', 5999), null);
  assert.notEqual(director.offer('thought', 6000).text, first.text);
  assert.equal(director.offer('work', 10000), null, '新增词库不缩短主动陪伴的十分钟限制');
});

test('六种双击动作各保留两句并追加两句可选择且不连着重复', () => {
  for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) {
    const texts = new Set();
    for (let index = 0; index < 4; index++) {
      const director = new DialogueDirector({ random: () => index / 4 });
      texts.add(director.offer({ event: 'play', motion }, 0).text);
    }
    assert.equal(texts.size, 4, motion);
  }
});

test('羊年皮肤的十种场景共有112句专属短语，普通皮肤维持原词库', () => {
  const all = new Set();
  for (const event of events) {
    const texts = new Set();
    const count = event === 'work' ? 40 : 8;
    for (let index = 0; index < count; index++) {
      const makeDirector = () => new DialogueDirector({ random: () => index / count, now: -600000 });
      const ordinary = makeDirector().offer(event, 0);
      const themed = makeDirector().offer(event, 0, { shape: 'new-year-sheep' });
      assert.ok(themed, event);
      assert.ok(!PHRASES[event].includes(themed.text), `${event} 应使用羊年词库`);
      assert.deepEqual({ ...themed, text: ordinary.text }, ordinary, '仅替换文字，气泡编号、时长和按钮不变');
      for (const shape of ['sphere', 'aurora-cloud', 'unknown']) {
        assert.deepEqual(makeDirector().offer(event, 0, { shape }), ordinary, shape);
      }
      texts.add(themed.text);
      all.add(themed.text);
    }
    assert.equal(texts.size, event === 'work' ? 40 : 8, event);
  }
  assert.equal(all.size, 112);
});

test('日常咩咩完整112句短语全局唯一，与节日和专属动作不重复，场景不串台', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/dialogue.js'), 'utf8');
  const pools = vm.runInNewContext(`${source.slice(source.indexOf('const SHEEP_PHRASES ='), source.indexOf('const DIRECT_EVENTS ='))}
    ({daily:SHEEP_PHRASES,motion:SHEEP_MOTION_PHRASES,holiday:SHEEP_HOLIDAY_PHRASES,spring:SHEEP_SPRING_ACTION_PHRASES})`);
  assert.deepEqual(Object.keys(pools.daily).sort(), [...events].sort());
  for (const text of ['和你待着就很好','思路可以慢慢理','给你留一点空白']) assert.ok(pools.daily.work.includes(text), '保留用户认可的陪伴语气');
  assert.ok(pools.daily.work.filter(text => Array.from(text).length >= 5 && Array.from(text).length <= 10).length >= Math.ceil(pools.daily.work.length * .8), '工作陪伴以5到10字为主');
  for (const text of pools.daily.work) assert.doesNotMatch(text, /羊毛软|脚步轻|小铃铛静音|一小团暖|敲代码|读文档/, '不写无场景装饰或假设具体工作内容');
  const all = Object.values(pools.daily).flat();
  assert.equal(all.length, 112);
  assert.equal(new Set(all).size, 112, '不同日常场景也不能重复');
  const reserved = new Set([pools.motion, pools.holiday, pools.spring].flatMap(pool => Object.values(pool).flat()));
  for (const [event, phrases] of Object.entries(pools.daily)) {
    assert.equal(phrases.length, event === 'work' ? 40 : 8, event);
    for (const text of phrases) {
      assert.ok(Array.from(text).length >= 4 && Array.from(text).length <= 12, `${event}: ${text}`);
      assert.ok(!reserved.has(text), `${event} 不能复用节日或专属动作句子`);
      if (['work', 'thought'].includes(event)) assert.doesNotMatch(text, /完成|成功|做好|办妥|修好|很快|马上|已经结束/, '陪伴与进行中不能伪称任务完成或承诺时间');
      if (event === 'welcome') assert.doesNotMatch(text, /睡|醒|困|眯/, '用户回来不等同于小羊睡醒');
      if (event === 'drag') assert.doesNotMatch(text, /落稳|落地|放好|站稳/, '拖动回应发生在放下之前');
      if (event === 'drop') assert.doesNotMatch(text, /悬着|离地|抱起来|出发/, '放下回应不能继续悬空');
    }
  }
});

test('羊年皮肤六种玩耍动作各有四句对应专属短语，重复按钮保留动作', () => {
  for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) {
    const texts = new Set();
    for (let index = 0; index < 4; index++) {
      const director = new DialogueDirector({ random: () => index / 4 });
      const request = { event: 'play', motion };
      const result = director.offer(request, 0, { shape: 'new-year-sheep' });
      const ordinary = new DialogueDirector({ random: () => index / 4 }).offer(request, 0);
      assert.notEqual(result.text, ordinary.text);
      assert.deepEqual(request, { event: 'play', motion }, '不改写调用者的动作请求');
      assert.deepEqual(director.respond(result.id, 'again', 1), { command: 'again', motion });
      assert.equal(director.respond(result.id, 'again', 2), null, '按钮使用后仍失效');
      texts.add(result.text);
    }
    assert.equal(texts.size, 4, motion);
  }
});

test('羊年对白避让上一句，切换皮肤时分别记忆并保持六秒冷却', () => {
  for (const request of ['hello', { event: 'play', motion: 'bow' }]) {
    const director = new DialogueDirector({ random: () => 0 });
    const sheep = { shape: 'new-year-sheep' };
    const first = director.offer(request, 0, sheep);
    assert.equal(director.offer(request, 5999, sheep), null);
    const ordinary = director.offer(request, 8000, { shape: 'sphere' });
    assert.ok(ordinary);
    const second = director.offer(request, 16000, sheep);
    assert.notEqual(second.text, first.text, '回到羊年皮肤时仍避让上次羊年对白');
    const nextOrdinary = director.offer(request, 24000);
    assert.notEqual(nextOrdinary.text, ordinary.text, '普通词库也分别避让');
  }
});

test('羊年对白保留拖放接续、安静陪伴节流和禁用权限', () => {
  const director = new DialogueDirector({ random: () => 0 });
  const sheep = { shape: 'new-year-sheep' };
  assert.ok(director.offer('drag', 0, sheep));
  assert.ok(director.offer('drop', 100, sheep));
  assert.equal(director.offer('drop', 200, sheep), null);
  assert.equal(director.offer('work', 599999, sheep), null);
  assert.ok(director.offer('work', 600000, sheep));
  assert.equal(director.offer('work', 1199999, sheep), null);
  director.setEnabled(false);
  assert.equal(director.offer('hello', 1200000, sheep), null);
  assert.equal(director.offer({ event: 'play', motion: 'unknown' }, 1200000, sheep), null);
});

test('默认小羊对白不预设节日与额外道具，动作回应不描述未制作的跳跃福字', () => {
  const seasonal = /春节|新年|拜年|年味|过年|暖年|围巾|福字|红包|这张福|南瓜|糖果|小巫师|圣诞|冬青/;
  for (const event of events) for (let index = 0; index < 8; index++) {
    const offer = sheepTheme => new DialogueDirector({ random: () => index / 8, now: -600000 })
      .offer(event, 0, { shape: 'new-year-sheep', sheepTheme });
    const ordinarySheep = offer('none');
    assert.ok(!seasonal.test(ordinarySheep.text), ordinarySheep.text);
    for (const sheepTheme of [undefined, 'auto', 'unknown', '__proto__', null]) {
      assert.deepEqual(offer(sheepTheme), ordinarySheep, '只接受已解析的节日结果，其他模式回到中性对白');
    }
  }
  for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) for (let index = 0; index < 4; index++) {
    const result = new DialogueDirector({ random: () => index / 4 })
      .offer({ event: 'play', motion }, 0, { shape: 'new-year-sheep', sheepTheme: 'none' });
    assert.ok(!seasonal.test(result.text), result.text);
    assert.ok(!/跳|蹦|跃|起飞|转圈|放大|缩小|捧福/.test(result.text), result.text);
  }
});

test('已解析的万圣、圣诞和春节主题穿插对应互动语，安静工作与睡眠保持中性', () => {
  const themeWords = { halloween: /糖果|小巫师|披肩|南瓜|戴帽子/, christmas: /圣诞|围巾|帽尖|冬青|暖暖的梦/,
    'spring-festival': /拜年|新年|春节|过年|新的一年/ };
  for (const [sheepTheme, words] of Object.entries(themeWords)) {
    for (const event of ['hello', 'pet', 'play']) {
      const texts = [];
      for (let index = 0; index < 8; index++) {
        const result = new DialogueDirector({ random: () => index / 8 }).offer(event, 0, { shape: 'new-year-sheep', sheepTheme });
        texts.push(result.text);
      }
      assert.equal(new Set(texts).size, 8);
      assert.equal(texts.filter(text => words.test(text)).length, 5, `${sheepTheme}:${event} 包含5句对应节日短语与3句中性陪伴语`);
      for (const [otherTheme, otherWords] of Object.entries(themeWords)) {
        if (otherTheme !== sheepTheme) assert.ok(texts.every(text => !otherWords.test(text)), '不串入另一节日');
      }
    }
    for (const event of ['work', 'sleep']) for (let index = 0; index < 8; index++) {
      const make = () => new DialogueDirector({ random: () => index / 8, now: -600000 });
      assert.deepEqual(make().offer(event, 0, { shape: 'new-year-sheep', sheepTheme }),
        make().offer(event, 0, { shape: 'new-year-sheep', sheepTheme: 'none' }));
    }
    for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) {
      const texts = [];
      for (let index = 0; index < 4; index++) {
        const result = new DialogueDirector({ random: () => index / 4 }).offer({ event: 'play', motion }, 0, { shape: 'new-year-sheep', sheepTheme });
        texts.push(result.text);
      }
      assert.equal(new Set(texts).size, 4);
      assert.equal(texts.filter(text => words.test(text)).length, 2, '带动作的玩耍也能命中节日短语，保留四句池');
    }
    for (const shape of ['blob', 'aurora-cloud', 'codex-pet']) {
      assert.deepEqual(new DialogueDirector({ random: () => 0 }).offer('hello', 0, { shape, sheepTheme }),
        new DialogueDirector({ random: () => 0 }).offer('hello', 0), '其他形态不受小羊主题影响');
    }
  }
});

test('默认、万圣、圣诞、春节分别记忆上一句，跨主题不占用彼此的重复避让', () => {
  for (const request of ['hello', { event: 'play', motion: 'bow' }]) {
    const director = new DialogueDirector({ random: () => 0 });
    const first = new Map();
    for (const [index, sheepTheme] of ['none', 'halloween', 'christmas', 'spring-festival'].entries()) {
      const context = { shape: 'new-year-sheep', sheepTheme };
      const result = director.offer(request, index * 8000, context);
      first.set(sheepTheme, result.text);
      assert.equal(result.text, new DialogueDirector({ random: () => 0 }).offer(request, 0, context).text,
        '第一次进入该主题时应从独立词库选择首句');
    }
    for (const [index, sheepTheme] of ['none', 'halloween', 'christmas', 'spring-festival'].entries()) {
      const result = director.offer(request, (index + 4) * 8000, { shape: 'new-year-sheep', sheepTheme });
      assert.notEqual(result.text, first.get(sheepTheme), `再次回到${sheepTheme}时避让该主题自己的上一句`);
    }
  }
});

test('普通气泡四秒并输出约定字段', () => {
  for (const event of events.filter(value => value !== 'play')) {
    const director = new DialogueDirector({ random: () => 0, now: -600000 });
    const result = director.offer(event, 0);
    assert.ok(result, event);
    assert.deepEqual(Object.keys(result).sort(), ['id', 'text', 'actions', 'durationMs'].sort());
    assert.equal(result.id, 1);
    assert.equal(result.durationMs, 4000);
    assert.deepEqual(result.actions, []);
    assert.ok(PHRASES[event].includes(result.text));
  }
});

test('玩耍气泡八秒且只有两个确定动作', () => {
  const result = new DialogueDirector().offer('play', 0);
  assert.ok(result);
  assert.equal(result.durationMs, 8000);
  assert.deepEqual(result.actions, [
    { id: 'again', label: '再来一次' }, { id: 'rest', label: '你歇会儿' }
  ]);
});

test('直接互动共同遵守六秒节流且拒绝不消耗编号', () => {
  const director = new DialogueDirector();
  assert.equal(director.offer('pet', 0)?.id, 1);
  assert.equal(director.offer('play', 5999), null);
  assert.equal(director.offer('play', 6000)?.id, 2);
});

test('拖起到放下仅允许一次连贯替换', () => {
  const director = new DialogueDirector();
  assert.equal(director.offer('drag', 0)?.id, 1);
  assert.equal(director.offer('drop', 100)?.id, 2);
  assert.equal(director.offer('drop', 200), null);
  assert.equal(director.offer('play', 6099), null);
  assert.equal(director.offer('play', 6100)?.id, 3);
});

test('拖动超过四秒后落地仍能接上一次回应', () => {
  for (const at of [4000, 4500, 5999]) {
    const director = new DialogueDirector();
    assert.ok(director.offer('drag', 0));
    assert.ok(director.offer('drop', at));
    assert.equal(director.offer('drop', at + 1), null);
  }
});

test('欢迎不覆盖用户互动，睡眠切换会收起当前互动', () => {
  const director = new DialogueDirector();
  assert.ok(director.offer('pet', 0));
  assert.equal(director.offer('welcome', 1000), null);
  assert.ok(director.offer('sleep', 2000));
  assert.ok(director.offer('welcome', 4000));
  assert.ok(director.offer('sleep', 4100));
});

test('普通招呼即使节流已过也不能盖住玩耍气泡', () => {
  const director = new DialogueDirector();
  assert.ok(director.offer('play', 0));
  assert.equal(director.offer('hello', 6000), null);
  assert.ok(director.offer('hello', 8000));
});

test('主动工作对白至少等启动十分钟并间隔十分钟', () => {
  const director = new DialogueDirector({ now: 123000 });
  assert.equal(director.offer('work', 722999), null);
  assert.ok(director.offer('work', 723000));
  assert.equal(director.offer('work', 1322999), null);
  assert.ok(director.offer('work', 1323000));
});

test('任意气泡后十五秒内不主动说话', () => {
  const director = new DialogueDirector();
  assert.ok(director.offer('hello', 590000));
  assert.equal(director.offer('work', 600000), null);
  assert.equal(director.offer('work', 604999), null);
  assert.ok(director.offer('work', 605000));
});

test('主动工作对白不覆盖当前气泡', () => {
  const director = new DialogueDirector();
  assert.ok(director.offer('play', 600000));
  assert.equal(director.offer('work', 600001), null);
  assert.equal(director.offer('work', 607999), null);
});

test('固定随机数时每个场景也不会连续重复', () => {
  for (const event of events) {
    const director = new DialogueDirector({ random: () => 0, now: -600000 });
    const texts = [0, 600000, 1200000].map(now => director.offer(event, now)?.text);
    assert.ok(texts.every(Boolean), event);
    assert.notEqual(texts[0], texts[1], event);
    assert.notEqual(texts[1], texts[2], event);
  }
});

test('未知事件不生成气泡也不占用节流', () => {
  const director = new DialogueDirector();
  for (const event of ['unknown', '__proto__', 'constructor', '', null, { toString: () => 'play' }]) {
    assert.equal(director.offer(event, 0), null);
  }
  assert.equal(director.offer('hello', 0)?.id, 1);
});

test('按钮仅对当前气泡有效且只能回应一次', () => {
  const director = new DialogueDirector();
  const first = director.offer('play', 0);
  assert.ok(first);
  assert.equal(director.respond(first.id + 1, 'again', 1000), null);
  assert.equal(director.respond(first.id, 'unknown', 1000), null);
  assert.equal(director.respond(first.id, 'again', 1000), 'again');
  assert.equal(director.respond(first.id, 'again', 1001), null);
  const next = director.offer('play', 6000);
  assert.ok(next);
  assert.equal(director.respond(first.id, 'rest', 6001), null);
  assert.equal(director.respond(next.id, 'rest', 6001), 'rest');
});

test('气泡到期时旧按钮失效', () => {
  const director = new DialogueDirector();
  const result = director.offer('play', 0);
  assert.ok(result);
  assert.equal(director.respond(result.id, 'again', 8000), null);
});

test('进入睡眠时收起玩耍按钮，旧回应不能再打扰睡眠', () => {
  const director = new DialogueDirector();
  const play = director.offer('play', 0);
  assert.ok(director.offer('sleep', 100));
  assert.equal(director.respond(play.id, 'again', 200), null);
});

test('返回的气泡不能被外部修改以伪造动作', () => {
  const director = new DialogueDirector();
  const result = director.offer('play', 0);
  assert.ok(result);
  result.actions.push({ id: 'unknown', label: '伪造' });
  assert.equal(director.respond(result.id, 'unknown', 1000), null);
  assert.equal(director.respond(result.id, 'again', 1000), 'again');
});

test('关闭对白和手动关闭都会使当前按钮失效', () => {
  const director = new DialogueDirector({ enabled: false });
  assert.equal(director.offer('play', 0), null);
  director.setEnabled(true);
  const first = director.offer('play', 0);
  assert.ok(first);
  director.dismiss();
  assert.equal(director.respond(first.id, 'again', 100), null);
  const next = director.offer('play', 6000);
  assert.ok(next);
  director.setEnabled(false);
  assert.equal(director.respond(next.id, 'rest', 6100), null);
  assert.equal(director.offer('hello', 12000), null);
});

test('让它歇会儿只抑制主动工作对白十分钟', () => {
  const director = new DialogueDirector();
  const result = director.offer('play', 600000);
  assert.ok(result);
  assert.equal(director.respond(result.id, 'rest', 601000), 'rest');
  assert.ok(director.offer('pet', 606000));
  assert.equal(director.offer('work', 1200999), null);
  assert.ok(director.offer('work', 1201000));
});

test('春节三项互动各用自己的短语，再来一次复播同一动作，普通play不串入道具', () => {
  const words={fortune:/福/,firecrackers:/鞭炮|开门红/,dumplings:/饺子/};
  for(const [sheepAction,word] of Object.entries(words)) {
    for(let index=0;index<4;index++) {
      const director=new DialogueDirector({random:()=>index/4});
      const context={shape:'new-year-sheep',sheepTheme:'spring-festival',sheepAction};
      const result=director.offer('play',0,context); assert.match(result.text,word);
      assert.deepEqual(director.respond(result.id,'again',100),{command:'sheep-action',action:sheepAction});
      for(const theme of ['none','halloween','christmas']) {
        const make=()=>new DialogueDirector({random:()=>index/4});
        assert.deepEqual(make().offer('play',0,{...context,sheepTheme:theme}),
          make().offer('play',0,{shape:'new-year-sheep',sheepTheme:theme}));
      }
    }
  }
  for(let index=0;index<8;index++) {
    const result=new DialogueDirector({random:()=>index/8}).offer('play',0,{shape:'new-year-sheep',sheepTheme:'spring-festival'});
    assert.doesNotMatch(result.text,/饺子|鞭炮|这张|这只/);
  }
  const director=new DialogueDirector({random:()=>0}), context={shape:'new-year-sheep',sheepTheme:'spring-festival'};
  assert.ok(director.offer('play',0,{...context,sheepAction:'fortune'}));
  assert.equal(director.offer('play',100,{...context,sheepAction:'dumplings'}),null);
  assert.equal(director.hasBubble(100),false,'冷却拒绝新气泡也清掉已失效的动作文案');
});

test('三个新增主题动作词库和重播按钮都保留实际动作，不覆盖日常默认词库',()=>{
  const actions={none:['ear','bell','stretch'],halloween:['candy','magic','pumpkin'],christmas:['gift','scarf','snow']};
  for(const [sheepTheme,ids] of Object.entries(actions)) for(const sheepAction of ids) {
    const phrases=new Set();
    for(let i=0;i<4;i++) {
      const d=new DialogueDirector({random:()=>i/4});
      const item=d.offer('play',0,{shape:'new-year-sheep',sheepTheme,sheepAction});
      assert.ok(item); assert.ok(item.text.length<=12,item.text); phrases.add(item.text);
      assert.deepEqual(d.respond(item.id,'again',1),{command:'sheep-action',action:sheepAction});
    }
    assert.equal(phrases.size,4);
  }
});


test('长任务详情只扩展气泡正文，不放宽48字摘要或改变编号、路由和截止时间', () => {
  const detailText = '这一轮有结果啦，去看看？\n《' + '长标题'.repeat(40) + '》';
  const director = new DialogueDirector();
  const first = director.offerCodex(codexAlert({ detailText }), 1000);
  assert.equal(first.text, detailText);
  assert.equal(first.durationMs, 8000);
  const hiddenNames = director.updateCodex(codexAlert(), 2000);
  assert.equal(hiddenNames.text, codexAlert().text, '关闭名称后原位恢复短摘要，不继续暴露旧详情');
  assert.equal(hiddenNames.id, first.id);
  assert.equal(hiddenNames.durationMs, 7000);
  assert.deepEqual(hiddenNames.actions, first.actions);
  const changed = director.updateCodex(codexAlert({ detailText: detailText + '更新' }), 2500);
  assert.equal(changed.text, detailText + '更新');
  assert.equal(changed.durationMs, 6500);
  assert.deepEqual(director.respond(first.id, 'codex-open', 2600)?.descriptor, {
    scope: 'alert', type: 'open-task', generation: 2, alertId: 7, taskId: codexAlert().taskIds[0]
  });
  assert.equal(director.respond(first.id, 'codex-open', 2601), null);
});

test('可选任务详情拒绝非法类型、超长、控制符及额度夹带，摘要白名单保持', () => {
  const invalid = [null, {}, [], true, '', '   ', 'a'.repeat(10001), '正文\u0000标题', '正文\u202e标题'];
  for (const detailText of invalid) {
    const director = new DialogueDirector();
    assert.equal(director.offerCodex(codexAlert({ detailText }), 0), null);
    const first = director.offerCodex(codexAlert(), 0);
    assert.equal(director.updateCodex(codexAlert({ detailText }), 100), null);
    assert.ok(director.respond(first.id, 'codex-open', 101));
  }
  const director = new DialogueDirector();
  assert.equal(director.offerCodex(codexAlert({ kind: 'quota', detailText: '不允许的任务详情' }), 0), null);
  assert.equal(director.offerCodex(codexAlert({ text: '长'.repeat(49), detailText: '看似合法详情' }), 0), null);
  assert.equal(director.offerCodex(codexAlert({ text: '一\n二\n三', detailText: '看似合法详情' }), 0), null);
  assert.equal(director.offerCodex(codexAlert({ detailText: 'a'.repeat(10000) }), 0)?.text.length, 10000);
});
