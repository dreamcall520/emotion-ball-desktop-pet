// Run with the Electron binary. Uses synthetic quota data and a temporary profile only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-quota-accessibility-'));
app.setPath('userData', profile);
const artifacts = process.env.PET_ACCESSIBILITY_ARTIFACT_DIR || path.join(os.tmpdir(), 'qiuqiu-quota-accessibility-evidence');
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
function contrast(first, second) {
  const luminance = rgb => rgb.map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
let win;
async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width: 196, height: 128, show: false, frame: false, backgroundColor: '#ffffff',
    webPreferences: { preload: path.resolve(__dirname, '../quota-label-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await win.loadFile(path.resolve(__dirname, '../quota-label.html'));
  win.webContents.debugger.attach('1.3');
  const read = () => win.webContents.executeJavaScript(`(() => {
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
    const value = e => { const r=e.getBoundingClientRect(); return {text:e.textContent,color:getComputedStyle(e).color,
      x:r.x,right:r.right,width:r.width,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,visible:visible(e)}; };
    const contrastSamples = [...document.querySelectorAll('.summary-value, .summary-period-label, .summary-badge, .quota-value, .quota-name, .quota-period, .detail-primary, .detail-secondary, #secondary-reset, #secondary-value, #compact-product, #compact-period')].filter(visible).map(e => {
      let ancestor = e; let background = '';
      while (ancestor) { background = getComputedStyle(ancestor).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
        ancestor = ancestor.parentElement; }
      return {text:e.textContent,color:getComputedStyle(e).color,background};
    });
    return {appearance:document.documentElement.dataset.appearance,
      colorMode:document.documentElement.dataset.colorMode, contrastSamples,
      primary:value(document.querySelector('#items .quota-value')),
      secondary:value(document.getElementById('secondary-value')),
      summary:value(document.querySelector('.summary-value')),
      summaryText:document.getElementById('summary').textContent,
      period:document.getElementById('secondary-period').textContent,
      labels:[...document.querySelectorAll('.quota-state-label')].filter(visible).map(value),
      card:document.getElementById('quota-label').getBoundingClientRect().toJSON()};
  })()`);
  for (const colorMode of ['standard', 'accessible', 'standard']) {
    win.webContents.send('pet:color-mode', colorMode);
    for (const [appearance, scheme] of [['dark', 'light'], ['system', 'dark'], ['light', 'dark'], ['system', 'light']]) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const [primary, secondary, primaryMinutes] of [[74, 15, 10080], [74, 5, 10080], [15, 74, 300], [5, 74, 300], [0, 74, 300], [15, null, 300], [5, null, 10080]]) {
        for (const [size, expanded, width, height] of [['standard', false, 168, 58], ['compact', false, 128, 32], ['compact', true, 196, 128]]) {
          win.setContentSize(width, expanded && secondary === null ? 96 : height);
          const model = { state: 'ready', size, expanded, appearance, items: [
            { label: 'Codex', windowMinutes: primaryMinutes, remaining: primary, resetsAt: Date.now() + 259200000 },
            ...(secondary === null ? [] : [{ label: 'Codex', windowMinutes: primaryMinutes === 300 ? 10080 : 300, remaining: secondary, resetsAt: Date.now() + 9000000 }])
          ], overflow: 0, resetCreditsAvailable: 2 };
          win.webContents.send('pet:quota-label', model);
          await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const actual = await read();
          const name = `${colorMode}-${appearance}-${scheme}-${primaryMinutes}-${primary}-${secondary === null ? 'single' : secondary}-${size}-${expanded ? 'expanded' : 'collapsed'}`;
          assert.equal(actual.colorMode, colorMode, `${name}: color mode IPC did not reach the page`);
          if (colorMode === 'accessible') for (const sample of actual.contrastSamples) {
            sample.ratio = contrast(rgb(sample.color), rgb(sample.background));
            assert.ok(sample.ratio >= 4.5, `${name}: ${sample.text} contrast ${sample.ratio}`);
          }
          results.push({ name, ...actual });
          fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
          const dark = appearance === 'dark' || (appearance === 'system' && scheme === 'dark');
          const expected = remaining => remaining === null ? null : colorMode === 'accessible' && remaining <= 20 ? 'rgb(255, 224, 138)' : remaining <= 10 ? (dark ? 'rgb(255, 222, 216)' : 'rgb(157, 48, 39)')
            : remaining <= 20 ? (dark ? 'rgb(255, 225, 171)' : 'rgb(133, 87, 17)') : null;
          if (expected(primary)) assert.equal(actual.primary.color, expected(primary), `${name} primary`);
          if (expected(secondary)) assert.equal(actual.secondary.color, expected(secondary), `${name} secondary`);
          if (expected(primary)) assert.equal(actual.summary.color, expected(primary), `${name} summary`);
          if (primary === 74) assert.equal(actual.summary.color, colorMode === 'accessible' ? 'rgb(247, 249, 252)' : dark ? 'rgb(245, 247, 250)' : 'rgb(37, 43, 52)', `${name} summary follows its own period`);
          for (const element of [actual.primary, actual.secondary, actual.summary, ...actual.labels].filter(e => e.visible)) {
            assert.ok(element.scrollWidth <= element.clientWidth + 1, `${name}: clipped ${element.text}`);
            assert.ok(element.x >= actual.card.x && element.right <= actual.card.right, `${name}: outside card ${element.text}`);
          }
          if (expanded && primary === 74) fs.writeFileSync(path.join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
  }
  const ratios = results.filter(result => result.colorMode === 'accessible').flatMap(result => result.contrastSamples.map(sample => sample.ratio));
  process.stdout.write(`ACCESSIBLE_TEXT_CONTRAST ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}\n`);
  process.stdout.write(`PET_QUOTA_ACCESSIBILITY_OK ${results.length} layouts; ${artifacts}\n`);
}
main().then(() => { win?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(0); }, error => {
  process.stderr.write(`${error.stack}\n`);
  win?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(1);
});
