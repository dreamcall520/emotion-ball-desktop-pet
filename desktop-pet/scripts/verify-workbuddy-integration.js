const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(win) {
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
}
const accountKey = '9'.repeat(64);
const report = () => ({ total: 7400, basic: 500, reward: 6900, purchased: 0, plan: '体验版',
  nextRefreshAt: Date.now() + 7 * 86400000, expires: [{ amount: 100, at: Date.now() + 3 * 86400000 }], updatedAt: Date.now() });
function createSmokeWorkBuddyRunner() {
  return async (operation, payload, { signal, onDelta } = {}) => {
    if (operation === 'quota') return { accountKey, report: report() };
    if (operation === 'models') return { accountKey, models: [{ id: 'glm-5.3-flash', displayName: 'GLM-5.3-Flash' }] };
    assert.equal(operation, 'chat'); assert.equal(payload.expectedAccountKey, accountKey);
    const text = JSON.stringify({ text: '我是球球，今天也陪着你。', action: 'none' });
    await wait(300);
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
    onDelta(text); return { accountKey, text };
  };
}
async function until(read, label) {
  for (let n = 0; n < 200; n++) { if (await read()) return; await wait(50); }
  throw new Error('等待失败：' + label);
}
async function verifyWorkBuddyIntegration({ pet, quota, label, codexLabel, details, chat, chatWindow, openChat, setProvider, setEnabled, getSettings, getCodex, menuTemplate, setSize, outputDir, live = false }) {
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  const codexBefore = JSON.stringify(getCodex());
  const codexSettings = Object.fromEntries(Object.entries(getSettings()).filter(([k]) => k.startsWith('codex')));
  assert.equal(getSettings().workbuddyEnabled, false);
  assert.equal(quota.getState().report, null);
  const menu = menuTemplate().find(item => item.id === 'workbuddy-menu');
  assert(menu && menu.submenu.some(item => item.id === 'workbuddy-chat'));
  await setEnabled(true);
  await until(() => quota.getState().report && label.getWindow()?.isVisible(), '独立积分卡');
  if (!live) assert.equal(quota.getState().report.total, 7400);
  const totalText = quota.getState().report.total.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  let win = label.getWindow();
  const page = code => win.webContents.executeJavaScript(code);
  await until(() => page(`document.body.innerText.includes(${JSON.stringify(totalText)})`), '余额渲染');
  const beforePet = pet.getBounds();
  for (const size of ['tiny', 'large']) {
    setSize(size); label.reposition();
    const a = label.getWindow().getBounds(), b = pet.getBounds();
    assert(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
  }
  setSize('tiny');
  const area = require('electron').screen.getDisplayMatching(pet.getBounds()).workArea;
  const centeredPet = pet.getBounds();
  centeredPet.y = Math.round(area.y + (area.height - centeredPet.height) / 2);
  for (const offset of [-40, 40]) {
    centeredPet.x = Math.round(area.x + (area.width - centeredPet.width) / 2 + offset);
    pet.setBounds(centeredPet); label.reposition();
    await until(() => { const a=win.getBounds(),b=pet.getBounds(); return Math.abs(a.x+a.width/2-b.x-b.width/2)<=1; }, '收起卡随球球居中移动');
  }
  if (outputDir) fs.writeFileSync(path.join(outputDir, 'quota-compact.png'), (await capture(win)).toPNG());
  await page("document.querySelector('button').click()");
  await wait(100);
  { const a=win.getBounds(),b=pet.getBounds(); assert(Math.abs(a.x+a.width/2-b.x-b.width/2)<=1, '展开卡居中'); }
  const cardFit = await page(`(() => { const ids = ['expanded-header','expanded-total','balances','refresh-date','expiry','trend','status','refresh']; return ids.every(id => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return true; const r=e.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }); })()`);
  if (!cardFit) process.stdout.write('WB_CARD_LAYOUT ' + JSON.stringify(await page(`Object.fromEntries(['expanded-header','value-row','dates','auxiliary','refresh'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{y:r.y,bottom:r.bottom,height:r.height,window:innerHeight}]}))`)) + '\n');
  assert.equal(cardFit, true, '展开信息和操作完整显示');
  const layout = await page(`(() => { const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom};};return {rows:['expanded-header','value-row','dates','auxiliary'].map(rect),toggleOutline:getComputedStyle(document.getElementById('toggle')).outlineStyle,cardOutline:getComputedStyle(document.getElementById('quota-label')).outlineStyle}; })()`);
  for (let i=1;i<layout.rows.length;i++) assert(layout.rows[i].top >= layout.rows[i-1].bottom - 0.5, '展开信息行互不覆盖');
  assert.equal(layout.toggleOutline, 'none', '鼠标展开按钮无默认选中框');
  assert.equal(layout.cardOutline, 'none', '鼠标展开卡片无默认选中框');
  if (outputDir) fs.writeFileSync(path.join(outputDir, 'quota-expanded.png'), (await capture(win)).toPNG());
  for (const [mode, appearance] of [['standard','dark'],['accessible','light'],['accessible','dark']]) {
    win.webContents.send('pet:color-mode', mode, appearance, 'blue');
    await until(() => page(`document.documentElement.dataset.colorMode === ${JSON.stringify(mode)} && document.documentElement.dataset.appearance === ${JSON.stringify(appearance)}`), '额度卡主题');
    await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await page("document.getElementById('refresh').getBoundingClientRect().bottom <= innerHeight && !document.getElementById('chat')"), true);
    if (outputDir) fs.writeFileSync(path.join(outputDir, `quota-${mode}-${appearance}.png`), (await capture(win)).toPNG());
  }
  win.webContents.send('pet:color-mode', 'standard', 'system', 'blue');
  assert.equal(await page("!document.getElementById('chat') && !document.getElementById('trend-chart') && document.getElementById('trend').tagName === 'BUTTON'"), true);
  if (codexLabel) {
    codexLabel.show({ state: 'ready', items: [{ id: 'smoke-codex', label: 'Codex', windowMinutes: 300, remaining: 47.6, resetsAt: Date.now() + 3600000 }], overflow: 0, resetCreditsAvailable: 1 });
    await until(() => codexLabel.getWindow()?.isVisible(), 'Codex卡与WB同时显示');
    label.reposition();
    const codexBounds = codexLabel.getWindow().getBounds(), wbBounds = win.getBounds(), petBounds = pet.getBounds();
    assert.equal(win.isVisible(), true);
    assert(!(wbBounds.x < codexBounds.x + codexBounds.width && wbBounds.x + wbBounds.width > codexBounds.x && wbBounds.y < codexBounds.y + codexBounds.height && wbBounds.y + wbBounds.height > codexBounds.y), '双额度卡不重叠');
    assert(Math.abs(wbBounds.x + wbBounds.width / 2 - petBounds.x - petBounds.width / 2) <= 1, '双卡并存时WB仍居中');
    if (outputDir) fs.writeFileSync(path.join(outputDir, 'dual-cards-bounds.json'), JSON.stringify({ codex: codexBounds, workbuddy: wbBounds, pet: petBounds }, null, 2));
    codexLabel.hide(); label.reposition();
  }


  if (details) {
    await page("document.getElementById('trend').click()");
    await until(() => details.getWindow()?.isVisible(), '卡片趋势入口打开详情');
    const detailWin = details.getWindow(), detailPage = code => detailWin.webContents.executeJavaScript(code);
    await until(() => detailPage("document.getElementById('today').getAttribute('aria-pressed') === 'true'"), '详情默认今日');
    await detailPage("document.getElementById('week').click()");
    assert.equal(await detailPage("document.getElementById('week').getAttribute('aria-pressed')"), 'true');
    const at = Date.now() - 1000;
    const trendReport = { total: 7399.91, updatedAt: at };
    details.update({ report: trendReport, history: [] });
    await until(() => detailPage("document.getElementById('hint').textContent.includes('暂无真实查询记录') && !document.querySelector('#chart svg')"), '趋势空态无伪造折线');
    details.update({ report: trendReport, history: [{ at, total: 7399.91 }] });
    await until(() => detailPage("document.getElementById('hint').textContent.includes('仅有1次真实查询') && !document.querySelector('#chart svg')"), '单点只提示等待记录');
    details.update({ report: trendReport, history: [{ at: at - 1800000, total: 7400 }, { at: at - 1500000, total: 7399.95 }, { at, total: 7399.91 }] });
    await until(() => detailPage("document.querySelectorAll('#chart circle.point').length === 3"), '详情真实采样点');
    const trendShape = await detailPage(`(() => { const svg=document.querySelector('#chart svg');return {viewBox:svg.getAttribute('viewBox'),solid:Boolean(svg.querySelector('.observed-line')),gap:Boolean(svg.querySelector('.unrecorded-line')),points:[...svg.querySelectorAll('circle.point')].map(p=>({x:Number(p.getAttribute('cx')),y:Number(p.getAttribute('cy')),title:p.querySelector('title').textContent})),timeLabels:[...svg.querySelectorAll('text[y="132"]')].map(n=>n.textContent)}; })()`);
    assert.equal(trendShape.viewBox, '0 0 374 144');
    assert.equal(trendShape.solid, true); assert.equal(trendShape.gap, true);
    assert.equal(trendShape.points[0].x, 48); assert.equal(trendShape.points.at(-1).x, 352);
    assert.equal(trendShape.points[0].y, 28); assert.equal(trendShape.points.at(-1).y, 108);
    assert.match(trendShape.points.at(-1).title, /7,399\.91 积分/);
    assert.equal(trendShape.timeLabels.length, 2);
    assert(trendShape.timeLabels.every(text => /\d{2}:\d{2}/.test(text)), '真实时间轴');
    if (outputDir) {
      fs.writeFileSync(path.join(outputDir, 'workbuddy-trend-details.png'), (await capture(detailWin)).toPNG());
      fs.writeFileSync(path.join(outputDir, 'trend-shape.json'), JSON.stringify(trendShape, null, 2));
    }
    await detailPage("document.getElementById('details-close').click()");
    await until(() => !details.isVisible(), '关闭趋势详情');
    assert.equal(win.isVisible(), true, '关闭详情后积分卡仍在');
    details.update(quota.getState());
  }

  await setProvider('workbuddy'); openChat();
  await until(() => chat.getState().modelsStatus === 'ready' && chatWindow.isVisible(), '聊天连接');
  const chatWin = chatWindow.getWindow();
  const ui = code => chatWin.webContents.executeJavaScript(code);
  await until(() => ui("document.querySelector('#chat-provider')?.value === 'workbuddy'"), '来源显示');
  assert.equal(label.getWindow().isVisible(), false, '聊天时避让');
  if (live) assert.equal((await ui('window.qiuqiuChat.setModel("glm-5.3-flash")')).accepted, true);
  const sent = await ui('window.qiuqiuChat.send("你好球球，请简短打个招呼。")');
  assert.equal(sent.accepted, true, sent.error);
  const blocked = await ui('window.qiuqiuChat.setProvider("codex")');
  assert.equal(blocked.accepted, false, '回复中禁止切来源');
  await until(() => !chat.getState().busy && chat.getState().messages.at(-1)?.status === 'complete', '回复完成');
  const reply = chat.getState().messages.at(-1).text;
  assert(reply && !chat.getState().error, chat.getState().error);
  await until(() => ui(`document.querySelector('#messages').innerText.includes(${JSON.stringify(reply)})`), '聊天正文');
  await until(() => ui("document.querySelector('#stop-message').hidden && !document.querySelector('#send-message').hidden"), '最终聊天状态');
  await ui('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  if (outputDir) fs.writeFileSync(path.join(outputDir, 'workbuddy-chat.png'), (await capture(chatWin)).toPNG());
  const styles = await ui(`(() => { const keys=['fontFamily','fontSize','fontWeight','borderTopWidth','borderRadius','backgroundColor','height','color']; const read=id=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(document.getElementById(id))[k]])); return {provider:read('chat-provider'),model:read('chat-model'),native:document.querySelector('select#chat-provider')!==null}; })()`);
  assert.equal(styles.native, false);
  assert.deepEqual(styles.provider, styles.model, '来源和模型按钮使用同一现有样式');
  await ui("document.getElementById('chat-provider').click()");
  assert.equal(await ui("!document.getElementById('provider-menu').hidden && document.querySelectorAll('#provider-menu [role=menuitemradio]').length === 2"), true);
  await ui('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  if (outputDir) fs.writeFileSync(path.join(outputDir, 'provider-menu.png'), (await capture(chatWin)).toPNG());
  await ui("document.getElementById('chat-provider').click()");

  assert.equal((await ui('window.qiuqiuChat.setProvider("codex")')).accepted, true);
  await until(() => ui("document.querySelector('#chat-provider').value === 'codex'"), '切回Codex');
  assert.equal(JSON.stringify(getCodex()), codexBefore, 'Codex额度快照保持');
  assert.deepEqual(Object.fromEntries(Object.entries(getSettings()).filter(([k]) => k.startsWith('codex'))), codexSettings);
  const finalReport = quota.getState().report;
  await setEnabled(false);
  assert.equal(quota.getState().report, null);
  assert.equal(label.getWindow()?.isVisible() || false, false);
  assert.equal(getSettings().chatProvider, 'codex');
  assert.equal(beforePet.width > 0, true);
  if (live && outputDir) fs.writeFileSync(path.join(outputDir, 'live-native-result.json'), JSON.stringify({ passed: true, report: finalReport, reply, source: 'WorkBuddy', mode: 'live' }, null, 2));
  process.stdout.write('PET_WORKBUDDY_INTEGRATION_OK\n');
}
module.exports = { createSmokeWorkBuddyRunner, verifyWorkBuddyIntegration };
