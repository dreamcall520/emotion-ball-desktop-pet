const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuotaCardResize } = require('../lib/quota-card-resize');
test('requested bounds prevent native intermediate frames and synchronous events from restarting resize', () => {
 const motion=createQuotaCardResize(),calls=[];let reenter=false;
 const win={isVisible:()=>true,setBounds:(bounds,animate)=>{calls.push(animate);if(reenter)motion.apply(win,bounds);}};
 const small={x:20,y:30,width:128,height:32},large={...small,width:196,height:100};
 motion.apply(win,small);reenter=true;motion.apply(win,large);motion.apply(win,large);assert.deepEqual(calls,[false,false]);
 motion.apply(win,small,{reducedMotion:true});assert.equal(calls.at(-1),false);
 motion.apply(win,large,{immediate:true});assert.equal(calls.at(-1),false);
 motion.apply(win,{...large,x:21});assert.equal(calls.at(-1),false);
 motion.forget(win);motion.apply(win,small);assert.equal(calls.at(-1),false);
});

test('user collapse delays native shrink 200ms while reduced motion and group reset remain immediate',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[],motion=createQuotaCardResize();
 const win={isVisible:()=>true,isDestroyed:()=>false,setBounds:(bounds,animate)=>calls.push({bounds,animate})};
 const small={x:0,y:0,width:128,height:32},large={...small,width:196,height:100};
 motion.apply(win,large);motion.apply(win,small,{animate:true});assert.equal(calls.length,1);
 motion.apply(win,small,{animate:true});t.mock.timers.tick(199);assert.equal(calls.length,1);t.mock.timers.tick(1);assert.deepEqual(calls.at(-1),{bounds:small,animate:false});assert.equal(calls.length,2);
 motion.apply(win,large);motion.apply(win,small,{animate:true,reducedMotion:true});assert.equal(calls.length,4);
 motion.apply(win,large);motion.apply(win,small,{animate:true,immediate:true});assert.equal(calls.length,6);
});
test('rapid reverse cancels the pending shrink rather than applying obsolete bounds',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[],motion=createQuotaCardResize();
 const win={isVisible:()=>true,isDestroyed:()=>false,setBounds:b=>calls.push({...b})};
 const small={x:0,y:0,width:128,height:32},large={...small,width:196,height:100};
 motion.apply(win,large);motion.apply(win,small,{animate:true});t.mock.timers.tick(90);motion.apply(win,large,{animate:true});t.mock.timers.tick(500);
 assert.equal(calls.length,2);assert.deepEqual(calls.at(-1),large);
});
test('destroyed or forgotten windows receive no delayed native resize and delayed errors are contained',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const mode of ['destroyed','forgotten','error']){
  const errors=[],motion=createQuotaCardResize({onError:e=>errors.push(e)});let dead=false,calls=0;
  const win={isVisible:()=>true,isDestroyed:()=>dead,setBounds(){calls++;if(mode==='error'&&calls>1)throw Error('native resize failed');}};
  motion.apply(win,{x:0,y:0,width:196,height:100});motion.apply(win,{x:0,y:0,width:128,height:32},{animate:true});
  if(mode==='destroyed')dead=true;if(mode==='forgotten')motion.forget(win);
  assert.doesNotThrow(()=>t.mock.timers.tick(500));assert.equal(calls,mode==='error'?2:1);assert.equal(errors.length,mode==='error'?1:0);
 }
});
