const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { capturePaintedWindow } = require('./verify-codex-companion');
const { pointerClick } = require('./verify-chat-integration');

// Run through smoke-electron.js so main.js verifies the temporary user-data dir.
// This verifier never opens the installed app or writes its preferences.
async function verifyPomodoro({ pet, service, windows, BrowserWindow, powerMonitor,
  getMenu, getSettings, getQuiet, setClock }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_POMODORO_ONLY, '1');
  assert.ok(pet && service && windows && BrowserWindow && powerMonitor);
  const output = path.resolve(process.env.PET_SMOKE_POMODORO_OUTPUT ||
    path.join(os.tmpdir(), `qiuqiu-pomodoro-native-${process.pid}`));
  fs.mkdirSync(output, { recursive: true });
  const result = { ok: false, checks: [], themes: [], layouts: [], screenshots: [], errors: [] };
  const original = { ...getSettings() };
  let stamp = Date.now(), locked = false, debuggerAttached = false, mini;
  const observed = new Set(), mouseCalls = new WeakMap();
  const originalIgnoreMouse = BrowserWindow.prototype.setIgnoreMouseEvents;
  // Electron has no getter for this setting. Observe the real native method and
  // still invoke it; this verifies passthrough configuration, not a mock window.
  BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
    mouseCalls.set(this, { ignore, forward: options?.forward === true });
    return originalIgnoreMouse.call(this, ignore, options);
  };
  setClock(() => stamp);
  const page = (win, code) => win.webContents.executeJavaScript(code, true);
  const poll = async (read, test, label, timeout = 5000) => {
    const deadline = performance.now() + timeout;
    let value;
    do {
      value = await read();
      if (test(value)) return value;
      await wait(30);
    } while (performance.now() < deadline);
    assert.fail(`${label}超时：${JSON.stringify(value)}`);
  };
  const allWindows = () => BrowserWindow.getAllWindows().filter(win => {
    if (win.isDestroyed()) return false;
    try { return new URL(win.webContents.getURL()).pathname.endsWith('/pomodoro.html'); }
    catch (_) { return false; }
  });
  const find = view => allWindows().find(win => new URL(win.webContents.getURL()).searchParams.get('view') === view);
  const observe = win => {
    if (observed.has(win)) return;
    observed.add(win);
    win.webContents.on('console-message', event => {
      if (event.level >= 3) result.errors.push({ type: 'console', message: event.message });
    });
    win.webContents.on('render-process-gone', (_event, details) => result.errors.push({ type: 'renderer', ...details }));
    win.webContents.on('did-fail-load', (_event, code, description) => result.errors.push({ type: 'load', code, description }));
  };
  const ready = async view => {
    const win = await poll(() => find(view), Boolean, `${view} 原生窗口创建`);
    observe(win);
    await poll(() => !win.webContents.isLoading(), Boolean, `${view} 页面加载`);
    assert.equal(await page(win, 'Boolean(window.qiuPomodoro)'), true, `${view} preload bridge`);
    const preferences = win.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    assert.equal(await page(win, 'typeof require'), 'undefined');
    await page(win, `(() => {
      if (window.__pomodoroSmoke) return;
      const record = window.__pomodoroSmoke = { states: [], colors: [], errors: [] };
      qiuPomodoro.onState(state => record.states.push(state));
      qiuPomodoro.onColorMode((mode, appearance, theme) => record.colors.push({ mode, appearance, theme }));
      addEventListener('error', event => record.errors.push(String(event.message)));
      addEventListener('unhandledrejection', event => record.errors.push(String(event.reason)));
    })()`);
    return win;
  };
  const bridge = async (win, type, value) => {
    const reply = await page(win, `qiuPomodoro.action(${JSON.stringify(type)}, ${value === undefined ? 'undefined' : JSON.stringify(value)})`);
    assert.equal(reply?.ok, true, `${type}: ${reply?.message || 'bridge 操作失败'}`);
    return reply.state;
  };
  const load = async win => {
    const reply = await page(win, 'qiuPomodoro.load()');
    assert.equal(reply?.ok, true, '真实 bridge load');
    return reply.state;
  };
  const core = (type, value) => {
    const reply = service.action(type, value);
    assert.equal(reply?.ok, true, `${type}: ${reply?.message || '模型操作失败'}`);
    return reply.state;
  };
  const select = id => {
    const item = getMenu().getMenuItemById(id);
    assert.ok(item?.enabled, `菜单 ${id}`);
    item.click(item, pet, {});
  };
  const setMode = mode => {
    const item = getMenu().getMenuItemById('color-accessible');
    assert.ok(item?.enabled, '色弱友好菜单');
    if (item.checked !== (mode === 'accessible')) {
      item.click(item, pet, {});
    }
    assert.equal(getSettings().colorMode, mode);
  };
  const appearance = win => page(win, `(() => {
    const root = document.documentElement, style = getComputedStyle(root);
    return { theme: root.dataset.uiTheme, appearance: root.dataset.appearance, mode: root.dataset.colorMode,
      blueDisabled: document.getElementById('blue-style').disabled, accent: style.getPropertyValue('--accent').trim(),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      colors: window.__pomodoroSmoke.colors.at(-1) || null };
  })()`);
  const theme = async (panel, value, light, mode) => {
    select(`ui-theme-${value}`); select(`color-appearance-${light}`); setMode(mode);
    for (const win of allWindows()) await poll(() => appearance(win), view =>
      view.theme === value && view.appearance === light && view.mode === mode, '配色广播');
    const state = await appearance(panel);
    assert.equal(state.blueDisabled, value !== 'blue');
    return state;
  };
  const settingsValue = (face, durations = service.getSnapshot().durations) =>
    ({ face, durations, encouragementEnabled: true });
  const settingsOpen = async panel => {
    await pointerClick(panel, '#settings-open');
    await poll(() => page(panel, "!document.querySelector('#settings').hidden && innerHeight === 384"), Boolean, '原生设置展开');
  };
  const settingsClose = async (panel, selector = '#settings-cancel') => {
    await pointerClick(panel, selector);
    await poll(() => page(panel, "document.querySelector('#settings').hidden"), Boolean, '原生设置收起');
  };
  const geometry = panel => page(panel, `(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const form = document.querySelector('#settings'), editing = !form.hidden;
    const selectors = editing ? ['.settings-head', '.settings-body', '.settings-actions', '#settings-cancel', '#settings button[type=submit]'] :
      ['.panel-header', '.modes', '.dial', '#time', '.task-row', '#start', '.panel-footer'];
    const body = form.querySelector('.settings-body');
    return { width: innerWidth, height: innerHeight, face: document.querySelector('#focus-panel').dataset.face, editing,
      scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
      panel: rect('#focus-panel'), nodes: selectors.map(selector => ({ selector, ...rect(selector) })),
      settings: editing ? { form: rect('#settings'), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null };
  })()`);
  const assertLayout = (view, win, face, editing) => {
    const height = editing || face !== 'analog' ? 384 : 488;
    const native = win.getContentBounds();
    assert.equal(view.width, 320); assert.equal(view.height, height);
    assert.equal(native.width, 320); assert.equal(native.height, height);
    assert.equal(view.face, face); assert.equal(view.editing, editing);
    assert.ok(view.scrollWidth <= 320 && view.bodyScrollWidth <= 320, '面板没有横向溢出');
    assert.ok(Math.abs(view.panel.left) <= 1 && Math.abs(view.panel.top) <= 1 &&
      Math.abs(view.panel.right - 320) <= 1 && Math.abs(view.panel.bottom - height) <= 1, '卡片填满真实内容区');
    for (const node of view.nodes) assert.ok(node.width > 0 && node.height > 0 && node.left >= -1 &&
      node.right <= 321 && node.top >= -1 && node.bottom <= height + 1,
    `${face} ${node.selector} 完整位于 ${320}×${height} 内：${JSON.stringify(node)}`);
    if (editing) {
      assert.ok(view.settings.scrollWidth <= view.settings.clientWidth + 1, '设置内容无横向溢出');
      const body = view.nodes.find(node => node.selector === '.settings-body');
      const actions = view.nodes.find(node => node.selector === '.settings-actions');
      assert.ok(body.bottom <= actions.top + 1, '设置滚动区不覆盖保存按钮');
    }
  };
  const capture = async (win, name) => {
    const artifactPath = path.join(output, `${name}.png`);
    const png = await capturePaintedWindow({ win, artifactPath });
    result.screenshots.push({ name, path: artifactPath, bytes: png.length, native: win.getContentBounds() });
  };
  const keyboard = async (win, keyCode) => {
    win.focus(); win.webContents.focus();
    await poll(() => page(win, 'document.hasFocus()'), Boolean, '原生键盘焦点');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Enter activates an HTML button through keypress. A native keyboard also
    // supplies the char event; keyDown/keyUp alone omit that default action.
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const timerIdentity = state => ({ mode: state.mode, status: state.status, total: state.total,
    deadline: state.deadline, completed: state.completed, cycleCompleted: state.cycleCompleted,
    minutes: state.minutes, intention: state.intention });
  const draft = panel => page(panel, `(() => {
    const form = document.querySelector('#settings');
    return { face: form.elements.face.value, focus: form.elements.focus.value, short: form.elements.short.value,
      long: form.elements.long.value, encouragement: form.elements.encouragement.checked };
  })()`);
  const setDraft = (panel, value) => page(panel, `(() => {
    const form = document.querySelector('#settings'), value = ${JSON.stringify(value)};
    for (const key of ['face', 'focus', 'short', 'long']) if (key in value) form.elements[key].value = value[key];
    if ('encouragement' in value) form.elements.encouragement.checked = value.encouragement;
  })()`);
  try {
    const menu = getMenu(), index = menu.items.findIndex(item => item.id === 'pomodoro-open');
    assert.ok(index > 0);
    assert.equal(menu.items[index - 1].label, '便签与待办', '番茄钟紧跟便签与待办');
    assert.equal(menu.items[index].label, '番茄钟');
    assert.equal(service.getSnapshot().face, 'analog', '新安装默认刻度表盘');
    assert.equal(service.getSnapshot().status, 'idle');
    select('pomodoro-open');
    const panel = await ready('panel'); mini = await ready('mini');
    await poll(() => panel.isVisible() && mini.isVisible(), Boolean, '面板与迷你入口可见');
    assert.equal((await load(panel)).panelOpen, true);
    assert.deepEqual(await page(panel, 'Object.keys(qiuPomodoro).sort()'), ['action', 'load', 'onColorMode', 'onState']);
    assert.equal((await load(mini)).face, 'analog');
    const invalidMini = await page(mini, "qiuPomodoro.action('reset')");
    assert.equal(invalidMini.ok, false, '迷你入口不能越权重置计时');
    result.checks.push('menu-default-native-bridge');

    for (const value of ['green', 'blue']) for (const light of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
      const paint = await theme(panel, value, light, mode);
      result.themes.push({ ...paint, requested: { value, light, mode } });
      for (const face of ['analog', 'timeline', 'modules', 'minutes']) {
        await bridge(panel, 'settings', settingsValue(face));
        await poll(() => geometry(panel), view => view.face === face && view.height === (face === 'analog' ? 488 : 384), '表盘尺寸更新');
        const normal = await geometry(panel); assertLayout(normal, panel, face, false);
        result.layouts.push({ value, light, mode, ...normal });
        await settingsOpen(panel);
        const editing = await geometry(panel); assertLayout(editing, panel, face, true);
        result.layouts.push({ value, light, mode, ...editing });
        if (value === 'blue' && light === 'dark' && mode === 'standard' && face === 'analog') await capture(panel, 'settings-blue-dark');
        await settingsClose(panel);
        if (value === 'blue' && light === 'light' && mode === 'standard' && face === 'analog') await capture(panel, 'panel-analog-blue-light');
      }
    }
    assert.equal(result.themes.length, 8); assert.equal(result.layouts.length, 64);
    result.checks.push('eight-themes-four-faces-and-settings-native-bounds');

    await theme(panel, 'blue', 'light', 'standard');
    await bridge(panel, 'settings', settingsValue('analog', { focus: 1, short: 5, long: 15 }));
    await pointerClick(panel, '#start');
    assert.equal(service.getSnapshot().status, 'running'); assert.equal(getQuiet(), true);
    stamp = service.getSnapshot().deadline; service.tick();
    const message = await ready('message');
    await poll(() => message.isVisible(), Boolean, '完成提醒原生窗口');
    await poll(() => page(message, "!document.querySelector('#reminder').hidden"), Boolean, '完成提醒渲染');
    assert.equal(service.getSnapshot().completed, 1); assert.equal(getQuiet(), false);
    assert.equal(message.isFocusable(), false);
    assert.deepEqual(mouseCalls.get(message), { ignore: false, forward: true }, '完成提醒可接收按钮点击');
    await capture(message, 'completion-blue-light');
    await pointerClick(message, '#five-more');
    assert.equal(service.getSnapshot().total, 300); assert.equal(service.getSnapshot().extension, true);
    assert.equal(service.getSnapshot().completed, 1); assert.equal(getQuiet(), true);
    stamp = service.getSnapshot().deadline; service.tick();
    assert.equal(service.getSnapshot().completed, 1); assert.equal(service.getSnapshot().minutes, 6, '加时增加分钟，不重复计次');
    await poll(() => message.isVisible(), Boolean, '加时完成提醒');
    await pointerClick(message, '#rest-now');
    assert.equal(service.getSnapshot().mode, 'short'); assert.equal(service.getSnapshot().status, 'running');
    assert.equal(getQuiet(), false, '休息时恢复陪伴提示');
    stamp = service.getSnapshot().deadline; service.tick();
    await poll(() => page(message, "document.querySelector('#five-more').hidden"), Boolean, '休息完成状态');
    await pointerClick(message, '#rest-now');
    assert.equal(service.getSnapshot().mode, 'focus'); assert.equal(service.getSnapshot().status, 'running');
    assert.equal(service.getSnapshot().completed, 1);
    result.checks.push('focus-completion-extend-and-rest-through-message-bridge');

    await bridge(panel, 'settings', settingsValue('analog', { focus: 25, short: 5, long: 15 }));
    await bridge(panel, 'intention', '把眼前这件事推进一步');
    await pointerClick(panel, '#start');
    const started = service.getSnapshot();
    await pointerClick(panel, '#pin');
    assert.equal(service.getSnapshot().pinned, true); assert.equal(panel.isAlwaysOnTop(), true);
    await poll(() => page(panel, "!document.querySelector('#pin').disabled"), Boolean, '置顶按钮完成上次动作');
    await page(panel, `(() => {
      const pin = document.querySelector('#pin'); pin.focus();
      window.__pomodoroSmoke.keys = [];
      for (const type of ['keydown', 'keypress', 'keyup', 'click']) pin.addEventListener(type, event =>
        __pomodoroSmoke.keys.push({ type, key: event.key || '', trusted: event.isTrusted }));
    })()`);
    await poll(() => page(panel, "document.activeElement.id === 'pin' && !document.querySelector('#pin').disabled"), Boolean, '置顶按钮取得键盘焦点');
    await keyboard(panel, 'Enter');
    await poll(() => service.getSnapshot().pinned, value => value === false, '键盘取消置顶');
    result.keyboard = await page(panel, '({ focused: document.hasFocus(), active: document.activeElement.id, events: __pomodoroSmoke.keys })');
    assert.ok(result.keyboard.events.some(event => event.type === 'keypress' && event.key === 'Enter' && event.trusted), '真实 Enter keypress');
    assert.ok(result.keyboard.events.some(event => event.type === 'click' && event.trusted), '原生键盘触发可信按钮点击');
    assert.equal(panel.isAlwaysOnTop(), false);
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(started), '置顶不改变计时与记录');
    await pointerClick(panel, '#collapse');
    await poll(() => !panel.isVisible() && mini.isVisible(), Boolean, '收起面板保留迷你计时');
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(started));
    await pointerClick(mini, '#mini');
    await poll(() => panel.isVisible(), Boolean, '迷你入口展开面板');
    panel.close();
    await poll(() => !panel.isVisible(), Boolean, '原生 close 仅收起面板');
    assert.equal(panel.isDestroyed(), false);
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(started));
    await pointerClick(mini, '#mini');
    await poll(() => panel.isVisible(), Boolean, '原生 close 后重新展开');
    result.checks.push('pin-pointer-keyboard-and-both-close-paths-preserve-timer');

    await settingsOpen(panel);
    const unsaved = { face: 'minutes', focus: '31', short: '9', long: '21', encouragement: false };
    await setDraft(panel, unsaved);
    const beforeTick = await page(panel, '__pomodoroSmoke.states.length');
    stamp += 1000; service.tick();
    await poll(() => page(panel, '__pomodoroSmoke.states.length'), count => count > beforeTick, '每秒状态 bridge 广播');
    assert.deepEqual(await draft(panel), unsaved, '计时更新保留未保存设置草稿');
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(started));
    await settingsClose(panel);
    assert.equal(service.getSnapshot().face, 'analog'); assert.equal(service.getSnapshot().durations.focus, 25);
    await settingsOpen(panel);
    assert.deepEqual(await draft(panel), { face: 'analog', focus: '25', short: '5', long: '15', encouragement: true });
    await setDraft(panel, unsaved); await keyboard(panel, 'Escape');
    await poll(() => page(panel, "document.querySelector('#settings').hidden"), Boolean, 'Esc 放弃设置草稿');
    assert.equal(service.getSnapshot().face, 'analog'); assert.equal(service.getSnapshot().durations.focus, 25);
    await pointerClick(panel, '#pin');
    await settingsOpen(panel); await setDraft(panel, { face: 'modules', encouragement: false });
    await settingsClose(panel, '#settings button[type=submit]');
    assert.equal(service.getSnapshot().face, 'modules'); assert.equal(service.getSnapshot().pinned, true);
    assert.equal(panel.isAlwaysOnTop(), true); assert.equal(service.getSnapshot().encouragementEnabled, false);
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(started), '只改样式与鼓励保留进行中计时和已有记录');
    await settingsOpen(panel); await setDraft(panel, { face: 'analog', focus: '10', short: '2', long: '3', encouragement: true });
    await settingsClose(panel, '#settings button[type=submit]');
    assert.equal(service.getSnapshot().status, 'idle'); assert.equal(service.getSnapshot().remaining, 600);
    assert.equal(service.getSnapshot().completed, 1); assert.equal(service.getSnapshot().minutes, 6);
    assert.equal(service.getSnapshot().intention, started.intention); assert.equal(getQuiet(), false);
    result.checks.push('settings-cancel-escape-draft-updates-style-save-and-duration-reset');

    await pointerClick(panel, '#start');
    mini.webContents.debugger.attach('1.3'); debuggerAttached = true;
    await mini.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const beam = () => page(mini, `(() => {
      const el = document.querySelector('#mini-beam'), style = getComputedStyle(el, '::before');
      return { mini: document.querySelector('#mini').getBoundingClientRect().toJSON(), rim: el.getBoundingClientRect().toJSON(),
        animation: style.animationName, duration: style.animationDuration, angle: style.getPropertyValue('--pomodoro-beam-angle'),
        background: style.backgroundImage, mask: style.maskComposite, display: style.display,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
    })()`);
    const moving = await beam(); await wait(150); const moved = await beam();
    assert.equal(moving.mini.width, 100); assert.equal(moving.mini.height, 36);
    assert.equal(moving.rim.width, 100); assert.equal(moving.rim.height, 36);
    assert.equal(moving.animation, 'pomodoroBeamOrbit'); assert.equal(moving.duration, '4.5s');
    assert.match(moving.background, /conic-gradient/);
    assert.ok(moving.mask.split(',').every(value => value.trim() === 'exclude'), '流光蒙版仅保留边缘');
    assert.notEqual(moving.angle, moved.angle, '原生迷你窗边缘流光实际前进');
    await capture(mini, 'mini-flow-blue-light');
    await mini.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await poll(beam, view => view.reduced && view.animation === 'none', '减少动态效果静态边缘');
    await wait(150); assert.equal((await beam()).angle, reduced.angle, '减少动态效果不继续旋转');
    assert.equal(reduced.angle.trim(), '35deg');
    await mini.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    mini.webContents.debugger.detach(); debuggerAttached = false;
    result.beam = { moving, moved, reduced };
    result.checks.push('native-mini-100x36-flow-and-reduced-motion-static');

    const focusedBefore = BrowserWindow.getFocusedWindow();
    stamp = service.getSnapshot().deadline - 300000; service.tick();
    assert.ok(service.getSnapshot().encouragement, '10 分钟中点触发鼓励');
    await poll(() => message.isVisible(), Boolean, '鼓励独立原生窗口');
    await poll(() => page(message, "!document.querySelector('#encouragement').hidden"), Boolean, '鼓励文案渲染');
    assert.equal(message.isFocusable(), false); assert.equal(BrowserWindow.getFocusedWindow(), focusedBefore, '鼓励不抢焦点');
    assert.deepEqual(mouseCalls.get(message), { ignore: true, forward: true }, '鼓励调用原生鼠标穿透');
    const readEncouragement = () => page(message, `(() => {
      const node = document.querySelector('#encouragement'), style = getComputedStyle(node);
      return { text: node.textContent, rect: node.getBoundingClientRect().toJSON(), background: style.backgroundColor,
        opacity: style.opacity, pointerEvents: style.pointerEvents, reminderHidden: document.querySelector('#reminder').hidden };
    })()`);
    const encouragement = await poll(readEncouragement,
      view => Math.abs(message.getBounds().height - view.rect.height - 12) <= 1, '鼓励原生外框按实际卡片高度收合');
    assert.match(encouragement.background, /^rgb\(/, '鼓励采用不透明实色背景');
    assert.equal(encouragement.opacity, '1'); assert.equal(encouragement.pointerEvents, 'none');
    assert.equal(encouragement.reminderHidden, true); assert.equal(encouragement.rect.width, 184);
    assert.equal(message.getBounds().width, 196);
    assert.equal(message.getBounds().height, encouragement.rect.height + 12);
    const miniRect = await page(mini, "document.querySelector('#mini').getBoundingClientRect().toJSON()");
    encouragement.desktopGap = mini.getBounds().y + miniRect.top - message.getBounds().y - encouragement.rect.bottom;
    assert.ok(Math.abs(encouragement.desktopGap - 8) <= 1, '鼓励实际卡片底部到 mini 顶部保持 8px');
    result.encouragement = encouragement;
    const lockState = service.getSnapshot();
    powerMonitor.emit('lock-screen'); locked = true;
    await poll(() => allWindows().every(win => !win.isVisible()), Boolean, '锁屏清理全部番茄钟窗口');
    const lockedAction = await page(panel, "qiuPomodoro.action('reset')");
    assert.equal(lockedAction.ok, false, '锁屏拒绝后台窗口动作');
    stamp += 6000; service.tick();
    assert.equal(service.getSnapshot().encouragement, '', '鼓励最多显示五秒，锁屏错过不补播');
    powerMonitor.emit('unlock-screen'); locked = false;
    await poll(() => panel.isVisible() && mini.isVisible() && !message.isVisible(), Boolean, '解锁恢复计时面板，不补播过期鼓励');
    assert.equal(service.getSnapshot().deadline, lockState.deadline); assert.equal(getQuiet(), true);
    assert.equal(service.getSnapshot().remaining, lockState.remaining - 6, '锁屏继续按真实 deadline 计时');
    result.checks.push('opaque-encouragement-native-passthrough-no-focus-lock-unlock');

    await pointerClick(panel, '#start');
    const paused = service.getSnapshot(); assert.equal(paused.status, 'paused'); assert.equal(paused.deadline, 0);
    stamp += 60000; service.tick();
    assert.equal(service.getSnapshot().remaining, paused.remaining); assert.equal(getQuiet(), true);
    await pointerClick(panel, '#start');
    assert.equal(service.getSnapshot().deadline, stamp + paused.remaining * 1000, '暂停后继续按剩余秒数恢复');
    stamp = service.getSnapshot().deadline; service.tick();
    await poll(() => message.isVisible(), Boolean, '恢复后的完成提醒');
    assert.equal(service.getSnapshot().completed, 2); assert.equal(service.getSnapshot().minutes, 16); assert.equal(getQuiet(), false);
    await pointerClick(message, '#dismiss-reminder');
    await poll(() => !message.isVisible(), Boolean, '关闭完成提醒');
    assert.equal(service.getSnapshot().status, 'complete'); assert.equal(service.getSnapshot().reminder, false);
    assert.equal(mini.isVisible(), true);
    result.checks.push('pause-resume-deadline-quiet-and-dismiss');
    for (const win of allWindows()) {
      const errors = await page(win, '__pomodoroSmoke.errors');
      assert.deepEqual(errors, [], '页面没有未处理错误');
      const events = await page(win, '({ states: __pomodoroSmoke.states.length, colors: __pomodoroSmoke.colors.length })');
      assert.ok(events.states > 0, 'onState 实际收到广播');
      if (win !== message) assert.ok(events.colors > 0, 'onColorMode 实际收到广播');
    }
    assert.deepEqual(result.errors, [], '原生页面加载与渲染无错误');
    assert.equal(result.screenshots.length, 4);
    result.finalState = service.getSnapshot(); result.ok = true;
    fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`PET_POMODORO_INTEGRATION_OK ${JSON.stringify({ checks: result.checks.length, themes: result.themes.length,
      layouts: result.layouts.length, screenshots: result.screenshots.length, output })}\n`);
    return result;
  } catch (error) {
    result.failure = { message: error.message, stack: error.stack };
    result.finalState = service.getSnapshot();
    fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    throw error;
  } finally {
    if (debuggerAttached && mini && !mini.isDestroyed()) {
      try { await mini.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); } catch (_) {}
      try { mini.webContents.debugger.detach(); } catch (_) {}
    }
    if (locked) powerMonitor.emit('unlock-screen');
    BrowserWindow.prototype.setIgnoreMouseEvents = originalIgnoreMouse;
    select(`ui-theme-${original.uiTheme}`);
    select(`color-appearance-${original.codexQuotaAppearance}`);
    setMode(original.colorMode);
    setClock(Date.now);
  }
}

module.exports = { verifyPomodoro };
