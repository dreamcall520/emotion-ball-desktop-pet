(function () {
  'use strict';

  const bridge = window.petCustomizer || { load: async () => null, save: async () => false };
  const $ = id => document.getElementById(id);
  const shapeNames = [
    ['blob', '经典'], ['cloud', '云朵'],
    ['aurora-cloud', '幻彩', 'six-lobe'], ['square', '方糖']
  ];
  const bodyColors = ['#EEEBE4', '#1B1C20', '#F5D9C5', '#DCE8DD', '#D9E5F2', '#8B72D8', '#5B3BC7'];
  const eyeColors = ['#1A1A1A', '#FFFFFF', '#1A3444', '#3B2B32'];
  const glowPinkColors = ['#D05ED6', '#EE83D8', '#A460EC'];
  const glowGoldColors = ['#D0AD8A', '#EDC77C', '#F2D6AF'];
  const auroraReference = PetCustomization.SHAPE_RECOMMENDED_COLORS['aurora-cloud'];
  const petPixels = Object.freeze({ micro: 60, tiny: 80, compact: 108, small: 120, medium: 180, large: 260 });
  const previewPixels = 205;
  const defaults = PetCustomization.DEFAULT_APPEARANCE;
  let state = PetCustomization.normalizeCustomization();
  let startupAppearance = PetCustomization.normalizeAppearance();
  let ball = null;
  let auroraPreview = null;
  let displayedAurora = null;
  let petSize = 'tiny';
  let previewMode = 'large';
  let frameId = 0;
  let messageTimer = null;
  let canSave = false;
  let canPreview = false;
  const matchesStartup = () => JSON.stringify(PetCustomization.normalizeAppearance(state.appearance)) ===
    JSON.stringify(startupAppearance);

  $('save').disabled = true;
  $('save-bottom').disabled = true;
  $('startup-default').disabled = true;

  function announce(value) {
    const node = $('message');
    node.textContent = value;
    node.classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => node.classList.remove('visible'), 2600);
  }

  function shapeIcon(shape, contour) {
    const target = document.createElement('span');
    target.className = 'shape-art';
    if (shape === 'aurora-cloud') {
      const icon = document.createElement('img');
      icon.src = 'assets/aurora-six-lobe-icon.png';
      icon.alt = '';
      target.appendChild(icon);
      return target;
    }
    const colors = PetCustomization.SHAPE_RECOMMENDED_COLORS[shape] || defaults;
    EmotionBall.create(target, {
      emotion: '02', shape, customShape: window.EB_CUSTOM_SHAPES.createShape({ shape }),
      color: colors.bodyColor, eyeColor: colors.eyeColor,
      eyeScale: shape === 'cloud' ? 1 : 1.5, facing: 'left',
      autostart: false, lite: true, idle: false, label: ''
    });
    target.querySelector?.('svg')?.setAttribute('aria-hidden', 'true');
    return target;
  }

  function renderShapeOptions() {
    const target = $('shape-options');
    target.replaceChildren();
    $('shape-hint').textContent = shapeNames.some(([id]) => id === state.appearance.shape)
      ? '点选一个起点，再按喜好调整'
      : '当前保留旧版形态，选择以上任一形态即可替换';
    const visibleShapes = shapeNames;
    target.style.setProperty('--shape-count', visibleShapes.length);
    for (const [id, label, contour = 'original'] of visibleShapes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shape-option';
      button.dataset.shape = id;
      button.dataset.auroraContour = contour;
      button.setAttribute('aria-pressed', String(state.appearance.shape === id && state.appearance.auroraContour === contour));
      button.setAttribute('aria-label', '选择' + label + '形态');
      button.append(shapeIcon(id, contour), document.createTextNode(label));
      button.addEventListener('click', () => {
        state.appearance = PetCustomization.applyShapeRecommendation(state.appearance, id, contour);
        $('startup-default').checked = matchesStartup();
        for (const option of target.querySelectorAll('.shape-option')) {
          option.setAttribute('aria-pressed', String(option.dataset.shape === id && option.dataset.auroraContour === contour));
        }
        $('shape-hint').textContent = '点选一个起点，再按喜好调整';
        renderColors();
        renderAuroraVisibility();
        schedulePreview();
      });
      target.appendChild(button);
    }
  }

  function renderSwatches(containerId, values, key) {
    const target = $(containerId);
    if (target.children.length !== values.length) {
      target.replaceChildren();
      for (const value of values) {
        const button = document.createElement('button');
        button.className = 'swatch';
        button.type = 'button';
        button.style.backgroundColor = value;
        button.title = value;
        button.setAttribute('aria-label', '选用颜色 ' + value);
        button.addEventListener('click', () => changeColor(key, value));
        target.appendChild(button);
      }
    }
    for (const [index, button] of [...target.children].entries()) {
      const selected = state.appearance[key] === values[index];
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function renderColors() {
    for (const [pickerId, hexId, key] of [
      ['body-color', 'body-hex', 'bodyColor'],
      ['eye-color', 'eye-hex', 'eyeColor'],
      ['glow-pink-color', 'glow-pink-hex', 'glowPinkColor'],
      ['glow-gold-color', 'glow-gold-hex', 'glowGoldColor']
    ]) {
      $(pickerId).value = state.appearance[key];
      $(hexId).value = state.appearance[key];
      $(hexId).classList.remove('invalid');
    }
    renderSwatches('body-swatches', bodyColors, 'bodyColor');
    renderSwatches('eye-swatches', eyeColors, 'eyeColor');
    renderSwatches('glow-pink-swatches', glowPinkColors, 'glowPinkColor');
    renderSwatches('glow-gold-swatches', glowGoldColors, 'glowGoldColor');
  }

  function renderAuroraVisibility() {
    const visible = state.appearance.shape === 'aurora-cloud';
    $('manual-toggle').disabled = visible;
    $('manual-hint').textContent = visible
      ? '为了保持完整的动效体验，暂不支持轮廓与五官微调'
      : '让轮廓与五官长成你喜欢的样子';
    if (visible) showManual(false);
    renderSliders();
    $('aurora-style-field').hidden = !visible;
    for (const style of ['dimensional', 'simple']) {
      $('aurora-style-' + style).setAttribute('aria-pressed', String(state.appearance.auroraStyle === style));
    }
    $('aurora-colors').hidden = !visible || state.appearance.auroraStyle === 'simple';
  }

  function parseHex(value) {
    let raw = String(value).trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(raw)) raw = raw.split('').map(digit => digit + digit).join('');
    return /^[\da-f]{6}$/i.test(raw) ? '#' + raw.toUpperCase() : null;
  }

  function changeColor(key, value) {
    const parsed = parseHex(value);
    if (!parsed) return false;
    state.appearance[key] = parsed;
    renderColors();
    schedulePreview();
    return true;
  }

  function registerIdle() {
    const source = EmotionBall.config.get('02').raw;
    const preset = PetCustomization.EYE_PRESETS[state.appearance.idleEyes];
    EmotionBall.config.register({
      ...source, id: '50', name: '定制待机', group: 'custom', antics: false,
      anims: [], pool: preset === null ? [0, 8] : [preset]
    });
  }

  function renderBall() {
    frameId = 0;
    if (canPreview) bridge.preview?.(state.appearance);
    const target = $('preview-ball');
    const heldCanvas = displayedAurora && target.querySelector?.(':scope > .eb-rive-aurora.ready');
    const heldFilter = displayedAurora && target.querySelector?.(':scope > .eb-rive-eye-filter');
    if (auroraPreview && auroraPreview !== displayedAurora) auroraPreview.destroy();
    if (ball) ball.destroy();
    target.replaceChildren();
    const pixels = previewMode === 'desktop' ? (petPixels[petSize] || petPixels.tiny) : previewPixels;
    target.style.width = pixels + 'px';
    target.style.height = pixels + 'px';
    $('stage').dataset.previewMode = previewMode;
    $('preview-size-label').textContent = previewMode === 'desktop'
      ? '桌面实际尺寸 · ' + pixels + ' × ' + pixels + ' px' : '大图预览';
    registerIdle();
    const compact = previewMode === 'desktop' && ['micro', 'tiny', 'compact', 'small'].includes(petSize);
    const eyeBoost = compact && !['cloud', 'aurora-cloud'].includes(state.appearance.shape) ? 1.5 : 1;
    const customShape = window.EB_CUSTOM_SHAPES.createShape(state.appearance);
    const referenceTexture = PetCustomization.auroraReferenceTexture(state.appearance, customShape);
    const options = {
      emotion: '50', fallbackId: '50', shape: state.appearance.shape,
      customShape,
      auroraBodyTexture: referenceTexture,
      auroraStyle: state.appearance.auroraStyle,
      color: state.appearance.bodyColor, eyeColor: state.appearance.eyeColor,
      glowPinkColor: state.appearance.glowPinkColor,
      glowGoldColor: state.appearance.glowGoldColor,
      auroraTransparency: state.appearance.auroraTransparency,
      eyeScale: state.appearance.eyeScale * eyeBoost,
      eyeSpacing: state.appearance.eyeSpacing,
      eyeHeight: state.appearance.eyeHeight,
      idle: false, lite: compact, liteRibbons: compact,
      label: previewMode === 'desktop' ? '桌面实际尺寸球球预览' : '定制球球大图预览'
    };
    ball = EmotionBall.create(target, options);
    if (state.appearance.shape !== 'aurora-cloud') {
      const svg = target.querySelector?.(':scope > svg');
      if (svg) svg.style.opacity = (1 - state.appearance.auroraTransparency / 100).toFixed(2);
    }
    if (heldCanvas) {
      target.appendChild(heldCanvas);
      if (heldFilter) target.appendChild(heldFilter);
    }
    auroraPreview = window.AuroraRive?.create(target, state.appearance, referenceTexture, true) || null;
    if (!auroraPreview) {
      displayedAurora?.destroy();
      displayedAurora = null;
      return;
    }
    const next = auroraPreview;
    const appearanceKey = JSON.stringify(PetCustomization.normalizeAppearance(state.appearance));
    const nextSvg = target.querySelector?.(':scope > svg');
    if (nextSvg) nextSvg.style.visibility = 'hidden';
    next.whenReady().then(ready => {
      if (auroraPreview !== next) return;
      if (ready) {
        if (displayedAurora && displayedAurora !== next) displayedAurora.destroy();
        displayedAurora = next;
        target.dataset.avatarAppearance = appearanceKey;
      } else {
        next.destroy();
        auroraPreview = null;
        displayedAurora?.destroy();
        displayedAurora = null;
        if (nextSvg) nextSvg.style.visibility = '';
      }
    });
  }

  function schedulePreview() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(renderBall);
  }

  function showPreviewMode(mode) {
    previewMode = mode;
    $('preview-large').setAttribute('aria-pressed', String(mode === 'large'));
    $('preview-desktop').setAttribute('aria-pressed', String(mode === 'desktop'));
    schedulePreview();
  }

  function hasManualAdjustments() {
    const a = state.appearance;
    return Object.keys(defaults.shapeTuning).some(key => a.shapeTuning[key] !== defaults.shapeTuning[key]) ||
      a.eyeScale !== defaults.eyeScale || a.eyeSpacing !== defaults.eyeSpacing ||
      a.eyeHeight !== defaults.eyeHeight;
  }

  function showManual(enabled) {
    const active = enabled && state.appearance.shape !== 'aurora-cloud';
    $('manual-toggle').checked = active;
    $('manual-controls').hidden = !active;
  }

  function renderSliders() {
    const a = state.appearance;
    const fields = [
      ['shape-width', a.shapeTuning.width * 100, Math.round(a.shapeTuning.width * 100) + '%'],
      ['shape-height', a.shapeTuning.height * 100, Math.round(a.shapeTuning.height * 100) + '%'],
      ['shape-softness', a.shapeTuning.softness * 100, Math.round(a.shapeTuning.softness * 100) + '%'],
      ['shape-asymmetry', a.shapeTuning.asymmetry * 100, Math.round(a.shapeTuning.asymmetry * 100) + '%'],
      ['eye-scale', a.eyeScale * 100, Math.round(a.eyeScale * 100) + '%'],
      ['eye-spacing', a.eyeSpacing * 100, Math.round(a.eyeSpacing * 100) + '%'],
      ['eye-height', a.eyeHeight, a.eyeHeight === 0 ? '居中' : (a.eyeHeight > 0 ? '向下 ' : '向上 ') + Math.abs(a.eyeHeight)]
    ];
    for (const [id, value, display] of fields) {
      $(id).value = String(Math.round(value));
      $(id + '-value').textContent = display;
    }
    $('aurora-transparency').value = String(a.auroraTransparency);
    $('aurora-transparency-value').textContent = `${a.auroraTransparency}%`;
  }

  function syncAppearance() {
    showManual(hasManualAdjustments());
    renderColors();
    renderAuroraVisibility();
    renderShapeOptions();
    schedulePreview();
  }

  for (const [pickerId, hexId, key] of [
    ['body-color', 'body-hex', 'bodyColor'],
    ['eye-color', 'eye-hex', 'eyeColor'],
    ['glow-pink-color', 'glow-pink-hex', 'glowPinkColor'],
    ['glow-gold-color', 'glow-gold-hex', 'glowGoldColor']
  ]) {
    $(pickerId).addEventListener('input', event => changeColor(key, event.target.value));
    $(hexId).addEventListener('input', event => {
      const value = event.target.value.trim();
      const complete = /^#?[\da-f]{6}$/i.test(value);
      event.target.classList.toggle('invalid', value.length > 0 && !parseHex(value));
      if (complete) changeColor(key, value);
    });
    $(hexId).addEventListener('change', event => {
      if (changeColor(key, event.target.value)) return;
      event.target.value = state.appearance[key];
      event.target.classList.remove('invalid');
      announce('请输入 3 位或 6 位 HEX 色值');
    });
  }

  for (const [id, update] of [
    ['shape-width', value => { state.appearance.shapeTuning.width = value / 100; }],
    ['shape-height', value => { state.appearance.shapeTuning.height = value / 100; }],
    ['shape-softness', value => { state.appearance.shapeTuning.softness = value / 100; }],
    ['shape-asymmetry', value => { state.appearance.shapeTuning.asymmetry = value / 100; }],
    ['eye-scale', value => { state.appearance.eyeScale = value / 100; }],
    ['eye-spacing', value => { state.appearance.eyeSpacing = value / 100; }],
    ['eye-height', value => { state.appearance.eyeHeight = value; }],
    ['aurora-transparency', value => { state.appearance.auroraTransparency = value; }]
  ]) {
    $(id).addEventListener('input', event => {
      update(Number(event.target.value));
      renderSliders();
      schedulePreview();
    });
  }

  $('manual-toggle').addEventListener('change', event => {
    showManual(event.target.checked);
  });
  for (const style of ['dimensional', 'simple']) {
    $('aurora-style-' + style).addEventListener('click', () => {
      state.appearance.auroraStyle = style;
      renderAuroraVisibility();
      schedulePreview();
    });
  }
  $('reset-manual').addEventListener('click', () => {
    state.appearance.shapeTuning = { ...defaults.shapeTuning };
    state.appearance.eyeScale = defaults.eyeScale;
    state.appearance.eyeSpacing = defaults.eyeSpacing;
    state.appearance.eyeHeight = defaults.eyeHeight;
    renderSliders();
    schedulePreview();
  });
  $('reset-appearance').addEventListener('click', () => {
    const { shape, auroraContour } = state.appearance;
    state.appearance = PetCustomization.applyShapeRecommendation(
      PetCustomization.normalizeAppearance({ shape, auroraContour }), shape, auroraContour);
    syncAppearance();
  });
  $('aurora-reference').addEventListener('click', () => {
    Object.assign(state.appearance, auroraReference);
    renderColors();
    schedulePreview();
    announce('已应用参考配色，还可以逐项调整');
  });
  $('stage-toggle').addEventListener('click', () => {
    $('stage').classList.toggle('dark');
    schedulePreview();
  });
  $('preview-large').addEventListener('click', () => showPreviewMode('large'));
  $('preview-desktop').addEventListener('click', () => showPreviewMode('desktop'));
  $('save-bottom').addEventListener('click', () => $('save').click());
  $('save').addEventListener('click', async () => {
    if (!canSave) return;
    const colorFields = [['body-hex', 'bodyColor'], ['eye-hex', 'eyeColor']];
    if (state.appearance.shape === 'aurora-cloud') colorFields.push(
      ['glow-pink-hex', 'glowPinkColor'], ['glow-gold-hex', 'glowGoldColor']);
    for (const [id, key] of colorFields) {
      const value = parseHex($(id).value);
      if (!value) {
        $(id).classList.add('invalid');
        $(id).focus();
        announce('请先填写有效的 HEX 色值');
        return;
      }
      state.appearance[key] = value;
    }
    const button = $('save');
    canSave = false;
    button.disabled = true;
    $('save-bottom').disabled = true;
    try {
      state = PetCustomization.normalizeCustomization(state);
      const setAsStartupDefault = $('startup-default').checked;
      const saved = await bridge.save(state, setAsStartupDefault);
      if (saved && setAsStartupDefault) startupAppearance = PetCustomization.normalizeAppearance(state.appearance);
      announce(saved ? (setAsStartupDefault
        ? '已保存，下次打开仍使用这套外观'
        : '已保存到桌面，下次打开恢复启动外观') : '保存未完成，请稍后重试');
    } catch (_) {
      announce('保存未完成，请稍后重试');
    } finally {
      canSave = true;
      button.disabled = false;
      $('save-bottom').disabled = false;
    }
  });
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frameId);
    auroraPreview?.destroy();
    if (displayedAurora !== auroraPreview) displayedAurora?.destroy();
    if (ball) ball.destroy();
  });

  bridge.load().then(value => {
    if (!value) throw new Error('customization unavailable');
    if (value?.customization) {
      state = PetCustomization.normalizeCustomization(value.customization);
      petSize = value.size || 'tiny';
      startupAppearance = PetCustomization.normalizeAppearance(value.startupAppearance || state.appearance);
      $('startup-default').checked = matchesStartup();
    } else if (value) state = PetCustomization.normalizeCustomization(value);
    syncAppearance();
    canPreview = true;
    canSave = true;
    $('save').disabled = false;
    $('save-bottom').disabled = false;
    $('startup-default').disabled = false;
    window.__customizerReady = true;
  }).catch(() => {
    syncAppearance();
    announce('读取设置失败，请重新打开定制窗口');
    window.__customizerReady = true;
  });
})();
