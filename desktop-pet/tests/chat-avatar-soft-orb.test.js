const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ absent = false, throwing = false } = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; }
    appendChild(node) { node.remove(); node.parent = this; this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parent = null; }); this.children = []; nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    querySelector() { return null; }
    get firstChild() { return this.children[0] || null; }
  }
  const instances = [], balls = [];
  const window = {
    PetCustomization: { normalizeAppearance: value => ({ ...value }), EYE_PRESETS: { original: null }, auroraReferenceTexture: () => null },
    EB_CUSTOM_SHAPES: { createShape: () => ({}) },
    EmotionBall: { config: { get: () => ({ raw: {} }) }, create(target) {
      const node = new Element('svg'); target.appendChild(node);
      const ball = { active: false, setActive(value) { this.active = value; }, destroy() { this.destroyed = true; node.remove(); } };
      balls.push(ball); return ball;
    } }
  };
  if (!absent) window.SoftOrb = { create(target, options) {
    if (throwing) throw new Error('WebGL unavailable');
    const node = new Element('canvas'); target.appendChild(node);
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    const orb = { options, node, active: false, draws: 0, destroyed: false,
      setActive(value) { this.active = value; }, renderStatic() { this.draws++; }, whenReady: () => ready,
      resolve, reject, destroy() { this.destroyed = true; this.active = false; node.remove(); } };
    instances.push(orb); return orb;
  } };
  const document = { createElement: tag => new Element(tag) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/chat-avatar.js'), 'utf8'), { window, document });
  return { target: new Element('span'), api: window.PetChatAvatar, instances, balls };
}
const appearance = { shape: 'soft-orb', orbMaterial: 'pearl', bodyColor: '#F9F8FF', orbSecondaryColor: '#B7A7EC', eyeColor: '#FDFDFD', auroraTransparency: 20 };

test('柔光团静态头像使用同一真实引擎，复用缓存且切换/动态接管释放资源', async () => {
  const f = fixture();
  f.api.render(f.target, appearance);
  const orb = f.instances[0];
  assert.equal(orb.options.autostart, false); assert.equal(orb.options.lite, true);
  assert.equal(orb.options.appearance.orbMaterial, 'pearl'); assert.equal(orb.draws, 1);
  assert.equal(f.target.dataset.avatarReady, 'false');
  f.api.render(f.target, { ...appearance }); assert.equal(f.instances.length, 1);
  orb.resolve(true); await Promise.resolve(); assert.equal(f.target.dataset.avatarReady, 'true');
  f.api.render(f.target, { ...appearance, orbMaterial: 'glass' }); assert.equal(orb.destroyed, true);
  const replacement = f.instances[1];
  assert.equal(require('../lib/soft-orb-model').palette(replacement.options.appearance).id, 'glass');
  const controller = f.api.create(f.target); assert.equal(replacement.destroyed, true);
  replacement.resolve(true); await Promise.resolve();
  controller.destroy(); assert.equal(f.target.children.length, 0);
});

test('柔光团动态头像就绪后才启动，隐藏、重用、切换与迟到ready均正确', async () => {
  const f = fixture(), controller = f.api.create(f.target);
  controller.update(appearance);
  const orb = f.instances[0]; assert.equal(orb.active, false);
  controller.update({ ...appearance }); assert.equal(f.instances.length, 1);
  controller.setActive(false); orb.resolve(true); await Promise.resolve();
  assert.equal(f.target.dataset.avatarReady, 'true'); assert.equal(orb.active, false);
  controller.setActive(true); assert.equal(orb.active, true);
  controller.update({ ...appearance, orbMaterial: 'glass' }); assert.equal(orb.destroyed, true);
  const late = f.instances[1];
  controller.update({ shape: 'blob', idleEyes: 'original', auroraTransparency: 0 });
  assert.equal(late.destroyed, true); assert.equal(f.target.dataset.avatarEngine, 'emotion-ball');
  late.resolve(true); await Promise.resolve(); assert.equal(f.target.dataset.avatarEngine, 'emotion-ball');
  controller.destroy(); assert.equal(f.balls[0].destroyed, true);
});

test('柔光团资源失败保持未就绪且不循环；销毁后回调不复活', async () => {
  for (const outcome of ['false', 'reject', 'destroy']) {
    const f = fixture(), controller = f.api.create(f.target); controller.update(appearance);
    const orb = f.instances[0];
    if (outcome === 'destroy') controller.destroy();
    if (outcome === 'reject') orb.reject(new Error('asset missing')); else orb.resolve(outcome === 'destroy');
    await Promise.resolve();
    assert.equal(orb.active, false);
    assert.equal(f.target.dataset.avatarReady, outcome === 'destroy' ? undefined : 'false');
    if (outcome !== 'destroy') { controller.setActive(true); assert.equal(orb.active, false); }
  }
});

test('柔光团引擎缺失或创建失败不会伪装成其他形态头像', () => {
  for (const options of [{ absent: true }, { throwing: true }]) {
    const f = fixture(options), controller = f.api.create(f.target);
    assert.doesNotThrow(() => controller.update(appearance));
    assert.equal(f.target.dataset.avatarEngine, 'soft-orb'); assert.equal(f.target.dataset.avatarReady, 'false');
    assert.equal(f.target.children.length, 0); assert.equal(f.balls.length, 0);
    controller.destroy();
  }
});

test('聊天和两种联动授权页按相同顺序加载柔光团依赖', () => {
  for (const page of ['chat.html', 'codex-consent.html', 'workbuddy-consent.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const files = ['soft-orb-model.js', 'soft-orb-motion.js', 'soft-orb-renderer.js', 'soft-orb.js', 'chat-avatar.js'];
    const positions = files.map(file => html.indexOf(`src="lib/${file}"`));
    assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), page);
  }
});
