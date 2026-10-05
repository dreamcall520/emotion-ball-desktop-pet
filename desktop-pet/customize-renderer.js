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
  let disposed = false;
  let appearancePreference = 'system';
  let appearancePresets = [];
  let selectedPresetId = null;
  let presetBusy = false;
  let presetEdit = null;
  let pendingDelete = null;
  const presetThumbnails = new Map();
  let presetObserver = null;
  const colorPicker = $('color-picker');
  const colorBindings = [
    ['body-color', 'body-hex', 'bodyColor', '球体'],
    ['eye-color', 'eye-hex', 'eyeColor', '眼睛'],
    ['glow-pink-color', 'glow-pink-hex', 'glowPinkColor', '粉光'],
    ['glow-gold-color', 'glow-gold-hex', 'glowGoldColor', '金光']
  ];
  let pickerBinding = null;
  let pickerAnchor = null;
  let pickerHsv = { h: 0, s: 0, v: 100 };
  let pickerPointer = null;
  const rangeLimits = {
    'shape-width': [75, 125], 'shape-height': [75, 125], 'shape-softness': [0, 100],
    'shape-asymmetry': [-100, 100], 'eye-scale': [40, 125], 'eye-spacing': [70, 130],
    'eye-height': [-30, 30], 'aurora-transparency': [0, 60]
  };
  const systemAppearance = window.matchMedia?.('(prefers-color-scheme: dark)');
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const matchesStartup = () => JSON.stringify(PetCustomization.normalizeAppearance(state.appearance)) ===
    JSON.stringify(startupAppearance);

  $('save').disabled = true;
  $('startup-default').disabled = true;

  function applyTheme() {
    if (document.documentElement) document.documentElement.dataset.theme = appearancePreference === 'system'
      ? (systemAppearance?.matches ? 'dark' : 'light') : appearancePreference;
  }
  const unsubscribeColorMode = bridge.onColorMode?.((mode, appearance) => {
    if (document.documentElement) document.documentElement.dataset.colorMode = mode === 'accessible' ? 'accessible' : 'standard';
    appearancePreference = ['light', 'dark'].includes(appearance) ? appearance : 'system';
    applyTheme();
  });
  systemAppearance?.addEventListener('change', applyTheme);
  applyTheme();

  function announce(value) {
    const node = $('message');
    node.textContent = value;
    node.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { node.hidden = true; }, 2600);
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
    const palette = key + ':' + values.join(',');
    if (target.children.length !== values.length || target.dataset.palette !== palette) {
      target.replaceChildren();
      target.dataset.palette = palette;
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
      button.disabled = !canSave;
    }
  }

  function renderColors(keepPickerHsv = false) {
    for (const [pickerId, hexId, key] of colorBindings) {
      $(pickerId).value = state.appearance[key];
      $(pickerId).style.setProperty('--color', state.appearance[key]);
      $(hexId).value = state.appearance[key];
      $(hexId).classList.remove('invalid');
    }
    renderSwatches('body-swatches', bodyColors, 'bodyColor');
    renderSwatches('eye-swatches', eyeColors, 'eyeColor');
    renderSwatches('glow-pink-swatches', glowPinkColors, 'glowPinkColor');
    renderSwatches('glow-gold-swatches', glowGoldColors, 'glowGoldColor');
    syncColorPicker(keepPickerHsv);
    markPresetSelection();
  }

  function renderAuroraVisibility() {
    const visible = state.appearance.shape === 'aurora-cloud';
    $('manual-toggle').disabled = visible;
    $('manual-hint').textContent = visible
      ? '为了保持完整的动效体验，暂不支持轮廓与五官微调'
      : '让轮廓与五官长成你喜欢的样子';
    showManual(visible ? false : !$('manual-controls').hidden);
    renderSliders();
    $('aurora-style-field').hidden = !visible;
    for (const style of ['dimensional', 'simple']) {
      $('aurora-style-' + style).setAttribute('aria-pressed', String(state.appearance.auroraStyle === style));
    }
    $('aurora-colors').hidden = !visible || state.appearance.auroraStyle === 'simple';
    if (pickerBinding?.[2].startsWith('glow') && $('aurora-colors').hidden) closeColorPicker(false);
  }

  function parseHex(value) {
    let raw = String(value).trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(raw)) raw = raw.split('').map(digit => digit + digit).join('');
    return /^[\da-f]{6}$/i.test(raw) ? '#' + raw.toUpperCase() : null;
  }

  function changeColor(key, value, keepPickerHsv = false) {
    if (!canSave || disposed) return false;
    const parsed = parseHex(value);
    if (!parsed) return false;
    state.appearance[key] = parsed;
    renderColors(keepPickerHsv);
    schedulePreview();
    return true;
  }

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = delta === 0 ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = ((h * 60) % 360 + 360) % 360;
    return { h, s: max === 0 ? 0 : delta / max * 100, v: max * 100 };
  }

  function hsvToHex({ h, s, v }) {
    const hue = ((h % 360) + 360) % 360 / 60;
    const chroma = v / 100 * s / 100, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = v / 100 - chroma;
    const rgb = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue)];
    return '#' + rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function paintRange(id) {
    const input = $(id), [min, max] = rangeLimits[id];
    const fill = Math.max(0, Math.min(100, (Number(input.value) - min) / (max - min) * 100));
    input.style.setProperty('--range-fill', fill + '%');
  }

  function syncColorPicker(keepHsv = false) {
    if (!pickerBinding) return;
    const hex = state.appearance[pickerBinding[2]];
    if (!keepHsv) pickerHsv = hexToHsv(hex);
    $('color-picker-sample').style.backgroundColor = hex;
    $('color-picker-hex').value = hex;
    $('color-picker-hex').classList.remove('invalid');
    for (const [index, id] of ['color-red', 'color-green', 'color-blue'].entries()) {
      $(id).value = String(parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16));
      $(id).classList.remove('invalid');
    }
    $('color-hue').value = String(Math.round(pickerHsv.h));
    $('color-hue-value').textContent = Math.round(pickerHsv.h) + '°';
    const pure = hsvToHex({ h: pickerHsv.h, s: 100, v: 100 });
    const sv = $('color-sv');
    sv.style.setProperty('--sv-hue', pure);
    sv.style.setProperty('--sv-x', pickerHsv.s + '%');
    sv.style.setProperty('--sv-y', (100 - pickerHsv.v) + '%');
    sv.setAttribute('aria-valuenow', String(Math.round(pickerHsv.s)));
    sv.setAttribute('aria-valuetext', `饱和度 ${Math.round(pickerHsv.s)}%，明度 ${Math.round(pickerHsv.v)}%`);
    const colors = { bodyColor: bodyColors, eyeColor: eyeColors, glowPinkColor: glowPinkColors, glowGoldColor: glowGoldColors };
    renderSwatches('color-picker-presets', colors[pickerBinding[2]], pickerBinding[2]);
  }

  function positionColorPicker() {
    if (!pickerBinding || colorPicker.hidden) return;
    const anchor = $(pickerBinding[0]).getBoundingClientRect();
    pickerAnchor = { top: anchor.top, left: anchor.left };
    const rect = colorPicker.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
    const maxTop = Math.max(12, window.innerHeight - rect.height - 12);
    let top = anchor.bottom + 8;
    if (top > maxTop) top = anchor.top - rect.height - 8;
    colorPicker.style.left = Math.max(12, Math.min(maxLeft, anchor.right - rect.width)) + 'px';
    colorPicker.style.top = Math.max(12, Math.min(maxTop, top)) + 'px';
  }

  function closeColorPicker(restoreFocus = true) {
    if (!pickerBinding) return;
    releasePickerPointer();
    const trigger = $(pickerBinding[0]);
    trigger.setAttribute('aria-expanded', 'false');
    pickerBinding = null;
    pickerAnchor = null;
    colorPicker.hidden = true;
    if (restoreFocus && !trigger.disabled) trigger.focus();
  }

  function openColorPicker(binding) {
    if (!canSave || disposed || $(binding[0]).disabled) return;
    if (pickerBinding?.[0] === binding[0]) { closeColorPicker(); return; }
    closeColorPicker(false);
    pickerBinding = binding;
    $('color-picker-title').textContent = binding[3] + '颜色';
    $(binding[0]).setAttribute('aria-expanded', 'true');
    colorPicker.hidden = false;
    syncColorPicker();
    positionColorPicker();
    $('color-sv').focus({ preventScroll: true });
  }

  function setColorControlsEnabled(enabled) {
    for (const [id] of colorBindings) $(id).disabled = !enabled;
    for (const id of ['color-hue', 'color-picker-hex', 'color-red', 'color-green', 'color-blue']) $(id).disabled = !enabled;
    $('color-sv').setAttribute('aria-disabled', String(!enabled));
    $('color-sv').tabIndex = enabled ? 0 : -1;
    for (const id of ['body-swatches', 'eye-swatches', 'glow-pink-swatches', 'glow-gold-swatches', 'color-picker-presets']) {
      for (const button of $(id).children) button.disabled = !enabled;
    }
    for (const [, id] of colorBindings) $(id).disabled = !enabled;
    for (const id of Object.keys(rangeLimits)) $(id).disabled = !enabled || (id !== 'aurora-transparency' && state.appearance.shape === 'aurora-cloud');
    for (const button of $('shape-options').children) button.disabled = !enabled;
    for (const id of ['reset-appearance', 'aurora-style-dimensional', 'aurora-style-simple', 'aurora-reference', 'reset-manual']) $(id).disabled = !enabled;
    $('startup-default').disabled = !enabled;
    setPresetControlsEnabled(enabled);
    if (!enabled) closeColorPicker(false);
  }

  $('color-hue').addEventListener('input', event => {
    if (!pickerBinding || !canSave || event.target.disabled) return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    pickerHsv.h = Math.max(0, Math.min(360, value));
    changeColor(pickerBinding[2], hsvToHex(pickerHsv), true);
  });

  function releasePickerPointer() {
    const pointer = pickerPointer;
    pickerPointer = null;
    if (pointer !== null && $('color-sv').hasPointerCapture?.(pointer)) $('color-sv').releasePointerCapture(pointer);
  }
  function updatePickerPoint(event) {
    if (!pickerBinding || !canSave || disposed) return;
    const rect = $('color-sv').getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    pickerHsv.s = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    pickerHsv.v = Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100));
    changeColor(pickerBinding[2], hsvToHex(pickerHsv), true);
  }
  $('color-sv').addEventListener('pointerdown', event => {
    if (!pickerBinding || !canSave || disposed || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    $('color-sv').focus({ preventScroll: true });
    pickerPointer = event.pointerId;
    $('color-sv').setPointerCapture?.(pickerPointer);
    updatePickerPoint(event);
  });
  $('color-sv').addEventListener('pointermove', event => {
    if (pickerPointer !== null && event.pointerId === pickerPointer) updatePickerPoint(event);
  });
  $('color-sv').addEventListener('pointerup', event => {
    if (pickerPointer !== null && event.pointerId === pickerPointer) { updatePickerPoint(event); releasePickerPointer(); }
  });
  for (const eventName of ['pointercancel', 'lostpointercapture']) $('color-sv').addEventListener(eventName, event => {
    if (event.pointerId === pickerPointer) releasePickerPointer();
  });
  $('color-sv').addEventListener('keydown', event => {
    if (!pickerBinding || !canSave || disposed) return;
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    pickerHsv.s = Math.max(0, Math.min(100, pickerHsv.s + delta[0]));
    pickerHsv.v = Math.max(0, Math.min(100, pickerHsv.v + delta[1]));
    changeColor(pickerBinding[2], hsvToHex(pickerHsv), true);
  });
  function applyPickerHex(complete) {
    const input = $('color-picker-hex');
    if (!pickerBinding || !canSave || input.disabled) return;
    const parsed = parseHex(input.value);
    if (parsed && (complete || /^#?[0-9a-f]{6}$/i.test(input.value.trim()))) changeColor(pickerBinding[2], parsed);
    else {
      input.classList.toggle('invalid', !parsed);
      if (complete) syncColorPicker();
    }
  }
  $('color-picker-hex').addEventListener('input', () => applyPickerHex(false));
  $('color-picker-hex').addEventListener('change', () => applyPickerHex(true));
  function applyPickerRgb(complete) {
    if (!pickerBinding || !canSave || $('color-red').disabled) return;
    const inputs = ['color-red', 'color-green', 'color-blue'].map($);
    const values = inputs.map(input => /^\d{1,3}$/.test(input.value) && Number(input.value) <= 255 ? Number(input.value) : null);
    inputs.forEach((input, index) => input.classList.toggle('invalid', values[index] === null));
    if (values.every(value => value !== null)) changeColor(pickerBinding[2], '#' + values.map(value => value.toString(16).padStart(2, '0')).join(''));
    else if (complete) syncColorPicker();
  }
  for (const id of ['color-red', 'color-green', 'color-blue']) {
    $(id).addEventListener('input', () => applyPickerRgb(false));
    $(id).addEventListener('change', () => applyPickerRgb(true));
  }
  $('color-picker-close').addEventListener('click', () => closeColorPicker());
  document.addEventListener?.('keydown', event => {
    if (pickerBinding && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeColorPicker();
    }
  });
  document.addEventListener?.('pointerdown', event => {
    if (pickerBinding && !colorPicker.contains(event.target) && !$(pickerBinding[0]).contains(event.target)) closeColorPicker(false);
  });
  document.addEventListener?.('focusin', event => {
    if (pickerBinding && !colorPicker.contains(event.target) && !$(pickerBinding[0]).contains(event.target)) closeColorPicker(false);
  });
  document.querySelector?.('.controls')?.addEventListener('scroll', () => {
    if (!pickerBinding || !pickerAnchor) return;
    const anchor = $(pickerBinding[0]).getBoundingClientRect();
    // A scroll event queued before opening must not dismiss a newly focused picker.
    if (Math.abs(anchor.top - pickerAnchor.top) > .5 || Math.abs(anchor.left - pickerAnchor.left) > .5) closeColorPicker(false);
  });
  window.addEventListener('resize', positionColorPicker);
  setColorControlsEnabled(false);

  function syncPresetThumbnail(record) {
    if (disposed || document.hidden || !record.visible) {
      record.controller?.destroy(); record.controller = null;
      return;
    }
    if (record.controller) return;
    record.controller = window.PetChatAvatar.create(record.target);
    record.controller.setActive(false);
    record.controller.update(record.appearance);
    record.target.dataset.avatarAppearance = JSON.stringify(record.appearance);
  }

  function clearPresetThumbnails() {
    presetObserver?.disconnect(); presetObserver = null;
    for (const record of presetThumbnails.values()) record.controller?.destroy();
    presetThumbnails.clear();
  }

  function markPresetSelection() {
    for (const row of $('preset-list').children) {
      const preset = appearancePresets.find(item => item.id === row.dataset.presetId);
      row.setAttribute('aria-current', String(preset?.id === selectedPresetId &&
        PetCustomization.appearanceContentKey(preset.appearance) === PetCustomization.appearanceContentKey(state.appearance)));
    }
  }

  function setPresetControlsEnabled(enabled) {
    enabled = enabled && !presetBusy && !disposed;
    $('preset-add').disabled = !enabled || appearancePresets.length >= 20;
    for (const id of ['preset-name', 'preset-submit', 'preset-cancel', 'preset-delete-submit', 'preset-delete-cancel']) $(id).disabled = !enabled;
    for (const row of $('preset-list').children) for (const button of row.children) button.disabled = !enabled;
  }

  function closePresetForm() {
    presetEdit = null; pendingDelete = null;
    $('preset-form').hidden = true; $('preset-delete-confirm').hidden = true;
    $('preset-error').hidden = true;
    for (const row of $('preset-list').children) delete row.dataset.confirming;
    $('preset-section').appendChild($('preset-delete-confirm'));
  }

  function openPresetForm(preset = null) {
    if (!canSave || presetBusy || disposed) return;
    closeColorPicker(false); closePresetForm();
    presetEdit = preset ? { action: 'rename', id: preset.id } : { action: 'add' };
    $('preset-form-label').textContent = preset ? '修改形象名称' : '给当前形象起个名字';
    $('preset-submit').textContent = preset ? '保存名称' : '保存形象';
    $('preset-name').value = preset?.name || '';
    $('preset-form').hidden = false;
    $('preset-name').focus();
  }

  function renderPresets() {
    clearPresetThumbnails();
    $('preset-list').replaceChildren();
    presetObserver = appearancePresets.length ? new window.IntersectionObserver(entries => {
      for (const entry of entries) {
        const record = presetThumbnails.get(entry.target);
        if (!record) continue;
        record.visible = entry.isIntersecting;
        syncPresetThumbnail(record);
      }
    }, { root: $('preset-list'), threshold: 0 }) : null;
    $('preset-count').textContent = appearancePresets.length + ' / 20';
    $('preset-empty').hidden = appearancePresets.length > 0;
    for (const preset of appearancePresets) {
      const row = document.createElement('div');
      row.className = 'preset-row'; row.dataset.presetId = preset.id; row.setAttribute('role', 'listitem');
      const load = document.createElement('button');
      load.className = 'preset-load'; load.type = 'button'; load.dataset.action = 'load';
      load.title = '载入“' + preset.name + '”到预览'; load.setAttribute('aria-label', load.title);
      const thumbnail = document.createElement('span'); thumbnail.className = 'preset-thumbnail'; thumbnail.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'preset-label'; name.textContent = preset.name;
      load.append(thumbnail, name);
      presetThumbnails.set(row, { target: thumbnail, appearance: preset.appearance, visible: false, controller: null });
      load.addEventListener('click', () => {
        if (!canSave || presetBusy || disposed) return;
        closeColorPicker(false); closePresetForm();
        state.appearance = PetCustomization.normalizeAppearance(preset.appearance);
        selectedPresetId = preset.id;
        $('startup-default').checked = matchesStartup();
        syncAppearance(); markPresetSelection();
        announce('已载入预览，保存外观后应用到桌面');
      });
      row.appendChild(load);
      for (const [action, label] of [['rename', '改名'], ['delete', '删除']]) {
        const button = document.createElement('button'); button.className = 'text-button'; button.type = 'button';
        button.dataset.action = action; button.textContent = label; button.setAttribute('aria-label', label + '“' + preset.name + '”');
        button.addEventListener('click', () => {
          if (!canSave || presetBusy || disposed) return;
          if (action === 'rename') openPresetForm(preset);
          else {
            closeColorPicker(false); closePresetForm(); pendingDelete = preset.id;
            $('preset-delete-label').textContent = '删除“' + preset.name + '”？';
            row.dataset.confirming = 'true';
            row.appendChild($('preset-delete-confirm'));
            $('preset-delete-confirm').hidden = false;
            $('preset-delete-submit').focus();
          }
        });
        row.appendChild(button);
      }
      $('preset-list').appendChild(row);
      presetObserver.observe(row);
    }
    markPresetSelection(); setPresetControlsEnabled(canSave);
  }

  function validateDraftColors() {
    const colorFields = [['body-hex', 'bodyColor'], ['eye-hex', 'eyeColor']];
    if (state.appearance.shape === 'aurora-cloud' && state.appearance.auroraStyle === 'dimensional') colorFields.push(
      ['glow-pink-hex', 'glowPinkColor'], ['glow-gold-hex', 'glowGoldColor']);
    for (const [id, key] of colorFields) {
      const value = parseHex($(id).value);
      if (!value) { $(id).classList.add('invalid'); $(id).focus(); announce('请先填写有效的 HEX 色值'); return false; }
      state.appearance[key] = value;
    }
    return true;
  }

  async function runPresetOperation(action, id, name) {
    if (!canSave || presetBusy || disposed) return;
    if (action === 'add') {
      if (!validateDraftColors()) return;
      const appearanceKey = PetCustomization.appearanceContentKey(state.appearance);
      const existing = appearancePresets.find(preset => PetCustomization.appearanceContentKey(preset.appearance) === appearanceKey);
      if (existing) {
        $('preset-error').textContent = '已收藏为「' + existing.name + '」，无需重复保存';
        $('preset-error').hidden = false;
        return;
      }
    }
    presetBusy = true; canSave = false; $('save').disabled = true;
    setColorControlsEnabled(false);
    try {
      const result = action === 'add' ? await bridge.addPreset?.(name, PetCustomization.normalizeAppearance(state.appearance))
        : action === 'rename' ? await bridge.renamePreset?.(id, name) : await bridge.deletePreset?.(id);
      if (disposed) return;
      if (!result?.ok || !Array.isArray(result.presets)) {
        const message = result?.error || '操作未完成，请稍后重试';
        if (action === 'delete') announce(message);
        else { $('preset-error').textContent = message; $('preset-error').hidden = false; }
        return;
      }
      appearancePresets = result.presets.map(item => ({ id: item.id, name: item.name, appearance: PetCustomization.normalizeAppearance(item.appearance) }));
      if (action === 'add') selectedPresetId = appearancePresets.find(item => item.name === name.trim())?.id || null;
      if (action === 'delete' && selectedPresetId === id) selectedPresetId = null;
      closePresetForm(); renderPresets();
      announce(action === 'add' ? '已保存到我的形象' : action === 'rename' ? '名称已更新' : '已删除收藏，当前外观保留');
    } catch (_) {
      if (!disposed) {
        if (action === 'delete') announce('操作未完成，请稍后重试');
        else { $('preset-error').textContent = '操作未完成，请稍后重试'; $('preset-error').hidden = false; }
      }
    } finally {
      presetBusy = false;
      if (!disposed) { canSave = true; $('save').disabled = false; setColorControlsEnabled(true); }
    }
  }
  $('preset-add').addEventListener('click', () => openPresetForm());
  $('preset-form').addEventListener('submit', event => {
    event.preventDefault();
    if (presetEdit) return runPresetOperation(presetEdit.action, presetEdit.id, $('preset-name').value);
  });
  $('preset-cancel').addEventListener('click', () => { if (!presetBusy) closePresetForm(); });
  $('preset-delete-submit').addEventListener('click', () => { if (pendingDelete) return runPresetOperation('delete', pendingDelete); });
  $('preset-delete-cancel').addEventListener('click', () => { if (!presetBusy) closePresetForm(); });
  closePresetForm();

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
    if (disposed || document.hidden) return;
    if (canPreview) bridge.preview?.(state.appearance);
    const target = $('preview-ball');
    const appearanceKey = JSON.stringify(PetCustomization.normalizeAppearance(state.appearance));
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
    $('preview-status').textContent = motionPreference?.matches ? '减少动态已开启' : '眨眼与呼吸动效保留';
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
      autostart: !motionPreference?.matches,
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
      target.dataset.renderedAppearance = appearanceKey;
      return;
    }
    const next = auroraPreview;
    const nextSvg = target.querySelector?.(':scope > svg');
    if (nextSvg) nextSvg.style.visibility = 'hidden';
    next.whenReady().then(ready => {
      if (auroraPreview !== next) return;
      if (ready) {
        if (displayedAurora && displayedAurora !== next) displayedAurora.destroy();
        displayedAurora = next;
        target.dataset.avatarAppearance = appearanceKey;
        target.dataset.renderedAppearance = appearanceKey;
      } else {
        next.destroy();
        auroraPreview = null;
        displayedAurora?.destroy();
        displayedAurora = null;
        if (nextSvg) nextSvg.style.visibility = '';
        target.dataset.renderedAppearance = appearanceKey;
      }
    });
  }

  function schedulePreview() {
    delete $('preview-ball').dataset.renderedAppearance;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    if (disposed || document.hidden) return;
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
    $('manual-toggle').setAttribute('aria-expanded', String(active));
    $('manual-toggle-label').textContent = state.appearance.shape === 'aurora-cloud' ? '暂不可用' : (active ? '收起' : '展开');
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
      paintRange(id);
    }
    $('aurora-transparency').value = String(a.auroraTransparency);
    $('aurora-transparency-value').textContent = `${a.auroraTransparency}%`;
    paintRange('aurora-transparency');
    markPresetSelection();
  }

  function syncAppearance() {
    showManual(hasManualAdjustments());
    renderColors();
    renderAuroraVisibility();
    renderShapeOptions();
    schedulePreview();
  }

  for (const binding of colorBindings) {
    const [pickerId, hexId, key] = binding;
    $(pickerId).addEventListener('click', () => openColorPicker(binding));
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

  $('manual-toggle').addEventListener('click', () => {
    showManual($('manual-controls').hidden);
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
  $('save').addEventListener('click', async () => {
    if (!canSave) return;
    if (!validateDraftColors()) return;
    const button = $('save');
    canSave = false;
    button.disabled = true;
    setColorControlsEnabled(false);
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
      setColorControlsEnabled(true);
    }
  });
  function stopPreview() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    auroraPreview?.destroy();
    if (displayedAurora !== auroraPreview) displayedAurora?.destroy();
    auroraPreview = null;
    displayedAurora = null;
    ball?.destroy();
    ball = null;
    $('preview-ball').replaceChildren();
  }
  function refreshMotion() {
    stopPreview();
    schedulePreview();
  }
  function updateVisibility() {
    if (document.hidden) stopPreview();
    else schedulePreview();
    for (const record of presetThumbnails.values()) syncPresetThumbnail(record);
  }
  motionPreference?.addEventListener('change', refreshMotion);
  document.addEventListener?.('visibilitychange', updateVisibility);
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearPresetThumbnails();
    closeColorPicker(false);
    stopPreview();
    clearTimeout(messageTimer);
    unsubscribeColorMode?.();
    systemAppearance?.removeEventListener('change', applyTheme);
    motionPreference?.removeEventListener('change', refreshMotion);
    document.removeEventListener?.('visibilitychange', updateVisibility);
  });

  bridge.load().then(value => {
    if (disposed) return;
    if (!value) throw new Error('customization unavailable');
    appearancePresets = Array.isArray(value.appearancePresets) ? value.appearancePresets.map(item => ({ id: item.id, name: item.name, appearance: PetCustomization.normalizeAppearance(item.appearance) })) : [];
    if (value?.customization) {
      state = PetCustomization.normalizeCustomization(value.customization);
      petSize = value.size || 'tiny';
      startupAppearance = PetCustomization.normalizeAppearance(value.startupAppearance || state.appearance);
      $('startup-default').checked = matchesStartup();
    } else if (value) state = PetCustomization.normalizeCustomization(value);
    syncAppearance();
    renderPresets();
    canPreview = true;
    canSave = true;
    setColorControlsEnabled(true);
    $('save').disabled = false;
    $('startup-default').disabled = false;
    window.__customizerReady = true;
  }).catch(() => {
    if (disposed) return;
    syncAppearance();
    announce('读取设置失败，请重新打开定制窗口');
    window.__customizerReady = true;
  });
})();
