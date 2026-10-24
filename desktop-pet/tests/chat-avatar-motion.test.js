const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; }
    appendChild(node) { node.remove(); node.parent = this; this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parent = null; }); this.children = []; nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    querySelector(selector) { return selector === ':scope > svg' ? this.children.find(node => node.tag === 'svg') : null; }
    get firstChild() { return this.children[0]; }
  }
  const balls = [], rives = [], registrations = [];
  const window = {};
  const document = { createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) };
  const context = vm.createContext({ window, document });
  for (const file of ['emotion-ball/js/rings.js','emotion-ball/js/custom-shapes.js','desktop-pet/lib/customization.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),context);
  }
  window.EmotionBall = {
    config: { get: () => ({ raw: { id: '02', pool: [0,8] } }), register: value => registrations.push(value) },
    create(target, options) {
      const svg = new Element(options.shape === 'new-year-sheep' ? 'canvas' : 'svg'); target.appendChild(svg);
      const ball = { options, svg, active: options.autostart, destroyed: false,
        setActive(value) { this.active = value; }, destroy() { this.destroyed = true; this.active = false; svg.remove(); } };
      if (options.shape === 'new-year-sheep') {
        let resolve, reject;
        const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
        ball.whenReady = () => ready;
        ball.resolve = (value, fallback = false) => { svg.dataset.ready = fallback ? 'static' : value ? 'true' : 'error'; resolve(value); };
        ball.reject = () => { svg.dataset.ready = 'error'; reject(new Error('资源加载失败')); };
      }
      balls.push(ball); return ball;
    }
  };
  window.AuroraRive = {
    eligible: appearance => appearance.shape === 'aurora-cloud' && appearance.eyeScale === 1 && appearance.eyeSpacing === 1 && appearance.eyeHeight === 0 && appearance.idleEyes === 'original',
    create(target, appearance) {
      const svg = target.querySelector(':scope > svg');
      const canvas = new Element('canvas'); target.appendChild(canvas);
      canvas.style.visibility = 'hidden';
      let resolve;
      const ready = new Promise(done => { resolve = done; });
      const rive = { appearance, canvas, active: true, destroyed: false,
        resolve(value) { if (value && !this.destroyed) { svg.style.visibility = 'hidden'; canvas.style.visibility = 'visible'; } resolve(value); },
        whenReady: () => ready, setActive(value) { this.active = value; },
        destroy() { this.destroyed = true; this.active = false; svg.style.visibility = ''; canvas.remove(); } };
      rives.push(rive); return rive;
    }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/chat-avatar.js'),'utf8'),context);
  const target = new Element('span');
  return { target, controller: window.PetChatAvatar.create(target), balls, rives, registrations, customization: window.PetCustomization };
}

test('普通头像用现有轻量引擎；形态、配色、眼睛和自定义轮廓完整同步', () => {
  const f = fixture();
  for (const shape of ['blob','cloud','square']) {
    f.controller.update({ shape, bodyColor:'#28415C',eyeColor:'#F4E8C8',eyeScale:1.2,eyeSpacing:1.3,eyeHeight:8,
      auroraTransparency:42,shapeTuning:{width:1.13,height:1,softness:.72,asymmetry:0} });
    const ball = f.balls.at(-1);
    assert.equal(ball.options.shape,shape); assert.equal(ball.options.color,'#28415C');
    assert.equal(ball.options.eyeColor,'#F4E8C8'); assert.equal(ball.options.eyeScale,1.2);
    assert.equal(ball.options.eyeSpacing,1.3); assert.equal(ball.options.eyeHeight,8);
    assert.ok(ball.options.customShape.ring.length); assert.equal(ball.options.idle,false);
    assert.equal(ball.options.lite,true); assert.equal(ball.options.emotion,'02');
    assert.ok(Math.abs(Number(ball.svg.style.opacity) - .58) < 1e-10); assert.equal(f.target.dataset.avatarEngine,'emotion-ball');
    assert.equal(f.target.dataset.avatarActive,'true'); assert.equal(f.target.dataset.avatarReady,'true');
  }
  assert.ok(f.balls.slice(0,-1).every(ball => ball.destroyed));
  assert.equal(f.rives.length,0);
});

test('动态小羊传递主题，首帧就绪后再标记ready，重复更新不重建', async () => {
  const f = fixture(), appearance = { shape: 'new-year-sheep', sheepTheme: 'halloween', auroraTransparency: 23 };
  f.controller.update(appearance);
  const sheep = f.balls[0];
  assert.equal(sheep.options.sheepTheme, 'halloween');
  assert.equal(sheep.options.portraitRaster, true);
  assert.equal(sheep.options.auroraTransparency, 23);
  assert.equal(f.target.dataset.avatarReady, 'false');
  f.controller.update({ ...appearance });
  assert.equal(f.balls.length, 1);
  sheep.resolve(true); await Promise.resolve();
  assert.equal(f.target.dataset.avatarReady, 'true');
  f.controller.setActive(false);
  assert.equal(sheep.active, false);
  f.controller.destroy();
  assert.equal(sheep.destroyed, true);
  assert.equal(f.target.dataset.avatarReady, undefined);
});

test('小羊换主题、换形态或销毁后，迟到ready不能改写当前头像状态', async () => {
  for (const transition of ['theme', 'shape', 'destroy']) {
    const f = fixture();
    f.controller.update({ shape: 'new-year-sheep', sheepTheme: 'halloween' });
    const previous = f.balls[0];
    if (transition === 'theme') f.controller.update({ shape: 'new-year-sheep', sheepTheme: 'christmas' });
    else if (transition === 'shape') f.controller.update({ shape: 'cloud' });
    else f.controller.destroy();
    assert.equal(previous.destroyed, true);
    const ready = f.target.dataset.avatarReady;
    previous.resolve(true); await Promise.resolve();
    assert.equal(f.target.dataset.avatarReady, ready, transition);
    if (transition === 'theme') {
      assert.equal(f.balls[1].options.sheepTheme, 'christmas');
      assert.equal(ready, 'false');
      f.balls[1].resolve(true); await Promise.resolve();
      assert.equal(f.target.dataset.avatarReady, 'true');
    } else if (transition === 'shape') assert.equal(f.target.dataset.shape, 'cloud');
    else assert.equal(f.target.children.length, 0);
  }
});

test('小羊资源失败保持未就绪，已绘制静态回退可就绪，迟到失败不影响新形态', async () => {
  for (const result of ['false', 'reject', 'static']) {
    const f = fixture();
    f.controller.update({ shape: 'new-year-sheep', sheepTheme: 'auto' });
    if (result === 'reject') f.balls[0].reject();
    else f.balls[0].resolve(result === 'static', result === 'static');
    await Promise.resolve();
    assert.equal(f.target.dataset.avatarReady, result === 'static' ? 'true' : 'false');
    assert.equal(f.balls[0].svg.dataset.ready, result === 'static' ? 'static' : 'error');
  }
  const f = fixture();
  f.controller.update({ shape: 'new-year-sheep' });
  f.controller.update({ shape: 'blob' });
  f.balls[0].reject(); await Promise.resolve();
  assert.equal(f.target.dataset.avatarReady, 'true');
  assert.equal(f.target.dataset.shape, 'blob');
});

test('自选常驻眼睛由原引擎眼环预设驱动，保留当前表情设置', () => {
  const f = fixture();
  const idleEyes = Object.keys(f.customization.EYE_PRESETS).find(key => f.customization.EYE_PRESETS[key] !== null);
  f.controller.update({ idleEyes });
  assert.equal(f.balls[0].options.emotion,'50');
  assert.equal(f.registrations[0].pool[0],f.customization.EYE_PRESETS[idleEyes]);
});

test('经典A→真实Rive→经典A清理旧实例，迟到ready不能抹掉新头像', async () => {
  const f = fixture(), a = { shape:'blob',bodyColor:'#28415C' };
  f.controller.update(a); const original = f.balls[0];
  f.controller.update({ shape:'aurora-cloud',auroraContour:'six-lobe' },'data:image/png;base64,AAAA');
  const rive = f.rives[0];
  assert.equal(original.destroyed,true); assert.equal(f.target.dataset.avatarEngine,'rive');
  assert.equal(f.balls[1].active,false); assert.equal(f.target.dataset.avatarReady,'false');
  f.controller.update(a); const next = f.balls[2];
  assert.equal(rive.destroyed,true); assert.equal(f.balls[1].destroyed,true);
  assert.equal(next.active,true); assert.equal(f.target.firstChild,next.svg);
  rive.resolve(true); await Promise.resolve();
  assert.equal(f.target.firstChild,next.svg); assert.equal(f.target.dataset.avatarEngine,'emotion-ball');
});

test('相同外观与迟到原生截图不重启已运行的Rive，保留真实颜色与轮廓', async () => {
  const f = fixture(), appearance = { shape:'aurora-cloud',auroraContour:'six-lobe',auroraStyle:'simple',
    bodyColor:'#563DA8',glowPinkColor:'#EE83D8',glowGoldColor:'#EDC77C',auroraTransparency:42 };
  f.controller.update(appearance,'data:image/png;base64,AAAA');
  f.controller.update(appearance,'data:image/png;base64,BBBB');
  assert.equal(f.rives.length,1); assert.equal(f.balls.length,1);
  assert.equal(f.rives[0].appearance.auroraContour,'six-lobe'); assert.equal(f.rives[0].appearance.bodyColor,'#563DA8');
  assert.equal(f.rives[0].appearance.auroraTransparency,42);
  const poster = f.target.children.find(node => node.tag === 'img'); assert.equal(poster.src,'data:image/png;base64,BBBB');
  f.rives[0].resolve(true); await Promise.resolve();
  assert.equal(poster.parent,null); assert.equal(f.target.dataset.avatarReady,'true');
  f.controller.update(appearance,'data:image/png;base64,CCCC'); assert.equal(f.rives.length,1);
});

test('保存幻彩时保留已呈现头像，首帧就绪前不闪现深紫备用图', async () => {
  const f = fixture(); f.controller.update({shape:'cloud',bodyColor:'#28415C'});
  const original = f.balls[0];
  f.controller.update({shape:'aurora-cloud',auroraContour:'six-lobe'});
  const replacement = f.balls[1], rive = f.rives[0];
  assert.equal(original.destroyed,false); assert.equal(original.active,true);
  assert.equal(original.svg.parent.style.position,'absolute');
  assert.equal(f.target.querySelector(':scope > svg'),replacement.svg);
  assert.equal(replacement.svg.style.visibility,'hidden');
  assert.equal(rive.canvas.style.visibility,'hidden'); assert.equal(f.target.dataset.avatarReady,'false');
  rive.resolve(true); await Promise.resolve();
  assert.equal(original.destroyed,true); assert.equal(original.svg.parent,null);
  assert.equal(replacement.svg.style.visibility,'hidden'); assert.equal(rive.canvas.style.visibility,'visible');
  assert.equal(f.target.children.some(node => node.tag === 'span'),false);
  assert.equal(f.target.dataset.avatarReady,'true'); assert.equal(rive.active,true);
});

test('连续保存幻彩配色保留已呈现的真实canvas，取消加载与迟到ready不提前替换', async () => {
  const f = fixture(); f.controller.update({shape:'aurora-cloud',bodyColor:'#8B72D8'});
  const original = f.rives[0]; original.resolve(true); await Promise.resolve();
  f.controller.update({shape:'aurora-cloud',bodyColor:'#563DA8'});
  const canceled = f.rives[1];
  assert.equal(original.destroyed,false); assert.equal(original.canvas.style.visibility,'visible');
  f.controller.setActive(false); assert.equal(original.active,false); assert.equal(canceled.active,false);
  f.controller.update({shape:'aurora-cloud',bodyColor:'#9476DD'});
  const replacement = f.rives[2];
  assert.equal(canceled.destroyed,true); assert.equal(original.destroyed,false);
  assert.equal(f.target.children.filter(node => node.tag === 'span').length,1);
  canceled.resolve(true); await Promise.resolve();
  assert.equal(original.destroyed,false); assert.equal(f.target.dataset.avatarReady,'false');
  replacement.resolve(true); await Promise.resolve();
  assert.equal(original.destroyed,true); assert.equal(replacement.active,false);
  assert.equal(replacement.appearance.bodyColor,'#9476DD'); assert.equal(f.target.dataset.avatarReady,'true');
});

test('无截图开启加载后，迟到截图能接替旧头像，不重新创建Rive', async () => {
  const f = fixture(); f.controller.update({shape:'blob'}); const original = f.balls[0];
  const appearance = {shape:'aurora-cloud',auroraContour:'six-lobe'};
  f.controller.update(appearance); assert.equal(original.destroyed,false);
  f.controller.update(appearance,'data:image/png;base64,AAAA');
  assert.equal(original.destroyed,true); assert.equal(f.rives.length,1);
  assert.equal(f.balls[1].svg.style.visibility,'hidden');
  const poster = f.target.children.find(node => node.tag === 'img'); assert.equal(poster.src,'data:image/png;base64,AAAA');
  f.rives[0].resolve(true); await Promise.resolve();
  assert.equal(poster.parent,null); assert.equal(f.target.dataset.avatarReady,'true');
});

test('加载中切回普通形态或销毁，释放保留与加载中的两组实例', async () => {
  for (const action of ['ordinary','destroy']) {
    const f = fixture(); f.controller.update({shape:'cloud'});
    f.controller.update({shape:'aurora-cloud'}); const canceled = f.rives[0];
    if (action === 'ordinary') f.controller.update({shape:'square'});
    else f.controller.destroy();
    assert.equal(f.balls[0].destroyed,true); assert.equal(f.balls[1].destroyed,true); assert.equal(canceled.destroyed,true);
    canceled.resolve(true); await Promise.resolve();
    assert.equal(f.target.children.some(node => node.tag === 'span'),false);
    if (action === 'ordinary') { assert.equal(f.target.firstChild,f.balls[2].svg); assert.equal(f.target.dataset.shape,'square'); }
    else assert.equal(f.target.children.length,0);
  }
});

test('新幻彩加载失败后释放上一头像并显示当前保存配色的备用引擎', async () => {
  const f = fixture(); f.controller.update({shape:'blob'});
  f.controller.update({shape:'aurora-cloud',bodyColor:'#563DA8'});
  assert.equal(f.balls[0].destroyed,false);
  f.rives[0].resolve(false); await Promise.resolve();
  assert.equal(f.balls[0].destroyed,true); assert.equal(f.target.children.some(node => node.tag === 'span'),false);
  assert.equal(f.balls[1].svg.style.visibility,''); assert.equal(f.balls[1].active,true);
  assert.equal(f.balls[1].options.color,'#563DA8'); assert.equal(f.target.dataset.avatarReady,'true');
});

test('隐藏或减少动态时引擎与Rive均暂停，隐藏中切换也不偷偷启动', async () => {
  const f = fixture(); f.controller.setActive(false); f.controller.update({shape:'cloud'});
  assert.equal(f.balls[0].options.autostart,false); assert.equal(f.balls[0].active,false);
  f.controller.update({shape:'aurora-cloud'}); const rive = f.rives[0];
  assert.equal(rive.active,false); rive.resolve(true); await Promise.resolve();
  assert.equal(rive.active,false); assert.equal(f.target.dataset.avatarActive,'false');
  f.controller.setActive(true); assert.equal(rive.active,true); assert.equal(f.balls[1].active,false);
  f.controller.setActive(false); assert.equal(rive.active,false);
});

test('Rive加载失败使用当前形态的既有引擎，不留下空白或丢失颜色', async () => {
  const f = fixture(); f.controller.update({shape:'aurora-cloud',bodyColor:'#563DA8'},'data:image/png;base64,AAAA');
  f.rives[0].resolve(false); await Promise.resolve();
  assert.equal(f.rives[0].destroyed,true); assert.equal(f.target.dataset.avatarEngine,'emotion-ball');
  assert.equal(f.balls[0].active,true); assert.equal(f.balls[0].svg.style.visibility,'');
  assert.equal(f.target.children.some(node => node.tag === 'img'),false);
  assert.equal(f.balls[0].options.color,'#563DA8');
});

test('销毁唯一头像控制器释放所有实例；迟到Rive、再调用update均不重建', async () => {
  const f = fixture(); f.controller.update({shape:'aurora-cloud'});
  f.controller.destroy(); f.controller.destroy(); f.rives[0].resolve(true); await Promise.resolve();
  f.controller.update({shape:'blob'}); f.controller.setActive(true);
  assert.ok(f.balls.every(ball => ball.destroyed)); assert.ok(f.rives.every(rive => rive.destroyed));
  assert.equal(f.target.children.length,0); assert.equal(f.target.dataset.avatarActive,'false');
});
