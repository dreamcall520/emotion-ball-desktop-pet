// Run with the Electron binary. Uses synthetic quota data and a temporary profile only.
const { app, BrowserWindow } = require('electron');
// Electron's default uncaught-error handler opens a native dialog, which is not
// appropriate for an unattended hidden-window verification.
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rgb, sampleContrast } = require('./verify-codex-status-v20');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-quota-accessibility-'));
app.setPath('userData', profile);
const artifacts = process.env.PET_ACCESSIBILITY_ARTIFACT_DIR || path.resolve(__dirname, '../build/accessibility-light-evidence');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify({ passed: false, status: 'running' }));
const results = [];
const systemTransitions = [];
const beamMotionProfiles = new Set();
function assertOpaqueSurface(actual, dark, label) {
  const colors = actual.cardBackgroundImage.match(/rgba?\([^)]+\)/g) || [];
  assert.match(actual.cardBackgroundImage, /^linear-gradient\(/, `${label}: retained gradient`);
  assert.equal(colors.length, 3, `${label}: three opaque gradient stops`);
  assert.ok(colors.every(color => rgb(color)[3] === 1), `${label}: no translucent gradient stop`);
  assert.deepEqual(colors.map(color => rgb(color).slice(0, 3)), dark
    ? [[24, 36, 50], [20, 31, 42], [16, 24, 32]]
    : [[255, 255, 255], [247, 251, 255], [239, 245, 255]], `${label}: approved accessible surface`);
}
let win;
async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width: 196, height: 144, show: false, frame: false, backgroundColor: '#ffffff',
    webPreferences: { preload: path.resolve(__dirname, '../quota-label-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await win.loadFile(path.resolve(__dirname, '../quota-label.html'));
  win.webContents.debugger.attach('1.3');
  const read = () => win.webContents.executeJavaScript(`(() => {
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
    const value = e => { if(!e) return {text:'',visible:false}; const r=e.getBoundingClientRect(); return {text:e.textContent,title:e.title,color:getComputedStyle(e).color,
      x:r.x,right:r.right,width:r.width,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,visible:visible(e)}; };
    const contrastSamples = [...document.querySelectorAll('.summary-value, .summary-period-label, .summary-badge, .quota-value, .quota-name, .quota-period, .detail-primary, .detail-secondary, #secondary-reset, #secondary-value, #compact-product, #compact-period, .v20-brand b, .v20-caption, .period-pill, .v20-value, .v20-pace, .v20-reset > span, .v20-shared button > span, .v20-shared button > b, .v20-activity button > span, .v20-count, .v20-trend span')].filter(visible).map(e => {
      let ancestor = e, opacity = 1; const backgrounds=[];
      while (ancestor) { const style=getComputedStyle(ancestor); opacity*=Number(style.opacity);
        backgrounds.push({color:style.backgroundColor,image:style.backgroundImage}); ancestor=ancestor.parentElement; }
      return {text:e.textContent,color:getComputedStyle(e).color,opacity,backgrounds};
    });
    const expanded=document.getElementById('quota-label').dataset.expanded==='true';
    const values=expanded ? [...document.querySelectorAll('.v20-value')] : [...document.querySelectorAll('#items .quota-value')];
    return {appearance:document.documentElement.dataset.appearance,
      colorMode:document.documentElement.dataset.colorMode,
      accessibleAppearance:document.documentElement.dataset.accessibleAppearance, contrastSamples,
      cardBackground:getComputedStyle(document.getElementById('quota-label')).backgroundColor,
      cardBackgroundImage:getComputedStyle(document.getElementById('quota-label')).backgroundImage,
      beam:['::before', '::after'].map(pseudo => { const style=getComputedStyle(document.getElementById('quota-beam'),pseudo);
        return {pseudo,backgroundImage:style.backgroundImage,animationName:style.animationName,angle:style.getPropertyValue('--quota-beam-angle')}; }),
      expanded, primary:value(values[0]), secondary:value(values[1]),
      summary:value(document.querySelector('.summary-value')),
      summaryText:document.getElementById('summary').textContent,
      period:document.getElementById('secondary-period').textContent,
      labels:[...document.querySelectorAll('.quota-state-label')].filter(visible).map(value),
      progressLabels:[...document.querySelectorAll('.v20-progress')].map(e=>e.getAttribute('aria-valuetext')),
      card:document.getElementById('quota-label').getBoundingClientRect().toJSON()};
  })()`);
  for (const colorMode of ['standard', 'accessible', 'standard']) {
    for (const [appearance, scheme] of [['dark', 'light'], ['system', 'dark'], ['light', 'dark'], ['system', 'light']]) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      win.webContents.send('pet:color-mode', colorMode, appearance);
      for (const [primary, secondary, primaryMinutes] of [[74, 15, 10080], [74, 5, 10080], [15, 74, 300], [5, 74, 300], [0, 74, 300], [15, null, 300], [5, null, 10080]]) {
        for (const [size, expanded, width, height] of [['standard', false, 168, 58], ['compact', false, 128, 32], ['compact', true, 196, 144]]) {
          win.setContentSize(width, expanded && secondary === null ? 131 : height);
          const model = { state: 'ready', size, expanded, appearance, items: [
            { label: 'Codex', windowMinutes: primaryMinutes, remaining: primary, resetsAt: Date.now() + 259200000 },
            ...(secondary === null ? [] : [{ label: 'Codex', windowMinutes: primaryMinutes === 300 ? 10080 : 300, remaining: secondary, resetsAt: Date.now() + 9000000 }])
          ], overflow: 0, resetCreditsAvailable: 2, activity:{runningCount:3,unreadCount:1},
            ...(expanded ? {extraCredits:{state:'balance',balance:'2480'}} : {}) };
          win.webContents.send('pet:quota-label', model);
          await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const actual = await read();
          const name = `${colorMode}-${appearance}-${scheme}-${primaryMinutes}-${primary}-${secondary === null ? 'single' : secondary}-${size}-${expanded ? 'expanded' : 'collapsed'}`;
          assert.equal(actual.colorMode, colorMode, `${name}: color mode IPC did not reach the page`);
          const dark = appearance === 'dark' || (appearance === 'system' && scheme === 'dark');
          assert.equal(actual.accessibleAppearance, dark ? 'dark' : 'light', `${name}: appearance IPC did not reach the page`);
          if (colorMode === 'accessible') {
            assertOpaqueSurface(actual, dark, name);
            for (const beam of actual.beam) {
              assert.match(beam.backgroundImage, /conic-gradient/, `${name}: ${beam.pseudo} keeps the original beam`);
              assert.equal(beam.animationName, 'quotaBeamOrbit', `${name}: ${beam.pseudo} keeps its animation`);
            }
            const profile = `${appearance}-${scheme}`;
            if (!beamMotionProfiles.has(profile)) {
              await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
              const after = await read();
              actual.beamAfter = after.beam;
              after.beam.forEach((beam, index) => assert.notEqual(beam.angle, actual.beam[index].angle,
                `${name}: ${beam.pseudo} must advance over multiple frames`));
              beamMotionProfiles.add(profile);
            }
          }
          if (colorMode === 'accessible') for (const sample of actual.contrastSamples) {
            sample.ratio = sampleContrast(sample);
            assert.ok(sample.ratio >= 4.5, `${name}: ${sample.text} contrast ${sample.ratio}`);
          }
          results.push({ name, ...actual });
          fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
          const expected = remaining => remaining === null ? null : colorMode === 'accessible' && remaining <= 20 ? (dark ? 'rgb(255, 224, 138)' : 'rgb(113, 82, 0)') : remaining <= 10 ? (dark ? 'rgb(255, 222, 216)' : 'rgb(157, 48, 39)')
            : remaining <= 20 ? (dark ? 'rgb(255, 225, 171)' : 'rgb(133, 87, 17)') : null;
          if (expected(primary)) assert.equal(actual.primary.color, expected(primary), `${name} primary`);
          if (expected(secondary)) assert.equal(actual.secondary.color, expected(secondary), `${name} secondary`);
          if (expected(primary)) assert.equal(actual.summary.color, expected(primary), `${name} summary`);
          if (primary === 74) assert.equal(actual.summary.color, colorMode === 'accessible' ? (dark ? 'rgb(247, 249, 252)' : 'rgb(20, 33, 46)') : dark ? 'rgb(245, 247, 250)' : 'rgb(37, 43, 52)', `${name} summary follows its own period`);
          const stateText = value => value === 0 ? '已用尽' : value <= 10 ? '紧张' : value <= 20 ? '偏低' : '';
          assert.equal(actual.primary.text, `${primary}%${expanded ? '' : stateText(primary)}`, `${name}: primary remaining`);
          assert.equal(actual.secondary.text, secondary === null ? '' : `${secondary}%${expanded ? '' : stateText(secondary)}`, `${name}: secondary remaining`);
          if (expanded) [primary,secondary].filter(value=>value!==null).forEach((remaining,index)=> {
            assert.ok(actual.progressLabels[index].includes(stateText(remaining)), `${name}: accessible progress state words`);
            if (stateText(remaining)) assert.ok([actual.primary,actual.secondary][index].title.includes(stateText(remaining)), `${name}: readable state annotation`);
          });
          assert.equal(actual.summaryText, `${primaryMinutes === 300 ? '5h' : '周'}${stateText(primary) || '额度'}${primary}%`, `${name}: compact state words`);
          for (const element of [actual.primary, actual.secondary, actual.summary, ...actual.labels].filter(e => e.visible)) {
            assert.ok(element.scrollWidth <= element.clientWidth + 1, `${name}: clipped ${element.text}`);
            assert.ok(element.x >= actual.card.x && element.right <= actual.card.right, `${name}: outside card ${element.text}`);
          }
          if (expanded && primary === 74) fs.writeFileSync(path.join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
  }
  // Change the system appearance without sending another theme packet. This
  // verifies the existing window reacts through the shared matchMedia listener.
  win.webContents.send('pet:color-mode', 'accessible', 'system');
  for (const scheme of ['dark', 'light', 'dark', 'light']) {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const actual = await read();
    assert.equal(actual.accessibleAppearance, scheme, `system changed to ${scheme} without resending IPC`);
    assertOpaqueSurface(actual, scheme === 'dark', `system ${scheme}`);
    systemTransitions.push({ scheme, accessibleAppearance: actual.accessibleAppearance, backgroundImage: actual.cardBackgroundImage });
  }
  const ratios = results.filter(result => result.colorMode === 'accessible').flatMap(result => result.contrastSamples.map(sample => sample.ratio));
  const byAppearance = Object.fromEntries(['light', 'dark'].map(appearance => {
    const cases = results.filter(result => result.colorMode === 'accessible' && result.accessibleAppearance === appearance);
    const values = cases.flatMap(result => result.contrastSamples.map(sample => sample.ratio));
    return [appearance, { cases: cases.length, contrastMin: Math.min(...values), contrastMax: Math.max(...values) }];
  }));
  fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify({ passed: true, cases: results.length,
    systemTransitions, beamMotionProfiles: [...beamMotionProfiles], byAppearance, scope: 'Synthetic quota only; hidden Electron with real preload IPC; no live app settings or model calls' }, null, 2));
  process.stdout.write(`ACCESSIBLE_TEXT_CONTRAST ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}\n`);
  process.stdout.write(`PET_QUOTA_ACCESSIBILITY_OK ${results.length} layouts; ${artifacts}\n`);
}
main().then(() => { win?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(0); }, error => {
  process.stderr.write(`${error.stack}\n`);
  fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify({ passed: false, error: error.message }, null, 2));
  win?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(1);
});
