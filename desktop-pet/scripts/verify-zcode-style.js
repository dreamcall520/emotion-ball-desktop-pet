const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { pointerClick } = require('./verify-chat-integration');
const { capturePaintedWindow } = require('./verify-codex-companion');
async function poll(read, accept, label, milliseconds = 20000) {
  const until = Date.now() + milliseconds;
  do { const value = await read(); if (accept(value)) return value; await wait(80); } while (Date.now() < until);
  throw new Error(`${label}超时`);
}
async function verifyZcodeStyle({ pet, zcodeLink, zcodeConsent, codex, getMenu, getSettings, powerMonitor, BrowserWindow }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1'); assert.equal(process.env.PET_SMOKE_ZCODE_STYLE_ONLY, '1');
  assert.equal(require('electron').app.isPackaged, true);
  const out = process.env.PET_SMOKE_ARTIFACT_DIR; assert.ok(out && path.isAbsolute(out)); fs.mkdirSync(out, { recursive: true });
  const report = { ok: false, actualModelMessages: 0, surfaces: [], checks: [] };
  const page = (win, js) => win.webContents.executeJavaScript(js, true);
  const capture = async (win, name) => capturePaintedWindow({ win, artifactPath: path.join(out, `${name}.png`) });
  function toggle(value) { const item = getMenu().getMenuItemById('zcode-enabled'); if (item.checked !== value) item.click(item, pet, {}); }
  const visible = win => win && !win.isDestroyed() && win.isVisible();
  async function consentSurface(win) {
    await poll(() => page(win, '!document.querySelector("#consent-accept").disabled'), Boolean, '授权页就绪');
    const geometry = await page(win, `(() => {const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};const body=document.querySelector('.consent-content');return {width:innerWidth,height:innerHeight,scroll:document.body.scrollWidth,contentScroll:body.scrollHeight,contentHeight:body.clientHeight,avatar:rect('#consent-avatar'),accept:rect('#consent-accept'),cancel:rect('#consent-cancel'),title:document.querySelector('#consent-title').textContent,subtitle:document.querySelector('#consent-subtitle').textContent,disclosures:document.querySelectorAll('.consent-disclosure section').length};})()`);
    assert.equal(geometry.width, 460); assert.equal(geometry.height, 656);
    assert.ok(geometry.scroll <= 460); assert.ok(geometry.contentScroll <= geometry.contentHeight + 1, '授权全文和按钮无需滚动');
    assert.equal(geometry.disclosures, 3); assert.ok(geometry.accept.right <= 460 && geometry.accept.bottom < 656);
    return geometry;
  }
  try {
    for (const mode of ['light', 'dark']) {
      const setting = getMenu().getMenuItemById(`color-appearance-${mode}`); setting.click(setting, pet, {});
      const codexPending = codex.request(); const codexWin = await poll(codex.getWindow, visible, 'Codex 参考授权');
      const reference = await consentSurface(codexWin); await capture(codexWin, `consent-codex-${mode}`);
      await pointerClick(codexWin, '#consent-cancel'); assert.equal(await codexPending, false);
      toggle(true); const win = await poll(zcodeConsent.getWindow, visible, 'ZCode 共享授权');
      const current = await consentSurface(win);
      assert.equal(current.title, '让球球陪你关注 ZCode'); assert.equal(current.subtitle, reference.subtitle);
      for (const key of ['avatar', 'accept', 'cancel']) assert.deepEqual(current[key], reference[key], `${key} 对齐 Codex`);
      await capture(win, `consent-zcode-${mode}`); report.surfaces.push({ mode, reference, current });
      await pointerClick(win, '#consent-cancel'); await poll(() => zcodeConsent.getWindow(), value => value === null, '取消关闭授权');
      assert.equal(zcodeLink.isEnabled(), false); assert.equal(getSettings().zcodeEnabled, false);
    }
    for (const reason of ['disable', 'lock']) {
      toggle(true); const win = await poll(zcodeConsent.getWindow, visible, '待确认授权');
      if (reason === 'disable') await zcodeLink.setEnabled(false); else powerMonitor.emit('lock-screen');
      await poll(() => win.isDestroyed(), Boolean, `${reason} 取消授权`);
      assert.equal(zcodeLink.isEnabled(), false); if (reason === 'lock') powerMonitor.emit('unlock-screen');
    }
    report.checks.push('同HTML/CSS/头像/布局', '浅深主题与Codex几何一致', '取消不启用', '关闭和锁屏取消待确认');
    const setting = getMenu().getMenuItemById('color-appearance-light'); setting.click(setting, pet, {});
    toggle(true); const consent = await poll(zcodeConsent.getWindow, visible, '确认授权');
    await consentSurface(consent); await pointerClick(consent, '#consent-accept');
    await poll(() => zcodeLink.getSnapshot(), value => value.enabled && value.quota.state === 'connected', '确认后真实额度', 45000);
    assert.equal(getSettings().zcodeEnabled, true);
    zcodeLink.setPreference('zcodeQuotaLabelSize', 'compact'); zcodeLink.setPreference('zcodeQuotaAlwaysVisible', true);
    const card = await poll(zcodeLink.getWindow, visible, '简短额度卡');
    await poll(() => page(card, "document.querySelector('#quota-label').dataset.hasItems"), value => value === 'true', '额度卡渲染');
    assert.match(await page(card, "document.querySelector('#summary .summary-period-label').textContent"), /额度/);
    await capture(card, 'compact-quota');
    await pointerClick(card, '#quota-label');
    await poll(() => page(card, "document.querySelector('#quota-label').dataset.expanded"), value => value === 'true', '展开额度卡');
    await pointerClick(card, '[data-action="trend"]');
    const findDetails = async () => {
      for (const win of BrowserWindow.getAllWindows().filter(win => visible(win) && win.webContents.getURL().endsWith('/codex-details.html'))) {
        if (await page(win, "document.querySelector('#details-panel')?.dataset.source") === 'zcode') return win;
      }
      return null;
    };
    const details = await poll(findDetails, visible, '趋势新控件');
    await poll(() => page(details, "Boolean(document.querySelector('.zcode-bucket-trigger'))"), Boolean, '额度选择器');
    await pointerClick(details, '.zcode-bucket-trigger');
    const last = await page(details, "document.querySelector('.zcode-bucket-option:last-child')?.dataset.bucketOption"); assert.ok(last);
    await pointerClick(details, '.zcode-bucket-option:last-child');
    await poll(() => page(details, "document.querySelector('.zcode-bucket-option[aria-checked=true]')?.dataset.bucketOption"), value => value === last, '实际换桶IPC');
    await capture(details, 'trend-bucket-picker'); await pointerClick(details, '#details-close');
    report.checks.push('真实确认后启用', '简短额度文案', '包内新选择器换桶IPC');
    await zcodeLink.setEnabled(false); report.ok = true;
  } catch (error) { report.failure = error.message; throw error; } finally {
    zcodeConsent.cancel(); if (zcodeLink.isEnabled()) await zcodeLink.setEnabled(false);
    fs.writeFileSync(path.join(out, 'style-report.json'), JSON.stringify(report, null, 2));
  }
  process.stdout.write('PET_ZCODE_STYLE_OK\n');
}
module.exports = { verifyZcodeStyle };
