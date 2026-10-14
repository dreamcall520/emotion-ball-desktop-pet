const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { capturePaintedWindow } = require('./verify-codex-companion');
const { pointerClick } = require('./verify-chat-integration');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

// Run through smoke-electron.js so main.js verifies the temporary user-data dir.
// This verifier never opens the installed app or writes its preferences.
async function verifyPomodoro({ pet, service, windows, BrowserWindow, powerMonitor,
  getMenu, getSettings, getQuiet, setClock, quotaLabel, edgeTuck, screen, notes: notesCompanion }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_POMODORO_ONLY, '1');
  assert.ok(pet && service && windows && BrowserWindow && powerMonitor && quotaLabel && edgeTuck && screen && notesCompanion);
  const output = path.resolve(process.env.PET_SMOKE_POMODORO_OUTPUT ||
    path.join(os.tmpdir(), `qiuqiu-pomodoro-native-${process.pid}`));
  fs.mkdirSync(output, { recursive: true });
  const result = { ok: false, checks: [], themes: [], layouts: [], screenshots: [], errors: [] };
  const original = { ...getSettings() }, originalPetBounds = pet.getBounds();
  let stamp = Date.now(), locked = false, debuggerAttached = false, mini;
  const temporaryTodos = new Set();
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
  const ordinaryBubbleVisible = () => BrowserWindow.getAllWindows().some(win => !win.isDestroyed() && win.isVisible() &&
    win.webContents.getURL().endsWith('/bubble.html'));
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
    const before = { nativeFocused: panel.isFocused(), visible: panel.isVisible(),
      ...(await page(panel, '({focused:document.hasFocus(),hidden:document.hidden})')) };
    (result.settingsPointerFocus ||= []).push(before);
    require('electron').app.focus({ steal: true }); panel.focus(); panel.webContents.focus();
    await poll(async () => panel.isFocused() && panel.isVisible() &&
      await page(panel, 'document.hasFocus() && !document.hidden'), Boolean, '设置点击前原生输入焦点');
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
    const header = document.querySelector(editing ? '.settings-head' : '.panel-header');
    const controls = editing ? ['#settings-close', '#settings-cancel', '#settings button[type=submit]', '[name=focus]'] :
      ['#pin', '#settings-open', '#collapse', '.modes button', '#intention', '#start', '#reset'];
    return { width: innerWidth, height: innerHeight, face: document.querySelector('#focus-panel').dataset.face, editing,
      scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
      panel: rect('#focus-panel'), nodes: selectors.map(selector => ({ selector, ...rect(selector) })),
      drag: { header: header.getBoundingClientRect().toJSON(), region: getComputedStyle(header).getPropertyValue('-webkit-app-region'),
        points: [[160,8],[10,28],[160,52]].map(([x,y]) => ({ x, y, covered: header.contains(document.elementFromPoint(x,y)) })),
        controls: controls.map(selector => ({ selector, region: getComputedStyle(document.querySelector(selector)).getPropertyValue('-webkit-app-region') })) },
      settings: editing ? { form: rect('#settings'), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null };
  })()`);
  const assertLayout = (view, win, face, editing) => {
    const height = editing || face !== 'analog' ? 384 : 476;
    const native = win.getContentBounds();
    assert.equal(view.width, 320); assert.equal(view.height, height);
    assert.equal(native.width, 320); assert.equal(native.height, height);
    assert.equal(view.face, face); assert.equal(view.editing, editing);
    assert.ok(view.scrollWidth <= 320 && view.bodyScrollWidth <= 320, '面板没有横向溢出');
    assert.equal(view.drag.region, 'drag');
    assert.ok(view.drag.header.left <= 1 && view.drag.header.top <= 1 && view.drag.header.right >= 319 && view.drag.header.bottom >= 54,
      '顶部拖动区覆盖整幅顶边与标题区');
    assert.ok(view.drag.points.every(point => point.covered), '顶部空白与标题上下留白均在拖动区内');
    assert.ok(view.drag.controls.every(control => control.region === 'no-drag'), '工具栏、模式与输入等操作明确排除拖动');
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
  const reminderGeometry = win => page(win, `(() => {
    const card = document.querySelector('#reminder'), rect = card.getBoundingClientRect();
    const buttons = [...card.querySelectorAll('.reminder-actions button')].filter(button => !button.hidden);
    return { height: rect.height, buttons: buttons.map(button => button.id),
      bottomGap: rect.bottom - buttons.at(-1).getBoundingClientRect().bottom,
      scrollHeight: card.scrollHeight, clientHeight: card.clientHeight };
  })()`);
  const keyboard = async (win, keyCode) => {
    require('electron').app.focus({ steal: true });
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
    assert.ok(index > 1);
    assert.equal(menu.items[index - 2].label, '便签与待办');
    assert.equal(menu.items[index - 1].id, 'shortcut-settings', '快捷键设置位于番茄钟上方');
    assert.equal(menu.items[index - 1].label, '快捷键设置');
    assert.equal(menu.items[index].label, '番茄钟');
    assert.equal(service.getSnapshot().face, 'analog', '新安装默认刻度表盘');
    assert.equal(service.getSnapshot().status, 'idle');
    select('pomodoro-open');
    const panel = await ready('panel');
    await poll(() => panel.isVisible(), Boolean, '面板可见');
    assert.equal(find('mini'), undefined, '空闲时打开面板不创建无任务 mini');
    assert.equal((await load(panel)).panelOpen, true);
    assert.deepEqual(await page(panel, 'Object.keys(qiuPomodoro).sort()'), ['action', 'load', 'onColorMode', 'onState']);
    await pointerClick(panel, '#start'); mini = await ready('mini');
    await poll(() => mini.isVisible(), Boolean, '实际开始计时后出现 mini');
    assert.equal((await load(mini)).face, 'analog');
    const invalidMini = await page(mini, "qiuPomodoro.action('reset')");
    assert.equal(invalidMini.ok, false, '迷你入口不能越权重置计时');

    const panelBeforeMove = panel.getBounds(), petBeforeMove = pet.getBounds();
    const panelArea = screen.getDisplayMatching(panelBeforeMove).workArea;
    panel.setPosition(Math.round(panelArea.x + (panelArea.width - panelBeforeMove.width) / 2),
      Math.round(panelArea.y + (panelArea.height - panelBeforeMove.height) / 2), false);
    const retainedPanel = panel.getBounds(), timerBeforeMove = timerIdentity(service.getSnapshot());
    result.panelMovement = [];
    for (const offset of [-80, 80, -40, 40]) {
      pet.setPosition(Math.round(retainedPanel.x + offset), Math.round(retainedPanel.y + 180), false);
      quotaLabel.show({ state: 'ready', items: [{ label: 'Codex', windowMinutes: 10080, remaining: 79 }] });
      await poll(() => quotaLabel.getWindow()?.isVisible(), Boolean, '球球移动时额度卡可见');
      windows.reposition();
      for (let sample = 0; sample < 3; sample++) {
        await wait(30);
        const bounds = panel.getBounds();
        assert.deepEqual(bounds, retainedPanel, '球球及额度卡移动不得覆盖番茄钟主面板的手动位置');
        result.panelMovement.push({ pet: pet.getBounds(), quota: quotaLabel.getWindow().getBounds(), panel: bounds });
      }
    }
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerBeforeMove, '布局重排不改变计时任务');
    quotaLabel.hide(); pet.setBounds(petBeforeMove, false); panel.setBounds(panelBeforeMove, false); windows.sync();
    result.checks.push('opened-panel-retains-manual-position-through-pet-and-quota-movement');
    fs.writeFileSync(path.join(output, 'panel-after-move-focus.json'), JSON.stringify({native: panel.isFocused(), document: await page(panel, 'document.hasFocus()'), bounds: panel.getBounds()}, null, 2));
    require('electron').app.focus({ steal: true }); panel.focus(); panel.webContents.focus();
    await poll(() => page(panel, 'document.hasFocus()'), Boolean, '恢复移动后面板的原生输入焦点');
    await pointerClick(panel, '#reset');
    await poll(() => !mini.isVisible(), Boolean, '重置回空闲后收起 mini');
    result.checks.push('menu-default-native-bridge');

    for (const value of ['green', 'blue']) for (const light of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
      const paint = await theme(panel, value, light, mode);
      result.themes.push({ ...paint, requested: { value, light, mode } });
      for (const face of ['analog', 'timeline', 'modules', 'minutes']) {
        await bridge(panel, 'settings', settingsValue(face));
        await poll(() => geometry(panel), view => view.face === face && view.height === (face === 'analog' ? 476 : 384), '表盘尺寸更新');
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
    assert.equal(getSettings().bubblesEnabled, true);
    await page(pet, "petDesktop.say('play')"); await wait(100);
    assert.equal(ordinaryBubbleVisible(), false, '真实 pet:say 在专注中不显示普通互动气泡');
    await pointerClick(panel, '#start');
    assert.equal(service.getSnapshot().status, 'paused'); assert.equal(getQuiet(), true);
    await page(pet, "petDesktop.say('play')"); await wait(100);
    assert.equal(ordinaryBubbleVisible(), false, '专注暂停仍屏蔽普通互动气泡');
    await pointerClick(panel, '#start');
    stamp = service.getSnapshot().deadline; service.tick();
    const message = await ready('message');
    await poll(() => message.isVisible(), Boolean, '完成提醒原生窗口');
    assert.equal(mini.isVisible(), false, '完成提醒期间收起 mini');
    await poll(() => page(message, "!document.querySelector('#reminder').hidden"), Boolean, '完成提醒渲染');
    assert.equal(service.getSnapshot().completed, 1); assert.equal(getQuiet(), false);
    assert.equal(message.isFocusable(), false);
    assert.deepEqual(mouseCalls.get(message), { ignore: false, forward: true }, '完成提醒可接收按钮点击');
    const focusReminder = await reminderGeometry(message);
    assert.equal(message.getContentBounds().height, 188); assert.equal(focusReminder.height, 176);
    assert.deepEqual(focusReminder.buttons, ['rest-now', 'five-more']);
    await capture(message, 'completion-blue-light');
    await pointerClick(message, '#five-more');
    await poll(() => mini.isVisible() && !message.isVisible(), Boolean, '继续专注计时恢复 mini');
    assert.equal(service.getSnapshot().total, 300); assert.equal(service.getSnapshot().extension, true);
    assert.equal(service.getSnapshot().completed, 1); assert.equal(getQuiet(), true);
    stamp = service.getSnapshot().deadline; service.tick();
    assert.equal(service.getSnapshot().completed, 1); assert.equal(service.getSnapshot().minutes, 6, '加时增加分钟，不重复计次');
    await poll(() => message.isVisible(), Boolean, '加时完成提醒');
    await pointerClick(message, '#rest-now');
    assert.equal(service.getSnapshot().mode, 'short'); assert.equal(service.getSnapshot().status, 'running');
    await poll(() => mini.isVisible() && !message.isVisible(), Boolean, '开始休息计时恢复 mini');
    assert.equal(getQuiet(), false, '休息时恢复陪伴提示');
    await page(pet, "petDesktop.say('play')");
    await poll(ordinaryBubbleVisible, Boolean, '休息时允许真实手动互动气泡，专注期间未占用冷却');
    stamp = service.getSnapshot().deadline; service.tick();
    await poll(() => page(message, "document.querySelector('#five-more').hidden"), Boolean, '休息完成状态');
    assert.equal(mini.isVisible(), false, '休息完成时不重复显示 mini');
    const restReminder = await reminderGeometry(message);
    assert.equal(message.getContentBounds().height, 164); assert.equal(restReminder.height, 152);
    assert.deepEqual(restReminder.buttons, ['rest-now']);
    assert.ok(Math.abs(focusReminder.bottomGap - 20) <= 1, '双按钮完成卡底部留白紧凑');
    assert.ok(Math.abs(restReminder.bottomGap - 18) <= 1, '单按钮休息卡没有保留第二按钮空位');
    assert.ok(restReminder.scrollHeight <= restReminder.clientHeight + 1, '紧凑休息卡没有裁切');
    result.reminders = { focus: focusReminder, rest: restReminder };
    await capture(message, 'rest-completion-blue-light');
    await pointerClick(message, '#rest-now');
    assert.equal(service.getSnapshot().mode, 'focus'); assert.equal(service.getSnapshot().status, 'running');
    assert.equal(mini.isVisible(), true, '下一次专注恢复 mini');
    assert.equal(service.getSnapshot().completed, 1);
    await poll(() => !ordinaryBubbleVisible(), Boolean, '下一次专注收起休息时已有互动气泡');
    result.checks.push('focus-completion-extend-and-rest-through-message-bridge');

    await bridge(panel, 'settings', settingsValue('analog', { focus: 25, short: 5, long: 15 }));
    await bridge(panel, 'intention', '把眼前这件事推进一步');
    await pointerClick(panel, '#start');
    const started = service.getSnapshot();
    stamp += 17000; service.tick();
    const running = service.getSnapshot(), positionBeforeTab = panel.getPosition();
    await pointerClick(panel, '.modes [data-mode=focus]');
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(running), '运行中再次点击当前模式保留deadline、status及已有记录');
    assert.equal(service.getSnapshot().remaining, running.remaining, '运行中再次点击当前模式不恢复完整时长');
    assert.equal(getQuiet(), true); assert.deepEqual(panel.getPosition(), positionBeforeTab, '点击模式不拖动窗口');
    await pointerClick(panel, '#start');
    const sameModePaused = service.getSnapshot();
    await pointerClick(panel, '.modes [data-mode=focus]');
    assert.deepEqual(timerIdentity(service.getSnapshot()), timerIdentity(sameModePaused), '暂停时再次点击当前模式保持暂停');
    assert.equal(service.getSnapshot().remaining, sameModePaused.remaining); assert.equal(getQuiet(), true);
    await pointerClick(panel, '#start');
    const resumedAfterTab = service.getSnapshot();
    assert.equal(resumedAfterTab.deadline, running.deadline);
    result.sameMode = { running, paused: sameModePaused, resumed: resumedAfterTab };
    result.checks.push('current-mode-pointer-click-preserves-running-paused-countdown-and-position');
    await page(panel, `(() => {
      __pomodoroSmoke.pinDisabledButtons = [];
      new MutationObserver(records => {
        for (const record of records) if (record.attributeName === 'disabled')
          __pomodoroSmoke.pinDisabledButtons.push(record.target.id);
      }).observe(document.querySelector('#focus-panel'), { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    })()`);
    await pointerClick(panel, '#pin');
    assert.equal(service.getSnapshot().pinned, true); assert.equal(panel.isAlwaysOnTop(), true);
    assert.deepEqual(await page(panel, '__pomodoroSmoke.pinDisabledButtons'), [], '置顶不短暂禁用主操作按钮，避免色弱友好模式按钮边框闪现');
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
    assert.equal(result.keyboard.active, 'pin', '置顶完成后保留键盘焦点');
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
    result.miniAccessible = [];
    for (const light of ['light','dark']) {
      await theme(panel,'blue',light,'accessible');
      await poll(()=>mini.isVisible(),Boolean,'色弱mini实际可见');
      const decoration = await page(mini,`(() => {const node=document.getElementById('mini'),style=getComputedStyle(node),arrow=getComputedStyle(node,'::after'),root=getComputedStyle(document.documentElement);
        return {outer:style.borderTopColor,pill:getComputedStyle(document.getElementById('mini-label')).borderTopColor,
          arrow:arrow.borderRightColor,background:style.backgroundColor,arrowBackground:arrow.backgroundColor,
          divider:root.getPropertyValue('--accessible-divider').trim(),line:root.getPropertyValue('--accessible-line').trim()};})()`);
      const rgb = hex => { assert.match(hex,/^#[\da-f]{6}$/i);return 'rgb('+[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)).join(', ')+')'; };
      assert.equal(decoration.outer,rgb(decoration.divider),'色弱mini装饰外框使用轻分隔线');
      assert.equal(decoration.arrow,decoration.outer,'箭头与外框同色连续');
      assert.equal(decoration.arrowBackground,decoration.background,'箭头与卡面同色连续');
      assert.equal(decoration.pill,rgb(decoration.line),'模式pill保留清晰控件边界');
      result.miniAccessible.push({light,...decoration});await capture(mini,'mini-accessible-'+light);
    }
    await theme(panel,'blue','light','standard');
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
    assert.equal(mini.isVisible(), false, '完成状态收起 mini');
    assert.equal(service.getSnapshot().completed, 2); assert.equal(service.getSnapshot().minutes, 16); assert.equal(getQuiet(), false);
    await pointerClick(message, '#dismiss-reminder');
    await poll(() => !message.isVisible(), Boolean, '关闭完成提醒');
    assert.equal(service.getSnapshot().status, 'complete'); assert.equal(service.getSnapshot().reminder, false);
    assert.equal(mini.isVisible(), false, '关闭完成提示后没有计时任务，mini 仍隐藏');
    await bridge(panel, 'close-panel'); select('pomodoro-open');
    await poll(() => panel.isVisible(), Boolean, '完成状态可以主动打开面板');
    assert.equal(mini.isVisible(), false, '完成状态打开面板也不显示无任务 mini');
    result.checks.push('pause-resume-deadline-quiet-and-dismiss');

    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const painted = win => { const b = win.getBounds(); return { x: b.x + 6, y: b.y + 6, width: b.width - 12, height: b.height - 12 }; };
    const inArea = bounds => bounds.x >= area.x && bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
    const anchorState = async () => {
      const target = quotaLabel.getWindow();
      let quota = null;
      if (target?.isVisible()) {
        const rect = await page(target, `(() => {
          const card = document.querySelector('#quota-label');
          return card?.dataset.hasItems === 'true' ? card.getBoundingClientRect().toJSON() : null;
        })()`);
        if (rect) {
          const bounds = target.getBounds();
          quota = { x: bounds.x + rect.x, y: bounds.y + rect.y, width: rect.width, height: rect.height };
        }
      }
      const pointer = await page(mini,`(() => {const node=document.getElementById('mini'),style=getComputedStyle(node,'::after');return {
        side:node.dataset.arrow,offset:node.style.getPropertyValue('--mini-arrow-offset'),top:style.top,bottom:style.bottom};})()`);
      return { quota, reportedQuota: quotaLabel.getVisibleBounds(), mini: painted(mini), pet: pet.getBounds(), pointer,
        presentation: edgeTuck.getPresentation(), focus: BrowserWindow.getFocusedWindow()?.id || null };
    };
    const onQuota = value => value.quota && value.reportedQuota &&
      ['x', 'y', 'width', 'height'].every(key => Math.abs(value.quota[key] - value.reportedQuota[key]) <= 1) &&
      Math.abs(value.mini.x + value.mini.width / 2 - value.quota.x - value.quota.width / 2) <= 1 &&
      Math.abs(value.quota.y - value.mini.y - value.mini.height - 8) <= 1;
    const quotaModel = { state: 'ready', items: [{ label: 'Codex', windowMinutes: 10080, remaining: 79 }] };
    core('reset'); core('toggle'); core('toggle');
    await bridge(panel, 'close-panel');
    assert.equal(getQuiet(), true, '贴边布局不改变专注暂停静默');
    result.edgeAnchors = [];
    for (const side of ['left', 'right']) {
      edgeTuck.restore();
      pet.setPosition(Math.round(area.x + area.width / 2), Math.round(area.y + area.height * .65), false);
      edgeTuck.dock(side);
      const petBounds = pet.getBounds();
      edgeTuck.sampleCursor({ x: petBounds.x + (side === 'left' ? 5 : petBounds.width - 5), y: petBounds.y + petBounds.height / 2 });
      edgeTuck.pin(true);
      await poll(() => edgeTuck.getPresentation().mode, value => value === 'peeked', `${side} 真实半露状态`);
      const focus = BrowserWindow.getFocusedWindow();
      quotaLabel.show(quotaModel);
      const folded = await poll(anchorState, onQuota, `${side} 真实可见额度卡上方居中 8px`);
      assert.equal(folded.presentation.side, side); assert.equal(mini.isFocusable(), false);
      assert.equal(BrowserWindow.getFocusedWindow(), focus, '额度锚与 mini 同步不抢焦点');
      const quotaWindow = quotaLabel.getWindow();
      await pointerClick(quotaWindow, '#quota-label');
      const expanded = await poll(anchorState, value => onQuota(value) && value.quota.width === 196 && value.quota.height > 58,
        `${side} 展开额度详情后 mini 跟随真实边界`);
      pet.setPosition(petBounds.x, petBounds.y + 24, false);
      const movedQuota = await poll(anchorState, value => onQuota(value) && value.quota.y !== expanded.quota.y,
        `${side} 球球移动后额度与 mini 同步`);
      quotaLabel.show({ state: 'empty', items: [] });
      const empty = await poll(anchorState, value => value.quota === null && value.reportedQuota === null && value.pet.y - value.mini.y - value.mini.height === 14,
        `${side} 无额度数据回退球锚`);
      assert.equal(quotaWindow.isVisible(), true, '空数据卡仍可见，但不作为番茄锚');
      quotaLabel.hide();
      const hidden = await poll(anchorState, value => value.quota === null && value.reportedQuota === null && value.pet.y - value.mini.y - value.mini.height === 14,
        `${side} 额度隐藏回退球锚`);
      quotaLabel.show(quotaModel);
      const restored = await poll(anchorState, onQuota, `${side} 恢复额度后重接真实锚`);
      core('reset'); core('toggle');
      // The isolated profile has Codex disabled. Quiet transitions refresh its
      // real visibility policy, so re-show the demo after starting focus.
      quotaLabel.show(quotaModel);
      await poll(anchorState, onQuota, `${side} 专注开始后恢复临时额度模型`);
      stamp = service.getSnapshot().deadline - service.getSnapshot().total * 500; service.tick();
      await poll(() => message.isVisible() && service.getSnapshot().encouragement, Boolean, `${side} 贴边鼓励显示`);
      const encouraged = await poll(async () => ({ ...await anchorState(), message: painted(message) }), value =>
        onQuota(value) && value.mini.y - value.message.y - value.message.height === 8, `${side} 鼓励跟随 mini 锚`);
      assert.equal(message.isFocusable(), false); assert.deepEqual(mouseCalls.get(message), { ignore: true, forward: true });
      stamp += 6000; service.tick(); core('toggle');
      await poll(() => !message.isVisible(), Boolean, '鼓励过期收起');
      if (side === 'right') {
        await capture(mini, 'edge-right-mini'); await capture(quotaWindow, 'edge-right-quota');
      }
      result.edgeAnchors.push({ side, folded, expanded, movedQuota, empty, hidden, restored, encouraged });
    }
    result.dragOutAnchors = [];
    const visualPet = value => petVisualBounds(value.pet,getSettings().customization.appearance.shape,value.presentation);
    const onHead = value => { const visual=visualPet(value);return Math.abs(visual.y-value.mini.y-value.mini.height-14)<=1 &&
      Math.abs(value.mini.x+value.mini.width/2-visual.x-visual.width/2)<=1 && value.pointer.side==='bottom'; };
    for (const side of ['left','right']) {
      edgeTuck.restore();pet.setPosition(Math.round(area.x+area.width/2),Math.round(area.y+area.height*.6),false);edgeTuck.dock(side);
      const docked=pet.getBounds();edgeTuck.sampleCursor({x:docked.x+(side==='left'?5:docked.width-5),y:docked.y+docked.height/2});
      edgeTuck.pin(true);quotaLabel.show(quotaModel);await poll(anchorState,onQuota,side+'拖出前保持真实额度锚');
      edgeTuck.beginDrag();pet.setPosition(Math.round(area.x+(area.width-docked.width)/2),Math.round(area.y+area.height*.6),false);
      quotaLabel.show(quotaModel);windows.reposition();
      const dragging=await poll(anchorState,value=>value.presentation.dragging&&onHead(value),side+'真实drag期间立即回到当前可见球体头顶');
      edgeTuck.endDrag(true);windows.reposition();
      const free=await poll(anchorState,value=>value.presentation.mode==='free'&&onHead(value),side+'松手自由态仍保持头顶');
      result.dragOutAnchors.push({side,dragging,free});
    }
    edgeTuck.restore();pet.setPosition(Math.round(area.x+(area.width-pet.getBounds().width)/2),area.y,false);
    quotaLabel.show(quotaModel);windows.reposition();
    result.topQuotaAnchor=await poll(anchorState,value=>value.quota && value.reportedQuota &&
      Math.abs(value.mini.x+value.mini.width/2-value.quota.x-value.quota.width/2)<=1 &&
      Math.abs(value.mini.y-value.quota.y-value.quota.height-8)<=1 &&value.pointer.side==='top'&&value.pointer.top==='-3px',
    '屏顶mini在真实卡面下方居中8px，上沿箭头指向球体');
    await capture(mini,'top-quota-centered-mini');
    edgeTuck.dock('right');
    await poll(() => edgeTuck.getPresentation().mode === 'tucked' && !quotaLabel.getWindow().isVisible(), Boolean, '收球时额度隐藏');
    select('pomodoro-open');
    await poll(() => panel.isVisible() && mini.isVisible(), Boolean, '球体贴边收起时仍可打开番茄钟面板');
    assert.equal(edgeTuck.getPresentation().mode, 'tucked', '打开番茄钟不拉出贴边球体');
    assert.equal(getQuiet(), true);
    core('toggle'); stamp = service.getSnapshot().deadline; service.tick();
    await poll(() => message.isVisible(), Boolean, '球体贴边收起时专注完成提示仍显示');
    assert.equal(message.getBounds().height, 188);
    for (const win of [panel, message]) assert.ok(inArea(win.getBounds()), '贴边番茄窗均在工作区内');
    assert.equal(mini.isVisible(), false, '贴边完成提示收起 mini');
    assert.equal(overlaps(painted(message), panel.getBounds()), false, '贴边完成提示避开面板');
    await capture(message, 'tucked-completion-blue-light');
    core('rest'); assert.equal(getQuiet(), false, '贴边休息仍允许普通互动');
    assert.equal(mini.isVisible(), true, '贴边开始休息恢复 mini');
    assert.equal(panel.isVisible(), true); stamp = service.getSnapshot().deadline; service.tick();
    await poll(() => message.isVisible() && message.getBounds().height === 164, Boolean, '贴边休息完成卡保持紧凑可见');
    assert.equal(mini.isVisible(), false, '贴边休息完成也收起 mini');
    result.tucked = { presentation: edgeTuck.getPresentation(), panel: panel.getBounds(), mini: mini.getBounds(),
      message: message.getBounds(), state: service.getSnapshot() };
    edgeTuck.hide();
    await poll(() => allWindows().every(win => !win.isVisible()), Boolean, '真正隐藏球球仍隐藏全部番茄窗');
    edgeTuck.restore(); pet.setBounds(originalPetBounds, false); quotaLabel.hide();
    await poll(() => panel.isVisible() && !mini.isVisible() && message.isVisible(), Boolean, '恢复球球后只恢复完成提示与面板');
    result.checks.push('edge-quota-native-anchor-follow-empty-hidden-fallback-and-tucked-panel-reminders');

    await bridge(panel, 'close-panel');
    pet.setPosition(Math.round(area.x + area.width * .55), Math.round(area.y + area.height * .65), false);
    const M = require('../lib/notes-model');
    const todoStore = notesCompanion.getStore();
    const clearTodo = id => todoStore.update(state => { state.todos = state.todos.filter(item => item.id !== id); return state; });
    const addTodo = () => {
      const time = Date.now(), todo = { ...M.newTodo('待办提醒与番茄钟位置验收', time), reminderAt: time - 1000, reminderState: 'pending' };
      temporaryTodos.add(todo.id);
      todoStore.update(state => { state.todos.push(todo); return state; });
      return todo.id;
    };
    const finishFocus = () => { core('reset'); core('toggle'); stamp = service.getSnapshot().deadline; service.tick(); };
    const abovePet = () => {
      const p = pet.getBounds(), b = message.getBounds();
      return b.x === Math.round(Math.max(area.x, Math.min(p.x + (p.width - b.width) / 2, area.x + area.width - b.width))) &&
        b.y + b.height === p.y - 8;
    };
    result.reminderPlacement = [];
    let normalTodoBounds;
    core('mode', 'focus'); core('reset');
    for (const order of ['todo-first', 'pomodoro-first']) {
      let todoId;
      if (order === 'todo-first') todoId = addTodo(); else finishFocus();
      if (order === 'pomodoro-first') {
        await poll(() => message.isVisible() && abovePet(), Boolean, '无待办时完成提示球上方居中');
        assert.equal(mini.isVisible(), false, '完成卡出现时收起 mini');
        todoId = addTodo();
      }
      const todoWindow = await poll(() => notesCompanion.getWindows().reminder, win => Boolean(win && win.isVisible()), '真实到期待办提醒');
      observe(todoWindow);
      const before = todoWindow.getBounds();
      if (!normalTodoBounds) normalTodoBounds = before;
      else assert.deepEqual(before, normalTodoBounds, '完成先出现时，待办仍使用自己的既有位置');
      if (order === 'todo-first') finishFocus();
      const positioned = await poll(() => ({ todo: todoWindow.getBounds(), completion: message.getBounds(), miniVisible: mini.isVisible() }),
        view => message.isVisible() && !overlaps(painted(message), view.todo), `${order} 完成卡即时避开待办`);
      assert.deepEqual(positioned.todo, before, '完成避让不移动待办');
      assert.equal(positioned.miniVisible, false, '两种到达顺序都收起 mini');
      assert.equal(message.isFocusable(), false);
      for (const bounds of [positioned.todo, positioned.completion]) assert.ok(inArea(bounds), '同时提醒都在工作区内');
      result.reminderPlacement.push({ order, ...positioned });
      if (order === 'pomodoro-first') {
        await capture(todoWindow, 'coexisting-todo-blue-light'); await capture(message, 'coexisting-completion-blue-light');
      }
      clearTodo(todoId); temporaryTodos.delete(todoId);
      await poll(() => !todoWindow.isVisible() && abovePet(), Boolean, '待办关闭后完成提示回到球上方');
      core('reset');
    }
    finishFocus();
    for (const side of ['left', 'right']) {
      edgeTuck.dock(side);
      await poll(() => message.isVisible() && abovePet(), Boolean, `${side} 贴边完成提示横向夹紧后保持球上方`);
      assert.equal(message.getBounds().x, side === 'left' ? area.x : area.x + area.width - message.getBounds().width);
      assert.equal(mini.isVisible(), false, '贴边完成卡收起 mini');
      result.reminderPlacement.push({ side, pet: pet.getBounds(), completion: message.getBounds(), miniVisible: mini.isVisible() });
      if (side === 'right') await capture(message, 'edge-completion-blue-light');
    }
    edgeTuck.restore(); pet.setBounds(originalPetBounds, false);
    result.checks.push('completion-pet-anchor-priority-two-native-todo-arrival-orders-and-edge-clamp');
    for (const win of allWindows()) {
      const errors = await page(win, '__pomodoroSmoke.errors');
      assert.deepEqual(errors, [], '页面没有未处理错误');
      const events = await page(win, '({ states: __pomodoroSmoke.states.length, colors: __pomodoroSmoke.colors.length })');
      assert.ok(events.states > 0, 'onState 实际收到广播');
      if (win !== message) assert.ok(events.colors > 0, 'onColorMode 实际收到广播');
    }
    assert.deepEqual(result.errors, [], '原生页面加载与渲染无错误');
    assert.equal(result.screenshots.length, 14, '原11图加浅深色mini与顶部定位3图');
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
    if (temporaryTodos.size) notesCompanion.getStore().update(state => {
      state.todos = state.todos.filter(item => !temporaryTodos.has(item.id)); return state;
    });
    edgeTuck.restore(); pet.setBounds(originalPetBounds, false); quotaLabel.hide();
    BrowserWindow.prototype.setIgnoreMouseEvents = originalIgnoreMouse;
    select(`ui-theme-${original.uiTheme}`);
    select(`color-appearance-${original.codexQuotaAppearance}`);
    setMode(original.colorMode);
    setClock(Date.now);
  }
}

module.exports = { verifyPomodoro };
