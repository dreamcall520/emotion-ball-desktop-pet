const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Fireworks = require('../lib/sheep-fireworks');

test('平时45/60/75秒短动作不饿死120/300秒烟花截止，到点等回idle才起放', () => {
  for (const [random, gap] of [[0,120000],[1,300000]]) {
    const player=Fireworks.create(()=>random);player.frame(0,true,false,true);
    const starts=new Set();
    for (const interval of [45000,60000,75000])for(let t=interval;t<gap;t+=interval)starts.add(t);
    for(const t of [...starts].sort((a,b)=>a-b)) {
      assert.equal(player.frame(t,true,false,false),null);
      assert.equal(player.frame(t+1000,true,false,true),null);
    }
    assert.equal(player.frame(gap-1,true,false,false),null);
    assert.equal(player.frame(gap+1000,true,false,false),null);
    const burst=player.frame(gap+2000,true,false,true);
    assert.ok(burst);assert.equal(burst.elapsedMs,0);
  }
});

test('短动作取消当前簇仍保下一截止，硬关闭才重等', () => {
  const player=Fireworks.create(()=>0);player.frame(0,true,false,true);
  assert.ok(player.frame(120000,true,false,true));
  assert.equal(player.frame(121000,true,false,false),null);
  assert.equal(player.frame(244999,true,false,true),null);
  assert.ok(player.frame(245000,true,false,true));
  assert.equal(player.frame(245100,false,false,true),null);
  assert.equal(player.frame(300000,true,false,true),null);
  assert.equal(player.frame(419999,true,false,true),null);
  assert.ok(player.frame(420000,true,false,true));
});

test('平时默认120/300秒，春节显式20/40秒；等待日期切换重等，活动日期切换不抖动', () => {
  for (const [random, delay] of [[0,120000],[1,300000]]) {
    const player = Fireworks.create(() => random);
    player.frame(0,true); assert.equal(player.frame(delay-1,true),null);
    assert.ok(player.frame(delay,true));
  }
  const player = Fireworks.create(() => .5);
  player.frame(0,true,false);
  assert.equal(player.frame(1000,true,true),null);
  assert.equal(player.frame(30999,true,true),null);
  const a = player.frame(31000,true,true), b = player.frame(31000,true,false);
  assert.deepEqual(a,b);
  assert.equal(a.bursts,player.frame(32000,true,false).bursts);
  assert.equal(player.frame(37000,true,false),null);
  assert.equal(player.frame(246999,true,false),null);
  assert.ok(player.frame(247000,true,false));
});

test('同一枚先连续升空1秒，再展开停留慢落；末枚自然收尾不截断', () => {
  const player = Fireworks.create(() => 0); player.frame(0,true,true);
  const base = player.frame(20000,true,true), burst = base.bursts[0];
  function sample(age) {
    const points=[],alphas=[]; const ctx={save(){},restore(){},beginPath(){},moveTo(x,y){points.push([x,y])},lineTo(x,y){points.push([x,y])},stroke(){alphas.push(this.globalAlpha)}};
    Fireworks.draw(ctx,{...base,elapsedMs:age,bursts:[burst]});return{points,alphas};
  }
  const low=sample(100),high=sample(900),opening=sample(1450),held=sample(2100),falling=sample(3600),end=sample(burst.lifeMs-1);
  assert.ok(low.points.length && high.points.length);
  assert.ok(Math.min(...high.points.map(p=>p[1]))<Math.min(...low.points.map(p=>p[1]))-100);
  assert.ok(low.alphas.length<=12 && high.alphas.length<=12,'升空只画尾迹和弹头');
  assert.ok(opening.alphas.length>20 && held.alphas.length>20);
  assert.ok(Math.max(...held.alphas)>.5,'展开后有明确可见停留');
  assert.ok(Math.max(...falling.points.map(p=>p[1]))>Math.max(...held.points.map(p=>p[1]))+10);
  assert.ok(Math.max(...end.alphas)<.01,'尾端慢慢淡出');
  assert.equal(sample(burst.lifeMs).points.length,0);
  assert.ok(base.bursts.every(b=>b.delayMs+b.lifeMs<=base.durationMs));
  assert.equal(new Set(base.bursts.map(b=>`${b.x},${b.y}`)).size,base.bursts.length,'极端随机仍错落而不重叠同点');
});

test('纯时钟20–40秒间隔、5000–7000毫秒连续簇，随机端点分别4和8朵', () => {
  for (const [random, gap, duration, count] of [[0, 20000, 5000, 4], [1, 40000, 7000, 8]]) {
    const player = Fireworks.create(() => random);
    assert.equal(player.frame(100, true, true), null);
    assert.equal(player.frame(100 + gap - 1, true, true), null);
    const frame = player.frame(100 + gap, true, true);
    assert.equal(frame.durationMs, duration);
    assert.equal(frame.bursts.length, count);
    assert.equal(frame.progress, 0);
    assert.ok(player.frame(100 + gap + duration - 1, true, true));
    assert.equal(player.frame(100 + gap + duration, true, true), null);
    assert.equal(player.frame(100 + gap * 2 + duration - 1, true, true), null);
    assert.ok(player.frame(100 + gap * 2 + duration, true, true));
  }
});

test('关闭即取消烟花和旧截止，恢复后重新等完整空档', () => {
  const player = Fireworks.create(() => 0);
  player.frame(0, true, true);
  assert.ok(player.frame(20000, true, true));
  assert.equal(player.frame(20500, false), null);
  assert.equal(player.frame(90000, true, true), null);
  assert.equal(player.frame(109999, true, true), null);
  assert.equal(player.frame(110000, true, true).progress, 0);
  assert.equal(player.frame(NaN, true, true), null);
  assert.equal(player.frame(200000, true, true), null);
});

test('同时间/帧内位置和数量不抖动，30fps key随帧推进', () => {
  const player = Fireworks.create(() => .5);
  player.frame(0, true, true);
  const a = player.frame(30000, true, true), b = player.frame(30000, true, true), c = player.frame(30010, true, true);
  assert.deepEqual(a, b);
  assert.equal(a.key, c.key);
  assert.equal(a.bursts, c.bursts);
  assert.notEqual(a.key, player.frame(30034, true, true).key);
});

test('停用完全不抽随机，时钟倒退重建空档，迟到调用从当前时刻起放', () => {
  let calls = 0;
  const player = Fireworks.create(() => { calls++; return 0; });
  for (let i = 0; i < 10; i++) assert.equal(player.frame(i, false), null);
  assert.equal(calls, 0);
  player.frame(10000, true, true);
  assert.equal(player.frame(0, true, true), null);
  assert.equal(player.frame(19999, true, true), null);
  assert.equal(player.frame(999999, true, true).elapsedMs, 0);
});

test('随机多寡与错峰起放稳定，上方两角空间避开中部脸手', () => {
  let seed = 1234;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const player = Fireworks.create(random), counts = new Set(), sides = new Set();
  let now = 0;
  for (let cycle = 0; cycle < 150; cycle++) {
    player.frame(now, true, true); now += 40000;
    const frame = player.frame(now, true, true); counts.add(frame.bursts.length);
    assert.ok(frame.durationMs >= 5000 && frame.durationMs <= 7000);
    for (const burst of frame.bursts) {
      assert.ok(burst.x < 80 || burst.x > 240);
      sides.add(burst.x < 160 ? 'left' : 'right');
      assert.ok(burst.y >= 47 && burst.y <= 84);
      assert.ok(burst.rocketMs >= 1000 && burst.rocketMs <= 1400);
      assert.ok(burst.radius >= 30 && burst.radius <= 44);
      assert.ok(burst.lifeMs + burst.delayMs <= frame.durationMs);
      assert.ok(burst.delayMs >= 0 && burst.delayMs <= 2750);
    }
    assert.deepEqual(player.frame(now + 1, true, true).bursts, frame.bursts);
    now += frame.durationMs; assert.equal(player.frame(now, true, true), null);
  }
  assert.deepEqual([...counts].sort(), [4, 5, 6, 7, 8]);
  assert.deepEqual([...sides].sort(), ['left', 'right']);
});

test('draw仅画有界细线、完全恢复上下文状态，不画大光团', () => {
  const states = [], points = [], context = { globalAlpha: .42, globalCompositeOperation: 'multiply', lineCap: 'butt', lineWidth: 7, strokeStyle: 'blue', shadowBlur:12,
    save() { states.push([this.globalAlpha, this.globalCompositeOperation, this.lineCap, this.lineWidth, this.strokeStyle, this.shadowBlur]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation, this.lineCap, this.lineWidth, this.strokeStyle, this.shadowBlur] = states.pop(); },
    beginPath() {}, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, stroke() {} };
  const player = Fireworks.create(() => 1); player.frame(0, true, true); player.frame(40000, true, true);
  for (let step = 1; step < 70; step++) Fireworks.draw(context, player.frame(40000 + step * 100, true, true));
  assert.ok(points.length > 100);
  assert.ok(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < 320 && y > 0 && y < 319));
  assert.ok(points.every(([x, y]) => !(x >= 80 && x <= 240 && y >= 95)));
  assert.deepEqual([context.globalAlpha, context.globalCompositeOperation, context.lineCap, context.lineWidth, context.strokeStyle, context.shadowBlur], [.42, 'multiply', 'butt', 7, 'blue',12]);
  assert.equal(states.length, 0);
  Fireworks.draw(context, null);
});

test('浏览器UMD无DOM、无计时器可加载，所有真实使用页先于SheepSkin加载', () => {
  const window = {};
  const source = fs.readFileSync(path.join(__dirname, '../lib/sheep-fireworks.js'), 'utf8');
  vm.runInNewContext(source, { window, Math, Number, Object, Array });
  assert.equal(typeof window.SheepFireworks.create, 'function');
  for (const file of ['index.html', 'customize.html', 'chat.html', 'about.html', 'codex-consent.html', 'sheep-preview.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(html.indexOf('lib/sheep-fireworks.js') >= 0, file);
    assert.ok(html.indexOf('lib/sheep-fireworks.js') < html.indexOf('lib/sheep-skin.js'), file);
  }
});


test('细暖描边与彩芯沿同一路径、同一fade衰减，细度不变黑粗边', () => {
  const player=Fireworks.create(()=>0);player.frame(0,true,true);const frame=player.frame(20000,true,true);
  for(const elapsedMs of [500,1500,3000,4249]) {
    const strokes=[],ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push({width:this.lineWidth,alpha:this.globalAlpha,color:this.strokeStyle})}};
    Fireworks.draw(ctx,{...frame,elapsedMs,bursts:[frame.bursts[0]]});
    assert.equal(strokes.length%2,0);assert.ok(strokes.length>0);
    for(let i=0;i<strokes.length;i+=2){const edge=strokes[i],core=strokes[i+1];
      assert.equal(edge.color,'#81503e');assert.ok(Math.abs(edge.width-core.width-.85)<1e-10);
      assert.ok(edge.width<=2.45);assert.ok(Math.abs(edge.alpha-core.alpha*.66)<1e-10);
      assert.notEqual(core.color,edge.color);assert.ok(core.alpha<=.95);
    }
    if(elapsedMs===4249)assert.ok(strokes.every(s=>s.alpha<.01),'最后描边也淡出');
  }
});
