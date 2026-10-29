const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const customization = require('../lib/customization');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Node {
  constructor(tag) {
    this.tag = tag; this.attributes = {}; this.children = []; this.style = {}; this.dataset = {};
    this.listeners = new Map(); this.textContent = ''; this.hidden = false; this.disabled = false;
    this.classes = new Set();
    this.classList = { add: (...values) => values.forEach(value => this.classes.add(value)),
      remove: (...values) => values.forEach(value => this.classes.delete(value)), contains: value => this.classes.has(value) };
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...children) { [...this.children].forEach(child => this.removeChild(child)); children.forEach(child => this.appendChild(child)); }
  querySelector(selector) { return selector === ':scope > svg' ? this.children.find(child => child.tag === 'svg') : null; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  dispatch(name, event = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...event }); }
}

function fixture({ reduced = false, random = .4, hidden = false } = {}) {
  const nodes = new Map(), rendered = [], auroras = [], calls = [], timers = new Map(), windowEvents = new Map(), documentEvents = new Map();
  let time = 1000, timerId = 0, receive, mediaChange, unsubscribed = 0, randomValue = random;
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Node('span')); return nodes.get(id); };
  const bridge = { getInfo: async () => ({ version: '0.3.32' }),
    checkUpdates: () => { calls.push('checkUpdates'); }, downloadUpdate: () => { calls.push('downloadUpdate'); },
    openBrowserDownload: async () => { calls.push('openBrowserDownload'); return { ok: true }; },
    openDomesticDownload: async () => { calls.push('openDomesticDownload'); return { ok: true }; },
    openWebsite: () => { calls.push('openWebsite'); }, close: () => { calls.push('close'); },
    onUpdate(fn) { receive = fn; return () => { unsubscribed++; }; } };
  const media = { matches: reduced, addEventListener: (_name, fn) => { mediaChange = fn; }, removeEventListener: () => { mediaChange = null; } };
  const document = { documentElement: { dataset: {} }, hidden, getElementById: get,
    createElementNS: (_namespace, name) => new Node(name), addEventListener: (name, fn) => documentEvents.set(name, fn) };
  const clock = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: time + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(delay) {
      const end = time + delay;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].fn();
      }
      time = end;
    }
  };
  const math = Object.create(Math); math.random = () => randomValue;
  const context = vm.createContext({ qiuqiuAbout: bridge, PetCustomization: customization, document, Math: math, console,
    performance: { now: () => time }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    matchMedia: () => media, addEventListener: (name, fn) => windowEvents.set(name, fn),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  context.window = context;
  for (const file of ['rings.js', 'custom-shapes.js', 'emotions.js', 'ball.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../emotion-ball/js', file), 'utf8'), context, { filename: file });
  }
  const create = context.EmotionBall.create;
  context.EmotionBall.create = (target, options) => {
    const engine = create(target, options); rendered.push({ target, options, engine }); return engine;
  };
  // The canvas/WASM adapter is stubbed here; classic shape and spin drawing use the real engine.
  context.AuroraRive = { create(target, appearance, referenceTexture, preview) {
    const canvas = new Node('canvas'); target.appendChild(canvas);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const instance = { target, appearance, referenceTexture, preview, canvas, destroyed: false, clicks: 0,
      ready: () => canvas.classes.has('ready'), whenReady: () => promise,
      click() { if (!this.ready() || media.matches) return false; this.clicks++; return true; },
      destroy() { this.destroyed = true; canvas.remove(); resolve(false); },
      finish(value) { if (value && !this.destroyed) canvas.classList.add('ready'); resolve(value); }, fail() { reject(new Error('load failed')); } };
    auroras.push(instance); return instance;
  } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../about-renderer.js'), 'utf8'), context);
  return { bridge, get, rendered, auroras, calls, timers, clock, document, media,
    setRandom(value) { randomValue = value; }, get engine() { return rendered.at(-1).engine; },
    tick(duration) { for (let end = time + duration; time < end;) { time = Math.min(end, time + 16); this.engine._tick(time); } },
    receive: value => receive(value), changeMotion(value) { media.matches = value; mediaChange?.(); },
    visibility(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')(); },
    escape() { documentEvents.get('keydown')({ key: 'Escape', preventDefault() {} }); },
    unload() { windowEvents.get('beforeunload')(); }, get unsubscribed() { return unsubscribed; } };
}

test('发现新版只显示新版入口，最新或失败时仍可检查更新', async () => {
  const f = fixture(); await flush();
  assert.equal(f.get('about-check-updates').hidden, false); assert.equal(f.get('about-open-release').hidden, true);
  f.receive({ state: 'ready', hasUpdate: true, latestVersion: '0.3.33' });
  assert.equal(f.get('about-check-updates').hidden, true); assert.equal(f.get('about-open-release').hidden, false);
  assert.equal(f.get('about-status').textContent, '发现新版本 0.3.33');
  f.receive({ state: 'checking' }); assert.equal(f.get('about-check-updates').hidden, true); assert.equal(f.get('about-open-release').disabled, true);
  for (const value of [{ state: 'ready', hasUpdate: false }, { state: 'error' }]) {
    f.receive(value); assert.equal(f.get('about-check-updates').hidden, false); assert.equal(f.get('about-open-release').hidden, true);
  }
});

test('单击复用桌面真实开心表情和spin，眼睛随yaw移动并产生原生彩带', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  assert.equal(f.rendered[0].target, f.get('about-portrait')); assert.equal(avatar.dataset.shape, 'blob');
  assert.equal(f.engine.ball.svg, f.get('about-portrait').children[0], '必须成功创建桌面真实SVG，不能静默失败');
  assert.equal(f.rendered[0].options.color, customization.DEFAULT_APPEARANCE.bodyColor);
  assert.equal(f.rendered[0].options.eyeColor, customization.DEFAULT_APPEARANCE.eyeColor);
  assert.equal(f.rendered[0].options.liteRibbons, true);
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const eyes = descendants(f.engine.ball.svg).filter(node => node.attributes.class === 'eb-eye');
  const before = eyes.map(node => node.attributes.transform);
  avatar.dispatch('click', { detail: 1 }); f.clock.advance(519); assert.equal(f.engine._spin, null);
  f.clock.advance(1); assert.ok(f.engine._spin); assert.equal(f.engine.emotionId, '10');
  f.tick(240);
  assert.ok(f.engine._lastPose.body.yaw !== 0);
  assert.notDeepEqual(eyes.map(node => node.attributes.transform), before);
  const defs = f.engine.ball.svg.children.find(node => node.tag === 'defs');
  assert.ok(defs.children.some(node => node.tag === 'linearGradient'), '彩带必须由实际ball.js生成');
  f.clock.advance(3200); assert.equal(f.engine.emotionId, '50');
});

test('双击取消延迟单击且每次仅随机另一个真实官方形态', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  const seen = new Set(['blob']);
  for (let pass = 0; pass < 12; pass++) {
    const oldShape = avatar.dataset.shape, oldEngine = f.engine;
    f.setRandom([0, .45, .9][pass % 3]);
    avatar.dispatch('click', { detail: 1 }); f.clock.advance(100);
    avatar.dispatch('click', { detail: 2 }); avatar.dispatch('dblclick');
    assert.notEqual(avatar.dataset.shape, oldShape); assert.equal(oldEngine._active, false); assert.equal(oldEngine._spin, null);
    assert.equal(f.engine.emotionId, '50');
    const options = f.rendered.at(-1).options; seen.add(options.shape);
    assert.ok(['blob', 'cloud', 'aurora-cloud', 'square'].includes(options.shape));
    if (options.shape === 'aurora-cloud') {
      assert.equal(f.auroras.at(-1).appearance.auroraContour, 'six-lobe');
      assert.equal(f.auroras.at(-1).preview, false, '不让Rive额外绑定单击，避免双击误触');
      assert.equal(f.engine.ball.svg.style.visibility, 'hidden', '载入中不得显示近似SVG轮廓');
    }
    f.clock.advance(520); assert.equal(f.engine._spin, null); assert.equal(f.timers.size, 0);
  }
  assert.deepEqual([...seen].sort(), ['aurora-cloud', 'blob', 'cloud', 'square']); assert.deepEqual(f.calls, []);
  assert.match(avatar.attributes['aria-label'], /单击互动，双击随机换形态/);
});

test('幻彩使用真实Rive互动，快速切换后迟到的ready或失败不能覆盖新形态', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  avatar.dispatch('dblclick'); assert.equal(avatar.dataset.shape, 'aurora-cloud');
  const first = f.auroras.at(-1);
  assert.equal(f.engine._active, false); assert.equal(f.engine.ball.svg.style.visibility, 'hidden');
  first.finish(true); await flush();
  avatar.dispatch('click', { detail: 1 }); f.clock.advance(520);
  assert.equal(first.clicks, 1); assert.equal(f.engine._spin, null);
  f.setRandom(0); avatar.dispatch('dblclick');
  assert.equal(first.destroyed, true); assert.equal(avatar.dataset.shape, 'blob');
  first.finish(false); await flush(); assert.equal(avatar.dataset.shape, 'blob');
  f.setRandom(.4); avatar.dispatch('dblclick');
  const pending = f.auroras.at(-1); f.setRandom(.9); avatar.dispatch('dblclick');
  assert.equal(avatar.dataset.shape, 'square'); pending.fail(); await flush();
  assert.equal(avatar.dataset.shape, 'square'); assert.equal(f.engine._active, true);
});

test('幻彩加载失败回到真实经典，不显示近似轮廓', async () => {
  const f = fixture(); await flush();
  f.get('about-avatar').dispatch('dblclick');
  const pending = f.auroras.at(-1); assert.equal(f.engine.ball.svg.style.visibility, 'hidden');
  pending.finish(false); await flush();
  assert.equal(pending.destroyed, true); assert.equal(f.get('about-avatar').dataset.shape, 'blob');
  assert.equal(f.engine.ball.svg.style.visibility, undefined);
  assert.match(f.get('about-avatar-status').textContent, /已回到经典/);
});

test('键盘、减少动态、隐藏和卸载控制真实引擎，Escape仍关闭关于页', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  avatar.dispatch('click', { detail: 1 }); avatar.dispatch('keydown', { key: 'Enter' });
  assert.ok(f.engine._spin); assert.equal(f.timers.size, 1, '键盘取消鼠标待执行动作');
  const running = f.engine;
  f.changeMotion(true); assert.equal(running._active, false); assert.equal(running._spin, null);
  assert.equal(f.engine._active, false);
  avatar.dispatch('keydown', { key: ' ' }); assert.equal(f.engine._spin, null); assert.equal(f.timers.size, 0);
  avatar.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(avatar.dataset.shape, 'aurora-cloud');
  f.auroras.at(-1).finish(true); await flush();
  avatar.dispatch('keydown', { key: 'Enter' }); assert.equal(f.auroras.at(-1).clicks, 0);
  avatar.dispatch('click', { detail: 1 }); f.visibility(true); f.clock.advance(1000);
  assert.equal(f.engine._active, false); assert.equal(f.timers.size, 0); assert.equal(f.get('about-portrait').children.length, 0);
  assert.equal(f.auroras.at(-1).destroyed, true); assert.equal(f.document.documentElement.dataset.aboutVisible, 'false');
  f.visibility(false); assert.equal(avatar.dataset.shape, 'aurora-cloud'); assert.equal(f.document.documentElement.dataset.aboutVisible, 'true');
  f.changeMotion(false); f.setRandom(0); avatar.dispatch('dblclick'); assert.equal(f.engine._active, true);
  avatar.dispatch('keydown', { key: ' ', repeat: true }); assert.equal(f.engine._spin, null);
  f.escape(); assert.deepEqual(f.calls, ['close']); f.unload(); assert.equal(f.engine._active, false); assert.equal(f.unsubscribed, 1);
});

test('初始隐藏不创建视觉实例，显示后经典云朵方糖均用真实spin', async () => {
  const f = fixture({ hidden: true }); await flush();
  assert.equal(f.rendered.length, 0); assert.equal(f.document.documentElement.dataset.aboutVisible, 'false');
  f.visibility(false);
  const avatar = f.get('about-avatar');
  for (const [shape, nextRandom] of [['blob', 0], ['cloud', .9], ['square', 0]]) {
    assert.equal(avatar.dataset.shape, shape);
    avatar.dispatch('click', { detail: 0 }); assert.ok(f.engine._spin); assert.equal(f.engine.emotionId, '10');
    f.setRandom(nextRandom); avatar.dispatch('dblclick');
  }
});

test('试玩不写桌面偏好或覆盖版本提醒，官网与升级仍调用现有About bridge', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  f.receive({ state: 'ready', hasUpdate: true, latestVersion: '0.3.33' });
  avatar.dispatch('dblclick'); assert.equal(f.get('about-status').textContent, '发现新版本 0.3.33');
  await f.get('about-website').dispatch('click'); await f.get('about-open-release').dispatch('click');
  f.receive({ state: 'ready', hasUpdate: false }); await f.get('about-check-updates').dispatch('click');
  assert.deepEqual(f.calls, ['openWebsite', 'downloadUpdate', 'checkUpdates']);
  const second = fixture(); await flush(); assert.equal(second.get('about-avatar').dataset.shape, 'blob', '新关于页从经典开始，试玩不保存');
  avatar.dispatch('click', { detail: 1 }); f.unload(); f.clock.advance(1000); assert.equal(f.engine._active, false); assert.equal(f.timers.size, 0);
});

test('新版直接下载按钮显示进度，失败或取消可重试，缺本机安装包不能误下载其他架构', async () => {
  const f = fixture(); await flush();
  const ready = { state: 'ready', hasUpdate: true, latestVersion: '0.4.05', downloadAvailable: true };
  for (const [download, text] of [
    [{ state: 'starting' }, '正在准备安装包…'], [{ state: 'downloading', percent: 42 }, '正在下载 42%'],
    [{ state: 'retrying', attempt: 2 }, '连接中断，正在恢复下载（2/2）…'],
    [{ state: 'completed' }, '安装包已下载，可从保存位置打开。'],
    [{ state: 'cancelled', message: '已取消下载' }, '已取消下载'],
    [{ state: 'error', message: '网络中断，请重试' }, '网络中断，请重试']
  ]) {
    f.receive({ ...ready, download }); assert.equal(f.get('about-status').textContent, text);
    assert.equal(f.get('about-open-release').disabled, ['starting', 'downloading', 'retrying'].includes(download.state));
    assert.equal(f.get('about-open-release').hidden, false);
  }
  f.receive({ ...ready, downloadAvailable: false, downloadMessage: '暂无 Intel Mac 安装包' });
  assert.equal(f.get('about-open-release').disabled, true); assert.equal(f.get('about-status').textContent, '暂无 Intel Mac 安装包');
  assert.equal(f.get('about-check-updates').hidden, false, '缺匹配安装包时仍可重新检查');
  const html = fs.readFileSync(path.join(__dirname, '../about.html'), 'utf8');
  assert.match(html, /开发者 春野/); assert.match(html, />下载安装包<\/button>/);
});

test('具体下载终态不会被 IPC false 或拒绝覆盖，用户取消不当成失败', async () => {
  const ready = { state: 'ready', hasUpdate: true, latestVersion: '0.4.08', downloadAvailable: true };
  for (const download of [
    { state: 'error', code: 'START_TIMEOUT', message: '下载启动超时，可选择浏览器下载。' },
    { state: 'cancelled', code: 'CANCELLED', message: '已取消下载，可以重新下载。' },
    { state: 'error', code: 'DOWNLOAD_FAILED', message: '下载失败，请检查网络和保存位置后重试。' }
  ]) for (const response of ['structured', 'false', 'reject']) {
    const f = fixture(); await flush(); f.receive(ready);
    f.bridge.downloadUpdate = async () => {
      f.receive({ ...ready, download });
      if (response === 'reject') throw Error('private diagnostic');
      return response === 'structured' ? download : false;
    };
    await f.get('about-open-release').dispatch('click');
    assert.equal(f.get('about-status').textContent, download.message, `${download.code}/${response}`);
    assert.equal(f.get('about-open-release').disabled, false);
    assert.equal(f.get('about-check-updates').hidden, false, '失败或取消后允许刷新版本信息');
  }
});

test('结构化返回无需进度事件也能显示失败，新一次 IPC 异常不能复用上次取消', async () => {
  const f = fixture(); await flush();
  const ready = { state: 'ready', hasUpdate: true, latestVersion: '0.4.08', downloadAvailable: true };
  f.receive(ready);
  f.bridge.downloadUpdate = async () => ({ state: 'cancelled', code: 'CANCELLED', message: '已取消下载，可以重新下载。' });
  await f.get('about-open-release').dispatch('click'); assert.match(f.get('about-status').textContent, /已取消/);
  f.bridge.downloadUpdate = async () => { throw Error('secret diagnostic'); };
  await f.get('about-open-release').dispatch('click');
  assert.equal(f.get('about-status').textContent, '暂时无法下载安装包，请稍后重试。');
  assert.equal(f.get('about-check-updates').hidden, false);
});

test('下载备用入口只按主进程可用性显示，恢复中禁用，打开浏览器不声称下载完成', async () => {
  const f = fixture(); await flush();
  const ready = { state: 'ready', hasUpdate: true, latestVersion: '0.4.08', downloadAvailable: true,
    browserDownloadAvailable: true, domesticDownloadAvailable: true };
  f.receive(ready);
  for (const id of ['about-browser-download', 'about-domestic-download']) {
    assert.equal(f.get(id).hidden, false); assert.equal(f.get(id).disabled, false);
    await f.get(id).dispatch('click'); assert.equal(f.get('about-status').textContent, '已在浏览器打开下载页面。');
  }
  assert.deepEqual(f.calls, ['openBrowserDownload', 'openDomesticDownload']);
  f.receive({ ...ready, download: { state: 'retrying', attempt: 1 } });
  assert.equal(f.get('about-browser-download').disabled, true); assert.equal(f.get('about-domestic-download').disabled, true);
  f.receive({ ...ready, domesticDownloadAvailable: false });
  assert.equal(f.get('about-domestic-download').hidden, true); assert.equal(f.get('about-browser-download').hidden, false);
  f.receive({ ...ready, browserDownloadAvailable: false, domesticDownloadAvailable: false });
  assert.equal(f.get('about-download-alternatives').hidden, true);
  f.receive({ state: 'ready', hasUpdate: false }); assert.equal(f.get('about-download-alternatives').hidden, true);
});

test('关于页载入既有真实视觉模块，保留满铺与渐变名，背景8秒可见并尊重辅助模式', () => {
  const html = fs.readFileSync(path.join(__dirname, '../about.html'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '../about.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../about-renderer.js'), 'utf8');
  const content = css.match(/^\.about-window \{[^}]+\}/m)[0];
  assert.doesNotMatch(content, /border(?:-radius)?\s*:/); assert.match(content, /width: 100%; height: 100%/);
  assert.match(html, /<button id="about-avatar"[^>]+aria-describedby="about-avatar-help"/);
  assert.match(html, /id="about-name">球球桌宠<\/h1>/); assert.match(html, /id="about-avatar-help" class="about-sr-only"/);
  for (const script of ['rings', 'custom-shapes', 'emotions', 'ball', 'engine']) assert.match(html, new RegExp('../emotion-ball/js/' + script + '\\.js'));
  for (const script of ['customization', 'rive', 'boo-binary', 'aurora-rive']) assert.match(html, new RegExp('lib/' + script + '\\.js'));
  assert.match(html, /href="aurora-rive.css"/); assert.match(html, /connect-src 'self';/);
  assert.doesNotMatch(html + css + renderer, /chat-avatar|PetChatAvatar|egg-turn|egg-shell|is-static-egg|变出一颗彩蛋/);
  assert.match(css, /about-drift 8s/); assert.match(css, /translate\(6%, 3%\) scale\(1.08\)/);
  assert.match(css, /data-about-visible="false".*animation-play-state: paused/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.ok(css.indexOf('background-image: linear-gradient(110deg, #9ed1ed') > css.indexOf('background: linear-gradient(110deg, #557eb6'));
  assert.match(css, /:root\[data-color-mode="accessible"\] h1 \{ background: none; -webkit-text-fill-color: currentColor; \}/);
  assert.match(css, /:root\[data-color-mode="accessible"\] \.about-window::before \{ display: none; \}/);
});
