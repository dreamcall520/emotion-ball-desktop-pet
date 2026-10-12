const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { loadSettings } = require('../lib/settings');
const { layoutShortcuts } = require('../lib/shortcut-layout');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

// The smoke runner supplies a separate profile; no installed settings are read.
async function verifyShortcuts({ pet, controller, registrar, screen, BrowserWindow, globalShortcut,
  edgeTuck, powerMonitor, settingsFile, getMenu, getSettings, getWindows, pomodoro,
  bubble, dialogue, showDialogue, showBubble, showUpdateBubble }) {
  const output = path.resolve(process.env.PET_SMOKE_SHORTCUT_OUTPUT || path.join(os.tmpdir(), `qiuqiu-shortcuts-${process.pid}`));
  fs.mkdirSync(output, { recursive: true });
  const result = { ok: false, checks: [], themes: [], listThemes: [], settingsThemes: [], layouts: [], peekedLayouts: [], displays: screen.getAllDisplays().map(({ id, workArea, scaleFactor }) => ({ id, workArea, scaleFactor })) };
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
  const bubbleVisible = () => Boolean(bubble.getWindow() && !bubble.getWindow().isDestroyed() && bubble.getWindow().isVisible());
  const suppressedBubbles = phase => {
    assert.equal(controller.isPresenting(), true, phase + ' retains presentation suppression');
    assert.equal(showBubble({ id: -1, text: '不应显示的旧提示', actions: [], durationMs: 4000 }), false, phase + ' blocks direct bubbles');
    assert.equal(showDialogue('wake'), null, phase + ' blocks dialogue before offering it');
    assert.equal(showUpdateBubble({ latestVersion: '99.0.0' }), false, phase + ' blocks update prompts');
    assert.equal(dialogue.hasBubble(performance.now()), false, phase + ' does not queue dialogue');
    assert.equal(bubbleVisible(), false, phase + ' keeps native bubble hidden');
  };
  const compactSettings = async win => {
    await settled(win);
    const surface = await page(win, `(() => {
      const panel = document.querySelector('.settings-panel'), body = panel.querySelector('.settings-body');
      const rect = node => node.getBoundingClientRect().toJSON();
      const measure = node => ({...rect(node),clientWidth:node.clientWidth,scroll:node.scrollWidth});
      const context = document.createElement('canvas').getContext('2d');
      return {theme:document.documentElement.dataset.uiTheme,appearance:document.documentElement.dataset.appearance,mode:document.documentElement.dataset.colorMode,
        panel:rect(panel),panelShadow:getComputedStyle(panel).boxShadow,body:rect(body),footer:rect(panel.querySelector('.settings-footer')),scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,
        horizontal:[panel,body,...panel.querySelectorAll('h1,.group-label,.shape-options,.shape-options label,.switch-row,.global-binding,.record-hint,.direct-row,.binding-controls')].map(measure),
        rows:[...panel.querySelectorAll('.direct-row')].map(row=>{
          const name=row.querySelector('.direct-name'),select=row.querySelector('[data-start-behavior]'),controls=row.querySelector('.binding-controls'),record=row.querySelector('[data-record]'),clear=row.querySelector('[data-clear]');
          const style=select&&getComputedStyle(select); if(select) context.font=style.font;
          return {id:record.dataset.record,...rect(row),name:{text:name.textContent.trim(),...measure(name),lineHeight:parseFloat(getComputedStyle(name).lineHeight)},
            select:select?{...measure(select),field:select.dataset.startBehavior,label:select.getAttribute('aria-label'),text:select.selectedOptions[0].textContent,textWidth:context.measureText(select.selectedOptions[0].textContent).width,padding:parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)}:null,
            controls:measure(controls),record:measure(record),keys:[...record.querySelectorAll('kbd')].map(node=>({text:node.textContent,...rect(node)})),clear:clear?rect(clear):null};
        })};
    })()`);
    assert.equal(surface.panel.width, win.getBounds().width - 16);
    assert.equal(surface.panelShadow, 'none', 'settings panel has no outer shadow');
    assert.equal(surface.rows.length, 5);
    assert.ok(surface.scrollHeight <= surface.clientHeight + 1, 'settings rows and hint fit without scrolling');
    assert.ok(surface.horizontal.every(node => node.scroll <= node.width + 1), 'settings labels and controls do not overflow horizontally');
    assert.ok(surface.footer.y >= surface.body.bottom - 1, 'settings footer does not cover the body');
    const names = { chat: '聊天', custom: '定制球球', note: '便签', todo: '待办', pomodoro: '番茄钟' };
    for (const row of surface.rows) {
      assert.equal(row.height, 44, row.id + ' has the shared single-row height');
      assert.ok(inside(row, surface.body), row.id + ' is fully visible in the settings body');
      assert.equal(row.name.text, names[row.id]);
      assert.ok(row.name.height <= row.name.lineHeight + 1, row.id + ' name stays on one line');
      for (const node of [row.name, row.select, row.controls].filter(Boolean)) {
        assert.ok(inside(node, row), row.id + ' contains each control');
        assert.ok(Math.abs(node.y + node.height / 2 - row.y - row.height / 2) <= 1, row.id + ' aligns controls on one line');
      }
      assert.ok(row.name.right <= (row.select || row.controls).x, row.id + ' name does not overlap its controls');
      if (row.select) {
        assert.equal(row.select.field, row.id + 'Behavior');
        assert.equal(row.select.label, names[row.id] + '快捷启动方式');
        assert.ok(row.select.right <= row.controls.x, row.id + ' selector and binding do not overlap');
        assert.ok(row.select.textWidth + row.select.padding + 18 <= row.select.width + 1, row.id + ' selected label fits before the native arrow');
      }
      assert.ok(inside(row.record, row.controls), row.id + ' binding button fits');
      assert.ok(row.record.scroll <= row.record.width + 1, row.id + ' binding text does not overflow');
      if (row.clear) {
        assert.ok(inside(row.clear, row.controls), row.id + ' clear button fits');
        assert.ok(row.record.right <= row.clear.x, row.id + ' clear button does not overlap the binding');
      }
      assert.ok(row.keys.every(key => inside(key, row.record)), row.id + ' keycaps fit in the binding button');
    }
    const longest = surface.rows.find(row => row.id === 'note');
    assert.equal(longest.keys.length, 5); assert.equal(longest.keys.at(-1).text, 'F12');
    assert.ok(longest.clear, 'longest binding has a clear button');
    return surface;
  };
  const compactList = async win => {
    await settled(win);
    const surface = await page(win, `(() => {
      const panel = document.querySelector('.list-panel'), actions = document.querySelector('.list-actions');
      const rect = node => node.getBoundingClientRect().toJSON();
      return {theme:document.documentElement.dataset.uiTheme,appearance:document.documentElement.dataset.appearance,mode:document.documentElement.dataset.colorMode,
        panel:rect(panel),panelShadow:getComputedStyle(panel).boxShadow,actions:rect(actions),scrollHeight:actions.scrollHeight,clientHeight:actions.clientHeight,
        header:rect(panel.querySelector('.panel-header')),footer:rect(panel.querySelector('.list-footer')),
        keysVisible:Boolean(document.querySelector('#launcher-keys').getClientRects().length),hintVisible:Boolean(panel.querySelector('.list-footer>span').getClientRects().length),
        horizontal:[panel,...panel.querySelectorAll('.panel-header,.list-footer,.action')].map(node=>({width:node.clientWidth,scroll:node.scrollWidth})),
        buttons:[...actions.querySelectorAll('[data-action]')].map(node=>({id:node.dataset.action,...rect(node),font:parseFloat(getComputedStyle(node.querySelector('.action-name')).fontSize),nameWidth:node.querySelector('.action-name').clientWidth,nameScroll:node.querySelector('.action-name').scrollWidth}))};
    })()`);
    assert.deepEqual({ width: win.getBounds().width, height: win.getBounds().height }, { width: 320, height: 326 });
    assert.equal(surface.panel.width, 304); assert.equal(surface.panel.height, 310);
    assert.equal(surface.panelShadow, 'none', 'compact list has no outer shadow');
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
    const menu = getMenu(), shortcutIndex = menu.items.findIndex(item => item.id === 'shortcut-settings');
    assert.equal(menu.items[shortcutIndex]?.label, '快捷键设置');
    assert.equal(menu.items[shortcutIndex + 1]?.id, 'pomodoro-open');
    result.checks.push('shortcut-settings-menu-label-and-order');
    await poll(() => pet.isVisible(), Boolean, 'pet is visible before dialogue');
    dialogue.dismiss(); bubble.hide();
    const previousDialogue = showDialogue('wake'); assert.ok(previousDialogue, 'dialogue appears before opening');
    await poll(bubbleVisible, Boolean, 'existing dialogue is visible before opening');
    cursor = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
    const focused = BrowserWindow.getFocusedWindow();
    controller.sampleCursor(cursor); await wait(300); assert.equal(controller.isOpen(), false, 'hover waits');
    await wait(220); const win = await ready();
    assert.equal(BrowserWindow.getFocusedWindow(), focused, 'hover must not take focus');
    assert.equal(await page(win, 'typeof require'), 'undefined');
    const prefs = win.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    result.checks.push('hover-delay-no-focus-and-sandbox');
    suppressedBubbles('opening');
    result.checks.push('shortcut-open-dismisses-existing-and-blocks-new-bubbles');
    await settled(win);
    const selectedAction = () => page(win, "document.querySelector('[data-action][aria-current=true]')?.dataset.action || null");
    assert.equal(await selectedAction(), null, 'opening does not preselect a function');
    await page(win, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); true");
    assert.equal(controller.isOpen(), true, 'Enter without a chosen function does nothing');
    await page(win, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); true");
    assert.equal(await selectedAction(), 'chat', 'first Down selects first function');
    controller.open({ focus: false }); await settled(win);
    assert.equal(await selectedAction(), null, 'reopening clears the previous highlight');
    await page(win, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); true");
    assert.equal(await selectedAction(), 'settings', 'first Up selects last floating function');
    controller.open({ focus: false }); await settled(win);
    result.checks.push('no-default-selection-and-explicit-keyboard-navigation');
    controller.sampleCursor(cursor); assert.equal(ignores.get(win), true, 'transparent region over pet passes through');
    const first = controller.getState().layout.items[0], frame = win.getBounds();
    cursor = { x: frame.x + first.x + first.width / 2, y: frame.y + first.y + first.height / 2 };
    controller.sampleCursor(cursor); assert.equal(ignores.get(win), false, 'card receives mouse');
    result.checks.push('transparent-hit-testing');
    cursor = { x: -10000, y: -10000 }; controller.sampleCursor(cursor); await wait(720);
    assert.equal(controller.isOpen(), false); result.checks.push('hover-leave-close');
    await poll(() => controller.isPresenting(), value => !value, 'suppression ends after close animation');
    await wait(60);
    assert.equal(bubbleVisible(), false, 'closing does not replay previous or suppressed prompts');
    assert.equal(dialogue.hasBubble(performance.now()), false, 'closing leaves no queued dialogue');
    const freshDialogue = showDialogue('wake'); assert.ok(freshDialogue, 'new dialogue resumes after closing');
    assert.notEqual(freshDialogue.id, previousDialogue.id);
    await poll(bubbleVisible, Boolean, 'fresh dialogue becomes visible');
    await poll(() => page(bubble.getWindow(), 'document.querySelector("#message").textContent'), text => text === freshDialogue.text, 'native bubble contains only the fresh dialogue');
    bubble.hide(); dialogue.dismiss();
    // Leave-close is covered above; keep the pointer over the pet during layout checks.
    cursor = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
    result.checks.push('shortcut-close-no-replay-and-fresh-dialogue-resumes');
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
    await compactList(win); assert.equal(await selectedAction(), null, 'list also opens without a default highlight'); result.checks.push('compact-list-size-and-five-complete-rows');
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
    const behaviorConfig = registrar.getConfig();
    await page(win, "document.querySelector('[data-record=note]').click(); true");
    await poll(() => registrar.getState().recording, Boolean, 'recording starts before selecting startup behavior');
    const preservedSelect = await page(win, `(() => {
      const select=document.querySelector('[data-start-behavior=noteBehavior]');
      select.click();
      const retained=select.isConnected&&document.querySelector('[data-start-behavior=noteBehavior]')===select;
      select.value='create'; select.dispatchEvent(new Event('change',{bubbles:true}));
      const todo=document.querySelector('[data-start-behavior=todoBehavior]');
      todo.value='panel'; todo.dispatchEvent(new Event('change',{bubbles:true}));
      return {retained,recording:Boolean(document.querySelector('[data-record][aria-pressed=true]'))};
    })()`);
    assert.equal(preservedSelect.retained, true, 'clicking a select during recording preserves the native node');
    assert.equal(preservedSelect.recording, false);
    await poll(() => registrar.getState().recording, value => !value, 'select click resumes native shortcuts');
    assert.equal(globalShortcut.isSuspended(), false);
    await page(win, "document.querySelector('#settings').requestSubmit(); true");
    await poll(() => registrar.getConfig(), config => config.noteBehavior === 'create' && config.todoBehavior === 'panel', 'form saves both startup selectors');
    await poll(() => page(win, 'document.body.dataset.view'), view => view !== 'settings', 'successful form save exits settings');
    const persistedBehaviors = loadSettings(settingsFile).shortcutSettings;
    assert.equal(persistedBehaviors.noteBehavior, 'create'); assert.equal(persistedBehaviors.todoBehavior, 'panel');
    controller.close(); await poll(() => controller.isPresenting(), value => !value, 'settings save closes fully');
    controller.open({ settings: true }); await settled(win);
    assert.deepEqual(await page(win, "[...document.querySelectorAll('[data-start-behavior]')].map(node=>({field:node.dataset.startBehavior,value:node.value}))"), [
      { field: 'noteBehavior', value: 'create' }, { field: 'todoBehavior', value: 'panel' }
    ]);
    await save(win, behaviorConfig);
    result.checks.push('recording-select-node-retained-and-form-save-reopen');
    for (const method of ['close', 'cancel', 'escape']) {
      controller.open({ settings: true }); await wait(80);
      await page(win, method === 'escape' ? "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true"
        : "document.querySelector(" + JSON.stringify(method === 'close' ? '.settings-panel [data-close]' : '#cancel') + ").click(); true");
      await poll(() => controller.isOpen(), value => value === false, method + ' closes settings');
      await poll(() => win.isVisible(), value => value === false, method + ' hides native settings window');
    }
    result.checks.push('settings-close-cancel-and-escape');

    cursor = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
    await save(win, { ...registrar.getConfig(), shape: 'floating' });
    controller.open(); await wait(40);
    const motion = await page(win, "({phase:document.body.dataset.phase,frames:document.getAnimations().map(a=>a.effect.getKeyframes())})");
    assert.equal(motion.phase, 'opening'); assert.equal(motion.frames.length, 6);
    assert.ok(motion.frames.every(frames => Number(frames[0].opacity) === 0 && Number(frames.at(-1).opacity) === 1 && frames[0].transform.includes('scale(0.28)')), 'six cards expand from the pet');
    await settled(win); await page(win, 'qiuShortcuts.close(); true');
    await poll(() => controller.isOpen(), value => !value, 'closing starts');
    suppressedBubbles('closing');
    result.checks.push('shortcut-closing-blocks-new-and-update-bubbles');
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
      const surface = await page(win, `({theme:document.documentElement.dataset.uiTheme,appearance:document.documentElement.dataset.appearance,mode:document.documentElement.dataset.colorMode,palette:Object.fromEntries(['--surface','--control','--text','--muted','--accent','--accent-text','--selected'].map(key=>[key,getComputedStyle(document.documentElement).getPropertyValue(key).trim()])),selected:[...document.querySelectorAll('[data-action][aria-current=true]')].filter(n=>n.getClientRects().length).map(n=>n.dataset.action),buttons:[...document.querySelectorAll('[data-action]')].filter(n=>n.getClientRects().length).map(n=>({text:n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,background:getComputedStyle(n).backgroundColor,image:getComputedStyle(n).backgroundImage}))})`);
      assert.equal(surface.theme, theme); assert.equal(surface.appearance, appearance); assert.equal(surface.mode, accessible ? 'accessible' : 'standard');
      assert.deepEqual(surface.selected, [], 'theme reopening starts without a highlighted function');
      assert.equal(surface.buttons.length, 6); assert.ok(surface.buttons.every(button => button.width >= 52 && button.width === button.height));
      assert.ok(surface.buttons.every(button => button.image === 'none'), 'floating cards use a solid neutral surface');
      if (!accessible && appearance === 'light') {
        assert.equal(surface.palette['--surface'], '#fff');
        assert.ok(surface.buttons.every(button => button.background === 'rgb(255, 255, 255)'), 'ordinary light cards stay white');
      }
      result.themes.push(surface); await capture(win, `native-${theme}-${appearance}-${accessible ? 'accessible' : 'standard'}.png`);
      await save(win, { ...registrar.getConfig(), shape: 'list' });
      controller.interrupt(); await wait(100); controller.open({ focus: false });
      const listSurface = await compactList(win);
      assert.equal(listSurface.theme, theme); assert.equal(listSurface.appearance, appearance); assert.equal(listSurface.mode, accessible ? 'accessible' : 'standard');
      result.listThemes.push(listSurface); await capture(win, `native-list-${theme}-${appearance}-${accessible ? 'accessible' : 'standard'}.png`);
      controller.open({ settings: true }); await settled(win);
      await page(win, "document.querySelector('[data-record=note]').click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',code:'F12',ctrlKey:true,altKey:true,shiftKey:true,metaKey:true,bubbles:true})); true");
      const settingsSurface = await compactSettings(win);
      assert.equal(settingsSurface.theme, theme); assert.equal(settingsSurface.appearance, appearance); assert.equal(settingsSurface.mode, accessible ? 'accessible' : 'standard');
      result.settingsThemes.push(settingsSurface); await capture(win, `native-settings-${theme}-${appearance}-${accessible ? 'accessible' : 'standard'}.png`);
      await save(win, { ...registrar.getConfig(), shape: 'floating' });
    }
    result.checks.push('compact-list-eight-themes');
    result.checks.push('single-row-settings-eight-themes-and-longest-binding');
    for (const appearance of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
      const surfaces = result.themes.filter(surface => surface.appearance === appearance && surface.mode === mode);
      assert.equal(surfaces.length, 2);
      assert.equal(surfaces[0].palette['--surface'], surfaces[1].palette['--surface'], appearance + ' themes share the same neutral surface');
      assert.deepEqual(surfaces[0].buttons.map(button => button.background), surfaces[1].buttons.map(button => button.background));
    }
    result.checks.push('neutral-surfaces-solid-cards-and-shadowless-panels-eight-themes');
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
    const originalCustomization = structuredClone(getSettings().customization);
    const edgeFrames = async phase => {
      const session = String(controller.getState().session);
      await poll(() => page(win, `document.body.dataset.session === ${JSON.stringify(session)} && document.body.dataset.phase === ${JSON.stringify(phase)}`), Boolean, `edge renderer ${phase}`);
      return page(win, `(async () => {
        const frames = [];
        for (let i = 0; i < 6; i++) {
          frames.push({ x: screenX, y: screenY, width: innerWidth, height: innerHeight,
            buttons: [...document.querySelectorAll('[data-action]')].filter(node => node.getClientRects().length).map(node => ({ id: node.dataset.action, ...node.getBoundingClientRect().toJSON() })) });
          await new Promise(resolve => { const timer = setTimeout(resolve, 25); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
        }
        return frames;
      })()`);
    };
    const checkEdgeFrames = (frames, area, phase) => {
      assert.ok(frames.length > 0);
      for (const frame of frames) {
        assert.equal(frame.buttons.length, 6, `${phase} keeps all six floating actions`);
        for (const button of frame.buttons) {
          const slack = { x: -1, y: -1, width: frame.width + 2, height: frame.height + 2 };
          assert.ok(inside(button, slack), `${phase} ${button.id} is complete inside native viewport`);
          assert.ok(inside({ ...button, x: frame.x + button.x, y: frame.y + button.y },
            { x: area.x - 1, y: area.y - 1, width: area.width + 2, height: area.height + 2 }), `${phase} ${button.id} remains on its physical display`);
        }
      }
    };
    try {
      controller.interrupt(); edgeTuck.restore();
      getSettings().customization = { ...originalCustomization,
        appearance: { ...originalCustomization.appearance, shape: 'aurora-cloud' } };
      pet.webContents.send('pet:settings', getSettings());
      await poll(() => page(pet, "document.querySelector('#pet').dataset.shape"), shape => shape === 'aurora-cloud', 'native aurora shape received');
      await poll(() => page(pet, "Boolean(document.querySelector('.eb-rive-aurora.ready'))"), Boolean, 'native aurora art ready');
      for (const display of screen.getAllDisplays()) for (const side of ['left', 'right']) {
        controller.interrupt(); edgeTuck.restore();
        const area = display.workArea;
        pet.setBounds({ x: area.x + Math.round((area.width - 80) / 2), y: area.y + Math.round((area.height - 80) / 2), width: 80, height: 80 }, false);
        await wait(100); edgeTuck.dock(side);
        const anchor = pet.getBounds();
        assert.equal(anchor.width, 80); assert.equal(anchor.height, 80);
        cursor = { x: anchor.x + (side === 'left' ? 20 : 60), y: anchor.y + 40 };
        edgeTuck.sampleCursor(cursor);
        await poll(() => page(pet, "({shape:document.querySelector('#pet').dataset.shape,mode:document.querySelector('#pet').dataset.presentation,side:document.querySelector('#pet').dataset.edge,ready:Boolean(document.querySelector('.eb-rive-aurora.ready'))})"),
          value => value.shape === 'aurora-cloud' && value.ready && value.mode === 'peeked' && value.side === side, '80 DIP aurora native peek');
        const planned = layoutShortcuts({ petBounds: petVisualBounds(pet.getBounds(), 'aurora-cloud', edgeTuck.getPresentation()),
          workArea: area, shape: registrar.getConfig().shape, side });
        controller.open({ focus: false }); await ready();
        const opening = await edgeFrames('opening'); checkEdgeFrames(opening, area, 'opening');
        await settled(win);
        const state = controller.getState(), actual = win.getBounds();
        assert.equal(state.view, 'floating'); assert.equal(edgeTuck.getPresentation().mode, 'peeked');
        const dom = await page(win, `({ x: screenX, y: screenY, width: innerWidth, height: innerHeight,
          buttons: [...document.querySelectorAll('[data-action]')].filter(node => node.getClientRects().length).map(node => ({ id: node.dataset.action, ...node.getBoundingClientRect().toJSON(),
            nameWidth: node.querySelector('.action-name').clientWidth, nameScroll: node.querySelector('.action-name').scrollWidth })) })`);
        const evidence = { displayId: display.id, side, pet: anchor, presentation: edgeTuck.getPresentation(),
          requested: planned.bounds, actual, layout: state.layout, origin: state.origin, dom, opening,
          globals: dom.buttons.map(button => { const item = planned.items.find(value => value.id === button.id); return {
            id: button.id, actual: { x: dom.x + button.x, y: dom.y + button.y },
            expected: item && { x: planned.bounds.x + item.x, y: planned.bounds.y + item.y }, item }; }) };
        // Write the geometry before assertions so a native clamp remains diagnosable.
        result.peekedLayouts.push(evidence);
        fs.writeFileSync(path.join(output, `native-aurora-80-${display.id}-${side}-geometry.json`), JSON.stringify(evidence, null, 2));
        assert.ok(Math.abs(dom.x - actual.x) <= 1 && Math.abs(dom.y - actual.y) <= 1, 'renderer screen origin matches actual native bounds');
        assert.deepEqual(state.layout.bounds, actual, 'hit regions use the actual native canvas');
        assert.equal(dom.width, actual.width); assert.equal(dom.height, actual.height);
        checkEdgeFrames([dom], area, 'expanded');
        for (const button of dom.buttons) {
          const expected = planned.items.find(item => item.id === button.id);
          assert.ok(expected, button.id);
          for (const axis of ['x', 'y']) assert.ok(Math.abs(actual[axis] + button[axis] - planned.bounds[axis] - expected[axis]) <= 1,
            `${side} ${button.id} global ${axis} is not shifted by native gutter clamping`);
          assert.ok(Math.abs(button.width - expected.width) <= 1 && Math.abs(button.height - expected.height) <= 1);
          assert.ok(button.nameScroll <= button.nameWidth + 1, `${button.id} name remains complete`);
        }
        // The animation canvas may extend 28 DIP beyond a screen for the cloud's
        // transparent peek. Validate painted buttons, not whole-window containment.
        await capture(win, `native-aurora-80-${display.id}-${side}-peeked.png`);
        cursor = { x: -10000, y: -10000 }; edgeTuck.sampleCursor(cursor);
        assert.equal(edgeTuck.getPresentation().mode, 'peeked', 'open shortcut pins the peek');
        controller.close();
        assert.equal(win.isVisible(), true, 'aurora closing animation retains the native canvas');
        assert.equal(edgeTuck.getPresentation().mode, 'peeked', 'aurora closing animation retains the peek');
        const closing = await edgeFrames('closing'); checkEdgeFrames(closing, area, 'closing');
        await poll(() => win.isVisible(), value => !value, 'aurora close hides native shortcut');
        await poll(() => edgeTuck.getPresentation().mode, mode => mode === 'tucked', 'aurora close releases peek pin');
        evidence.closing = closing;
      }
      result.checks.push('aurora-80-left-right-peeked-native-animation-and-global-buttons');
    } finally {
      controller.interrupt(); edgeTuck.restore();
      getSettings().customization = originalCustomization;
      pet.webContents.send('pet:settings', getSettings());
    }
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
    process.stdout.write(`PET_SHORTCUT_INTEGRATION_OK checks=${result.checks.length} themes=${result.themes.length} settingsThemes=${result.settingsThemes.length} layouts=${result.layouts.length}\n`);
  } finally {
    controller.close(); screen.getCursorScreenPoint = originalCursor;
    BrowserWindow.prototype.setIgnoreMouseEvents = originalIgnore;
    if (!pet.isDestroyed()) pet.setBounds(original, false);
    fs.writeFileSync(path.join(output, 'native-checks.json'), JSON.stringify(result, null, 2));
  }
}
module.exports = { verifyShortcuts };
