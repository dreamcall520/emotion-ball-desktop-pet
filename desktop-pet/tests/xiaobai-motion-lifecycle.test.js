const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const helpers = source.slice(source.indexOf('let dogSpriteBounds ='), source.indexOf('function quotaObstacleBounds()'));
function fixture(x = 500) {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  function window(bounds) {
    return { bounds: { ...bounds }, calls: [], messages: [], isDestroyed: () => false,
      getBounds() { return { ...this.bounds }; },
      setBounds(value) { this.bounds = { ...value }; this.calls.push({ ...value }); },
      webContents: { send: (...args) => messages.push(args) } };
  }
  const messages = [], commands = [], pins = [];
  const pet = window({ x, y: 300, width: 120, height: 120 });
  const request = { token: 7, alertId: 9, generation: 2, pageEpoch: 3, action: 'bow', spriteAction: 'spin' };
  const context = vm.createContext({ petWindow: pet, screen: { getDisplayMatching: () => ({ workArea: area }) },
    edgeTuck: { pin: (...args) => pins.push(args) }, spriteMotionTimer: null, spriteMotionEpoch: 0,
    hostMotion: { owner: 'codex', token: 7, action: 'bow', spriteAction: 'spin' },
    codexPresentation: { id: 9, token: 7, generation: 2, pageEpoch: 3 },
    windowMotion: { stop() {} }, dialogue: { dismissCodex: () => false },
    sendCodexCommand: command => commands.push(command), writeError() {}, clearTimeout() {} });
  vm.runInContext(helpers, context);
  return { context, pet, area, request, pins, messages, commands, window };
}

test('小白宽庆祝保持脚底与中心，完成恢复原窗且只释放匹配所有权', () => {
  const f = fixture(), original = f.pet.getBounds();
  f.context.prepareDogSpriteBounds({ frameWidth: 300 });
  assert.equal(f.pet.bounds.width, 183);
  assert.equal(f.pet.bounds.height, original.height);
  assert.equal(f.pet.bounds.y, original.y);
  assert(Math.abs(f.pet.bounds.x + f.pet.bounds.width / 2 - original.x - original.width / 2) <= .5);
  assert.equal(f.context.finishCodexSpriteMotion({ ...f.request, token: 6 }), false);
  assert.equal(f.pet.bounds.width, 183, '旧回调不得回收新宽窗');
  assert.equal(f.context.finishCodexSpriteMotion(f.request), true);
  assert.deepEqual(f.pet.bounds, original);
  assert.equal(f.context.hostMotion, null);
  assert.equal(f.messages.at(-1)[1].frame.done, true);
});

test('小白宽庆祝在左右屏边夹入工作区并在取消后回到各自原位', () => {
  for (const x of [0, 1800]) {
    const f = fixture(x), original = f.pet.getBounds();
    f.context.prepareDogSpriteBounds({ frameWidth: 300 });
    assert(f.pet.bounds.x >= f.area.x);
    assert(f.pet.bounds.x + f.pet.bounds.width <= f.area.width);
    f.context.clearCodexPresentation();
    assert.deepEqual(f.pet.bounds, original);
    assert.equal(f.context.hostMotion, null);
    assert.equal(f.commands.at(-1).command, 'codex-cancel');
    assert.equal(f.pins.at(-1)[0], false);
  }
});

test('旧窗口的宽庆祝租约不能修改替换后窗口，普通画布不扩窗', () => {
  const f = fixture();
  f.context.prepareDogSpriteBounds({ frameWidth: 192 });
  assert.equal(f.pet.calls.length, 0);
  f.context.prepareDogSpriteBounds({ frameWidth: 300 });
  const replacement = f.window({ x: 700, y: 500, width: 180, height: 180 });
  f.context.petWindow = replacement;
  f.context.restoreDogSpriteBounds();
  assert.equal(replacement.calls.length, 0);
});

test('正式runtime不携带小狗候选固定profile、历史别名或隐藏QA动作命令', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/codex-pets.js'), 'utf8');
  assert(!source.includes('dogTrialData'));
  assert(!store.includes('display-name.json'));
  for (const command of ["'pet-action'", "'pet-sleep'"]) {
    assert(!source.includes(command));
    assert(!renderer.includes(command));
  }
});
