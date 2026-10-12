const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { loadSettings } = require('../lib/settings');

// The smoke runner supplies a separate profile; no installed settings are read.
async function verifyShortcuts({ pet, controller, registrar, screen, BrowserWindow, globalShortcut,
  edgeTuck, powerMonitor, settingsFile, getMenu, getSettings, getWindows, pomodoro }) {
  const output = path.resolve(process.env.PET_SMOKE_SHORTCUT_OUTPUT || path.join(os.tmpdir(), `qiuqiu-shortcuts-${process.pid}`));
  fs.mkdirSync(output, { recursive: true });
  const result = { ok: false, checks: [], themes: [], listThemes: [], layouts: [], displays: screen.getAllDisplays().map(({ id, workArea, scaleFactor }) => ({ id, workArea, scaleFactor })) };
  const original = pet.getBounds(), originalCursor = screen.getCursorScreenPoint;
  const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
  const ignores = new WeakMap();
  BrowserWindow.prototype.setIgnoreMouseEvents = function (value, options) { ignores.set(this, value); return originalIgnore.call(this, value, options); };
  let cursor = { x: original.x - 100, y: original.y - 100 };
  screen.getCursorScreenPoint = () => cursor;
  const poll = async (read, test, label) => { for (let i = 0; i < 150; i++) { const value = await read(); if (test(value)) return value; await wait(30); } assert.fail(label); };
  const page = (win, code) => win.webContents.executeJavaScript(code, true);
  const ready = async () => { const win = await poll(() => controller.getWindow(), Boolean, 'shortcut window missing');
    await poll(() => win.isVisible() && !win.webContents.isLoading(), Boolean, 'shortcut window not ready');
    await poll(() => page(win, 'Boolean(document.querySelector("[data-action]"))'), Boolean, 'shortcut actions not rendered'); return win; };
  const save = async (win, config) => { controller.open({ settings: true }); await wait(60);
    const reply = await page(win, `qiuShortcuts.save(${JSON.stringify(config)})`); assert.equal(reply.ok, true, reply.error); await wait(60); return reply; };
  const settled = async win => {
    const expected = controller.getState();
    await poll(() => page(win, `document.body.dataset.session === ${JSON.stringify(String(expected.session))} && document.body.dataset.view === ${JSON.stringify(expected.view)} && document.body.dataset.phase === ${JSON.stringify(expected.animation.phase)}`), Boolean, 'renderer receives current shortcut session');
    await page(win, `(async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity && a.playState !== 'finished');
      if (!active.length) return;
      await Promise.allSettled(active.map(a => a.finished));
    }
    throw new Error('shortcut animations did not settle');
  })()`);
  };
  const capture = async (win, name) => { await settled(win); await wait(40); fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()); };
  const inside = (r, a) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height;
  const compactList = async win => {
    await settled(win);
    const surface = await page(win, `(() => {
      const panel = document.querySelector('.list-panel'), actions = document.querySelector('.list-actions');
      const rect = node => node.getBoundingClientRect().toJSON();
      return {theme:document.documentElement.dataset.uiTheme,appearance:document.documentElement.dataset.appearance,mode:document.documentElement.dataset.colorMode,
        panel:rect(panel),actions:rect(actions),scrollHeight:actions.scrollHeight,clientHeight:actions.clientHeight,
        header:rect(panel.querySelector('.panel-header')),footer:rect(panel.querySelector('.list-footer')),
        keysVisible:Boolean(document.querySelector('#launcher-keys').getClientRects().length),hintVisible:Boolean(panel.querySelector('.list-footer>span').getClientRects().length),
        horizontal:[panel,...panel.querySelectorAll('.panel-header,.list-footer,.action')].map(node=>({width:node.clientWidth,scroll:node.scrollWidth})),
        buttons:[...actions.querySelectorAll('[data-action]')].map(node=>({id:node.dataset.action,...rect(node),font:parseFloat(getComputedStyle(node.querySelector('.action-name')).fontSize),nameWidth:node.querySelector('.action-name').clientWidth,nameScroll:node.querySelector('.action-name').scrollWidth}))};
    })()`);
    assert.deepEqual({ width: win.getBounds().width, height: win.getBounds().height }, { width: 320, height: 326 });
    assert.equal(surface.panel.width, 304); assert.equal(surface.panel.height, 310);
    assert.equal(surface.header.height, 46); assert.equal(surface.footer.height, 32);
    assert.equal(surface.buttons.length, 5); assert.ok(surface.buttons.every(button => button.height === 44 && button.font === 14));
    assert.ok(surface.scrollHeight <= surface.clientHeight + 1, 'all five compact list rows fit without scrolling');
    assert.ok(surface.buttons.every(button => button.y >= surface.actions.y - 1 && button.bottom <= surface.actions.bottom + 1), 'all list rows are fully visible');
    assert.ok(surface.horizontal.every(node => node.scroll <= node.width + 1), 'compact panel, header, footer and rows do not overflow horizontally');
    assert.ok(surface.buttons.every(button => button.nameScroll <= button.nameWidth + 1), 'action names remain complete');
    assert.equal(surface.keysVisible, true); assert.equal(surface.hintVisible, true);
    return surface;
  };
  try {
    assert.equal(process.env.PET_SMOKE_TEST, '1');
    assert.equal(registrar.getConfig().launcher, 'Ctrl+Alt+Q');
    assert.equal(globalShortcut.isRegistered('Ctrl+Alt+Q'), true, 'real OS registration');
    result.checks.push('native-global-registration');
    cursor = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
    const focused = BrowserWindow.getFocusedWindow();
    controller.sampleCursor(cursor); await wait(300); assert.equal(controller.isOpen(), false, 'hover waits');
    await wait(220); const win = await ready();
    assert.equal(BrowserWindow.getFocusedWindow(), focused, 'hover must not take focus');
    assert.equal(await page(win, 'typeof require'), 'undefined');
    const prefs = win.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    result.checks.push('hover-delay-no-focus-and-sandbox');
    controller.sampleCursor(cursor); assert.equal(ignores.get(win), true, 'transparent region over pet passes through');
    const first = controller.getState().layout.items[0], frame = win.getBounds();
    cursor = { x: frame.x + first.x + first.width / 2, y: frame.y + first.y + first.height / 2 };
    controller.sampleCursor(cursor); assert.equal(ignores.get(win), false, 'card receives mouse');
    result.checks.push('transparent-hit-testing');
    cursor = { x: -10000, y: -10000 }; controller.sampleCursor(cursor); await wait(720);
    assert.equal(controller.isOpen(), false); result.checks.push('hover-leave-close');
    controller.open(); await ready();
    await page(win, `qiuShortcuts.openSettings()`); await wait(80);
    const invalid = await page(win, `qiuShortcuts.save({...${JSON.stringify(registrar.getConfig())},chat:'Ctrl+Alt+Q'})`);
    assert.equal(invalid.ok, false); assert.equal(registrar.getConfig().chat, '');
    result.checks.push('duplicate-save-keeps-previous');
    assert.equal(globalShortcut.register('Ctrl+Alt+2', () => {}), true);
    try {
      const conflict = await page(win, `qiuShortcuts.save({...${JSON.stringify(registrar.getConfig())},chat:'Ctrl+Alt+2'})`);
      assert.equal(conflict.ok, false); assert.equal(registrar.getConfig().chat, '');
      assert.equal(globalShortcut.isRegistered('Ctrl+Alt+Q'), true);
    } finally { globalShortcut.unregister('Ctrl+Alt+2'); }
    await save(win, { ...registrar.getConfig(), chat: 'Alt+Meta+1' });
    assert.equal(globalShortcut.isRegistered('Alt+Meta+1'), true, 'macOS Command accelerator');
    result.checks.push('native-conflict-rollback-and-command-binding');
    await save(win, { ...registrar.getConfig(), shape: 'list', chat: 'Ctrl+Alt+1' });
    assert.equal(globalShortcut.isRegistered('Ctrl+Alt+1'), true);
    assert.deepEqual(loadSettings(settingsFile).shortcutSettings, registrar.getConfig());
    assert.equal(await page(win, `document.body.dataset.view`), 'list');
    await compactList(win); result.checks.push('compact-list-size-and-five-complete-rows');
    await capture(win, 'native-list.png'); result.checks.push('save-registration-and-disk-readback');
    controller.open({ settings: true }); await wait(100); await capture(win, 'native-settings.png');
    await page(win, `document.querySelector('[name=shape][value=floating]').click(); true`);
    controller.close(); controller.open({ settings: true }); await wait(60);
    assert.equal(await page(win, `document.querySelector('[name=shape]:checked').value`), 'list', 'blur/close discards settings draft');
    result.checks.push('reopen-discards-unsaved-draft');
    controller.open({ settings: true }); await wait(80); await settled(win);
    const settingsBounds = win.getBounds(), settingsArea = screen.getDisplayMatching(settingsBounds).workArea;
    const movedBounds = { ...settingsBounds, x: Math.max(settingsArea.x, Math.min(settingsArea.x + settingsArea.width - settingsBounds.width, settingsBounds.x + (settingsBounds.x < settingsArea.x + settingsArea.width / 2 ? 60 : -60))) };
    win.setBounds(movedBounds); controller.sync(); await wait(80);
    assert.deepEqual(win.getBounds(), movedBounds, 'settings manual placement survives sync');
    assert.equal(await page(win, "getComputedStyle(document.querySelector('.settings-panel .panel-header')).webkitAppRegion"), 'drag');
    assert.equal(await page(win, "getComputedStyle(document.querySelector('.settings-panel [data-close]')).webkitAppRegion"), 'no-drag');
    controller.sampleCursor({ x: -10000, y: -10000 }); assert.equal(ignores.get(win), false, 'solid settings window always accepts native mouse input');
    win.blur(); await wait(60); assert.equal(controller.isOpen(), true, 'settings stays open across native focus changes');
    result.checks.push('settings-native-drag-region-and-position-retained');
    for (const method of ['close', 'cancel', 'escape']) {
      controller.open({ settings: true }); await wait(80);
      await page(win, method === 'escape' ? "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true"
        : "document.querySelector(" + JSON.stringify(method === 'close' ? '.settings-panel [data-close]' : '#cancel') + ").click(); true");
      await poll(() => controller.isOpen(), value => value === false, method + ' closes settings');
      await poll(() => win.isVisible(), value => value === false, method + ' hides native settings window');
    }
    result.checks.push('settings-close-cancel-and-escape');

    await save(win, { ...registrar.getConfig(), shape: 'floating' });
    controller.open(); await wait(40);
    const motion = await page(win, "({phase:document.body.dataset.phase,frames:document.getAnimations().map(a=>a.effect.getKeyframes())})");
    assert.equal(motion.phase, 'opening'); assert.equal(motion.frames.length, 6);
    assert.ok(motion.frames.every(frames => Number(frames[0].opacity) === 0 && Number(frames.at(-1).opacity) === 1 && frames[0].transform.includes('scale(0.28)')), 'six cards expand from the pet');
    await settled(win); await page(win, 'qiuShortcuts.close(); true');
    await poll(() => controller.isOpen(), value => !value, 'closing starts');
    const collapse = await page(win, "({phase:document.body.dataset.phase,frames:document.getAnimations().map(a=>a.effect.getKeyframes())})");
    assert.equal(collapse.phase, 'closing'); assert.equal(collapse.frames.length, 6);
    assert.ok(collapse.frames.every(frames => Number(frames[0].opacity) === 1 && Number(frames.at(-1).opacity) === 0), 'close reverses expansion');
    controller.open(); await wait(230); assert.equal(win.isVisible(), true, 'reopen cancels pending animated hide');
    result.checks.push('six-card-expand-collapse-and-reopen');
    // Run both themes, appearances and contrast modes through real menu setters.
    for (const theme of ['blue', 'green']) for (const appearance of ['light', 'dark']) for (const accessible of [false, true]) {
      const menu = getMenu(); menu.getMenuItemById(`ui-theme-${theme}`).click();
      menu.getMenuItemById(`color-appearance-${appearance}`).click();
      if ((getSettings().colorMode === 'accessible') !== accessible) menu.getMenuItemById('color-accessible').click();
      controller.interrupt(); await wait(100);
      const anchor = pet.getBounds(); cursor = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
      controller.open({ focus: false }); await settled(win);
      const surface = await page(win, `({theme:document.documentElement.dataset.uiTheme,appearance:document.documentElement.dataset.appearance,mode:document.documentElement.dataset.colorMode,buttons:[...document.querySelectorAll('[data-action]')].filter(n=>n.getClientRects().length).map(n=>({text:n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))})`);
      assert.equal(surface.theme, theme); assert.equal(surface.appearance, appearance); assert.equal(surface.mode, accessible ? 'accessible' : 'standard');
      assert.equal(surface.buttons.length, 6); assert.ok(surface.buttons.every(button => button.width >= 52 && button.width === button.height));
      result.themes.push(surface); await capture(win, `native-${theme}-${appearance}-${accessible ? 'accessible' : 'standard'}.png`);
      await save(win, { ...registrar.getConfig(), shape: 'list' });
      controller.interrupt(); await wait(100); controller.open({ focus: false });
      const listSurface = await compactList(win);
      assert.equal(listSurface.theme, theme); assert.equal(listSurface.appearance, appearance); assert.equal(listSurface.mode, accessible ? 'accessible' : 'standard');
      result.listThemes.push(listSurface); await capture(win, `native-list-${theme}-${appearance}-${accessible ? 'accessible' : 'standard'}.png`);
      await save(win, { ...registrar.getConfig(), shape: 'floating' });
    }
    result.checks.push('compact-list-eight-themes');
    // Physical displays are enumerated here; virtual negative displays are covered by the pure geometry tests.
    for (const display of screen.getAllDisplays()) for (const [px, py] of [[.5,.5],[0,.5],[1,.5],[.5,0],[.5,1],[0,0],[1,0],[0,1],[1,1]]) {
      controller.interrupt(); edgeTuck.restore();
      const area = display.workArea;
      pet.setBounds({ ...original, x: Math.round(area.x + (area.width - original.width) * px), y: Math.round(area.y + (area.height - original.height) * py) }, false);
      await wait(100); // Drain native move/scale notifications before simulating hover.
      const placed = pet.getBounds(); cursor = { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 };
      controller.open({ focus: false }); await wait(60); await settled(win);
      assert.equal(controller.isOpen(), true, 'hover layout remains open');
      const state = controller.getState(); assert.ok(inside(state.layout.bounds, area));
      if (state.view === 'floating') {
        const dom = await page(win, `[...document.querySelectorAll('[data-action]')].filter(n=>n.getClientRects().length).map(n=>({id:n.dataset.action,...n.getBoundingClientRect().toJSON(),transform:getComputedStyle(n).transform,animations:n.getAnimations().map(a=>({state:a.playState,time:a.currentTime,pending:a.pending,frames:a.effect.getKeyframes()}))}))`);
        assert.equal(dom.length, 6);
        for (const card of dom) {
          const expected = state.layout.items.find(item => item.id === card.id);
          for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(card[key] - expected[key]) <= 1, `${card.id} DOM ${key} ${card[key]} matches native layout ${expected[key]}: ${display.id},${px},${py}; ${JSON.stringify(card)}`);
          assert.ok(card.x >= 0 && card.y >= 0 && card.right <= win.getBounds().width && card.bottom <= win.getBounds().height);
        }
      }
      result.layouts.push({ displayId: display.id, px, py, pet: pet.getBounds(), ...state.layout });
    }
    result.checks.push('native-display-edges-and-corners');
    controller.interrupt(); edgeTuck.dock('left'); controller.open({ focus: false }); await wait(100);
    assert.equal(edgeTuck.getPresentation().mode, 'peeked');
    cursor = { x: -10000, y: -10000 }; edgeTuck.sampleCursor(cursor); await wait(300);
    assert.equal(edgeTuck.getPresentation().mode, 'peeked');
    controller.close(); edgeTuck.sampleCursor(cursor);
    await poll(() => edgeTuck.getPresentation().mode, mode => mode === 'tucked', 'edge re-tucks after collapse and leave delay');
    result.checks.push('edge-open-pin-release');
    edgeTuck.restore(); pet.setBounds(original); controller.open(); await ready();
    // Invoke real renderer APIs and verify reuse of the existing feature windows.
    for (const id of ['custom', 'note', 'todo', 'pomodoro', 'chat']) {
      controller.open(); await ready(); await page(win, `qiuShortcuts.openAction(${JSON.stringify(id)})`);
      const target = await poll(() => getWindows()[id], target => target && !target.isDestroyed() && target.isVisible(), `${id} did not open`);
      controller.open(); await ready(); await page(win, `qiuShortcuts.openAction(${JSON.stringify(id)})`); await wait(80);
      assert.equal(getWindows()[id], target, `${id} reuses window`);
      if (id === 'note' || id === 'todo') {
        await poll(() => page(target, `Boolean(document.querySelector('#${id === 'note' ? 'notes' : 'todos'}-tab[aria-selected="true"]'))`), Boolean, `${id} selected tab`);
      }
      target.hide();
    }
    result.checks.push('five-native-window-routes-and-reuse');
    await save(win, { ...registrar.getConfig(), noteBehavior: 'create', todoBehavior: 'create' });
    assert.equal(loadSettings(settingsFile).shortcutSettings.noteBehavior, 'create');
    assert.equal(loadSettings(settingsFile).shortcutSettings.todoBehavior, 'create');
    for (const id of ['note','todo']) {
      controller.open(); await ready(); await page(win, "qiuShortcuts.openAction(" + JSON.stringify(id) + ")");
      const target = await poll(() => getWindows()[id], target => target && target.isVisible(), id + ' create opens');
      const editor = await poll(() => page(target, "({open:document.querySelector('#editor').open,title:document.querySelector('#editor-title').textContent})"), value => value.open, id + ' editor appears');
      assert.ok(editor.title.includes(id === 'note' ? '便签' : '待办'));
      await page(target, "document.querySelector('#editor-close').click(); true"); target.hide();
    }
    await save(win, { ...registrar.getConfig(), noteBehavior: 'panel', todoBehavior: 'panel' });
    result.checks.push('note-todo-create-preference-and-native-editors');

    pomodoro.action('toggle'); const timer = pomodoro.getSnapshot();
    controller.open(); await ready(); await page(win, `qiuShortcuts.openAction('pomodoro')`); await wait(50);
    assert.equal(pomodoro.getSnapshot().status, 'running'); assert.equal(pomodoro.getSnapshot().deadline, timer.deadline);
    pomodoro.action('toggle'); const paused = pomodoro.getSnapshot();
    assert.equal(paused.status, 'paused');
    controller.open(); await ready(); await page(win, `qiuShortcuts.openAction('pomodoro')`); await wait(50);
    assert.equal(pomodoro.getSnapshot().status, 'paused');
    assert.equal(pomodoro.getSnapshot().remaining, paused.remaining); assert.equal(pomodoro.getSnapshot().deadline, 0);
    result.checks.push('pomodoro-running-and-paused-reopen-retain-timer');
    controller.open(); await ready();
    powerMonitor.emit('lock-screen'); await wait(100); assert.equal(controller.isOpen(), false);
    assert.equal(controller.open(), false); powerMonitor.emit('unlock-screen');
    controller.open(); await ready();
    await page(pet, `petDesktop.beginDrag({x:200,y:200}); petDesktop.endDrag(); true`); await wait(100);
    assert.equal(controller.isOpen(), true, 'ordinary pointerdown/up keeps existing menu');
    await page(pet, `petDesktop.beginDrag({x:200,y:200}); petDesktop.dragTo({x:220,y:200}); petDesktop.endDrag(); true`); await wait(500);
    assert.equal(controller.isOpen(), false, 'real drag closes menu');
    result.checks.push('lock-and-native-drag-interrupt');
    controller.open({ settings: true }); await ready();
    await page(win, `qiuShortcuts.recording(true)`); await wait(40);
    assert.equal(globalShortcut.isSuspended(), true); assert.equal(registrar.getState().recording, true);
    controller.close(); assert.equal(globalShortcut.isSuspended(), false); assert.equal(registrar.getState().recording, false);
    assert.equal(registrar.getConfig().launcher, 'Ctrl+Alt+Q');
    result.checks.push('recording-close-resumes-bindings');
    result.ok = true;
    process.stdout.write(`PET_SHORTCUT_INTEGRATION_OK checks=${result.checks.length} themes=${result.themes.length} layouts=${result.layouts.length}\n`);
  } finally {
    controller.close(); screen.getCursorScreenPoint = originalCursor;
    BrowserWindow.prototype.setIgnoreMouseEvents = originalIgnore;
    if (!pet.isDestroyed()) pet.setBounds(original, false);
    fs.writeFileSync(path.join(output, 'native-checks.json'), JSON.stringify(result, null, 2));
  }
}
module.exports = { verifyShortcuts };
