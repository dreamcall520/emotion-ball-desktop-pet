const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PHRASES, DialogueDirector } = require('../lib/dialogue');
const { completionText } = require('../lib/codex-text');

const events = ['hello', 'pet', 'drag', 'drop', 'welcome', 'wake', 'thought', 'work', 'play', 'sleep'];

const codexAlert = (overrides = {}) => ({ id: 7, generation: 2, kind: 'completed',
  text: '这轮有结果啦，去看看？', taskIds: ['11111111-1111-4111-8111-111111111111'], ...overrides });

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
