const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyEdgeCompanion({ pet, screen, quotaLabel, notice, dock, hide, restore,
  pause, resume, command, setSetting, setQuotaPreference, tick, reset, getPresentation }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR;
  const page = code => pet.webContents.executeJavaScript(code);
  const visible = () => Boolean(notice.getWindow()?.isVisible());
  const poll = async (read, check, label) => {
    const until = performance.now() + 3500;
    let result;
    do { result = await read(); if (check(result)) return result; await wait(30); } while (performance.now() < until);
    assert.fail(`${label}: ${JSON.stringify(result)}`);
  };
  const samples = [];
  const images = [];
  const sleepFrames = [];
  const frame = () => page(`(() => {const e=document.querySelector('.eb-eye'),head=document.querySelector('.eb-head');
    const eyes=[...document.querySelectorAll('.eb-eye')].map(eye=>{const length=eye.getTotalLength();
      const matrix=head.getScreenCTM().inverse().multiply(eye.getScreenCTM());
      const outside=[];
      Array.from({length:64},(_,i)=>{const p=eye.getPointAtLength(length*i/64),q=new DOMPoint(p.x,p.y).matrixTransform(matrix);
        if(!head.isPointInFill(q))outside.push({pointIndex:i,eye:{x:p.x,y:p.y},head:{x:q.x,y:q.y}});});
      return {transform:eye.getAttribute('transform'),inside:outside.length===0,outsidePointCount:outside.length,
        firstOutsidePoints:outside.slice(0,4),matrix:{a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f}};});
    return {body:e.parentNode.getAttribute('transform'),eye:e.getAttribute('transform'),eyesInsideHead:eyes.every(eye=>eye.inside),
      head:{path:head.getAttribute('d'),computedPath:getComputedStyle(head).d,transform:head.getAttribute('transform')},eyes,
      state:{...document.getElementById('pet').dataset}};})()`);
  const capture = async name => {
    const win = notice.getWindow();
    await wait(250);
    const layout = await win.webContents.executeJavaScript(`(() => { const n=document.getElementById('notice'), t=document.getElementById('text');
      return {text:document.body.innerText,appearance:document.documentElement.dataset.appearance,
        width:n.getBoundingClientRect().width,content:t.scrollWidth,available:t.clientWidth,background:getComputedStyle(n).backgroundColor}; })()`);
    assert.ok(layout.content <= layout.available, 'one-line notice is not clipped');
    const bounds = win.getBounds(), area = screen.getDisplayMatching(pet.getBounds()).workArea;
    assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width && bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
    assert.equal(win.isFocused(), false, 'notice does not take focus');
    assert.equal(getPresentation().mode, 'tucked', 'notice does not unfold pet');
    assert.equal(quotaLabel.getWindow()?.isVisible(), false, 'full quota card remains hidden');
    if (artifacts) {
      fs.writeFileSync(path.join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(artifacts, `${name}-pet.png`), (await pet.webContents.capturePage()).toPNG());
    }
    images.push({ name, bounds, petBounds: pet.getBounds(), ...layout });
  };
  setSetting('keepAwake', true); setSetting('bubblesEnabled', false);
  setQuotaPreference('codexQuotaAlwaysVisible', true);
  reset(); tick(0); dock('left'); tick(0);
  await poll(() => page('document.getElementById("pet").dataset.emotion'), v => v === '55', 'resting expression');
  const started = performance.now(), until = started + 15500;
  const badFrames = [];
  let failureCapture;
  while (performance.now() < until) {
    const sample = { elapsedMs: performance.now() - started, ...await frame() };
    samples.push(sample);
    if (!sample.eyesInsideHead && badFrames.length < 6) {
      badFrames.push({ sampleIndex: samples.length - 1, petBounds: pet.getBounds(), ...sample });
      if (badFrames.length === 1 && artifacts) {
        failureCapture = { name: 'edge-companion-eye-failure-pet.png', elapsedMs: performance.now() - started, petBounds: pet.getBounds() };
        try {
          fs.mkdirSync(artifacts, { recursive: true });
          fs.writeFileSync(path.join(artifacts, failureCapture.name), (await pet.webContents.capturePage()).toPNG());
        } catch (error) { failureCapture.error = String(error); }
      }
    }
    await wait(45);
  }
  if (badFrames.length && artifacts) {
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'edge-companion-eye-failure.json'), JSON.stringify({
      passed: false, source: 'real-electron; original 64-point SVG containment check',
      sampleCount: samples.length, failedSampleCount: samples.filter(sample => !sample.eyesInsideHead).length,
      firstBadFrames: badFrames, capture: failureCapture, presentation: getPresentation()
    }, null, 2));
  }
  const scales = samples.map(s => Number(s.eye.match(/scale\([^ ]+ ([^)]+)\)/)[1]));
  assert.ok(samples.every(sample => sample.eyesInsideHead), 'eyes remain inside rounded head throughout blinking and breathing');
  let blinks = 0, closed = false;
  for (const scale of scales) {
    if (!closed && scale < 0.45) { blinks++; closed = true; }
    else if (closed && scale > 0.7) closed = false;
  }
  assert.ok(blinks >= 2, `tucked pet blinks repeatedly within 15.5 seconds: ${blinks}`);
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.5, 'actual SVG eyes blink while tucked');
  assert.ok(new Set(samples.map(s => s.body)).size > 3, 'actual SVG body gently breathes');
  pause(); await wait(150); const frozen = await frame(); await wait(600);
  assert.deepEqual(await frame(), frozen, 'paused tucked frame stays completely still');
  resume(); await wait(150);
  for (const side of ['left', 'right']) {
    restore();
    await poll(() => page('document.getElementById("pet").dataset.presentation'), value => value === 'free', 'free before manual sleep');
    command('sleep');
    await poll(() => page('document.getElementById("pet").dataset.emotion'), value => value === '00', 'manual sleep before tuck');
    dock(side);
    await poll(() => page('document.getElementById("pet").dataset.emotion'), value => value === '56', 'tucked sleeping expression');
    const sleeping = { side, petBounds: pet.getBounds(), ...await frame() };
    sleepFrames.push(sleeping);
    if (artifacts) {
      fs.writeFileSync(path.join(artifacts, `edge-companion-sleep-${side}.json`), JSON.stringify(sleeping, null, 2));
      fs.writeFileSync(path.join(artifacts, `edge-companion-sleep-${side}.png`), (await pet.webContents.capturePage()).toPNG());
    }
    assert.equal(sleeping.state.presentation, 'tucked');
    assert.equal(sleeping.state.edge, side);
    assert.ok(sleeping.eyesInsideHead, `${side} sleeping eyes remain inside rounded head`);
    for (const eye of sleeping.eyes) {
      assert.ok(Math.abs(Number(eye.transform.match(/scale\([^ ]+ ([^)]+)\)/)[1])) <= 0.1, 'sleeping SVG eyes stay closed');
    }
  }
  restore();
  await poll(() => page('document.getElementById("pet").dataset.presentation'), value => value === 'free', 'free before wake');
  command('wake');
  await poll(() => page('document.getElementById("pet").dataset.mode'), value => value === 'awake', 'awake after sleep check');
  command('rest');
  let clock = 60000;
  for (const side of ['left', 'right']) for (const appearance of ['light', 'dark']) {
    reset(); tick(clock); dock(side); setQuotaPreference('codexQuotaAppearance', appearance);
    tick(clock + 60000);
    await poll(visible, Boolean, 'quota capsule shown');
    await poll(() => notice.getWindow().webContents.executeJavaScript('document.body.innerText'), text => text.includes('79%'), 'latest quota in capsule');
    await capture(`edge-capsule-${side}-${appearance}-quota`);
    setQuotaPreference('codexQuotaAlwaysVisible', false); assert.equal(visible(), false);
    setSetting('bubblesEnabled', true); tick(clock + 155000);
    await poll(visible, Boolean, 'phrase capsule shown');
    await capture(`edge-capsule-${side}-${appearance}-text`);
    tick(clock + 160000); assert.equal(visible(), false, 'phrase expires');
    setSetting('bubblesEnabled', false); setQuotaPreference('codexQuotaAlwaysVisible', true);
    clock += 300000;
  }
  reset(); tick(clock); dock('left'); tick(clock + 60000); await poll(visible, Boolean, 'notice before hide');
  hide(); assert.equal(visible(), false); tick(clock + 900000); assert.equal(visible(), false);
  restore(); assert.equal(visible(), false);
  await poll(() => quotaLabel.getWindow()?.isVisible(), Boolean, 'regular quota restored');
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'edge-companion-results.json'), JSON.stringify({
    passed: true, source: 'real-electron; synthetic quota; injected notice clock only',
    blink: { count: blinks, min: Math.min(...scales), max: Math.max(...scales) }, bodyFrameCount: new Set(samples.map(s => s.body)).size, sleepFrames, images
  }, null, 2));
  process.stdout.write('PET_EDGE_COMPANION_OK\n');
}
module.exports = { verifyEdgeCompanion };
