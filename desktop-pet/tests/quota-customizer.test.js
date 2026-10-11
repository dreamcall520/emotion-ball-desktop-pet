const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('额度预览跟随实际周期，零与未知分开，双样式保存选择不受单周期影响', () => {
  const node = () => {
    const value = { children: [], dataset: {}, style: { setProperty() {} }, listeners: {}, className: '', _text: '',
      set textContent(text) { this._text = text; this.children = []; },
      get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this._text = ''; this.children = children; },
      setAttribute(name, text) { this[name] = text; }, addEventListener(name, callback) { this.listeners[name] = callback; },
      click() { this.listeners.click?.({ target: this }); },
      querySelector(selector) { for (const child of this.children) {
        if (child.className.split(' ').includes(selector.slice(1))) return child;
        const nested = child.querySelector(selector); if (nested) return nested;
      } return null; } };
    value.classList = { contains: name => value.className.split(' ').includes(name),
      toggle(name, on) { const names = new Set(value.className.split(' ')); on ? names.add(name) : names.delete(name); value.className = [...names].join(' '); },
      add(name) { this.toggle(name, true); } };
    return value;
  };
  const ids = new Map(), get = id => { if (!ids.has(id)) ids.set(id, node()); return ids.get(id); };
  const sources = ['demo', 'current'].map(quotaSource => Object.assign(node(), { dataset: { quotaSource } }));
  const materials = ['soft', 'glass'].map(quotaMaterial => Object.assign(node(), { dataset: { quotaMaterial } }));
  const presets = ['fiveHour', 'weekly'].flatMap(demoPeriod => ['100', '10', '0', 'unknown'].map(demoValue =>
    Object.assign(node(), { dataset: { demoPeriod, demoValue } })));
  const document = { hidden: false, documentElement: { dataset: {} }, getElementById: get, createElement: node,
    addEventListener() {}, removeEventListener() {}, querySelectorAll(selector) {
      return selector === '[data-quota-material]' ? materials : selector === '[data-quota-source]' ? sources
        : presets.filter(preset => selector === `[data-demo-period="${preset.dataset.demoPeriod}"]`);
    } };
  let receive, effectInput, reduce, avatars = 0, avatarDestroys = 0;
  const motion = { matches: false, addEventListener(_name, callback) { reduce = callback; }, removeEventListener() {} };
  const window = { matchMedia: () => motion,
    PetChatAvatar: { create: () => { avatars++; return { update() {}, setActive() {}, destroy() { avatarDestroys++; } }; } },
    QuotaEffects: { ...require('../quota-effects'), create: host => ({ update(input) { if (host === get('preview-ball')) effectInput = input; }, destroy() {} }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../quota-customizer.js'), 'utf8'), {
    window, document, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, QuotaDisplay: require('../lib/quota-display'), clearInterval() {}, setInterval() {}, performance: { now: () => 0 }
  });
  const ui = window.QuotaCustomizer.create({ bridge: { onQuota(callback) { receive = callback; return () => {}; } },
    getAppearance: () => ({ shape: 'blob', bodyColor: '#EEEBE4' }) });
  const weekly = { state: 'ready', items: [{ windowMinutes: 10080, remaining: 38 }] };
  ui.load({ style: 'ring', showNumbers: true, period: 'fiveHour' }, weekly);
  assert.equal(avatars, 0, '隐藏标签不初始化零尺寸 Rive');
  ui.show(true); sources[1].click();
  assert.equal(avatars, 6);
  for (const button of get('quota-styles').children) button.click();
  materials[1].click();
  assert.equal(avatars, 6, '切换样式和材质复用已绘制形象，不能重建留下空白');
  assert.equal(avatarDestroys, 0);
  get('quota-styles').children.find(button => button.dataset.style === 'ring').click();
  const numbers = get('stage').querySelector('.quota-preview-numbers');
  assert.equal(numbers.textContent, '周额度38%'); assert.equal(effectInput.config.period, 'weekly');
  assert.equal(ui.getConfig().period, 'both', '保存时不继续携带已删除的手选周期');
  assert.equal(numbers.classList.contains('quota-preview-card'), true);
  assert.equal(numbers.children[0].children[0].children[0].className, 'summary-badge');
  receive({ state: 'ready', items: [{ windowMinutes: 300, remaining: 0 }, ...weekly.items] });
  assert.equal(numbers.textContent, '5h额度0%'); assert.equal(effectInput.config.period, 'fiveHour');
  ui.load({ style: 'duo', showNumbers: true }, weekly);
  assert.equal(numbers.textContent, '周额度38%'); assert.equal(ui.getConfig().style, 'duo');
  receive({ ...weekly, state: 'stale' }); assert.equal(numbers.textContent, '周额度—');
  sources[0].click(); assert.equal(numbers.textContent, '5h74%周38%');
  presets.find(preset => preset.dataset.demoPeriod === 'fiveHour' && preset.dataset.demoValue === 'unknown').click();
  assert.equal(numbers.textContent, '周额度38%');
  assert.equal(get('quota-preview-state').hidden, true);
  assert.equal(get('quota-demo-note').textContent, '演示额度仅供预览，保存后应用样式');
  assert.equal(ids.has('quota-period'), false, '预览不再读取或注册周期下拉');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8'), /id="quota-period(?:-row|-both)?"/);
  motion.matches = true; reduce();
  assert.equal(get('quota-consume').disabled, true);
  assert.equal(get('quota-demo-note').textContent, '减少动态已开启，可拖动滑杆预览额度');
  get('stage').classList.add('dark'); ui.refresh();
  assert.equal(numbers.classList.contains('dark'), true);
  ui.destroy();
});
