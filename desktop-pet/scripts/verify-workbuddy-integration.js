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
let smokeTaskRevision = Date.now() - 1000;
const report = () => ({ total: 7400, basic: 500, reward: 6900, purchased: 0, plan: '体验版',
  nextRefreshAt: Date.now() + 7 * 86400000, expires: [{ amount: 100, at: Date.now() + 3 * 86400000 }], updatedAt: Date.now() });
function createSmokeWorkBuddyRunner() {
  return async (operation, payload, { signal, onDelta } = {}) => {
    if (operation === 'quota') return { accountKey, report: report() };
    if (operation === 'tasks') return { accountKey, source: 'local-session-cache', scope: 'current-account', observedAt: Date.now(), running: null, pendingReview: 1, total: 2, truncated: false, items: [
      {id:'smoke-completed',title:'验收任务：整理页面说明',status:'completed',unread:true,updatedAt:smokeTaskRevision,transport:'local'},
      {id:'smoke-terminated',title:'验收任务：检查数据卡',status:'terminated',unread:false,updatedAt:smokeTaskRevision-1000,transport:'cloud'}] };
    if (operation === 'task-open') { assert.equal(payload.expectedAccountKey, accountKey); assert.equal(payload.id, 'smoke-completed'); return {accountKey,id:payload.id,url:`workbuddy://chat/${encodeURIComponent(payload.id)}`}; }
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
async function verifyWorkBuddyIntegration({ pet, quota, label, codexLabel, details, tasks, guard, codexDetails, edge, edgeNotices, chat, chatWindow, consent, openChat, setProvider, setEnabled, getSettings, getCodex, menuTemplate, getCompactMenu, setTaskOpener, shortcuts, openShortcuts, setSize, outputDir, live = false }) {
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  const codexBefore = JSON.stringify(getCodex());
  const codexSettings = Object.fromEntries(Object.entries(getSettings()).filter(([k]) => k.startsWith('codex')));
  assert.equal(getSettings().workbuddyEnabled, false);
  assert.equal(quota.getState().report, null);
  const menu = menuTemplate().find(item => item.id === 'workbuddy-enabled');
  assert(menu && menu.type === 'checkbox');
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
  if (!live && getCompactMenu) {
    const compact = getCompactMenu();
    const codexIndex=compact.findIndex(item=>item.id==='codex-enabled'),wbIndex=compact.findIndex(item=>item.id==='workbuddy-enabled');
    assert.equal(wbIndex,codexIndex+1,'精简菜单Codex/WB并列');assert.equal(compact[wbIndex].type,'checkbox');
    compact[wbIndex].click({checked:false});await until(()=>getSettings().workbuddyEnabled===false,'精简菜单关闭WB');
    getCompactMenu().find(item=>item.id==='workbuddy-enabled').click({checked:true});
    await until(()=>consent.getWindow()?.isVisible(),'精简菜单启用进入明确授权');
    await until(()=>consent.getWindow().webContents.executeJavaScript("!document.getElementById('consent-accept').disabled"),'菜单启用授权就绪');
    await consent.getWindow().webContents.executeJavaScript("document.getElementById('consent-accept').click()");
    await until(()=>getSettings().workbuddyEnabled===true,'精简菜单启用成功');
  }
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
  assert.match(await page("document.getElementById('tasks').title"), /实时进行中数量暂未提供/);
  if (!live && tasks && details) {
    const opened=[];assert.equal(typeof setTaskOpener,'function');setTaskOpener(async url=>{opened.push(url);});
    await until(() => tasks.getState().report?.pendingReview === 1, '本机任务元数据同步');
    await until(() => page("document.getElementById('running-count').textContent === '—' && document.getElementById('unread-count').textContent === '1'"), '进行中未知与待查看本机计数');
    await page("document.getElementById('tasks').click()");
    await until(()=>details.getWindow()?.isVisible()&&details.getAction()==='tasks','进行中球球内panel');
    const taskWin=details.getWindow(),taskPage=code=>taskWin.webContents.executeJavaScript(code);
    await until(()=>taskPage("document.getElementById('tasks-empty')?.textContent === '暂无可确认的进行中任务'"),'不把历史running当实时');
    assert.equal(await taskPage("document.querySelectorAll('#tasks-list .activity-item').length"),0);
    await taskPage("document.getElementById('task-tab-results').click()");
    await until(()=>taskPage("document.querySelectorAll('#tasks-list .activity-item').length === 1"),'待查看仅本机未dismiss记录');
    if(outputDir)fs.writeFileSync(path.join(outputDir,'workbuddy-review-list.png'),(await capture(taskWin)).toPNG());
    await taskPage("document.querySelector('#tasks-list .activity-item').click()");
    await until(()=>opened.length===1&&tasks.getState().report.pendingReview===0,'点击深链mock成功并清球球该条提醒');
    assert.equal(opened[0],'workbuddy://chat/smoke-completed');
    await tasks.refresh();assert.equal(tasks.getState().report.pendingReview,0,'同revision刷新不复现');assert.equal(tasks.getState().report.cachedUnreadTotal,1,'WB缓存原始未读未改');
    smokeTaskRevision+=1;await tasks.refresh();
    await until(()=>taskPage("document.querySelectorAll('#tasks-list .activity-item').length === 1"),'新revision可再次提醒');
    await taskPage("document.getElementById('details-read-all').click()");
    await until(()=>tasks.getState().report.pendingReview===0,'全部已查看清球球提醒');
    assert.equal(tasks.getState().report.cachedUnreadTotal,1);
    const {createWorkBuddyTasks}=require('../lib/workbuddy-tasks');
    const reloaded=createWorkBuddyTasks({run:createSmokeWorkBuddyRunner(),getAccountKey:()=>accountKey,stateFile:path.join(require('electron').app.getPath('userData'),'workbuddy-task-state.json')});
    reloaded.setEnabled(true);await reloaded.refresh();assert.equal(reloaded.getState().report.pendingReview,0,'重建manager持久保留dismiss');assert.equal(reloaded.getState().report.cachedUnreadTotal,1);reloaded.close();
    if(outputDir)fs.writeFileSync(path.join(outputDir,'task-review-result.json'),JSON.stringify({opened,persistedDismiss:true,originalCachedUnread:1,localPendingReview:0},null,2));
    await taskPage("document.getElementById('details-close').click()");await until(()=>!details.isVisible()&&win.isVisible(),'关闭任务panel恢复卡');
    if(!(await page("document.getElementById('quota-label').dataset.expanded === 'true'")))await page("document.getElementById('toggle').click()");
    await page("document.getElementById('results').click()");await until(()=>details.getWindow()?.isVisible()&&details.getAction()==='results','待查看直接入口');
    await until(()=>taskPage("document.getElementById('tasks-empty')?.textContent === '暂无待查看任务'"),'全部查看后的空态');
    await taskPage("document.getElementById('details-close').click()");await until(()=>win.isVisible(),'任务关闭恢复');
    if(!(await page("document.getElementById('quota-label').dataset.expanded === 'true'")))await page("document.getElementById('toggle').click()");
  }
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
  if (shortcuts && openShortcuts) {
    openShortcuts();
    await until(() => shortcuts.isPresenting(), '快捷面板打开');
    await until(() => !win.isVisible() && !label.getGuardWindow()?.isVisible(), '快捷面板隐藏WB额度及游戏入口');
    shortcuts.close({ immediate: true });
    await until(() => !shortcuts.isPresenting() && win.isVisible(), '快捷面板关闭恢复WB额度');
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
    assert.match(await entryPage("document.getElementById('quota-guard-entry').getAttribute('aria-label')"),/^进入球球守护战$/);
    const entryRect=entry.getBounds(),cardRect=label.getVisibleBounds();
    const canvasRect=await entryPage("(()=>{const r=document.querySelector('#guard-entry-zombie canvas').getBoundingClientRect();return {y:r.y,height:r.height};})()");
    const centerDelta=entryRect.y+canvasRect.y+canvasRect.height/2-cardRect.y-cardRect.height/2;
    assert(Math.abs(centerDelta)<=2,'僵尸canvas与卡面垂直居中');
    assert.equal(await entryPage("getComputedStyle(document.getElementById('quota-guard-entry')).outlineStyle"),'none','首次入口无默认蓝框');

    if(outputDir)fs.writeFileSync(path.join(outputDir,'workbuddy-game-entry.png'),(await capture(entry)).toPNG());
    await entryPage("document.getElementById('quota-guard-entry').click()");
    await until(() => guard.getWindow()?.isVisible(),'从WB打开自由练习');
    const gameWin=guard.getWindow(),gamePage=code=>gameWin.webContents.executeJavaScript(code);
    await until(() => gamePage("document.getElementById('guard-period').textContent === '' && getComputedStyle(document.querySelector('.fun-stat')).display === 'none'"),'游戏不显示练习标签或模拟积分指标');
    assert.equal(await gamePage("document.getElementById('guard-number').textContent.includes('%')"),false,'不把WB积分当percent');
    await until(() => gamePage("window.quotaGuardView?.state.spritesReady && !document.getElementById('guard-qiuqiu').disabled"),'练习动画加载且可操作');
    await gamePage("document.getElementById('guard-close').focus()");
    assert.equal(await gamePage("getComputedStyle(document.getElementById('guard-close')).outlineStyle"),'none','首次打开游戏无默认蓝框');
    gameWin.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});gameWin.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await until(()=>gamePage("document.documentElement.dataset.guardKeyboard === 'true' && getComputedStyle(document.activeElement).outlineStyle !== 'none'"),'键盘Tab仍有焦点可见性');
    await gamePage("document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    const shots = await gamePage('window.quotaGuardView.state.clickShots');
    await gamePage("document.getElementById('guard-qiuqiu').click()");
    assert.equal(await gamePage('window.quotaGuardView.state.clickShots'),shots+1,'自由练习发射可交互');
    const footerSpace = await gamePage("innerHeight - document.querySelector('.fun-footer').getBoundingClientRect().bottom");
    assert(footerSpace >= 8 && footerSpace <= 32, `游戏底部边距 ${footerSpace}`);
    if(outputDir)fs.writeFileSync(path.join(outputDir,'workbuddy-practice-game.png'),(await capture(gameWin)).toPNG());
    await gamePage("document.getElementById('guard-close').click()");
    await until(() => !guard.isVisible() && win.isVisible(),'关闭游戏恢复卡片');
    await until(()=>label.getGuardWindow()?.isVisible(),'关闭后入口恢复');
    assert.equal(await entryPage("getComputedStyle(document.getElementById('quota-guard-entry')).outlineStyle"),'none','关闭游戏后入口无默认蓝框');
    if(outputDir)fs.writeFileSync(path.join(outputDir,'game-entry-centering.json'),JSON.stringify({entry:entryRect,card:cardRect,canvas:canvasRect,centerDelta},null,2));
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
    const expectedBalance = quota.getState().report.total.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    const officialEmpty = [];
    for (const period of ['today','week']) for (const view of ['records','daily']) {
      await detailPage(`document.getElementById('${period}').click();document.getElementById('view-${view}').click()`);
      const observed = await detailPage(`({balance:document.getElementById('balance').textContent,consumption:document.getElementById('change').textContent,label:document.getElementById('change-label').textContent,hint:document.getElementById('hint').textContent,note:document.getElementById('unavailable-note').textContent,selected:document.getElementById('view-${view}').getAttribute('aria-selected'),hasInventedData:Boolean(document.querySelector('#chart svg,#events,#forecast'))})`);
      assert.equal(observed.balance,expectedBalance,'余额保持真实查询值');assert.equal(observed.consumption,'—','官方消费未取得保持未知');
      assert.equal(observed.label,period==='week'?'近7天消耗':'今日消耗');assert.equal(observed.hint,'个人账户消耗暂未接入');
      assert.equal(observed.note,'当前仅同步积分余额，尚不能统计实际消耗。');assert.equal(observed.selected,'true');assert.equal(observed.hasInventedData,false,'不展示余额曲线或推算消费');
      officialEmpty.push({period,view,...observed});
      if(outputDir)fs.writeFileSync(path.join(outputDir,`workbuddy-official-unavailable-${period}-${view}.png`),(await capture(detailWin)).toPNG());
    }
    await detailPage("document.querySelector('#explanation summary').click()");
    assert.equal(await detailPage("document.getElementById('explanation').open"),true);
    assert.match(await detailPage("document.getElementById('explanation').textContent"),/延迟2–3小时/);
    assert.match(await detailPage("document.getElementById('explanation').textContent"),/不代表没有消费/);
    await detailPage("document.querySelector('#explanation summary').click()");
    const themeEvidence = {};
    for (const appearance of ['light','dark']) {
      detailWin.webContents.send('pet:color-mode','standard',appearance,'blue');
      await until(()=>detailPage(`document.documentElement.dataset.resolvedAppearance === ${JSON.stringify(appearance)}`),'消费空态真实明暗主题');
      const computed=await detailPage(`(()=>{const panel=getComputedStyle(document.getElementById('details-panel'));return {resolved:document.documentElement.dataset.resolvedAppearance,background:panel.backgroundColor,text:getComputedStyle(document.body).color,balance:document.getElementById('balance').textContent,consumption:document.getElementById('change').textContent,hint:document.getElementById('hint').textContent};})()`);
      assert.equal(computed.background,appearance==='dark'?'rgba(26, 34, 45, 0.96)':'rgba(244, 249, 255, 0.94)');
      assert.equal(computed.text,appearance==='dark'?'rgb(245, 247, 250)':'rgb(37, 43, 52)');
      assert.equal(computed.balance,expectedBalance);assert.equal(computed.consumption,'—');
      themeEvidence[appearance]=computed;
      if(outputDir)fs.writeFileSync(path.join(outputDir,`workbuddy-consumption-unavailable-${appearance}.png`),(await capture(detailWin)).toPNG());
    }
    if(outputDir){fs.writeFileSync(path.join(outputDir,'official-consumption-unavailable.json'),JSON.stringify(officialEmpty,null,2));fs.writeFileSync(path.join(outputDir,'trend-theme.json'),JSON.stringify(themeEvidence,null,2));}
    details.update(quota.getState());
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
