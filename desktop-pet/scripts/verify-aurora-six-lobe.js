const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyAuroraSixLobe({ editor, pet, chatWindow, getSettings, readSettings, restore,
  screen, monitor, setSize, dock, restoreEdge, getPresentation }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1', '六瓣检查仅能在隔离烟测中运行');
  assert.equal(process.env.PET_SMOKE_CUSTOMIZE_ONLY, '1');
  const before = JSON.parse(JSON.stringify(getSettings()));
  const beforeBounds = pet.getBounds(), beforePresentation = getPresentation();
  const originalCursor = screen.getCursorScreenPoint;
  let cursor = originalCursor();
  const bounded = async (promise, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`六瓣验收等待超时：${label}; loading=${editor.webContents.isLoading()}; visible=${editor.isVisible()}; crashed=${editor.webContents.isCrashed()}`)), 20000);
    })]); } finally { clearTimeout(timer); }
  };
  const page = code => bounded(editor.webContents.executeJavaScript(code), code.slice(0, 100));
  const reloadEditor = () => bounded(editor.loadFile(path.join(__dirname, '../customize.html')), 'reload editor');
  const poll = async (read, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await bounded(Promise.resolve().then(read), label)) return;
      await wait(50);
    }
    assert.fail(label);
  };
  const ready = (target, contour, fields = {}) => `(() => {
    const target = document.querySelector(${JSON.stringify(target)});
    const canvas = target?.querySelector(':scope > .eb-rive-aurora.ready');
    if (!canvas || canvas.dataset.auroraContour !== ${JSON.stringify(contour)}) return false;
    if (${JSON.stringify(contour)} === 'six-lobe' && canvas.dataset.auroraOutlineReady !== 'true') return false;
    const appearance = JSON.parse(target.dataset.avatarAppearance || 'null');
    return appearance?.auroraContour === ${JSON.stringify(contour)} &&
      Object.entries(${JSON.stringify(fields)}).every(([key, value]) => appearance[key] === value);
  })()`;
  const preview = (contour = 'six-lobe', fields) => poll(
    () => page(ready('#preview-ball', contour, fields)), '六瓣预览未完成素材加载或外观未同步');
  const select = async contour => {
    await page(`document.querySelector('[data-shape="aurora-cloud"][data-aurora-contour="${contour}"]').click(); true`);
    await preview(contour);
    assert.equal(await page(`(() => {
      const cards = [...document.querySelectorAll('#shape-options [data-shape="aurora-cloud"]')];
      return cards.length === 1 && cards.every(card =>
        card.getAttribute('aria-pressed') === String(card.dataset.auroraContour === '${contour}'));
    })()`), true, '幻彩形态卡必须正确选中');
  };
  try {
    await poll(() => page(`window.__customizerReady === true &&
      document.querySelectorAll('#shape-options .shape-option').length === 4`), '四种形态未就绪');
    const legacy = await page(`PetCustomization.applyShapeRecommendation(PetCustomization.normalizeAppearance(), 'aurora-cloud')`);
    legacy.auroraContour = 'original';
    chatWindow.show({ messages: [] });
    await poll(() => chatWindow.getWindow()?.webContents.executeJavaScript(
      `Boolean(window.qiuqiuChat && document.getElementById('chat-avatar'))`
    ).catch(() => false), '聊天窗口未就绪');
    await chatWindow.getWindow().webContents.executeJavaScript(`window.__qaAppearanceOff = window.qiuqiuChat.onAppearance(a => { window.__qaAppearance = a; }); true`);
    await page(`window.petCustomizer.preview(${JSON.stringify(legacy)}); true`);
    await poll(() => chatWindow.getWindow().webContents.executeJavaScript(
      `window.__qaAppearance?.auroraContour === 'six-lobe'`
    ), '旧配置预览 IPC 必须向聊天头像传递六瓣外观');
    await chatWindow.getWindow().webContents.executeJavaScript('window.__qaAppearanceOff(); true');
    assert.equal(await page(`window.petCustomizer.save({appearance:${JSON.stringify(legacy)}}, false)`), true);
    assert.equal(readSettings().customization.appearance.auroraContour, 'six-lobe', '旧配置保存必须归一为六瓣');
    process.stdout.write('PET_SIX_LOBE_IPC_SAVE_OK\n');
    await poll(() => pet.webContents.executeJavaScript(ready('#pet', 'six-lobe')), '桌面必须显示六瓣外观');
    // Reload verifies saved appearance and the four shape cards.
    await reloadEditor();
    process.stdout.write('PET_SIX_LOBE_EDITOR_RELOADED_OK\n');
    await preview('six-lobe');
    if (process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT) {
      const file = path.resolve(process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file.replace(/\.png$/, '-public.png'), (await bounded(editor.webContents.capturePage(), 'public screenshot')).toPNG());
    }
    assert.equal(restore(before), true);
    await reloadEditor();
    await poll(() => page('window.__customizerReady === true'), '定制页未就绪');
    await select('six-lobe');
    process.stdout.write('PET_WEBSITE_FOUR_SHAPES_OK\n');
    assert.equal(await page(`(() => {
      const icon = document.querySelector('[data-aurora-contour="six-lobe"] img');
      return icon.complete && icon.naturalWidth > 0 &&
        document.getElementById('manual-toggle').disabled &&
        document.getElementById('manual-controls').hidden &&
        !document.getElementById('aurora-style-field').hidden &&
        !document.getElementById('aurora-transparency-field').hidden;
    })()`), true, '六瓣图标、原动效所需控件和透明度必须可用');
    process.stdout.write('PET_SIX_LOBE_SELECTION_OK\n');

    for (const style of ['simple', 'dimensional']) {
      await page(`document.getElementById('aurora-style-${style}').click(); true`);
      await preview('six-lobe', { auroraStyle: style });
      assert.equal(await page("document.getElementById('aurora-colors').hidden"), style === 'simple');
    }
    await page(`(() => {
      for (const [id, value] of [['body-hex', '#8B72D8'], ['eye-hex', '#F4E8C8'],
        ['glow-pink-hex', '#EE83D8'], ['glow-gold-hex', '#EDC77C'], ['aurora-transparency', '42']]) {
        const control = document.getElementById(id); control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`);
    await preview('six-lobe', { bodyColor: '#8B72D8', eyeColor: '#F4E8C8',
      glowPinkColor: '#EE83D8', glowGoldColor: '#EDC77C', auroraTransparency: 42 });
    assert.equal(await page("document.querySelector('#preview-ball > .eb-rive-aurora.ready').style.opacity"), '0.58');
    await page("document.getElementById('reset-appearance').click(); true");
    await preview('six-lobe', { auroraStyle: 'dimensional', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF',
      glowPinkColor: '#D05ED6', glowGoldColor: '#D0AD8A', auroraTransparency: 0 });
    assert.equal(await page("document.querySelector('#shape-options [data-aurora-contour=\"six-lobe\"]').getAttribute('aria-pressed')"), 'true');
    process.stdout.write('PET_SIX_LOBE_CONTROLS_OK\n');

    {
      await page(`(() => {
        const prototype = window.rive.Rive.prototype;
        window.__qaRiveInputs = prototype.stateMachineInputs;
        prototype.stateMachineInputs = function (...args) {
          window.__qaRive = this;
          return window.__qaRiveInputs.apply(this, args);
        };
        document.querySelector('[data-shape="blob"]').click();
        return true;
      })()`);
      await poll(() => page("!document.querySelector('#preview-ball > .eb-rive-aurora')"), '经典预览未完成切换');
      await select('six-lobe');
      await poll(() => page('Boolean(window.__qaRive)'), '未捕获幻彩状态机');
      await page('window.rive.Rive.prototype.stateMachineInputs = window.__qaRiveInputs; true');
      for (const [event, expected] of [['pointerenter', true], ['pointerleave', false]]) {
        assert.equal(await page(`(() => {
          document.getElementById('preview-ball').dispatchEvent(new PointerEvent('${event}'));
          return window.__qaRive.stateMachineInputs('Main_SM').find(input => input.name === 'isHover').value;
        })()`), expected);
      }
      for (let index = 0; index < 3; index++) {
        assert.equal(await page(`(() => {
          document.getElementById('preview-ball').click();
          return window.__qaRive.stateMachineInputs('Main_SM').find(input => input.name === 'clickIndex').value;
        })()`), index);
        await wait(350);
        const frame = await editor.webContents.capturePage();
        assert.equal(frame.isEmpty(), false);
        if (process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT) {
          fs.writeFileSync(process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT.replace(/\.png$/, `-click-${index}.png`), frame.toPNG());
        }
        await wait(2000);
      }
      process.stdout.write('PET_WEBSITE_HOVER_THREE_CLICKS_OK\n');
    }

    await page("document.getElementById('startup-default').checked = false; document.getElementById('save').click(); true");
    await poll(() => getSettings().customization.appearance.auroraContour === 'six-lobe', '六瓣外观未保存到主进程');
    await poll(() => page("!document.getElementById('save').disabled"), '六瓣保存操作未完成');
    assert.deepEqual(getSettings().startupAppearance, before.startupAppearance, '未勾选启动默认不得覆盖已有外观');
    const saved = readSettings();
    assert.equal(saved.customization.appearance.auroraContour, 'six-lobe', '六瓣外观必须真实写入设置文件');
    assert.deepEqual(saved.startupAppearance, before.startupAppearance, '磁盘启动外观必须保持不变');
    await poll(() => pet.webContents.executeJavaScript(ready('#pet', 'six-lobe')), '桌面六瓣外观和 Rive 素材未同步');
    process.stdout.write('PET_SIX_LOBE_PERSISTENCE_OK\n');

    // Direct presentation checks the avatar without connecting or sending a chat message.
    chatWindow.show({ messages: [] });
    await poll(async () => chatWindow.getWindow()?.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('#chat-avatar > .eb-rive-aurora.ready');
      return canvas?.dataset.auroraContour === 'six-lobe' && canvas.dataset.auroraOutlineReady === 'true';
    })()`).catch(() => false), '聊天六瓣头像未完成 Rive 素材加载');
    process.stdout.write('PET_SIX_LOBE_CHAT_AVATAR_OK\n');
    if (process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT) {
      const file = path.resolve(process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT);
      const stem = file.slice(0, file.length - path.extname(file).length);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page('window.scrollTo(0, 0); true');
      await wait(150);
      for (const [win, destination] of [[editor, file], [pet, `${stem}-desktop.png`], [chatWindow.getWindow(), `${stem}-chat.png`]]) {
        fs.writeFileSync(destination, (await win.webContents.capturePage()).toPNG());
      }
    }
    await page("document.getElementById('startup-default').checked = true; document.getElementById('save').click(); true");
    await poll(() => getSettings().startupAppearance.auroraContour === 'six-lobe', '六瓣未设为启动外观');
    await poll(() => page("!document.getElementById('save').disabled"), '启动外观保存未完成');
    assert.deepEqual(readSettings().startupAppearance, getSettings().customization.appearance, 'loadSettings 必须回读完整六瓣启动外观');
    process.stdout.write('PET_SIX_LOBE_STARTUP_ROUNDTRIP_OK\n');

    chatWindow.hide();
    monitor.stop();
    screen.getCursorScreenPoint = () => ({ ...cursor });
    const sample = point => { cursor = point; monitor.sampleNow(true); };
    const away = () => { const a = screen.getDisplayMatching(pet.getBounds()).workArea;
      sample({ x: a.x + a.width / 2, y: a.y + 20 }); };
    const edgeFrame = async (mode, side, width) => {
      const offset = (side === 'left' ? -1 : 1) * width * (mode === 'tucked' ? .68 : mode === 'peeked' ? .43 : 0);
      let actual;
      try { await poll(async () => {
        actual = await pet.webContents.executeJavaScript(`(() => {
          const pet = document.getElementById('pet'), rect = pet.getBoundingClientRect();
          const a = JSON.parse(pet.dataset.avatarAppearance || 'null');
          const eyes = [...pet.querySelectorAll('.eb-eye')].map(eye => eye.getAttribute('fill'));
          return { state: { ...pet.dataset }, rect: rect.toJSON(), appearance: a, eyes,
            canvas: { ...pet.querySelector('.eb-rive-aurora')?.dataset },
            valid: (${ready('#pet', 'six-lobe')}) && pet.dataset.shape === 'aurora-cloud' &&
            pet.dataset.presentation === '${mode}' && Math.abs(rect.x - ${offset}) < .1 && Math.abs(rect.width - ${width}) < .1 &&
            a.idleEyes === 'original' && a.eyeScale === 1 && a.eyeSpacing === 1 && a.eyeHeight === 0 &&
            eyes.filter(color => color === '#FFFFFF').length === 2 };
        })()`);
        return getPresentation().mode === mode && actual.valid;
      }, `${side} ${mode} ${width}px 六瓣真实布局或原版眼睛不符`); }
      catch (error) {
        process.stderr.write(`PET_SIX_LOBE_EDGE_DIAGNOSTIC ${JSON.stringify({ expected: { mode, side, width, offset },
          presentation: getPresentation(), bounds: pet.getBounds(), cursor, actual })}\n`);
        throw error;
      }
      if (width === 180 && mode !== 'free' && process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT) {
        const file = path.resolve(process.env.PET_SMOKE_SIX_LOBE_SCREENSHOT);
        const stem = file.slice(0, file.length - path.extname(file).length);
        fs.writeFileSync(`${stem}-edge-${side}-${mode}-${width}.png`, (await pet.webContents.capturePage()).toPNG());
      }
    };
    for (const [size, width] of [['tiny', 80], ['small', 120], ['medium', 180]]) {
      restoreEdge(); setSize(size); away();
      await poll(() => pet.getBounds().width === width, '桌面尺寸未生效');
      for (const side of ['left', 'right']) {
        dock(side); away(); await edgeFrame('tucked', side, width);
        const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
        assert.equal(bounds.x, side === 'left' ? area.x : area.x + area.width - width);
        sample({ x: side === 'left' ? bounds.x + 5 : bounds.x + width - 5, y: bounds.y + width / 2 });
        await edgeFrame('peeked', side, width);
        away(); await edgeFrame('tucked', side, width);
        restoreEdge(); await edgeFrame('free', side, width);
      }
      process.stdout.write(`PET_SIX_LOBE_EDGE_${width}_OK\n`);
    }
    process.stdout.write('PET_SIX_LOBE_SMOKE_OK\n');
  } finally {
    chatWindow.hide();
    restoreEdge(); setSize(before.size); pet.setBounds(beforeBounds, false);
    if (beforePresentation.side) {
      dock(beforePresentation.side);
      if (beforePresentation.mode === 'peeked') {
        cursor = { x: beforeBounds.x + (beforePresentation.side === 'left' ? 5 : beforeBounds.width - 5), y: beforeBounds.y + beforeBounds.height / 2 };
        monitor.sampleNow(true);
      }
    }
    screen.getCursorScreenPoint = originalCursor;
    monitor.start();
    assert.equal(restore(before), true, '六瓣专项结束后必须恢复原设置和启动外观');
    await reloadEditor();
    await poll(() => page('window.__customizerReady === true'), '恢复后定制页未就绪');
  }
}

module.exports = { verifyAuroraSixLobe };
