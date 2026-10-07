const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const M = require('../lib/notes-model');
const { capturePaintedWindow } = require('./verify-codex-companion');

const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
  const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const textStyles = (win, selectors) => win.webContents.executeJavaScript( `(() => {
  const parse = color => { const channels = color.match(/[\\d.]+/g).map(Number); return [...channels.slice(0, 3), channels[3] ?? 1]; };
  return ${JSON.stringify(selectors)}.flatMap(({ label, selector }) => {
    const elements = [...document.querySelectorAll(selector)];
    if (!elements.length) throw Error('缺少对比度检查节点: ' + selector);
    return elements.map((element, index) => {
      const style = getComputedStyle(element), layers = [];
      if (!element.getClientRects().length) throw Error('对比度检查节点不可见: ' + selector);
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const paint = getComputedStyle(ancestor), rgba = parse(paint.backgroundColor);
        layers.push({ element: ancestor.id ? '#' + ancestor.id : ancestor.tagName.toLowerCase() + '.' + [...ancestor.classList].join('.'),
          color: paint.backgroundColor, image: paint.backgroundImage, rgba });
        if (rgba[3] === 1) break;
      }
      if (layers.at(-1).rgba[3] !== 1) throw Error('未找到真实不透明背景: ' + selector);
      if (layers.some(layer => layer.image !== 'none')) throw Error('文字背景存在渐变，不能按纯色验收: ' + selector);
      let background = layers.at(-1).rgba.slice(0, 3);
      for (const layer of layers.slice(0, -1).reverse()) background = background.map((channel, i) => layer.rgba[i] * layer.rgba[3] + channel * (1 - layer.rgba[3]));
      return { label, selector, index, text: element.textContent.trim(), color: style.color,
        ownBackground: style.backgroundColor, background: 'rgb(' + background.join(', ') + ')', layers };
    });
  });
})()`);

// Run with PET_SMOKE_UI_THEME_ONLY=1 PET_SMOKE_CHAT_ONLY=1 npm run smoke.
// The existing smoke runner isolates user data and supplies the mock chat account.
async function verifyUiTheme({ pet, notes, chat, openWindows, getWindows, getMenu, getSettings, settingsFile, nativeTheme }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CHAT_ONLY, '1');
  const output = process.env.PET_SMOKE_UI_THEME_OUTPUT;
  const poll = async (read, test, label) => {
    let value;
    for (let attempt = 0; attempt < 100; attempt++) {
      value = await read();
      if (test(value)) return value;
      await wait(40);
    }
    assert.fail(`${label}: ${JSON.stringify(value)}`);
  };
  const select = id => { const item = getMenu().getMenuItemById(id); assert.ok(item?.enabled, id); item.click(item, pet, {}); };
  const setMode = mode => { const item = getMenu().getMenuItemById('color-accessible'); if (item.checked !== (mode === 'accessible')) item.click(item, pet, {}); assert.equal(getSettings().colorMode, mode); };
  const before = getSettings();
  if (process.env.PET_SMOKE_UI_THEME_RESTART === '1') {
    assert.equal(before.uiTheme, 'blue');
    assert.equal(before.codexQuotaAppearance, 'light');
    assert.equal(before.colorMode, 'standard');
    process.stdout.write('PET_UI_THEME_RESTART_OK\n');
  }
  assert.equal(getMenu().getMenuItemById('ui-theme-green').label, '薄荷绿');
  assert.equal(getMenu().getMenuItemById('ui-theme-blue').label, '晴空蓝');
  const menu = getMenu().getMenuItemById('color-mode').submenu;
  assert.deepEqual(menu.items.filter(item => item.type !== 'separator').map(item => item.id), ['color-appearance', 'ui-theme', 'color-accessible']);
  assert.equal(getMenu().getMenuItemById('color-standard'), null);
  assert.equal(getMenu().getMenuItemById('color-accessible').type, 'checkbox');
  assert.equal(getMenu().getMenuItemById('color-accessible').label, '色弱友好（增强对比度）');
  const store = notes.getStore();
  const note = { ...M.newNote('周末的小计划', '去公园走走；记得带水和相机；出门前看看天气。'), favorite: true, pinned: true };
  const todo = M.newTodo('给自己留一点休息时间');
  const done = { ...M.newTodo('读完一章书'), completed: true, completedAt: Date.now() };
  store.update(state => ({ ...state, notes: [note], todos: [todo, done] }));
  notes.openPanel(); notes.openNote(note.id);
  openWindows();
  await poll(() => getWindows().every(win => win && !win.webContents.isLoading()), Boolean, '实际窗口加载');
  const windows = getWindows();
  const page = (win, code) => win.webContents.executeJavaScript(code);
  const captures = [];
  const capture = async (win, name) => {
    if (!output) return;
    const artifactPath = path.join(output, `${name}.png`);
    await capturePaintedWindow({ win, artifactPath });
    captures.push({ name, window: win.getTitle(), path: artifactPath });
  };
  const surface = win => page(win, `(() => {
    const root = document.documentElement;
    const el = document.querySelector('#notes-tab, #send-message, #save, #connect-report');
    return { ...root.dataset, blueDisabled: document.getElementById('blue-style')?.disabled ?? null,
      accent: getComputedStyle(root).getPropertyValue('--accent').trim(),
      action: el && getComputedStyle(el).color,
      glass: document.querySelector('.panel') && getComputedStyle(document.querySelector('.panel')).backgroundImage,
      recordBorder: document.querySelector('#records>.record:last-child') && getComputedStyle(document.querySelector('#records>.record:last-child')).borderBottomWidth,
      apiButton: document.querySelector('#connect-report') && {
        color: getComputedStyle(document.querySelector('#connect-report')).color,
        background: getComputedStyle(document.querySelector('#connect-report')).backgroundColor } };

  })()`);
  const paint = () => page(pet, `(() => {
    const head = document.querySelector('#pet .eb-head');
    const eye = document.querySelector('#pet .eb-eye');
    return { appearance: document.querySelector('#pet').dataset.avatarAppearance,
      head: head && getComputedStyle(head).fill, eye: eye && getComputedStyle(eye).fill };
  })()`);
  const originalPaint = await paint();
  const chatWin = windows.find(win => win.getTitle() === '聊一会儿');
  const customWin = windows.find(win => win.getTitle() === '定制球球');
  const apiWin = windows.find(win => win.getTitle().includes('API 费用与用量'));
  assert.ok(chatWin && customWin && apiWin, '聊天、定制和 API 真实窗口存在');
  await poll(() => page(customWin, "document.querySelector('#body-hex').value"), Boolean, '定制初始形象');
  const originalBody = await page(customWin, "document.querySelector('#body-hex').value");
  const panelWin = notes.getWindows().panel, panelBounds = panelWin.getBounds();
  panelWin.setContentSize(360, 420);
  await poll(() => page(panelWin, 'innerWidth'), width => width === 360, '最窄便签面板');
  const filterState = () => page(panelWin, `(() => ({
    statusLabel: document.querySelector('#filter-label').textContent,
    categoryLabel: document.querySelector('#category-filter-label').textContent,
    inlineFilters: Boolean(document.querySelector('.list-toolbar #filter') && document.querySelector('.list-toolbar #category-filter')),
    headingCount: Boolean(document.querySelector('#group-count')),
    headingHidden: document.querySelector('#group-heading').hidden,
    lastRecordBorder: getComputedStyle(document.querySelector('#records>.record:last-child')).borderBottomWidth,
    progressInToolbar: Boolean(document.querySelector('.list-toolbar #progress-text')),
    progressHidden: document.querySelector('#progress-text').hidden,
    progressText: document.querySelector('#progress-text').textContent,
    progressTitle: document.querySelector('#progress-text').title,
    toolbar: [...document.querySelectorAll('.list-toolbar .tabs button, .list-toolbar .filter-trigger, #progress-text, #toggle-search, #new-button')].filter(button=>button.getBoundingClientRect().width).map(button=>({id:button.id,...button.getBoundingClientRect().toJSON()})),
    menu: [...document.querySelectorAll('.filter-popover:not([hidden])')].map(menu=>({id:menu.id,...menu.getBoundingClientRect().toJSON()})),
    width: innerWidth,
    statusValues: [...document.querySelectorAll('#filter-menu > button')].map(button => button.dataset.filter),
    statusHasManagement: Boolean(document.querySelector('#filter-menu #manage-categories, #filter-menu .manage-entry')),
    openMenus: ['filter-menu', 'category-menu'].filter(id => !document.getElementById(id).hidden),
    statusExpanded: document.querySelector('#filter').getAttribute('aria-expanded'),
    categoryExpanded: document.querySelector('#category-filter').getAttribute('aria-expanded'),
    categoryHidden: document.querySelector('#category-filter-control').hidden,
    managementInHeading: Boolean(document.querySelector('#category-menu .category-menu-heading #manage-categories')),
    managementPresent: Boolean(document.querySelector('#manage-categories')),
    managerOpen: document.querySelector('#category-manager').open
  }))()`);
  await page(panelWin, "document.querySelector('#notes-tab').click(); document.querySelector('#filter').click()");
  const statusMenu = await filterState();
  assert.deepEqual(statusMenu.statusValues, ['all', 'favorites', 'desktop', 'trash'], '便签状态菜单仅四个状态');
  assert.equal(statusMenu.statusLabel, '状态'); assert.equal(statusMenu.categoryLabel, '分类');
  assert.equal(statusMenu.inlineFilters, true); assert.equal(statusMenu.headingCount, false); assert.equal(statusMenu.headingHidden, true); assert.equal(statusMenu.lastRecordBorder, '1px');
  for (const menu of statusMenu.menu) assert.ok(menu.left >= 0 && menu.right <= statusMenu.width, '状态菜单不越界');
  assert.equal(statusMenu.statusHasManagement, false);
  assert.equal(statusMenu.categoryHidden, false);
  assert.deepEqual(statusMenu.openMenus, ['filter-menu']);
  await page(panelWin, "document.querySelector('#category-filter').click()");
  const categoryMenu = await filterState();
  assert.deepEqual(categoryMenu.openMenus, ['category-menu'], '打开分类时关闭状态菜单');
  for (const menu of categoryMenu.menu) assert.ok(menu.left >= 0 && menu.right <= categoryMenu.width, '分类菜单不越界');
  assert.equal(categoryMenu.statusExpanded, 'false');
  assert.equal(categoryMenu.categoryExpanded, 'true');
  assert.equal(categoryMenu.managementInHeading, true, '分类管理位于分类菜单标题行');
  await page(panelWin, "document.querySelector('#filter').click()");
  const statusReopened = await filterState();
  assert.deepEqual(statusReopened.openMenus, ['filter-menu'], '打开状态时关闭分类菜单');
  assert.equal(statusReopened.categoryExpanded, 'false');
  await page(panelWin, "document.querySelector('#category-filter').click(); document.querySelector('#category-menu #manage-categories').click()");
  const manager = await filterState();
  assert.equal(manager.managerOpen, true);
  assert.deepEqual(manager.openMenus, [], '管理弹窗打开时关闭两筛选菜单');
  assert.equal(manager.categoryExpanded, 'false');
  await page(panelWin, "document.querySelector('#category-manager-done').click()");
  const managerClosed = await filterState();
  assert.equal(managerClosed.managerOpen, false);
  assert.deepEqual(managerClosed.openMenus, [], '关闭管理后分类菜单保持关闭');
  await page(panelWin, "document.querySelector('#todos-tab').click()");
  const todoFilters = await filterState();
  for (const view of [statusMenu, todoFilters]) for (const button of view.toolbar) assert.ok(button.left >= 0 && button.right <= view.width && Math.abs(button.top + button.height / 2 - view.toolbar[0].top - view.toolbar[0].height / 2) <= 3, button.id + ' 在最窄面板中保持同一行');
  assert.equal(todoFilters.lastRecordBorder, '1px');
  assert.equal(todoFilters.headingHidden, true); assert.equal(todoFilters.progressInToolbar, true);
  assert.equal(todoFilters.progressHidden, false); assert.equal(todoFilters.progressText, '1/2');
  assert.equal(todoFilters.progressTitle, '今天已完成 1 项，共 2 项');
  assert.equal(todoFilters.categoryHidden, true, '待办隐藏分类筛选');
  assert.equal(todoFilters.categoryExpanded, 'false');
  assert.equal(todoFilters.managementPresent, false, '待办移除动态管理入口');
  assert.deepEqual(todoFilters.openMenus, []);
  const filterFlow = { statusMenu, categoryMenu, statusReopened, manager, managerClosed, todoFilters };
  panelWin.setContentSize(380, 420);
  await poll(() => page(panelWin, 'innerHeight'), height => height === 420, '紧凑编辑窗口');
  await page(panelWin, "document.querySelector('#records .record-title').click()");
  await poll(() => page(panelWin, "document.querySelector('#editor').open"), Boolean, '待办编辑弹窗');
  await page(panelWin, "document.querySelector('#edit-reminder-enabled').click()");
  const editorLayout = () => page(panelWin, `(() => {
    const fields = document.querySelector('#editor-fields'), footer = document.querySelector('#editor .dialog-footer').getBoundingClientRect();
    return { height: innerHeight, fieldsHeight: fields.clientHeight, scrollHeight: fields.scrollHeight,
      footerTop: footer.top, footerBottom: footer.bottom, help: document.querySelector('.reminder-help').innerText };
  })()`);
  const editorBefore = await editorLayout();
  assert.ok(editorBefore.scrollHeight > editorBefore.fieldsHeight, '长内容只在字段区域滚动');
  assert.ok(editorBefore.footerTop >= 0 && editorBefore.footerBottom <= editorBefore.height, '保存/取消无需下滑即可看到');
  await page(panelWin, "document.querySelector('#editor-fields').scrollTop=document.querySelector('#editor-fields').scrollHeight");
  const editorAfter = await editorLayout();
  assert.ok(Math.abs(editorBefore.footerTop - editorAfter.footerTop) <= 1, '滚动内容时按钮固定在底部');
  assert.match(editorAfter.help, /截止日期和提醒时间可以分开设置/);
  assert.match(editorAfter.help, /下次打开时汇总显示/);
  await capture(panelWin, 'todo-editor-fixed-footer');
  await page(panelWin, "document.querySelector('#edit-reminder-enabled').click(); document.querySelector('#editor-cancel').click(); document.querySelector('#notes-tab').click()");
  assert.equal(await page(panelWin, "document.querySelector('#editor').open"), false);
  panelWin.setBounds(panelBounds);
  const editorFooter = { before: editorBefore, after: editorAfter, categoryEntry: true };
  await page(chatWin, "document.querySelector('#message-input').value='还没发送的草稿'; document.querySelector('#message-input').dispatchEvent(new Event('input'))");
  setMode('standard'); select('color-appearance-light'); select('ui-theme-green');
  const green = await Promise.all(windows.map(surface));
  const checks = [];
  for (const theme of ['green', 'blue']) for (const appearance of ['light', 'dark', 'system']) for (const mode of ['standard', 'accessible']) {
    select(`ui-theme-${theme}`); select(`color-appearance-${appearance}`); setMode(mode);
    const resolved = appearance === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : appearance;
    const views = await poll(() => Promise.all(windows.map(surface)), views => views.every(view =>
      view.uiTheme === theme && view.colorMode === mode && view.appearance === resolved &&
      (view.blueDisabled === null || view.blueDisabled === (theme !== 'blue')) &&
      (!view.notesAppearance || view.notesAppearance === resolved) && (!view.theme || view.theme === resolved) &&
      (theme !== 'blue' || mode !== 'standard' || !view.glass ||
        (resolved === 'dark' ? /32, 51, 71/ : /230, 245, 255/).test(view.glass))), `${theme}/${appearance}/${mode}`);
    for (const view of views) if (view.recordBorder !== null) assert.equal(view.recordBorder, '1px', theme + '/' + appearance + '/' + mode + ' 最后一条记录保留细线');
    if (theme === 'blue' && mode === 'standard') {
      const panel = views[windows.indexOf(notes.getWindows().panel)];
      if (resolved === 'light') {
        assert.equal(panel.accent, '#0988f7');
        assert.equal(panel.action, 'rgb(8, 99, 232)');
      }
      assert.match(panel.glass, resolved === 'dark' ? /32, 51, 71/ : /230, 245, 255/, `玻璃渐变使用批准的晴空蓝 ${appearance}: ${panel.glass}`);
      const api = views.find(view => view.apiButton)?.apiButton;
      assert.ok(contrast(api.color, api.background) >= 4.5, 'API 主按钮文字清晰');
      if (resolved === 'light') {
        for (const background of ['rgb(226, 244, 255)', 'rgb(229, 241, 248)', 'rgb(216, 240, 255)'])
          assert.ok((luminance(background) + 0.05) / (luminance(panel.action) + 0.05) >= 4.5, '亮蓝文字在选中、状态与悬停背景上清晰');
        assert.ok((luminance('rgb(226, 244, 255)') + 0.05) / (luminance('rgb(9, 136, 247)') + 0.05) >= 3, '亮蓝图标保持清晰');
      }
    }
    let accessibility;
    if (mode === 'accessible') {
      await page(panelWin, "document.querySelector('#notes-tab').click()");
      const selectedTabShadow = await page(panelWin, "getComputedStyle(document.querySelector('.tabs .active')).boxShadow");
      assert.equal(selectedTabShadow, 'none', '便签选中项无叠加描边阴影');
      const screenshot = theme === 'blue' && appearance !== 'system';
      const suffix = `${theme}-${resolved}-accessible`;
      if (screenshot) await capture(panelWin, `notes-${suffix}`);
      await page(panelWin, "document.querySelector('#filter').click()");
      const statusText = await textStyles(panelWin, [
        { label: 'inactive-tab', selector: '.tabs button[aria-selected="false"]' },
        { label: 'ordinary-status-option', selector: '#filter-menu > button[aria-current="false"]' },
        { label: 'expanded-status-trigger', selector: '#filter[aria-expanded="true"]' },
        { label: 'selected-status-check', selector: '#filter-menu > button[aria-current="true"] .view-check' }
      ]);
      await page(panelWin, "document.querySelector('#category-filter').click()");
      assert.deepEqual((await filterState()).openMenus, ['category-menu']);
      const categoryText = await textStyles(panelWin, [
        { label: 'ordinary-category-option', selector: '#category-menu button[data-category-filter][aria-current="false"]' },
        { label: 'expanded-category-trigger', selector: '#category-filter[aria-expanded="true"]' },
        { label: 'selected-category-check', selector: '#category-menu button[data-category-filter][aria-current="true"] .view-check' },
        { label: 'manage-categories', selector: '#category-menu .category-menu-heading #manage-categories' }
      ]);
      if (screenshot) await capture(panelWin, `notes-category-menu-${suffix}`);
      await page(panelWin, "document.querySelector('#category-menu #manage-categories').click()");
      assert.equal((await filterState()).managerOpen, true);
      const categoryAdd = await textStyles(panelWin, [{ label: 'category-add', selector: '#category-manager[open] #category-add' }]);
      await page(panelWin, "document.querySelector('#category-manager-done').click()");
      await page(panelWin, "document.querySelector('#todos-tab').click()");
      const progressText = await textStyles(panelWin, [{ label: 'todo-progress', selector: '#progress-text' }, { label: 'todo-progress-completed', selector: '#progress-text .completed-count' }]);
      if (screenshot) await capture(panelWin, `todo-compact-${suffix}`);
      await page(panelWin, "document.querySelector('#notes-tab').click()");
      const texts = [...statusText, ...categoryText, ...categoryAdd, ...progressText].map(style => ({ ...style, ratio: contrast(style.color, style.background) }));
      for (const style of texts) assert.ok(style.ratio >= 4.5, `${theme}/${appearance} ${style.label} 文字对比度 ${style.ratio}: ${style.color} / ${style.background}`);
      const notesWindows = [panelWin, ...notes.getWindows().notes];
      assert.ok(notesWindows.length > 1, '真实桌面便签已打开');
      const expectedBacking = resolved === 'dark' ? '#101820' : '#ffffff';
      const backing = await poll(() => Promise.all(notesWindows.map(async win => {
        const body = await page(win, `(() => { const style = getComputedStyle(document.body); return { mode: document.body.dataset.mode,
          background: style.backgroundColor, radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] }; })()`);
        const raw = win.getBackgroundColor(), normalized = raw.toLowerCase().replace(/^(#[a-f\d]{6})ff$/, '$1');
        return { title: win.getTitle(), nativeBackground: raw, normalized, ...body };
      })), entries => entries.every(entry => entry.normalized === expectedBacking && entry.radii.every(radius => radius === (entry.mode === 'note' ? '14px' : '12px'))), `${theme}/${appearance} 原生便签底色和圆角`);
      const [composer, shapes, apiBody] = await Promise.all([
        page(chatWin, `(() => { const composer = document.querySelector('.composer'); if (!composer) throw Error('缺少聊天输入区'); return ['::before', '::after'].map(pseudo => {
          const style = getComputedStyle(composer, pseudo); return { pseudo, backgroundImage: style.backgroundImage, animation: style.animation, animationName: style.animationName }; }); })()`),
        page(customWin, `(() => [...document.querySelectorAll('.shape-option[aria-pressed="true"]')].map(element => ({ shape: element.dataset.shape, boxShadow: getComputedStyle(element).boxShadow })))()`),
        page(apiWin, `(() => ({ background: getComputedStyle(document.body).backgroundColor, accessiblePanel: getComputedStyle(document.documentElement).getPropertyValue('--accessible-panel').trim() }))()`)
      ]);
      for (const pseudo of composer) { assert.equal(pseudo.backgroundImage, 'none', `高对比输入区 ${pseudo.pseudo} 无渐变`); assert.equal(pseudo.animationName, 'none', `高对比输入区 ${pseudo.pseudo} 无动画`); }
      assert.equal(shapes.length, 1, '定制窗口有一个选中形态');
      assert.equal(shapes[0].boxShadow, 'none', '选中形态无叠加描边阴影');
      assert.equal(apiBody.accessiblePanel.toLowerCase(), expectedBacking);
      assert.equal(apiBody.background, resolved === 'dark' ? 'rgb(16, 24, 32)' : 'rgb(255, 255, 255)', 'API body 使用当前高对比面板底色');
      accessibility = { texts, backing, selectedTabShadow, composer, shapes, apiBody };
      if (screenshot) {
        await capture(notes.getWindows().notes[0], `desktop-note-${suffix}`);
        await capture(chatWin, `chat-${suffix}`);
        await capture(customWin, `customize-${suffix}`);
        await capture(apiWin, `api-usage-${suffix}`);
      }
    }
    assert.equal(await page(chatWin, "document.querySelector('#message-input').value"), '还没发送的草稿');
    assert.equal(await page(customWin, "document.querySelector('#body-hex').value"), originalBody);
    assert.deepEqual(await paint(), originalPaint, '界面主题不改变球球和聊天头像的外观输入');
    checks.push({ theme, appearance, mode, resolved, views, ...(accessibility ? { accessibility } : {}) });
  }
  select('ui-theme-green'); setMode('standard'); select('color-appearance-light');
  await poll(() => Promise.all(windows.map(surface)), views => views.every(view => view.appearance === 'light'), '恢复绿色浅色');
  assert.deepEqual(await Promise.all(windows.map(surface)), green, '往返切换恢复原绿色样式');
  select('ui-theme-blue');
  await poll(() => surface(notes.getWindows().panel), view => view.action === 'rgb(8, 99, 232)', '批准的晴空蓝强调文字');
  await capture(notes.getWindows().panel, 'notes-blue-light');
  await page(notes.getWindows().panel, "document.querySelector('#todos-tab').click()");
  await poll(() => page(notes.getWindows().panel, "document.querySelector('#todos-tab').getAttribute('aria-selected')"), value => value === 'true', '待办列表');
  await capture(notes.getWindows().panel, 'todos-blue-light');
  for (const win of windows.filter(win => win !== pet && win !== notes.getWindows().panel)) await capture(win, `${win.getTitle().includes('便签') ? 'desktop-note' : win === chatWin ? 'chat' : win === customWin ? 'customize' : 'api-usage'}-blue-light`);
  // Late-created reminder also uses the same production preload and broadcast.
  store.update(state => ({ ...state, todos: state.todos.map(item => item.id === todo.id
    ? { ...item, reminderAt: Date.now() - 1000, reminderState: 'pending' } : item) }));
  await poll(() => notes.getWindows().reminder?.isVisible(), Boolean, '晚创建的提醒窗口');
  const reminder = notes.getWindows().reminder;
  await poll(() => surface(reminder), view => view.uiTheme === 'blue' && view.appearance === 'light', '提醒主题');
  await capture(reminder, 'reminder-blue-light');
  chatWin.webContents.reload();
  await poll(() => surface(chatWin), view => view.uiTheme === 'blue' && view.appearance === 'light', '窗口重载继承主题');
  select('color-appearance-dark');
  await poll(() => surface(notes.getWindows().panel), view => view.appearance === 'dark', '深色主题');
  await capture(notes.getWindows().panel, 'todos-blue-dark');
  select('color-appearance-light');
  assert.deepEqual(getSettings().customization, before.customization);
  assert.deepEqual(getSettings().startupAppearance, before.startupAppearance);
  assert.deepEqual(getSettings().appearancePresets, before.appearancePresets);
  assert.equal(chat.getState().busy, false);
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(saved.uiTheme, 'blue'); assert.equal(saved.colorMode, 'standard'); assert.equal(saved.codexQuotaAppearance, 'light');
  if (output) { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'verification.json'), `${JSON.stringify({ checks, savedTheme: saved.uiTheme, originalPaint, editorFooter, filterFlow, captures }, null, 2)}\n`); }
  process.stdout.write(`PET_UI_THEME_OK ${checks.length} combinations, ${windows.length} native windows\n`);
}

module.exports = { verifyUiTheme, textStyles, contrast };
