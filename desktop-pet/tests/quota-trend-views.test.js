const test = require('node:test');
const assert = require('node:assert/strict');
const { curves, path } = require('../quota-trend-curve');
const { build, dayStart, GAP } = require('../quota-daily-model');

test('圆润连线穿过每个已知点，转折与稀密采样之间不超出端点范围',() => {
  for (const points of [[],[[0,50]],[[0,100],[10,50]],[[0,100],[1,99],[2,99],[40,70],[40.1,60],[80,0]],[[0,50],[1,60],[5,40],[6,40]]]) {
    const segments = curves(points);
    assert.equal(segments.length,Math.max(0,points.length-1));
    assert.ok(!/NaN|Infinity/.test(path(points)));
    segments.forEach(([a,b,c,d],index) => {
      assert.deepEqual(a,points[index]); assert.deepEqual(d,points[index+1]);
      for (let i = 0; i <= 100; i++) {
        const t=i/100, q=1-t, y=q**3*a[1]+3*q*q*t*b[1]+3*q*t*t*c[1]+t**3*d[1];
        assert.ok(y >= Math.min(a[1],d[1])-1e-9 && y <= Math.max(a[1],d[1])+1e-9);
      }
    });
  }
});

test('每日参考区分没记录、一次记录、有效零消耗和小于1%的变化',() => {
  const start=dayStart(Date.now()), end=start+3*86400000+60000;
  const samples=[{at:start+86400000,remaining:50},{at:start+2*86400000,remaining:50},
    {at:start+2*86400000+60000,remaining:50},{at:start+3*86400000,remaining:50},
    {at:end,remaining:49.98}];
  const days=build(samples,{start,end});
  assert.deepEqual(days.map(day=>[day.count,day.amount]),[[0,null],[1,null],[2,0],[2,.02]]);
  assert.deepEqual(build(samples,{start:NaN,end}),[]);
});

test('缺口、额度上升、大幅校正与重置不计入已记录消耗',() => {
  const start=dayStart(Date.now()), at=i=>start+i*60000;
  const samples=[[0,80],[1,79],[6,60],[7,70],[8,40],[9,39],[10,38]].map(([i,remaining])=>({at:at(i),remaining}));
  const [day]=build(samples,{start,end:at(10),boundaries:[at(10)]});
  assert.equal(day.amount,2); assert.equal(day.correction,true); assert.equal(day.reset,true); assert.equal(day.partial,true);
  assert.equal(build([{at:start,remaining:80},{at:start+GAP,remaining:70}],{start,end:start+GAP})[0].amount,null);
});

test('按用户本地日历分日，跨午夜不把无法归属的下降硬算到一天，夏令时不漏日',() => {
  const previous=process.env.TZ;
  try {
    process.env.TZ='America/New_York';
    const start=Date.parse('2026-03-07T00:00:00-05:00'), end=Date.parse('2026-03-09T00:01:00-04:00');
    const samples=[{at:Date.parse('2026-03-07T23:59:00-05:00'),remaining:50},
      {at:Date.parse('2026-03-08T00:01:00-05:00'),remaining:49},
      {at:Date.parse('2026-03-08T00:02:00-05:00'),remaining:48}];
    const days=build(samples,{start,end});
    assert.deepEqual(days.map(day=>new Date(day.at).getDate()),[7,8,9]);
    assert.equal(days[2].at-days[1].at,23*3600000);
    assert.deepEqual(days.map(day=>day.amount),[null,1,null]);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ=previous; }
});
