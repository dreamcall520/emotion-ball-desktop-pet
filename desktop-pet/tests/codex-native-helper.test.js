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
    'CODEX_QUOTA_SIZE_80', 'CODEX_QUOTA_SIZE_120', 'CODEX_QUOTA_SIZE_180',
    'CODEX_QUOTA_SIZE_260', 'CODEX_QUOTA_POLICY', 'CODEX_QUOTA_LABEL'
  ]) assert.match(smoke, new RegExp(marker));
});

test('额度标签原生校验要求可见、不聚焦、196×74 且不与球球相交', () => {
  const { assertQuotaLabelWindow } = require('../scripts/verify-codex-companion');
  const petBounds = { x: 300, y: 300, width: 80, height: 80 };
  const win = {
    isFocusable: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 242, y: 388, width: 196, height: 74 })
  };
  const controller = { getWindow: () => win };
  assert.doesNotThrow(() => assertQuotaLabelWindow(controller, win, petBounds));
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => ({}) }, win, petBounds), /当前窗口/);
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => ({ ...win }) }, win, petBounds), /当前窗口/,
    '旧孤立窗口外观正常也不能通过');
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => win }, { ...win, isFocusable: () => true }, petBounds), /当前窗口/);
  const focusable = { ...win, isFocusable: () => true };
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => focusable }, focusable, petBounds), /聚焦/);
  const overlap = { ...win, getBounds: () => ({ x: 300, y: 300, width: 196, height: 74 }) };
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => overlap }, overlap, petBounds), /相交/);
  const wrongSize = { ...win, getBounds: () => ({ x: 242, y: 388, width: 195, height: 74 }) };
  assert.throws(() => assertQuotaLabelWindow({ getWindow: () => wrongSize }, wrongSize, petBounds), /196×74/);
});

test('普通 10% 合成额度先建立 100% 基线，80% 以上可直接合成', () => {
  const { syntheticQuotaSteps } = require('../scripts/verify-codex-companion');
  assert.deepEqual(syntheticQuotaSteps(10), [100, 90]);
  assert.deepEqual(syntheticQuotaSteps(80), [20]);
  assert.deepEqual(syntheticQuotaSteps(90), [10]);
  assert.deepEqual(syntheticQuotaSteps(100), [0]);
});

test('截图证据先等待双帧与短暂绘制稳定，并在捕获前后锁定当前标签窗口', async () => {
  const { capturePaintedWindow } = require('../scripts/verify-codex-companion');
  const calls = [];
  const expected = Buffer.from('painted-frame');
  const win = { webContents: {
    async executeJavaScript(source) {
      calls.push(['raf', source]);
      assert.match(source, /requestAnimationFrame[\s\S]*requestAnimationFrame/);
      return true;
    },
    invalidate() { calls.push(['invalidate']); },
    async capturePage() { calls.push(['capture']); return { toPNG: () => expected }; }
  } };
  let currentWindow = win;
  let identityReads = 0;
  const controller = { getWindow: () => { identityReads += 1; return currentWindow; } };
  const result = await capturePaintedWindow({ win, controller,
    settle: async milliseconds => { calls.push(['settle', milliseconds]); } });
  assert.equal(result, expected);
  assert.ok(identityReads >= 4, '双帧、稳定等待和捕获后都必须确认当前窗口身份');
  assert.ok(calls.some(([kind, milliseconds]) => kind === 'settle' && milliseconds >= 30),
    '截图前必须有短暂 paint settle');
  assert.ok(calls.findIndex(([kind]) => kind === 'raf') < calls.findIndex(([kind]) => kind === 'capture'),
    '截图不能早于双帧等待');
  assert.ok(calls.some(([kind]) => kind === 'invalidate'), '支持安全重绘时应主动请求重绘');

  const replacement = {};
  const replacingWindow = { webContents: {
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
});

test('截图绘制和捕获各自局部超时，固定报错且清除计时器', async () => {
  const { capturePaintedWindow, withCaptureTimeout } =
    require('../scripts/verify-codex-companion');
  assert.equal(typeof withCaptureTimeout, 'function', '截图操作需要独立的局部超时门禁');
  const never = new Promise(() => {});
  const controllerFor = win => ({ getWindow: () => win });
  const rafHung = { webContents: {
    executeJavaScript: () => never,
    capturePage: async () => { throw new Error('不应进入捕获'); }
  } };
  const startedAt = Date.now();
  await assert.rejects(() => capturePaintedWindow({ win: rafHung,
    controller: controllerFor(rafHung), timeoutMs: 15, settle: async () => {} }),
  error => error?.message === '额度标签截图等待页面绘制超时');
  assert.ok(Date.now() - startedAt < 500, '页面绘制卡住不能等整轮 smoke 超时');

  const captureHung = { webContents: {
    executeJavaScript: async () => true,
    capturePage: () => never
  } };
  await assert.rejects(() => capturePaintedWindow({ win: captureHung,
    controller: controllerFor(captureHung), timeoutMs: 15, settle: async () => {} }),
  error => error?.message === '额度标签截图捕获超时');

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
  const staleDom = { state: 'stale', periods: ['已过期 7天', '已过期 7天'], values: [
    { text: '64%' }, { text: '78%' }
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
    getBounds: () => ({ x: bounds.x, y: bounds.y + bounds.height + 8, width: 196, height: 74 })
  };
  const quotaLabel = { getWindow: () => labelWindow };
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
  const hungWindow = { webContents: {
    executeJavaScript: () => new Promise(() => {}),
    capturePage: async () => { throw new Error('不应进入捕获'); }
  } };
  try {
    await capturePaintedWindow({ win: hungWindow, controller: { getWindow: () => hungWindow },
      timeoutMs: 15, settle: async () => {} });
  } catch (error) {
    primary = error;
  }
  assert.equal(primary?.message, '额度标签截图等待页面绘制超时');
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
  assert.match(combined.message, /等待页面绘制超时/);
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
  assert.match(source, /PET_CODEX_QUOTA_SIZE_120_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_180_OK/);
  assert.match(source, /PET_CODEX_QUOTA_SIZE_260_OK/);
  assert.match(source, /PET_CODEX_QUOTA_POLICY_OK/);
  assert.match(source, /PET_CODEX_QUOTA_LABEL_OK/);
  assert.match(source, /PET_CODEX_QUOTA_COMPACT_OK/);
  assert.match(source, /codex-quota-visible/);
  assert.match(source, /codex-quota-auto/);
  assert.match(source, /codex-quota-five-hour/);
  assert.match(source, /codex-quota-weekly/);
  assert.match(source, /\['light', 'dark'\]/);
  assert.match(source, /\$\{prefix\}-\$\{scheme\}/);
  assert.match(source, /quota-label-compact/);
  assert.match(source, /quota-label-stale-long/);
  assert.match(source, /已过期 7天/);
  assert.match(source, /\['64%', '78%'\]/);
  assert.match(source, /severity/);
  assert.match(source, /applyPetSize\(\{ setSize, getSettings, pet, poll/);
  assert.match(source, /screen\.getAllDisplays\(\)/);
  assert.match(source, /PET_CODEX_QUOTA_NEGATIVE_DISPLAY_SKIPPED/);
  assert.match(source, /prepareSynthetic:\s*\(\)\s*=>\s*prepare\(syntheticOptions\)/);
  assert.doesNotMatch(source, /pet\.setBounds\(\{[^}]*width:\s*pixels[^}]*height:\s*pixels/s,
    '四档 marker 前不能直接伪造球球尺寸');
  assert.doesNotMatch(source, /createThread|create_thread|sendMessageToThread|send_message_to_thread|turn\/start|model\/start/);
});
