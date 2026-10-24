const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('圣诞缩略图使用完整静态图，不受动画atlas帧数变化影响', () => {
  const root=path.join(__dirname,'..');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/sheep/manifest.json'),'utf8'));
  const css=fs.readFileSync(path.join(root,'customize.css'),'utf8');
  const rule=/\.sheep-theme-options \.sheep-theme-swatch\.christmas\{([^}]+)\}/.exec(css)?.[1];
  assert.ok(rule);
  assert.ok(rule.includes(manifest.themes.christmas.staticFile));
  assert.match(rule,/background-size:contain/);
  assert.match(rule,/background-position:center/);
});

async function customizerFixture({ appearance, bridge = {} } = {}) {
  class Node {
    constructor(name) {
      this.name = name; this.children = []; this.attributes = {}; this.dataset = {};
      this.style = { setProperty() {} }; this.className = ''; this.value = ''; this.disabled = false;
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
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(name, callback) { this.listeners ||= {}; this.listeners[name] = callback; }
    dispatch(name, values = {}) { return this.listeners?.[name]?.({ target: this, ...values }); }
    focus() { this.focused = true; }
    querySelector(name) { return this.findAll(name)[0] || null; }
    querySelectorAll(name) { return this.children.flatMap(child => child.findAll(name)); }
    findAll(name) { return [...((name.startsWith('.') ? this.className.split(' ').includes(name.slice(1)) : this.name === name) ? [this] : []), ...this.children.flatMap(child => child.findAll(name))]; }
  }
  const nodes = new Map();
  const document = {
    body: new Node('body'),
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, new Node('div'));
      return nodes.get(id);
    },
    createElement: name => new Node(name),
    createElementNS: (_namespace, name) => new Node(name),
    createTextNode: text => new Node(`text:${text}`),
    querySelector: selector => selector === '.preview-mode' ? document.getElementById('preview-mode') : null
  };
  const window = { petCustomizer: { load: async () => ({ customization: appearance ? { appearance } : null, size: 'tiny' }), ...bridge }, addEventListener() {} };
  document.getElementById('source-tabs').append(document.getElementById('source-ball'), document.getElementById('source-codex'));
  document.getElementById('controls').append(document.getElementById('source-tabs'),
    document.getElementById('ball-options'), document.getElementById('codex-panel'));
  document.getElementById('stage').append(document.getElementById('preview-mode'));
  let nextFrame = 0;
  const frames = new Map();
  const context = vm.createContext({ window, document, requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }, clearTimeout() {}, setTimeout() {} });
  const renderCalls = [];
  const root = path.join(__dirname, '../..');
  for (const file of ['emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
    'desktop-pet/lib/customization.js', 'desktop-pet/customize-renderer.js']) {
    if (file === 'desktop-pet/customize-renderer.js') {
      context.PetCustomization = window.PetCustomization;
      context.EmotionBall = { config: { get: () => ({ raw: {} }), register() {} }, create(target, options) {
        renderCalls.push(options);
        target.appendChild(new Node('svg'));
        return { destroy() {}, setFacing(side) { options.appliedFacing = side; } };
      } };
    }
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  await Promise.resolve();
  return { window, nodes, renderCalls, root, flushPreview() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); } };
}

test('五种形态卡使用实际图标，幻彩保持六瓣', async () => {
  const { window, nodes, renderCalls, root } = await customizerFixture();
  assert.equal(window.__customizerReady, true);
  const cards = nodes.get('shape-options').children;
  for (const [shape, bodyColor, eyeColor, eyeScale] of [
    ['blob', '#EEEBE4', '#1A1A1A', 1.5],
    ['cloud', '#5B3BC7', '#FFFFFF', 1],
    ['square', '#EEEBE4', '#1A1A1A', 1.5]
  ]) {
    const card = cards.find(node => node.dataset.shape === shape);
    const call = renderCalls.find(options => options.shape === shape);
    assert.ok(call, shape);
    assert.equal(call.color, bodyColor);
    assert.equal(call.eyeColor, eyeColor);
    assert.equal(call.eyeScale, eyeScale);
    assert.equal(call.facing, 'left', '与幻彩云预览保持同向');
    assert.equal(call.autostart, false);
    assert.equal(call.lite, true);
    assert.equal(card.findAll('svg')[0].attributes['aria-hidden'], 'true');
    assert.equal(shape === 'blob' ? call.customShape === null : !!call.customShape, true);
  }
  const sheepIcon = renderCalls.find(options => options.shape === 'new-year-sheep');
  assert.equal(sheepIcon.sheepTheme, 'none');
  assert.equal(sheepIcon.appliedFacing, 'left', '形态咩咩与主题卡使用同向idle首帧');
  const card = cards.find(node => node.dataset.shape === 'aurora-cloud');
  const images = card.findAll('img');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, 'assets/aurora-six-lobe-icon.png');
  assert.equal(images[0].alt, '');
  assert.equal(fs.readFileSync(path.join(root, 'desktop-pet/assets/aurora-six-lobe-icon.png')).subarray(1, 4).toString(), 'PNG');
  const sixLobe = cards.find(node => node.dataset.shape === 'aurora-cloud' && node.dataset.auroraContour === 'six-lobe');
  assert.ok(sixLobe, '六瓣幻彩云有独立形态卡');
  assert.equal(sixLobe.findAll('img')[0].src, 'assets/aurora-six-lobe-icon.png');
  assert.equal(card.dataset.auroraContour, 'six-lobe');
  assert.equal(cards.filter(node => node.dataset.shape === 'aurora-cloud').length, 1);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map(card => card.dataset.shape), ['blob', 'aurora-cloud', 'cloud', 'square', 'new-year-sheep']);
});

test('小羊主题仅小羊可选，保存启停与切换其他形态不会丢掉已选主题', async () => {
  let finishSave, saved;
  const f = await customizerFixture({ appearance: { shape: 'new-year-sheep', sheepTheme: 'christmas' },
    bridge: { save(value) { saved = JSON.parse(JSON.stringify(value)); return new Promise(resolve => { finishSave = resolve; }); } } });
  const $ = id => f.nodes.get(id);
  const field = $('sheep-theme-field'), selector = $('sheep-theme');
  assert.equal(f.window.__customizerReady, true);
  assert.equal(field.hidden, false);
  assert.equal(selector.value, 'christmas');
  assert.equal(selector.disabled, false);
  selector.value = 'spring-festival'; selector.dispatch('change'); f.flushPreview();
  assert.equal(f.renderCalls.at(-1).sheepTheme, 'spring-festival', '选择立即传入真实预览');
  const saving = $('save').dispatch('click');
  assert.equal(selector.disabled, true);
  for (const theme of ['none', 'halloween', 'christmas', 'spring-festival', 'auto']) {
    assert.equal($('sheep-theme-' + theme).disabled, true);
    assert.equal($('sheep-theme-' + theme).tabIndex, -1);
    $('sheep-theme-' + theme).dispatch('click');
  }
  assert.equal(saved.appearance.sheepTheme, 'spring-festival');
  selector.value = 'auto'; selector.dispatch('change');
  finishSave(true); await saving;
  assert.equal(selector.value, 'spring-festival', '保存期间的事件不能改动主题');
  assert.equal(selector.disabled, false);
  $('shape-options').children.find(node => node.dataset.shape === 'blob').dispatch('click');
  assert.equal(field.hidden, true);
  assert.equal(selector.disabled, true);
  assert.equal(selector.value, 'spring-festival');
  selector.value = 'christmas'; selector.dispatch('change');
  $('shape-options').children.find(node => node.dataset.shape === 'new-year-sheep').dispatch('click');
  assert.equal(field.hidden, false);
  assert.equal(selector.value, 'spring-festival');
  selector.value = 'auto'; selector.dispatch('change'); f.flushPreview();
  assert.equal(f.renderCalls.at(-1).sheepTheme, 'auto', '保存自动模式本身，由渲染器按日期解析');
  $('reset-appearance').dispatch('click');
  assert.equal(selector.value, 'auto', '重置配色不清除主题选择');
  const html = fs.readFileSync(path.join(f.root, 'desktop-pet/customize.html'), 'utf8');
  const select = html.match(/<select id="sheep-theme"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]), ['none', 'halloween', 'christmas', 'spring-festival', 'auto']);
  for (const range of ['10/26 – 10/31', '12/20 – 12/25']) assert.ok(html.includes(range));
  assert.ok(select.includes('春节咩咩'));
  assert.match(html, /正月初一至十五<\/span><small>含初一前6天<\/small>/);
  assert.ok(!html.includes('羊年春节'));
});


test('咩咩主题沿用幻彩卡片，键盘与鼠标同步单选、预览和隐藏兼容字段', async () => {
  const f = await customizerFixture({ appearance: { shape: 'new-year-sheep', sheepTheme: 'christmas' } });
  const $ = id => f.nodes.get(id);
  const themes = ['none', 'halloween', 'christmas', 'spring-festival', 'auto'];
  const selected = theme => {
    assert.equal($('sheep-theme').value, theme);
    assert.equal($('appearance-colors-field').hidden, true);
    assert.equal($('manual-section').hidden, true);
    for (const item of themes) {
      assert.equal($('sheep-theme-' + item).attributes['aria-checked'], String(item === theme));
      assert.equal($('sheep-theme-' + item).tabIndex, item === theme ? 0 : -1);
    }
    f.flushPreview(); assert.equal(f.renderCalls.at(-1).sheepTheme, theme);
  };
  selected('christmas');
  $('sheep-theme-spring-festival').dispatch('click'); selected('spring-festival');
  assert.equal($('sheep-theme-dates').hidden, true);
  let prevented = 0;
  const key = (theme, key) => $('sheep-theme-' + theme).dispatch('keydown', { key, preventDefault() { prevented++; } });
  key('spring-festival', 'End'); selected('auto');
  assert.equal($('sheep-theme-auto').focused, true);
  assert.equal($('sheep-theme-dates').hidden, false);
  key('auto', 'ArrowRight'); selected('none');
  key('none', 'ArrowLeft'); selected('auto');
  key('auto', 'Home'); selected('none');
  key('none', 'ArrowDown'); selected('halloween');
  key('halloween', 'ArrowUp'); selected('none');
  key('none', 'Escape'); selected('none'); assert.equal(prevented, 6);
  $('shape-options').children.find(node => node.dataset.shape === 'blob').dispatch('click');
  assert.equal($('sheep-theme-field').hidden, true);
  for (const theme of themes) {
    assert.equal($('sheep-theme-' + theme).disabled, true);
    assert.equal($('sheep-theme-' + theme).tabIndex, -1);
    $('sheep-theme-' + theme).dispatch('click');
  }
  $('shape-options').children.find(node => node.dataset.shape === 'new-year-sheep').dispatch('click'); selected('none');
  const html = fs.readFileSync(path.join(f.root, 'desktop-pet/customize.html'), 'utf8');
  assert.match(html, /class="aurora-style-options sheep-theme-options" role="radiogroup"/);
  assert.match(html, /<select id="sheep-theme" hidden aria-hidden="true" tabindex="-1"/);
  assert.match(html, /<details id="sheep-theme-dates"[^>]*hidden><summary>/);
  assert.match(html, /<p id="sheep-theme-hint" hidden><\/p>/);
  assert.doesNotMatch(html, /aria-describedby="sheep-theme-hint"|手动选择会一直保留|✦/);
  assert.match(html, /class="sheep-auto-swatch" aria-hidden="true"><svg class="icon"/);
  const css = fs.readFileSync(path.join(f.root, 'desktop-pet/customize.css'), 'utf8');
  const autoIcon = css.match(/\.sheep-auto-swatch\{([^}]+)\}/)[1];
  assert.match(autoIcon, /color:var\(--muted\)/);
  assert.doesNotMatch(autoIcon, /background|border-radius/);
  assert.match(css, /\.sheep-auto-swatch svg\.icon\{width:32px;height:32px\}/);
  for (const theme of themes) assert.match(html, new RegExp(`id="sheep-theme-${theme}"[^>]*role="radio"`));
});


test('首次选择咩咩默认自动换装，两种预览朝左，手动选择重开仍保留', async () => {
  const f = await customizerFixture();
  const $ = id => f.nodes.get(id);
  $('shape-options').children.find(node => node.dataset.shape === 'new-year-sheep').dispatch('click');
  assert.equal($('sheep-theme').value, 'auto');
  assert.equal($('sheep-theme-auto').attributes['aria-checked'], 'true');
  assert.equal($('sheep-theme-dates').hidden, false);
  for (const theme of ['none', 'halloween', 'christmas', 'spring-festival', 'auto']) {
    $('sheep-theme-' + theme).dispatch('click');
    for (const mode of ['large', 'desktop']) {
      $('preview-' + mode).dispatch('click'); f.flushPreview();
      const call = f.renderCalls.at(-1);
      assert.equal(call.shape, 'new-year-sheep');
      assert.equal(call.sheepTheme, theme);
      assert.equal(call.facing, 'left');
      assert.equal(call.appliedFacing, 'left', '实际羊播放器也收到方向');
    }
    const reopened = await customizerFixture({ appearance: { shape: 'new-year-sheep', sheepTheme: theme } });
    assert.equal(reopened.nodes.get('sheep-theme').value, theme);
  }
});
