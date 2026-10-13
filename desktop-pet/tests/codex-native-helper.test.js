const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Codex 原生验收助手只在显式 smoke 模式下可运行', async () => {
  const file = path.resolve(__dirname, '../scripts/verify-codex-companion.js');
  assert.equal(fs.existsSync(file), true, '需要明确使用模拟数据的原生验收助手');
  const { verifyCodexCompanion } = require(file);
  await assert.rejects(verifyCodexCompanion({}), /显式冒烟/);
});

test('双周期验收样本使用各自真实的重置区间，不用一天后冒充五小时窗口', () => {
  const { quotaPeriodsFixture } = require('../scripts/verify-codex-companion');
  const now = 1800000000000;
  const windows = quotaPeriodsFixture(now);
  const fiveHour = windows.find(item => item.id === 'codex:primary' && item.windowMinutes === 300);
  const weekly = windows.find(item => item.id === 'codex:secondary' && item.windowMinutes === 10080);

  assert.equal(fiveHour.resetsAt - now, (4 * 60 + 35) * 60000);
  assert.equal(weekly.resetsAt - now, (6 * 24 + 14) * 3600000);
});

test('静态额度验收先观察唤醒开始，再等待宿主和页面动作结束且精确归位', async () => {
  const { settleWakeMotion } = require('../scripts/verify-codex-companion');
  const anchor = { x: 1408, y: 878, width: 80, height: 80 };
  const moving = { owner: 'user', action: 'stretch', anchor };
  const probes = [
    [{ owner: null }, { owner: moving }],
    [
      { owner: moving, bounds: { ...anchor, y: 881 }, page: { motionOwner: 'user' } },
      { owner: null, bounds: anchor, page: { motionOwner: 'user' } },
      { owner: null, bounds: { ...anchor, y: 880 }, page: { motionOwner: 'none' } },
      { owner: null, bounds: anchor, page: { motionOwner: 'none' } }
    ]
  ];
  let current = {}, attempts = [], commands = [];
  const restored = await settleWakeMotion({
    command: value => commands.push(value), getMotionOwner: () => current.owner,
    pet: { getBounds: () => current.bounds }, state: async () => current.page,
    poll: async (read, predicate) => {
      let count = 0;
      for (const sample of probes.shift()) {
        count++; current = sample;
        const value = await read();
        if (predicate(value)) { attempts.push(count); return value; }
      }
      throw new Error('测试阶段未满足真实归位条件');
    }
  });
  assert.deepEqual(commands, ['wake']);
  assert.deepEqual(attempts, [2, 4], '空闲首帧、未完成页面和仍偏移的球窗不能提前通过');
  assert.deepEqual(restored, anchor);
});

test('原生布局校验拒绝第三行、溢出按钮与过小字体', () => {
  const file = path.resolve(__dirname, '../scripts/verify-codex-companion.js');
  assert.equal(fs.existsSync(file), true);
  const { assertBubbleLayout } = require(file);
  const fixture = { font: '14px', lineCount: 2, fits: true, buttons: ['去看看', '知道啦'] };
  assert.doesNotThrow(() => assertBubbleLayout(fixture));
  for (const patch of [{ lineCount: 3 }, { fits: false }, { font: '10px' }, { buttons: [] }]) {
    assert.throws(() => assertBubbleLayout({ ...fixture, ...patch }));
  }
});

test('真实启动流程必须调用并要求 Codex 模拟验收完成标记', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const smoke = fs.readFileSync(path.resolve(__dirname, '../scripts/smoke-electron.js'), 'utf8');
  assert.match(main, /verifyCodexCompanion\(/);
  assert.match(main, /verifyCodexCompanion\(\{[\s\S]*?\bquotaLabel\b[\s\S]*?\}\)/,
    '原生验收入口必须传入当前额度标签控制器');
  assert.match(main, /restorePetSettings:\s*restoreSmokePetSettings/,
    '原生验收必须获得不暴露给 IPC 的受控设置恢复闭包');
  assert.match(smoke, /CODEX_SIMULATED/);
  assert.match(smoke, /CODEX_SIZE_/);
  for (const marker of [
    'CODEX_QUOTA_SIZE_60', 'CODEX_QUOTA_SIZE_80', 'CODEX_QUOTA_SIZE_108', 'CODEX_QUOTA_SIZE_120', 'CODEX_QUOTA_SIZE_180',
    'CODEX_QUOTA_SIZE_260', 'CODEX_QUOTA_POLICY', 'CODEX_QUOTA_LABEL'
  ]) assert.match(smoke, new RegExp(marker));
});

test('额度原生校验分别核对 DOM 卡面、流光壳与守护外窗，拒绝裁剪和伪造可见边界', async () => {
  const { assertQuotaLabelWindow } = require('../scripts/verify-codex-companion');
  const petBounds = { x: 300, y: 300, width: 80, height: 80 };
  const fixture = (nativeSize, card, beam = card, guard = null, options = {}) => {
    const bounds = { x: 256, y: 388, ...nativeSize };
    const geometry = { card: { ...card }, beam: { ...beam }, viewport: { ...nativeSize }, size: options.size || 'standard',
      expanded: options.expanded === true, state: 'ready', hasItems: true,
      guard: { visible: Boolean(guard), bounds: guard, content: guard ? [{ ...guard, x: guard.x + 40, width: 24, height: 24 }] : [] } };
    const win = { isFocusable: () => false, isVisible: () => true, getBounds: () => ({ ...bounds }),
      webContents: { async executeJavaScript(source) {
        assert.match(source, /getElementById\('quota-label'\)/);
        assert.match(source, /getBoundingClientRect\(\)/);
        return geometry;
      } } };
    const controller = { getWindow: () => win, getVisibleBounds: () => ({ x: bounds.x + card.x, y: bounds.y + card.y,
      width: card.width, height: card.height }) };
    return { bounds, geometry, win, controller, check: () => assertQuotaLabelWindow(controller, win, petBounds, options) };
  };
  const standard = fixture({ width: 168, height: 58 }, { x: 0, y: 0, width: 168, height: 58 });
  await standard.check();
  await assert.rejects(assertQuotaLabelWindow({ getWindow: () => ({}) }, standard.win, petBounds), /当前窗口/);
  await assert.rejects(assertQuotaLabelWindow({ getWindow: () => ({ ...standard.win }) }, standard.win, petBounds), /当前窗口/);
  standard.win.isFocusable = () => true; await assert.rejects(standard.check(), /聚焦/);
  standard.win.isFocusable = () => false;
  standard.bounds.y = 300; await assert.rejects(standard.check(), /相交/); standard.bounds.y = 388;
  standard.bounds.width = 167; await assert.rejects(standard.check(), /168×58/); standard.bounds.width = 168;
  standard.geometry.card.width = 167; await assert.rejects(standard.check(), /DOM 卡面/); standard.geometry.card.width = 168;
  standard.controller.getVisibleBounds = () => ({ ...standard.bounds, x: 257 });
  await assert.rejects(standard.check(), /独立读取的 DOM/);
  for (const [native, card, beam, guard, options] of [
    [{ width: 240, height: 64 }, { x: 72, y: 6, width: 168, height: 58 }, { x: 72, y: 6, width: 168, height: 58 },
      { x: 0, y: 20, width: 64, height: 44 }, {}],
    [{ width: 128, height: 32 }, { x: 2, y: 2, width: 124, height: 28 }, { x: 0, y: 0, width: 128, height: 32 }, null, { size: 'compact' }],
    [{ width: 200, height: 50 }, { x: 74, y: 20, width: 124, height: 28 }, { x: 72, y: 18, width: 128, height: 32 },
      { x: 0, y: 6, width: 64, height: 44 }, { size: 'compact' }],
    [{ width: 196, height: 131 }, { x: 0, y: 0, width: 196, height: 131 }, { x: 0, y: 0, width: 196, height: 131 }, null,
      { size: 'compact', expanded: true }],
    [{ width: 196, height: 144 }, { x: 0, y: 0, width: 196, height: 144 }, { x: 0, y: 0, width: 196, height: 144 }, null,
      { size: 'standard', expanded: true, itemCount: 2 }]
  ]) {
    const f = fixture(native, card, beam, guard, options); await f.check();
    if (guard) {
      f.geometry.guard.bounds.x++; await assert.rejects(f.check(), /守护入口必须/); f.geometry.guard.bounds.x--;
      f.geometry.guard.content[0].y = native.height - 10; await assert.rejects(f.check(), /角色不能.*裁剪/);
      f.geometry.guard.content[0].y = guard.y;
      f.geometry.guard.role = 'roaming'; f.geometry.guard.paintedRight = 64; await f.check();
      f.geometry.guard.paintedRight = 62; await assert.rejects(f.check(), /实际alpha轮廓/);
      f.geometry.guard.paintedRight = 64;
      f.geometry.state = 'stale'; await assert.rejects(f.check(), /隐藏守护入口/);
    }
  }
});

test('额度几何读取直接测量 DOM，不从控制器 getter 推导卡面和角色矩形', async () => {
  const vm = require('node:vm');
  const { readQuotaLabelGeometry } = require('../scripts/verify-codex-companion');
  const node = (rect, visible = true) => ({ getBoundingClientRect: () => rect,
    getClientRects: () => visible ? [rect] : [], dataset: { size: 'compact', expanded: 'false', state: 'ready', hasItems: 'true' } });
  const nodes = { 'quota-label': node({ x: 74, y: 20, width: 124, height: 28 }),
    'quota-beam': node({ x: 72, y: 18, width: 128, height: 32 }),
    'quota-guard-entry': node({ x: 0, y: 6, width: 64, height: 44 }) };
  const win = { webContents: { async executeJavaScript(source) {
    return JSON.parse(JSON.stringify(vm.runInNewContext(source, {
      document: { getElementById: id => nodes[id], querySelectorAll: () => [node({ x: 40, y: 22, width: 24, height: 24 })] },
      getComputedStyle: () => ({ display: 'block' }), innerWidth: 200, innerHeight: 50
    })));
  } } };
  const result = await readQuotaLabelGeometry(win);
  assert.deepEqual(result.card, { x: 74, y: 20, width: 124, height: 28 });
  assert.deepEqual(result.beam, { x: 72, y: 18, width: 128, height: 32 });
  assert.deepEqual(result.guard.bounds, { x: 0, y: 6, width: 64, height: 44 });
  assert.deepEqual(result.guard.content, [{ x: 40, y: 22, width: 24, height: 24 }]);
  const pixels = new Uint8ClampedArray(4 * 2 * 4); pixels[(4 + 1) * 4 + 3] = 255;
  const canvas = { ...node({ x: 42, y: 17, width: 22, height: 32 }), width: 4, height: 2,
    getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
  nodes['guard-entry-zombie'] = { ...node({ x: 42, y: 17, width: 22, height: 32 }), querySelector: () => canvas };
  nodes['quota-guard-entry'].dataset.role = 'roaming';
  const painted = await readQuotaLabelGeometry(win);
  assert.equal(painted.guard.paintedRight, 53, 'alpha只占画布左半时不得把画布右边冒充可见轮廓');
});

test('普通 10% 合成额度先建立 100% 基线，80% 以上可直接合成', () => {
  const { syntheticQuotaSteps } = require('../scripts/verify-codex-companion');
  assert.deepEqual(syntheticQuotaSteps(10), [100, 90]);
  assert.deepEqual(syntheticQuotaSteps(80), [20]);
  assert.deepEqual(syntheticQuotaSteps(90), [10]);
  assert.deepEqual(syntheticQuotaSteps(100), [0]);
});

test('截图不依赖会暂停的双帧，先短暂稳定再原生捕获并锁定当前标签窗口', { timeout: 1000 }, async () => {
  const { capturePaintedWindow } = require('../scripts/verify-codex-companion');
  const calls = [];
  const expected = Buffer.from('painted-frame');
  const win = { isVisible: () => true, webContents: {
    executeJavaScript(source) {
      calls.push(['raf', source]);
      return new Promise(() => {});
    },
    invalidate() { calls.push(['invalidate']); },
    async capturePage(rect, options) {
      calls.push(['capture']);
      assert.equal(rect, undefined);
      assert.deepEqual(options, { stayHidden: true, stayAwake: true });
      return { toPNG: () => expected };
    }
  } };
  let currentWindow = win;
  let identityReads = 0;
  const controller = { getWindow: () => { identityReads += 1; return currentWindow; } };
  const result = await capturePaintedWindow({ win, controller,
    settle: async milliseconds => { calls.push(['settle', milliseconds]); } });
  assert.equal(result, expected);
  assert.ok(identityReads >= 4, '重绘、稳定等待和捕获后都必须确认当前窗口身份');
  assert.ok(calls.some(([kind, milliseconds]) => kind === 'settle' && milliseconds === 60),
    '截图前必须有短暂 paint settle');
  assert.equal(calls.some(([kind]) => kind === 'raf'), false, 'rAF 永不返回也不阻塞原生捕获');
  assert.ok(calls.findIndex(([kind]) => kind === 'settle') < calls.findIndex(([kind]) => kind === 'capture'),
    '原生捕获不能早于绘制稳定等待');
  assert.ok(calls.some(([kind]) => kind === 'invalidate'), '支持安全重绘时应主动请求重绘');

  const replacement = {};
  const replacingWindow = { isVisible: () => true, webContents: {
    async executeJavaScript() { return true; },
    async capturePage() {
      currentWindow = replacement;
      return { toPNG: () => expected };
    }
  } };
  currentWindow = replacingWindow;
  await assert.rejects(() => capturePaintedWindow({ win: replacingWindow, controller,
    settle: async () => {} }), /当前标签窗口/,
  '捕获期间替换窗口时旧截图必须失败');
  currentWindow = win;
  win.webContents.capturePage = async () => ({ toPNG: () => Buffer.alloc(0) });
  await assert.rejects(capturePaintedWindow({ win, controller, settle: async () => {} }), /非空 PNG/,
    '原生捕获完成也不能接受空 PNG');
});

test('真实隐藏窗口在捕获前后均被拒绝，截图不会抬起或重新显示窗口', async () => {
  const { capturePaintedWindow } = require('../scripts/verify-codex-companion');
  let visible = false, captures = 0, shown = 0;
  const win = { isVisible: () => visible, show() { shown++; visible = true; },
    showInactive() { shown++; visible = true; }, webContents: {
      async capturePage(_rect, options) {
        captures++; assert.equal(options.stayHidden, true);
        return { toPNG: () => Buffer.from('native-frame') };
      }
    } };
  await assert.rejects(capturePaintedWindow({ win, settle: async () => {} }), /原生可见/);
  assert.equal(captures, 0); assert.equal(shown, 0); assert.equal(visible, false);
  visible = true;
  await assert.rejects(capturePaintedWindow({ win, settle: async () => { visible = false; } }), /原生可见/);
  assert.equal(captures, 0); assert.equal(shown, 0);
  visible = true;
  win.webContents.capturePage = async () => { captures++; visible = false; return { toPNG: () => Buffer.from('native-frame') }; };
  await assert.rejects(capturePaintedWindow({ win, settle: async () => {} }), /原生可见/);
  assert.equal(captures, 1); assert.equal(shown, 0);
});

test('原生捕获局部超时固定报错且清除计时器', async () => {
  const { capturePaintedWindow, withCaptureTimeout } =
    require('../scripts/verify-codex-companion');
  assert.equal(typeof withCaptureTimeout, 'function', '截图操作需要独立的局部超时门禁');
  const never = new Promise(() => {});
  const controllerFor = win => ({ getWindow: () => win });
  const captureHung = { isVisible: () => true, webContents: {
    executeJavaScript: () => never,
    capturePage: () => never
  } };
  const startedAt = Date.now();
  await assert.rejects(() => capturePaintedWindow({ win: captureHung,
    controller: controllerFor(captureHung), timeoutMs: 15, settle: async () => {} }),
  error => error?.message === '额度标签截图捕获超时');
  assert.ok(Date.now() - startedAt < 500, '原生捕获卡住不能等整轮 smoke 超时');

  const timerCalls = [];
  const value = await withCaptureTimeout(Promise.resolve('ok'), 3000, '固定超时', {
    setTimeout(callback, milliseconds) {
      timerCalls.push(['set', milliseconds, callback]);
      return 42;
    },
    clearTimeout(handle) { timerCalls.push(['clear', handle]); }
  });
  assert.equal(value, 'ok');
  assert.deepEqual(timerCalls.map(([kind, value]) => [kind, value]),
    [['set', 3000], ['clear', 42]], '正常完成也必须清除局部超时计时器');

  const timeoutTimerCalls = [];
  let expire;
  const timeoutResult = withCaptureTimeout(never, 3000, '固定超时', {
    setTimeout(callback) { expire = callback; return 43; },
    clearTimeout(handle) { timeoutTimerCalls.push(handle); }
  });
  expire();
  await assert.rejects(timeoutResult, error => error?.message === '固定超时');
  assert.deepEqual(timeoutTimerCalls, [43], '超时发生后也必须清除局部计时器');
});

test('过期 DOM 即使正确，PNG 仍等于新鲜帧也必须拒绝为旧合成证据', () => {
  const { assertDistinctCaptureEvidence, assertStaleCaptureEvidence } =
    require('../scripts/verify-codex-companion');
  const light = Buffer.from('fresh-light');
  const dark = Buffer.from('fresh-dark');
  const stale = Buffer.from('stale-painted');
  assert.throws(() => assertDistinctCaptureEvidence(light, [Buffer.from(light)], '浅深证据'),
    /旧合成帧|重复/);
  const staleDom = { state: 'stale', periods: ['已过期 5小时', '已过期 7天'], values: [
    { text: '100%' }, { text: '94%' }
  ] };
  assert.throws(() => assertStaleCaptureEvidence({ before: staleDom, after: staleDom,
    stale: Buffer.from(light), fresh: { light, dark } }), /旧合成帧|重复/,
  'DOM 正确不能掩盖旧 PNG');
  assert.doesNotThrow(() => assertStaleCaptureEvidence({ before: staleDom, after: staleDom,
    stale, fresh: { light, dark } }));
  assert.throws(() => assertStaleCaptureEvidence({ before: staleDom,
    after: { ...staleDom, state: 'ready' }, stale, fresh: { light, dark } }), /过期状态/);
});

test('四档原生尺寸只通过真实 setSize 入口达成，入口失效时不能伪造标记', async () => {
  const { applyPetSize } = require('../scripts/verify-codex-companion');
  const settings = { size: 'tiny' };
  const bounds = { x: 1, y: 2, width: 80, height: 80 };
  const pet = { getBounds: () => ({ ...bounds }) };
  const poll = async (read, predicate, label) => {
    const value = await read();
    assert.ok(predicate(value), label);
    return value;
  };
  await applyPetSize({
    setSize(name) { settings.size = name; bounds.width = 120; bounds.height = 120; },
    getSettings: () => ({ ...settings }), pet, poll, sizeName: 'small', pixels: 120
  });
  assert.equal('setBounds' in pet, false, '验收帮助函数不应绕过尺寸入口');
  await assert.rejects(applyPetSize({
    setSize() {}, getSettings: () => ({ ...settings }), pet, poll,
    sizeName: 'medium', pixels: 180
  }), /medium/);
});

test('存在负坐标显示器时真实移动球球验证标签，且只改位置后恢复', async () => {
  const { verifyNegativeDisplay } = require('../scripts/verify-codex-companion');
  const original = { x: 100, y: 100, width: 80, height: 80 };
  let bounds = { ...original };
  const calls = [];
  const pet = {
    getBounds: () => ({ ...bounds }),
    setBounds(next) { calls.push({ ...next }); bounds = { ...next }; }
  };
  const labelWindow = {
    isFocusable: () => false, isVisible: () => true,
    getBounds: () => ({ x: bounds.x, y: bounds.y + bounds.height + 8, width: 168, height: 58 }),
    webContents: { executeJavaScript: async () => ({ card: { x: 0, y: 0, width: 168, height: 58 },
      beam: { x: 0, y: 0, width: 168, height: 58 }, viewport: { width: 168, height: 58 },
      size: 'standard', expanded: false, state: 'ready', hasItems: true, guard: { visible: false } }) }
  };
  const quotaLabel = { getWindow: () => labelWindow, getVisibleBounds: () => labelWindow.getBounds() };
  const poll = async (read, predicate, label) => {
    const value = await read();
    assert.ok(predicate(value), label);
    return value;
  };
  const result = await verifyNegativeDisplay({
    screen: { getAllDisplays: () => [{ workArea: { x: -1920, y: -180, width: 1920, height: 1080 } }] },
    pet, quotaLabel, bubble: { getWindow: () => null }, poll
  });
  assert.equal(result.skipped, false);
  assert.ok(calls[0].x < 0 || calls[0].y < 0);
  assert.deepEqual({ width: calls[0].width, height: calls[0].height }, { width: 80, height: 80 });
  assert.deepEqual(calls.at(-1), original, '实机负屏检查后必须恢复原位置');
});

test('验收截图超时且中途已关闭时，清理会恢复偏好并继续全部步骤', async () => {
  const { capturePaintedWindow, restoreSmokeState, combinedSmokeError } =
    require('../scripts/verify-codex-companion');
  let primary = null;
  const hungWindow = { isVisible: () => true, webContents: {
    executeJavaScript: () => new Promise(() => {}),
    capturePage: () => new Promise(() => {})
  } };
  try {
    await capturePaintedWindow({ win: hungWindow, controller: { getWindow: () => hungWindow },
      timeoutMs: 15, settle: async () => {} });
  } catch (error) {
    primary = error;
  }
  assert.equal(primary?.message, '额度标签截图捕获超时');
  const settings = {
    codexEnabled: false, codexQuotaPeriod: 'weekly', codexQuotaAlwaysVisible: true,
    codexTaskNameInAlerts: true, keepAwake: true, bubblesEnabled: true, size: 'large',
    x: 50, y: 60
  };
  const original = { settings: {
    codexEnabled: false, codexQuotaPeriod: 'auto', codexQuotaAlwaysVisible: false,
    codexTaskNameInAlerts: false, keepAwake: false, bubblesEnabled: false, size: 'tiny',
    x: null, y: null
  }, bounds: { x: 9, y: 8, width: 80, height: 80 } };
  const calls = [];
  let petBounds = { x: 0, y: 0, width: 260, height: 260 };
  const pet = {
    getBounds: () => ({ ...petBounds }),
    setBounds(value) { calls.push('position'); petBounds = { ...value }; },
    webContents: { debugger: { isAttached: () => true, detach() { calls.push('pet-debugger'); throw new Error('pet detach'); } } }
  };
  const bubbleWindow = { isDestroyed: () => false,
    webContents: { debugger: { isAttached: () => true, detach() { calls.push('bubble-debugger'); } } } };
  const labelWindow = { isDestroyed: () => false,
    webContents: { debugger: { isAttached: () => true, detach() { calls.push('label-debugger'); } } } };
  const cleanup = await restoreSmokeState({ original, getSettings: () => ({ ...settings }),
    async setEnabled(value) { calls.push(`enabled:${value}`); settings.codexEnabled = value; },
    setQuotaPreference(name, value) {
      calls.push(`pref:${name}`);
      if (name === 'codexQuotaPeriod') throw new Error('period restore');
      settings[name] = value;
    },
    command() { calls.push('command'); throw new Error('command restore'); },
    clearDialogue() { calls.push('dialogue'); }, page: async () => { calls.push('page'); },
    setSetting(name, value) { calls.push(`setting:${name}`); settings[name] = value; },
    setSize(value) {
      calls.push('size'); settings.size = value;
      settings.x = petBounds.x; settings.y = petBounds.y;
    },
    restorePetSettings(value) {
      calls.push('restore-pet-settings');
      Object.assign(settings, value);
      return true;
    }, pet,
    bubble: { getWindow: () => bubbleWindow }, quotaLabel: { getWindow: () => labelWindow },
    prepareSynthetic() { calls.push('prepare-synthetic'); },
    prepare() { calls.push('prepare'); throw new Error('prepare restore'); }
  });
  assert.deepEqual(calls.slice(0, 2), ['prepare-synthetic', 'enabled:true'],
    '已关闭时必须先重建合成联动并临时开启，不能连接真实 Codex');
  for (const expected of ['pref:codexQuotaPeriod', 'pref:codexQuotaAlwaysVisible',
    'pref:codexTaskNameInAlerts', 'enabled:false', 'dialogue', 'page', 'setting:keepAwake',
    'setting:bubblesEnabled', 'position', 'size', 'restore-pet-settings', 'pet-debugger', 'bubble-debugger',
    'label-debugger', 'prepare']) assert.ok(calls.includes(expected), `缺少清理步骤 ${expected}`);
  assert.ok(calls.indexOf('position') < calls.indexOf('size'), '必须先恢复真实 bounds 再调用真实尺寸入口');
  assert.deepEqual(pet.getBounds(), original.bounds);
  assert.deepEqual({ size: settings.size, x: settings.x, y: settings.y },
    { size: 'tiny', x: null, y: null }, '初始设置坐标与 bounds 不同时也必须精确恢复');
  assert.deepEqual(cleanup.map(item => item.label), [
    '恢复额度周期', '停止动作', '断开球球调试器', '重建关闭态联动'
  ]);
  const combined = combinedSmokeError(primary, cleanup);
  assert.equal(combined.errors[0], primary, '聚合错误必须保留原始失败为第一条');
  assert.match(combined.message, /截图捕获超时/);
  assert.equal(combined.errors.length, cleanup.length + 1);
});

test('位置、尺寸或落盘坐标静默失效都会成为清理错误且不阻断后续步骤', async () => {
  const { restoreSmokeState } = require('../scripts/verify-codex-companion');
  for (const [mode, expectedLabel] of [
    ['bounds-noop', '恢复球球真实位置'],
    ['size-noop', '恢复球球尺寸与落盘位置'],
    ['position-not-persisted', '恢复球球尺寸与落盘位置']
  ]) {
    const original = { settings: {
      codexEnabled: false, codexQuotaPeriod: 'auto', codexQuotaAlwaysVisible: false,
      codexTaskNameInAlerts: false, keepAwake: false, bubblesEnabled: false,
      size: 'tiny', x: 9, y: 8
    }, bounds: { x: 9, y: 8, width: 80, height: 80 } };
    const settings = { ...original.settings, size: 'large', x: 50, y: 60 };
    let bounds = { x: 50, y: 60, width: 260, height: 260 };
    const calls = [];
    const pet = {
      getBounds: () => ({ ...bounds }),
      setBounds(value) { calls.push('position'); if (mode !== 'bounds-noop') bounds = { ...value }; },
      webContents: { debugger: { isAttached: () => false } }
    };
    const cleanup = await restoreSmokeState({ original, getSettings: () => ({ ...settings }),
      async setEnabled(value) { settings.codexEnabled = value; },
      setQuotaPreference(name, value) { settings[name] = value; },
      command() {}, clearDialogue() {}, page: async () => {},
      setSetting(name, value) { settings[name] = value; },
      setSize(value) {
        calls.push('size');
        if (mode === 'size-noop') return;
        settings.size = value;
        if (mode !== 'position-not-persisted') {
          settings.x = bounds.x; settings.y = bounds.y;
        }
      },
      restorePetSettings() { calls.push('restore-pet-settings'); return true; }, pet,
      bubble: { getWindow: () => null }, quotaLabel: { getWindow: () => null },
      prepareSynthetic() {}, prepare() { calls.push('prepare'); }
    });
    assert.ok(cleanup.some(item => item.label === expectedLabel), `${mode} 未产生 ${expectedLabel}`);
    assert.ok(calls.includes('prepare'), `${mode} 失败后仍须执行最终重建`);
  }
});

test('原生助手验收任务菜单与名称开关且不具备真实任务写入行为', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../scripts/verify-codex-companion.js'),
    'utf8'
  );
  assert.match(source, /PET_CODEX_TASK_MENU_OK/);
  assert.match(source, /PET_CODEX_TASK_TITLE_OK/);
  assert.match(source, /getMenuItemById\('codex-recent'\)/);
  assert.match(source, /getMenuItemById\('codex-task-names'\)/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_80_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_108_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_60_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_120_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_180_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_260_OK/);
  assert.match(source, /PET_CODEX_QUOTA_POLICY_OK/);
  assert.match(source, /PET_CODEX_QUOTA_LABEL_OK/);
  assert.match(source, /PET_CODEX_QUOTA_COMPACT_OK/);
  assert.match(source, /PET_CODEX_QUOTA_BEAM_OK/);
  assert.match(source, /querySelectorAll\('#summary > span'\)/);
  assert.match(source, /codex-quota-visible/);
  assert.match(source, /codex-quota-auto/);
  assert.match(source, /codex-quota-five-hour/);
  assert.match(source, /codex-quota-weekly/);
  assert.match(source, /view\.rows\.length === 1 &&\s*view\.itemCount === '1' &&\s*view\.periods\[0\] === '5小时'/s,
    '标准卡片手动选 5 小时时必须只验收所选周期');
  assert.match(source, /view\.rows\.length === 1 &&\s*view\.itemCount === '1' &&\s*view\.periods\[0\] === '7天'/s,
    '标准卡片手动选周额度时必须只验收所选周期');
  assert.match(source, /\['light', 'dark'\]/);
  assert.match(source, /\$\{prefix\}-\$\{scheme\}/);
  assert.match(source, /quota-label-compact/);
  assert.match(source, /quota-label-compact-expanded-single/);
  assert.match(source, /itemCount/);
  assert.match(source, /quota-label-stale-long/);
  assert.match(source, /已过期 5小时/);
  assert.match(source, /\['100%', '94%'\]/);
  assert.match(source, /severity/);
  assert.match(source, /applyPetSize\(\{ setSize, getSettings, pet, poll/);
  assert.match(source, /screen\.getAllDisplays\(\)/);
  assert.match(source, /PET_CODEX_QUOTA_NEGATIVE_DISPLAY_SKIPPED/);
  assert.match(source, /prepareSynthetic:\s*\(\)\s*=>\s*prepare\(syntheticOptions\)/);
  assert.doesNotMatch(source, /pet\.setBounds\(\{[^}]*width:\s*pixels[^}]*height:\s*pixels/s,
    '四档 marker 前不能直接伪造球球尺寸');
  assert.doesNotMatch(source, /createThread|create_thread|sendMessageToThread|send_message_to_thread|turn\/start|model\/start/);
});
