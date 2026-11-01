const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { prepareStaging } = require('../scripts/package-mac');

// The dream runs in its own native window; its HTML and relative dependencies
// must survive staging independently of the pet's sprite assets.
test('小白梦境原生窗口的页面、脚本、样式及两位梦中伙伴全部随包交付', t => {
  const root = path.resolve(__dirname, '../..');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-dream-package-'));
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  prepareStaging(root, stage, { weatherNative: false });
  const relative = 'desktop-pet/chunye-dream.html';
  const html = fs.readFileSync(path.join(stage, relative), 'utf8');
  const dependencies = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => path.posix.join('desktop-pet', match[1]));
  const script = fs.readFileSync(path.join(stage, 'desktop-pet/chunye-dream.js'), 'utf8');
  for (const match of script.matchAll(/new URL\('([^']+)', scriptURL\)/g)) dependencies.push(path.posix.join('desktop-pet', match[1]));
  assert.deepEqual(dependencies.sort(), ['desktop-pet/chunye-dream.css','desktop-pet/chunye-dream.js','desktop-pet/chunye-avatar.png','desktop-pet/assets/partner-confirmed-reference.png'].sort());
  for (const file of [relative, ...dependencies]) {
    assert.deepEqual(fs.readFileSync(path.join(stage, file)), fs.readFileSync(path.join(root, file)), file);
  }
});

function dreamFixture() {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const scheduled = new Map(), events = []; let now = 1000, next = 0, choice = 0;
  const context = vm.createContext({
    dogDreamShowUntil: 0, dogDreamNextShowAt: 0, dogDreamTimer: null, dogDreamCycleToken: 0,
    petSleepState: 'sleep', dogSleepReady: null, dogDreamSkinEnabled: true,
    dogDreamSkinId: 'official-xiaobai', dogDreamPetId: 'official-xiaobai', dogDreamAvatar: 'chunye',
    isQuitting: false, screenLocked: false, dragState: null, globalSettingsWindow: null,
    settings: { customization: { appearance: { shape: 'codex-pet', codexPetId: 'official-xiaobai' } } },
    effectiveCustomization: value => value, petWindow: { isVisible: () => true },
    dogDream: { hide: () => events.push('hide'), show: payload => events.push({ payload, avatar: context.dogDreamAvatar, at: now }) },
    hideBubble: () => {}, Date: { now: () => now }, Math: { ...Math, floor: Math.floor, max: Math.max, random: () => choice },
    setTimeout(fn, delay) { const timer = { id: ++next, unref() {} }; scheduled.set(timer, { fn, at: now + delay }); return timer; },
    clearTimeout(timer) { scheduled.delete(timer); }
  });
  const stateStart = source.indexOf('function setPetSleepState(state)');
  vm.runInContext(source.slice(stateStart, source.indexOf('function dogDreamPlacement', stateStart)), context);
  return { context, events, scheduled, random(value) { choice = value; }, advanceTo(at) {
    now = at;
    for (const [timer, task] of [...scheduled]) if (task.at <= now) { scheduled.delete(timer); task.fn(); }
  }, now: () => now };
}

test('小白只有睡稳ready后才开始梦境，约6.8秒展示后隐藏20–35秒并随机切换伙伴', () => {
  const f = dreamFixture(), c = f.context;
  c.syncDogDream();
  assert.equal(f.events.filter(e => typeof e === 'object').length, 0, 'sleep state alone cannot show dream');
  c.dogSleepReady = { head: { x: .5, y: .2 }, body: { x: .1, y: .2, width: .8, height: .7 } };
  c.syncDogDream();
  assert.equal(f.events.at(-1).avatar, 'chunye');
  assert.equal(c.dogDreamShowUntil - f.now(), 6800, '800ms entrance plus about 6 seconds');
  f.random(.999);
  f.advanceTo(c.dogDreamShowUntil);
  assert.equal(f.events.at(-1), 'hide');
  const next = c.dogDreamNextShowAt;
  assert.ok(next - f.now() >= 20200 && next - f.now() <= 35200);
  f.advanceTo(next);
  assert.equal(f.events.at(-1).avatar, 'partner');
  assert.equal(c.dogDreamShowUntil - f.now(), 6800);
});

test('唤醒或换成其他皮肤立即清理梦境，不留迟到的展示计时器', () => {
  for (const change of ['wake', 'skin']) {
    const f = dreamFixture(), c = f.context;
    c.dogSleepReady = { head: { x: .5, y: .2 }, body: { x: .1, y: .2, width: .8, height: .7 } };
    c.syncDogDream();
    if (change === 'wake') c.setPetSleepState('awake');
    else { c.settings.customization.appearance.codexPetId = 'another-skin'; c.syncDogDream(); }
    assert.equal(c.dogSleepReady, null);
    assert.equal(c.dogDreamShowUntil, 0);
    assert.equal(c.dogDreamNextShowAt, 0);
    assert.equal(f.scheduled.size, 0);
    assert.equal(f.events.at(-1), 'hide');
  }
});
