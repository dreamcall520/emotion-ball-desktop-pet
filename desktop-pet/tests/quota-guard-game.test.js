const test = require('node:test');
const assert = require('node:assert/strict');
const { GuardGame, primary } = require('../quota-guard-renderer');
const model = (remaining = 64, windowMinutes = 300, fields = {}) => ({ state: 'ready', items: [{ label: 'Codex', remaining, windowMinutes }], visible: true, ...fields });
const elapse = (game, duration) => { for (let time = 0; time < duration; time += 16) game.step(Math.min(16, duration - time)); };

test('真实主周期与额度变更重开，同值刷新、尺寸/主题、隐藏后重开保留同一局', () => {
  const game = new GuardGame(); game.setModel(model()); game.shoot(); elapse(game, 400);
  const first = game.snapshot(); game.setModel(model(64, 300, { size: 'compact', appearance: 'dark' }));
  assert.equal(game.round, first.round); assert.equal(game.time, first.time); assert.equal(game.playerHits, first.playerHits);
  game.setModel(model(64, 300, { visible: false })); elapse(game, 10000); assert.equal(game.time, first.time);
  game.setModel(model()); assert.equal(game.round, first.round); assert.equal(game.time, first.time);
  game.setModel(model(64, 10080)); assert.equal(game.period, 10080); assert.equal(game.time, 0); assert.equal(game.round, first.round + 1);
  game.setModel(model(63, 10080)); assert.equal(game.quota, 63); assert.equal(game.round, first.round + 2);
});

test('已结束对局仅原生关闭后重开自动开始，同值刷新和DOM显隐不重开；未结束暂停局继续保留', () => {
  for (const outcome of ['qiuqiu', 'zombie']) {
    const game = new GuardGame(), source = model(), original = JSON.stringify(source);
    game.setModel(source); game.shoot(); elapse(game, 400); game.finish(outcome); game.paused = true;
    const ended = game.snapshot();
    game.setModel(model(64, 300, { appearance: 'dark' }));
    assert.equal(game.round, ended.round); assert.equal(game.outcome, outcome);
    game.visible = false; game.setModel(source);
    assert.equal(game.round, ended.round, '仅DOM显隐变化不当成原生关闭重开');
    game.setModel(model(64, 300, { visible: false })); elapse(game, 10000);
    assert.equal(game.time, ended.time); assert.equal(game.outcome, outcome);
    game.setModel(model(64, 300, { visible: false })); game.setModel(source);
    assert.equal(game.round, ended.round + 1); assert.equal(game.time, 0);
    assert.equal(game.outcome, null); assert.equal(game.playerHits, 0); assert.equal(game.flight.length, 0);
    assert.equal(game.paused, false); assert.equal(game.quota, 64); assert.equal(JSON.stringify(source), original);
    game.setModel(source); assert.equal(game.round, ended.round + 1, '重开后的重复模型不能再开一局');
  }
  const paused = new GuardGame(); paused.setModel(model()); paused.shoot(); elapse(paused, 400); paused.paused = true;
  const before = paused.snapshot(); paused.setModel(model(64, 300, { visible: false })); paused.setModel(model());
  assert.deepEqual(paused.snapshot(), before, '未结束局的原生关闭重开保持进度和暂停偏好');
  const empty = new GuardGame(); empty.setModel(model(0)); const round = empty.round;
  empty.setModel(model(0, 300, { visible: false })); empty.setModel(model(0));
  assert.equal(empty.round, round); assert.equal(empty.quota, 0); assert.equal(empty.outcome, 'zombie');
});

test('暂停、减少动态和非ready数据冻结时钟、弹丸及胜负；未知不转成零，0初始半球败局', () => {
  const game = new GuardGame(); game.setModel(model()); game.shoot(); game.step(16);
  for (const state of ['paused', 'reduced']) {
    game[state] = true; const before = game.snapshot(); elapse(game, 10000);
    assert.deepEqual(game.snapshot(), before); assert.equal(game.shoot(), false); assert.equal(game.advance(), false); game[state] = false;
  }
  for (const state of ['stale', 'reset-wait', 'disconnected']) {
    const before = game.snapshot(); game.setModel(model(0, 300, { state })); elapse(game, 5000);
    assert.equal(game.time, before.time); assert.equal(game.quota, 64); assert.equal(game.outcome, null); assert.equal(game.shoot(), false);
    game.setModel(model()); assert.equal(game.round, before.round);
  }
  for (const remaining of [NaN, Infinity, -1, 101, '0']) assert.equal(primary(model(remaining)), null);
  game.setModel(model(0)); assert.equal(game.outcome, 'zombie'); assert.equal(game.bite, 1); assert.equal(game.endingProgress, 1); assert.equal(game.shoot(), false);
});

test('自动命中不计胜利；连点提高发射速度和击退，29次手动命中不会赢，第30次赢且真实额度不变', () => {
  const auto = new GuardGame(); auto.setModel(model(100)); elapse(auto, 10000);
  assert(auto.hits > 0); assert.equal(auto.playerHits, 0); assert.equal(auto.outcome, null);
  const game = new GuardGame(); game.setModel(model()); game.advance(); assert(game.drive > 0);
  const records = [];
  for (let time = 0; time < 20000 && !game.ended; time += 130) {
    if (game.shoot()) records.push(game.lastProjectileSpeed);
    for (let dt = 0; dt < 130; dt += 10) {
      game.step(10);
      if (game.playerHits === 29) assert.equal(game.outcome, null);
    }
  }
  assert(records[1] > records[0]); assert.equal(game.outcome, 'qiuqiu'); assert.equal(game.playerHits, 30); assert.equal(game.quota, 64);
  assert(game.recoil === 0); assert.equal(game.flight.length, 0);
  game.reset(); assert.equal(game.playerHits, 0); assert.equal(game.quota, 64); assert.equal(game.outcome, null);
});

test('自由练习使用独立游戏能量，不把WorkBuddy积分当成百分比', () => {
 const game=new GuardGame();game.setModel({state:'ready',practice:true,items:[],visible:true});
 assert.equal(game.available,true);assert.equal(game.quota,100);assert.equal(game.shoot(),true);
 elapse(game,1000);assert(game.shots>0);
 game.setModel(model(100));assert.equal(game.round,2);
 assert.equal(primary({state:'disconnected',practice:true,items:[]}),null);
});
