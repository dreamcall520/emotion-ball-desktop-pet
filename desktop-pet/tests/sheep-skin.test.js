const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { SHAPES, DEFAULT_APPEARANCE, DEFAULT_SHAPE_TUNING, normalizeAppearance } = require('../lib/customization');
const { saveSettings, loadSettings, findDuplicateAppearancePreset } = require('../lib/settings');
const { ACTIONS, MOTIONS, getActions, supportsAction, resolveAction, validateManifest } = require('../lib/sheep-skin');
const { prepareStaging } = require('../scripts/package-mac');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'desktop-pet/lib/sheep-skin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'desktop-pet/sheep-skin.css'), 'utf8');
const themeActions = Object.keys(ACTIONS);

test('羊年形态注册且固定插画配色、比例和眼睛设置', () => {
  assert.equal(SHAPES.filter(shape => shape === 'new-year-sheep').length, 1);
  const input = { shape: 'new-year-sheep', bodyColor: '#000000', eyeColor: '#FFFFFF',
    shapeTuning: { width: 1.25, height: 0.75, softness: 0, asymmetry: 1 },
    eyeScale: 1.25, eyeSpacing: 1.3, eyeHeight: 30, idleEyes: 'sleepy', auroraTransparency: 37 };
  const before = JSON.stringify(input);
  assert.deepEqual(normalizeAppearance(input), { ...DEFAULT_APPEARANCE,
    shape: 'new-year-sheep', bodyColor: '#FFF4E5', eyeColor: '#4E322A',
    shapeTuning: { ...DEFAULT_SHAPE_TUNING }, auroraTransparency: 37 });
  assert.equal(JSON.stringify(input), before, '不修改调用方的外观数据');
});

test('羊年透明度限制在 0 到 60，非法值回退，未知形态仍回退经典', () => {
  for (const [input, expected] of [[-1, 0], [0, 0], [37.6, 38], [60, 60], [99, 60], [NaN, 0], [Infinity, 0], ['40', 0], [undefined, 0]]) {
    assert.equal(normalizeAppearance({ shape: 'new-year-sheep', auroraTransparency: input }).auroraTransparency, expected);
  }
  assert.equal(normalizeAppearance({ shape: 'unknown' }).shape, DEFAULT_APPEARANCE.shape);
});

test('羊年当前外观、启动外观与预设保存后回读，保留旧形态预设', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-sheep-settings-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const file = path.join(temporary, 'settings.json');
  const appearance = normalizeAppearance({ shape: 'new-year-sheep', auroraTransparency: 23 });
  const preset = { id: '00000000-0000-4000-8000-000000000001', name: '羊年春节', appearance };
  const oldPreset = { id: '00000000-0000-4000-8000-000000000002', name: '原有方糖', appearance: { shape: 'square', bodyColor: '#123456' } };
  const saved = saveSettings(file, { customization: { appearance }, startupAppearance: appearance,
    appearancePresets: [preset, oldPreset] });
  const loaded = loadSettings(file);
  assert.deepEqual(loaded, saved);
  assert.deepEqual(loaded.customization.appearance, appearance);
  assert.deepEqual(loaded.startupAppearance, appearance);
  assert.deepEqual(loaded.appearancePresets[0], preset);
  assert.equal(loaded.appearancePresets[1].appearance.shape, 'square');
  assert.equal(loaded.appearancePresets[1].appearance.bodyColor, '#123456');
  assert.equal(findDuplicateAppearancePreset(loaded.appearancePresets, { ...appearance, bodyColor: '#000000' }).id, preset.id);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('基础四段动作和春节三段专属动作分开，旧请求显式复用现有片段', () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), ['greet','joy','sleep','walk']);
  assert.ok(Object.isFrozen(ACTIONS));
  for (const action of themeActions) {
    assert.equal(resolveAction(action), action);
    assert.ok(Number.isFinite(ACTIONS[action]) && ACTIONS[action] > 0);
  }
  for (const [motion, action] of Object.entries(MOTIONS)) assert.equal(resolveAction(motion), motion === 'stretch' ? 'stretch' : action);
  assert.equal(resolveAction('bow'), 'greet');
  assert.equal(resolveAction('proud'), 'joy');
  assert.equal(resolveAction('idle'), 'idle');
  assert.doesNotMatch(source, /new-year-sheep-parts|<svg|sheep-eye/);
  assert.doesNotMatch(css, /@keyframes|sheep-eye/);
});

test('非法动作和对象原型名称不会被解析为动作', () => {
  for (const invalid of ['unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null, undefined, 123, {}, []]) {
    assert.equal(resolveAction(invalid), null, String(invalid));
  }
});

test('打包 staging 保留清单的四十一张完整透明图集，无旧拼件依赖', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-sheep-package-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const staging = prepareStaging(root, path.join(temporary, 'app'));
  const manifestPath = 'desktop-pet/assets/sheep/manifest.json';
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8')));
  const files = ['desktop-pet/lib/sheep-offering.js', 'desktop-pet/assets/sheep/props/candy.png', 'desktop-pet/assets/sheep/props/gift.png', 'desktop-pet/lib/sheep-theme.js', 'desktop-pet/lib/sheep-skin.js', 'desktop-pet/sheep-skin.css', manifestPath];
  for (const theme of ['none','halloween','christmas','spring-festival']) {
    for (const [action, spec] of [...Object.entries(manifest.themes[theme].actions), ...['idleAlternate','idleTransition','workingTransition','sleepTransition'].filter(key=>manifest.themes[theme][key]).map(key=>[key,manifest.themes[theme][key]])]) {
      const relative = path.join('desktop-pet/assets/sheep', spec.file);
      files.push(relative);
      const png = fs.readFileSync(path.join(root, relative));
      assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 320 * spec.columns);
      assert.equal(png.readUInt32BE(20), 320 * Math.ceil(spec.durations.length / spec.columns));
      assert.ok([4,6].includes(png[25]), `${theme}/${action} 包含透明通道`);
      assert.ok(spec.durations.reduce((a,b)=>a+b,0) > 0, `${theme}/${action} 使用清单真实时长`);
    }
  }
  for (const relative of files) assert.deepEqual(fs.readFileSync(path.join(staging, relative)), fs.readFileSync(path.join(root, relative)), relative);
});

test('五个现有 engine 页面先加载羊年 CSS 和 renderer', () => {
  for (const file of ['index.html', 'customize.html', 'about.html', 'chat.html', 'codex-consent.html']) {
    const html = fs.readFileSync(path.join(root, 'desktop-pet', file), 'utf8');
    const engine = html.indexOf('src="../emotion-ball/js/engine.js"');
    const renderer = html.indexOf('src="lib/sheep-skin.js"');
    const helper = html.indexOf('src="lib/sheep-theme.js"');
    const style = html.indexOf('href="sheep-skin.css"');
    assert.ok(style >= 0 && helper > style && renderer > helper && engine > renderer, file);
    assert.equal(html.match(/src="lib\/sheep-skin\.js"/g).length, 1, `${file} 不重复加载`);
  }
});

test('主进程实际 sendCommand 只向羊年皮肤发送合法专属动作并保留原命令', () => {
  const main = fs.readFileSync(path.join(root, 'desktop-pet/main.js'), 'utf8');
  const declaration = main.match(/function sendCommand\(command\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(declaration, '应提取实际的 sendCommand 函数');
  const sent = [], stops = [];
  const settings = { customization: { appearance: { shape: 'new-year-sheep' } } };
  const context = vm.createContext({ settings, SheepSkin: { supportsAction }, SheepTheme: require('../lib/sheep-theme'), effectiveCustomization:value=>value,
    getMotion: require('../lib/interaction-motion').getMotion,
    petWindow: { isDestroyed: () => false, webContents: {
      send(channel, payload) { sent.push([channel, JSON.parse(JSON.stringify(payload))]); }
    } },
    stopMotion(options) { stops.push(JSON.parse(JSON.stringify(options))); }
  });
  vm.runInContext(declaration, context);
  for (const action of themeActions) {
    context.sendCommand({ command: 'sheep-action', action, extra: 'discard', motion: 'hop' });
    assert.deepEqual(sent.pop(), ['pet:command', { command: 'sheep-action', action }]);
  }
  for (const action of ['unknown', '__proto__', 'constructor', 'toString', '', null, undefined, {}, []]) {
    context.sendCommand({ command: 'sheep-action', action });
  }
  assert.equal(sent.length, 0, '拒绝未知、原型名称或非动作字段');
  for (const shape of ['blob', 'cloud', 'aurora-cloud', 'square', 'codex-pet']) {
    settings.customization.appearance.shape = shape;
    context.sendCommand({ command: 'sheep-action', action: 'greet' });
  }
  assert.equal(sent.length, 0, '其他皮肤不能接收羊年动作');
  context.sendCommand({ command: 'again', motion: 'hop', action: 'greet', extra: 'discard' });
  assert.deepEqual(sent.pop(), ['pet:command', { command: 'again', motion: 'hop' }]);
  context.sendCommand({ command: 'again', motion: '__proto__' });
  context.sendCommand({ command: 'unknown', action: 'greet' });
  assert.equal(sent.length, 0);
  context.sendCommand('wake');
  assert.deepEqual(sent.pop(), ['pet:command', 'wake']);
  for (const command of ['sleep', 'rest']) {
    context.sendCommand(command);
    assert.deepEqual(sent.pop(), ['pet:command', command]);
    assert.deepEqual(stops.pop(), { notifyRenderer: false });
  }
  context.petWindow = null;
  context.sendCommand('wake');
  assert.equal(sent.length, 0, '窗口关闭后不发送命令');
});

test('实际 setColorControlsEnabled 在保存或重载后保持羊年颜色锁定，切回普通形态解锁', () => {
  const renderer = fs.readFileSync(path.join(root, 'desktop-pet/customize-renderer.js'), 'utf8');
  const declaration = renderer.match(/function setColorControlsEnabled\(enabled\) \{[\s\S]*?\n  \}/)?.[0];
  const themeDeclaration = renderer.match(/function renderSheepTheme\(enabled = canSave\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(declaration, '应提取实际的控件权限函数');
  assert.ok(themeDeclaration, '应提取实际的小羊主题权限函数');
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, children: [{ disabled: false }], attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; } });
    return nodes.get(id);
  };
  const state = { appearance: { shape: 'new-year-sheep' } };
  const bindings = [['body-color', 'body-hex'], ['eye-color', 'eye-hex'], ['glow-pink-color', 'glow-pink-hex'], ['glow-gold-color', 'glow-gold-hex']];
  const pickerIds = ['color-hue', 'color-picker-hex', 'color-red', 'color-green', 'color-blue'];
  const palettes = ['body-swatches', 'eye-swatches', 'glow-pink-swatches', 'glow-gold-swatches', 'color-picker-presets'];
  const context = vm.createContext({ $, state, colorBindings: bindings,
    rangeLimits: { 'shape-width': [75, 125], 'eye-scale': [40, 125], 'aurora-transparency': [0, 60] },
    setPresetControlsEnabled() {}, closeColorPicker() {}
  });
  vm.runInContext(themeDeclaration + '\n' + declaration, context);
  const assertColorsDisabled = expected => {
    for (const id of [...bindings.flat(), ...pickerIds]) assert.equal($(id).disabled, expected, id);
    for (const id of palettes) for (const button of $(id).children) assert.equal(button.disabled, expected, id);
    assert.equal($('color-sv').attributes['aria-disabled'], String(expected));
    assert.equal($('color-sv').tabIndex, expected ? -1 : 0);
  };
  for (const enabled of [false, true, false, true]) {
    context.setColorControlsEnabled(enabled);
    assertColorsDisabled(true);
    assert.equal($('shape-width').disabled, true);
    assert.equal($('eye-scale').disabled, true);
    assert.equal($('aurora-transparency').disabled, !enabled, '透明度仍可用');
    assert.equal($('shape-options').children[0].disabled, !enabled, '仍可切回其他形态');
  }
  state.appearance.shape = 'blob';
  context.setColorControlsEnabled(true);
  assertColorsDisabled(false);
  assert.equal($('shape-width').disabled, false);
  assert.equal($('eye-scale').disabled, false);
  assert.equal($('aurora-transparency').disabled, false);
  context.setColorControlsEnabled(false);
  assertColorsDisabled(true);
});

function testManifest() {
  const themes = {};
  for (const theme of ['none','halloween','christmas','spring-festival']) {
    const actions = {};
    for (const action of ['idle', ...Object.keys(getActions(theme))]) actions[action] = { file: `${theme}/${action}.png`, columns: 2, durations: [100,200,300] };
    themes[theme] = { actions, ...(theme === 'none' ? {} : { staticFile: `${theme}/static.png` }) };
  }
  return { version: 1, width: 320, height: 320, themes };
}

test('清单边界拒绝目录越界、远程图片、空时间轴、非法尺寸和版本', () => {
  assert.equal(validateManifest(testManifest()).version, 1);
  for (const patch of [raw => { raw.version = 2; }, ...[-1,3,1.5,'1',null].map(value=>raw=>{raw.themes.christmas.actions['receive-gift'].resultFrame=value;}), raw => { raw.width = 640; },
    raw => { delete raw.themes['spring-festival'].actions.dumplings; }, raw => { delete raw.themes.christmas; }, raw => { delete raw.themes['spring-festival']; },
    raw => { raw.themes.none.actions.idle.file = '../escape.png'; },
    raw => { raw.themes.none.actions.idle.file = 'https://example.com/image.png'; },
    raw => { raw.themes.none.actions.idle.file = '/tmp/image.png'; },
    raw => { raw.themes.none.actions.idle.columns = 0; }, raw => { raw.themes.none.actions.idle.durations = []; },
    raw => { raw.themes.none.actions.idle.frameCount = 2; }, raw => { raw.themes.none.actions.idle.cellSize = 640; },
    raw => { raw.themes.christmas.staticFile = 'https://example.com/other.png'; },
    raw => { raw.themes.none.actions.idle.durations = [0]; }, raw => { raw.themes.none.actions.idle.durations = [100,Infinity]; },
    raw => { raw.themes.none.actions.idle.uprightRegions = []; },
    raw => { raw.themes.none.actions.idle.uprightRegions = raw.themes.none.actions.idle.durations.map(()=>[300,200,30,20]); },
    raw => { raw.themes.none.actions.idle.uprightRegions = raw.themes.none.actions.idle.durations.map(()=>[100,200,0,20]); },
    raw => { raw.themes.none.actions.idle.uprightRegions = raw.themes.none.actions.idle.durations.map(()=>[100.5,200,10,20]); }]) {
    const raw = testManifest(); patch(raw); assert.throws(() => validateManifest(raw));
  }
});

function rendererHarness({ random, reduced = false, deferImages = false, deferManifest = false, manifest = testManifest(), devicePixelRatio = 1, clientHeight = 32, ...options } = {}) {
  const timers = new Map(), frames = new Map(), intervals = new Map(), mediaListeners = new Set(), documentListeners = new Map();
  const drawn = [], transforms = [], imageRequests = [], requests = [];
  let sequence = 0, time = 0, calendar = new Date(2026,9,25,23,59).getTime(), calendarReads = 0;
  class LocalDate extends Date { constructor(...args) { if (!args.length) calendarReads++; super(...(args.length ? args : [calendar])); } }
  const context = { clearRect() {}, save() {}, restore() {},
    translate(...args) { transforms.push(['translate',...args]); }, scale(...args) { transforms.push(['scale',...args]); },
    drawImage(image,...args) { drawn.push({ url: image.src, args }); }
  };
  const element = () => ({ dataset: {}, attributes: {}, children: [], style: {},
    setAttribute(name,value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); child.parent = this; },
    getContext() { return context; },
    getBoundingClientRect() { return {left:0,top:0,width:320,height:320}; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
  });
  const media = { matches: reduced,
    addEventListener(name,callback) { mediaListeners.add(callback); }, removeEventListener(name,callback) { mediaListeners.delete(callback); }
  };
  class Request {
    constructor() { this.status = 200; this.responseText = JSON.stringify(manifest); requests.push(this); }
    open() {}
    send() { if (!deferManifest) queueMicrotask(() => this.onload()); }
  }
  class Picture {
    set src(value) {
      this.url = value; imageRequests.push(this);
      const pathname = new URL(value).pathname;
      const spec = Object.values(manifest.themes).flatMap(theme => [...Object.values(theme.actions),
        ...[theme.idleAlternate, theme.idleTransition, theme.workingTransition, theme.sleepTransition].filter(Boolean)]).find(item => pathname.endsWith('/'+item.file));
      this.naturalWidth = spec ? spec.columns * 320 : 1254; this.naturalHeight = spec ? Math.ceil(spec.durations.length/spec.columns) * 320 : 1254;
      if (!deferImages) queueMicrotask(() => this.onload?.());
    }
    get src() { return this.url; }
  }
  const window = { Image: Picture, XMLHttpRequest: Request, devicePixelRatio, performance: { now: () => time }, matchMedia: () => media,
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id,callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback,ms) { const id = ++sequence; timers.set(id,{ callback,due:time+ms,ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback,ms) { const id = ++sequence; intervals.set(id,{callback,ms}); return id; },
    clearInterval(id) { intervals.delete(id); }
  };
  const document = { hidden: false, defaultView: window,
    currentScript: { src: pathToFileURL(path.join(root,'desktop-pet/lib/sheep-skin.js')).href }, createElement: element,
    addEventListener(name,callback) { documentListeners.set(name,callback); },
    removeEventListener(name,callback) { if (documentListeners.get(name) === callback) documentListeners.delete(name); }
  };
  const target = element(); target.ownerDocument = document; document.querySelector = () => target;
  let randomReads = 0;
  const localMath = Object.create(Math);
  localMath.random = () => { randomReads++; return random ? random() : Math.random(); };
  const vmContext = vm.createContext({ window,document,URL,Date:LocalDate,Math:localMath });
  vm.runInContext(fs.readFileSync(path.join(root,'desktop-pet/lib/sheep-theme.js'),'utf8'),vmContext);
  vm.runInContext(fs.readFileSync(path.join(root,'desktop-pet/lib/christmas-buddy-rotation.js'),'utf8'),vmContext);
  vm.runInContext(source,vmContext);
  target.clientHeight = clientHeight;
  const api = window.SheepSkin.create(target,options);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  function advance(ms) {
    time += ms;
    for (const [id,timer] of [...timers]) if (timer.due <= time && timers.has(id)) { timers.delete(id); timer.callback(); }
    for (const id of [...frames.keys()]) { const callback = frames.get(id); if (callback) { frames.delete(id); callback(time); } }
  }
  return { api,node:target.children[0],target,drawn,transforms,timers,frames,intervals,media,mediaListeners,document,documentListeners,imageRequests,requests,flush,advance,window,context,
    recreate: extra => window.SheepSkin.create(target,{...options,...extra}),
    randomReads: () => randomReads, calendarReads: () => calendarReads, setDate(date) { calendar = date.getTime(); }, calendarTick() { for (const {callback} of intervals.values()) callback(); }
  };
}

test('完整帧按原时间轴绘制，不重画眼睛；同动作重启，停止与宿主完成均回到状态', async () => {
  const h = rendererHarness();
  await h.flush(); assert.equal(await h.api.whenReady(),true);
  assert.equal(h.node.attributes.role,'img'); assert.equal(h.node.width,320); assert.equal(h.node.height,320);
  assert.equal(h.node.dataset.action,'idle'); assert.equal(h.node.dataset.frame,'0');
  h.advance(100); assert.equal(h.node.dataset.frame,'1');
  h.advance(200); assert.equal(h.node.dataset.frame,'2');
  const count = h.drawn.length; h.api.setGaze(20,20).clearGaze(); assert.equal(h.drawn.length,count);
  h.api.setMotionAction('greet'); await h.flush(); h.advance(150); assert.equal(h.node.dataset.frame,'1');
  h.api.setMotionAction('greet'); await h.flush(); assert.equal(h.node.dataset.frame,'0'); assert.equal(h.timers.size,1);
  h.api.setMotionAction('__proto__'); assert.equal(h.node.dataset.action,'greet');
  h.api.stopMotion(); await h.flush(); assert.equal(h.node.dataset.action,'idle'); assert.equal(h.timers.size,0);
  h.api.setMotionAction('nuzzle','user'); await h.flush();
  h.advance(1000); assert.equal(h.node.dataset.action,'greet'); assert.equal(h.timers.size,0,'宿主动作用done结束，不按短片时长抢先归位');
  h.api.setMotionFrame({done:true}); await h.flush(); assert.equal(h.node.dataset.action,'idle');
  const emotions = []; h.api.on('change',event=>emotions.push(event.id));
  h.api.setEmotion('00'); await h.flush(); assert.equal(h.node.dataset.action,'sleep'); assert.deepEqual(emotions,['00']);
  assert.equal(h.api.getActionDuration('__proto__'),0);
  h.api.destroy();
});

test('暂停保留原帧与剩余时长，恢复后仅一套时钟，有限动作发出完成事件', async () => {
  const h = rendererHarness(); const events = [];
  h.api.on('motionend',event=>events.push(event)); await h.flush();
  h.api.setMotionAction('joy'); await h.flush();
  assert.equal(h.api.getActionDuration('joy'),600);
  const stale = [...h.timers.values()][0].callback;
  h.advance(150); h.api.setActive(false);
  assert.equal(h.node.dataset.frame,'1'); assert.equal(h.frames.size,0); assert.equal(h.timers.size,0);
  h.advance(5000); assert.equal(h.node.dataset.frame,'1'); assert.equal(events.length,0);
  h.api.setActive(true); assert.equal(h.frames.size,1); assert.equal(h.timers.size,1);
  assert.equal([...h.timers.values()][0].ms,450);
  stale(); assert.equal(events.length,0,'暂停前已排队的旧完成回调不能中断恢复后的动作');
  h.api.setActive(true); assert.equal(h.frames.size,1); assert.equal(h.timers.size,1);
  h.advance(450); await h.flush(); assert.equal(events.length,1); assert.equal(events[0].action,'joy'); assert.equal(h.node.dataset.action,'idle');
  h.api.destroy();
});

test('减少动态、静态预览、隐藏和朝向不产生额外变形或失控时钟', async () => {
  const h = rendererHarness({autostart:false,auroraTransparency:60}); await h.flush();
  assert.equal(h.node.style.opacity,'0.4'); assert.equal(h.frames.size,0);
  h.api.setActive(true).setMotionAction('walk'); await h.flush(); h.transforms.length=0;h.api.setFacing('left');
  assert.equal(h.transforms.some(row=>row[0]==='scale'),false,'原画朝左，无需再镜像');
  h.api.setFacing('right');assert.ok(h.transforms.some(row=>row[0]==='scale' && row[1]===-1));
  h.media.matches=true; for(const callback of h.mediaListeners) callback();
  assert.equal(h.frames.size,0); assert.equal(h.node.dataset.frame,'0'); assert.equal(h.node.dataset.reduced,'true');
  h.advance(600); await h.flush(); assert.equal(h.node.dataset.action,'idle','减少动态仍完成动作生命周期');
  h.media.matches=false; for(const callback of h.mediaListeners) callback(); assert.equal(h.frames.size,1);
  h.document.hidden=true; h.documentListeners.get('visibilitychange')(); assert.equal(h.frames.size,0);
  h.document.hidden=false; h.documentListeners.get('visibilitychange')(); assert.equal(h.frames.size,1);
  h.api.renderStatic(); await h.flush(); assert.equal(h.frames.size,0); assert.equal(h.timers.size,0); assert.equal(h.node.dataset.frame,'0');
  h.api.destroy();
});

test('自动主题跨日更新暂停头像，恢复立即重算，手动主题不随日历切换', async () => {
  const h = rendererHarness({sheepTheme:'auto',autostart:false}); await h.flush();
  assert.equal(h.node.dataset.theme,'none'); assert.equal(h.intervals.size,1); assert.equal([...h.intervals.values()][0].ms,60000);
  h.setDate(new Date(2026,9,26)); h.calendarTick(); await h.flush();
  assert.equal(h.node.dataset.theme,'halloween'); assert.match(h.drawn.at(-1).url,/halloween\/idle\.png$/); assert.equal(h.frames.size,0);
  h.setDate(new Date(2026,10,1)); h.api.setActive(true); await h.flush(); assert.equal(h.node.dataset.theme,'none');
  const reads = h.calendarReads(); for(let i=0;i<12;i++) { h.advance(16); h.api.setActive(true); }
  assert.equal(h.calendarReads(),reads,'播放帧和重复激活采样不重复读取日历');
  h.api.setActive(false); h.setDate(new Date(2026,11,20)); h.calendarTick(); await h.flush(); assert.equal(h.node.dataset.theme,'christmas');
  h.setDate(new Date(2027,1,1)); h.calendarTick(); await h.flush();
  assert.equal(h.node.dataset.theme,'spring-festival'); assert.match(h.drawn.at(-1).url,/spring-festival\/idle\.png$/);
  h.setDate(new Date(2027,1,20,23,59)); h.calendarTick(); await h.flush(); assert.equal(h.node.dataset.theme,'spring-festival');
  h.setDate(new Date(2027,1,21)); h.calendarTick(); await h.flush(); assert.equal(h.node.dataset.theme,'none');
  h.api.destroy(); assert.equal(h.intervals.size,0);
  const manual = rendererHarness({sheepTheme:'halloween'}); await manual.flush(); manual.setDate(new Date(2027,0,1)); manual.calendarTick(); manual.api.setActive(false).setActive(true);
  await manual.flush(); assert.equal(manual.node.dataset.theme,'halloween'); assert.equal(manual.intervals.size,0); manual.api.destroy();
});

test('清单未就绪时安静待机长度为3220ms，就绪后以主题清单为准', async () => {
  const h = rendererHarness({ deferManifest: true, sheepTheme: 'spring-festival' });
  assert.equal(h.api.getActionDuration('idle'), 3220);
  h.requests[0].onload(); await h.flush();
  assert.equal(h.api.getActionDuration('idle'), 600);
  h.api.destroy();
});

test('新请求不会被旧加载覆盖；销毁前后的异步加载都不能复活画布或计时器', async () => {
  const h = rendererHarness({deferImages:true,sheepTheme:'auto'}); await h.flush();
  const idle = h.imageRequests[0];
  h.api.setMotionAction('walk'); await h.flush(); const walk = h.imageRequests[1];
  walk.onload(); await h.flush(); assert.equal(h.node.dataset.action,'walk'); assert.match(h.drawn.at(-1).url,/walk\.png$/);
  idle.onload(); await h.flush(); assert.match(h.drawn.at(-1).url,/walk\.png$/);
  h.api.setMotionAction('joy'); await h.flush(); const joy = h.imageRequests[2], count = h.drawn.length;
  h.api.destroy(); joy.onload(); await h.flush();
  assert.equal(h.drawn.length,count); assert.equal(h.target.children.length,0); assert.equal(h.frames.size,0); assert.equal(h.timers.size,0); assert.equal(h.intervals.size,0);
  assert.equal(h.mediaListeners.size,0); assert.equal(h.documentListeners.size,0);
  h.api.setMotionAction('greet').setActive(true); await h.flush(); assert.equal(h.frames.size,0);
  const early = rendererHarness({deferManifest:true}); early.api.destroy(); early.requests[0].onload(); await early.flush();
  assert.equal(await early.api.whenReady(),false); assert.equal(early.imageRequests.length,0);
});

test('资源失败明确暴露错误并释放动作占用，不用旧拼件冒充新造型', async () => {
  const h = rendererHarness({deferImages:true}); const errors = [], ends = [];
  h.api.on('error',error=>errors.push(error)).on('motionend',event=>ends.push(event));
  h.api.setMotionAction('greet'); await h.flush();
  h.imageRequests.at(-1).onerror(); await h.flush();
  h.imageRequests.at(-1).onerror(); await h.flush();
  assert.equal(await h.api.whenReady(),false); assert.equal(h.node.dataset.ready,'error'); assert.equal(errors.length,1); assert.equal(ends[0].reason,'error');
  assert.equal(h.drawn.length,0); assert.equal(h.frames.size,0); assert.equal(h.timers.size,0); h.api.destroy();
});

test('主题按万圣节脸与身体校准，帽顶高度不再决定羊的体量', async () => {
  for (const [sheepTheme, fit, foot] of [['none', .844, 304], ['halloween', 1, 303], ['christmas', 1, 303], ['spring-festival', .893, 298]]) {
    const h=rendererHarness({sheepTheme});await h.flush();
    const [,top,width,height]=h.drawn.at(-1).args.slice(-4);
    assert.equal(width,320*fit);assert.equal(height,width);
    assert.ok(Math.abs(top+foot*fit-303)<1e-9,'脚底基线保持一致');
    h.api.destroy();
  }
});

test('节日图集失败仍可显示已确认1254px静态造型，保持错误可见且不冒充动画', async () => {
  const h = rendererHarness({deferImages:true,sheepTheme:'christmas'}), errors = [];
  h.api.on('error',error=>errors.push(error)); await h.flush();
  h.imageRequests[0].onerror(); await h.flush();
  assert.match(h.imageRequests[1].src,/christmas\/static\.png$/);
  h.imageRequests[1].onload(); await h.flush();
  assert.equal(await h.api.whenReady(),true); assert.equal(errors.length,1); assert.equal(h.node.dataset.ready,'static');
  assert.deepEqual(h.drawn.at(-1).args,[0,0,1254,1254,0,0,320,320]);
  assert.equal(h.frames.size,0); assert.equal(h.timers.size,0); h.api.destroy();
  const failed = rendererHarness({deferManifest:true}); failed.requests[0].status=404; failed.requests[0].onload(); await failed.flush();
  assert.equal(await failed.api.whenReady(),false); assert.equal(failed.imageRequests.length,0); failed.api.destroy();
  const removed = rendererHarness({deferImages:true,sheepTheme:'halloween'}); await removed.flush();
  removed.imageRequests[0].onerror(); await removed.flush(); removed.api.destroy(); removed.imageRequests[1].onload(); await removed.flush();
  assert.equal(await removed.api.whenReady(),false); assert.equal(removed.drawn.length,0); assert.equal(removed.target.children.length,0);
});

test('春节专属动作只在春节解析为真实片段，普通fortune仍兼容旧问好', async () => {
  for (const theme of ['none','halloween','christmas']) {
    assert.equal(Object.keys(getActions(theme)).length,theme === 'christmas' ? 10 : 9);
    for (const action of ['fortune','firecrackers','dumplings']) assert.equal(supportsAction(action,theme),false);
    assert.equal(resolveAction('fortune',theme),'greet');
    assert.equal(resolveAction('firecrackers',theme),null);
    assert.equal(resolveAction('dumplings',theme),null);
  }
  assert.equal(Object.keys(getActions('spring-festival')).length,9);
  for (const action of ['fortune','firecrackers','dumplings']) {
    assert.equal(supportsAction(action,'spring-festival'),true);
    assert.equal(resolveAction(action,'spring-festival'),action);
    const h=rendererHarness({sheepTheme:'spring-festival'}), ends=[];
    h.api.on('motionend',value=>ends.push(value)); await h.flush();
    assert.equal(h.node.dataset.action,'idle','不会自动触发节日互动');
    h.api.setMotionAction(action); await h.flush();
    assert.match(h.drawn.at(-1).url,new RegExp(`spring-festival/${action}\\.png$`));
    assert.equal(h.api.getActionDuration(action),600);
    h.advance(600); await h.flush();
    assert.equal(ends.length,1); assert.equal(ends[0].action,action); assert.equal(h.node.dataset.action,'idle');
    h.api.destroy();
  }
});

test('自动换下春节主题会结束专属互动并回到安静待机', async () => {
  const h=rendererHarness({sheepTheme:'auto'}), ends=[];
  h.api.on('motionend',value=>ends.push(value)); await h.flush();
  h.setDate(new Date(2027,1,6)); h.calendarTick(); await h.flush();
  h.api.setMotionAction('dumplings'); await h.flush(); assert.equal(h.node.dataset.action,'dumplings');
  h.setDate(new Date(2027,1,20,23,59)); h.calendarTick(); await h.flush();
  assert.equal(h.node.dataset.theme,'spring-festival'); assert.equal(h.node.dataset.action,'dumplings'); assert.equal(ends.length,0);
  h.setDate(new Date(2027,1,21)); h.calendarTick(); await h.flush();
  assert.equal(h.node.dataset.theme,'none'); assert.equal(h.node.dataset.action,'idle');
  assert.equal(ends.length,1); assert.equal(ends[0].reason,'theme-change'); assert.equal(h.timers.size,0);
  h.api.setMotionAction('dumplings'); await h.flush(); assert.equal(h.node.dataset.action,'idle');
  h.api.destroy();
});


test('朝右只镜像角色，当前帧的有向符号在镜像位置保持正向', async () => {
  const manifest=testManifest(),clip=manifest.themes.christmas.actions.complete;
  clip.uprightRegions=clip.durations.map(()=>[130,220,40,30]);
  const h=rendererHarness({sheepTheme:'christmas',manifest,autostart:false});await h.flush();
  h.api.setMotionAction('complete','user');await h.flush();
  h.drawn.length=0;h.api.setFacing('right');
  assert.equal(h.drawn.length,2,'整只镜像后仅回正符号区域');
  assert.deepEqual(h.drawn[1].args,[130,220,40,30,150,220,40,30]);
  h.drawn.length=0;h.api.setFacing('left');assert.equal(h.drawn.length,1,'原朝向直接使用原画');
  h.api.destroy();
});

test('所有主题原画朝左，朝右镜像角色，不叠加CSS镜像', async () => {
  for (const sheepTheme of ['none','halloween','christmas','spring-festival']) {
    const h=rendererHarness({sheepTheme,autostart:false}); await h.flush();
    for (const action of ['idle', ...Object.keys(getActions(sheepTheme))]) {
      if(action==='idle')h.api.renderStatic();else h.api.setMotionAction(action,'user');
      await h.flush();
      h.transforms.length=0;h.api.setFacing('left');
      assert.equal(h.transforms.some(row=>row[0]==='scale'),false,sheepTheme+'/'+action+' 朝左保留原画');
      h.transforms.length=0;h.api.setFacing('right');
      assert.equal(h.transforms.some(row=>row[0]==='scale'&&row[1]===-1),true,sheepTheme+'/'+action+' 朝右镜像角色');
      assert.equal(h.node.style.transform,undefined,'不叠加CSS镜像');
    }
    h.api.destroy();
  }
});

test('加载失败的静态回退仍跟随朝向，包含无主题首帧和节日大图', async () => {
  for(const sheepTheme of ['none','christmas']) {
    const h=rendererHarness({sheepTheme,deferImages:true,autostart:false}); await h.flush();
    h.imageRequests[0].onerror();await h.flush();
    h.api.setFacing('right');h.transforms.length=0;h.imageRequests[1].onload();await h.flush();
    assert.equal(h.node.dataset.ready,'static');assert.equal(h.node.dataset.frame,'static');
    assert.ok(h.transforms.some(row=>row[0]==='scale'&&row[1]===-1));
    h.transforms.length=0;h.api.setFacing('left');assert.equal(h.transforms.length,0,'朝左回退图保持原画');
    assert.ok(h.drawn.length>1,'已显示的静态回退即时重新绘制方向');
    h.api.destroy();
  }
});


test('实际renderer把羊的左右方向原样交给播放器，幻彩专属反向不作用到羊', () => {
  const renderer=fs.readFileSync(path.join(root,'desktop-pet/renderer.js'),'utf8');
  const declaration=renderer.match(/function visualFacing\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(declaration);
  const c=vm.createContext({facing:'left',customization:{appearance:{shape:'new-year-sheep'}},presentationMode:'free'});
  vm.runInContext(declaration,c);
  for(const mode of ['free','tucked','peeked'])for(const side of ['left','right']) {
    c.presentationMode=mode;c.facing=side;assert.equal(c.visualFacing(),side,mode+'/'+side);
  }
  c.customization.appearance.shape='aurora-cloud';c.presentationMode='free';c.facing='left';assert.equal(c.visualFacing(),'right');
});

test('四主题各九个真实动作，主题专属不得串用，工作与完成分开', async () => {
  const extras={none:['ear','bell','stretch'],halloween:['candy','magic','pumpkin'],christmas:['gift','scarf','snow'],'spring-festival':['fortune','firecrackers','dumplings']};
  for(const [theme,actions] of Object.entries(extras)) {
    assert.equal(Object.keys(getActions(theme)).length,theme === 'christmas' ? 10 : 9);
    const h=rendererHarness({sheepTheme:theme}); await h.flush();
    for(const action of [...actions,'working','complete']) {
      assert.equal(supportsAction(action,theme),true);
      h.api.setMotionAction(action); await h.flush();
      assert.equal(h.node.dataset.action,action);
      assert.equal(h.api.getActionDuration(action),600,'读取真实片段时长');
      h.advance(600); await h.flush();
      assert.equal(h.node.dataset.action,'idle');
    }
    for(const [other,ids] of Object.entries(extras)) if(other!==theme) for(const action of ids) assert.equal(supportsAction(action,theme),false);
    h.api.setEmotion('51'); await h.flush(); assert.equal(h.node.dataset.action,'working');
    h.api.setEmotion('50'); await h.flush(); assert.equal(h.node.dataset.action,'idle');
    for(const motion of ['hop','spin']) {
      h.api.setMotionAction(motion,'codex'); await h.flush(); assert.equal(h.node.dataset.action,'complete');
      assert.equal(h.api.getActionDuration(motion,'codex'),600);
      h.api.setMotionAction(motion,'user'); await h.flush(); assert.equal(h.node.dataset.action,'joy');
    }
    h.api.destroy();
  }
});

test('当前片段就绪Promise只在真实图集加载后完成，错误返回false',async()=>{
  const h=rendererHarness({deferImages:true}); await h.flush();
  h.imageRequests[0].onload(); await h.flush(); assert.equal(await h.api.whenMotionReady(),true);
  h.api.setMotionAction('complete','codex'); await h.flush();
  let settled=false; const ready=h.api.whenMotionReady().then(value=>{settled=true;return value;});
  await h.flush(); assert.equal(settled,false);
  h.imageRequests.at(-1).onload(); await h.flush(); assert.equal(await ready,true);
  h.api.setMotionAction('ear'); await h.flush(); const bad=h.api.whenMotionReady();
  h.imageRequests.at(-1).onerror(); await h.flush(); assert.equal(await bad,false);
  h.api.destroy();
});


test('工作区左半边的羊朝右、右半边朝左，负坐标屏幕也朝中心', async () => {
  const {resolve}=require('../lib/pet-facing');
  for(const area of [{x:0,width:1280},{x:-1920,width:1920}]) {
    const h=rendererHarness({autostart:false});await h.flush();
    for(const [fraction,expectedFacing,expectedMirror] of [[.15,'right',true],[.8,'left',false]]) {
      const bounds={x:area.x+area.width*fraction,width:180};
      const direction=resolve(bounds,area);assert.equal(direction,expectedFacing);
      h.transforms.length=0;h.api.setFacing(direction);
      assert.equal(h.transforms.some(row=>row[0]==='scale'&&row[1]===-1),expectedMirror,'朝中心的语义必须和朝左原图一致');
    }
    h.api.destroy();
  }
});


test('receive-gift为圣诞独立真实片段，低动态接收展示抱礼物结果、糖展示开心结果',async()=>{
  assert.equal(supportsAction('receive-gift','christmas'),true);for(const theme of ['none','halloween','spring-festival'])assert.equal(supportsAction('receive-gift',theme),false);
  for(const [theme,action,frame] of [['christmas','receive-gift','2'],['halloween','candy','1']]) {
    const h=rendererHarness({reduced:true,sheepTheme:theme});await h.flush();h.api.setMotionAction(action);await h.flush();assert.equal(h.node.dataset.action,action);assert.equal(h.node.dataset.frame,frame);assert.equal(h.frames.size,0);h.advance(600);await h.flush();assert.equal(h.node.dataset.action,'idle');h.api.destroy();
  }
});


test('低动态收礼用指定抱礼帧，不能误用收好礼物后的待机末帧',async()=>{
  const manifest=testManifest();manifest.themes.christmas.actions['receive-gift'].resultFrame=1;
  const h=rendererHarness({manifest,reduced:true,sheepTheme:'christmas'});await h.flush();
  h.api.setMotionAction('receive-gift');await h.flush();assert.equal(h.node.dataset.frame,'1');
  assert.equal(h.frames.size,0);h.api.destroy();
});


function alternateManifest() {
  const manifest = testManifest();
  for (const theme of ['none', 'spring-festival']) {
    manifest.themes[theme].actions.idle.durations = [2600,120,500];
    manifest.themes[theme].idleAlternate = { file: `${theme}/idle-alternate.png`, columns: 3,
      cellSize: 320, frameCount: 3, durations: [2600,120,500] };
  }
  return manifest;
}

test('可选B待机共用完整图集校验，拒绝畸形路径/时间轴/尺寸/符号范围/不等长', () => {
  assert.equal(validateManifest(alternateManifest()).themes.none.idleAlternate.frameCount, 3);
  const patches = [
    theme => { theme.idleAlternate = null; }, theme => { theme.idleAlternate = 'none/idle-alternate.png'; },
    theme => { theme.idleAlternate.file = '../escape.png'; }, theme => { theme.idleAlternate.file = '/tmp/a.png'; },
    theme => { theme.idleAlternate.file = 'https://example.com/a.png'; },
    theme => { theme.idleAlternate.columns = 0; }, theme => { theme.idleAlternate.columns = 17; },
    theme => { theme.idleAlternate.durations = []; }, theme => { theme.idleAlternate.durations = [0]; },
    theme => { theme.idleAlternate.durations = [Infinity]; }, theme => { theme.idleAlternate.durations = [60001]; },
    theme => { theme.idleAlternate.durations = [2600,120,501]; },
    theme => { theme.idleAlternate.frameCount = 2; }, theme => { theme.idleAlternate.cellSize = 640; },
    theme => { theme.idleAlternate.uprightRegions = []; },
    theme => { theme.idleAlternate.uprightRegions = [[300,300,30,30],null,null]; },
    theme => { theme.idleAlternate.uprightRegions = [[1.5,2,3,4],null,null]; },
    theme => { theme.idleAlternate.uprightRegions = [[1,2,0,4],null,null]; }
  ];
  for (const patch of patches) { const manifest=alternateManifest(); patch(manifest.themes.none); assert.throws(()=>validateManifest(manifest)); }
  for (const theme of ['none','halloween','christmas','spring-festival']) {
    assert.equal(supportsAction('idle-alternate',theme),false);
    assert.equal(resolveAction('idleAlternate',theme),null);
  }
  assert.equal(['none','halloween','christmas','spring-festival'].reduce((sum,theme)=>sum+1+Object.keys(getActions(theme)).length,0),41);
});

test('A默认、非idle自然回位才各50%抽B，保持当前姿态且沿用真实idle时长',async()=>{
  for (const sheepTheme of ['none','spring-festival']) {
    const values=[.49,.5,.1];
    const h=rendererHarness({manifest:alternateManifest(),sheepTheme,random:()=>values.shift()});await h.flush();
    assert.equal(h.node.dataset.idlePose,'primary');assert.equal(h.randomReads(),0);
    assert.match(h.drawn.at(-1).url,/\/idle\.png$/);assert.equal(h.api.getActionDuration('idle'),3220);
    h.advance(100000);await h.flush();assert.equal(h.randomReads(),0,'不添加轮换定时器');
    h.api.setMotionAction('greet');await h.flush();assert.equal(h.node.dataset.action,'greet');
    h.advance(600);await h.flush();assert.equal(h.node.dataset.action,'idle');assert.equal(h.node.dataset.idlePose,'alternate');
    assert.match(h.drawn.at(-1).url,/\/idle-alternate\.png$/);assert.equal(h.api.getActionDuration('idle'),3220);
    assert.equal(h.randomReads(),1);assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);
    h.advance(2600);assert.equal(h.node.dataset.frame,'1');
    h.api.setActive(false);const pausedFrame=h.node.dataset.frame;h.advance(10000);h.api.setFacing('left').resize().setFacing('right').setActive(true);
    assert.equal(h.node.dataset.frame,pausedFrame);assert.equal(h.node.dataset.idlePose,'alternate');assert.equal(h.randomReads(),1);
    h.api.setEmotion('50');await h.flush();assert.equal(h.randomReads(),1,'重复待机状态不重抽');
    h.api.setMotionAction('complete','codex');await h.flush();h.advance(10000);await h.flush();assert.equal(h.node.dataset.action,'complete');
    h.api.setMotionFrame({done:true});await h.flush();assert.equal(h.node.dataset.idlePose,'primary');assert.equal(h.randomReads(),2);
    h.api.setEmotion('51');await h.flush();h.advance(10000);await h.flush();assert.equal(h.node.dataset.action,'working');assert.equal(h.randomReads(),2);
    h.api.setEmotion('50');await h.flush();assert.equal(h.node.dataset.idlePose,'alternate');assert.equal(h.randomReads(),3);
    h.api.destroy();
  }
});

test('B待机不打断睡眠/工作，静态预览始终A，暂停/隐藏回位不重抽',async()=>{
  const h=rendererHarness({manifest:alternateManifest(),random:()=>0});await h.flush();
  h.api.setEmotion('00');await h.flush();h.advance(9000);assert.equal(h.node.dataset.action,'sleep');assert.equal(h.randomReads(),0);
  h.api.setEmotion('50');await h.flush();assert.equal(h.node.dataset.idlePose,'alternate');assert.equal(h.randomReads(),1);
  h.document.hidden=true;h.documentListeners.get('visibilitychange')();h.advance(30000);
  h.document.hidden=false;h.documentListeners.get('visibilitychange')();assert.equal(h.node.dataset.idlePose,'alternate');assert.equal(h.randomReads(),1);
  h.api.renderStatic();await h.flush();assert.equal(h.node.dataset.idlePose,'primary');assert.match(h.drawn.at(-1).url,/\/idle\.png$/);
  h.api.setMotionAction('joy');await h.flush();h.api.stopMotion();await h.flush();assert.equal(h.node.dataset.idlePose,'primary');assert.equal(h.randomReads(),1,'静态预览不抽签');
  h.api.setActive(true);assert.equal(h.node.dataset.idlePose,'primary');assert.equal(h.randomReads(),1);
  h.api.destroy();
});

test('B待机加载仍有代次隔离与符号回正，加载中工作不会被旧B覆盖',async()=>{
  const manifest=alternateManifest();manifest.themes.none.idleAlternate.uprightRegions=[[130,220,40,30],null,null];
  const h=rendererHarness({manifest,random:()=>0,deferImages:true});await h.flush();h.imageRequests[0].onload();await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.imageRequests.at(-1).onload();await h.flush();h.advance(600);await h.flush();
  const alternate=h.imageRequests.at(-1);assert.match(alternate.src,/idle-alternate\.png$/);
  h.api.setEmotion('51');await h.flush();h.imageRequests.at(-1).onload();await h.flush();alternate.onload();await h.flush();
  assert.equal(h.node.dataset.action,'working');assert.match(h.drawn.at(-1).url,/working\.png$/);
  h.api.setEmotion('50');await h.flush();assert.equal(h.node.dataset.idlePose,'alternate');
  h.drawn.length=0;h.api.setFacing('right');assert.equal(h.drawn.length,2);assert.deepEqual(h.drawn[1].args,[130,220,40,30,151.56,232.10400000000004,33.76,25.32]);
  h.api.destroy();
});

test('打包staging透传两个可选B图集，API仍只有原41个动作',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sheep-alternate-package-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const fixtureRoot=prepareStaging(root,path.join(temporary,'source'));
  const manifestPath=path.join(fixtureRoot,'desktop-pet/assets/sheep/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath));
  for(const theme of ['none','spring-festival']) {
    const spec=manifest.themes[theme].actions.idle;
    manifest.themes[theme].idleAlternate={...spec,file:`${theme}/idle-alternate.png`};
    fs.copyFileSync(path.join(fixtureRoot,'desktop-pet/assets/sheep',spec.file),path.join(fixtureRoot,'desktop-pet/assets/sheep',manifest.themes[theme].idleAlternate.file));
  }
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const staged=prepareStaging(fixtureRoot,path.join(temporary,'staged'));
  for(const theme of ['none','spring-festival']) {
    const relative=path.join('desktop-pet/assets/sheep',manifest.themes[theme].idleAlternate.file);
    assert.deepEqual(fs.readFileSync(path.join(staged,relative)),fs.readFileSync(path.join(fixtureRoot,relative)));
  }
});

function transitionManifest() {
  const manifest=alternateManifest();
  for(const theme of ['none','spring-festival']) {
    const data=manifest.themes[theme];
    data.idleTransition={file:`${theme}/idle-transition.png`,columns:5,frameCount:5,cellSize:320,durations:[70,70,70,70,70]};
    data.workingTransition={file:`${theme}/working-transition.png`,columns:5,frameCount:5,cellSize:320,durations:[90,90,90,90,90]};
    data.actions.greet.startsAtIdle=true;
    data.actions.working.startsAtWorking=true;
    data.actions.complete.startsAtWorking=true;
  }
  return manifest;
}

test('过渡清单校验端点关系与边界，拒绝缺B/非法帧数/超时长/伪造兼容标志',()=>{
  assert.equal(validateManifest(transitionManifest()).themes.none.idleTransition.frameCount,5);
  for(const patch of [d=>delete d.idleAlternate,d=>d.idleTransition.durations=[70,70],
    d=>d.workingTransition.durations=[600,600,600],d=>d.workingTransition.file='../x.png',
    d=>d.actions.complete.startsAtWorking='yes',d=>d.actions.greet.startsAtIdle=1]) {
    const m=transitionManifest();patch(m.themes.none);assert.throws(()=>validateManifest(m));
  }
});

test('A动作回B先播放完整过渡，B进动作反向收手并省掉已覆盖的首A定格',async()=>{
  const h=rendererHarness({manifest:transitionManifest(),random:()=>0});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();
  assert.equal(h.node.dataset.action,'idle');assert.equal(h.node.dataset.transition,'to-alternate');assert.equal(h.node.dataset.frame,'0');
  assert.match(h.drawn.at(-1).url,/idle-transition\.png$/);h.advance(140);assert.equal(h.node.dataset.frame,'2');
  h.advance(210);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.frame,'0');assert.match(h.drawn.at(-1).url,/idle-alternate\.png$/);
  assert.equal(h.api.getActionDuration('idle'),3220);
  h.api.setMotionAction('greet');await h.flush();assert.equal(h.node.dataset.transition,'to-primary');assert.equal(h.node.dataset.frame,'4');
  assert.equal(h.api.getActionDuration('greet'),850);assert.equal([...h.timers.values()][0].ms,850);
  h.advance(350);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.frame,'1','反向桥末A已覆盖原首帧100ms');
  h.advance(499);assert.equal(h.node.dataset.action,'greet');h.advance(1);await h.flush();assert.equal(h.node.dataset.action,'idle');
  assert.equal(h.node.dataset.transition,'to-alternate');h.api.destroy();
});

test('换姿中途点击从可见手位反向，暂停转向不会跳到B末姿或重复抽签',async()=>{
  const h=rendererHarness({manifest:transitionManifest(),random:()=>0});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();h.advance(140);
  h.api.setActive(false);h.advance(5000);h.api.setFacing('left').setActive(true);assert.equal(h.node.dataset.frame,'2');assert.equal(h.randomReads(),1);
  h.api.setMotionAction('greet');await h.flush();assert.equal(h.node.dataset.transition,'to-primary');assert.equal(h.node.dataset.frame,'2');
  assert.equal(h.api.getActionDuration('greet'),710);h.advance(210);assert.equal(h.node.dataset.frame,'1');
  h.api.destroy();assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('B进阅读串收手与拿纸，阅读交给完成不收纸重拿，回B先收纸再搭腹',async()=>{
  const h=rendererHarness({manifest:transitionManifest(),random:()=>0});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();h.advance(350);
  h.api.setEmotion('51');await h.flush();assert.equal(h.node.dataset.transition,'to-primary');
  h.advance(350);assert.equal(h.node.dataset.transition,'to-working');assert.equal(h.node.dataset.frame,'0');
  h.advance(450);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.action,'working');
  h.api.setMotionAction('complete','codex');await h.flush();assert.equal(h.node.dataset.transition,'');assert.equal(h.api.getActionDuration('complete'),600);
  h.api.setEmotion('50');await h.flush();h.api.setEmotion('51');await h.flush();h.advance(450);
  h.api.setEmotion('50');await h.flush();assert.equal(h.node.dataset.transition,'from-working');assert.equal(h.node.dataset.frame,'4');
  h.advance(450);assert.equal(h.node.dataset.transition,'to-alternate');h.advance(350);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.idlePose,'alternate');
  h.api.destroy();
});

test('静态和低动态不播放姿势桥，旧前缀加载迟到不能覆盖新主题/动作',async()=>{
  const m=transitionManifest(),h=rendererHarness({manifest:m,random:()=>0,reduced:true});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();assert.equal(h.node.dataset.transition,'');assert.match(h.drawn.at(-1).url,/idle-alternate\.png$/);
  h.api.renderStatic();await h.flush();assert.equal(h.node.dataset.idlePose,'primary');assert.equal(h.frames.size,0);h.api.destroy();
  const d=rendererHarness({manifest:m,random:()=>0,deferImages:true});await d.flush();d.imageRequests[0].onload();await d.flush();
  d.api.setMotionAction('greet');await d.flush();d.imageRequests.at(-1).onload();await d.flush();d.advance(600);await d.flush();
  const pending=d.imageRequests.slice(-2);d.api.setEmotion('51');await d.flush();for(const image of d.imageRequests)image.onload?.();await d.flush();
  for(const image of pending)image.onload?.();await d.flush();assert.equal(d.node.dataset.action,'working');assert.notEqual(d.node.dataset.idlePose,'alternate');d.api.destroy();
});

test('聊天小头像按显示像素高质下采样，DPR变化不重启动作，桌面仍用原320画布', async () => {
  const h = rendererHarness({ portraitRaster: true, clientHeight: 32, devicePixelRatio: 2 });
  await h.flush();
  assert.equal(h.node.width,64); assert.equal(h.node.height,64);
  assert.equal(h.context.imageSmoothingQuality,'high');
  assert.deepEqual(h.transforms[0],['scale',.2,.2]);
  h.advance(100); const action=h.node.dataset.action,frame=h.node.dataset.frame;
  h.window.devicePixelRatio=1; h.api.resize();
  assert.equal(h.node.width,32); assert.equal(h.node.dataset.action,action); assert.equal(h.node.dataset.frame,frame);
  assert.deepEqual(h.transforms.filter(t=>t[0]==='scale'&&t[1]>0).at(-1),['scale',.1,.1]);
  h.api.destroy();
  const desktop=rendererHarness({clientHeight:32,devicePixelRatio:3}); await desktop.flush();
  assert.equal(desktop.node.width,320); assert.equal(desktop.node.height,320); desktop.api.destroy();
});

test('桌面圣诞五元素沿现有canvas绘制，定时六状态保持到小时边界，暂停恢复不重抽',async()=>{
  const h=rendererHarness({sheepTheme:'christmas',christmasBuddies:true,random:()=>0});
  const changes=[];h.api.on('buddychange',value=>changes.push(value.buddy));await h.flush();
  assert.equal(h.node.dataset.buddy,'reindeer');assert.equal(h.node.dataset.nextBuddyDelay,'3300000');
  const drawing=h.drawn.find(row=>row.url.endsWith('/buddies/reindeer.png'));
  assert.ok(drawing);assert.equal(drawing.args.at(-1),72);assert.equal(drawing.args.at(-4),256);
  h.advance(3299999);await h.flush();assert.equal(h.node.dataset.buddy,'reindeer');
  h.api.setGaze(12,12).clearGaze().setFacing('left');h.api.setMotionAction('snow');await h.flush();
  assert.equal(h.node.dataset.buddy,'reindeer','hover与自动动作路径不重抽');
  h.api.setActive(false);h.advance(1);await h.flush();assert.equal(h.node.dataset.buddy,'reindeer');
  h.api.setActive(true);h.advance(0);await h.flush();assert.equal(h.node.dataset.buddy,'reindeer','动作期间保留当前伙伴');
  h.api.stopMotion();await h.flush();h.advance(0);await h.flush();assert.equal(h.node.dataset.buddy,'none');
  const states=['reindeer',null];
  for(let i=0;i<4;i++){h.advance(3300000);await h.flush();states.push(h.node.dataset.buddy==='none'?null:h.node.dataset.buddy);}
  assert.equal(new Set(states).size,6);assert.equal(changes.length,6);
  h.api.destroy();assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('成功点击入口只在10%且间隔允许时换元素，普通头像和静态预览不启用元素',async()=>{
  const h=rendererHarness({sheepTheme:'christmas',christmasBuddies:true,random:()=>0});await h.flush();
  assert.equal(await h.api.notifySuccessfulClick(),true);assert.equal(h.node.dataset.buddy,'none');
  assert.equal(await h.api.notifySuccessfulClick(),false);
  h.advance(599999);assert.equal(await h.api.notifySuccessfulClick(),false);
  h.advance(1);assert.equal(await h.api.notifySuccessfulClick(),true);assert.equal(h.node.dataset.buddy,'gift');
  h.api.setFacing('left');assert.equal(h.api.hitBuddy(60,275),'gift');assert.equal(h.api.hitBuddy(100,250),null);assert.equal(h.api.hitBuddy(250,250),null);
  h.api.setFacing('right');assert.equal(h.api.hitBuddy(260,275),'gift');assert.equal(h.api.hitBuddy(30,250),null);
  h.api.setMotionAction('receive-gift');await h.flush();assert.equal(h.api.hitBuddy(290,250),null);
  h.api.destroy();
  for(const options of [{},{autostart:false},{portraitRaster:true}]){
    const preview=rendererHarness({sheepTheme:'christmas',...options});await preview.flush();
    assert.equal(preview.imageRequests.some(image=>image.src.includes('/buddies/')),false);
    assert.equal(await preview.api.notifySuccessfulClick(),false);preview.api.destroy();
  }
});


test('四伙伴可在真实显示坐标点击，互动期间保留，镜像与缩放命中一致',async()=>{
  const h=rendererHarness({sheepTheme:'christmas',christmasBuddies:true,random:()=>0});await h.flush();
  const seen=[];
  for(let i=0;i<6;i++){
    const buddy=h.node.dataset.buddy;
    if(['reindeer','tree','santa','snowman'].includes(buddy)){
      seen.push(buddy);h.api.setFacing('left');h.drawn.length=0;h.api.resize();
      const draw=h.drawn.find(row=>row.url.endsWith(`/buddies/${buddy}.png`));assert.ok(draw);
      const [x,y,w,height]=draw.args.slice(-4),cx=x+w/2,cy=y+height/2;
      assert.equal(h.api.hitBuddy(cx,cy),buddy);h.api.setFacing('right');assert.equal(h.api.hitBuddy(320-cx,cy),buddy);
      h.node.getBoundingClientRect=()=>({left:10,top:20,width:160,height:160});
      assert.equal(h.api.hitBuddy(10+(320-cx)/2,20+cy/2),buddy);
      h.node.getBoundingClientRect=()=>({left:0,top:0,width:320,height:320});
      h.drawn.length=0;h.api.setMotionAction({reindeer:'greet',tree:'joy',santa:'gift',snowman:'snow'}[buddy]);await h.flush();
      assert.ok(h.drawn.some(row=>row.url.endsWith(`/buddies/${buddy}.png`)),'伙伴在互动表演时保持可见');
      h.api.stopMotion();await h.flush();
    }
    h.advance(3300000);await h.flush();
  }
  assert.equal(new Set(seen).size,4);h.api.setEmotion('00');await h.flush();assert.equal(h.api.hitBuddy(260,275),null);
  h.api.destroy();
});

test('同renderer桌面重建保留当前六状态bag、原小时截止时间和成功点击10分钟冷却',async()=>{
  const h=rendererHarness({sheepTheme:'christmas',christmasBuddies:true,random:()=>0});await h.flush();
  assert.equal(await h.api.notifySuccessfulClick(),true);assert.equal(h.node.dataset.buddy,'none');
  h.advance(100000);h.api.destroy();const next=h.recreate();await h.flush();
  const node=h.target.children[0];assert.equal(node.dataset.buddyLayout,'true');assert.equal(node.dataset.buddy,'none');
  assert.equal(node.dataset.nextBuddyDelay,'3200000');
  assert.equal([...h.timers.values()].find(timer=>timer.ms>1000000).due,3300000);
  assert.equal(await next.notifySuccessfulClick(),false,'重建不能绕过剩余点击冷却');
  h.advance(499999);assert.equal(await next.notifySuccessfulClick(),false);
  h.advance(1);assert.equal(await next.notifySuccessfulClick(),true);assert.equal(node.dataset.buddy,'gift','继续原bag第三状态');
  next.destroy();
});

test('元素加载失败不提交bag与成功点击冷却，立即重试仍是同一候选',async()=>{
  const h=rendererHarness({sheepTheme:'christmas',christmasBuddies:true,random:()=>0,deferImages:true});await h.flush();
  for(const image of h.imageRequests)image.onload?.();await h.flush();
  assert.equal(await h.api.notifySuccessfulClick(),true);assert.equal(h.node.dataset.buddy,'none');
  h.advance(600000);const failed=h.api.notifySuccessfulClick();await h.flush();
  const image=h.imageRequests.at(-1);assert.match(image.src,/buddies\/gift.png$/);image.onerror();
  assert.equal(await failed,false);assert.equal(h.node.dataset.buddy,'none');
  const retry=h.api.notifySuccessfulClick();await h.flush();const retried=h.imageRequests.at(-1);
  assert.notEqual(retried,image);assert.match(retried.src,/buddies\/gift.png$/);retried.onload();
  assert.equal(await retry,true);assert.equal(h.node.dataset.buddy,'gift');assert.equal(await h.api.notifySuccessfulClick(),false);
  h.api.destroy();
});

test('宿主一次性动作结束后回执迟到停留末帧，不闪回首帧重播；连续状态仍循环',async()=>{
  for(const theme of ['none','halloween','christmas','spring-festival']) {
    for(const [action,owner] of [['greet','user'],['complete','codex']]) {
      const h=rendererHarness({sheepTheme:theme});await h.flush();
      h.api.setMotionAction(action,owner);await h.flush();
      const duration=h.api.getActionDuration(action,owner);
      h.advance(duration-1);assert.equal(h.node.dataset.frame,'2',theme+'/'+action+' last frame');
      h.advance(2);assert.equal(h.node.dataset.frame,'2',theme+'/'+action+' waits on last frame for host ACK');
      h.advance(duration*2+100);assert.equal(h.node.dataset.frame,'2',theme+'/'+action+' delayed host must not replay');
      h.api.setActive(false);h.advance(1000);h.api.setFacing('left').resize().setActive(true);
      assert.equal(h.node.dataset.frame,'2',theme+'/'+action+' pause/resize keeps final pose');
      h.api.setMotionFrame({done:true});await h.flush();assert.equal(h.node.dataset.action,'idle');h.api.destroy();
    }
    for(const emotion of ['50','51','00']) {
      const h=rendererHarness({sheepTheme:theme});await h.flush();h.api.setEmotion(emotion);await h.flush();
      h.advance(700);assert.equal(h.node.dataset.frame,'1',theme+'/'+emotion+' continuous state still loops');h.api.destroy();
    }
  }
});

test('宿主动作末帧等待包含B回A前缀和已跳过的首帧时间',async()=>{
  const h=rendererHarness({manifest:transitionManifest(),random:()=>0});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();h.advance(350);
  assert.equal(h.node.dataset.idlePose,'alternate');
  h.api.setMotionAction('greet','user');await h.flush();assert.equal(h.api.getActionDuration('greet','user'),850);
  h.advance(349);assert.equal(h.node.dataset.transition,'to-primary');
  h.advance(1);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.frame,'1');
  h.advance(501);assert.equal(h.node.dataset.action,'greet');assert.equal(h.node.dataset.frame,'2');
  h.api.setMotionFrame({done:true});await h.flush();assert.equal(h.node.dataset.action,'idle');h.api.destroy();
});

function sleepTransitionManifest(){
  const manifest=transitionManifest();
  for(const [theme,data] of Object.entries(manifest.themes)){
    data.sleepTransition={file:`${theme}/sleep-transition.png`,columns:3,frameCount:3,cellSize:320,durations:[60,70,80]};
    data.actions.sleep.startsAtIdle=false;data.actions.sleep.startsAtWorking=false;data.actions.greet.startsAtIdle=true;
    data.workingTransition ||= {file:`${theme}/working-transition.png`,columns:3,frameCount:3,cellSize:320,durations:[60,70,80]};
    data.actions.working.startsAtWorking=true;data.actions.complete.startsAtWorking=true;
  }
  return manifest;
}

test('睡眠桥验证路径/帧数/时长且不增加公开动作',()=>{
  assert.equal(validateManifest(sleepTransitionManifest()).themes.christmas.sleepTransition.frameCount,3);
  for(const patch of [d=>d.sleepTransition.file='../escape.png',d=>d.sleepTransition.columns=0,
    d=>d.sleepTransition.durations=[60,70],d=>d.sleepTransition.durations=Array(17).fill(20),
    d=>d.sleepTransition.durations=[600,600,600],d=>d.sleepTransition.frameCount=2]){
    const m=sleepTransitionManifest();patch(m.themes.christmas);assert.throws(()=>validateManifest(m));
  }
  assert.equal(supportsAction('sleep-transition','christmas'),false);
});

test('睡眠桥正放闭眼后保持呼吸循环，反放醒来再播放问好',async()=>{
  const h=rendererHarness({manifest:sleepTransitionManifest(),sheepTheme:'christmas'});await h.flush();
  h.api.setEmotion('00');await h.flush();assert.equal(h.node.dataset.transition,'to-sleep');assert.equal(h.node.dataset.frame,'0');
  h.advance(60);assert.equal(h.node.dataset.frame,'1');h.advance(150);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.action,'sleep');
  h.advance(700);assert.equal(h.node.dataset.action,'sleep');assert.equal(h.node.dataset.frame,'1');
  h.api.setMotionAction('greet');await h.flush();assert.equal(h.node.dataset.transition,'from-sleep');assert.equal(h.node.dataset.frame,'2');
  assert.equal(h.api.getActionDuration('greet'),710);
  h.advance(80);assert.equal(h.node.dataset.frame,'1');h.advance(130);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.frame,'1');
  h.advance(499);assert.equal(h.node.dataset.action,'greet');h.advance(1);await h.flush();assert.equal(h.node.dataset.action,'sleep','显式动作结束恢复仍为睡眠的原emotion');h.api.destroy();
});

test('睡眠桥同轮sleep→idle→greet仍从真实闭眼起点醒来，加载请求不抹掉桥',async()=>{
  const h=rendererHarness({manifest:sleepTransitionManifest(),sheepTheme:'christmas'});await h.flush();
  h.api.setEmotion('00');await h.flush();h.advance(210);
  h.api.setEmotion('50');h.api.setMotionAction('greet');await h.flush();
  assert.equal(h.node.dataset.transition,'from-sleep');assert.equal(h.node.dataset.frame,'2');assert.equal(h.api.getActionDuration('greet'),710);
  h.advance(710);await h.flush();assert.equal(h.node.dataset.action,'idle');h.api.destroy();
});

test('睡眠桥先收B再入睡，醒来后再拿工作纸；中途唤醒从可见闭眼程度反放',async()=>{
  const h=rendererHarness({manifest:sleepTransitionManifest(),random:()=>0});await h.flush();
  h.api.setMotionAction('greet');await h.flush();h.advance(600);await h.flush();h.advance(350);
  h.api.setEmotion('00');await h.flush();assert.equal(h.node.dataset.transition,'to-primary');
  h.advance(350);assert.equal(h.node.dataset.transition,'to-sleep');h.advance(60);
  h.api.setEmotion('50');h.api.setMotionAction('greet');await h.flush();
  assert.equal(h.node.dataset.transition,'from-sleep');assert.equal(h.node.dataset.frame,'1');assert.equal(h.api.getActionDuration('greet'),630);
  h.advance(630);await h.flush();h.advance(350);
  h.api.setEmotion('56');await h.flush();h.advance(560);assert.equal(h.node.dataset.action,'sleep');assert.equal(h.node.dataset.transition,'');
  h.api.setEmotion('51');await h.flush();assert.equal(h.node.dataset.transition,'from-sleep');h.advance(210);assert.equal(h.node.dataset.transition,'to-working');
  h.advance(450);assert.equal(h.node.dataset.transition,'');assert.equal(h.node.dataset.action,'working');h.api.destroy();
});

test('睡眠桥低动态/暂停/隐藏不暗播，恢复不重抽或把旧加载覆盖新动作',async()=>{
  for(const mode of ['reduced','inactive','hidden']){
    const h=rendererHarness({manifest:sleepTransitionManifest(),sheepTheme:'christmas',reduced:mode==='reduced'});await h.flush();
    if(mode==='inactive')h.api.setActive(false);
    if(mode==='hidden'){h.document.hidden=true;h.documentListeners.get('visibilitychange')();}
    h.api.setEmotion('00');await h.flush();assert.equal(h.node.dataset.action,'sleep');assert.equal(h.node.dataset.transition,'');
    assert.equal(h.frames.size,0);h.api.setEmotion('50');h.api.setMotionAction('greet');await h.flush();assert.equal(h.node.dataset.transition,'');h.api.destroy();
  }
});

test('睡眠桥进入打包资源列表，现有41公开动作不变',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sheep-sleep-package-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const fixtureRoot=prepareStaging(root,path.join(temporary,'source'));
  const manifestPath=path.join(fixtureRoot,'desktop-pet/assets/sheep/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  const theme=manifest.themes.christmas;theme.sleepTransition={...theme.workingTransition,file:'christmas/sleep-transition.png'};
  fs.copyFileSync(path.join(fixtureRoot,'desktop-pet/assets/sheep',theme.workingTransition.file),path.join(fixtureRoot,'desktop-pet/assets/sheep',theme.sleepTransition.file));
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));const staged=prepareStaging(fixtureRoot,path.join(temporary,'staged'));
  const relative='desktop-pet/assets/sheep/christmas/sleep-transition.png';assert.deepEqual(fs.readFileSync(path.join(staged,relative)),fs.readFileSync(path.join(fixtureRoot,relative)));
});
