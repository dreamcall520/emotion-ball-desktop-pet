const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(win) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      // rAF precedes the macOS compositor commit; wait before reading pixels.
      await wait(120);
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await wait(50);
      return await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    } catch (error) {
      if (!String(error).includes('UnknownVizError') || attempt === 2) throw new Error(`截图失败 ${win.getTitle?.() || 'unknown'} visible=${win.isVisible()}: ${error.message}`);
      await wait(150);
    }
  }
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
async function verifyWorkBuddyIntegration({ pet, quota, label, codexLabel, details, guard, codexDetails, edge, edgeNotices, chat, chatWindow, consent, openChat, setProvider, setEnabled, getSettings, getCodex, menuTemplate, setSize, outputDir, live = false }) {
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  const codexBefore = JSON.stringify(getCodex());
  const codexSettings = Object.fromEntries(Object.entries(getSettings()).filter(([k]) => k.startsWith('codex')));
  assert.equal(getSettings().workbuddyEnabled, false);
  assert.equal(quota.getState().report, null);
  const menu = menuTemplate().find(item => item.id === 'workbuddy-menu');
  assert(menu && menu.submenu.some(item => item.id === 'workbuddy-chat'));
  if (!live) {
    assert(consent, '隔离验收需要独立 WorkBuddy 授权控制器');
    const enabling = setEnabled(true);
    await until(() => consent.getWindow()?.isVisible(), 'WorkBuddy 默认授权窗口');
    const consentWin = consent.getWindow(), consentPage = code => consentWin.webContents.executeJavaScript(code);
    await until(() => consentPage("!document.getElementById('consent-accept').disabled"), '授权页真实就绪');
    assert.equal(getSettings().workbuddyEnabled, false, '同意前不启用 WorkBuddy');
    assert.equal(quota.getState().report, null, '同意前不读取余额');
    const consentStructure = await consentPage(`(() => {
      const cancel=document.getElementById('consent-cancel'),accept=document.getElementById('consent-accept');
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      return {style:Array.from(document.styleSheets).some(s=>s.href?.endsWith('/codex-consent.css')),
        title:document.getElementById('consent-title').textContent,sectionCount:document.querySelectorAll('.consent-disclosure section').length,
        avatar:!!document.querySelector('#consent-avatar canvas,#consent-avatar svg,#consent-avatar img'),
        cancelFocused:document.activeElement===cancel,cancel:rect(cancel),accept:rect(accept),width:innerWidth,height:innerHeight,
        disclosure:document.querySelector('.consent-disclosure').textContent}; })()`);
    assert.equal(consentStructure.style, true, '复用 Codex 授权视觉');
    assert.equal(consentStructure.sectionCount, 3); assert.equal(consentStructure.avatar, true);
    assert.equal(consentStructure.cancelFocused, true, '默认聚焦取消，不默认同意');
    assert(consentStructure.title.includes('WorkBuddy'));
    for (const text of ['本机 WorkBuddy 已登录的账户', '不向你索要 token 或密码', '仅在你主动发送聊天时', '不会自动发送消息']) assert(consentStructure.disclosure.includes(text), text);
    assert(consentStructure.cancel.left < consentStructure.accept.left, '取消与同意沿用 Codex 按钮顺序');
    for (const bounds of [consentStructure.cancel, consentStructure.accept]) assert(bounds.left >= 0 && bounds.right <= consentStructure.width && bounds.top >= 0 && bounds.bottom <= consentStructure.height, '授权操作完整可见');
    const consentThemes = {};
    for (const appearance of ['light', 'dark']) {
      consentWin.webContents.send('pet:color-mode', 'standard', appearance, 'blue');
      await until(() => consentPage(`document.documentElement.dataset.appearance === ${JSON.stringify(appearance)}`), '授权页明暗主题');
      consentThemes[appearance] = await consentPage("({background:getComputedStyle(document.querySelector('.consent-disclosure')).backgroundColor,text:getComputedStyle(document.querySelector('.consent-disclosure h2')).color})");
      if (outputDir) fs.writeFileSync(path.join(outputDir, `workbuddy-consent-${appearance}.png`), (await capture(consentWin)).toPNG());
    }
    assert.notEqual(consentThemes.light.background, consentThemes.dark.background);
    assert.notEqual(consentThemes.light.text, consentThemes.dark.text);
    await consentPage("document.getElementById('consent-cancel').click()");
    assert.equal(await enabling, false); assert.equal(consent.isPending(), false);
    assert.equal(getSettings().workbuddyEnabled, false); assert.equal(quota.getState().report, null);
    const accepting = setEnabled(true);
    await until(() => consent.getWindow()?.isVisible(), '取消后可重新申请 WorkBuddy 授权');
    await until(() => consent.getWindow().webContents.executeJavaScript("!document.getElementById('consent-accept').disabled"), '第二次授权就绪');
    await consent.getWindow().webContents.executeJavaScript("document.getElementById('consent-accept').click()");
    assert.equal(await accepting, true); assert.equal(consent.isPending(), false);
    if (outputDir) fs.writeFileSync(path.join(outputDir, 'workbuddy-consent-result.json'), JSON.stringify({ isolatedMock: true, cancelledWithoutEnabling: true,
      explicitAcceptance: true, codexVisualStructure: consentStructure, themes: consentThemes }, null, 2));
  } else await setEnabled(true);
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
  const cardFit = await page(`(() => { const ids = ['expanded-header','expanded-total','balances','refresh-date','expiry','trend','tasks','refresh']; return ids.every(id => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return true; const r=e.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }); })()`);
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
  const readyCodex = expanded => ({ state: 'ready', size: 'compact', expanded, items: [{ id: 'smoke-codex', label: 'Codex', windowMinutes: 300, remaining: 47.6, resetsAt: Date.now() + 3600000 }], overflow: 0, resetCreditsAvailable: 1 });
  const overlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  await page("document.getElementById('expanded-header').click()");
  await until(() => page("document.getElementById('quota-label').dataset.expanded === 'false'"), '整个标题行点击收起');
  await page("document.getElementById('toggle').click()");
  assert.match(await page("document.getElementById('tasks').title"), /完整统计暂未提供/);
  if (codexLabel) {
    codexLabel.show(readyCodex(false));
    await until(() => codexLabel.getWindow()?.isVisible(), 'Codex卡与WB同时显示');
    label.reposition();
    const codexBounds = codexLabel.getVisibleBounds(), wbBounds = win.getBounds(), petBounds = pet.getBounds();
    assert.equal(win.isVisible(), true);
    assert(!(wbBounds.x < codexBounds.x + codexBounds.width && wbBounds.x + wbBounds.width > codexBounds.x && wbBounds.y < codexBounds.y + codexBounds.height && wbBounds.y + wbBounds.height > codexBounds.y), '双额度卡不重叠');
    assert(Math.abs(wbBounds.x + wbBounds.width / 2 - petBounds.x - petBounds.width / 2) <= 1, '双卡并存时WB仍居中');
    if (outputDir) fs.writeFileSync(path.join(outputDir, 'dual-cards-bounds.json'), JSON.stringify({ codex: codexBounds, workbuddy: wbBounds, pet: petBounds }, null, 2));
    codexLabel.hide(); label.reposition();
  }


  if (edge && codexLabel) {
    const edgeEvidence = [];
    for (const side of ['left', 'right']) {
      edge.dock(side);
      const p = pet.getBounds();
      edge.sampleCursor({ x: side === 'left' ? p.x + 4 : p.x + p.width - 4, y: p.y + p.height / 2 });
      edge.pin(true, 'workbuddy-smoke');
      await until(() => edge.getPresentation().mode === 'peeked', '贴边探头状态');
      for (const expanded of [false, true]) {
        codexLabel.show(readyCodex(expanded));
        await until(() => codexLabel.getWindow()?.isVisible(), '贴边Codex卡');
        const codexPage = code => codexLabel.getWindow().webContents.executeJavaScript(code);
        await until(() => codexPage("document.getElementById('quota-label').dataset.hasItems === 'true'"), '贴边Codex卡数据就绪');
        if ((await codexPage("document.getElementById('quota-label').dataset.expanded === 'true'")) !== expanded) await codexPage("document.getElementById('quota-label').click()");
        await until(() => codexPage(`document.getElementById('quota-label').dataset.expanded === '${expanded}'`), 'Codex原生卡展开状态');
        label.reposition();
        await until(() => win.isVisible(), '贴边WB卡');
        if (expanded && !(await page("document.getElementById('quota-label').dataset.expanded === 'true'"))) await page("document.getElementById('toggle').click()");
        const c=codexLabel.getVisibleBounds(),w=win.getBounds();
        assert.equal(overlap(c,w),false,'贴边双卡互不覆盖');
        const sameEdge=side==='left'?Math.abs(c.x-w.x):Math.abs(c.x+c.width-w.x-w.width);
        assert(sameEdge<=1,'贴边双卡同侧边缘对齐');
        assert(w.y>=c.y+c.height || w.y+w.height<=c.y,'双卡上下排列');
        edgeEvidence.push({side,expanded,codex:c,workbuddy:w});
        assert.equal(label.getGuardWindow()?.isVisible() || false,false,'Codex入口存在时WB不重复入口');
      }
      codexLabel.hide();edge.pin(false,'workbuddy-smoke');edge.restore();
    }
    pet.setBounds(centeredPet);label.reposition();
    if(outputDir)fs.writeFileSync(path.join(outputDir,'edge-dual-cards.json'),JSON.stringify(edgeEvidence,null,2));
  }
  if (guard) {
    codexLabel?.hide();
    await until(() => win.isVisible(),'单WB卡恢复');
    if(await page("document.getElementById('quota-label').dataset.expanded === 'true'")) await page("document.getElementById('expanded-header').click()");
    label.reposition();
    await until(() => label.getGuardWindow()?.isVisible(),'WB独立游戏入口');
    const entry=label.getGuardWindow(),entryPage=code=>entry.webContents.executeJavaScript(code);
    await until(() => entryPage("window.quotaGuardEntry?.state.ready && !document.getElementById('quota-guard-entry').hidden && !document.getElementById('quota-guard-entry').disabled"),'WB僵尸动画入口');
    assert.equal(entry.getBounds().width,48);assert.equal(entry.getBounds().height,44);
    assert.match(await entryPage("document.getElementById('quota-guard-entry').getAttribute('aria-label')"),/自由练习/);
    if(outputDir)fs.writeFileSync(path.join(outputDir,'workbuddy-game-entry.png'),(await capture(entry)).toPNG());
    await entryPage("document.getElementById('quota-guard-entry').click()");
    await until(() => guard.getWindow()?.isVisible(),'从WB打开自由练习');
    const gameWin=guard.getWindow(),gamePage=code=>gameWin.webContents.executeJavaScript(code);
    await until(() => gamePage("document.getElementById('guard-period').textContent === '自由练习'"),'游戏自由练习文案');
    assert.equal(await gamePage("document.getElementById('guard-number').textContent.includes('%')"),false,'不把WB积分当percent');
    await until(() => gamePage("window.quotaGuardView?.state.spritesReady && !document.getElementById('guard-qiuqiu').disabled"),'练习动画加载且可操作');
    const shots = await gamePage('window.quotaGuardView.state.clickShots');
    await gamePage("document.getElementById('guard-qiuqiu').click()");
    assert.equal(await gamePage('window.quotaGuardView.state.clickShots'),shots+1,'自由练习发射可交互');
    if(outputDir)fs.writeFileSync(path.join(outputDir,'workbuddy-practice-game.png'),(await capture(gameWin)).toPNG());
    await gamePage("document.getElementById('guard-close').click()");
    await until(() => !guard.isVisible() && win.isVisible(),'关闭游戏恢复卡片');
  }
  if (codexDetails) {
    codexLabel?.show(readyCodex(false)); label.reposition();
    await until(() => win.isVisible() && codexLabel?.getWindow()?.isVisible(), '打开详情前双卡均显示');
    codexDetails.open({action:'credits',extraCredits:{state:'balance',balance:'10.00'}});
    await until(() => codexDetails.getWindow()?.isVisible(),'打开Codex详情');
    await until(() => !win.isVisible() && !(codexLabel?.getWindow()?.isVisible()),'Codex详情打开隐藏双卡');
    codexDetails.close();
    await until(() => win.isVisible(),'关闭Codex详情恢复WB卡');
  }


  if (details) {
    codexLabel?.show(readyCodex(false)); label.reposition();
    await until(() => win.isVisible() && codexLabel?.getWindow()?.isVisible(), '打开WB详情前双卡均显示');
    if(!(await page("document.getElementById('quota-label').dataset.expanded === 'true'"))) await page("document.getElementById('toggle').click()");
    await page("document.getElementById('trend').click()");
    await until(() => details.getWindow()?.isVisible(), '卡片趋势入口打开详情');
    await until(() => !win.isVisible() && !(codexLabel?.getWindow()?.isVisible()), 'WB详情打开隐藏双卡');
    const detailWin = details.getWindow(), detailPage = code => detailWin.webContents.executeJavaScript(code);
    await until(() => detailPage("document.getElementById('today').getAttribute('aria-pressed') === 'true'"), '详情默认今日');
    await detailPage("document.getElementById('week').click()");
    assert.equal(await detailPage("document.getElementById('week').getAttribute('aria-pressed')"), 'true');
    const at = Date.now() - 1000;
    const trendReport = { total: 7399.91, updatedAt: at };
    details.update({ report: trendReport, history: [] });
    await until(() => detailPage("document.getElementById('hint').textContent.includes('暂无查询记录') && !document.querySelector('#chart svg')"), '趋势空态无伪造折线');
    details.update({ report: trendReport, history: [{ at, total: 7399.91 }] });
    await until(() => detailPage("document.getElementById('hint').textContent.includes('仅有1次查询') && !document.querySelector('#chart svg')"), '单点只提示等待记录');
    details.update({report:trendReport,history:[{at:at-300000,total:7399.91},{at,total:7399.91}]});
    await until(() => detailPage("document.getElementById('hint').textContent.includes('积分未变化') && !document.querySelector('#chart svg')"),'余额不变不用大平线');
    assert.equal(await detailPage("document.getElementById('change').textContent"),'0');
    assert.equal(await detailPage("document.getElementById('forecast').textContent"),'还不能估算可用天数');
    details.update({ report: trendReport, history: [{ at: at - 1800000, total: 7400 }, { at: at - 1500000, total: 7399.95 }, { at, total: 7399.91 }] });
    await until(() => detailPage("document.querySelectorAll('#chart circle.point').length === 3"), '详情真实采样点');
    const trendShape = await detailPage(`(() => { const svg=document.querySelector('#chart svg');return {viewBox:svg.getAttribute('viewBox'),solid:Boolean(svg.querySelector('.observed-line')),gap:Boolean(svg.querySelector('.unrecorded-line')),points:[...svg.querySelectorAll('circle.point')].map(p=>({x:Number(p.getAttribute('cx')),y:Number(p.getAttribute('cy')),title:p.querySelector('title').textContent})),timeLabels:[...svg.querySelectorAll('text[y="132"]')].map(n=>n.textContent)}; })()`);
    assert.equal(await detailPage("document.getElementById('change-label').textContent"),'近7天减少');
    assert.equal(await detailPage("document.getElementById('forecast').textContent"),'还不能估算可用天数');
    await detailPage("document.querySelector('#explanation summary').click()");
    assert.equal(await detailPage("document.getElementById('explanation').open"),true);
    assert.match(await detailPage("document.getElementById('explanation').textContent"),/不是消费流水/);
    await detailPage("document.querySelector('#explanation summary').click()");
    assert.equal(trendShape.viewBox, '0 0 374 144');
    assert.equal(trendShape.solid, true); assert.equal(trendShape.gap, true);
    assert.equal(trendShape.points[0].x, 48); assert.equal(trendShape.points.at(-1).x, 352);
    assert.equal(trendShape.points[0].y, 28); assert.equal(trendShape.points.at(-1).y, 108);
    assert.match(trendShape.points.at(-1).title, /7,399\.91 积分/);
    assert.equal(trendShape.timeLabels.length, 2);
    assert(trendShape.timeLabels.every(text => /\d{2}:\d{2}/.test(text)), '真实时间轴');
    const themeEvidence = {};
    for (const appearance of ['light', 'dark']) {
      detailWin.webContents.send('pet:color-mode', 'standard', appearance, 'blue');
      await until(() => detailPage(`document.documentElement.dataset.resolvedAppearance === ${JSON.stringify(appearance)}`), '详情实际明暗主题');
      const computed = await detailPage(`(() => { const panel=getComputedStyle(document.getElementById('details-panel'));return {resolved:document.documentElement.dataset.resolvedAppearance,background:panel.backgroundColor,text:getComputedStyle(document.body).color,tab:document.getElementById('week').getAttribute('aria-pressed'),balance:document.getElementById('balance').textContent,points:document.querySelectorAll('#chart circle.point').length}; })()`);
      assert.equal(computed.resolved, appearance);
      assert.equal(computed.background, appearance === 'dark' ? 'rgba(26, 34, 45, 0.96)' : 'rgba(244, 249, 255, 0.94)', '详情共享CSS真实背景颜色');
      assert.equal(computed.text, appearance === 'dark' ? 'rgb(245, 247, 250)' : 'rgb(37, 43, 52)', '详情共享CSS真实文本颜色');
      assert.equal(computed.tab, 'true'); assert.equal(computed.balance, '7,399.91'); assert.equal(computed.points, 3);
      themeEvidence[appearance] = computed;
      if (outputDir) fs.writeFileSync(path.join(outputDir, appearance === 'light' ? 'workbuddy-trend-details.png' : 'workbuddy-trend-details-dark.png'), (await capture(detailWin)).toPNG());
    }
    if (outputDir) {
      fs.writeFileSync(path.join(outputDir, 'trend-shape.json'), JSON.stringify(trendShape, null, 2));
      fs.writeFileSync(path.join(outputDir, 'trend-theme.json'), JSON.stringify(themeEvidence, null, 2));
    }
    await detailPage("document.getElementById('details-close').click()");
    await until(() => !details.isVisible(), '关闭趋势详情');
    await until(() => win.isVisible(), '关闭详情后积分卡恢复');
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
  if (!live && edgeNotices) {
    const noticeState = { visible: true, presentation: { mode: 'tucked', side: 'left' }, bubblesEnabled: false,
      quotaEnabled: true, quotaModel: { state: 'ready', items: [{ windowMinutes: 300, remaining: 83 }] },
      workbuddyEnabled: true, workbuddyState: quota.getState(), appearance: 'light' };
    try {
      edgeNotices.reset();
      edgeNotices.tick(0, noticeState); edgeNotices.tick(30000, noticeState);
      await until(() => edgeNotices.getWindow()?.isVisible(), '首个 Codex 边缘提示');
      const noticeWin = edgeNotices.getWindow(), noticePage = code => noticeWin.webContents.executeJavaScript(code);
      await until(() => noticePage("document.getElementById('brand').textContent === 'Codex' && document.getElementById('text').textContent.includes('83%')"), 'Codex 原有品牌和百分比');
      edgeNotices.tick(36000, noticeState);
      await until(() => !noticeWin.isVisible(), '额度提示按时撤下');
      edgeNotices.tick(120000, noticeState); assert.equal(noticeWin.isVisible(), false, '共享冷却不提前增加提示');
      edgeNotices.tick(330000, noticeState);
      await until(() => noticeWin.isVisible(), 'WorkBuddy 接续额度槽');
      await until(() => noticePage("document.getElementById('brand').textContent === 'WorkBuddy' && document.getElementById('text').textContent === '还剩7,400积分'"), 'WorkBuddy 精确积分而非百分比');
      if (outputDir) fs.writeFileSync(path.join(outputDir, 'workbuddy-edge-balance.png'), (await capture(noticeWin)).toPNG());
      noticeState.workbuddyState = { ...quota.getState(), error: 'isolated test error' };
      edgeNotices.tick(330001, noticeState);
      await until(() => !noticeWin.isVisible(), '错误余额立即撤下边缘提示');
      noticeState.workbuddyState = quota.getState();
      edgeNotices.tick(630000, noticeState); edgeNotices.tick(636000, noticeState); edgeNotices.tick(930000, noticeState);
      const expiry = noticeState.workbuddyState.report.expires[0];
      const date = new Date(expiry.at + 8 * 3600000);
      const expiryText = `${expiry.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}积分将于${date.getUTCMonth() + 1}/${date.getUTCDate()}到期`;
      await until(() => noticeWin.isVisible() && noticePage(`document.getElementById('brand').textContent === 'WorkBuddy' && document.getElementById('text').textContent === ${JSON.stringify(expiryText)}`), 'WorkBuddy 到期提示轮换');
      if (outputDir) fs.writeFileSync(path.join(outputDir, 'workbuddy-edge-expiry.png'), (await capture(noticeWin)).toPNG());
      noticeState.workbuddyState = { ...quota.getState(), report: { ...quota.getState().report, updatedAt: Date.now() - 11 * 60000 } };
      edgeNotices.tick(930001, noticeState);
      await until(() => !noticeWin.isVisible(), '过期余额立即撤下边缘提示');
    } finally { edgeNotices.reset(); }
  }
  await setEnabled(false);
  assert.equal(quota.getState().report, null);
  assert.equal(label.getWindow()?.isVisible() || false, false);
  assert.equal(getSettings().chatProvider, 'codex');
  assert.equal(beforePet.width > 0, true);
  if (live && outputDir) fs.writeFileSync(path.join(outputDir, 'live-native-result.json'), JSON.stringify({ passed: true, report: finalReport, reply, source: 'WorkBuddy', mode: 'live' }, null, 2));
  process.stdout.write('PET_WORKBUDDY_INTEGRATION_OK\n');
}
module.exports = { createSmokeWorkBuddyRunner, verifyWorkBuddyIntegration };
