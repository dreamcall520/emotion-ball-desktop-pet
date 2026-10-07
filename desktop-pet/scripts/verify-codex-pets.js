const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { SIZES } = require('../lib/window-placement');
const { ACTIONS } = require('../lib/codex-pet-player');
const { capturePaintedWindow } = require('./verify-codex-companion');
const { pointerClick } = require('./verify-chat-integration');
const { textStyles, contrast } = require('./verify-ui-theme');

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

// Called only from the explicit isolated source or packaged smoke branch.
async function verifyCodexPets({ pet, customize, openCustomization, openChat, getChatWindow,
  getSettings, setSize, store, poll, getMenu, nativeTheme, packaged = false, output = process.env.PET_CODEX_PETS_QA_OUT,
  phase = process.env.PET_CODEX_PETS_QA_PHASE || 'all' }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CODEX_PETS_ONLY, '1');
  assert.equal(typeof packaged, 'boolean', 'packaged 取自主 App 的实际 isPackaged');
  assert.ok(['save', 'restart', 'all', 'local'].includes(phase));
  assert.ok(output && path.isAbsolute(output), '明确指定验收输出目录');
  const stateFile = process.env.PET_CODEX_PETS_QA_STATE;
  assert.ok(stateFile && path.isAbsolute(stateFile), '重启阶段需要隔离状态文件');
  fs.mkdirSync(output, { recursive: true });
  const waitFor = poll || (async (read, check, label, timeout = 5000) => {
    const end = performance.now() + timeout;
    let value;
    do { value = await read(); if (check(value)) return value; await wait(40); } while (performance.now() < end);
    assert.fail(`${label}: ${JSON.stringify(value)}`);
  });
  if (!customize) customize = await openCustomization();
  assert.ok(customize?.webContents, 'openCustomization 返回真实定制窗口');
  const page = code => customize.webContents.executeJavaScript(code, true);
  const petPage = code => pet.webContents.executeJavaScript(code, true);
  await waitFor(() => page('window.__customizerReady === true'), Boolean, '定制页加载');
  const errors = [];
  for (const window of [pet, customize]) window.webContents.on('did-fail-load', (_event, code, description) => errors.push({ code, description }));
  const click = async selector => {
    await page(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'})`);
    await pointerClick(customize, selector);
  };
  const input = (selector, value, event = 'change') => page(`(() => {
    const input=document.querySelector(${JSON.stringify(selector)});
    input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true}));
    return true;
  })()`);
  const preview = () => page(`(() => {
    const nodes=[...document.querySelectorAll('#stage .codex-pet-sprite')], node=nodes[0];
    const r=node?.getBoundingClientRect();
    return {count:nodes.length,state:node?{...node.dataset}:null,width:r?.width,height:r?.height,
      opacity:node?getComputedStyle(node).opacity:null,image:node?.toDataURL()};
  })()`);
  const desktop = () => petPage(`(() => { const nodes=[...document.querySelectorAll('#pet .codex-pet-sprite')];
    return {count:nodes.length,state:nodes[0]?{...nodes[0].dataset}:null}; })()`);
  const readyPreview = id => waitFor(preview, value => value.count === 1 && value.state?.codexReady === 'ready' &&
    (!id || value.state.codexPetId === id), '当前候选精灵图已绘制');
  const readyDesktop = id => waitFor(desktop, value => value.count === 1 && value.state?.codexReady === 'ready' &&
    value.state.codexPetId === id, '桌面导入图已绘制');
  const capture = (window, name) => capturePaintedWindow({ win: window, artifactPath: path.join(output, `${name}.png`) });
  const checks = [];
  let actualPetsObserved = 0;
  assert.equal(await page("document.querySelector('#source-ball').getAttribute('aria-pressed')"), 'true', '打开默认球球来源');
  checks.push('default ball source');
  if (phase === 'save') await capture(customize, 'customizer-ball-sections');

  async function verifyChat(id) {
    await openChat();
    const chat = getChatWindow();
    assert.ok(chat?.webContents, '聊天真实窗口存在');
    await waitFor(() => chat.webContents.executeJavaScript(`(() => {
      const nodes=[...document.querySelectorAll('#chat-avatar .codex-pet-sprite')];
      return {count:nodes.length,state:nodes[0]?{...nodes[0].dataset}:null}; })()`),
    value => value.count === 1 && value.state?.codexReady === 'ready' && value.state.codexPetId === id, '聊天头像同步导入形象');
    await capture(chat, `chat-${phase}`);
    checks.push('matching live chat avatar');
    return chat;
  }

  if (phase === 'local') {
    // Read the user's existing library. Only the isolated App profile may receive a copy.
    const catalog = store.list();
    actualPetsObserved = catalog.pets.length;
    assert.ok(actualPetsObserved > 0, '本机存在可读取宠物');
    await click('#source-codex');
    await waitFor(() => page("document.querySelectorAll('#pet-grid button').length"),
      count => count === actualPetsObserved, '真实本机库完整显示');
    const options = await page("[...document.querySelector('#pet-action').options].map(o=>({value:o.value,text:o.textContent}))");
    const observed = [];
    for (const item of catalog.pets) {
      assert.ok((item.version === 1 && item.rows === 9) || (item.version === 2 && item.rows === 11), '精灵图版本与行数一致');
      await click(`#pet-grid button[data-pet-id="${item.id}"]`);
      await readyPreview(item.id);
      for (const id of ['idle', 'wave', 'run-left']) {
        const action = ACTIONS.find(action => action.id === id);
        const option = options.find(option => option.value === id || option.value === String(action.row));
        assert.ok(option, `预览支持 ${id}`); await input('#pet-action', option.value);
        const start = await waitFor(preview, view => view.state?.codexReady === 'ready' && view.state.codexAction === id, `${id} 动作行`);
        await waitFor(preview, view => view.state?.codexAction === id &&
          view.state.codexFrame !== start.state.codexFrame, `${id} 原始帧推进`);
      }
      observed.push({ version: item.version, rows: item.rows, actions: ['idle', 'wave', 'run-left'] });
    }
    const selected = catalog.pets.find(item => item.name === '春野') || catalog.pets[0];
    await click(`#pet-grid button[data-pet-id="${selected.id}"]`); await readyPreview(selected.id);
    const idle = options.find(option => option.value === 'idle' || option.value === '0');
    await input('#pet-action', idle.value); await capture(customize, 'customizer-local');
    await page("document.querySelector('#startup-default').checked=true"); await click('#save');
    await waitFor(() => getSettings().startupAppearance.codexPetId,
      id => typeof id === 'string' && id !== selected.id, '真实素材副本保存到隔离设置');
    const importedId = getSettings().startupAppearance.codexPetId;
    assert.equal(getSettings().customization.appearance.codexPetId, importedId);
    const imported = store.getImported(importedId);
    assert.notEqual(imported.spritesheetPath, selected.spritesheetPath);
    assert.equal(digest(imported.spritesheetPath), digest(selected.spritesheetPath), '副本与真实素材字节一致');
    await readyDesktop(importedId); await verifyChat(importedId);
    await capture(pet, 'desktop-local');
    fs.writeFileSync(path.join(output, 'local-versions.json'), JSON.stringify({ actualPetsObserved, skipped: catalog.skipped, observed }, null, 2));
    checks.push('read-only local catalog', 'each original v1 / v2 sheet decodes and advances three action rows',
      'isolated imported copy / startup preference / desktop / chat');
  } else if (phase === 'restart') {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(getSettings().customization.appearance.codexPetId, state.startupId, '新进程恢复启动形象，而非临时换装');
    assert.equal(getSettings().startupAppearance.codexPetId, state.startupId);
    assert.equal(store.list().pets.length, 0, '源目录已移除');
    const imported = store.getImported(state.startupId);
    assert.equal(digest(imported.spritesheetPath), state.sheetDigest, '重启读取持久资源副本');
    await readyDesktop(state.startupId);
    await readyPreview(state.startupId);
    await verifyChat(state.startupId);
    await capture(customize, 'customizer-restart'); await capture(pet, 'desktop-restart');
    checks.push('source removed', 'startup wins after actual process restart', 'copied asset still renders');
  } else {
    const sourceDirectory = process.env.PET_CODEX_PETS_QA_SOURCE_ROOT;
    assert.ok(sourceDirectory && path.isAbsolute(sourceDirectory), '只允许隔离 fixture 源目录');
    const sourceRoot = fs.realpathSync(sourceDirectory);
    const initial = clone(getSettings());
    const catalog = store.list();
    assert.equal(catalog.pets.length, 30, '30 套虚构 fixture');
    assert.equal(catalog.skipped, 0);
    await click('#source-codex');
    await waitFor(() => page("document.querySelectorAll('#pet-grid button').length"), count => count === 30, '30 条真实 catalog 显示');
    const geometry = await page(`(() => { const g=document.querySelector('#pet-grid'), s=document.querySelector('#pet-search');
      return {scroll:g.scrollHeight,client:g.clientHeight,columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,
        searchVisible:Boolean(s.getClientRects().length),bodyWidth:document.documentElement.scrollWidth,width:innerWidth}; })()`);
    assert.equal(geometry.columns, 3); assert.ok(geometry.scroll > geometry.client); assert.equal(geometry.searchVisible, true);
    assert.ok(geometry.bodyWidth <= geometry.width + 1);
    await input('#pet-search', '测试宠物 0', 'input');
    assert.equal(await page("document.querySelectorAll('#pet-grid button').length"), 9, '即时按名称筛选');
    await input('#pet-search', '没有这个名字', 'input');
    assert.equal(await page("document.querySelectorAll('#pet-grid button').length"), 0, '无匹配不显示旧卡片');
    await input('#pet-search', '', 'input');
    const last = catalog.pets.at(-1), temporaryPet = catalog.pets.at(-2), stale = catalog.pets[0];
    const choose = async item => {
      const selector = `#pet-grid button[data-pet-id="${item.id}"],#pet-grid button[data-imported-id="${item.importedId || item.id}"]`;
      const selectedId = await page(`document.querySelector(${JSON.stringify(selector)})?.dataset.petId`);
      assert.ok(selectedId, `库中保留 ${item.name}`);
      await click(selector); await readyPreview(selectedId);
    };
    await choose(last);
    assert.ok(await page("document.querySelector('#pet-grid').scrollTop > 0"), '列表末项可选择');
    await capture(customize, 'customizer-30-pets');
    const originalSize = customize.getContentSize();
    customize.setContentSize(760, 580);
    await waitFor(() => page('innerWidth'), width => width === 760, '原生最小宽度');
    const minimum = await page(`(() => {const r=document.querySelector('#save').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
        scrollHeight:document.documentElement.scrollHeight,save:r.toJSON()};})()`);
    assert.ok(minimum.scrollWidth <= minimum.width + 1 && minimum.scrollHeight <= minimum.height + 1, '最小原生窗口没有整体溢出');
    assert.ok(minimum.save.left >= 0 && minimum.save.right <= minimum.width && minimum.save.bottom <= minimum.height, '保存按钮始终可见');
    await capture(customize, 'customizer-minimum'); customize.setContentSize(...originalSize);
    checks.push('30 pets / 3 columns / internal scroll', 'name search / clear / no match / last item');
    checks.push('760 x 580 native layout');
    const options = await page("[...document.querySelector('#pet-action').options].map(o=>({value:o.value,text:o.textContent}))");
    assert.equal(options.length, ACTIONS.length);
    for (const option of options) {
      const action = ACTIONS.find(item => item.id === option.value || String(item.row) === option.value);
      assert.ok(action, `动作 ${option.value} 可识别`);
      await input('#pet-action', option.value);
      await waitFor(preview, value => value.state?.codexAction === action.id, `原动画 ${action.id}`);
    }
    await input('#pet-action', options[0].value);
    await click('#pet-play');
    const paused = await preview(); await wait(450);
    assert.equal((await preview()).image, paused.image, '暂停冻结实际像素');
    await click('#pet-play');
    await waitFor(preview, value => value.image !== paused.image, '继续播放改变实际像素');
    checks.push('nine original animations', 'pause / resume pixels');
    await click('#preview-desktop');
    const sizeNames = Object.keys(SIZES);
    for (const [name, size] of Object.entries(SIZES)) {
      const menuSize = sizeNames[(sizeNames.indexOf(name) + 1) % sizeNames.length];
      await setSize(menuSize);
      await waitFor(() => page("document.querySelector('#pet-size').value"), value => value === menuSize, '菜单尺寸同步定制');
      await input('#pet-size', name);
      await waitFor(() => getSettings().size, value => value === name, '定制尺寸同步设置');
      const view = await waitFor(preview, value => value.count === 1 && value.state?.codexReady === 'ready' &&
        Math.abs(value.height - size.height) <= 1, '尺寸对应精灵图已绘制');
      assert.ok(Math.abs(view.height - size.height) <= 1 && Math.abs(view.width / view.height - 192 / 208) < .01, '六档等比例预览');
      assert.equal(pet.getBounds().width, size.width); assert.equal(pet.getBounds().height, size.height);
    }
    await input('#pet-opacity', 40, 'input');
    await waitFor(preview, view => view.opacity === '0.6', '透明度对应精灵图已绘制');
    checks.push('six shared sizes in both directions', 'aspect ratio and transparency');
    await choose(stale);
    const manifest = path.join(path.dirname(stale.spritesheetPath), 'pet.json');
    assert.ok(manifest.startsWith(`${sourceRoot}${path.sep}`), '故障仅注入隔离 fixture');
    const beforeFailure = clone(getSettings());
    fs.renameSync(manifest, `${manifest}.removed`);
    try {
      await page("document.querySelector('#startup-default').checked=false"); await click('#save'); await wait(180);
      assert.deepEqual(getSettings(), beforeFailure, '源被删除时保存失败不改设置');
      assert.equal((await readyPreview(stale.id)).state.codexPetId, stale.id, '失败保留候选');
    } finally { fs.renameSync(`${manifest}.removed`, manifest); }
    checks.push('failed import keeps settings and candidate');
    await choose(last); await page("document.querySelector('#startup-default').checked=true"); await click('#save');
    await waitFor(() => getSettings().startupAppearance.codexPetId, id => typeof id === 'string' && id !== last.id, '导入副本设为启动');
    const startupId = getSettings().startupAppearance.codexPetId;
    assert.equal(getSettings().customization.appearance.codexPetId, startupId);
    const copied = store.getImported(startupId);
    assert.notEqual(copied.spritesheetPath, last.spritesheetPath); assert.equal(digest(copied.spritesheetPath), digest(last.spritesheetPath));
    await readyDesktop(startupId); const chat = await verifyChat(startupId);
    await capture(pet, 'desktop-imported');
    await choose(temporaryPet); await page("document.querySelector('#startup-default').checked=false"); await click('#save');
    await waitFor(() => getSettings().customization.appearance.codexPetId, id => typeof id === 'string' && id !== startupId && id !== temporaryPet.id, '临时形象已导入');
    const temporaryId = getSettings().customization.appearance.codexPetId;
    assert.equal(getSettings().startupAppearance.codexPetId, startupId, '临时换装保留启动形象');
    await readyDesktop(temporaryId); await verifyChat(temporaryId);
    // Switching candidates to a ball destroys the preview player without changing the desktop.
    await click('#source-ball');
    assert.equal(await page("document.querySelector('#manual-toggle').disabled"), true, '人物候选禁用球球专属轮廓与五官');
    assert.equal(await page("document.querySelector('#manual-controls').hidden"), true, '人物候选收起球球手动控件');
    await click('#shape-options .shape-option[data-shape="blob"]');
    assert.equal(await page("document.querySelector('#manual-toggle').disabled"), false, '选择球球后恢复手动入口');
    await click('#manual-toggle');
    assert.equal(await page("document.querySelector('#manual-controls').hidden"), false, '球球手动调整仍可展开');
    await waitFor(preview, view => view.count === 0, '球球预览清理旧精灵播放器');
    assert.equal(getSettings().customization.appearance.codexPetId, temporaryId, '未保存候选不改变桌面');
    await page("document.querySelector('#startup-default').checked=false"); await click('#save');
    await waitFor(() => getSettings().customization.appearance.shape, value => value === 'blob', '保存球球清理运行人物');
    await waitFor(desktop, view => view.count === 0, '桌面旧精灵节点清理');
    await waitFor(() => chat.webContents.executeJavaScript("document.querySelectorAll('#chat-avatar .codex-pet-sprite').length"),
      count => count === 0, '聊天旧精灵节点清理');
    await click('#source-codex'); await choose(temporaryPet);
    await page("document.querySelector('#startup-default').checked=false"); await click('#save');
    await waitFor(() => getSettings().customization.appearance.codexPetId, id => id === temporaryId, '换回临时人物复用副本');
    await readyDesktop(temporaryId); await verifyChat(temporaryId);
    assert.equal(getSettings().startupAppearance.codexPetId, startupId);
    fs.writeFileSync(stateFile, JSON.stringify({ startupId, temporaryId, sheetDigest: digest(copied.spritesheetPath),
      initialShape: initial.startupAppearance.shape }));
    checks.push('content addressed copy', 'startup checked / temporary unchecked', 'old preview / desktop / chat players removed',
      'ball-only controls disabled for sprite and restored for ball');
    assert.ok(chat && !chat.isDestroyed());
  }
  const themeChecks = [];
  if (getMenu && phase === 'save') {
    const appearances = clone({ current: getSettings().customization, startup: getSettings().startupAppearance,
      presets: getSettings().appearancePresets });
    const activeId = getSettings().customization.appearance.codexPetId;
    await readyDesktop(activeId);
    const importedDigest = digest(store.getImported(activeId).spritesheetPath);
    const select = id => { const item = getMenu().getMenuItemById(id); assert.ok(item?.enabled, id); item.click(item, pet, {}); };
    for (const theme of ['green', 'blue']) for (const appearance of ['light', 'dark', 'system']) for (const mode of ['standard', 'accessible']) {
      select('ui-theme-' + theme); select('color-appearance-' + appearance);
      const toggle = getMenu().getMenuItemById('color-accessible');
      if (toggle.checked !== (mode === 'accessible')) toggle.click(toggle, pet, {});
      const resolved = appearance === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : appearance;
      await waitFor(() => page('({...document.documentElement.dataset})'), value => value.uiTheme === theme && value.colorMode === mode && value.theme === resolved, 'Codex 宠物主题同步');
      if (theme === 'blue' && mode === 'standard') await waitFor(() => page(`(() => {
        const stage=document.querySelector('#stage');
        return {background:getComputedStyle(stage).backgroundColor,dark:stage.classList.contains('dark')};
      })()`), view => view.background === (resolved === 'light' ?
        (view.dark ? 'rgb(32, 43, 54)' : 'rgb(243, 246, 249)') :
        (view.dark ? 'rgb(237, 242, 248)' : 'rgb(37, 49, 61)')), '晴空蓝样式加载完成');
      const visual = await page(`(() => {
        const selected = document.querySelector('.pet-card[aria-pressed=true]'), stage = document.querySelector('#stage'), range = document.querySelector('#pet-opacity');
        const style = selected && getComputedStyle(selected), dimensions = document.querySelector('#pet-grid');
        return { root: {...document.documentElement.dataset}, selected: selected && {id:selected.dataset.petId, border:style.borderColor, background:style.backgroundColor, color:style.color},
          stage:getComputedStyle(stage).backgroundColor, stageDark:stage.classList.contains('dark'),
          columns:getComputedStyle(dimensions).gridTemplateColumns.split(' ').length,
          selects:['pet-action','pet-size'].map(id=>({id,color:getComputedStyle(document.getElementById(id)).color, background:getComputedStyle(document.getElementById(id)).backgroundColor, arrow:getComputedStyle(document.getElementById(id)).backgroundImage})),
          opacity:Number(range.value), fill:range.style.getPropertyValue('--range-fill'), saveColor:getComputedStyle(document.querySelector('#save')).color };
      })()`);
      assert.ok(visual.selected, '切换主题保留选中宠物'); assert.equal(visual.columns, 3);
      assert.equal(visual.fill, visual.opacity / 60 * 100 + '%', '透明度轨道与当前位置一致');
      if (theme === 'blue' && mode === 'standard') assert.equal(visual.stage,
        resolved === 'light' ? (visual.stageDark ? 'rgb(32, 43, 54)' : 'rgb(243, 246, 249)') :
        (visual.stageDark ? 'rgb(237, 242, 248)' : 'rgb(37, 49, 61)'), '蓝色预览底未被新增CSS覆盖');
      let texts;
      if (mode === 'accessible') {
        texts = await textStyles(customize, [
          {label:'source-tab',selector:'#source-codex'}, {label:'pet-name',selector:'.pet-card[aria-pressed=true] .pet-name'},
          {label:'ordinary-pet',selector:'.pet-card[aria-pressed=false] .pet-name'}, {label:'selected-check',selector:'.pet-card[aria-pressed=true] .selection-mark'},
          {label:'refresh',selector:'#refresh-pets'}, {label:'search',selector:'#pet-search'},
          {label:'opacity',selector:'#pet-opacity-value'},
          {label:'save',selector:'#save'}
        ]);
        for (const text of texts) { text.ratio = contrast(text.color,text.background); assert.ok(text.ratio >= (text.label==='selected-check'?3:4.5), text.label + ' 色弱对比 ' + text.ratio); }
      }
      if(mode === 'accessible') for(const item of visual.selects) assert.ok(contrast(item.color,item.background) >= 4.5, item.id+' 下拉文字清晰（箭头在右侧留白区）');
      await input('#pet-search', '没有这个名字', 'input');
      assert.equal(await page('document.querySelectorAll("#pet-grid button").length'),0);
      if (mode==='accessible') for (const text of await textStyles(customize,[{label:'empty',selector:'#pet-filter-status'}]))
        assert.ok(contrast(text.color,text.background)>=4.5,'无匹配状态清晰');
      await input('#pet-search', '', 'input');
      if (theme === 'blue' && appearance !== 'system') await capture(customize, 'codex-pets-' + resolved + '-' + mode);
      assert.deepEqual(clone({ current:getSettings().customization, startup:getSettings().startupAppearance, presets:getSettings().appearancePresets }), appearances, '主题不改变导入形象、启动外观或收藏');
      assert.equal((await readyDesktop(activeId)).state.codexPetId,activeId);
      assert.equal(digest(store.getImported(activeId).spritesheetPath),importedDigest,'主题不改变导入副本');
      themeChecks.push({theme,appearance,mode,resolved,visual,texts});
    }
    select('ui-theme-blue'); select('color-appearance-light');
    const toggle=getMenu().getMenuItemById('color-accessible');if(toggle.checked)toggle.click(toggle,pet,{});
    checks.push('12 Codex pet theme combinations and accessible controls', 'theme changes preserve imported assets / startup / favorites');
  }
  assert.deepEqual(errors, [], '没有原生页面加载失败');
  fs.writeFileSync(path.join(output, `report-${phase}.json`), JSON.stringify({ ok: true, packaged,
    isolatedUserData: true, sourceFixtures: phase === 'local' ? 0 : 30, actualPetsObserved,
    actualModelCalls: 0, phase, checks, themeChecks }, null, 2));
  process.stdout.write(`PET_CODEX_PETS_${phase.toUpperCase()}_OK\n`);
  return { checks };
}

module.exports = { verifyCodexPets };
