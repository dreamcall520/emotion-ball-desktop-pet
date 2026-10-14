const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('额度预览跟随实际周期，零与未知分开，双样式保存选择不受单周期影响', () => {
  const node = () => {
    const value = { children: [], dataset: {}, style: { setProperty(name, value) { this[name] = value; } }, listeners: {}, className: '', _text: '',
      set textContent(text) { this._text = text; this.children = []; },
      get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this._text = ''; this.children = children; },
      setAttribute(name, text) { this[name] = text; }, addEventListener(name, callback) { this.listeners[name] = callback; },
      click() { this.listeners.click?.({ target: this }); },
      querySelector(selector) { for (const child of this.children) {
        if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName?.toLowerCase() === selector) return child;
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
  const document = { hidden: false, documentElement: { dataset: {} }, getElementById: get, createElement: tag => Object.assign(node(), {tagName:tag.toUpperCase()}),
    addEventListener() {}, removeEventListener() {}, querySelectorAll(selector) {
      return selector === '[data-quota-material]' ? materials : selector === '[data-quota-source]' ? sources
        : presets.filter(preset => selector === `[data-demo-period="${preset.dataset.demoPeriod}"]`);
    } };
  let receive, effectInput, reduce, avatars = 0, avatarDestroys = 0, avatarDescriptor, clock = 0, intervalId = 0, layouts = 0;
  const intervals = new Map(), avatarStates = [];
  let appearance = { shape: 'blob', bodyColor: '#EEEBE4' };
  const descriptor = { id: 'check-pet', imageURL: 'file:///check.png' };
  const motion = { matches: false, addEventListener(_name, callback) { reduce = callback; }, removeEventListener() {} };
  const window = { matchMedia: () => motion,
    PetChatAvatar: { create: () => { const index = avatars++; return { update(_appearance,_image,pet) { avatarDescriptor = pet; }, setActive(value) { avatarStates[index] = value; }, destroy() { avatarDestroys++; } }; } },
    QuotaEffects: { ...require('../quota-effects'), create: host => ({ update(input) { if (host === get('preview-ball')) effectInput = input; }, destroy() {} }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../quota-customizer.js'), 'utf8'), {
    window, document, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, QuotaDisplay: require('../lib/quota-display'),
    clearInterval: id => intervals.delete(id), setInterval: callback => { intervals.set(++intervalId, callback); return intervalId; }, performance: { now: () => clock }
  });
  const ui = window.QuotaCustomizer.create({ bridge: { onQuota(callback) { receive = callback; return () => {}; } },
    getAppearance: () => appearance, getCodexPet: () => appearance.shape === 'codex-pet' ? descriptor : undefined,
    onLayoutChange: () => layouts++ });
  const weekly = { state: 'ready', items: [{ windowMinutes: 10080, remaining: 38 }] };
  assert.equal(ui.getConfig().showNumbers, true, '新用户默认显示数字');
  ui.load({ style: 'ring', period: 'fiveHour' }, weekly);
  assert.equal(get('quota-numbers').checked, true, '旧设置缺字段时默认显示数字');
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
  get('quota-numbers').checked = false;
  get('quota-numbers').listeners.change({ target: get('quota-numbers') });
  const saved = ui.getConfig();
  ui.load(saved, weekly);
  assert.equal(get('quota-numbers').checked, false, '保存重开保留用户明确关闭');
  assert.equal(numbers.hidden, true);
  ui.load({ ...saved, showNumbers: true }, weekly);
  assert.equal(get('quota-numbers').checked, true);
  assert.equal(numbers.hidden, false);
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
  get('quota-consume').click();
  assert.equal(intervals.size, 1);
  clock = 1000; [...intervals.values()].forEach(callback => callback());
  const remaining = get('quota-output-weekly').textContent;
  ui.setWindowVisible(false);
  assert.equal(document.hidden, false, '原生隐藏信号独立于仍为 visible 的 DOM');
  assert.equal(intervals.size, 0, '原生隐藏停止实际消耗计时器');
  assert.equal(get('quota-consume').textContent, '▷ 播放消耗');
  assert.equal(effectInput.visible, false);
  assert.equal(avatarStates.every(active => !active), true);
  ui.appearanceChanged(); ui.show(true); get('quota-consume').click();
  assert.equal(intervals.size, 0, '隐藏时后续外观更新、标签切换和程序点击不能重新启动');
  assert.equal(effectInput.visible, false);
  assert.equal(avatarStates.every(active => !active), true);
  clock = 3000; [...intervals.values()].forEach(callback => callback());
  assert.equal(get('quota-output-weekly').textContent, remaining);
  ui.setWindowVisible(true);
  assert.equal(effectInput.visible, true);
  assert.equal(intervals.size, 0, '重显不自动恢复演示播放');
  assert.equal(get('quota-consume').textContent, '▷ 播放消耗');
  motion.matches = true; reduce();
  assert.equal(get('quota-consume').disabled, true);
  assert.equal(get('quota-demo-note').textContent, '减少动态已开启，可拖动滑杆预览额度');
  get('stage').classList.add('dark'); ui.refresh();
  assert.equal(numbers.classList.contains('dark'), true);
  appearance = { shape: 'codex-pet', codexPetId: descriptor.id }; ui.appearanceChanged();
  assert.equal(avatarDescriptor, descriptor, '精灵缩略图复用已有宠物描述，不额外读取用户目录');
  const poolButton = get('quota-styles').children.find(button => button.dataset.style === 'pool');
  assert.equal(poolButton.disabled, true);
  for (const style of ['ring','duo','split','stages']) {
    get('quota-styles').children.find(button => button.dataset.style === style).click();
    assert.equal(effectInput.config.style, style, 'Codex宠物保留所选圆环');
  }
  ui.load({ style: 'pool' }, weekly);
  assert.equal(effectInput.config.style, 'card'); assert.equal(ui.getConfig().style, 'pool', '保留切回球球的液态池偏好');
  appearance = { shape: 'blob', bodyColor: '#EEEBE4' }; ui.appearanceChanged();
  assert.equal(poolButton.disabled, false); assert.equal(effectInput.config.style, 'pool');
  for (const shape of ['blob','codex-pet']) for (const style of ['card','pool','ring','duo','split','stages']) {
    appearance = { shape };
    for (const cardSize of ['compact','standard']) for (const showNumbers of [false,true]) {
      ui.load({ style,cardSize,showNumbers },weekly);
      const effectiveStyle = shape === 'codex-pet' && style === 'pool' ? 'card' : style;
      const height = effectiveStyle === 'card' ? (cardSize === 'standard' ? 58 : 32) : showNumbers ? 32 : 0;
      for (const [width,stageHeight] of [[260,160],[300,240],[450,400]]) {
        get('stage').clientWidth = width; get('stage').clientHeight = stageHeight;
        for (const requested of [80,205,260,300]) {
          const pixels = ui.fitPreview(requested), offset = parseFloat(get('stage').style['--quota-preview-offset']);
          const top = stageHeight / 2 + offset - pixels / 2;
          const bottom = stageHeight / 2 + offset + pixels / 2 + (height ? 10 + height : 0);
          assert.ok(pixels > 0 && pixels <= requested && (width-pixels)/2 >= 16 && top >= 52 && bottom <= stageHeight-16,
            JSON.stringify({shape,style,cardSize,showNumbers,width,stageHeight,requested,pixels,top,bottom}));
        }
      }
      assert.equal(ui.getConfig().style,style,'预览缩放不修改用户选择');
    }
  }
  const stableLayouts = layouts; ui.refresh(); ui.refresh();
  assert.equal(layouts,stableLayouts,'相同包络的额度刷新不得触发头像重建');
  ui.show(false); assert.equal(ui.fitPreview(260),260,'离开额度页保留桌面实际尺寸预览');
  ui.destroy();
});

test('原生预览检查拒绝越界数字卡、隐藏卡和未绘制形象', async () => {
  const { assertQuotaPreviewBounds } = require('../scripts/verify-quota-display');
  const label = {left:26,right:154,top:160,bottom:192};
  const layout = {stage:{left:0,top:0,right:200,bottom:220},ball:{left:50,right:150,top:50,bottom:150},
    ready:true,expectedLabels:1,labels:[label]};
  const win = {isVisible:()=>true,webContents:{executeJavaScript:async()=>layout}};
  await assertQuotaPreviewBounds(win);
  label.bottom=221;await assert.rejects(assertQuotaPreviewBounds(win),/完整保留在预览框/);label.bottom=192;
  layout.labels=[];await assert.rejects(assertQuotaPreviewBounds(win),/不能隐藏越界卡/);layout.labels=[label];
  layout.ready=false;await assert.rejects(assertQuotaPreviewBounds(win),/实际绘制完成/);layout.ready=true;
  label.top=149;await assert.rejects(assertQuotaPreviewBounds(win),/10px预览间隔/);
});
