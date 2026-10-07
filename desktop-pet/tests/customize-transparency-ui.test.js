const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fixture(appearance, startupAppearance = appearance, options = {}) {
  class Node {
    constructor(name) {
      this.name = name; this.children = []; this.attributes = {}; this.dataset = {};
      this.style = { setProperty(key, value) { this[key] = value; } }; this.value = ''; this.hidden = false; this.disabled = false;
      this.listeners = new Map();
      const classes = new Set();
      this.classList = {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle: (value, force = !classes.has(value)) => {
          if (force) classes.add(value); else classes.delete(value);
          return force;
        }
      };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    setPointerCapture(id) { this.capturedPointer = id; }
    hasPointerCapture(id) { return this.capturedPointer === id; }
    releasePointerCapture(id) { if (this.capturedPointer === id) this.capturedPointer = null; }
    getBoundingClientRect() { if (this.rect) return this.rect; return this.id === 'color-picker'
      ? { width: 280, height: 350 } : this.id === 'color-sv'
        ? { left: 100, top: 100, width: 250, height: 154 } : { right: 748, top: 550, bottom: 578 }; }
    focus() { this.focused = true; }
    get firstChild() { return this.children[0] || null; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    appendChild(child) { child.remove?.(); child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    dispatch(name, values = {}) { return this.listeners.get(name)?.({ target: this, ...values }); }
    querySelectorAll(selector) { return selector === '.shape-option' ? this.children : []; }
    querySelector(selector) { return selector === ':scope > svg' ? this.children.find(child => child.name === 'svg') : null; }
  }
  const nodes = new Map(), saves = [], startupChoices = [], previews = [], avatarPreviews = [], frames = new Map();
  const presetRequests = []; let presetRecords = (options.presets || []).map(item => ({ ...item })); let presetSerial = presetRecords.length;
  const documentEvents = new Map(), windowEvents = new Map(), destroyed = [], observers = [];
  const thumbnailInstances = [];
  const media = matches => ({ matches, listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
    change(matches) { this.matches = matches; this.listeners.get('change')?.(); }
  });
  const systemAppearance = media(options.dark === true), motion = media(options.reduced === true);
  let colorModeListener = null;
  let frameId = 0;
  const document = {
    documentElement: { dataset: {} }, body: new Node('body'), hidden: false,
    addEventListener(name, listener) { documentEvents.set(name, listener); },
    removeEventListener(name) { documentEvents.delete(name); },
    getElementById: id => {
      if (!nodes.has(id)) { const node = new Node('div'); node.id = id; nodes.set(id, node); }
      return nodes.get(id);
    },
    querySelector: selector => selector === '.controls' ? document.getElementById('controls') :
      selector === '.preview-mode' ? document.getElementById('preview-mode') : null,
    createElement: name => new Node(name),
    createElementNS: (_namespace, name) => new Node(name),
    createTextNode: text => new Node(`text:${text}`)
  };
  const window = { innerWidth: 760, innerHeight: 580,
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
      observe(target) { this.targets.push(target); this.callback([{ target, isIntersecting: this.targets.length <= 4 }]); }
      disconnect() { this.disconnected = true; }
    }, petCustomizer: {
    load: async () => options.loadFailure ? null : ({ customization: { appearance }, startupAppearance,
      appearancePresets: presetRecords, size: options.size || 'tiny', codexPet: options.codexPet }),
    save: async (state, startupChoice) => {
      saves.push(state); startupChoices.push(startupChoice);
      if (options.save) return options.save(state, startupChoice);
      return true;
    },
    addPreset: async (name, appearance) => {
      presetRequests.push({ action:'add', name, appearance });
      if (options.presetOperation) return options.presetOperation('add', { name, appearance });
      presetRecords = [...presetRecords, { id:'00000000-0000-4000-8000-' + String(++presetSerial).padStart(12,'0'),name:name.trim(),appearance }];
      return { ok:true, presets:presetRecords };
    },
    renamePreset: async (id, name) => {
      presetRequests.push({ action:'rename', id, name });
      if (options.presetOperation) return options.presetOperation('rename', { id, name });
      presetRecords = presetRecords.map(item => item.id===id ? { ...item, name:name.trim() } : item);
      return { ok:true, presets:presetRecords };
    },
    deletePreset: async id => {
      presetRequests.push({ action:'delete', id });
      if (options.presetOperation) return options.presetOperation('delete', { id });
      presetRecords = presetRecords.filter(item=>item.id!==id);return { ok:true, presets:presetRecords };
    },
    listCodexPets: async () => ({ ok: true, pets: options.pets || [] }),
    onColorMode: listener => { colorModeListener = listener; return () => { colorModeListener = null; }; },
    preview: appearance => avatarPreviews.push({ ...appearance })
  }, addEventListener(name, listener) { windowEvents.set(name, listener); },
    matchMedia: query => query.includes('color-scheme') ? systemAppearance : motion };
  const context = vm.createContext({ window, document,
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), clearTimeout() {}, setTimeout() {},
    CodexPetPlayer: require('../lib/codex-pet-player') });
  // Reflect the source tabs and their sibling panels in the actual HTML.
  document.getElementById('source-tabs').append(document.getElementById('source-ball'), document.getElementById('source-codex'));
  document.getElementById('controls').append(document.getElementById('source-tabs'),
    document.getElementById('ball-options'), document.getElementById('codex-panel'));
  document.getElementById('stage').append(document.getElementById('preview-mode'));
  document.getElementById('stage').clientHeight = 400;
  document.getElementById('stage').clientWidth = 300;
  document.getElementById('pet-action').value = 'idle';
  const root = path.join(__dirname, '../..');
  for (const file of ['emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
    'desktop-pet/lib/customization.js', 'desktop-pet/lib/chat-avatar.js', 'desktop-pet/customize-renderer.js']) {
    if (file === 'desktop-pet/lib/chat-avatar.js') {
      context.PetCustomization = window.PetCustomization;
      context.EmotionBall = {
        config: { get: () => ({ raw: { id: '02' } }), register() {} },
        create: (target, options) => {
          previews.push(options); const svg = new Node('svg'); target.appendChild(svg);
          const instance = { options, active: options.autostart, target,
            setActive(value) { this.active = value; },
            destroy() { this.destroyed = true; this.active = false; destroyed.push(options); svg.remove(); } };
          if (target.className === 'preset-thumbnail') thumbnailInstances.push(instance);
          return instance;
        }
      };
      window.EmotionBall = context.EmotionBall;
    }
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(window.__customizerReady, true);
  return {
    get: id => document.getElementById(id), saves, startupChoices, previews, avatarPreviews, presetRequests, thumbnailInstances,
    intersect(index, visible) { const observer = observers.at(-1); observer.callback([{ target: observer.targets[index], isIntersecting: visible }]); },
    root: document.documentElement, systemAppearance, motion, destroyed,
    documentEvent: (name, event) => documentEvents.get(name)?.(event),
    resize: () => windowEvents.get('resize')?.(),
    theme: (mode, appearance) => colorModeListener?.(mode, appearance),
    hide(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    close() { windowEvents.get('pagehide')?.(); },
    pendingFrames: () => frames.size,
    card: (shape, contour = shape === 'aurora-cloud' ? 'six-lobe' : 'original') => nodes.get('shape-options').children.find(node =>
      node.dataset.shape === shape && node.dataset.auroraContour === contour),
    flushPreview() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
    }
  };
}

test('所有形态共享透明度滑杆，预览和保存生效，恢复当前形态默认值', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.match(html, /id="aurora-transparency" type="range" min="0" max="60" step="1" value="0"/);
  const f = await fixture({ shape: 'aurora-cloud', auroraTransparency: 0 });
  assert.equal(f.get('aurora-transparency-field').hidden, false);
  assert.equal(f.get('aurora-transparency-value').textContent, '0%');
  f.flushPreview();
  assert.equal(f.previews.at(-1).auroraTransparency, 0);

  const slider = f.get('aurora-transparency');
  slider.value = '42';
  slider.dispatch('input');
  assert.equal(f.get('aurora-transparency-value').textContent, '42%');
  f.flushPreview();
  assert.equal(f.previews.at(-1).auroraTransparency, 42);
  f.card('blob').dispatch('click');
  assert.equal(f.get('aurora-transparency-field').hidden, false);
  f.flushPreview();
  assert.equal(f.get('preview-ball').querySelector(':scope > svg').style.opacity, '0.58');
  assert.equal(f.previews.at(-1).shape, 'blob');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.auroraTransparency, 42);
  const reopened = await fixture(f.saves.at(-1).appearance);
  reopened.flushPreview();
  assert.equal(reopened.get('aurora-transparency').value, '42');
  assert.equal(reopened.get('preview-ball').querySelector(':scope > svg').style.opacity, '0.58');
  f.card('aurora-cloud').dispatch('click');
  assert.equal(f.get('aurora-transparency-field').hidden, false);
  assert.equal(f.get('aurora-transparency').value, '42');
  f.get('reset-manual').dispatch('click');
  assert.equal(f.get('aurora-transparency-value').textContent, '42%', '重置轮廓不影响独立透明度');
  f.get('reset-appearance').dispatch('click');
  assert.equal(f.card('aurora-cloud').attributes['aria-pressed'], 'true');
  assert.equal(f.get('aurora-transparency').value, '0');
});

test('幻彩云禁用手动微调，但透明度仍可独立调整', async () => {
  const f = await fixture({ shape: 'aurora-cloud', auroraTransparency: 51 });
  assert.equal(f.get('manual-toggle').disabled, true);
  assert.equal(f.get('manual-hint').textContent, '为了保持完整的动效体验，暂不支持轮廓与五官微调');
  assert.equal(f.get('manual-controls').hidden, true);
  assert.equal(f.get('aurora-transparency-field').hidden, false);
  assert.equal(f.get('aurora-transparency-value').textContent, '51%');
  f.get('manual-toggle').dispatch('click');
  assert.equal(f.get('manual-controls').hidden, true);
  const regular = await fixture({ shape: 'blob', auroraTransparency: 51 });
  assert.equal(regular.get('manual-toggle').disabled, false);
  assert.equal(regular.get('aurora-transparency-field').hidden, false);
  assert.equal(regular.get('manual-controls').hidden, true);
  regular.get('manual-toggle').dispatch('click');
  assert.equal(regular.get('manual-controls').hidden, false);
  assert.equal(regular.get('manual-toggle').attributes['aria-expanded'], 'true');
  assert.equal(regular.get('manual-toggle-label').textContent, '收起');
  regular.get('manual-toggle').dispatch('click');
  assert.equal(regular.get('manual-controls').hidden, true);
  assert.equal(regular.get('manual-toggle').attributes['aria-expanded'], 'false');
  regular.card('aurora-cloud', 'six-lobe').dispatch('click');
  assert.equal(regular.get('manual-toggle-label').textContent, '暂不可用');
  regular.card('blob').dispatch('click');
  assert.equal(regular.get('manual-toggle-label').textContent, '展开');
});

test('恢复当前形态只重置其外观，不切换成经典', async () => {
  const f = await fixture({ shape: 'cloud', bodyColor: '#123456', eyeColor: '#ABCDEF',
    auroraTransparency: 38, shapeTuning: { width: 1.12 } });
  f.get('reset-appearance').dispatch('click');
  f.flushPreview();
  assert.equal(f.card('cloud').attributes['aria-pressed'], 'true');
  assert.equal(f.get('body-hex').value, '#5B3BC7');
  assert.equal(f.get('eye-hex').value, '#FFFFFF');
  assert.equal(f.get('aurora-transparency').value, '0');
  assert.equal(f.previews.at(-1).shape, 'cloud');
  assert.equal(f.avatarPreviews.at(-1).shapeTuning.width, 1);
});

test('幻彩云样式可立即切换预览、保存重开，并在恢复当前形态后回到立体幻彩', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.match(html, /id="aurora-style-dimensional"[^>]*>.*立体幻彩/s);
  assert.match(html, /id="aurora-style-simple"[^>]*>.*简色渐变/s);
  const f = await fixture({ shape: 'aurora-cloud', bodyColor: '#5B3BC7',
    auroraTransparency: 42 });
  assert.equal(f.get('aurora-style-field').hidden, false);
  assert.equal(f.get('aurora-colors').hidden, false);
  assert.equal(f.get('aurora-style-dimensional').attributes['aria-pressed'], 'true');
  f.flushPreview();
  assert.equal(f.previews.at(-1).auroraStyle, 'dimensional');
  assert.equal(f.previews.at(-1).auroraBodyTexture, null);
  const dimensionalRing = JSON.stringify(f.previews.at(-1).customShape.ring);

  f.get('aurora-style-simple').dispatch('click');
  f.flushPreview();
  assert.equal(f.avatarPreviews.at(-1).auroraStyle, 'simple', '聊天头像收到未保存样式');
  assert.equal(f.get('aurora-style-simple').attributes['aria-pressed'], 'true');
  assert.equal(f.get('aurora-colors').hidden, true, '简色不展示无效的粉金光斑调整');
  assert.equal(f.get('aurora-style-dimensional').attributes['aria-pressed'], 'false');
  f.flushPreview();
  assert.equal(f.previews.at(-1).auroraStyle, 'simple');
  assert.equal(f.previews.at(-1).auroraBodyTexture, null);
  assert.equal(JSON.stringify(f.previews.at(-1).customShape.ring), dimensionalRing,
    '两种样式共用六瓣轮廓');
  assert.equal(f.previews.at(-1).auroraTransparency, 42);
  f.card('blob').dispatch('click');
  assert.equal(f.get('aurora-style-field').hidden, true);
  f.card('aurora-cloud').dispatch('click');
  assert.equal(f.get('aurora-style-field').hidden, false);
  assert.equal(f.get('aurora-style-simple').attributes['aria-pressed'], 'true');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.auroraStyle, 'simple');
  assert.equal(f.saves.at(-1).appearance.auroraTransparency, 42);

  const reopened = await fixture(f.saves.at(-1).appearance);
  assert.equal(reopened.get('aurora-style-simple').attributes['aria-pressed'], 'true');
  reopened.flushPreview();
  assert.equal(reopened.previews.at(-1).auroraStyle, 'simple');
  reopened.get('reset-appearance').dispatch('click');
  assert.equal(reopened.get('aurora-style-field').hidden, false);
  assert.equal(reopened.card('aurora-cloud').attributes['aria-pressed'], 'true');
  assert.equal(reopened.get('aurora-style-dimensional').attributes['aria-pressed'], 'true');
  assert.equal(reopened.get('aurora-colors').hidden, false);
  assert.equal(reopened.get('aurora-transparency').value, '0');
});

test('未保存的颜色变化同步聊天头像，待机表情设置不再显示', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.doesNotMatch(html, /id="idle-eyes"/);
  const f = await fixture({ shape: 'aurora-cloud', idleEyes: 'sleepy' });
  f.get('body-hex').value = '#8B72D8';
  f.get('body-hex').dispatch('input');
  f.flushPreview();
  assert.equal(f.avatarPreviews.at(-1).bodyColor, '#8B72D8');
  assert.equal(f.avatarPreviews.at(-1).idleEyes, 'original');
  assert.equal(f.saves.length, 0);
});

test('启动外观选择随保存传递，临时换装默认不覆盖原选择', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.match(html, /id="startup-default" type="checkbox"/);
  const f = await fixture({ shape: 'square' }, { shape: 'cloud', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF' });
  assert.equal(f.get('startup-default').checked, false);
  f.card('cloud').dispatch('click');
  assert.equal(f.get('startup-default').checked, true, '切回已保存的默认形态应选中');
  f.card('square').dispatch('click');
  assert.equal(f.get('startup-default').checked, false, '切到非默认形态应取消选中');
  await f.get('save').dispatch('click');
  assert.equal(f.startupChoices.at(-1), false);
  f.get('startup-default').checked = true;
  await f.get('save').dispatch('click');
  assert.equal(f.startupChoices.at(-1), true);
  f.card('cloud').dispatch('click');
  assert.equal(f.get('startup-default').checked, false, '保存新默认后旧形态不再选中');
  f.card('square').dispatch('click');
  assert.equal(f.get('startup-default').checked, true);
  const matching = await fixture({ shape: 'cloud' });
  assert.equal(matching.get('startup-default').checked, true);
  const temporary = await fixture({ shape: 'cloud', bodyColor: '#ABCDEF' }, { shape: 'cloud', bodyColor: '#5B3BC7' });
  assert.equal(temporary.get('startup-default').checked, false, '同形态临时配色不能误标为启动默认');
});

test('主题跟随真实消息，固定主题不随系统变化，关闭后移除监听', async () => {
  const f = await fixture({ shape: 'blob' });
  assert.equal(f.root.dataset.theme, 'light');
  f.theme('accessible', 'dark');
  assert.equal(f.root.dataset.colorMode, 'accessible');
  assert.equal(f.root.dataset.theme, 'dark');
  f.systemAppearance.change(false);
  assert.equal(f.root.dataset.theme, 'dark');
  f.theme('standard', 'system');
  assert.equal(f.root.dataset.theme, 'light');
  f.systemAppearance.change(true);
  assert.equal(f.root.dataset.theme, 'dark');
  f.close();
  f.theme('accessible', 'light');
  f.systemAppearance.change(false);
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.pendingFrames(), 0);
  assert.equal(f.saves.length, 0);
});

test('真实桌面尺寸保留，减少动态及不可见页面停止预览，恢复不保存', async () => {
  const f = await fixture({ shape: 'square' }, { shape: 'square' }, { size: 'large' });
  f.get('preview-desktop').dispatch('click');
  f.flushPreview();
  assert.equal(f.get('preview-ball').style.width, '260px');
  assert.equal(f.get('preview-size-label').textContent, '桌面实际尺寸 · 260 × 260 px');
  assert.equal(f.previews.at(-1).autostart, true);
  f.motion.change(true);
  f.flushPreview();
  assert.equal(f.previews.at(-1).autostart, false);
  assert.equal(f.get('preview-status').textContent, '减少动态已开启');
  const rendered = f.previews.length;
  f.hide(true);
  assert.equal(f.get('preview-ball').children.length, 0);
  assert.equal(f.pendingFrames(), 0);
  f.motion.change(false);
  f.flushPreview();
  assert.equal(f.previews.length, rendered);
  f.hide(false);
  f.flushPreview();
  assert.equal(f.previews.at(-1).autostart, true);
  assert.equal(f.get('preview-ball').style.width, '260px');
  assert.equal(f.saves.length, 0);
  f.close();
  assert.equal(f.get('preview-ball').children.length, 0);
  assert.ok(f.destroyed.length >= 3);
});

test('保存失败与异常保留编辑值并允许重试，读取失败不开放保存', async () => {
  let attempts = 0;
  const f = await fixture({ shape: 'blob' }, { shape: 'blob' }, { save: async () => {
    attempts++;
    if (attempts === 1) return false;
    if (attempts === 2) throw new Error('disk unavailable');
    return true;
  } });
  f.get('body-hex').value = '#123456';
  f.get('body-hex').dispatch('input');
  f.get('startup-default').checked = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.get('save').dispatch('click');
    assert.equal(f.get('save').disabled, false);
    assert.equal(f.get('body-hex').value, '#123456');
    assert.equal(f.get('message').textContent, '保存未完成，请稍后重试');
    assert.equal(f.get('message').hidden, false);
  }
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.bodyColor, '#123456');
  assert.equal(f.startupChoices.at(-1), false);
  const unavailable = await fixture({ shape: 'blob' }, { shape: 'blob' }, { loadFailure: true });
  assert.equal(unavailable.get('save').disabled, true);
  await unavailable.get('save').dispatch('click');
  assert.equal(unavailable.saves.length, 0);
});

test('无效HEX阻止保存并聚焦，简色不受隐藏光斑输入影响', async () => {
  const f = await fixture({ shape: 'aurora-cloud' });
  f.get('body-hex').value = 'not-hex';
  await f.get('save').dispatch('click');
  assert.equal(f.saves.length, 0);
  assert.equal(f.get('body-hex').focused, true);
  assert.equal(f.get('save').disabled, false);
  f.get('body-hex').value = '#123';
  f.get('glow-pink-hex').value = 'not-hex';
  f.get('aurora-style-simple').dispatch('click');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.bodyColor, '#112233');
  assert.equal(f.saves.at(-1).appearance.auroraStyle, 'simple');
});

function svPointer(f, type, x, y, values = {}) {
  return f.get('color-sv').dispatch(type, { pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault() {}, ...values });
}

test('二维SV拖动同步真实颜色，出界夹紧且黑色仍保留色相', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.doesNotMatch(html, /type="color"|id="color-saturation"|id="color-value"/);
  assert.match(html, /id="color-sv"[^>]*role="slider"/);
  const f = await fixture({ shape: 'blob', bodyColor: '#FF0000' });
  f.get('body-color').dispatch('click');
  assert.equal(f.get('color-picker').hidden, false);
  assert.equal(f.get('color-sv').focused, true);
  f.get('color-hue').value = '120'; f.get('color-hue').dispatch('input');
  svPointer(f, 'pointerdown', 350, 100);
  assert.equal(f.get('color-sv').capturedPointer, 1);
  assert.equal(f.get('body-hex').value, '#00FF00');
  svPointer(f, 'pointermove', 500, 400);
  assert.equal(f.get('body-hex').value, '#000000');
  assert.equal(f.get('color-sv').attributes['aria-valuetext'], '饱和度 100%，明度 0%');
  f.get('color-hue').value = '240'; f.get('color-hue').dispatch('input');
  svPointer(f, 'pointermove', 500, 0);
  assert.equal(f.get('body-hex').value, '#0000FF');
  svPointer(f, 'pointermove', 0, 0);
  assert.equal(f.get('body-hex').value, '#FFFFFF');
  svPointer(f, 'pointerup', 500, 0);
  assert.equal(f.get('color-sv').capturedPointer, null);
  svPointer(f, 'pointermove', 0, 400);
  assert.equal(f.get('body-hex').value, '#0000FF', '结束拖动后游标移动不改色');
  f.flushPreview();
  assert.equal(f.previews.at(-1).color, '#0000FF');
  assert.equal(f.get('color-picker-sample').style.backgroundColor, '#0000FF');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.bodyColor, '#0000FF');
});

test('二维SV方向键和Shift连续调整，取消与非主指针不会留下拖动', async () => {
  const f = await fixture({ shape: 'blob', bodyColor: '#FF0000' });
  f.get('body-color').dispatch('click');
  let prevented = false;
  f.get('color-sv').dispatch('keydown', { key: 'ArrowDown', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.get('body-hex').value, '#E60000');
  f.get('color-sv').dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(f.get('color-sv').attributes['aria-valuetext'], '饱和度 99%，明度 90%');
  svPointer(f, 'pointerdown', 100, 100, { isPrimary: false });
  assert.equal(f.get('body-hex').value, '#E60202');
  svPointer(f, 'pointerdown', 225, 177);
  assert.equal(f.get('body-hex').value, '#804040');
  svPointer(f, 'pointercancel', 225, 177);
  assert.equal(f.get('color-sv').capturedPointer, null);
  svPointer(f, 'pointermove', 350, 100);
  assert.equal(f.get('body-hex').value, '#804040');
});

test('HEX与RGB输入双向同步，空值、越界与小数不污染真实颜色', async () => {
  const f = await fixture({ shape: 'blob', bodyColor: '#FF0000' });
  f.get('body-color').dispatch('click');
  f.get('color-picker-hex').value = '#abc'; f.get('color-picker-hex').dispatch('input');
  assert.equal(f.get('body-hex').value, '#FF0000', '短HEX输入尚未完成时保留实际颜色');
  f.get('color-picker-hex').dispatch('change');
  assert.equal(f.get('body-hex').value, '#AABBCC');
  assert.deepEqual(['color-red','color-green','color-blue'].map(id => f.get(id).value), ['170','187','204']);
  for (const value of ['', '256', '-1', '1.5']) {
    f.get('color-red').value = value; f.get('color-red').dispatch('input');
    assert.equal(f.get('body-hex').value, '#AABBCC');
    assert.equal(f.get('color-red').classList.contains('invalid'), true);
    f.get('color-red').dispatch('change');
    assert.equal(f.get('color-red').value, '170');
  }
  f.get('color-red').value = '42'; f.get('color-red').dispatch('input');
  f.get('color-green').value = '139'; f.get('color-green').dispatch('input');
  f.get('color-blue').value = '111'; f.get('color-blue').dispatch('input');
  assert.equal(f.get('body-hex').value, '#2A8B6F');
  assert.equal(f.get('color-picker-hex').value, '#2A8B6F');
  f.get('color-picker-hex').value = '#oops'; f.get('color-picker-hex').dispatch('input');
  assert.equal(f.get('body-hex').value, '#2A8B6F');
  f.get('color-picker-hex').dispatch('change');
  assert.equal(f.get('color-picker-hex').value, '#2A8B6F');
  f.flushPreview();
  assert.equal(f.previews.at(-1).color, '#2A8B6F');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.bodyColor, '#2A8B6F');
});

test('选色浮层开关、外点与焦点离开正确关闭，Esc还原焦点并保持视口内', async () => {
  const f = await fixture({ shape: 'blob' });
  f.get('color-picker').append(f.get('color-hue'));
  f.get('body-color').dispatch('click');
  assert.equal(f.get('color-picker').style.left, '468px');
  assert.equal(f.get('color-picker').style.top, '192px');
  f.documentEvent('pointerdown', { target: f.get('color-hue') });
  assert.equal(f.get('color-picker').hidden, false);
  let prevented = false;
  f.documentEvent('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(f.get('color-picker').hidden, true);
  assert.equal(f.get('body-color').focused, true);
  assert.equal(f.get('body-color').attributes['aria-expanded'], 'false');
  f.get('eye-color').dispatch('click');
  assert.equal(f.get('color-picker-title').textContent, '眼睛颜色');
  f.documentEvent('pointerdown', { target: f.get('stage') });
  assert.equal(f.get('color-picker').hidden, true);
  f.get('eye-color').dispatch('click');
  f.documentEvent('focusin', { target: f.get('eye-hex') });
  assert.equal(f.get('color-picker').hidden, true);
  assert.equal(f.saves.length, 0);
});

test('HEX及推荐色同步选色器，隐藏光斑关闭浮层，范围端点的轨道填充正确', async () => {
  const f = await fixture({ shape: 'aurora-cloud', auroraContour: 'six-lobe' });
  f.get('glow-pink-color').dispatch('click');
  f.get('glow-pink-hex').value = '#123456'; f.get('glow-pink-hex').dispatch('input');
  assert.equal(f.get('color-picker-hex').value, '#123456');
  f.get('glow-pink-swatches').children[0].dispatch('click');
  assert.equal(f.get('color-picker-hex').value, '#D05ED6');
  f.get('aurora-style-simple').dispatch('click');
  assert.equal(f.get('color-picker').hidden, true);
  for (const value of ['0', '30', '60']) {
    f.get('aurora-transparency').value = value; f.get('aurora-transparency').dispatch('input');
    assert.equal(f.get('aurora-transparency').style['--range-fill'], Number(value) / 60 * 100 + '%');
  }
});

test('加载失败与保存进行时不能开启或修改选色，保存失败后可重试', async () => {
  const unavailable = await fixture({ shape: 'blob' }, { shape: 'blob' }, { loadFailure: true });
  assert.equal(unavailable.get('body-color').disabled, true);
  unavailable.get('body-color').dispatch('click');
  assert.notEqual(unavailable.get('body-color').attributes['aria-expanded'], 'true');
  let resolveSave;
  const f = await fixture({ shape: 'blob', bodyColor: '#FF0000' }, undefined,
    { save: () => new Promise(resolve => { resolveSave = resolve; }) });
  f.get('body-color').dispatch('click');
  svPointer(f, 'pointerdown', 350, 100);
  const saving = f.get('save').dispatch('click');
  assert.equal(f.get('color-picker').hidden, true);
  assert.equal(f.get('body-color').disabled, true);
  assert.equal(f.get('color-hue').disabled, true);
  assert.equal(f.get('color-sv').capturedPointer, null);
  assert.equal(f.get('color-sv').attributes['aria-disabled'], 'true');
  assert.equal(f.get('color-picker-hex').disabled, true);
  assert.equal(f.get('color-red').disabled, true);
  f.get('body-color').dispatch('click');
  f.get('color-hue').value = '120'; f.get('color-hue').dispatch('input');
  svPointer(f, 'pointerdown', 100, 100);
  f.get('color-red').value = '0'; f.get('color-red').dispatch('input');
  resolveSave(false); await saving;
  assert.equal(f.get('body-hex').value, '#FF0000');
  assert.equal(f.get('body-color').disabled, false);
  f.get('body-color').dispatch('click');
  assert.equal(f.get('color-picker').hidden, false);
});

test('选色忽略打开之前排队的scroll，实际滚动移动入口时仍收起', async () => {
  const f = await fixture({ shape: 'blob' });
  f.get('body-color').dispatch('click');
  f.get('controls').dispatch('scroll');
  assert.equal(f.get('color-picker').hidden, false, '未移动入口的旧scroll不能立即关闭新浮层');
  assert.equal(f.get('body-color').attributes['aria-expanded'], 'true');
  f.get('body-color').rect = { right: 748, top: 530, bottom: 558 };
  f.get('controls').dispatch('scroll');
  assert.equal(f.get('color-picker').hidden, true, '真正移动入口的滚动仍关闭浮层');
  assert.equal(f.get('body-color').attributes['aria-expanded'], 'false');
});

test('同长度粉光与金光推荐色仍绑定当前字段，滑钮悬停不新增外光晕', async () => {
  const f = await fixture({ shape: 'aurora-cloud', auroraContour: 'six-lobe' });
  f.get('glow-pink-color').dispatch('click');
  const pink = f.get('glow-pink-hex').value;
  f.get('glow-gold-color').dispatch('click');
  f.get('color-picker-presets').children[0].dispatch('click');
  assert.equal(f.get('glow-gold-hex').value, '#D0AD8A');
  assert.equal(f.get('glow-pink-hex').value, pink);
  const css = fs.readFileSync(path.join(__dirname, '../customize.css'), 'utf8');
  assert.doesNotMatch(css, /input\[type=range\]:hover[^}]*box-shadow/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /left:clamp\(7px,var\(--sv-x/);
});


test('收藏当前草稿仅写收藏库，载入恢复精确配色与手调并重算启动勾选', async () => {
  const f=await fixture({shape:'blob',bodyColor:'#EEEBE4'});
  f.get('body-hex').value='#2A8B6F';f.get('body-hex').dispatch('input');
  f.get('shape-width').value='112';f.get('shape-width').dispatch('input');
  f.get('aurora-transparency').value='30';f.get('aurora-transparency').dispatch('input');
  f.get('preset-add').dispatch('click');assert.equal(f.get('preset-form').hidden,false);
  f.get('preset-name').value=' 薄荷奶糖 ';
  await f.get('preset-form').dispatch('submit',{preventDefault(){}});
  assert.equal(f.get('preset-form').hidden,true);assert.equal(f.get('preset-list').children.length,1);
  assert.equal(f.saves.length,0);assert.equal(f.presetRequests[0].appearance.bodyColor,'#2A8B6F');
  assert.equal(f.presetRequests[0].appearance.shapeTuning.width,1.12);
  f.get('body-hex').value='#123456';f.get('body-hex').dispatch('input');
  f.get('startup-default').checked=true;
  f.get('preset-list').children[0].children[0].dispatch('click');
  assert.equal(f.get('body-hex').value,'#2A8B6F');assert.equal(f.get('shape-width').value,'112');
  assert.equal(f.get('aurora-transparency').value,'30');assert.equal(f.get('startup-default').checked,false);
  assert.equal(f.saves.length,0);f.flushPreview();assert.equal(f.previews.at(-1).color,'#2A8B6F');
  const row=f.get('preset-list').children[0];assert.equal(row.attributes['aria-current'],'true');
  f.get('shape-width').value='115';f.get('shape-width').dispatch('input');
  assert.equal(row.attributes['aria-current'],'false','调整手调后不再把收藏标记为当前匹配');
  f.get('shape-width').value='112';f.get('shape-width').dispatch('input');
  assert.equal(row.attributes['aria-current'],'true');
  await f.get('save').dispatch('click');assert.equal(f.startupChoices.at(-1),false);
  assert.equal(f.saves.at(-1).appearance.bodyColor,'#2A8B6F');
});

test('已有收藏改名不换ID，删除先确认且不改当前预览和启动勾选', async () => {
  const id='00000000-0000-4000-8000-000000000001';
  const f=await fixture({shape:'square',bodyColor:'#2A8B6F'},undefined,
    {presets:[{id,name:'薄荷',appearance:{shape:'square',bodyColor:'#2A8B6F'}}]});
  const row=()=>f.get('preset-list').children[0];
  row().children[0].dispatch('click');const startup=f.get('startup-default').checked;
  row().children[1].dispatch('click');f.get('preset-name').value='奶糖';
  await f.get('preset-form').dispatch('submit',{preventDefault(){}});
  assert.equal(row().dataset.presetId,id);assert.equal(f.presetRequests[0].action,'rename');
  assert.equal(row().children[0].children[1].textContent,'奶糖');
  row().children[2].dispatch('click');assert.equal(f.get('preset-delete-confirm').hidden,false);
  assert.equal(f.presetRequests.length,1,'首次点删除只展示确认');
  await f.get('preset-delete-submit').dispatch('click');
  assert.equal(f.get('preset-list').children.length,0);assert.equal(f.get('body-hex').value,'#2A8B6F');
  assert.equal(f.get('startup-default').checked,startup);assert.equal(f.saves.length,0);
});

test('收藏失败保留原列表名称与草稿，进行中禁用并清理选色拖动', async () => {
  let resolve;
  const f=await fixture({shape:'blob',bodyColor:'#FF0000'},undefined,
    {presetOperation:()=>new Promise(done=>{resolve=done;})});
  f.get('preset-add').dispatch('click');f.get('preset-name').value='红糖';
  f.get('body-color').dispatch('click');svPointer(f,'pointerdown',350,100);
  const pending=f.get('preset-form').dispatch('submit',{preventDefault(){}});
  assert.equal(f.get('preset-submit').disabled,true);assert.equal(f.get('preset-name').disabled,true);
  assert.equal(f.get('shape-width').disabled,true);assert.equal(f.get('color-sv').capturedPointer,null);
  assert.equal(f.get('save').disabled,true);
  resolve({ok:false,error:'磁盘写入未完成'});await pending;
  assert.equal(f.get('preset-list').children.length,0);assert.equal(f.get('preset-form').hidden,false);
  assert.equal(f.get('preset-name').value,'红糖');assert.equal(f.get('body-hex').value,'#FF0000');
  assert.equal(f.get('preset-error').textContent,'磁盘写入未完成');assert.equal(f.get('preset-submit').disabled,false);
  assert.equal(f.get('save').disabled,false);assert.equal(f.saves.length,0);
  const unavailable=await fixture({shape:'blob'},undefined,{loadFailure:true});
  assert.equal(unavailable.get('preset-add').disabled,true);
});


test('收藏缩略图复用真实头像配置，四项可见且第五项滚入后才创建静态实例', async () => {
  const presets=['blob','cloud','square','aurora-cloud','blob'].map((shape,index)=>({
    id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'), name:'收藏'+index,
    appearance:{shape,bodyColor:index===4?'#2A8B6F':'#28415C',eyeColor:'#F4E8C8',
      auroraContour:'six-lobe',auroraTransparency:42,auroraStyle:'simple',eyeScale:.8,eyeSpacing:1.2,eyeHeight:8,
      shapeTuning:{width:1.13,height:1,softness:.72,asymmetry:0}} }));
  const f=await fixture({shape:'blob'},undefined,{presets});
  assert.equal(f.get('preset-list').children.length,5);
  assert.equal(f.thumbnailInstances.length,4);
  for(const instance of f.thumbnailInstances){
    assert.equal(instance.active,false);assert.equal(instance.options.autostart,false);
    assert.equal(instance.options.eyeColor,'#F4E8C8');assert.equal(instance.options.auroraTransparency,42);
    assert.equal(instance.options.color,'#28415C');assert.ok(instance.options.customShape.ring.length);
    assert.equal(instance.target.firstChild.name,'svg');
    assert.equal(instance.target.dataset.avatarReady,'true');
  }
  assert.equal(f.thumbnailInstances[0].options.eyeScale,.8);
  assert.equal(f.thumbnailInstances[0].options.eyeSpacing,1.2);
  assert.equal(f.thumbnailInstances[0].options.eyeHeight,8);
  assert.equal(JSON.parse(f.thumbnailInstances[3].target.dataset.avatarAppearance).auroraContour,'six-lobe');
  const old=f.thumbnailInstances[0];f.intersect(0,false);assert.equal(old.destroyed,true);
  f.intersect(4,true);assert.equal(f.thumbnailInstances.length,5);
  assert.equal(f.thumbnailInstances.at(-1).options.color,'#2A8B6F');
  assert.equal(f.thumbnailInstances.filter(instance=>!instance.destroyed).length,4);
  f.hide(true);assert.equal(f.thumbnailInstances.filter(instance=>!instance.destroyed).length,0);
  f.hide(false);assert.equal(f.thumbnailInstances.filter(instance=>!instance.destroyed).length,4);
  f.close();f.intersect(4,true);
  assert.equal(f.thumbnailInstances.filter(instance=>!instance.destroyed).length,0);
});

test('收藏删除确认关联当前行，取消及写入失败均保留收藏与当前草稿', async () => {
  const id='00000000-0000-4000-8000-000000000001';
  const f=await fixture({shape:'square',bodyColor:'#2A8B6F'},undefined,{presets:[{id,name:'薄荷奶糖',appearance:{shape:'square',bodyColor:'#2A8B6F'}}],
    presetOperation:async()=>({ok:false,error:'保存未完成'})});
  const row=f.get('preset-list').children[0];row.children[2].dispatch('click');
  assert.equal(f.get('preset-delete-confirm').parentNode,row);
  assert.equal(row.dataset.confirming,'true');assert.ok(f.get('preset-delete-label').textContent.includes('薄荷奶糖'));
  f.get('preset-delete-cancel').dispatch('click');
  assert.equal(f.get('preset-delete-confirm').hidden,true);assert.equal(row.dataset.confirming,undefined);
  assert.equal(f.presetRequests.length,0);
  row.children[2].dispatch('click');await f.get('preset-delete-submit').dispatch('click');
  assert.equal(f.get('preset-delete-confirm').hidden,false);assert.equal(f.get('preset-delete-submit').disabled,false);
  assert.equal(f.get('preset-list').children.length,1);assert.equal(f.get('body-hex').value,'#2A8B6F');
  const css=fs.readFileSync(path.join(__dirname,'../customize.css'),'utf8');
  assert.match(css,/\.preset-list\{[^}]*max-height:230px;overflow-y:auto/);
  assert.match(css,/\.preset-danger\{[^}]*background:transparent;color:var\(--preset-danger-text\)/);
});


test('相同完整外观不能换名重复收藏，提示已有名称并保留草稿，调整后仍可新增', async () => {
  const appearance={shape:'square',bodyColor:'#2A8B6F',eyeColor:'#F4E8C8',auroraTransparency:30,
    shapeTuning:{width:1.12,height:1,softness:.72,asymmetry:0},eyeScale:.8,eyeSpacing:1.2,eyeHeight:6};
  const f=await fixture(appearance,undefined,{presets:[{id:'00000000-0000-4000-8000-000000000001',name:'薄荷奶糖',appearance}]});
  f.get('preset-add').dispatch('click');f.get('preset-name').value='另一个名字';
  await f.get('preset-form').dispatch('submit',{preventDefault(){}});
  assert.equal(f.presetRequests.length,0);assert.equal(f.get('preset-list').children.length,1);
  assert.equal(f.get('preset-name').value,'另一个名字');assert.equal(f.get('preset-form').hidden,false);
  assert.equal(f.get('preset-error').textContent,'已收藏为「薄荷奶糖」，无需重复保存');
  assert.equal(f.get('preset-submit').disabled,false);assert.equal(f.get('body-hex').value,'#2A8B6F');
  f.get('shape-width').value='114';f.get('shape-width').dispatch('input');
  await f.get('preset-form').dispatch('submit',{preventDefault(){}});
  assert.equal(f.presetRequests.length,1);assert.equal(f.get('preset-list').children.length,2);
  assert.equal(f.presetRequests[0].appearance.shapeTuning.width,1.14);
});

test('形态已按下不代表预览已绘制，真实绘制标记随新颜色立即失效并在下一帧更新', async () => {
  const f=await fixture({shape:'blob'});f.flushPreview();
  assert.equal(JSON.parse(f.get('preview-ball').dataset.renderedAppearance).shape,'blob');
  f.card('cloud').dispatch('click');assert.equal(f.card('cloud').attributes['aria-pressed'],'true');
  assert.equal(f.get('preview-ball').dataset.renderedAppearance,undefined);
  f.flushPreview();assert.equal(JSON.parse(f.get('preview-ball').dataset.renderedAppearance).shape,'cloud');
  f.get('body-hex').value='#3C5E72';f.get('body-hex').dispatch('input');
  assert.equal(f.get('preview-ball').dataset.renderedAppearance,undefined);
  f.flushPreview();assert.equal(JSON.parse(f.get('preview-ball').dataset.renderedAppearance).bodyColor,'#3C5E72');
});


test('未生效的颜色或样式不同仍属于同一个可见形象，重复提示保留原收藏', async () => {
  for(const shape of ['blob','aurora-cloud']){
    const appearance={shape,bodyColor:'#2A8B6F',eyeColor:'#F4E8C8',auroraContour:'six-lobe',auroraStyle:shape==='blob'?'dimensional':'simple'};
    const stored={...appearance,glowPinkColor:'#123456',glowGoldColor:'#654321',...(shape==='blob'?{auroraStyle:'simple'}:{})};
    const f=await fixture(appearance,undefined,{presets:[{id:'00000000-0000-4000-8000-000000000001',name:'原有形象',appearance:stored}]});
    f.get('preset-add').dispatch('click');f.get('preset-name').value='新名称';
    await f.get('preset-form').dispatch('submit',{preventDefault(){}});
    assert.equal(f.presetRequests.length,0);assert.equal(f.get('preset-list').children.length,1);
    assert.equal(f.get('preset-error').textContent,'已收藏为「原有形象」，无需重复保存');
    assert.equal(f.get('preset-name').value,'新名称');
  }
});

const codexPet = (index, name) => ({ id: 'codex-' + String(index + 1).repeat(64), name,
  version: 1, rows: 9, imageURL: `file:///tmp/codex-test-${index}.webp` });

test('浏览 Codex 页签保留当前球球草稿，只有点选卡片才替换待保存外观', async () => {
  const pet = codexPet(0, '测试宠物');
  const f = await fixture({ shape: 'blob', bodyColor: '#123456' }, undefined, { pets: [pet], save: async () => false });
  f.flushPreview(); const rendered = f.previews.length;
  assert.equal(f.get('source-ball').attributes['aria-pressed'], 'true');
  f.get('source-codex').dispatch('click');
  assert.equal(f.get('source-codex').attributes['aria-pressed'], 'true');
  assert.equal(f.get('ball-options').hidden, true); assert.equal(f.get('codex-panel').hidden, false);
  assert.equal(f.previews.length, rendered); assert.equal(f.get('preview-name').textContent, '经典');
  await f.get('save').dispatch('click'); assert.equal(f.saves.at(-1).appearance.bodyColor, '#123456');
  f.get('pet-grid').children[0].dispatch('click');
  assert.equal(f.get('preview-name').textContent, '测试宠物');
  f.get('source-ball').dispatch('click');
  await f.get('save').dispatch('click');
  assert.equal(f.saves.at(-1).appearance.codexPetId, pet.id, 'switching tabs preserves the selected candidate');
  f.card('cloud').dispatch('click');
  await f.get('save').dispatch('click'); assert.equal(f.saves.at(-1).appearance.shape, 'cloud');
  f.close();
});

test('超过六个宠物显示搜索，名称筛选和空结果均保留已选择的待保存宠物', async () => {
  const pets = Array.from({ length: 7 }, (_, index) => codexPet(index, index < 2 ? `ABG ${index}` : `宠物 ${index}`));
  const f = await fixture({ shape: 'blob' }, undefined, { pets, save: async () => false });
  assert.equal(f.get('pet-search-field').hidden, false); assert.equal(f.get('pet-grid').children.length, 7);
  f.get('pet-grid').children[0].dispatch('click');
  f.get('pet-search').value = ' abg '; f.get('pet-search').dispatch('input');
  assert.equal(f.get('pet-grid').children.length, 2); assert.equal(f.get('pet-read-status').textContent, '找到 2 个');
  assert.equal(f.get('pet-grid').children[0].attributes['aria-pressed'], 'true');
  f.get('pet-search').value = '不存在'; f.get('pet-search').dispatch('input');
  assert.equal(f.get('pet-grid').children.length, 0); assert.equal(f.get('pet-filter-status').hidden, false);
  assert.equal(f.get('preview-name').textContent, 'ABG 0');
  await f.get('save').dispatch('click'); assert.equal(f.saves.at(-1).appearance.codexPetId, pets[0].id);
  f.get('pet-search').value = ''; f.get('pet-search').dispatch('input');
  assert.equal(f.get('pet-grid').children.length, 7); assert.equal(f.get('pet-filter-status').hidden, true);
  f.close();
});

test('保存后的导入 ID 与原 Codex 卡片关联，重开仍标记同一宠物而不重复显示', async () => {
  const source = codexPet(0, '同一宠物'), importedId = 'codex-' + 'a'.repeat(64);
  const appearance = { shape: 'codex-pet', codexPetId: importedId };
  const f = await fixture(appearance, appearance, { pets: [{ ...source, importedId }],
    codexPet: { ...source, id: importedId }, save: async () => false });
  assert.equal(f.get('pet-search-field').hidden, true);
  assert.equal(f.get('pet-grid').children.length, 1);
  assert.equal(f.get('pet-grid').children[0].attributes['aria-pressed'], 'true');
  assert.equal(f.get('preview-name').textContent, '同一宠物');
  await f.get('save').dispatch('click'); assert.equal(f.saves.at(-1).appearance.codexPetId, importedId);
  f.close();
});


test('Codex 透明度轨道在载入和换宠物时与滑块位置一致', async () => {
  const pets = [codexPet(0, '已有宠物'), codexPet(1, '另一宠物')];
  const appearance = { shape: 'codex-pet', codexPetId: pets[0].id, auroraTransparency: 36 };
  const f = await fixture(appearance, appearance, { pets, codexPet: pets[0] });
  assert.equal(Number(f.get('pet-opacity').value), 36);
  assert.equal(f.get('pet-opacity').style['--range-fill'], '60%');
  f.get('pet-opacity').value = 12; f.get('pet-opacity').dispatch('input');
  assert.equal(f.get('pet-opacity').style['--range-fill'], '20%');
  f.get('pet-grid').children[1].dispatch('click');
  assert.equal(Number(f.get('pet-opacity').value), 0);
  assert.equal(f.get('pet-opacity').style['--range-fill'], '0%');
  f.close();
});
