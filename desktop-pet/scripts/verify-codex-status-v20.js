const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { buildQuotaLabelModel, buildCodexDetailsModel } = require('../lib/codex-quota-view');
const { createQuotaHistory } = require('../lib/codex-quota-history');
const { capturePaintedWindow, assertQuotaLabelWindow } = require('./verify-codex-companion');

const ACCOUNT = 'synthetic-codex-status-v20';
const taskId = number => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;
const HOUR = 3600000;

function syntheticSnapshot(now, periods = [300, 10080]) {
  const windows = periods.map(minutes => ({ id: `codex:v20-${minutes}`, label: 'Codex',
    windowMinutes: minutes, remaining: minutes === 300 ? 44 : 62,
    resetsAt: now + (minutes === 300 ? 3 : 107) * HOUR }));
  const resetHistory = [
    { id: 'synthetic-expired', status: 'available', grantedAt: now - 7 * 24 * HOUR,
      expiresAt: now - 48 * HOUR, resetType: 'codexRateLimits' },
    { id: 'synthetic-used', status: 'redeemed', grantedAt: now - 7 * 24 * HOUR,
      expiresAt: null, resetType: 'codexRateLimits' }
  ];
  const historyWindows = windows.map(window => {
    const span = (window.windowMinutes === 300 ? 2 : 48) * HOUR;
    const step = (window.windowMinutes === 300 ? 2 : 3) * 60000;
    const consumed = window.windowMinutes === 300 ? 56 : 28;
    return { ...window, samples: Array.from({ length: span / step + 1 }, (_, index) => ({
      at: now - span + index * step,
      remaining: window.remaining + consumed * (1 - index * step / span)
    })) };
  });
  return { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows,
    resetCreditsAvailable: 2, resetOpportunities: [
      { id: 'synthetic-soon', status: 'available', grantedAt: now - HOUR,
        expiresAt: now + 9 * HOUR, resetType: 'codexRateLimits' },
      { id: 'synthetic-later', status: 'available', grantedAt: now - HOUR,
        expiresAt: now + 48 * HOUR, resetType: 'codexRateLimits' }
    ], accountResetHistory: { state: 'ready', updatedAt: now, events: [
      { id: 'synthetic-account-granted', kind: 'granted', occurredAt: now - 72 * HOUR },
      { id: 'synthetic-account-redeemed', kind: 'redeemed', occurredAt: now - 49 * HOUR }
    ] }, credits: { hasCredits: true, unlimited: false, balance: '2480' } },
    tasks: { state: 'connected', items: [1, 2, 3].map((number, index) => ({ id: taskId(number),
      title: `合成验收任务 ${number}`, state: index === 2 ? 'waiting' : 'active',
      turnId: `synthetic-turn-${number}`, updatedAt: now })) },
    history: { available: true, windows: historyWindows, resetHistory, results: [] } };
}

function assertCardLayout(view, count) {
  assert.equal(view.width, 196, '展开卡片保持 196px');
  assert.equal(view.height, count === 2 ? 144 : 131, '展开高度符合认可设计');
  assert.equal(view.periodCount, count, '只显示真实周期');
  assert.equal(view.caption, '本周期剩余', '周期比例与余额名称分开');
  assert.equal(view.overflow, false, '卡片无横向溢出');
  assert.equal(view.fits, true, '可见内容不得被原生窗口裁切');
  assert.equal(view.unreadBorder, '0px', '待查看数字保持淡色底，无粗框');
  assert.ok(view.values.every(value => /^\d+%$/.test(value)), '真实百分比可见');
  assertContentEdges(view, '主卡');
}

function assertContentEdges(view, label) {
  const { panel, viewport, contentBounds } = view;
  assert.ok(panel && viewport && contentBounds, `${label}: 原生与 DOM 几何证据完整`);
  for (const [edge, actual, expected] of [
    ['left', panel.left, 0], ['top', panel.top, 0],
    ['right', panel.right, viewport.width], ['bottom', panel.bottom, viewport.height],
    ['native width', contentBounds.width, viewport.width], ['native height', contentBounds.height, viewport.height]
  ]) assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1,
    `${label}: ${edge} 应填满窗口，actual=${actual} expected=${expected}`);
}

function assertAnchoredDetails(bounds, anchor, area, label = '详情打开定位') {
  assert.ok(bounds.x >= area.x && bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height,
  `${label}: 原生详情完整位于当前显示器`);
  const gap = 8;
  const centeredX = Math.round(Math.max(area.x, Math.min(anchor.x + (anchor.width - bounds.width) / 2,
    area.x + area.width - bounds.width)));
  const centeredY = Math.round(Math.max(area.y, Math.min(anchor.y + (anchor.height - bounds.height) / 2,
    area.y + area.height - bounds.height)));
  const distances = {
    below: bounds.y - (anchor.y + anchor.height), above: anchor.y - (bounds.y + bounds.height),
    right: bounds.x - (anchor.x + anchor.width), left: anchor.x - (bounds.x + bounds.width)
  };
  const besidePet = Object.entries(distances).some(([side, distance]) => distance >= gap &&
    (side === 'below' || side === 'above' ? bounds.x === centeredX : bounds.y === centeredY));
  assert.ok(besidePet, `${label}: 应在当前球球有空间的一侧，不能覆盖球球且至少留 ${gap}px 间距`);
  const overlaps = bounds.x < anchor.x + anchor.width && bounds.x + bounds.width > anchor.x &&
    bounds.y < anchor.y + anchor.height && bounds.y + bounds.height > anchor.y;
  assert.equal(overlaps, false, `${label}: 详情与球球实际原生 bounds 无相交`);
}

function assertDetailsSurface(view, label = '详情') {
  assertContentEdges(view,label);
  assert.equal(view.overflow, false, `${label}: 无横向滚动`);
  assert.equal(view.contentFits, true, `${label}: 可见文字和按钮未裁切`);
  assert.equal(view.surface.opacity, 1, `${label}: 面板及祖先不降低不透明度`);
  assert.equal(view.nativeHasShadow, false, `${label}: 不叠加原生窗口黑色阴影边缘`);
  const stops = String(view.surface.image).match(/rgba?\([^)]*\)/g)?.map(rgb) || [];
  const filled = rgb(view.surface.color)[3] >= .94 || (stops.length > 0
    && stops.every(stop => stop[3] >= .94) && !/\btransparent\b/.test(view.surface.image));
  assert.equal(filled, true, `${label}: 玻璃背景有完整高覆盖底层`);
}

function assertFilledPixels(samples, label = '详情') {
  assert.ok(samples.length >= 8, `${label}: 四侧与内圆角均有像素采样`);
  for (const sample of samples) assert.ok(sample.alpha >= 240,
    `${label}: ${sample.name} 留下透明带，alpha=${sample.alpha}`);
}

function isRenderedDetailNode(node, styleOf = getComputedStyle) {
  if (!node || node.getClientRects().length === 0) return false;
  for (let ancestor=node;ancestor;ancestor=ancestor.parentElement) {
    if (ancestor.hidden || styleOf(ancestor).display === 'none') return false;
    if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
      const summary=Array.from(ancestor.children).find(child=>child.tagName === 'SUMMARY');
      if (!summary || (node !== summary && !summary.contains(node))) return false;
    }
  }
  return true;
}

function detailFixtures(now) {
  const base = syntheticSnapshot(now);
  const result = { id: taskId(4), turnId: 'synthetic-result-4',
    title: '合成验收结果 <b>纯文本</b>', state: 'completed', updatedAt: now, readAt: null };
  return [
    { name: 'tasks-data', action: 'tasks', snapshot: base, entries: 3 },
    { name: 'tasks-empty', action: 'tasks', snapshot: { ...base, tasks: { ...base.tasks, items: [] } }, entries: 0 },
    { name: 'results-data', action: 'results', snapshot: { ...base, history: { ...base.history, results: [result] } }, entries: 1 },
    { name: 'results-empty', action: 'results', snapshot: base, entries: 0 },
    { name: 'trend-both', action: 'trend', snapshot: base, periods: 2 },
    { name: 'trend-five', action: 'trend', snapshot: syntheticSnapshot(now, [300]), periods: 1 },
    { name: 'trend-week', action: 'trend', snapshot: syntheticSnapshot(now, [10080]), periods: 1 },
    { name: 'reset-available', action: 'opportunities', snapshot: base, entries: 2 },
    { name: 'reset-no-history', action: 'opportunities', snapshot: { ...base,
      quota: { ...base.quota, accountResetHistory: { ...base.quota.accountResetHistory, events: [] } },
      history: { ...base.history, resetHistory: [] } }, entries: 2 },
    ...[['credits-decimal', '62485.1547310000', '62,485.15'],
      ['credits-long', '12345678901234567890.125', '12,345,678,901,234,567,890.13']].map(([name, balance, expectedBalance]) => ({
      name, action: 'credits', expectedBalance,
      snapshot: { ...base, quota: { ...base.quota, credits: { hasCredits: true, unlimited: false, balance } } }
    }))
  ];
}

function contrast(first, second) {
  const luminance = rgb => rgb.slice(0, 3).map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
const rgb = text => {
  const hex = String(text).match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(value=>value+value).join('') : hex;
    return [...full.match(/../g).map(value=>parseInt(value,16)),1];
  }
  const values = String(text).match(/[\d.]+/g)?.map(Number);
  return values && values.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : [0, 0, 0, 0];
};
const blend = (foreground, background) => foreground.slice(0, 3)
  .map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
function sampleContrast(sample) {
  let colors = [[255, 255, 255]];
  for (const layer of [...sample.backgrounds].reverse()) {
    const solid = rgb(layer.color);
    if (solid[3] > 0) colors = colors.map(background => blend(solid, background));
    const stops = String(layer.image).match(/rgba?\([^)]*\)/g)?.map(rgb) || [];
    if (stops.length) colors = stops.flatMap(stop => colors.map(background => blend(stop, background)));
  }
  const foreground = rgb(sample.color);
  foreground[3] *= sample.opacity ?? 1;
  return Math.min(...colors.map(background => contrast(blend(foreground, background), background)));
}

async function poll(read, test, label) {
  const deadline = Date.now() + 5000;
  let value;
  do { value = await read(); if (test(value)) return value; await wait(25); } while (Date.now() < deadline);
  assert.fail(`${label} 超时：${JSON.stringify(value)}`);
}
const paint = win => win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

async function cardView(win) {
  const view = await win.webContents.executeJavaScript(`(() => {
    const card = document.getElementById('quota-label'), root = document.getElementById('codex-expanded');
    const visible = e => e && e.getClientRects().length > 0;
    const elements = [...root.querySelectorAll('strong,button,.v20-reset,.v20-caption,.period-pill,.v20-pace')].filter(visible);
    const rect = card.getBoundingClientRect();
    const count = root.querySelector('.v20-unread .v20-count');
    const reset=root.querySelector('.v20-reset-count'),clock=root.querySelector('.v20-reset-clock');
    return { state:card.dataset.state, expanded:card.dataset.expanded, periodCount:root.querySelectorAll('.v20-period').length,
      caption:root.querySelector('.v20-caption')?.textContent, values:[...root.querySelectorAll('.v20-value')].map(e=>e.textContent),
      pace:[...root.querySelectorAll('.v20-pace')].map(e=>({text:e.textContent,color:getComputedStyle(e).color,symbol:getComputedStyle(e,'::before').content})),
      counts:[...root.querySelectorAll('.v20-activity .v20-count')].map(e=>e.textContent),
      credit:root.querySelector('.v20-credit')?.textContent, unreadBorder:count?getComputedStyle(count).borderTopWidth:null,
      resetCount:reset?{text:reset.textContent,color:getComputedStyle(reset).color,rect:reset.getBoundingClientRect().toJSON()}:null,
      resetClock:clock?{fill:getComputedStyle(clock).fill,rect:clock.getBoundingClientRect().toJSON()}:null,
      actionBlue:getComputedStyle(card).getPropertyValue('--quota-action-blue').trim(),
      collapseLabel:root.querySelector('.v20-collapse')?.getAttribute('aria-label')||'',
      collapseIcon:root.querySelector('.v20-collapse svg')?.getBoundingClientRect().toJSON(),
      captionRect:root.querySelector('.v20-caption')?.getBoundingClientRect().toJSON(),
      borderColor:getComputedStyle(card).borderTopColor,bevel:getComputedStyle(card).boxShadow,
      radius:parseFloat(getComputedStyle(card).borderTopLeftRadius),beamRadius:parseFloat(getComputedStyle(card.parentElement).borderTopLeftRadius),
      face:rect.toJSON(),panel:card.parentElement.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},
      overflow:document.documentElement.scrollWidth>innerWidth,
      fits:elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=rect.left-1&&r.right<=rect.right+1&&r.top>=rect.top-1&&r.bottom<=rect.bottom+1;}),
      colorMode:document.documentElement.dataset.colorMode||'standard', appearance:document.documentElement.dataset.appearance,
      buttons:root.querySelectorAll('button').length };
  })()`);
  return { ...view, width: win.getBounds().width, height: win.getBounds().height,contentBounds:win.getContentBounds() };
}

async function detailsView(win) {
  const view = await win.webContents.executeJavaScript(`(() => {
    try {
    const root=document.getElementById('details-panel');
    const tabs=[...document.querySelectorAll('.trend-tabs button')];
    const visible=${isRenderedDetailNode.toString()};
    const leaf=[...root.querySelectorAll('*')].filter(e=>!e.children.length&&e.textContent.trim()&&visible(e));
    const surfaceStyle=getComputedStyle(root); let opacity=1,ancestor=root;
    while(ancestor){opacity*=Number(getComputedStyle(ancestor).opacity);ancestor=ancestor.parentElement;}
    const textRects=leaf.map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,html:e.namespaceURI==='http://www.w3.org/1999/xhtml',className:e.className,text:e.textContent,rect:r.toJSON(),client:e.clientWidth,scroll:e.scrollWidth};});
    const clippedText=textRects.filter(e=>!(e.rect.left>=-1&&e.rect.right<=innerWidth+1&&e.rect.top>=-1&&e.rect.bottom<=innerHeight+1&&(!e.html||e.scroll<=e.client+1)));
    const stats=[...document.querySelectorAll('.trend-stats p')].map(e=>{
      const label=e.querySelector('span'),number=e.querySelector('strong');
      return {label:label?.textContent,number:number?.textContent,labelRect:label?.getBoundingClientRect().toJSON(),numberRect:number?.getBoundingClientRect().toJSON()};
    });
    return { title:document.getElementById('details-title').textContent,
      action:root.dataset.action, brand:document.querySelector('.panel-header')?.textContent.includes('CODEX')?'CODEX':'',
      tabs:tabs.map(e=>({text:e.textContent,pressed:e.getAttribute('aria-pressed'),decoration:getComputedStyle(e).textDecorationLine})),
      overflow:document.documentElement.scrollWidth>innerWidth,
      panel:root.getBoundingClientRect().toJSON(), viewport:{width:innerWidth,height:innerHeight},
      surface:{color:surfaceStyle.backgroundColor,image:surfaceStyle.backgroundImage,opacity,radius:parseFloat(surfaceStyle.borderTopLeftRadius)||0},
      contentFits:clippedText.length===0,clippedText,
      dragRegion:getComputedStyle(root).getPropertyValue('-webkit-app-region'),
      interactiveRegions:[...root.querySelectorAll('button,a,summary,input,textarea,select,[role="button"]')].filter(e=>visible(e)).map(e=>({tag:e.tagName,region:getComputedStyle(e).getPropertyValue('-webkit-app-region')})),
      stats, pace:document.querySelector('.trend-pace')?{text:document.querySelector('.trend-pace').textContent,color:getComputedStyle(document.querySelector('.trend-pace')).color}:null,
      blue:getComputedStyle(root).getPropertyValue('--detail-blue').trim(),
      positiveCounts:[...document.querySelectorAll('.reset-link .positive-count')].map(e=>({text:e.textContent,color:getComputedStyle(e).color})),
      activityEntries:document.querySelectorAll('.activity-item').length,
      balance:document.querySelector('.balance-summary strong')?.textContent||'',
      backVisible:!document.getElementById('details-back').hidden,
      resetSummary:document.querySelector('.reset-summary')?.textContent||'',
      history:document.querySelector('.opportunity-history')?{open:document.querySelector('.opportunity-history').open,text:document.querySelector('.opportunity-history').textContent}:null,
      localHistory:document.querySelector('.local-opportunity-history')?{open:document.querySelector('.local-opportunity-history').open,text:document.querySelector('.local-opportunity-history').textContent}:null,
      rows:document.querySelectorAll('#details-content > .opportunity-list li:not(.table-head)').length,
      tableHead:document.querySelectorAll('#details-content > .opportunity-list .table-head').length,
      empty:document.querySelector('.empty-state')?.textContent||'',
      forecast:document.querySelector('.forecast-copy')?.textContent||'',
      points:document.querySelectorAll('.trend-chart .point').length,
      active:document.activeElement?.id||document.activeElement?.className||'',
      htmlImages:root.querySelectorAll('img,iframe,script').length,
      visibleText:root.textContent };
    } catch (error) { return { rendererError: error.stack }; }
  })()`);
  if (view.rendererError) throw new Error(view.rendererError);
  return { ...view, contentBounds: win.getContentBounds(), nativeHasShadow: win.hasShadow() };
}

async function clickRegion(win, selector) {
  const region = await win.webContents.executeJavaScript(`(() => {
    const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
    const r=node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};
  })()`);
  assert.ok(region?.width > 0 && region.height > 0, `真实点击区域可见：${selector}`);
  const point = { x: Math.round(region.x), y: Math.round(region.y), button: 'left', clickCount: 1 };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  const decorations=await win.webContents.executeJavaScript(`(() => {
    const target=document.querySelector(${JSON.stringify(selector)});
    const button=target?.closest('.v20-shared button');
    return button?[button,...button.querySelectorAll('span,b')].map(e=>getComputedStyle(e).textDecorationLine):[];
  })()`);
  assert.ok(decorations.every(value=>!value.includes('underline')),'文字和数字悬停不加下划线');
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point });
}

function pixelSamples(image, view) {
  const bitmap = image.toBitmap(), { width, height } = image.getSize();
  assert.equal(bitmap.length, width * height * 4, 'macOS NativeImage BGRA 像素尺寸匹配');
  const w=view.viewport.width,h=view.viewport.height;
  const corner=Math.max(3, Math.ceil(view.surface.radius * (1 - 1 / Math.sqrt(2)) + 2));
  const positions=[['left',1,h/2],['right',w-2,h/2],['top',w/2,1],['bottom',w/2,h-2],
    ['inner-top-left',corner,corner],['inner-top-right',w-corner-1,corner],
    ['inner-bottom-left',corner,h-corner-1],['inner-bottom-right',w-corner-1,h-corner-1]];
  return positions.map(([name,x,y])=>({name,alpha:bitmap[(Math.floor(y*height/h)*width+Math.floor(x*width/w))*4+3]}));
}


function namePeriods(name) { return name==='fiveHour'?[300]:name==='weekly'?[10080]:[300,10080]; }
function outlinePixels(image,view,appearance,colorMode) {
  const data=image.toBitmap(),{width,height}=image.getSize(),w=view.viewport.width,h=view.viewport.height,r=view.radius;
  const offset=r*(1-1/Math.sqrt(2))+.5;
  const positions=[['top',w/2,.5],['bottom',w/2,h-.5],['left',.5,h/2],['right',w-.5,h/2],
    ['top-left',offset,offset],['top-right',w-offset,offset],['bottom-left',offset,h-offset],['bottom-right',w-offset,h-offset]];
  return positions.map(([name,x,y])=>{const i=(Math.floor(y*height/h)*width+Math.floor(x*width/w))*4,a=data[i+3]/255;
    // nativeImage bitmap channels already contain premultiplied alpha.
    const white=[data[i+2],data[i+1],data[i]].map(v=>Math.min(255,Math.round(v+255*(1-a))));
    const inwardX=x<w/2?1:x>w/2?-1:0,inwardY=y<h/2?1:y>h/2?-1:0;
    const j=(Math.floor((y+inwardY*3)*height/h)*width+Math.floor((x+inwardX*3)*width/w))*4;
    assert.ok(data[j+3]>=200,'圆角内侧背景完整 '+name);
    if(appearance==='light'&&colorMode==='standard')assert.ok(Math.max(...white)>=190,'白色玻璃边缘无黑线 '+name+': '+white);
    return{name,alpha:data[i+3],onWhite:white};});
}

async function verifyCodexStatusV20({ pet, quotaLabel, details, BrowserWindow, screen, prepare,
  getController, setEnabled, setQuotaPreference, getSettings, openDetails, setColorMode, getSnapshot }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1', '仅显式隔离 smoke');
  assert.equal(process.env.PET_SMOKE_CODEX_STATUS_ONLY, '1', '必须使用 v20 专项入口');
  const { app, nativeImage } = require('electron');
  assert.equal(app.isPackaged, true, 'R2 原生验收必须运行最终打包候选');
  assert.ok(process.env.PET_SMOKE_APP_PATH, 'R2 通过 PET_SMOKE_APP_PATH 明确候选路径');
  assert.equal(fs.realpathSync(app.getPath('userData')), fs.realpathSync(app.commandLine.getSwitchValue('user-data-dir')));
  assert.match(path.basename(app.getPath('userData')), /^emotion-ball-smoke-/, '不得使用正式用户目录');
  const artifacts = path.resolve(process.env.PET_SMOKE_ARTIFACT_DIR || path.join(__dirname, '../build/codex-status-v20'));
  fs.mkdirSync(artifacts, { recursive: true });
  const report = { passed: false, revision:'R10', candidate:process.env.PET_SMOKE_APP_PATH,
    scope: 'Packaged candidate; synthetic v20 only; isolated profile; no live account or model/API calls',
    cards: [], compact: [], details: [], clicks: [], surfaces: [], windowRestoration: [], positions: [] };
  const now = Date.now(), original = getSettings(), originalPetBounds = pet.getBounds();
  const seed = syntheticSnapshot(now);
  const historyFile = path.join(app.getPath('userData'), 'synthetic-v20-history.json');
  fs.writeFileSync(historyFile, JSON.stringify({ version: 1, accounts: {
    [createHash('sha256').update(ACCOUNT).digest('hex')]: { updatedAt: now,
      windows: seed.history.windows, resetHistory: seed.history.resetHistory, results: [] }
  } }), { mode: 0o600 });
  const history = createQuotaHistory({ filePath: historyFile, now: () => now });
  let callbacks, apiWindow;
  const openedThreads = [];
  const emit = (periods, extra = {}) => {
    const snapshot = syntheticSnapshot(now, periods);
    callbacks.onQuota({ ...snapshot.quota, ...extra });
  };
  const capture = (win, name, controller) => capturePaintedWindow({ win, controller,
    artifactPath: path.join(artifacts, `${name}.png`) });
  const open = async (action, period = 300) => {
    openDetails(action, period);
    const win = await poll(() => details.getWindow(), value => value?.isVisible(), `${action} 原生详情`);
    await paint(win); return win;
  };
  const filled = (view) => { try { assertDetailsSurface(view); return true; } catch (_) { return false; } };
  try {
    prepare({ now: () => now, history, schedule: () => 0, cancel() {}, random: () => 0,
      openThread: async url => { openedThreads.push(url); },
      createConnection(value) {
        callbacks = value;
        return { async start() {
          value.onAccount({ accountKey: ACCOUNT });
          value.onStatus({ channel: 'quota', state: 'connected' });
          value.onStatus({ channel: 'tasks', state: 'connected' });
          value.onQuota(seed.quota);
          seed.tasks.items.forEach(task => value.onTask({ ...task, baseline: true }));
          const task = { id: taskId(4), title: '合成验收结果 <b>纯文本</b>', turnId: 'synthetic-result-4', updatedAt: now };
          value.onTask({ ...task, state: 'active', baseline: true });
          value.onTask({ ...task, state: 'completed' });
        }, async refresh() {}, async retry() {}, close() {} };
      } });
    await setEnabled(true);
    setQuotaPreference('codexQuotaAlwaysVisible', true);
    setQuotaPreference('codexQuotaLabelSize', 'compact');
    setQuotaPreference('codexShowExtraCredits', true);
    const label = await poll(() => quotaLabel.getWindow(), win => win?.isVisible(), '额度卡首次显示');
    await paint(label);
    assertContentEdges(await cardView(label),'收起主卡');
    await label.webContents.executeJavaScript('window.petQuotaLabel.toggleExpanded()');
    await poll(() => cardView(label), view => view.expanded === 'true', '展开原生卡片');
    for (const colorMode of ['standard', 'accessible']) for (const appearance of ['light', 'dark']) {
      details.close();
      setColorMode(colorMode); setQuotaPreference('codexQuotaAppearance', appearance);
      for (const [name, periods] of [['five', [300]], ['week', [10080]], ['both', [300, 10080]]]) {
        setQuotaPreference('codexQuotaPeriod', name === 'five' ? 'fiveHour' : name === 'week' ? 'weekly' : 'auto');
        emit(periods); await paint(label);
        if ((await cardView(label)).expanded !== 'true') {
          await label.webContents.executeJavaScript('window.petQuotaLabel.toggleExpanded()');
        }
        const view = await poll(() => cardView(label), value => value.expanded === 'true' && value.width === 196,
          '周期设置完成后展开');
        assertCardLayout(view, periods.length);
        assert.equal(view.radius,view.beamRadius,'背景与外圈采用同一圆角，不被裁切');
        assertQuotaLabelWindow(quotaLabel, label, pet.getBounds(), { expanded: true, itemCount: periods.length,
          workArea: screen.getDisplayMatching(pet.getBounds()).workArea });
        assert.deepEqual(view.values, periods.map(minutes => minutes === 300 ? '44%' : '62%'));
        assert.deepEqual(view.counts, ['3', '1'], '真实任务和本地待查看计数');
        assert.match(view.credit, /剩余额度\s*2,480/, '余额来自真实白名单');
        assert.match(view.collapseLabel,/收起/,'提供明确收起按钮');
        assert.ok(view.collapseIcon,'收起使用SVG避免字体上标偏移');
        assert.ok(Math.abs((view.collapseIcon.top+view.collapseIcon.bottom-view.captionRect.top-view.captionRect.bottom)/2)<=.5,'收起箭头与左侧文字上下居中');
        if(colorMode==='standard'&&appearance==='light') {
          assert.deepEqual(rgb(view.borderColor).slice(0,3),[255,255,255],'浅色卡采用白色玻璃倒角');
          assert.equal((view.bevel.match(/inset/g)||[]).length,2,'浅色卡保留上下明暗立体层次');
        }
        assert.equal(view.resetCount.text,'2 次','重置数字与单位合为一段');
        assert.deepEqual(rgb(view.resetCount.color).slice(0,3),rgb(view.actionBlue).slice(0,3),'有可用重置次数时整段蓝色');
        assert.ok(view.resetClock&&view.resetClock.fill==='none'&&view.resetClock.rect.left>=view.resetCount.rect.right-1,'次数后展示 outline 时钟');
        if (periods.includes(300)) {
          assert.match(view.pace[0].text, /偏快/, 'pace 透过主进程/预加载');
          assert.equal(view.pace[0].color, colorMode === 'accessible'
            ? appearance === 'dark' ? 'rgb(255, 224, 138)' : 'rgb(113, 82, 0)'
            : appearance === 'dark' ? 'rgb(255, 173, 107)' : 'rgb(184, 75, 15)');
          if (colorMode === 'accessible') assert.equal(view.pace[0].symbol, '"!"', '警示不只靠颜色');
        }
        const png=await capture(label, `card-${name}-${colorMode}-${appearance}`, quotaLabel);
        view.outline=outlinePixels(nativeImage.createFromBuffer(png),view,appearance,colorMode);
        report.cards.push({ name, colorMode, appearance, ...view });
      }
      // These are native pointer events over the label and the adjacent number,
      // rather than element.click() or calling the production action directly.
      for (const action of ['tasks','results','opportunities','credits','trend']) {
        for (const region of action === 'trend' ? ['span'] : ['span','b']) {
          details.close();
          await poll(()=>label.isVisible(),Boolean,'关闭详情恢复额度卡');
          await clickRegion(label, `.v20-auxiliary button[data-action="${action}"] > ${region}`);
          const clickedWindow = await poll(() => details.getWindow(), value => value?.isVisible(), `${action}/${region} 点击打开`);
          const clicked = await poll(() => detailsView(clickedWindow), value=>value.action===action&&filled(value), `${action}/${region} 原生内容填满`);
          assert.equal(label.isVisible(),false,`${action}: 详情打开期间额度卡隐藏`);
          emit(namePeriods(getSettings().codexQuotaPeriod)); quotaLabel.reposition(); await paint(clickedWindow);
          assert.equal(label.isVisible(),false,`${action}: 刷新与重排不会抬升额度卡`);
          const after = await cardView(label);
          assert.equal(after.expanded, 'true', `${action}/${region} 点击不能收起主卡`);
          assert.equal(after.width, 196);
          report.clicks.push({action,region,colorMode,appearance,title:clicked.title});
        }
      }
      details.close();
      await poll(()=>label.isVisible(),Boolean,'详情关闭后恢复卡片');
      report.windowRestoration.push({colorMode,appearance,restored:true,expanded:(await cardView(label)).expanded});
      await clickRegion(label,'.v20-collapse');
      const collapsed=await poll(()=>cardView(label),value=>value.expanded==='false'&&value.width===128,'明确收起按钮实际生效');
      assertContentEdges(collapsed,'收起主卡四边');
      assert.equal(collapsed.radius,11,'正式小卡主体圆角11px');
      assert.equal(collapsed.beamRadius,13,'正式小卡完整外轮廓圆角13px');
      assert.deepEqual([collapsed.face.left,collapsed.face.top,collapsed.face.width,collapsed.face.height],[2,2,124,28],'正式小卡主体与完整外轮廓同心');
      const compactPng=await capture(label,`card-compact-${colorMode}-${appearance}`,quotaLabel);
      report.compact.push({colorMode,appearance,...collapsed,outline:outlinePixels(nativeImage.createFromBuffer(compactPng),collapsed,appearance,colorMode)});
      await clickRegion(label,'#summary');
      await poll(()=>cardView(label),value=>value.expanded==='true'&&value.width===196,'收起后可从摘要重新展开');
      emit([300, 10080]);
      let win = await open('trend');
      let view = await detailsView(win);
      assert.equal(view.tabs.length, 2, '双周期可切换');
      assert.ok(view.tabs.every(tab => !tab.decoration.includes('underline')), '选中周期无文字下划线');
      assert.equal(view.overflow, false);
      assert.ok(view.points >= 3, '曲线必须来自真实保存的合成记录');
      await capture(win, `trend-${colorMode}-${appearance}`, details);
      report.details.push({ action: 'trend', colorMode, appearance, ...view });
      win.setContentSize(320, win.getContentBounds().height);
      await paint(win); view = await detailsView(win);
      assert.equal(view.overflow, false, '趋势在 320px 宽下没有横向滚动');
      await capture(win, `trend-320-${colorMode}-${appearance}`, details);
      report.details.push({ action: 'trend-320', colorMode, appearance, ...view });
    }

    // Exercise the production main-process anchor with real native windows.
    // A hidden quota window retains its last bounds; it must not be the anchor
    // when the pet moves while a detail remains open.
    details.close();
    setColorMode('standard'); setQuotaPreference('codexQuotaAppearance', 'light');
    setQuotaPreference('codexQuotaPeriod', 'auto'); emit([300, 10080]);
    const area = screen.getDisplayMatching(originalPetBounds).workArea;
    const locations = [.25, .75].map(fraction => ({ ...originalPetBounds,
      x: Math.round(area.x + (area.width - originalPetBounds.width) * fraction),
      y: Math.round(area.y + (area.height - originalPetBounds.height) * .35) }));
    assert.notEqual(locations[0].x, locations[1].x, '原生定位验收确实移动球球');
    const movePet = async (location, suppressed = false) => {
      pet.setBounds(location, false);
      const current = await poll(() => pet.getBounds(), value => value.x === location.x && value.y === location.y,
        '球球实际移到新锚点');
      quotaLabel.reposition();
      if (!suppressed) {
        await poll(() => label.isVisible(), Boolean, '移动后额度卡显示');
        await paint(label);
      }
      return current;
    };
    const positionedOpen = async (action, phase) => {
      const anchorSource = 'pet', anchor = pet.getBounds();
      assert.equal(openDetails(action, 300), true, `${action}/${phase}: 使用真实主进程入口`);
      const win = details.getWindow(), initialBounds = win.getBounds();
      assertAnchoredDetails(initialBounds, anchor, screen.getDisplayMatching(anchor).workArea, `${action}/${phase}`);
      await poll(() => detailsView(win), value => value.action === action && filled(value), `${action}/${phase} 原生内容`);
      assert.equal(label.isVisible(), false, `${action}/${phase}: 额度卡持续避让`);
      await capture(win, `position-${action}-${phase}`, details);
      assertAnchoredDetails(win.getBounds(), pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea,
        `${action}/${phase}/renderer-resize`);
      return { win, evidence: { phase, anchorSource, anchor, petBounds: pet.getBounds(), initialBounds,
        settledBounds: win.getBounds() } };
    };
    for (const action of ['tasks', 'results', 'trend', 'opportunities', 'credits']) {
      details.close(); await poll(() => label.isVisible(), Boolean, `${action}: 首次打开前恢复额度卡`);
      await movePet(locations[0]);
      const first = await positionedOpen(action, 'first');
      details.close(); await poll(() => label.isVisible(), Boolean, `${action}: 关闭后恢复额度卡`);
      await movePet(locations[1]);
      const reopened = await positionedOpen(action, 'reopened');
      assert.equal(reopened.win, first.win, `${action}: 重开仍复用真实详情窗口`);
      assert.notEqual(reopened.evidence.initialBounds.x, first.evidence.initialBounds.x, `${action}: 重开不保留旧横坐标`);

      const hiddenQuotaBounds = label.getBounds();
      await movePet(locations[0], true);
      assert.equal(label.isVisible(), false, `${action}: 详情打开时移动球球不能抬升额度卡`);
      assert.deepEqual(label.getBounds(), hiddenQuotaBounds, '隐藏额度卡确实保留旧位置，不能作为当前锚点');
      const whileVisible = await positionedOpen(action, 'visible-reopen');
      assert.equal(whileVisible.evidence.anchorSource, 'pet');

      // Move the actual BrowserWindow as a user drag would, then trigger the
      // controller's content-resize path after moving the pet again.
      const win = whileVisible.win, current = win.getBounds();
      const requestedHeight = current.height > 144 ? current.height - 24 : current.height + 24;
      const dragged = { ...current,
        x: area.x + Math.max(0, Math.min(40, area.width - current.width)),
        y: area.y + Math.max(0, Math.min(40, area.height - Math.max(current.height, requestedHeight))) };
      win.setBounds(dragged, false);
      await poll(() => win.getBounds(), value => value.x === dragged.x && value.y === dragged.y,
        `${action}: 真实窗口模拟拖动`);
      await movePet(locations[1], true);
      details.resize(requestedHeight);
      const resized = win.getBounds();
      assert.deepEqual({ x: resized.x, y: resized.y }, { x: dragged.x, y: dragged.y },
        `${action}: 内容 resize 保留用户拖动的位置，不跟随新球球锚点`);
      assert.equal(resized.height, Math.min(requestedHeight, 700, area.height), `${action}: resize 实际调整原生高度`);
      await capture(win, `position-${action}-dragged-resize`, details);
      const settled = win.getBounds();
      assert.deepEqual({ x: settled.x, y: settled.y }, { x: dragged.x, y: dragged.y },
        `${action}: 后续 renderer resize 也不跳回球球位置`);
      report.positions.push({ action, workArea: area, first: first.evidence, reopened: reopened.evidence,
        hiddenQuotaBounds, whileVisible: whileVisible.evidence,
        resize: { dragged, requestedHeight, resized, settled, petBounds: pet.getBounds() } });
    }
    details.close(); await movePet(originalPetBounds);

    // All panels share the same native frame. Check populated and empty states
    // through the packaged controller/preload, with both actual and 320px widths.
    for (const colorMode of ['standard','accessible']) for (const appearance of ['light','dark']) {
      setColorMode(colorMode); setQuotaPreference('codexQuotaAppearance', appearance);
      for (const fixture of detailFixtures(now)) {
        const model={...buildCodexDetailsModel(fixture.snapshot,{action:fixture.action,appearance},now),colorMode};
        details.open(model);
        const win=await poll(()=>details.getWindow(),value=>value?.isVisible(),`${fixture.name} 打包详情`);
        let view=await poll(()=>detailsView(win),value=>value.action===fixture.action&&filled(value),`${fixture.name} 正常宽四边`);
        for (const width of ['normal',320]) {
          if(width===320){
            win.setContentSize(320,win.getContentBounds().height);await paint(win);
            view=await detailsView(win);
            // Narrowing may wrap a long amount. Grow only for that new content;
            // never shrink away an existing blank band and hide a fill defect.
            if(view.panel.height>view.contentBounds.height+1){
              win.setContentSize(320,Math.ceil(view.panel.height));await paint(win);view=await detailsView(win);
            }
            assert.equal(view.viewport.width,320,'窄屏验收实际使用320px原生内容宽度');
          }
          assertDetailsSurface(view,`${fixture.name}/${width}/${colorMode}/${appearance}`);
          assert.equal(view.dragRegion,'drag','详情文字、图表与空白均可拖动');
          assert.ok(view.interactiveRegions.every(region=>region.region==='no-drag'),'按钮、任务项与历史展开入口仍可点击');
          if(fixture.action==='tasks'||fixture.action==='results'){
            assert.equal(view.activityEntries,fixture.entries,'数据与空态条数准确');
            if(!fixture.entries)assert.match(view.empty,/暂无/,'空态提供可读说明');
          }
          if(fixture.action==='trend'){
            assert.equal(view.tabs.length,fixture.periods===2?2:0);
            assert.ok(view.stats.length===2&&view.stats.every(stat=>stat.labelRect.bottom<=stat.numberRect.top+1),'趋势标签在上、数字在下');
            if(fixture.name==='trend-week'){
              assert.match(view.title,/^周额度趋势/);assert.equal(view.brand,'CODEX');
              assert.match(view.pace.text,/均衡/);
              assert.deepEqual(rgb(view.pace.color).slice(0,3),rgb(view.blue).slice(0,3),'均衡采用蓝色');
            }
            assert.equal(view.positiveCounts.map(value=>value.text).join(''),'2 次','趋势底部数量和单位整段显示');
            assert.ok(view.positiveCounts.every(value=>JSON.stringify(rgb(value.color).slice(0,3))===JSON.stringify(rgb(view.blue).slice(0,3))),'趋势底部有可用机会时整段蓝色');
          }
          if(fixture.action==='credits')assert.equal(view.balance,fixture.expectedBalance,'余额精确格式化，不经 Number 丢失精度');
          if(fixture.name==='reset-no-history') {
            assert.ok(view.history&&!view.history.open,'账户历史成功为空仍保留折叠入口');
            assert.match(view.history.text,/账户历史 · 过去 30 天 · 0.*过去 30 天暂无获得或使用记录/);
            assert.equal(view.localHistory,null,'无本机记录时不虚构本机观察记录');
          }
          if(fixture.name==='reset-available') {
            assert.ok(view.history&&!view.history.open,'账户历史默认折叠');
            assert.match(view.history.text,/账户历史 · 过去 30 天 · 2/);
            assert.match(view.history.text,/已获得/);assert.match(view.history.text,/已使用/);
            assert.ok(view.localHistory&&!view.localHistory.open,'本机观察记录独立且默认折叠');
            assert.match(view.localHistory.text,/本机观察记录 · 2.*已过期/);
          }
          const filename=`surface-${fixture.name}-${width}-${colorMode}-${appearance}`;
          const png=await capture(win,filename,details);
          const alpha=pixelSamples(nativeImage.createFromBuffer(png),view);assertFilledPixels(alpha,filename);
          report.surfaces.push({name:fixture.name,width,colorMode,appearance,...view,pixelAlpha:alpha});
        }
      }
    }

    emit([300, 10080]);
    setColorMode('accessible'); setQuotaPreference('codexQuotaAppearance', 'dark');
    let win = await open('trend');
    await win.webContents.executeJavaScript(`document.querySelectorAll('.trend-tabs button')[1].click()`);
    await poll(() => detailsView(win), view => view.tabs[1]?.pressed === 'true', '切换周趋势真实 IPC');
    await win.webContents.executeJavaScript(`document.querySelector('.reset-link').click()`);
    let view = await poll(() => detailsView(win), value => /重置/.test(value.title), '趋势内打开重置详情');
    assert.equal(view.backVisible, true, '重置详情能返回趋势');
    assert.match(view.resetSummary, /2/, '可用次数和历史分开');
    assert.equal(view.history?.open, false, '历史默认折叠');
    await win.webContents.executeJavaScript(`document.getElementById('details-back').click()`);
    view = await poll(() => detailsView(win), value => value.tabs[1]?.pressed === 'true', '返回保留周周期');
    assert.ok(view.active, '返回后恢复键盘焦点');
    report.returnedPeriod = 'weekly';

    for (const period of [300, 10080]) {
      emit([period]); win = await open('trend', period); view = await detailsView(win);
      assert.equal(view.tabs.length, 0, '仅一种真实周期时没有切换栏');
      assert.match(view.title, period === 300 ? /5.*小时/ : /周/);
    }
    emit([300, 10080]);
    const zero = { ...getSnapshot(), quota: { ...getSnapshot().quota, resetCreditsAvailable: 0, resetOpportunities: [] } };
    for (const hasHistory of [true, false]) {
      const fixture = { ...zero,
        quota: { ...zero.quota, accountResetHistory: hasHistory ? seed.quota.accountResetHistory
          : { state: 'unavailable', events: [], updatedAt: null, code: 'UNSUPPORTED' } },
        history: { ...zero.history, resetHistory: hasHistory ? seed.history.resetHistory : [] } };
      details.open(buildCodexDetailsModel(fixture, { action: 'opportunities' }, now));
      win = details.getWindow(); await paint(win); view = await detailsView(win);
      assert.match(view.resetSummary, /0/, '零值不当作缺失');
      assert.match(view.visibleText, /暂无(?:可用)?重置机会/);
      assert.equal(view.tableHead, 0, '零次没有空表头');
      assert.ok(view.history,'始终保留历史入口');
      assert.equal(view.history.open,false,'无历史时也默认折叠');
      if(!hasHistory) {
        assert.match(view.history.text,/账户历史 · 未同步/);
        assert.doesNotMatch(view.history.text,/过去 30 天暂无/,'未同步不能声称账户没有历史');
        assert.equal(view.localHistory,null);
        await win.webContents.executeJavaScript(`document.querySelector('.opportunity-history summary').click()`);
        const emptyHistory=await poll(()=>detailsView(win),value=>value.history?.open&&filled(value),'无历史展开且背景填满');
        assert.match(emptyHistory.history.text,/账户历史暂未同步.*历史查询未完成，不代表账户没有记录/);
        await win.webContents.executeJavaScript(`document.querySelector('.opportunity-history summary').click()`);
      }
      if (hasHistory) {
        assert.equal(view.history.open, false);
        await win.webContents.executeJavaScript(`document.querySelector('.opportunity-history summary').click()`);
        const expanded = await poll(()=>detailsView(win),value=>value.history?.open&&filled(value),'账户历史展开且背景填满');
        assert.match(expanded.history.text,/账户历史 · 过去 30 天 · 2/);
        assert.match(expanded.history.text,/已获得/);assert.match(expanded.history.text,/已使用/);
        assert.doesNotMatch(expanded.history.text,/已过期/,'账户记录不混入本机到期观察');
        await capture(win,'reset-zero-history-expanded-account',details);
        await win.webContents.executeJavaScript(`document.querySelector('.opportunity-history summary').click()`);
        await poll(()=>detailsView(win),value=>value.history?.open===false,'账户历史收起');
        await win.webContents.executeJavaScript(`document.querySelector('.local-opportunity-history summary').click()`);
        const local=await poll(()=>detailsView(win),value=>value.localHistory?.open&&filled(value),'本机观察记录独立展开');
        assert.match(local.localHistory.text,/本机观察记录 · 2.*已过期/);assert.match(local.localHistory.text,/已使用/);
        await capture(win,'reset-zero-history-expanded-local',details);
        await win.webContents.executeJavaScript(`document.querySelector('.local-opportunity-history summary').click()`);
        await poll(()=>detailsView(win),value=>value.localHistory?.open===false,'本机观察记录收起');
      }
      await capture(win, `reset-zero-${hasHistory ? 'history' : 'empty'}`, details);
      report.details.push({ action: 'opportunities', hasHistory, ...view });
    }
    emit([300], { resetCreditsAvailable: 2, resetOpportunities: null,
      accountResetHistory: { state: 'unavailable', events: [], updatedAt: null, code: 'UNSUPPORTED' } });
    win = await open('opportunities'); view = await detailsView(win);
    assert.equal(view.rows, 0, '未返回明细时不得虚构到期行');
    assert.match(view.visibleText, /未提供|暂未|未返回|不可用|待更新/);
    assert.match(view.history.text,/账户历史 · 未同步/);
    assert.doesNotMatch(view.history.text,/过去 30 天暂无/,'有可用次数但历史查询未知不能伪装成功空态');
    await capture(win,'reset-history-unknown',details);
    report.details.push({action:'opportunities',accountHistoryState:'unavailable',...view});
    report.resetUnknown = true;

    emit([300, 10080]);
    win = await open('results'); view = await detailsView(win);
    assert.equal(view.htmlImages, 0, '任务标题只呈现纯文本');
    assert.equal(getSnapshot().history.results.filter(row => row.readAt === null).length, 1,
      '仅打开结果列表不能标已读');
    await win.webContents.executeJavaScript(`document.querySelector('.activity-item').click()`);
    await poll(() => getSnapshot().history.results.filter(row => row.readAt === null).length,
      count => count === 0, '真实结果按钮成功打开后标记已读');
    assert.equal(openedThreads.length, 1, '仅通过 smoke 接缝接收合成会话 URL');
    assert.match(openedThreads[0], new RegExp(taskId(4)));
    const reloaded = createQuotaHistory({ filePath: historyFile, now: () => now });
    reloaded.setAccount(ACCOUNT);
    assert.ok(reloaded.getState().results.some(row => row.id === taskId(4) && row.readAt === now), '已读重启回读');
    reloaded.close(); report.readPersistence = true;
    callbacks.onAccount({ accountKey: 'synthetic-v20-second-account' });
    assert.equal(getSnapshot().history.results.length, 0, '换账号不得串待查看结果');
    assert.equal(getSnapshot().history.windows.length, 0, '换账号不得串额度历史');
    report.accountIsolation = true;

    apiWindow = new BrowserWindow({ width: 196, height: 92, show: false, frame: false, transparent: true,
      webPreferences: { preload: path.join(__dirname, '../api-usage-label-preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    await apiWindow.loadFile(path.join(__dirname, '../api-usage-label.html'));
    for (const colorMode of ['standard', 'accessible']) for (const appearance of ['light', 'dark']) {
      apiWindow.webContents.send('pet:color-mode', colorMode, appearance);
      apiWindow.webContents.send('pet:api-usage-label', { connected: true, busy: false, expanded: true,
        appearance, report: { month: '2026-10', updatedAt: now,
          costs: { month: [{ currency: 'USD', value: 27.34 }], today: [{ currency: 'USD', value: 3.21 }] } } });
      await paint(apiWindow);
      const api = await apiWindow.webContents.executeJavaScript(`(() => {
        const visible=e=>e.getClientRects().length>0; const elements=['compact-header','api-month-cost','api-today-cost','api-query-status','api-open-details'].map(id=>document.getElementById(id));
        return { brandVisible:visible(elements[0]),month:elements[1].textContent,today:elements[2].textContent,
          utc:document.getElementById('api-today').textContent,overflow:document.documentElement.scrollWidth>innerWidth,
          fits:elements.every(e=>{const r=e.getBoundingClientRect();return visible(e)&&r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1;}) };
      })()`);
      assert.equal(api.brandVisible, true, '共用 CSS 不得隐藏 API 品牌栏');
      assert.match(api.month, /27\.34.*USD/); assert.match(api.today, /3\.21/); assert.match(api.utc, /UTC/);
      assert.equal(api.overflow, false); assert.equal(api.fits, true, 'API 四层信息适配 196×92');
      await capture(apiWindow, `card-api-${colorMode}-${appearance}`);
      report.cards.push({ name: 'api', colorMode, appearance, width: 196, height: 92, ...api });
    }
    report.passed = true;
    process.stdout.write(`PET_CODEX_STATUS_V20_OK ${report.cards.length} cards; ${report.surfaces.length} panel surfaces; ${report.clicks.length} pointer clicks; ${artifacts}\n`);
  } catch (error) {
    report.error = error.message; throw error;
  } finally {
    apiWindow?.destroy(); details.close();
    if (!pet.isDestroyed()) pet.setBounds(originalPetBounds, false);
    for (const key of ['codexQuotaPeriod', 'codexQuotaAlwaysVisible', 'codexQuotaLabelSize', 'codexQuotaAppearance', 'codexShowExtraCredits']) {
      setQuotaPreference(key, original[key]);
    }
    setColorMode(original.colorMode); await setEnabled(false); quotaLabel.hide();
    fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify(report, null, 2));
  }
}

module.exports = { verifyCodexStatusV20, syntheticSnapshot, detailFixtures, assertCardLayout,
  assertContentEdges, assertAnchoredDetails, assertDetailsSurface, assertFilledPixels, isRenderedDetailNode, contrast, rgb, sampleContrast };
