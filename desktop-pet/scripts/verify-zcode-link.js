const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { pointerClick } = require('./verify-chat-integration');
const { capturePaintedWindow } = require('./verify-codex-companion');

const PROMPT = '球球，跳一下，简短回复。';
const archiveSignature = state => createHash('sha256').update(JSON.stringify({
  messages: state.messages, history: state.history, activeChatId: state.activeChatId,
  hasConversation: state.hasConversation, modelSelection: state.modelSelection
})).digest('hex');
async function poll(read, accept, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (accept(value)) return value;
    await wait(100);
  } while (Date.now() < deadline);
  throw new Error(`${label}超时`);
}

async function verifyZcodeLink({ pet, chat, chatWindow, zcodeLink, openChat, BrowserWindow, getSettings, getMenu }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1', '仅可在隔离 smoke 运行');
  assert.equal(process.env.PET_SMOKE_ZCODE_LINK_ONLY, '1', '需要显式授权 ZCode 联动 smoke');
  const output = process.env.PET_SMOKE_ARTIFACT_DIR;
  assert.ok(typeof output === 'string' && path.isAbsolute(output), '需要绝对路径的验收目录');
  const { app, ipcMain } = require('electron');
  assert.equal(app.isPackaged, true, '整合验收必须运行最终打包 App');
  assert.equal(chat.getState().source, 'codex', '隔离 profile 从 Codex 来源开始');
  assert.equal(zcodeLink.isEnabled(), false, '隔离 profile 中 ZCode 初始关闭');
  fs.mkdirSync(output, { recursive: true });
  const expectZcodeDefault = getSettings().codexEnabled === false && !chat.getState().hasConversation;
  const initial = { size: getSettings().zcodeQuotaLabelSize, visible: getSettings().zcodeQuotaAlwaysVisible };
  const report = { ok: false, packaged: true, startedAt: new Date().toISOString(), phase: 'enable',
    messageAttempts: 0, actualModelMessages: null, screenshots: [], checks: [], limits: ['仅操作球球自己创建的聊天，不操作已有 ZCode 任务'] };
  let chatWin, cardWindow;
  const page = (win, code) => win.webContents.executeJavaScript(code, true);
  const capture = async (win, name) => {
    const file = path.join(output, `${name}.png`);
    await capturePaintedWindow({ win, artifactPath: file }); report.screenshots.push(file);
  };
  const menuToggle = (id, value) => {
    const item = getMenu().getMenuItemById(id);
    assert.ok(item && item.enabled !== false && typeof item.click === 'function', `${id} 设置可用`);
    assert.equal(item.type, 'checkbox', `${id} 必须使用真实复选菜单交互`);
    const before = item.checked;
    if (before !== value) item.click(item, pet, {});
    (report.menuActions ||= []).push({ id, before, target: value, dispatched: before !== value });
  };
  const diagnostic = () => {
    const snapshot = zcodeLink.getSnapshot();
    const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
    return { enabled: snapshot.enabled === true, linkEnabled: zcodeLink.isEnabled(), settingsEnabled: getSettings().zcodeEnabled === true,
      state: snapshot.state, quota: { state: snapshot.quota?.state, code: code(snapshot.quota?.code),
        windows: Array.isArray(snapshot.quota?.windows) ? snapshot.quota.windows.length : 0 },
      tasks: { state: snapshot.tasks?.state, code: code(snapshot.tasks?.code) } };
  };
  const urlBasename = value => {
    try { const url = new URL(value); return url.protocol === 'file:' ? path.basename(decodeURIComponent(url.pathname)) : `${url.protocol}page`; }
    catch (_) { return null; }
  };
  const domSource = win => page(win, "document.querySelector('#details-panel')?.dataset.source || document.querySelector('#quota-label')?.dataset.source || null");
  const windowInventory = () => Promise.all(BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).map(async win => {
    const prefs = win.webContents.getLastWebPreferences();
    return { urlBasename: urlBasename(win.webContents.getURL()), title: win.getTitle().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100),
      visible: win.isVisible(), additionalArgs: Array.isArray(prefs.additionalArguments) ? prefs.additionalArguments.filter(value => /^--pet-source=(?:codex|zcode)$/.test(value)) : null,
      domSource: await Promise.race([domSource(win).catch(() => null), wait(500).then(() => null)]) };
  }));
  const observeQuotaDetail = (event, action, bucketId) => {
    (report.quotaDetailIpc ||= []).push({ action: ['quota', 'trend', 'tasks', 'results'].includes(action) ? action : 'invalid',
      periodValid: typeof bucketId === 'string' && /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(bucketId),
      frameOwner: event.sender === cardWindow?.webContents && event.senderFrame === event.sender.mainFrame,
      senderUrlBasename: urlBasename(event.sender.getURL()) });
  };
  ipcMain.on('pet:zcode-quota-label-detail', observeQuotaDetail);
  const findDetails = async () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.isVisible() && urlBasename(win.webContents.getURL()) === 'codex-details.html'
        && await domSource(win).catch(() => null) === 'zcode') return win;
    }
    return null;
  };
  const selectSource = async id => {
    await poll(() => chat.getState(), state => !state.busy && !state.sourceChanging && state.connection !== 'connecting', '来源可切换');
    await pointerClick(chatWin, '#chat-source');
    await poll(() => page(chatWin, "!document.querySelector('#source-menu').hidden"), Boolean, '来源菜单展开');
    await pointerClick(chatWin, `#source-menu [data-source="${id}"]`);
    await poll(() => chat.getState(), state => state.source === id && !state.sourceChanging && state.connection !== 'connecting', `切换 ${id}`, 45000);
    assert.equal(await page(chatWin, "document.querySelector('#chat-source').textContent"), id === 'zcode' ? 'ZCode' : 'Codex');
  };
  try {
    menuToggle('zcode-enabled', true);
    const snapshot = await poll(() => zcodeLink.getSnapshot(), state => state.enabled && state.quota?.state === 'connected'
      && state.quota.windows?.length > 0, '真实 ZCode 额度', 45000);
    report.quota = snapshot.quota.windows.map(({ label, planName, remaining, total, remainingUnits, unit, periodKind, resetsAt }) =>
      ({ label, planName, remaining, total, remainingUnits, unit, periodKind, resetsAt }));
    zcodeLink.setPreference('zcodeQuotaLabelSize', 'standard');
    zcodeLink.setPreference('zcodeQuotaAlwaysVisible', true);
    const card = await poll(() => zcodeLink.getWindow(), win => win && !win.isDestroyed() && win.isVisible(), '真实额度卡');
    cardWindow = card;
    await poll(() => page(card, "({...document.querySelector('#quota-label').dataset})"), value => value.source === 'zcode' && value.hasItems === 'true', '额度卡 renderer');
    await capture(card, 'integrated-01-quota');
    menuToggle('zcode-quota-visible', false);
    await poll(() => card.isVisible(), value => value === false, '隐藏额度卡');
    assert.equal(zcodeLink.isEnabled(), true, '隐藏卡片保留连接');
    menuToggle('zcode-quota-visible', true);
    await poll(() => card.isVisible(), Boolean, '恢复额度卡');
    await pointerClick(card, '#quota-label');
    await poll(() => page(card, "document.querySelector('#quota-label').dataset.expanded"), value => value === 'true', '展开额度卡');
    const expanded = await page(card, `(() => { const footer=document.querySelector('.v20-links').getBoundingClientRect();return { source:document.querySelector('#quota-label').dataset.source, count:document.querySelectorAll('.v20-period').length, footerBottom:footer.bottom, height:innerHeight }; })()`);
    assert.equal(expanded.count, Math.min(snapshot.quota.windows.length, 32));
    assert.ok(expanded.footerBottom <= expanded.height, '展开卡底部操作完整可见');
    await capture(card, 'integrated-02-expanded');
    await pointerClick(card, '[data-action="quota"]');
    const details = await poll(findDetails, Boolean, 'ZCode 额度明细窗口');
    await poll(() => page(details, "document.querySelector('#details-panel').dataset.action"), value => value === 'quota', '明细 renderer');
    assert.equal(await page(details, "document.querySelectorAll('.zcode-quota-bucket').length"), Math.min(snapshot.quota.windows.length, 32));
    await capture(details, 'integrated-03-details');
    await pointerClick(details, '.zcode-quota-bucket .reset-link');
    await poll(() => page(details, "document.querySelector('#details-panel').dataset.action"), value => value === 'trend', '真实趋势入口');
    assert.equal(await page(details, "document.querySelector('.title-product').textContent"), 'ZCODE');
    const selector = await page(details, "({ trigger:document.querySelector('.zcode-bucket-trigger')?.textContent, description:document.querySelector('.zcode-bucket-description')?.textContent, options:[...document.querySelectorAll('.zcode-bucket-option')].map(node=>({label:node.textContent,selected:node.getAttribute('aria-checked')==='true'})), headerTabs:document.querySelectorAll('.panel-header .trend-tabs').length })");
    assert.equal(selector.headerTabs, 0, 'ZCode 来源选择不能挤占标题与关闭按钮');
    assert.equal(selector.options.length, Math.min(snapshot.quota.windows.length, 32));
    assert.equal(selector.options.filter(option => option.selected).length, 1);
    assert.ok(selector.trigger && selector.description);
    report.trend = { selector, note: '真实账户当前周期采样；不足记录时不伪造历史' };
    await capture(details, 'integrated-04-trend');
    await pointerClick(details, '#details-close');
    report.checks.push('真实菜单启用', '隐藏卡片保留连接', '真实卡片展开', '真实明细与趋势 IPC');

    report.phase = 'chat-connect';
    openChat();
    chatWin = await poll(() => chatWindow.getWindow(), win => win && !win.isDestroyed() && win.isVisible(), '聊天窗口');
    await poll(() => chat.getState(), state => !state.busy && !state.sourceChanging && state.connection !== 'connecting', 'Codex 初始连接', 45000);
    report.initialChatSource = chat.getState().source;
    if (expectZcodeDefault) assert.equal(report.initialChatSource, 'zcode', '只启用 ZCode 且没有已有会话时，应自动使用 ZCode');
    if (chat.getState().source === 'zcode') {
      report.checks.push('仅启用 ZCode 时聊天自动选中 ZCode');
      await selectSource('codex');
    }
    const codexBefore = archiveSignature(chat.getState());
    await selectSource('zcode');
    const connected = chat.getState();
    assert.equal(connected.connection, 'ready', 'ZCode 真实连接完成');
    assert.equal(connected.modelsStatus, 'ready'); assert.ok(connected.models.length > 0, 'ZCode 真实模型列表');
    assert.equal(connected.messages.length, 0, '本轮仅在空的球球自有 ZCode 会话发送');
    report.models = connected.models.map(({ id, displayName }) => ({ id, displayName }));
    await capture(chatWin, 'integrated-05-zcode-chat-ready');
    await page(pet, `(() => { const target=document.querySelector('#pet');if(!target)throw new Error('pet missing');window.__zcodeLinkSmokeActions=[];window.__zcodeLinkSmokeObserver=new MutationObserver(()=>{if(target.dataset.lastAction==='hop')window.__zcodeLinkSmokeActions.push({action:'hop',owner:target.dataset.motionOwner});});window.__zcodeLinkSmokeObserver.observe(target,{attributes:true,attributeFilter:['data-last-action']}); })()`);
    report.phase = 'one-real-message';
    await page(chatWin, `document.querySelector('#message-input').value=${JSON.stringify(PROMPT)};document.querySelector('#message-input').dispatchEvent(new Event('input'))`);
    assert.equal(await page(chatWin, "document.querySelector('#send-message').disabled"), false);
    report.messageAttempts = 1;
    await pointerClick(chatWin, '#send-message');
    const completed = await poll(() => chat.getState(), state => state.source === 'zcode' && !state.busy
      && state.messages.some(message => message.role === 'assistant'), '一条真实模型回复', 190000);
    assert.equal(completed.messages.filter(message => message.role === 'user').length, 1, '不自动重发');
    assert.equal(completed.messages.find(message => message.role === 'user').text, PROMPT);
    const replies = completed.messages.filter(message => message.role === 'assistant');
    assert.equal(replies.length, 1); assert.equal(replies[0].status, 'complete', '真实回复完整完成'); assert.ok(replies[0].text?.trim());
    await poll(() => page(pet, 'window.__zcodeLinkSmokeActions || []'), rows => rows.some(row => row.action === 'hop' && row.owner === 'user'), '真实球球跳跃动作');
    report.actualModelMessages = 1;
    report.reply = { text: replies[0].text, status: replies[0].status, model: completed.activeModel?.displayName || null, action: 'hop', actionObservedInPetRenderer: true };
    const zcodeAfter = archiveSignature(completed);
    await capture(chatWin, 'integrated-06-real-reply');
    await capture(pet, 'integrated-07-pet-action');
    report.checks.push('真实来源菜单切换', '真实模型列表', '仅一条真实请求', '流式回复完整结束', 'pet renderer 真实 hop 动作');

    report.phase = 'source-isolation';
    await selectSource('codex');
    assert.equal(archiveSignature(chat.getState()), codexBefore, 'Codex 原会话、历史和模型选择不变');
    await capture(chatWin, 'integrated-08-codex-unchanged');
    await selectSource('zcode');
    assert.equal(archiveSignature(chat.getState()), zcodeAfter, 'ZCode 会话单独恢复');
    await selectSource('codex');
    zcodeLink.setPreference('zcodeQuotaLabelSize', initial.size);
    zcodeLink.setPreference('zcodeQuotaAlwaysVisible', initial.visible);
    menuToggle('zcode-enabled', false);
    await poll(() => chat.getState(), state => !state.sourceChanging && state.source === 'codex'
      && state.sources.find(item => item.id === 'zcode')?.enabled === false, '关闭 ZCode 保留 Codex');
    assert.equal(getSettings().zcodeEnabled, false);
    assert.equal(zcodeLink.getWindow(), null, '关闭联动销毁自己的卡片');
    assert.equal(archiveSignature(chat.getState()), codexBefore);
    await poll(() => page(chatWin, "document.querySelector('#source-bar').hidden"), Boolean, '单来源恢复原 UI');
    report.checks.push('Codex 归档签名不变', 'ZCode 历史独立恢复', '关闭 ZCode 回到 Codex');
    report.archive = { codexUnchanged: true, zcodeRestored: true };
    report.ok = true; report.phase = 'complete';
  } catch (error) {
    report.failure = { phase: report.phase, message: error.message, snapshot: diagnostic(), windows: await windowInventory() }; throw error;
  } finally {
    ipcMain.removeListener('pet:zcode-quota-label-detail', observeQuotaDetail);
    try { await page(pet, 'window.__zcodeLinkSmokeObserver?.disconnect();delete window.__zcodeLinkSmokeObserver;delete window.__zcodeLinkSmokeActions'); } catch (_) {}
    if (zcodeLink.isEnabled()) {
      try { if (chat.getState().source === 'zcode' && chat.getState().busy) await chat.stop(); } catch (_) {}
      try { zcodeLink.setPreference('zcodeQuotaLabelSize', initial.size); zcodeLink.setPreference('zcodeQuotaAlwaysVisible', initial.visible); await zcodeLink.setEnabled(false); } catch (_) {}
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'zcode-link-integrated-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`PET_ZCODE_LINK_INTEGRATION_OK ${JSON.stringify({ actualModelMessages: report.actualModelMessages, report: path.join(output, 'zcode-link-integrated-report.json') })}\n`);
  return report;
}
module.exports = { verifyZcodeLink };
