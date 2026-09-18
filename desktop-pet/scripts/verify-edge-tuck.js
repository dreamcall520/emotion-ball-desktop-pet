const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { SIZES } = require('../lib/window-placement');

// Explicit smoke only: real Electron windows, renderer and IPC; isolated synthetic cursor/usage.
async function verifyEdgeTuck({ pet, bubble, quotaLabel, getThoughtWindow, screen, monitor,
  getMenu, setSize, getSettings, showDialogue, getPresentation, prepare, setEnabled, setQuotaPreference }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  const artifacts = process.env.PET_SMOKE_ARTIFACT_DIR;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const originalCursor = screen.getCursorScreenPoint;
  const errors = [], results = [];
  let cursor = { x: 0, y: 0 }, callbacks;
  const page = code => pet.webContents.executeJavaScript(code);
  const poll = async (read, check, label, timeout = 3500) => {
    const until = performance.now() + timeout;
    let value;
    do {
      value = await read();
      if (check(value)) return value;
      await wait(30);
    } while (performance.now() < until);
    assert.fail(`${label}: ${JSON.stringify(value)}`);
  };
  const mode = wanted => poll(getPresentation, s => s.mode === wanted, `presentation ${wanted}`);
  const clickMenu = id => {
    const item = getMenu().getMenuItemById(id);
    assert.ok(item?.enabled, `menu ${id} available`);
    item.click(item, pet, {});
  };
  const sample = async point => { cursor = point; monitor.sampleNow(true); await wait(70); };
  const away = async () => {
    const a = screen.getDisplayMatching(pet.getBounds()).workArea;
    await sample({ x: a.x + Math.round(a.width / 2), y: a.y + 20 });
  };
  const visible = win => Boolean(win && !win.isDestroyed() && win.isVisible());
  const auxiliariesHidden = () => {
    assert.equal(visible(bubble.getWindow()), false, 'bubble hidden');
    assert.equal(visible(quotaLabel.getWindow()), false, 'quota hidden');
    assert.equal(visible(getThoughtWindow?.()), false, 'thought hidden');
  };
  const emitQuota = remaining => callbacks.onQuota({ windows: [{ id: 'codex:primary', label: 'Codex',
    windowMinutes: 300, remaining, resetsAt: Date.now() + 3600000 }], updatedAt: Date.now() });
  const input = async (type, x, y) => {
    const api = pet.webContents.debugger;
    if (!api.isAttached()) api.attach('1.3');
    await api.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await wait(80);
  };
  const capture = async name => {
    const expected = getPresentation();
    const width = pet.getBounds().width;
    const targetX = expected.mode === 'tucked' ? (expected.side === 'left' ? -width/2 : width/2) : 0;
    const readFrame = () => page(`(() => { const p=document.getElementById('pet'); const r=p.getBoundingClientRect();
      return {state:{...p.dataset},rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      body:document.querySelectorAll('radialGradient stop')[1].getAttribute('stop-color'),
      eyes:[...document.querySelectorAll('.eb-eye')].map(e=>e.getAttribute('fill'))}; })()`);
    // Wait for IPC, layout and the actual CSS transition endpoint, not wall-clock delay.
    await poll(readFrame, frame => frame.state.presentation === expected.mode &&
      Math.abs(frame.rect.x - targetX) < 0.1 && frame.rect.width === width, `${name} painted geometry`);
    const image = await pet.webContents.capturePage();
    assert.equal(image.isEmpty(), false, name);
    const frame = await readFrame();
    assert.equal(frame.state.presentation, expected.mode, name);
    assert.ok(Math.abs(frame.rect.x - targetX) < 0.1, `${name} geometry changed during capture`);
    if (artifacts) {
      fs.writeFileSync(path.join(artifacts, `${name}.png`), image.toPNG());
      fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify(frame, null, 2));
    }
    return frame;
  };
  const errorListener = (_event, code, description) => errors.push({ code, description });
  pet.webContents.on('did-fail-load', errorListener);
  try {
    monitor.stop();
    await poll(() => pet.isVisible(), Boolean, 'initial native window shown');
    await page('window.__edgeErrors=[]; window.addEventListener("error", event => window.__edgeErrors.push(event.message)); true');
    screen.getCursorScreenPoint = () => ({ ...cursor });
    prepare({ createConnection(next) { callbacks = next; return {
      async start() { next.onAccount({ accountKey: 'edge-smoke-synthetic' });
        next.onStatus({ channel: 'quota', state: 'connected' });
        next.onStatus({ channel: 'tasks', state: 'connected' }); emitQuota(87); },
      async refresh() {}, async retry() {}, close() {}
    }; } });
    await setEnabled(true);
    setQuotaPreference('codexQuotaAlwaysVisible', true);
    for (const [sizeName, size] of Object.entries(SIZES)) {
      setSize(sizeName); await wait(250); await away();
      assert.equal(getSettings().size, sizeName);
      for (const side of ['left', 'right']) {
        clickMenu(`edge-${side}`); await away(); await mode('tucked');
        const bounds = pet.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        assert.equal(bounds.x, side === 'left' ? area.x : area.x + area.width - size.width);
        assert.equal(bounds.width, size.width); assert.equal(bounds.height, size.height);
        assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
        auxiliariesHidden();
        const tucked = await capture(`edge-${side}-tucked-${size.width}`);
        assert.ok(Math.abs(tucked.rect.x - (side === 'left' ? -size.width/2 : size.width/2)) < 1, `half-body offset: ${JSON.stringify({tucked, host:getPresentation(), bounds})}`);
        assert.equal(tucked.body.toUpperCase(), '#EEEBE4');
        assert.deepEqual(tucked.eyes.map(x => x.toUpperCase()), ['#1A1A1A','#1A1A1A']);
        emitQuota(83); await wait(100); auxiliariesHidden();
        await sample({ x: side === 'left' ? bounds.x + 5 : bounds.x + bounds.width - 5, y: bounds.y + bounds.height/2 });
        await mode('peeked');
        const peeked = await capture(`edge-${side}-peeked-${size.width}`);
        assert.ok(Math.abs(peeked.rect.x) < 1, 'peek full body');
        await poll(() => visible(quotaLabel.getWindow()), Boolean, 'quota restored on peek');
        await poll(() => quotaLabel.getWindow().webContents.executeJavaScript('document.body.textContent'),
          text => text.includes('83%'), 'peek shows latest quota');
        const q = quotaLabel.getWindow().getBounds();
        await sample({ x: q.x + q.width/2, y: q.y + q.height/2 });
        await wait(850); assert.equal(getPresentation().mode, 'peeked', 'quota hover retains peek');
        await away(); await mode('tucked'); auxiliariesHidden();
        clickMenu('edge-leave'); await mode('free');
        assert.ok(Math.abs((await capture(`edge-${side}-restored-${size.width}`)).rect.x) < 1);
        results.push({ size: size.width, side, bounds, tucked, peeked });
      }
    }
    setSize('tiny'); await wait(250);
    for (const display of screen.getAllDisplays()) {
      const a = display.workArea;
      if (getPresentation().side) clickMenu('edge-leave');
      pet.setPosition(a.x + Math.round(a.width/2), a.y + Math.round(a.height/2), false);
      await away();
      for (const side of ['left', 'right']) {
        clickMenu(`edge-${side}`); await away(); await mode('tucked');
        const b = pet.getBounds();
        assert.equal(screen.getDisplayMatching(b).id, display.id, 'dock retains chosen display');
        assert.equal(b.x, side === 'left' ? a.x : a.x + a.width - b.width);
        assert.ok(b.y >= a.y && b.y + b.height <= a.y + a.height);
        await capture(`edge-display-${display.id}-${side}`);
        clickMenu('edge-leave'); await mode('free');
      }
    }
    process.stdout.write('PET_EDGE_DISPLAYS_OK\n');
    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    pet.setPosition(area.x + 20, area.y + 150, false); await away();
    // Clicking near the edge must remain a normal click.
    pet.setPosition(area.x + 8, area.y + 150, false);
    await input('mousePressed', 40, 40); await input('mouseReleased', 40, 40);
    await mode('free');
    pet.setPosition(area.x + 20, area.y + 150, false);
    // Chromium trusted pointer events run the actual renderer drag path and IPC.
    await input('mousePressed', 40, 40);
    await input('mouseMoved', 15, 40);
    await input('mouseReleased', 40, 40);
    await mode('tucked');
    assert.equal(getPresentation().side, 'left');
    await sample({ x: area.x + 5, y: pet.getBounds().y + 40 }); await mode('peeked');
    await wait(220);
    await input('mousePressed', 35, 40);
    await input('mouseMoved', 75, 40);
    await input('mouseReleased', 40, 40);
    await mode('free');
    assert.ok(pet.getBounds().x > area.x + 16, 'drag away undocks');
    await wait(1600); // allow existing land reaction to settle
    await away();
    showDialogue('play'); await wait(250);
    clickMenu('edge-visibility'); await mode('hidden');
    assert.equal(pet.isVisible(), false); auxiliariesHidden();
    emitQuota(79);
    callbacks.onTask({ id: '11111111-1111-4111-8111-111111111111', state: 'active', turnId: 'edge-native', baseline: true });
    await wait(900); auxiliariesHidden();
    assert.equal(await page('document.getElementById("pet").dataset.codexActiveTasks'), '1', 'background task status keeps updating');
    assert.equal(pet.isVisible(), false, 'quota refresh cannot reveal hidden pet');
    clickMenu('edge-visibility'); await mode('free');
    assert.equal(pet.isVisible(), true);
    await poll(() => visible(quotaLabel.getWindow()), Boolean, 'fresh quota restored');
    await poll(() => quotaLabel.getWindow().webContents.executeJavaScript('document.body.textContent'),
      text => text.includes('79%'), 'restore shows latest hidden quota');
    assert.equal(visible(bubble.getWindow()), false, 'old bubble not replayed');
    assert.deepEqual(errors, []);
    assert.deepEqual(await page('window.__edgeErrors'), []);
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'edge-tuck-results.json'), JSON.stringify({
      passed: true, source: 'real-electron-with-synthetic-cursor-and-quota', displays: screen.getAllDisplays(), results
    }, null, 2));
    process.stdout.write('PET_EDGE_SIZES_OK\nPET_EDGE_HOVER_OK\nPET_EDGE_DRAG_OK\nPET_EDGE_HIDE_OK\n');
  } finally {
    screen.getCursorScreenPoint = originalCursor;
    pet.webContents.removeListener('did-fail-load', errorListener);
    if (pet.webContents.debugger.isAttached()) pet.webContents.debugger.detach();
    await setEnabled(false);
    monitor.stop();
  }
}
module.exports = { verifyEdgeTuck };
