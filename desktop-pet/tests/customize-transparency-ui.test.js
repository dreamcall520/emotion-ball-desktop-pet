const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fixture(appearance, startupAppearance = appearance) {
  class Node {
    constructor(name) {
      this.name = name; this.children = []; this.attributes = {}; this.dataset = {};
      this.style = { setProperty() {} }; this.value = ''; this.hidden = false; this.disabled = false;
      this.listeners = new Map();
      const classes = new Set();
      this.classList = {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value)
      };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    dispatch(name, values = {}) { return this.listeners.get(name)?.({ target: this, ...values }); }
    querySelectorAll(selector) { return selector === '.shape-option' ? this.children : []; }
    querySelector(selector) { return selector === ':scope > svg' ? this.children.find(child => child.name === 'svg') : null; }
  }
  const nodes = new Map(), saves = [], startupChoices = [], previews = [], avatarPreviews = [], frames = new Map();
  let frameId = 0;
  const document = {
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, new Node('div'));
      return nodes.get(id);
    },
    createElement: name => new Node(name),
    createElementNS: (_namespace, name) => new Node(name),
    createTextNode: text => new Node(`text:${text}`)
  };
  const window = { petCustomizer: {
    load: async () => ({ customization: { appearance }, startupAppearance, size: 'tiny' }),
    save: async (state, startupChoice) => { saves.push(state); startupChoices.push(startupChoice); return true; },
    preview: appearance => avatarPreviews.push({ ...appearance })
  }, addEventListener() {} };
  const context = vm.createContext({ window, document,
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), clearTimeout() {}, setTimeout() {} });
  const root = path.join(__dirname, '../..');
  for (const file of ['emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
    'desktop-pet/lib/customization.js', 'desktop-pet/customize-renderer.js']) {
    if (file === 'desktop-pet/customize-renderer.js') {
      context.PetCustomization = window.PetCustomization;
      context.EmotionBall = {
        config: { get: () => ({ raw: { id: '02' } }), register() {} },
        create: (target, options) => { previews.push(options); target.appendChild(new Node('svg')); return { destroy() {} }; }
      };
    }
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  await Promise.resolve();
  assert.equal(window.__customizerReady, true);
  return {
    get: id => document.getElementById(id), saves, startupChoices, previews, avatarPreviews,
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
  f.get('manual-toggle').dispatch('change', { target: { checked: true } });
  assert.equal(f.get('manual-controls').hidden, true);
  const regular = await fixture({ shape: 'blob', auroraTransparency: 51 });
  assert.equal(regular.get('manual-toggle').disabled, false);
  assert.equal(regular.get('aurora-transparency-field').hidden, false);
  assert.equal(regular.get('manual-controls').hidden, true);
  regular.get('manual-toggle').dispatch('change', { target: { checked: true } });
  assert.equal(regular.get('manual-controls').hidden, false);
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
