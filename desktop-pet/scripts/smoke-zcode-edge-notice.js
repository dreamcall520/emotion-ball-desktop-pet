// Isolated native surface acceptance. Synthetic quota observations, no account/API/model access.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
if (!process.versions.electron) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-edge-native-'));
  const env = { ...process.env, PET_EDGE_NATIVE_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { fs.rmSync(userData, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, screen, nativeTheme } = require('electron');
  const sourceRoot = process.env.PET_EDGE_APP_ROOT || repo;
  const { createEdgeNotice } = require(path.join(sourceRoot, 'desktop-pet/lib/edge-notice'));
  const { createEdgeNoticeWindow } = require(path.join(sourceRoot, 'desktop-pet/lib/edge-notice-window'));
  const out = process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-edge-artifacts-'));
  app.setPath('userData', process.env.PET_EDGE_NATIVE_USER_DATA); app.setActivationPolicy('accessory');
  app.on('window-all-closed', () => {});
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const report = { source: 'real-electron; synthetic observations; injected clock; no API/model access', sourceRoot, cases: [], errors: [] };
    let surface;
    try {
      for (const side of ['left', 'right']) for (const appearance of ['light', 'dark']) {
        nativeTheme.themeSource = appearance;
        const area = screen.getPrimaryDisplay().workArea;
        const anchor = { x: side === 'left' ? area.x : area.x + area.width - 80, y: area.y + 200, width: 80, height: 80 };
        surface = createEdgeNoticeWindow({ BrowserWindow, screen,
          getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => anchor }),
          onError: error => report.errors.push(error.message) });
        let clock = 0, payload;
        const state = { presentation: { mode: 'tucked', side }, visible: true, locked: false, bubblesEnabled: false,
          quotaEnabled: true, zcodeQuotaEnabled: true, appearance,
          quotaModel: { state: 'ready', items: [{ remaining: 79, windowMinutes: 10080 }] },
          zcodeQuotaModel: { sourceId: 'zcode', state: 'ready', items: [{ bucketId: 'zcode:sample:bucket', model: 'GLM-5.3-Flash', remaining: 100 }] } };
        const notices = createEdgeNotice({ now: () => clock, random: () => 0,
          onChange: value => { payload = value; if (value) surface.show(value); else surface.hide(); } });
        const tick = time => { clock = time; notices.tick(state); };
        const capture = async (name, brand, text) => {
          const win = surface.getWindow();
          for (let i = 0; i < 100; i++) {
            if (win.isVisible() && await win.webContents.executeJavaScript(`document.getElementById('text').textContent`).then(value => value === text, () => false)) break;
            await wait(20);
          }
          await wait(250);
          const geometry = await win.webContents.executeJavaScript(`(() => { const n=document.getElementById('notice'),b=document.getElementById('brand'),t=document.getElementById('text');
            const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,client:e.clientWidth,scroll:e.scrollWidth,text:e.textContent}};
            return {notice:r(n),brand:r(b),text:r(t),title:n.title,width:innerWidth,appearance:document.documentElement.dataset.appearance}; })()`);
          assert.equal(geometry.brand.text, brand); assert.equal(geometry.text.text, text);
          assert.ok(geometry.text.scroll <= geometry.text.client + 1, 'text fits');
          assert.ok(geometry.text.right <= geometry.notice.right && geometry.brand.right <= geometry.text.left, 'no overlap');
          assert.ok(geometry.notice.right <= geometry.width - 3, 'capsule fits window');
          assert.equal(win.isFocused(), false); assert.doesNotMatch(geometry.text.text, /积分/);
          const file = `${side}-${appearance}-${name}.png`;
          fs.writeFileSync(path.join(out, file), (await win.webContents.capturePage()).toPNG());
          report.cases.push({ side, appearance, name, file, payload: { ...payload }, ...geometry });
        };
        tick(0); tick(30000); await capture('codex', 'Codex', '周额度 · 剩余 79%');
        tick(36000); tick(330000); await capture('zcode-100', 'ZCode', '5.3 Flash · 剩余 100%');
        const id = payload.id, expiry = payload.expiresAt;
        state.zcodeQuotaModel.items[0].remaining = 0; tick(331000);
        assert.equal(payload.id, id); assert.equal(payload.expiresAt, expiry);
        await capture('zcode-empty', 'ZCode', '5.3 Flash · 剩余 0% · 已用尽');
        state.zcodeQuotaEnabled = false; tick(332000); assert.equal(surface.getWindow().isVisible(), false);
        state.zcodeQuotaEnabled = true; state.quotaEnabled = false; notices.reset(); tick(430000); tick(460000);
        await capture('zcode-only', 'ZCode', '5.3 Flash · 剩余 0% · 已用尽');
        state.zcodeQuotaModel.state = 'stale'; tick(461000); assert.equal(surface.getWindow().isVisible(), false);
        state.zcodeQuotaModel.state = 'ready'; notices.reset(); tick(530000); tick(560000); assert.equal(surface.getWindow().isVisible(), true);
        state.locked = true; tick(560001); assert.equal(surface.getWindow().isVisible(), false);
        state.locked = false; notices.reset(); tick(650000); tick(680000); assert.equal(surface.getWindow().isVisible(), true);
        state.visible = false; tick(680001); assert.equal(surface.getWindow().isVisible(), false);
        notices.reset(); surface.destroy(); surface = null;
      }
      assert.equal(report.errors.length, 0); report.passed = true;
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log('ZCODE_EDGE_NATIVE_OK', JSON.stringify({ cases: report.cases.length, out })); app.exit(0);
    } catch (error) {
      report.passed = false; report.error = error.stack;
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      surface?.destroy(); console.error(error.stack); app.exit(1);
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
