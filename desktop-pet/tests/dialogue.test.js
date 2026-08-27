const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PHRASES, DialogueDirector } = require('../lib/dialogue');

const events = ['hello', 'pet', 'drag', 'drop', 'welcome', 'work', 'play', 'sleep'];

for (const motion of ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']) {
  test(`${motion}专属气泡有两句且再来一次绑定原动作`, () => {
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
    assert.ok(PHRASES[event].every(text => !/睡|眠|眯|晚安/.test(text)), event);
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
