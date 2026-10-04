const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const customization = require('../lib/customization');
const flush = () => new Promise(resolve => setImmediate(resolve));

class SvgNode {
  constructor(name) { this.name = name; this.attributes = {}; this.children = []; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  insertBefore(child) { this.children.unshift(child); }
  get firstChild() { return this.children[0] || null; }
}

function fixture({ reduced = false, random = () => 0 } = {}) {
  const nodes = new Map(), rendered = [], calls = [], timers = new Map(), windowEvents = new Map(), documentEvents = new Map();
  let time = 0, timerId = 0, receive, mediaChange, unsubscribed = 0;
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set(), listeners = new Map();
      nodes.set(id, { hidden: false, disabled: false, textContent: '', dataset: {}, attributes: {}, children: [], offsetWidth: 172, classes,
        classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)) },
        setAttribute(key, value) { this.attributes[key] = value; }, addEventListener: (name, fn) => listeners.set(name, fn),
        replaceChildren(...children) { this.children = children; },
        dispatch(name, event = {}) { return listeners.get(name)?.({ preventDefault() { this.defaultPrevented = true; }, ...event }); } });
    }
    return nodes.get(id);
  };
  const bridge = { getInfo: async () => ({ version: '0.3.31' }),
    checkUpdates: () => { calls.push('checkUpdates'); }, openRelease: () => { calls.push('openRelease'); },
    openWebsite: () => { calls.push('openWebsite'); }, close: () => { calls.push('close'); },
    onUpdate(fn) { receive = fn; return () => { unsubscribed++; }; } };
  const media = { matches: reduced, addEventListener: (_name, fn) => { mediaChange = fn; }, removeEventListener: () => { mediaChange = null; } };
  const document = { documentElement: { dataset: {} }, hidden: false, getElementById: get,
    createElementNS: (_namespace, name) => new SvgNode(name), addEventListener: (name, fn) => documentEvents.set(name, fn) };
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
  const window = { qiuqiuAbout: bridge, PetCustomization: customization,
    matchMedia: () => media, addEventListener: (name, fn) => windowEvents.set(name, fn) };
  const math = Object.create(Math); math.random = random;
  const context = vm.createContext({ window, document, Math: math, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  for (const file of ['../../emotion-ball/js/rings.js', '../../emotion-ball/js/custom-shapes.js', '../lib/chat-avatar.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  }
  const render = window.PetChatAvatar.render;
  window.PetChatAvatar = { render(target, appearance) { render(target, appearance); rendered.push({ target, appearance }); } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../about-renderer.js'), 'utf8'), context);
  return { get, rendered, calls, timers, clock, document, media,
    receive: value => receive(value), changeMotion(value) { media.matches = value; mediaChange?.(); },
    hide() { document.hidden = true; documentEvents.get('visibilitychange')(); },
    escape() { documentEvents.get('keydown')({ key: 'Escape', preventDefault() {} }); },
    unload() { windowEvents.get('beforeunload')(); }, get unsubscribed() { return unsubscribed; } };
}

test('发现新版只显示新版入口，最新或失败时仍可检查更新', async () => {
  const f = fixture(); await flush();
  assert.equal(f.get('about-check-updates').hidden, false); assert.equal(f.get('about-open-release').hidden, true);
  f.receive({ state: 'ready', hasUpdate: true, latestVersion: '0.3.32' });
  assert.equal(f.get('about-check-updates').hidden, true); assert.equal(f.get('about-open-release').hidden, false);
  assert.equal(f.get('about-status').textContent, '发现新版本 0.3.32');
  f.receive({ state: 'checking' }); assert.equal(f.get('about-check-updates').hidden, true); assert.equal(f.get('about-open-release').disabled, true);
  for (const value of [{ state: 'ready', hasUpdate: false }, { state: 'error' }]) {
    f.receive(value); assert.equal(f.get('about-check-updates').hidden, false); assert.equal(f.get('about-open-release').hidden, true);
  }
});

test('彩蛋单击延迟转圈，双击取消待执行单击且仅随机另一个官方形态', async () => {
  let randomIndex = 0;
  const f = fixture({ random: () => [0, .45, .9][randomIndex++ % 3] }), avatar = f.get('about-avatar'); await flush();
  assert.equal(f.rendered[0].target, f.get('about-portrait')); assert.equal(avatar.dataset.shape, 'blob');
  assert.equal(f.get('about-portrait').children[0].name, 'svg', '现有真实头像绘制必须成功初始化');
  avatar.dispatch('click', { detail: 1 }); f.clock.advance(519); assert.equal(avatar.classes.size, 0);
  f.clock.advance(1); assert.equal(avatar.classes.has('is-spinning'), true); f.clock.advance(820); assert.equal(avatar.classes.size, 0);
  const seen = new Set(['blob']);
  for (let pass = 0; pass < 12; pass++) {
    const old = avatar.dataset.shape;
    avatar.dispatch('click', { detail: 1 }); f.clock.advance(100);
    avatar.dispatch('click', { detail: 2 }); avatar.dispatch('dblclick');
    assert.notEqual(avatar.dataset.shape, old); assert.equal(avatar.classes.has('is-spinning'), false);
    const appearance = f.rendered.at(-1).appearance; seen.add(appearance.shape);
    assert.ok(['blob', 'cloud', 'aurora-cloud', 'square'].includes(appearance.shape));
    if (appearance.shape === 'aurora-cloud') {
      assert.equal(appearance.auroraContour, 'six-lobe');
      const hasImage = node => node.name === 'image' || node.children.some(hasImage);
      assert.equal(hasImage(f.get('about-portrait').children[0]), false, '六瓣幻彩使用官方矢量预览');
    }
    f.clock.advance(520); assert.equal(avatar.classes.size, 0);
  }
  assert.deepEqual([...seen].sort(), ['aurora-cloud', 'blob', 'cloud', 'square']); assert.deepEqual(f.calls, []);
  assert.match(avatar.attributes['aria-label'], /单击转一圈，双击随机换形态/);
});

test('键盘彩蛋、减少动态和窗口隐藏会正确取消动效，Escape仍关闭关于页', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  avatar.dispatch('click', { detail: 1 }); avatar.dispatch('keydown', { key: 'Enter' });
  assert.equal(avatar.classes.has('is-spinning'), true); assert.equal(f.timers.size, 1, '键盘激活取消鼠标待执行动作');
  f.clock.advance(820); avatar.dispatch('keydown', { key: ' ', repeat: true }); assert.equal(avatar.classes.size, 0);
  f.changeMotion(true); avatar.dispatch('keydown', { key: ' ' });
  assert.equal(avatar.classes.has('is-static-egg'), true); assert.equal(avatar.classes.has('is-spinning'), false);
  avatar.dispatch('keydown', { key: 'ArrowRight' }); assert.notEqual(avatar.dataset.shape, 'blob'); assert.equal(avatar.classes.size, 0);
  avatar.dispatch('click', { detail: 1 }); f.hide(); f.clock.advance(1000); assert.equal(avatar.classes.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.document.documentElement.dataset.aboutVisible, 'false');
  f.escape(); assert.deepEqual(f.calls, ['close']); f.unload(); assert.equal(f.unsubscribed, 1);
});

test('试玩形态不覆盖版本提醒，官网与升级按钮仍仅调用现有About bridge', async () => {
  const f = fixture(), avatar = f.get('about-avatar'); await flush();
  f.receive({ state: 'ready', hasUpdate: true, latestVersion: '0.3.32' });
  avatar.dispatch('dblclick'); assert.equal(f.get('about-status').textContent, '发现新版本 0.3.32');
  await f.get('about-website').dispatch('click'); await f.get('about-open-release').dispatch('click');
  f.receive({ state: 'ready', hasUpdate: false }); await f.get('about-check-updates').dispatch('click');
  assert.deepEqual(f.calls, ['openWebsite', 'openRelease', 'checkUpdates']);
  const second = fixture(); await flush(); assert.equal(second.get('about-avatar').dataset.shape, 'blob', '新关于页从经典开始，试玩不保存');
  avatar.dispatch('click', { detail: 1 }); f.unload(); f.clock.advance(1000); assert.equal(avatar.classes.size, 0); assert.equal(f.timers.size, 0);
});

test('关于彩蛋保留内容满铺、完整名称、无常驻说明，并让高对比和减少动态覆盖装饰', () => {
  const html = fs.readFileSync(path.join(__dirname, '../about.html'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '../about.css'), 'utf8');
  const content = css.match(/^\.about-window \{[^}]+\}/m)[0];
  assert.doesNotMatch(content, /border(?:-radius)?\s*:/); assert.match(content, /width: 100%; height: 100%/);
  assert.match(html, /<button id="about-avatar"[^>]+aria-describedby="about-avatar-help"/);
  assert.match(html, /id="about-name">球球桌宠<\/h1>/); assert.match(html, /id="about-avatar-help" class="about-sr-only"/);
  assert.match(css, /about-drift 24s/); assert.match(css, /prefers-reduced-motion: reduce/);
  assert.ok(css.indexOf('background-image: linear-gradient(110deg, #9ed1ed') > css.indexOf('background: linear-gradient(110deg, #557eb6'), '深色标题渐变在base之后，避免被shorthand覆盖');
  assert.match(css, /:root\[data-color-mode="accessible"\] h1 \{ background: none; -webkit-text-fill-color: currentColor; \}/);
  assert.match(css, /:root\[data-color-mode="accessible"\] \.about-window::before \{ display: none; \}/);
});
