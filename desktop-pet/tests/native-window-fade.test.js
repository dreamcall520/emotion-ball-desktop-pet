const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { createNativeWindowFade } = require('../lib/native-window-fade');
const windowFixture = () => ({ visible: false, dead: false, opacity: 1, values: [],
  isDestroyed() { return this.dead; }, isVisible() { return this.visible; },
  showInactive() { this.visible = true; }, hide() { this.visible = false; },
  setOpacity(value) { assert(!this.dead); this.opacity = value; this.values.push(value); }
});
test('edge entry fades once; repeat reposition does not restart opacity', async () => {
  const w = windowFixture(), fade = createNativeWindowFade({ duration: 50 });
  fade.show(w, true); assert.equal(w.opacity, 0); assert.equal(w.visible, true);
  await wait(25); const opacity = w.opacity; assert(opacity > 0 && opacity < 1);
  fade.show(w, true); assert.equal(w.opacity, opacity);
  await wait(60); assert.equal(w.opacity, 1); fade.cancel(w);
});
test('exit remains rendered until complete; repeated animated hides do not restart; callback uses newest request', async () => {
  const w = windowFixture(), fade = createNativeWindowFade({ duration: 60 }); let callback = '';
  fade.show(w); fade.hide(w, { animate: true, onHidden: () => callback = 'old' });
  assert.equal(w.visible, true); await wait(25);
  fade.hide(w, { animate: true, onHidden: () => callback = 'new' });
  await wait(55); assert.equal(w.visible, false); assert.equal(callback, 'new'); assert.equal(w.opacity, 1);
});
test('rapid reopen cancels stale exit; immediate hide overrides animation for lock and drag', async () => {
  const w = windowFixture(), fade = createNativeWindowFade({ duration: 60 }); let hidden = false;
  fade.show(w); fade.hide(w, { animate: true, onHidden: () => hidden = true }); await wait(20);
  fade.show(w, true); await wait(90); assert.equal(w.visible, true); assert.equal(hidden, false);
  fade.hide(w, { animate: true }); await wait(20); fade.hide(w);
  assert.equal(w.visible, false); await wait(70); assert.equal(w.visible, false); assert.equal(w.opacity, 1);
});
test('destroy cancellation and missing native opacity stay compatible', async () => {
  const w = windowFixture(), fade = createNativeWindowFade({ duration: 40 });
  fade.show(w, true); fade.cancel(w); w.dead = true; await wait(60);
  const old = windowFixture(); delete old.setOpacity;
  fade.show(old, true); assert.equal(old.visible, true); fade.hide(old, { animate: true }); assert.equal(old.visible, false);
});
test('group collapse keeps native glass visible until shape narrows and retains edge timing', t => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const w=windowFixture(),fade=createNativeWindowFade();let finished=false;
  fade.show(w);fade.hide(w,{animate:true,duration:220,easing:'group-collapse',onHidden:()=>finished=true});
  t.mock.timers.tick(150);assert.equal(w.opacity,1);assert.equal(w.visible,true);assert.equal(finished,false);
  t.mock.timers.tick(45);assert(w.opacity>0&&w.opacity<1);assert.equal(w.visible,true);
  fade.show(w,true);t.mock.timers.tick(220);assert.equal(w.visible,true);assert.equal(w.opacity,1);assert.equal(finished,false);
  fade.hide(w,{animate:true,duration:220,easing:'group-collapse'});t.mock.timers.tick(240);assert.equal(w.visible,false);
  fade.show(w);fade.hide(w,{animate:true});t.mock.timers.tick(100);assert(w.opacity<.5,'ordinary edge still uses its original curve');t.mock.timers.tick(100);assert.equal(w.visible,false);
});
