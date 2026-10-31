const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../lib/soft-orb-model');

function events(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, value = {}) { for (const fn of [...(listeners.get(name) || [])]) fn(value); },
    listenerCount() { return [...listeners.values()].reduce((sum, rows) => sum + rows.size, 0); }
  });
}
function fixture({ autostart = true, settleOnDestroy = true } = {}) {
  const draws = [], frames = new Map(); let nextFrame = 0;
  const canvas = events({ dataset: {}, style: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }, remove() { this.removed = true; } });
  const faceImages=[];let created=0;
  const document = events({ currentScript: { src: 'file:///test/desktop-pet/lib/soft-orb.js' }, hidden: false,
    documentElement: { dataset: {} }, createElement: () => created++===0?canvas:{width:0,height:0,getContext:()=>({clearRect(){},drawImage(source){faceImages.push(source);}})} });
  const reduced = events({ matches: false });
  const window = { SoftOrbModel: model, devicePixelRatio: 2, matchMedia: () => reduced,
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    createSoftOrbRenderer(_canvas, assetPath) {
      let resolve;
      const draw = pose => draw.poses.push(pose);
      draw.poses = []; draw.assetPath = assetPath; draw.destroyed = false;
      draw.ready = new Promise(done => { resolve = done; }); draw.resolve = resolve;
      draw.destroy = lose => { draw.destroyed = true; draw.lose = lose; if (settleOnDestroy) resolve(false); };
      draws.push(draw); return draw;
    }
  };
  const target = { dataset: {}, append(node) { this.node = node; }, getBoundingClientRect: () => ({ width: 64, height: 64 }) };
  const context = vm.createContext({ window, document, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/soft-orb-motion.js'), 'utf8'), context);
  window.MGMotion = context.MGMotion;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/soft-orb.js'), 'utf8'), context);
  const orb = window.SoftOrb.create(target, { autostart, appearance: { shape: 'soft-orb', auroraTransparency: 25 } });
  const tick = now => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  return { orb, draws, frames, canvas, document, reduced, tick,faceImages };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const lose = f => f.canvas.emit('webglcontextlost', { preventDefault() {} });
const restore = f => f.canvas.emit('webglcontextrestored');

test('首次ready前contextloss保持同一就绪承诺，恢复后首次消费者收到成功', async () => {
  const f = fixture(); let observed = 'pending';
  const first = f.orb.whenReady(); first.then(ok => { observed = ok; });
  lose(f); assert.equal(f.draws[0].destroyed, true); assert.equal(f.draws[0].lose, false);
  await flush(); assert.equal(observed, 'pending'); assert.equal(f.frames.size, 0);
  restore(f); assert.equal(f.orb.whenReady(), first); assert.equal(f.draws.length, 2);
  f.draws[1].resolve(true); await flush();
  assert.equal(await first, true); assert.equal(observed, true); assert.equal(f.canvas.dataset.ready, 'true');
  assert.equal(f.frames.size, 1); assert.equal(f.draws[0].poses.length, 0);
  f.orb.destroy();
});

test('被替换renderer迟到成功不能提前绘制或替当前加载标记ready', async () => {
  const f = fixture({ settleOnDestroy: false }); let observed = 'pending';
  f.orb.whenReady().then(ok => { observed = ok; }); lose(f); restore(f);
  f.draws[0].resolve(true); await flush();
  assert.equal(observed, 'pending'); assert.equal(f.canvas.dataset.ready, 'false');
  assert.equal(f.draws[0].poses.length, 0); assert.equal(f.draws[1].poses.length, 0); assert.equal(f.frames.size, 0);
  f.draws[1].resolve(true); await flush();
  assert.equal(observed, true); assert.equal(f.draws[1].poses.length, 1); assert.equal(f.frames.size, 1);
  f.orb.destroy();
});

test('首次加载期间销毁会终结ready并清理监听，迟到回调不复活', async () => {
  const f = fixture({ settleOnDestroy: false }); const first = f.orb.whenReady();
  f.orb.destroy(); f.orb.destroy(); assert.equal(await first, false);
  f.draws[0].resolve(true); await flush();
  assert.equal(f.draws[0].poses.length, 0); assert.equal(f.frames.size, 0);
  assert.equal(f.canvas.removed, true); assert.equal(f.canvas.listenerCount(), 0);
  assert.equal(f.document.listenerCount(), 0); assert.equal(f.reduced.listenerCount(), 0);
});

test('已就绪后context恢复只启动当前renderer，隐藏和减少动态均不留rAF', async () => {
  const f = fixture(); const first = f.orb.whenReady(); f.draws[0].resolve(true); await first;
  assert.equal(f.canvas.style.opacity, '0.75'); assert.match(f.draws[0].assetPath, /desktop-pet\/assets\/soft-orb\/$/);
  lose(f); assert.equal(f.frames.size, 0); restore(f); f.draws[1].resolve(true); await flush();
  assert.equal(f.orb.whenReady(), first); assert.equal(f.frames.size, 1);
  f.document.hidden = true; f.document.emit('visibilitychange'); assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); assert.equal(f.frames.size, 1);
  f.reduced.matches = true; f.reduced.emit('change'); assert.equal(f.frames.size, 0);
  f.reduced.matches = false; f.reduced.emit('change'); assert.equal(f.frames.size, 1);
  f.orb.destroy(); assert.equal(f.frames.size, 0);
});

test('静态头像加载完成不启动rAF，显式预览可播放并在完成后停止', async () => {
  const f = fixture({ autostart: false }); f.orb.renderStatic(); f.draws[0].resolve(true); await f.orb.whenReady();
  assert.equal(f.frames.size, 0); assert.equal(f.draws[0].poses.length, 1);
  f.orb.setEmotion('03'); assert.equal(f.frames.size, 0, '静态头像表情更新不能偷偷启动');
  f.orb.stopMotion(); f.orb.playAction('fan'); assert.equal(f.frames.size, 1);
  for (let t = 100; t < 3600; t += 17) f.tick(t);
  assert.equal(f.canvas.dataset.action, 'idle'); assert.equal(f.frames.size, 0);
  f.orb.destroy();
});

 test('左右朝向镜像整个柔光团，镜像后目光仍跟随屏幕方向',async()=>{
  const f=fixture();f.draws[0].resolve(true);await f.orb.whenReady();
  f.orb.setFacing('right');assert.equal(f.canvas.style.scale,'-1 1');
  f.orb.setGaze(1,0);for(let t=100;t<500;t+=17)f.tick(t);
  const right=f.draws[0].poses.at(-1);
  f.orb.setFacing('left');assert.equal(f.canvas.style.scale,'1 1');
  const left=f.draws[0].poses.at(-1);assert.ok(right.lookX<0);assert.ok(left.lookX>0);assert.equal(right.lookX,-left.lookX);
  f.orb.destroy();
 });

 test('额度环适配因子与朝向组合，转身或退出额度环不互相覆盖',async()=>{
  const f=fixture();f.draws[0].resolve(true);await f.orb.whenReady();
  f.canvas.softOrbQuota.setScale(.75);f.orb.setFacing('right');assert.equal(f.canvas.style.scale,'-0.75 0.75');
  f.orb.setFacing('left');assert.equal(f.canvas.style.scale,'0.75 0.75');
  f.canvas.softOrbQuota.setScale(1);assert.equal(f.canvas.style.scale,'1 1');
  f.orb.setFacing('right');assert.equal(f.canvas.style.scale,'-1 1');
  f.orb.destroy();assert.equal(f.canvas.softOrbQuota,undefined);
 });

 test('液面单独采样真实眼睛pass后立即恢复正常画面，不改变动作与颜色',async()=>{
  const f=fixture();f.draws[0].resolve(true);await f.orb.whenReady();f.orb.playAction('love');
  const before=f.canvas.dataset.action,face=f.canvas.softOrbQuota.getFaceCanvas(),draws=f.draws[0].poses;
  assert.equal(face.width,f.canvas.width);assert.equal(face.height,f.canvas.height);assert.equal(draws.at(-2).quotaFaceOnly,1);
  assert.equal(draws.at(-1).quotaFaceOnly,undefined);assert.equal(draws.at(-2).love,draws.at(-1).love);
  assert.equal(f.canvas.dataset.action,before);assert.equal(f.faceImages.length,1);f.orb.destroy();
 });

 test('非卡片额度关闭地面阴影，重复刷新不重绘，液面只取身体与眼睛并可恢复',async()=>{
  const f=fixture();f.draws[0].resolve(true);await f.orb.whenReady();const poses=f.draws[0].poses;
  f.canvas.softOrbQuota.setMode('pool');assert.equal(poses.at(-1).shadowAlpha,0);const count=poses.length;
  f.canvas.softOrbQuota.setMode('pool');f.canvas.softOrbQuota.setScale(.8);assert.equal(poses.length,count,'模式不变和scale变化不重绘主体');
  const layers=f.canvas.softOrbQuota.getPoolCanvases();assert.ok(layers.body&&layers.face);
  assert.equal(poses.at(-3).quotaBodyOnly,1);assert.equal(poses.at(-2).quotaFaceOnly,1);assert.equal(poses.at(-1).shadowAlpha,0);
  f.canvas.softOrbQuota.setMode('card');assert.notEqual(poses.at(-1).shadowAlpha,0);f.orb.destroy();
 });
