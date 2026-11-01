const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../lib/soft-orb-model');
require('../lib/soft-orb-motion');
const motion=globalThis.MGMotion;

test('柔光团全部动作保持轮廓和比例，只有明确授权的飞船收纳等比缩小',()=>{
  for(let i=0;i<38*120;i++){
    const t=i/120,p=motion.at(t);
    for(const value of Object.values(p))if(typeof value==='number')assert(Number.isFinite(value));
    assert.equal(p.squash,0);assert.equal(p.flatness,0);assert.equal(p.roundness,0);assert.equal(p.volume,1);
    if(t<26||t>=30)assert.equal(p.modelScale,1);else assert(p.modelScale>=.059&&p.modelScale<=1);
  }
  assert(motion.at(27.8).modelScale<.15);assert.equal(motion.at(28.2).bodyFill,0);assert(motion.at(28.7).shipDepart>.9);
  assert.deepEqual(motion.at(0),motion.at(38));
});
test('真实任务kind驱动完成和失败，额度jelly不冒充失败；所有完成变体均播足四秒',()=>{
  for(const id of ['hop','spin']){
    const action=model.actionForMotion(id,'codex','completed');assert.equal(action,'complete');assert.equal(model.duration(action),4000);
  }
  assert.equal(model.actionForMotion('jelly','codex','failed'),'shock');
  assert.notEqual(model.actionForMotion('jelly','codex','quota'),'shock');
  assert.notEqual(model.actionForMotion('jelly','codex'),'shock');
  assert.equal(model.actionForMotion('sway','codex','active'),'working');
  assert.equal(model.actionForMotion('stretch','user'),'wake');assert.equal(model.duration('wake'),800);
});
test('待机/工作/持续睡眠互不混淆，睡眠梦境偶现且不会按演示片自动醒来',()=>{
  for(const t of [1,5,10,36,71]){
    const p=model.statePose(motion,'sleep',t,{},t);assert(p.eyelid<.1);assert.equal(p.modelScale,1);assert.equal(p.orbit,0);
  }
  assert(model.statePose(motion,'sleep',5,{},5).dream>.9);
  assert.equal(model.statePose(motion,'sleep',20,{},20).dream,0);
  assert(model.statePose(motion,'working',2).orbit>0);
  assert.equal(model.statePose(motion,'idle',2).orbit,0);
});
test('八材质、两种背景和自定义颜色均产生有限主题色，非法HEX不会进入GL',()=>{
  const defaults=[];
  for(const id of Object.keys(model.PRESETS))for(const dark of [false,true]){
    const p=model.PRESETS[id],a={orbMaterial:id,bodyColor:p.colors[0],orbSecondaryColor:p.colors[1],eyeColor:p.colors[2]};
    const c=model.colors(a,dark);for(const key of ['primary','secondary','eyes','affection','affectionLight','effectColor','effectLight']){
      assert.equal(c[key].length,3);assert(c[key].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    }
    defaults.push(c.affection.join(','));
  }
  assert(new Set(defaults).size>=7);
  const a=model.colors({orbMaterial:'pearl',bodyColor:'#14351B',orbSecondaryColor:'#187A32'});
  assert.notDeepEqual(a.affection,model.colors({}).affection);
  assert.equal(model.palette({orbMaterial:'bad',bodyColor:'url(secret)'}).colors[0],'#F9F8FF');
});
test('小宇待机四向观察在单次观察中稳定且不连续重复，回正后不残留偏移',()=>{
  const directions=new Set();let previous;
  for(let i=0;i<100;i++){
    const t=i*10+3.5,p=model.statePose(motion,'idle',t),again=model.statePose(motion,'idle',t+.01);
    const direction=Math.abs(p.lookX)>.01?'x'+Math.sign(p.lookX):'y'+Math.sign(p.lookY);
    assert.notEqual(direction,previous);previous=direction;directions.add(direction);
    assert.equal(p.lookX,again.lookX);assert.equal(p.lookY,again.lookY);
    const rest=model.statePose(motion,'idle',i*10+6);assert(Math.abs(rest.lookX)<1e-9);assert(Math.abs(rest.lookY)<1e-9);
    assert(Math.abs(p.lift)<.06);assert.equal(p.modelScale,1);
  }
  assert.equal(directions.size,4);
});
