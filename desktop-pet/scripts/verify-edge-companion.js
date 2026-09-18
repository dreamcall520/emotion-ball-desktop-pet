const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyEdgeCompanion({ pet, screen, quotaLabel, notice, dock, hide, restore,
  pause, resume, setSetting, setQuotaPreference, tick, reset, getPresentation }) {
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
  const frame = () => page(`(() => {const e=document.querySelector('.eb-eye');
    return {body:e.parentNode.getAttribute('transform'),eye:e.getAttribute('transform'),state:{...document.getElementById('pet').dataset}};})()`);
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
  const until = performance.now() + 15500;
  while (performance.now() < until) { samples.push(await frame()); await wait(45); }
  const scales = samples.map(s => Number(s.eye.match(/scale\([^ ]+ ([^)]+)\)/)[1]));
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.5, 'actual SVG eyes blink while tucked');
  assert.ok(new Set(samples.map(s => s.body)).size > 3, 'actual SVG body gently breathes');
  pause(); await wait(150); const frozen = await frame(); await wait(600);
  assert.deepEqual(await frame(), frozen, 'paused tucked frame stays completely still');
  resume(); await wait(150);
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
    blink: { min: Math.min(...scales), max: Math.max(...scales) }, bodyFrameCount: new Set(samples.map(s => s.body)).size, images
  }, null, 2));
  process.stdout.write('PET_EDGE_COMPANION_OK\n');
}
module.exports = { verifyEdgeCompanion };
