'use strict';
// Isolated native timing probe. Synthetic models only; no main App, user state,
// credentials, network, or provider operations are loaded.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createQuotaGuardWindow, CHANNEL } = require('../../lib/quota-guard-window');
const { createPopupQuotaVisibility } = require('../../lib/popup-quota-visibility');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-guard-startup-'));
app.setPath('userData', profile); app.commandLine.appendSwitch('user-data-dir', profile);
const at = performance.now(), records = [], stamp = (event, extra = {}) => records.push({ ms: Math.round((performance.now() - at) * 10) / 10, event, ...extra });
const output = process.env.QIUQIU_GUARD_TIMING_OUTPUT || path.join(os.tmpdir(), 'qiuqiu-guard-startup-safe.json');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let guard, presentationCount = 0, expectedPresentations = 0;
const popups = createPopupQuotaVisibility({ root: path.resolve(__dirname, '../..'), onChange: blocked => stamp('popup-blocked', { blocked }) });
function Window(options) {
  if (process.env.QIUQIU_GUARD_TIMING_NO_THROTTLE === '1') options.webPreferences.backgroundThrottling = false;
  if (process.env.QIUQIU_GUARD_TIMING_DELAY_BITMAP === '1') {
    const preload = path.join(profile, 'delayed-guard-preload.cjs');
    fs.writeFileSync(preload, fs.readFileSync(options.webPreferences.preload, 'utf8') + `\ncontextBridge.executeInMainWorld({func:()=>{
      const bitmap=window.createImageBitmap;let first=true;
      window.createImageBitmap=(...args)=>{window.__guardProbeBitmapCalls=(window.__guardProbeBitmapCalls||0)+1;if(!first)return bitmap(...args);first=false;
        return new Promise(resolve=>setTimeout(resolve,700)).then(()=>bitmap(...args));};
    }});`);
    options.webPreferences.preload = preload;
  }
  const win = new BrowserWindow(options), send = win.webContents.send.bind(win.webContents);
  popups.track(win);
  win.focus = () => {};
  win.webContents.send = (channel, value) => { if (channel === CHANNEL) stamp('model-send', { state: value.state, practice: value.practice === true, visible: value.visible }); return send(channel, value); };
  win.webContents.on('did-finish-load', () => stamp('did-finish-load'));
  win.on('show', () => { stamp('native-show'); void snapshot(win).then(value => stamp('show-dom', value)); });
  win.on('hide', () => stamp('native-hide'));
  return win;
}
async function snapshot(win) {
  return win.webContents.executeJavaScript(`(()=>({state:window.quotaGuardView?.state,practice:document.getElementById('guard-panel')?.dataset.practice,
    period:document.getElementById('guard-period')?.textContent,status:document.getElementById('guard-status')?.textContent,
    number:document.getElementById('guard-number')?.textContent,hidden:document.hidden,bitmapCalls:window.__guardProbeBitmapCalls||0}))()`);
}
async function ready(label) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const value = await snapshot(guard.getWindow());
    if (value.state?.ready && value.state?.spritesReady && value.state?.visible && value.state.time > 0 && !value.hidden && guard.getWindow().isVisible() && presentationCount >= expectedPresentations) { stamp(label, value); return value; }
    await wait(5);
  }
  throw Error(label + ' did not become playable');
}
app.whenReady().then(async () => {
  let anchor = process.env.QIUQIU_GUARD_TIMING_NO_ANCHOR === '1' ? null : { x: 300, y: 300, width: 108, height: 108 };
  guard = createQuotaGuardWindow({ BrowserWindow: Window, screen, getAnchor: () => anchor,
    getObstacles: () => { assert.ok(anchor, 'prewarm must not need pet obstacle placement'); return []; },
    prepareWindow: win => popups.preparePopup(win), onPresentation: value => { presentationCount++; stamp('presentation-ready', value); }, onError: () => stamp('window-error') });
  let prewarm = null;
  if (process.env.QIUQIU_GUARD_TIMING_PREWARM === '1') {
    stamp('prewarm-start'); const warming = guard.prewarm();
    guard.update({ state: 'ready', items: [{ label: 'Codex', remaining: 64, windowMinutes: 300, resetsAt: 2000000000000 }] });
    assert.equal(await warming, true);
    prewarm = await snapshot(guard.getWindow()); stamp('prewarm-ready', prewarm);
    assert.equal(guard.getWindow().isVisible(), false); assert.equal(guard.isVisible(), false); assert.equal(popups.isBlocked(), false);
    assert.equal(prewarm.state.spritesReady, true); assert.equal(prewarm.state.round, 0); assert.equal(prewarm.state.quota, null); assert.equal(prewarm.state.time, 0);
  }
  anchor = { x: 300, y: 300, width: 108, height: 108 };
  stamp('open-practice'); expectedPresentations++; guard.open({ state: 'ready', items: [], practice: true });
  await ready('practice-playable');
  const first = await snapshot(guard.getWindow());
  guard.close(); await wait(40); stamp('reopen-practice'); expectedPresentations++; guard.open({ state: 'ready', items: [], practice: true });
  await ready('practice-reopened');
  guard.close(); await wait(40); stamp('reopen-codex'); expectedPresentations++;
  guard.open({ state: 'ready', items: [{ label: 'Codex', remaining: 64, windowMinutes: 300, resetsAt: 2000000000000 }] });
  await ready('codex-reopened');
  guard.close(); await wait(40); stamp('reopen-practice-again'); expectedPresentations++; guard.open({ state: 'ready', items: [], practice: true });
  const last = await ready('practice-reopened-after-codex');
  if (prewarm) assert.equal(last.bitmapCalls, prewarm.bitmapCalls, 'all bitmap decoding completed during prewarm, never during a click or reopen');
  await wait(50);
  const shows = records.filter(row => row.event === 'show-dom');
  const shownBeforeReady = shows.some(row => !row.state?.ready || !row.state?.spritesReady);
  fs.writeFileSync(output, JSON.stringify({ fixtureOnly: true, prewarm, first, last, shownBeforeReady, records }, null, 2));
  if (process.env.QIUQIU_GUARD_TIMING_ASSERT_READY === '1') assert.equal(shownBeforeReady, false, 'native window must not show before its model and sprites are ready');
  guard.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(0);
}).catch(error => { fs.writeFileSync(output, JSON.stringify({ fixtureOnly: true, error: error.message, records }, null, 2)); guard?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(1); });
