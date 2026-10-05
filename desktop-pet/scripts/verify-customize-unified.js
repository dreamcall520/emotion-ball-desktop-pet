const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { capturePaintedWindow } = require('./verify-codex-companion');
const { pointerClick } = require('./verify-chat-integration');

function readCustomizeSurface() {
  const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
  const controls = document.querySelector('.controls');
  const panelStyle = getComputedStyle(document.querySelector('.studio'));
  const bodyStyle = getComputedStyle(document.body);
  return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight, scrollY,
    bodyPadding: ['Top', 'Right', 'Bottom', 'Left'].map(side => bodyStyle['padding' + side]),
    panelBorders: ['Top', 'Right', 'Bottom', 'Left'].map(side => panelStyle['border' + side + 'Width']),
    panelRadii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => panelStyle['border' + corner + 'Radius']),
    panelMaxWidth: panelStyle.maxWidth,
    panel: rect('.studio'), header: rect('.studio-header'), reset: rect('#reset-appearance'), title: rect('.studio-header h1'),
    headerDrag: getComputedStyle(document.querySelector('.studio-header')).getPropertyValue('-webkit-app-region'),
    resetDrag: getComputedStyle(document.querySelector('#reset-appearance')).getPropertyValue('-webkit-app-region'),
    footer: rect('.studio-footer'), save: rect('#save'), startup: rect('.startup-default'),
    preview: rect('.preview-pane'), stage: rect('#stage'), ball: rect('#preview-ball'),
    controls: rect('.controls'), controlsScroll: controls.scrollTop,
    controlsHeight: controls.scrollHeight, controlsClient: controls.clientHeight,
    controlsOverflow: getComputedStyle(controls).overflowY,
    saves: document.querySelectorAll('#save').length,
    oldSave: Boolean(document.querySelector('#save-bottom')),
    saveInFooter: document.querySelector('.studio-footer').contains(document.querySelector('#save')),
    startupInFooter: document.querySelector('.studio-footer').contains(document.querySelector('#startup-default')),
    footerBorder: getComputedStyle(document.querySelector('.studio-footer')).borderTopWidth,
    theme: document.documentElement.dataset.theme,
    manualTag: document.querySelector('#manual-toggle').tagName,
    manualExpanded: document.querySelector('#manual-toggle').getAttribute('aria-expanded'),
    sizeLabel: document.querySelector('#preview-size-label').textContent,
    shapes: [...document.querySelectorAll('#shape-options button')].map(button => [...button.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()) };
}

function assertCustomizeSurface(view, content, { width = 760, height = 580, desktopPixels = null } = {}) {
  assert.equal(view.width, width, '定制实际内容宽度');
  assert.equal(view.height, height, '定制实际内容高度');
  assert.ok(Math.abs(content.width - width) <= 1 && Math.abs(content.height - height) <= 1, 'native content 与 DOM 一致');
  assert.ok(view.scrollWidth <= width + 1 && view.scrollHeight <= height + 1, '定制整体页面不滚动或横向溢出');
  const inside = (r, parent) => r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1;
  const viewport = { left: 0, top: 0, right: width, bottom: height };
  for (const key of ['panel', 'header', 'footer', 'preview', 'controls', 'stage']) assert.ok(inside(view[key], viewport), `${key} 不被 native 窗口裁切`);
  assert.ok(Math.abs(view.panel.left) <= 1 && Math.abs(view.panel.top) <= 1 &&
    Math.abs(view.panel.right - width) <= 1 && Math.abs(view.panel.bottom - height) <= 1, '定制页面四边铺满 native content');
  assert.deepEqual(view.bodyPadding, ['0px', '0px', '0px', '0px'], '移除外层页面留白');
  assert.deepEqual(view.panelBorders, ['0px', '0px', '0px', '0px'], '移除第二层卡片边框');
  assert.deepEqual(view.panelRadii, ['0px', '0px', '0px', '0px'], '移除第二层卡片圆角');
  assert.equal(view.panelMaxWidth, 'none', '页面表面不受内层卡片最大宽度限制');
  assert.ok(Math.abs(view.footer.left) <= 1 && Math.abs(view.footer.right - width) <= 1 &&
    Math.abs(view.footer.bottom - height) <= 1, '保存底栏贴合窗口左右边与底边');
  assert.ok(inside(view.reset, view.header), '恢复默认按钮留在标题行');
  assert.ok(view.title.top >= 40 && view.reset.top >= 40, '正文标题与按钮避开顶部原生交通灯');
  assert.equal(view.headerDrag, 'drag', '完整标题区保留窗口拖动');
  assert.equal(view.resetDrag, 'no-drag', '恢复默认按钮保持可点击');
  assert.ok(inside(view.save, view.footer) && inside(view.startup, view.footer), '保存与启动外观留在固定底栏');
  assert.equal(view.saves, 1, '唯一保存按钮');
  assert.equal(view.oldSave, false);
  assert.equal(view.saveInFooter, true);
  assert.equal(view.startupInFooter, true);
  assert.equal(view.footerBorder, '0px', '底栏使用渐变阴影');
  assert.ok(['auto', 'scroll'].includes(view.controlsOverflow), '设置区独立滚动');
  assert.ok(view.controlsHeight > view.controlsClient, '最小尺寸设置区确实可滚动');
  assert.ok(view.controls.left >= view.preview.right, '左右分栏不重叠');
  assert.equal(view.manualTag, 'BUTTON');
  assert.ok(['true', 'false'].includes(view.manualExpanded));
  for (const label of ['经典', '云朵', '幻彩', '方糖']) assert.ok(view.shapes.includes(label), `${label} 入口保留`);
  if (desktopPixels !== null) {
    assert.equal(view.ball.width, desktopPixels, '桌面预览保持实际尺寸');
    assert.equal(view.ball.height, desktopPixels);
    assert.ok(inside(view.ball, view.stage), '大尺寸桌面预览不被裁切');
    assert.ok(view.sizeLabel.includes(String(desktopPixels)), '实际尺寸标签仍可见');
  }
}

async function verifyAvatarMotion({ win, shape, appearance, poll, output, previewWindow }) {
  const page = code => win.webContents.executeJavaScript(code, true);
  const expectedEngine = shape === 'aurora-cloud' ? 'rive' : 'emotion-ball';
  await poll(() => page("({...document.querySelector('#chat-avatar').dataset})"),
    state => state.shape === shape && state.avatarEngine === expectedEngine && state.avatarReady === 'true' && state.avatarActive === 'true', `${shape} 真实头像实例启动`);
  assert.equal(await page("document.querySelectorAll('#chat-avatar > svg').length"), 1, '切换形态后只留当前 SVG 实例');
  assert.equal(await page("document.querySelectorAll('#chat-avatar .eb-rive-aurora').length"), shape === 'aurora-cloud' ? 1 : 0, '旧 Rive 节点不残留');
  const renderedCanvases = [];
  if (shape === 'aurora-cloud' && appearance?.auroraContour === 'six-lobe') {
    assert.equal(await page("document.querySelector('#chat-avatar .eb-rive-aurora.ready')?.dataset.auroraContour"), 'six-lobe', '已保存幻彩头像保留六瓣形态');
    assert.equal(await page("document.querySelector('#chat-avatar .eb-rive-aurora.ready')?.dataset.auroraOutlineReady"), 'true', '六瓣头像加载认可的六瓣素材');
    for (const [source, selector, name] of [[win, '#chat-avatar', 'chat'], [previewWindow, '#preview-ball', 'customize']]) {
      assert.ok(source, '六瓣头像验收同时采集定制实际渲染');
      await poll(() => source.webContents.executeJavaScript(`document.querySelector('${selector} .eb-rive-aurora.ready')?.dataset.auroraOutlineReady`), value => value === 'true', '实际六瓣 canvas 就绪');
      const region = await source.webContents.executeJavaScript(`(() => {
        const target=document.querySelector('${selector}');
        return {rect:target.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,
          fallbackHidden:getComputedStyle(target.querySelector(':scope > svg')).visibility==='hidden'};
      })()`);
      assert.equal(region.fallbackHidden, true, 'Rive 证据不能来自 SVG fallback');
      // Rive uses preserveDrawingBuffer:0; read the compositor, not a cleared WebGL buffer.
      const screenshot = require('electron').nativeImage.createFromBuffer(await capturePaintedWindow({ win: source }));
      const { width, height } = screenshot.getSize(), { rect } = region;
      const x = Math.floor(rect.left * width / region.width), y = Math.floor(rect.top * height / region.height);
      const image = screenshot.crop({ x, y, width: Math.ceil(rect.right * width / region.width) - x,
        height: Math.ceil(rect.bottom * height / region.height) - y });
      const bitmap = image.toBitmap();
      assert.ok(!image.isEmpty() && bitmap.some((value, index) => index % 4 === 0 &&
        value > bitmap[index + 1] + 12 && bitmap[index + 2] > bitmap[index + 1] + 7 && bitmap[index + 3] > 128),
      '原生合成帧必须实际显示当前幻彩身体，不能只留 metadata 或空背景');
      const file = path.join(output, `${name}-avatar-six-lobe-render.png`);
      fs.writeFileSync(file, image.toPNG()); renderedCanvases.push(file);
    }
  }
  if (shape !== 'aurora-cloud' && appearance) {
    assert.deepEqual(await page("[...document.querySelectorAll('#chat-avatar defs > radialGradient:first-child > stop')].map(node=>node.getAttribute('stop-color'))"), appearance.bodyStops, '头像与当前预览球体配色一致');
    assert.equal(await page(`[...document.querySelectorAll('#chat-avatar .eb-eye')].every(node=>node.getAttribute('fill')?.toUpperCase()===${JSON.stringify(appearance.eyeColor)})`), true, '头像跟随当前眼睛配色');
  }
  const frames = [];
  for (let index = 0; index < 4; index += 1) {
    await wait(250);
    const r = await page("document.querySelector('#chat-avatar').getBoundingClientRect().toJSON()");
    const frame = await win.webContents.capturePage({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) });
    frames.push(crypto.createHash('sha256').update(frame.toPNG()).digest('hex'));
  }
  assert.ok(new Set(frames).size > 1, `${shape} 头像实际帧必须有轻动效`);
  const file = path.join(output, `chat-avatar-${shape}.png`);
  await capturePaintedWindow({ win, artifactPath: file });
  const debuggerApi = win.webContents.debugger;
  assert.equal(debuggerApi.isAttached(), false, '头像验收独占 CDP');
  debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await poll(() => page("document.querySelector('#chat-avatar').dataset.avatarActive"), value => value === 'false', '减少动态暂停头像');
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await poll(() => page("document.querySelector('#chat-avatar').dataset.avatarActive"), value => value === 'true', '恢复头像动效');
  } finally { debuggerApi.detach(); }
  return { shape, engine: expectedEngine, distinctFrames: new Set(frames).size, reducedMotion: true, screenshot: file, renderedCanvases };
}

function observeAvatarSave() {
  window.__avatarSaveObservation?.stop();
  const started = performance.now();
  const initialRive = document.querySelector('#chat-avatar > .eb-rive-aurora');
  let raf, readyFrames = 0;
  const visible = node => Boolean(node && node.getClientRects().length &&
    getComputedStyle(node).visibility !== 'hidden' && Number(getComputedStyle(node).opacity) > 0);
  const read = () => {
    const target = document.querySelector('#chat-avatar'), svg = target.querySelector(':scope > svg');
    const held = target.querySelector(':scope > span'), canvas = target.querySelector(':scope > .eb-rive-aurora');
    const rive = target.querySelector(':scope > .eb-rive-aurora.ready');
    return { time: performance.now() - started, rect: target.getBoundingClientRect().toJSON(),
      shape: target.dataset.shape, engine: target.dataset.avatarEngine, ready: target.dataset.avatarReady,
      active: target.dataset.avatarActive,
      replacement: Boolean(canvas && canvas !== initialRive),
      pending: target.dataset.avatarEngine === 'rive' && target.dataset.avatarReady === 'false',
      fallbackHidden: Boolean(svg && getComputedStyle(svg).visibility === 'hidden'),
      heldVisible: Boolean(held && [...held.children].some(visible)),
      posterVisible: visible(target.querySelector(':scope > img')),
      riveVisible: visible(rive), contour: rive?.dataset.auroraContour || null,
      outlineReady: rive?.dataset.auroraOutlineReady || null };
  };
  const observation = { frames: [read()], finished: false, read, stop: () => cancelAnimationFrame(raf) };
  const tick = () => {
    const frame = read(); observation.frames.push(frame);
    readyFrames = frame.replacement && frame.ready === 'true' && frame.riveVisible ? readyFrames + 1 : 0;
    observation.finished = readyFrames >= 3;
    if (!observation.finished && frame.time < 7000) raf = requestAnimationFrame(tick);
  };
  window.__avatarSaveObservation = observation;
  raf = requestAnimationFrame(tick);
  return true;
}

function assertAvatarSaveTransition(report) {
  const pending = report.observed.filter(frame => frame.pending);
  assert.equal(report.observed[0].replacement, false, '逐帧观察在保存前的已呈现头像开始');
  for (const frame of pending) {
    assert.equal(frame.fallbackHidden, true, '加载新幻彩期间不能露出深紫 SVG fallback');
    assert.ok(frame.heldVisible || frame.posterVisible || frame.riveVisible, '加载期间保留已绘制头像或正确原生截图');
  }
  const final = report.observed.at(-1);
  assert.equal(report.finished, true, '真实 Rive 完成头像交接');
  assert.equal(final.replacement, true, '新 Rive 实例实际接替保存前的头像');
  assert.equal(final.shape, 'aurora-cloud'); assert.equal(final.engine, 'rive');
  assert.equal(final.ready, 'true'); assert.equal(final.active, 'true');
  assert.equal(final.contour, 'six-lobe'); assert.equal(final.outlineReady, 'true');
  assert.equal(final.fallbackHidden, true); assert.equal(final.riveVisible, true);
  assert.equal(final.heldVisible, false); assert.equal(final.posterVisible, false);
  assert.ok(report.captures.length >= 8, '保存前后至少保留八张真实头像帧');
  assert.equal(report.captures[0].before.replacement, false, '原生裁图包含点击保存前的真实头像');
  if (pending.length) assert.ok(report.captures.some(frame => frame.before.pending || frame.after.pending ||
    pending.some(sample => sample.time >= frame.before.time && sample.time <= frame.after.time)), '出现加载时保留该阶段的原生裁图');
  for (const frame of report.captures) assert.ok(frame.colorRange >= 40, '原生头像帧实际有身体与眼睛，不能只有空白背景');
  assert.ok(new Set(report.captures.map(frame => frame.digest)).size > 1, '原生保存过程不能重复一张旧合成帧');
  assert.equal(report.captures.at(-1).before.riveVisible, true, '最终原生裁图在新 Rive 绘制后采集');
  assert.equal(report.captures.at(-1).after.contour, 'six-lobe');
  assert.ok(report.captures.at(-1).purplePixels > 0, '交接完成的原生帧显示当前幻彩身体');
}

async function verifyAvatarSaveTransition({ win, save, output, name }) {
  const page = code => win.webContents.executeJavaScript(code, true), captures = [];
  await page(`(${observeAvatarSave.toString()})()`);
  let saveError = null, saving;
  try {
    let finished = false, readyCaptures = 0;
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline && !saveError && (!finished || captures.length < 8 || readyCaptures < 2)) {
      const before = await page('window.__avatarSaveObservation.read()'), r = before.rect;
      // Capture the compositor continuously; WebGL toDataURL reads a cleared buffer.
      win.webContents.invalidate?.();
      const image = await win.webContents.capturePage({ x: Math.floor(r.left), y: Math.floor(r.top),
        width: Math.ceil(r.right) - Math.floor(r.left), height: Math.ceil(r.bottom) - Math.floor(r.top) });
      const after = await page('({...window.__avatarSaveObservation.read(),finished:window.__avatarSaveObservation.finished})');
      const bitmap = image.toBitmap(), min = [255, 255, 255], max = [0, 0, 0];
      let purplePixels = 0;
      assert.equal(image.isEmpty(), false, '保存期间真实头像裁图非空');
      for (let index = 0; index < bitmap.length; index += 4) if (bitmap[index + 3] > 128) {
        for (let channel = 0; channel < 3; channel++) {
          min[channel] = Math.min(min[channel], bitmap[index + channel]); max[channel] = Math.max(max[channel], bitmap[index + channel]);
        }
        if (bitmap[index] > bitmap[index + 1] + 12 && bitmap[index + 2] > bitmap[index + 1] + 7) purplePixels++;
      }
      const file = path.join(output, `chat-avatar-save-${name}-${String(captures.length).padStart(2, '0')}.png`);
      const buffer = image.toPNG(); fs.writeFileSync(file, buffer);
      captures.push({ file, before, after, colorRange: Math.max(...max.map((value, index) => value - min[index])),
        purplePixels, digest: crypto.createHash('sha256').update(buffer).digest('hex') });
      // Obtain a painted "before" frame before triggering the actual pointer click.
      if (!saving) saving = Promise.resolve().then(save).catch(error => { saveError = error; });
      finished = after.finished; readyCaptures = after.ready === 'true' && after.riveVisible ? readyCaptures + 1 : 0;
      await wait(16);
    }
    await saving; if (saveError) throw saveError;
    const observed = await page('({frames:window.__avatarSaveObservation.frames,finished:window.__avatarSaveObservation.finished})');
    const report = { name, observed: observed.frames, finished: observed.finished, captures };
    fs.writeFileSync(path.join(output, `chat-avatar-save-${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
    assertAvatarSaveTransition(report);
    return report;
  } finally { await page('window.__avatarSaveObservation?.stop(); delete window.__avatarSaveObservation;').catch(() => {}); }
}

async function verifyCustomizeUnified({ pet, editor, chatWindow, open, getWindow, getSettings, readSettings, restore, setSaveFailure, setSize }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CUSTOMIZE_ONLY, '1');
  const output = process.env.PET_CUSTOMIZE_SMOKE_OUT || path.join(os.tmpdir(), `qiuqiu-customize-unified-${process.pid}`);
  fs.mkdirSync(output, { recursive: true });
  const original = JSON.parse(JSON.stringify(getSettings())), surfaces = [], avatars = [], avatarTransitions = [], pickerChecks = [], checks = [], screenshots = [];
  let win = editor;
  const page = code => win.webContents.executeJavaScript(code, true);
  const poll = async (read, test, label) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) { const value = await read(); if (test(value)) return value; await wait(40); }
    assert.fail(label);
  };
  const ready = async () => {
    await poll(() => getWindow(), value => Boolean(value && !value.isDestroyed()), '定制窗口存在'); win = getWindow();
    await poll(() => page('window.__customizerReady === true && !document.querySelector("#save").disabled'), Boolean, '定制设置加载');
    await poll(() => win.isVisible(), Boolean, '定制可见');
  };
  const reopen = async () => { if (win && !win.isDestroyed()) win.close(); await poll(() => getWindow(), value => !value, '关闭释放定制窗口'); open(); await ready(); };
  const setField = async (id, value) => page(`(() => { const node=document.getElementById(${JSON.stringify(id)}); node.value=${JSON.stringify(String(value))}; node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const previewReady = async () => poll(() => page(`(() => {
    const target=document.querySelector('#preview-ball'),selected=document.querySelector('#shape-options [aria-pressed="true"]');
    const rendered=target.dataset.renderedAppearance?JSON.parse(target.dataset.renderedAppearance):null;
    return Boolean(rendered&&selected&&rendered.shape===selected.dataset.shape&&
      (rendered.shape!=='aurora-cloud'||rendered.auroraContour===selected.dataset.auroraContour)&&
      rendered.bodyColor===document.querySelector('#body-hex').value.toUpperCase()&&
      rendered.eyeColor===document.querySelector('#eye-hex').value.toUpperCase()&&
      target.querySelector(':scope > svg .eb-head')&&
      (rendered.shape!=='aurora-cloud'||target.querySelector('.eb-rive-aurora.ready')));
  })()`),Boolean,'当前形态和配色完成真实预览绘制');
  const shapeSelector = shape => shape === 'aurora-cloud'
    ? '#shape-options [data-shape="aurora-cloud"][data-aurora-contour="six-lobe"]' : `#shape-options [data-shape="${shape}"]`;
  const chooseShape = async shape => {
    await page("document.querySelector('.controls').scrollTop=0"); await pointerClick(win, shapeSelector(shape));
    await poll(() => page(`document.querySelector(${JSON.stringify(shapeSelector(shape))}).getAttribute('aria-pressed')`), value => value === 'true', `切换 ${shape}`);
    await previewReady();
  };
  const capture = async name => { const file = path.join(output, `${name}.png`); await capturePaintedWindow({ win, artifactPath: file }); screenshots.push(file); };
  const verifyPicker = async appearance => {
    const entrances = [];
    await chooseShape('aurora-cloud');
    await page("document.querySelector('#aurora-style-dimensional').click()");
    for (const [id, hexId, label] of [['body-color','body-hex','球体'],['eye-color','eye-hex','眼睛'],
      ['glow-pink-color','glow-pink-hex','粉光'],['glow-gold-color','glow-gold-hex','金光']]) {
      await page(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
      await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const originalHex = await page(`document.getElementById(${JSON.stringify(hexId)}).value`);
      const hit = await page(`(() => { const button=document.getElementById(${JSON.stringify(id)}),r=button.getBoundingClientRect();
        const target=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
        return {clickable:!button.disabled&&button.contains(target),target:target?.id||target?.tagName,rect:r.toJSON(),scroll:document.querySelector('.controls').scrollTop}; })()`);
      assert.equal(hit.clickable, true, `选色实际指针位置命中当前按钮 ${JSON.stringify(hit)}`);
      await pointerClick(win, '#' + id);
      await poll(() => page(`({open:!document.querySelector('#color-picker').hidden,
        expanded:document.getElementById(${JSON.stringify(id)}).getAttribute('aria-expanded'),title:document.querySelector('#color-picker-title').textContent})`),
      value => value.open && value.expanded === 'true' && value.title === label + '颜色', '四颜色入口实际打开当前选色器');
      assert.equal(await page("document.querySelectorAll('.color-trigger[aria-expanded=true]').length"), 1, '同一时刻只展开当前颜色入口');
      await setField(hexId, '#2A8B6F');
      assert.equal(await page("document.querySelector('#color-picker-hex').value"), '#2A8B6F', 'HEX输入同步当前选色器');
      await setField(hexId, originalHex);
      if (id === 'glow-gold-color') {
        const pinkBefore = await page("document.querySelector('#glow-pink-hex').value");
        assert.equal(await page("document.querySelector('#color-picker-presets .swatch').getAttribute('aria-label')"), '选用颜色 #D0AD8A', '同长度粉光到金光重建当前推荐色表');
        await pointerClick(win, '#color-picker-presets .swatch');
        assert.equal(await page("document.querySelector('#glow-gold-hex').value"), '#D0AD8A', '金光推荐色实际点击修改金光');
        assert.equal(await page("document.querySelector('#glow-pink-hex').value"), pinkBefore, '金光推荐色不串改粉光');
        await setField(hexId, originalHex);
      }
      entrances.push({ id, title: label + '颜色', hexLinked: true });
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await poll(() => page(`document.querySelector('#color-picker').hidden && document.activeElement.id===${JSON.stringify(id)}`), Boolean, '每个选色入口Esc返回焦点');
    }
    await chooseShape('square');
    await page("document.querySelector('.controls').scrollTop=0");
    const originalColor = await page("document.querySelector('#body-hex').value");
    const originalTransparency = await page("document.querySelector('#aurora-transparency').value");
    await pointerClick(win, '#body-color');
    await poll(() => page("!document.querySelector('#color-picker').hidden"), Boolean, '真实点击打开页内选色');
    const surface = await page(`(() => {
      const picker=document.querySelector('#color-picker');
      return {rect:picker.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,
        nativeInputs:document.querySelectorAll('input[type=color]').length,
        theme:document.documentElement.dataset.theme,background:getComputedStyle(picker).backgroundColor,
        sv:{role:document.querySelector('#color-sv').getAttribute('role'),disabled:document.querySelector('#color-sv').getAttribute('aria-disabled'),rect:document.querySelector('#color-sv').getBoundingClientRect().toJSON()},
        fields:['color-picker-hex','color-red','color-green','color-blue'].map(id=>({id,disabled:document.getElementById(id).disabled})),
        sliders:['color-hue'].map(id=>({id,
          type:document.getElementById(id).type,appearance:getComputedStyle(document.getElementById(id)).appearance,
          disabled:document.getElementById(id).disabled}))};
    })()`);
    assert.equal(surface.nativeInputs, 0, '不调用 Chromium 原生颜色弹窗');
    assert.equal(surface.theme, appearance);
    assert.ok(surface.rect.left >= 0 && surface.rect.right <= surface.width && surface.rect.top >= 0 && surface.rect.bottom <= surface.height, '最小窗口选色浮层完整在视口内');
    assert.notEqual(surface.background, 'rgba(0, 0, 0, 0)', '浅深浮层都有完整不透明表面');
    assert.ok(surface.sliders.every(slider => slider.type === 'range' && slider.appearance === 'none' && !slider.disabled), '色相保留原生range并使用定制材质');
    assert.equal(surface.sv.role, 'slider'); assert.equal(surface.sv.disabled, 'false');
    assert.ok(surface.fields.every(field => !field.disabled), 'HEX和RGB可编辑');
    assert.ok(surface.sv.rect.width > 200 && surface.sv.rect.height >= 140, '二维色盘保留连续选色空间');
    await setField('color-hue', 120);
    const sv = surface.sv.rect;
    let dragging = false;
    const pointer = (type, x, y) => {
      if (type === 'mouseDown') dragging = true;
      if (type === 'mouseUp') dragging = false;
      win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y),
        ...(type === 'mouseMove' ? (dragging ? { modifiers: ['leftButtonDown'] } : {}) : { button: 'left', clickCount: 1 }) });
    };
    const cx = (sv.left + sv.right) / 2, cy = (sv.top + sv.bottom) / 2;
    pointer('mouseMove', cx, cy); pointer('mouseDown', cx, cy); pointer('mouseUp', cx, cy);
    const centerHex = await poll(() => page("document.querySelector('#body-hex').value"),
      value => /^#[0-9A-F]{6}$/.test(value) && parseInt(value.slice(3,5),16) >= 126 && parseInt(value.slice(3,5),16) <= 130 &&
        Math.abs(parseInt(value.slice(1,3),16) - 64) <= 2 && Math.abs(parseInt(value.slice(5,7),16) - 64) <= 2, '二维色盘真实中心点击更新颜色');
    pointer('mouseDown', cx, cy);
    await poll(() => page("document.querySelector('#color-sv').hasPointerCapture(1)"), Boolean, '真实拖动使用pointer capture');
    pointer('mouseMove', sv.right + 14, sv.bottom + 14);
    await poll(() => page("document.querySelector('#body-hex').value"), value => value === '#000000', '拖动出界向右下夹紧为黑色');
    await setField('color-hue', 240);
    pointer('mouseMove', sv.right + 14, sv.top - 8);
    await poll(() => page("document.querySelector('#body-hex').value"), value => value === '#0000FF', '黑色拖动仍保留色相并向右上夹紧');
    pointer('mouseUp', sv.right + 14, sv.top - 8);
    await poll(() => page("document.querySelector('#color-sv').hasPointerCapture(1)"), value => !value, '拖动结束释放pointer capture');
    await page("document.querySelector('#color-sv').focus({preventScroll:true})");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['shift'] });
    await poll(() => page("document.querySelector('#color-sv').getAttribute('aria-valuetext')"),
      value => value === '饱和度 99%，明度 90%', '二维色盘方向键与Shift调整有可读双值');
    const keyboardSv = await page("({hex:document.querySelector('#body-hex').value,focus:document.activeElement.id,outline:getComputedStyle(document.querySelector('#color-sv')).outlineStyle})");
    assert.equal(keyboardSv.focus, 'color-sv'); assert.equal(keyboardSv.outline, 'solid', '二维键盘操作保留可见焦点');
    await setField('color-picker-hex', '#2A8B6F');
    assert.deepEqual(await page("['color-red','color-green','color-blue'].map(id=>document.getElementById(id).value)"), ['42','139','111'], 'HEX同步RGB');
    for (const invalid of ['', '256', '-1', '1.5']) {
      await setField('color-red', invalid);
      assert.equal(await page("document.querySelector('#body-hex').value"), '#2A8B6F', '空值/越界/小数RGB不污染有效颜色');
      await page("document.querySelector('#color-red').dispatchEvent(new Event('change',{bubbles:true}))");
      assert.equal(await page("document.querySelector('#color-red').value"), '42', '无效RGB完成编辑后恢复有效值');
    }
    for (const [id,value] of [['color-red',12],['color-green',34],['color-blue',56]]) await setField(id,value);
    assert.equal(await page("document.querySelector('#color-picker-hex').value"), '#0C2238', 'RGB同步HEX与实际颜色');
    await pointerClick(win, '#color-picker-presets .swatch');
    assert.equal(await page("document.querySelector('#body-hex').value"), '#EEEBE4', '浮层复用当前字段推荐配色');
    await setField('color-hue', 120);
    await page("document.querySelector('#color-hue').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await poll(() => page("document.querySelector('#color-hue').value"), value => value === '121', '键盘连续选择色相');
    await pointerClick(win, '#color-picker-title');
    assert.equal(await page("document.querySelector('#color-picker').hidden"), false, '浮层内非交互区点击保持打开');
    await capture(`customize-760-picker-${appearance}`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await poll(() => page("document.querySelector('#color-picker').hidden && document.activeElement.id==='body-color'"), Boolean, 'Esc关闭并还原选色按钮焦点');
    await pointerClick(win, '#body-color'); await pointerClick(win, '#preview-large');
    assert.equal(await page("document.querySelector('#color-picker').hidden"), true, '浮层外真实点击关闭');
    await setField('body-hex', originalColor);
    await page("document.querySelector('#aurora-transparency').scrollIntoView({block:'center'})");
    const range = await page("document.querySelector('#aurora-transparency').getBoundingClientRect().toJSON()");
    const x = Math.round((range.left + range.right) / 2), y = Math.round((range.top + range.bottom) / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    const value = await poll(() => page("Number(document.querySelector('#aurora-transparency').value)"), value => Math.abs(value - 30) <= 1, '定制轨道仍支持真实点击定位');
    assert.equal(await page("document.querySelector('#aurora-transparency-value').textContent"), value + '%', '透明度数值跟随真实操作');
    const endpoints = [];
    for (const endpoint of [0,60]) {
      await setField('aurora-transparency', endpoint);
      win.webContents.sendInputEvent({ type:'mouseMove',x:Math.round(endpoint===0?range.left+8:range.right-8),y });
      await wait(60);
      const thumb = await page(`(() => { const input=document.querySelector('#aurora-transparency'),style=getComputedStyle(input,'::-webkit-slider-thumb');
        return {value:input.value,output:document.querySelector('#aurora-transparency-value').textContent,fill:input.style.getPropertyValue('--range-fill'),shadow:style.boxShadow,range:input.getBoundingClientRect().toJSON()}; })()`);
      assert.equal(thumb.value,String(endpoint)); assert.equal(thumb.output,endpoint+'%');
      assert.equal(thumb.fill,endpoint===0?'0%':'100%');
      assert.doesNotMatch(thumb.shadow,/0px 0px 0px 3px/, '端点悬停无旧外光晕');
      await capture(`customize-760-range-${endpoint}-${appearance}`);
      endpoints.push(thumb);
    }
    await setField('aurora-transparency', originalTransparency);
    await page("document.querySelector('.controls').scrollTop=0");
    pickerChecks.push({ appearance, entrances, surface, centerHex, keyboardSv, endpoints, pointerDrag: true, rgbGuarded: true, pointerTransparency: value, keyboardHue: 121, escapeFocus: true, outsideDismissed: true });
  };
  const snapshot = async (name, options = {}) => {
    const view = await page(`(${readCustomizeSurface.toString()})()`), nativeContent = win.getContentBounds();
    assertCustomizeSurface(view, nativeContent, options);
    assert.deepEqual(view.shapes, ['经典', '云朵', '幻彩', '方糖'], '公开定制页只显示四种已支持形态');
    surfaces.push({ name, nativeContent, nativeOuter: win.getBounds(),
      surfaceEdgeOffsets: { left: view.panel.left, top: view.panel.top,
        right: nativeContent.width - view.panel.right, bottom: nativeContent.height - view.panel.bottom }, view }); return view;
  };
  try {
    await ready();
    await page(`document.querySelector('#save').addEventListener('click',()=>{
      const buttons=[...document.querySelectorAll('.color-trigger')];
      const sliders=['color-hue','color-picker-hex','color-red','color-green','color-blue'].map(id=>document.getElementById(id));
      window.__pickerSaveObservation={buttonsDisabled:buttons.every(node=>node.disabled),
        rangesDisabled:sliders.every(node=>node.disabled),svDisabled:document.querySelector('#color-sv').getAttribute('aria-disabled')==='true',pointerReleased:!document.querySelector('#color-sv').hasPointerCapture(1),closed:document.querySelector('#color-picker').hidden};
    },{once:true})`);
    const preferences = win.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true);
    if (process.platform === 'darwin') {
      assert.equal(typeof win.getWindowButtonPosition, 'function', '保留原生交通灯位置接口');
      assert.deepEqual(win.getWindowButtonPosition(), { x: 14, y: 14 }, '原生交通灯位于完整页面表面');
    }
    win.setContentSize(760, 580); await poll(() => page('innerWidth === 760 && innerHeight === 580'), Boolean, '最小内容 760×580');
    for (const appearance of ['light', 'dark']) {
      win.webContents.send('pet:color-mode', 'standard', appearance);
      await poll(() => page('document.documentElement.dataset.theme'), value => value === appearance, '定制浅深主题');
      await chooseShape('square');
      await verifyPicker(appearance);
      await page("document.querySelector('#manual-toggle').click()");
      if (await page("document.querySelector('#manual-controls').hidden")) await page("document.querySelector('#manual-toggle').click()");
      const before = await snapshot(`${appearance}-top`);
      await capture(`customize-760-${appearance}-top`);
      await page("document.querySelector('.controls').scrollTop=document.querySelector('.controls').scrollHeight");
      const after = await snapshot(`${appearance}-bottom`);
      assert.ok(after.controlsScroll > 0, '设置区确实滚动');
      assert.deepEqual(after.preview, before.preview, '右侧滚动不移动左预览');
      assert.deepEqual(after.footer, before.footer, '右侧滚动不移动保存底栏');
      assert.equal(after.scrollY, 0, '整页不随设置区滚动');
      await capture(`customize-760-${appearance}-bottom`);
    }
    checks.push('native 760×580 + light/dark independent scroll');
    checks.push('native inline HSV picker light/dark + keyboard/Esc/outside + styled range pointer');
    win.setContentSize(960, 700);
    await poll(() => page('innerWidth === 960 && innerHeight === 700'), Boolean, '常规内容 960×700');
    for (const appearance of ['light', 'dark']) {
      win.webContents.send('pet:color-mode', 'standard', appearance);
      await poll(() => page('document.documentElement.dataset.theme'), value => value === appearance, '常规定制浅深主题');
      await page("document.querySelector('.controls').scrollTop=0");
      await snapshot(`normal-${appearance}`, { width: 960, height: 700 });
      await capture(`customize-960-${appearance}`);
    }
    checks.push('native 960×700 full window surface light/dark');
    chatWindow.show({ messages: [] });
    const avatarWindow = chatWindow.getWindow();
    await poll(() => avatarWindow?.webContents.executeJavaScript("document.querySelector('#chat-avatar')?.dataset.avatarReady"), value => value === 'true', '已保存头像就绪');
    const avatarState = () => avatarWindow.webContents.executeJavaScript(`(() => {
      const target=document.querySelector('#chat-avatar');
      return {shape:target.dataset.shape,engine:target.dataset.avatarEngine,
        contour:target.querySelector('.eb-rive-aurora.ready')?.dataset.auroraContour || null};
    })()`);
    for (const shape of ['blob', 'cloud', 'square', 'aurora-cloud']) {
      const savedBefore = JSON.stringify(getSettings().customization), avatarBefore = await avatarState();
      await chooseShape(shape);
      if (shape === 'cloud') { await setField('body-hex', '#3C5E72'); await setField('eye-hex', '#F8EACD'); await previewReady(); }
      const appearance = await page("({bodyColor:document.querySelector('#body-hex').value,eyeColor:document.querySelector('#eye-hex').value,bodyStops:[...document.querySelectorAll('#preview-ball defs > radialGradient:first-child > stop')].map(node=>node.getAttribute('stop-color'))})");
      if (shape !== 'aurora-cloud') assert.equal(appearance.bodyStops.length, 3, '真实预览身体渐变完整');
      chatWindow.show({ messages: [] });
      await poll(() => chatWindow.isVisible(), Boolean, '头像窗口可见');
      assert.equal(JSON.stringify(getSettings().customization), savedBefore, '选择形态和调色均不改已保存设置');
      assert.deepEqual(await avatarState(), avatarBefore, '未保存草稿不能替换已打开或重新打开的聊天头像');
      await page("document.querySelector('#startup-default').checked=false");
      if (shape === 'aurora-cloud') avatarTransitions.push(await verifyAvatarSaveTransition({ win: avatarWindow,
        save: () => pointerClick(win, '#save'), output, name: 'square-to-six-lobe' }));
      else await pointerClick(win, '#save');
      await poll(() => getSettings().customization.appearance,
        value => value.shape === shape && value.bodyColor === appearance.bodyColor && value.eyeColor === appearance.eyeColor &&
          (shape !== 'aurora-cloud' || value.auroraContour === 'six-lobe'), '保存后才将形态和配色同步给聊天');
      await poll(() => page("!document.querySelector('#save').disabled"), Boolean, '头像外观保存完成');
      appearance.auroraContour = getSettings().customization.appearance.auroraContour;
      avatars.push(await verifyAvatarMotion({ win: avatarWindow, shape, appearance, poll, output, previewWindow: win }));
      if (shape === 'aurora-cloud') {
        const beforeRecolor = JSON.stringify(getSettings().customization), beforeAvatar = await avatarState();
        await setField('body-hex', '#8B72D8'); await setField('glow-pink-hex', '#EE83D8');
        assert.equal(JSON.stringify(getSettings().customization), beforeRecolor, '幻彩调色草稿不改变已保存外观');
        assert.deepEqual(await avatarState(), beforeAvatar, '幻彩调色草稿不替换已显示头像');
        avatarTransitions.push(await verifyAvatarSaveTransition({ win: avatarWindow,
          save: () => pointerClick(win, '#save'), output, name: 'six-lobe-recolor' }));
        await poll(() => getSettings().customization.appearance, value => value.bodyColor === '#8B72D8' &&
          value.glowPinkColor === '#EE83D8' && value.auroraContour === 'six-lobe', '第二次保存幻彩配色生效');
        await poll(() => page("!document.querySelector('#save').disabled"), Boolean, '幻彩配色保存完成');
      }
      chatWindow.hide();
      await poll(() => avatarWindow.webContents.executeJavaScript("document.querySelector('#chat-avatar').dataset.avatarActive"), value => value === 'false', '隐藏聊天暂停头像');
      if (shape === 'aurora-cloud') {
        await setField('aurora-transparency', 42);
        await poll(() => page("document.querySelector('#aurora-transparency-value').textContent"), value => value === '42%', '幻彩透明度');
        assert.equal(await page("document.querySelector('#manual-toggle').disabled"), true, '幻彩保留现有微调限制');
      }
    }
    checks.push('draft never changes chat; four saved live avatar engines + six-lobe rendered canvases, motion and pause');
    checks.push('two native save transitions: pending fallback hidden, painted portraits retained, final six-lobe + recolor');
    const saveObservation = await page('window.__pickerSaveObservation');
    assert.deepEqual(saveObservation, { buttonsDisabled: true, rangesDisabled: true, svDisabled: true, pointerReleased: true, closed: true }, '实际保存期间禁用颜色入口/二维色盘/输入并释放拖动收起浮层');
    pickerChecks.push({ saveObservation });
    restore(original); await reopen();
    const persistedBefore = JSON.stringify(readSettings().customization);
    await chooseShape('cloud'); await setField('body-hex', '#3C5E72'); await setField('eye-hex', '#F8EACD');
    assert.equal(JSON.stringify(getSettings().customization), JSON.stringify(original.customization), '预览不改桌面外观');
    await reopen();
    assert.equal(JSON.stringify(readSettings().customization), persistedBefore, '未保存关闭不改设置文件');
    assert.equal(await page("document.querySelector('#body-hex').value"), original.customization.appearance.bodyColor, '重开恢复已保存外观');
    checks.push('unsaved close restores saved appearance');
    win.setContentSize(760, 580);
    await chooseShape('cloud'); await setField('body-hex', '#3C5E72'); await setField('eye-hex', '#F8EACD');
    await setField('aurora-transparency', 24);
    await page("document.querySelector('#startup-default').checked=false");
    await pointerClick(win, '#save');
    await poll(() => getSettings().customization.appearance.bodyColor, value => value === '#3C5E72', '临时换装生效');
    assert.deepEqual(getSettings().startupAppearance, original.startupAppearance, '临时换装保留启动外观');
    assert.equal(readSettings().customization.appearance.bodyColor, '#3C5E72');
    assert.deepEqual(readSettings().startupAppearance, original.startupAppearance);
    await poll(() => page("!document.querySelector('#save').disabled && document.querySelector('#message').textContent.includes('恢复启动外观')"), Boolean, '临时保存提示');
    checks.push('temporary save persisted without changing startup appearance');
    await chooseShape('square'); await setField('body-hex', '#C7DBD4'); await setField('eye-hex', '#203F39');
    await page("document.querySelector('.controls').scrollTop=document.querySelector('.controls').scrollHeight; if(document.querySelector('#manual-controls').hidden)document.querySelector('#manual-toggle').click()");
    await setField('shape-width', 113); await setField('eye-spacing', 115);
    await page("document.querySelector('#startup-default').checked=true");
    if (setSaveFailure) {
      const beforeFailure = JSON.stringify(getSettings().customization); setSaveFailure(true);
      await pointerClick(win, '#save');
      await poll(() => page("!document.querySelector('#save').disabled && document.querySelector('#message').textContent.includes('保存未完成')"), Boolean, '保存失败可重试');
      assert.equal(await page("document.querySelector('#body-hex').value"), '#C7DBD4', '失败保留编辑');
      assert.equal(JSON.stringify(getSettings().customization), beforeFailure, '失败不改变已保存设置');
      setSaveFailure(false); checks.push('failed save preserves edits and enables retry');
    }
    await pointerClick(win, '#save');
    await poll(() => getSettings().startupAppearance.bodyColor, value => value === '#C7DBD4', '保存启动外观');
    assert.deepEqual(readSettings().startupAppearance, getSettings().customization.appearance);
    assert.equal(readSettings().customization.appearance.shapeTuning.width, 1.13);
    assert.equal(readSettings().customization.appearance.eyeSpacing, 1.15);
    await reopen();
    assert.equal(await page("document.querySelector('#startup-default').checked"), true, '重开识别启动外观');
    assert.equal(await page("document.querySelector('#body-hex').value"), '#C7DBD4');
    checks.push('startup save + tuning persisted and reloads');
    const beforePresets = JSON.parse(JSON.stringify(getSettings()));
    const presetName = '海盐幻彩验收' + process.pid, renamed = '海盐幻彩收藏' + process.pid;
    const presetCount = () => getSettings().appearancePresets.length;
    const baselineCount = presetCount();
    const scrollClick = async selector => {
      await page("document.querySelector(" + JSON.stringify(selector) + ").scrollIntoView({block:'center'})");
      await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await pointerClick(win, selector);
    };
    await chooseShape('aurora-cloud');
    await setField('body-hex', '#D9E5F2'); await setField('eye-hex', '#FFFFFF');
    await setField('aurora-transparency', 18);
    const desktopBeforePreset = JSON.stringify(getSettings().customization);
    const startupBeforePreset = JSON.stringify(getSettings().startupAppearance);
    chatWindow.show({ messages: [] });
    const chatBeforePreset = await avatarState();
    await scrollClick('#preset-add'); await setField('preset-name', presetName);
    if (setSaveFailure) {
      setSaveFailure(true); await scrollClick('#preset-submit');
      await poll(() => page("!document.querySelector('#preset-submit').disabled && document.querySelector('#preset-error').textContent.length>0"), Boolean, '收藏保存失败有说明且可重试');
      assert.equal(presetCount(), baselineCount);
      assert.equal(await page("document.querySelector('#body-hex').value"), '#D9E5F2', '收藏失败保留配色草稿');
      assert.equal(await page("document.querySelector('#preset-name').value"), presetName, '收藏失败保留名称');
      setSaveFailure(false);
    }
    await scrollClick('#preset-submit');
    const preset = await poll(() => getSettings().appearancePresets.find(row => row.name === presetName), Boolean, '命名收藏实际保存');
    assert.equal(presetCount(), baselineCount + 1);
    assert.equal(preset.appearance.bodyColor, '#D9E5F2'); assert.equal(preset.appearance.auroraTransparency, 18);
    assert.equal(preset.appearance.auroraContour, 'six-lobe');
    assert.deepEqual(readSettings().appearancePresets.find(row => row.id === preset.id), preset, '收藏回读真实原子保存文件');
    assert.equal(JSON.stringify(getSettings().customization), desktopBeforePreset, '新增收藏不应用桌面草稿');
    assert.equal(JSON.stringify(getSettings().startupAppearance), startupBeforePreset, '新增收藏不改变启动外观');
    assert.deepEqual(await avatarState(), chatBeforePreset, '新增收藏不改变聊天头像');
    await scrollClick('#preset-add'); await setField('preset-name', presetName); await scrollClick('#preset-submit');
    await poll(() => page("document.querySelector('#preset-error').textContent.length>0"), Boolean, '同名不能静默覆盖');
    assert.equal(presetCount(), baselineCount + 1);
    const contentDuplicateBefore=JSON.stringify(getSettings());
    await setField('preset-name',presetName+'另名');await scrollClick('#preset-submit');
    await poll(()=>page("document.querySelector('#preset-error').textContent"),value=>value.includes('无需重复保存')&&value.includes(presetName),'同内容换名称仍提示原收藏名称');
    assert.equal(JSON.stringify(getSettings()),contentDuplicateBefore,'重复内容不能新增记录或更改外观');
    assert.equal(await page("document.querySelector('#preset-name').value"),presetName+'另名','重复拒绝保留输入草稿');
    await scrollClick('#preset-cancel');
    await reopen(); win.setContentSize(760, 580);
    const action = name => '#preset-list .preset-row[data-preset-id="' + preset.id + '"] [data-action="' + name + '"]';
    await scrollClick(action('load'));
    assert.equal(await page("document.querySelector('#body-hex').value"), '#D9E5F2', '重开后载入收藏的完整配色');
    assert.equal(await page("document.querySelector('#aurora-transparency').value"), '18');
    assert.equal(await page("document.querySelector('#startup-default').checked"), false, '载入重新判断启动外观');
    assert.equal(JSON.stringify(getSettings().customization), desktopBeforePreset, '载入只修改预览');
    assert.deepEqual(await avatarState(), chatBeforePreset, '载入只修改预览，不改聊天');
    await scrollClick(action('rename')); await setField('preset-name', renamed); await scrollClick('#preset-submit');
    await poll(() => getSettings().appearancePresets.find(row => row.id === preset.id)?.name, value => value === renamed, '收藏改名持久化');
    assert.equal(presetCount(), baselineCount + 1);
    assert.deepEqual(getSettings().appearancePresets.find(row => row.id === preset.id).appearance, preset.appearance, '改名保留完整外观');
    for (const appearance of ['light','dark']) {
      win.webContents.send('pet:color-mode', 'standard', appearance);
      await poll(() => page('document.documentElement.dataset.theme'), value => value === appearance, '收藏主题跟随');
      await scrollClick(action('rename'));
      const r = await page("({form:document.querySelector('#preset-form').getBoundingClientRect().toJSON(),controls:document.querySelector('.controls').getBoundingClientRect().toJSON(),footer:document.querySelector('.studio-footer').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth})");
      assert.ok(r.form.left >= r.controls.left - 1 && r.form.right <= r.controls.right + 1 && r.form.bottom <= r.footer.top + 1, '最小窗口收藏命名区保持可见');
      assert.equal(r.overflow, false); await capture('customize-760-presets-' + appearance);
      await scrollClick('#preset-cancel');
    }
    await pointerClick(win, '#save');
    await poll(() => getSettings().customization.appearance.bodyColor, value => value === '#D9E5F2', '收藏经保存外观后才应用');
    await scrollClick(action('delete')); await scrollClick('#preset-delete-submit');
    await poll(presetCount, value => value === baselineCount, '删除收藏持久化');
    assert.equal(getSettings().customization.appearance.bodyColor, '#D9E5F2', '删除收藏保留当前已应用快照');
    assert.equal(JSON.stringify(getSettings().startupAppearance), startupBeforePreset, '删除收藏保留启动快照');
    assert.equal(readSettings().appearancePresets.some(row => row.id === preset.id), false);
    checks.push('named presets persist/reopen/load-only-preview/rename/delete/current-snapshot + duplicate/failure + minimum light/dark');
    const thumbnailFixtures = [
      { shape:'blob', bodyColor:'#2A8B6F', eyeColor:'#F4E8C8', auroraTransparency:30, eyeScale:.8, eyeSpacing:1.2, eyeHeight:6,
        shapeTuning:{width:1.12,height:.96,softness:.72,asymmetry:.1} },
      { shape:'square', bodyColor:'#D9E5F2', eyeColor:'#1A3444', auroraTransparency:42 },
      { shape:'aurora-cloud', auroraContour:'six-lobe', bodyColor:'#5B3BC7', eyeColor:'#FFFFFF', auroraTransparency:18 },
      { shape:'cloud', bodyColor:'#5B3BC7', eyeColor:'#FFFFFF', auroraTransparency:24 },
      { shape:'blob', bodyColor:'#8B72D8', eyeColor:'#FFFFFF', auroraTransparency:18 }
    ].map((appearance,index) => ({id:crypto.randomUUID(),name:'缩略图验收'+index,appearance}));
    restore({ ...beforePresets, appearancePresets:thumbnailFixtures }); await reopen(); win.setContentSize(760,580);
    const verifyThumbnail = async (row, appearance) => {
      const selector = '#preset-list .preset-row[data-preset-id="' + row.id + '"] .preset-thumbnail';
      await scrollClick('#preset-list .preset-row[data-preset-id="' + row.id + '"] [data-action="load"]');
      await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const state = await poll(() => page(`(() => {
        const host=document.querySelector(${JSON.stringify(selector)}),svg=host.querySelector(':scope > svg'),canvas=host.querySelector('.eb-rive-aurora.ready');
        return { ...host.dataset,rect:host.getBoundingClientRect().toJSON(),svgVisible:svg&&getComputedStyle(svg).visibility!=='hidden',
          opacity:canvas?canvas.style.opacity:svg?.style.opacity,contour:canvas?.dataset.auroraContour,outlineReady:canvas?.dataset.auroraOutlineReady,
          bodyStops:[...host.querySelectorAll('defs > radialGradient:first-child > stop')].map(node=>node.getAttribute('stop-color')),
          eyeFills:[...host.querySelectorAll('.eb-eye')].map(node=>node.getAttribute('fill')?.toUpperCase()) };
      })()`), value => value.avatarReady==='true', '收藏缩略图真实渲染就绪 '+row.name);
      assert.deepEqual(JSON.parse(state.avatarAppearance),row.appearance,'缩略图使用已保存的完整外观');
      assert.equal(state.avatarActive,'false','收藏缩略图停止持续动效');
      assert.equal(state.avatarEngine,row.appearance.shape==='aurora-cloud'?'rive':'emotion-ball');
      assert.ok(Math.abs(Number(state.opacity)-(1-row.appearance.auroraTransparency/100))<.001,'缩略图真实透明度');
      if(row.appearance.shape==='aurora-cloud') {
        assert.equal(state.svgVisible,false,'幻彩缩略图必须为真实Rive，不能显示备用形态');
        assert.equal(state.contour,row.appearance.auroraContour,'缩略图真实幻彩轮廓');
        if(state.contour==='six-lobe')assert.equal(state.outlineReady,'true','六瓣素材确实已载入');
      } else {
        const previewStops=await page("[...document.querySelectorAll('#preview-ball defs > radialGradient:first-child > stop')].map(node=>node.getAttribute('stop-color'))");
        assert.deepEqual(state.bodyStops,previewStops,'收藏与真实预览的完整球体配色一致');
        assert.ok(state.eyeFills.length>0&&state.eyeFills.every(fill=>fill===row.appearance.eyeColor),'收藏眼睛使用保存的配色');
      }
      await wait(120);
      const image=require('electron').nativeImage.createFromBuffer(await capturePaintedWindow({win}));
      const viewport=await page('({width:innerWidth,height:innerHeight})'),size=image.getSize(),r=state.rect;
      const x=Math.floor(r.left*size.width/viewport.width),y=Math.floor(r.top*size.height/viewport.height);
      const crop=image.crop({x,y,width:Math.ceil(r.right*size.width/viewport.width)-x,height:Math.ceil(r.bottom*size.height/viewport.height)-y});
      const pixels=crop.toBitmap(),corner=Array.from(pixels.subarray(0,3));
      let varied=0;for(let at=0;at<pixels.length;at+=4)if(pixels[at+3]>128&&corner.some((channel,index)=>Math.abs(pixels[at+index]-channel)>35))varied++;
      assert.ok(!crop.isEmpty()&&varied>20,'原生合成缩略图有实际球体和眼睛，不能只留元数据或空背景');
      const file=path.join(output,'preset-thumbnail-'+appearance+'-'+row.name+'-'+row.appearance.shape+'-'+row.appearance.auroraContour+'.png');
      fs.writeFileSync(file,crop.toPNG());screenshots.push(file);
      return state;
    };
    const normalizedThumbnailFixtures=getSettings().appearancePresets;
    for(const appearance of ['light','dark']) {
      win.webContents.send('pet:color-mode','standard',appearance);
      await poll(()=>page('document.documentElement.dataset.theme'),value=>value===appearance,'收藏列表浅深主题');
      await page("document.querySelector('.controls').scrollTop=0;document.querySelector('#preset-list').scrollTop=0");
      await page("document.querySelector('#preset-section').scrollIntoView({block:'start'})");
      await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const library=await page(`(() => {
        const list=document.querySelector('#preset-list'),r=list.getBoundingClientRect();
        return {rect:r.toJSON(),client:list.clientHeight,total:list.scrollHeight,overflow:getComputedStyle(list).overflowY,
          fullyVisible:[...list.children].filter(row=>{const s=row.getBoundingClientRect();return s.top>=r.top-1&&s.bottom<=r.bottom+1;}).length,
          add:document.querySelector('#preset-add').getBoundingClientRect().toJSON(),addColor:getComputedStyle(document.querySelector('#preset-add')).color,titleColor:getComputedStyle(document.querySelector('#preset-title')).color};
      })()`);
      assert.equal(library.overflow,'auto');assert.ok(library.total>library.client,'第5项仅在列表内部滚动');
      assert.ok(library.rect.height<=231&&library.fullyVisible<=4,'收藏库最多四项高度');
      assert.ok(library.add.height>=30&&library.addColor!==library.titleColor,'收藏保存以轻量teal文字明确强调');
      for(const row of normalizedThumbnailFixtures)await verifyThumbnail(row,appearance);
      assert.ok(await page("document.querySelector('#preset-list').scrollTop>0"),'第五项真实滚入列表');
      const outerScroll=await page("document.querySelector('.controls').scrollTop");
      await page("document.querySelector('#preset-list').scrollTop=0");
      await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await page("document.querySelector('.controls').scrollTop"),outerScroll,'内部滚动不改变整个右侧的位置');
      const offscreen='#preset-list .preset-row[data-preset-id="'+normalizedThumbnailFixtures[4].id+'"] .preset-thumbnail';
      await poll(()=>page(`document.querySelector(${JSON.stringify(offscreen)}).childElementCount`),value=>value===0,'离屏第五项释放真实渲染资源');
      const firstAction='#preset-list .preset-row[data-preset-id="'+normalizedThumbnailFixtures[0].id+'"] [data-action="delete"]';
      await scrollClick(firstAction);
      const warning=await page(`(() => {const box=document.querySelector('#preset-delete-confirm'),button=document.querySelector('#preset-delete-submit');return {
        parent:box.parentElement.dataset.presetId,rect:box.getBoundingClientRect().toJSON(),label:document.querySelector('#preset-delete-label').textContent,
        button:button.getBoundingClientRect().toJSON(),background:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color,cancelColor:getComputedStyle(document.querySelector('#preset-delete-cancel')).color,
        footer:document.querySelector('.studio-footer').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(warning.parent,normalizedThumbnailFixtures[0].id,'删除确认关联当前行');
      assert.ok(warning.label.includes(normalizedThumbnailFixtures[0].name));assert.ok(warning.button.height>=28);
      assert.notEqual(warning.color,warning.cancelColor,'轻危险色删除动作与取消明确区分');
      assert.ok(warning.rect.bottom<=warning.footer.top+1&&!warning.overflow,'最小窗口删除确认可见且不溢出');
      await capture('customize-760-presets-delete-'+appearance);await scrollClick('#preset-delete-cancel');
      assert.equal(getSettings().appearancePresets.length,5,'取消删除不修改收藏');
    }
    checks.push('saved appearance thumbnails via real engines/static active=false/fifth row/resource release + four-row scroll + visible delete confirmation light/dark');
    chatWindow.hide(); restore(beforePresets); await reopen();
    if (setSize) {
      setSize('large'); await reopen(); win.setContentSize(760, 580);
      await pointerClick(win, '#preview-desktop');
      await poll(() => page("document.querySelector('#preview-ball').getBoundingClientRect().width"), value => value === 260, '实际桌面 260px');
      await snapshot('desktop-260', { desktopPixels: 260 }); await capture('customize-760-desktop-260');
      checks.push('desktop 260px remains full size at native minimum');
    } else assert.fail('setSize hook is required for actual 260px desktop preview');
    await pointerClick(win, '#reset-appearance');
    await poll(() => page("document.querySelector('#body-hex').value"), value => value === '#EEEBE4', '恢复当前形态默认外观');
    assert.equal(await page("document.querySelector('#shape-width').value"), '100');
    const report = { ok: true, packaged: require('electron').app.isPackaged, isolatedUserData: true,
      actualModelCalls: 0, surfaces, avatars, avatarTransitions, pickerChecks, checks, screenshots };
    const reportPath = path.join(output, 'unified-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PET_CUSTOMIZE_UNIFIED_OK ${JSON.stringify({ surfaces: surfaces.length, avatars: avatars.length, report: reportPath })}\n`);
  } finally {
    setSaveFailure?.(false); chatWindow.hide(); if (win && !win.isDestroyed()) win.close(); restore(original);
  }
}

module.exports = { readCustomizeSurface, assertCustomizeSurface, verifyAvatarMotion, assertAvatarSaveTransition, verifyCustomizeUnified };
