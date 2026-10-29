const { captureQuotaGroupFrames } = require('./quota-group-capture');
const { sendQuotaCardMotion } = require('./quota-card-motion');
const { createNativeWindowFade } = require('./native-window-fade');
const path = require('node:path');
const { quotaLabelSize } = require('./quota-label-placement');
const { createWorkBuddyGuardEntryWindow } = require('./workbuddy-guard-entry-window');
const { errorCode, errorMessage } = require('./workbuddy-quota-status');
const CHANNEL = 'pet:workbuddy-label';
const valid = b => b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function workBuddyLabelBounds(pet, area, obstacles = [], expanded = false, stackAnchor = null, presentation = null, bubbleBounds = null) {
  if (!valid(pet) || !valid(area)) return null;
  const { width } = quotaLabelSize(expanded ? 'compactExpanded' : 'compact');
  const height = expanded ? 120 : quotaLabelSize('compact').height;
  if (width > area.width || height > area.height) return null;
  if (['free','peeked'].includes(presentation?.mode) && presentation.quotaGroupHidden) return null;
  const coordinated = ['free','peeked'].includes(presentation?.mode) && presentation.quotaGroupLayout;
  if (valid(coordinated) && coordinated.width === width && coordinated.height === height &&
    coordinated.x >= area.x && coordinated.y >= area.y && coordinated.x + width <= area.x + area.width && coordinated.y + height <= area.y + area.height) return coordinated;
  const gap = 8;
  const anchor = valid(stackAnchor) ? stackAnchor : pet;
  const blocked = [pet, ...obstacles.filter(valid), ...(valid(stackAnchor) ? [stackAnchor] : []), ...(valid(bubbleBounds) ? [bubbleBounds] : [])];
  const clampX = x => Math.max(area.x, Math.min(x, area.x + area.width - width));
  const centerX = clampX(anchor.x + (anchor.width - width) / 2);
  const preferredX = valid(stackAnchor) && presentation?.side === 'left' ? clampX(anchor.x)
    : valid(stackAnchor) && presentation?.side === 'right' ? clampX(anchor.x + anchor.width - width) : centerX;
  // Keep both cards in the anchor column; never search the far screen edge.
  const xs = valid(stackAnchor) ? [preferredX] : [centerX, clampX(pet.x - width - gap), clampX(pet.x + pet.width + gap)];
  for (const x of xs) {
    const ys = [anchor.y + anchor.height + gap, anchor.y - height - gap];
    const column = { x, y: area.y, width, height: area.height };
    if (!valid(stackAnchor)) {
      const nearby = blocked.filter(b => overlaps(column, b));
      ys.push(...nearby.flatMap(b => [b.y + b.height + gap, b.y - height - gap])
        .sort((a, b) => Math.abs(a - ys[0]) - Math.abs(b - ys[0])));
    }
    const bubbleFloor = valid(bubbleBounds) && overlaps(column, bubbleBounds) ? bubbleBounds.y + bubbleBounds.height + gap : -Infinity;
    for (const y of ys) {
      if (y < bubbleFloor) continue;
      const b = { x: Math.round(x), y: Math.round(y), width, height };
      if (b.x >= area.x && b.y >= area.y && b.x + width <= area.x + area.width && b.y + height <= area.y + area.height && !blocked.some(o => overlaps(b, o))) return b;
    }
  }
  return null;
}
function safeState(state) {
  const number = n => Number.isFinite(n) && n >= 0;
  const date = n => Number.isFinite(n) && n >= 0 && n <= 8640000000000000 ? n : null;
  const r = state?.report;
  const report = r && ['total', 'basic', 'reward', 'purchased'].every(k => number(r[k])) ? {
    total: r.total, basic: r.basic, reward: r.reward, purchased: r.purchased,
    plan: typeof r.plan === 'string' ? r.plan.slice(0, 60) : '未知套餐',
    nextRefreshAt: date(r.nextRefreshAt), updatedAt: date(r.updatedAt),
    expires: Array.isArray(r.expires) ? r.expires.filter(e => e && number(e.amount) && date(e.at) !== null).map(e => ({ amount: e.amount, at: e.at })) : []
  } : null;
  const history = Array.isArray(state?.history) ? [...new Map(state.history.filter(sample =>
    sample && Number.isSafeInteger(sample.at) && sample.at >= 0 && sample.at <= 8640000000000000 && number(sample.total))
    .map(sample => {
      const clean = { at: sample.at, total: sample.total };
      for (const key of ['basic', 'reward', 'purchased']) if (number(sample[key])) clean[key] = sample[key];
      if (sample.nextRefreshAt === null || date(sample.nextRefreshAt) !== null) clean.nextRefreshAt = sample.nextRefreshAt;
      if (Array.isArray(sample.expires) && sample.expires.every(e => e && number(e.amount) && date(e.at) !== null)) {
        clean.expires = sample.expires.map(e => ({ amount: e.amount, at: e.at }));
      }
      return [sample.at, clean];
    })).values()].sort((a, b) => a.at - b.at).slice(-6000) : [];
  // Only fixed status text crosses IPC; upstream errors can contain credentials.
  const code = state?.error ? errorCode(state.errorCode) : null;
  return { enabled: state?.enabled === true, busy: state?.busy === true,
    error: code ? errorMessage(code) : null, errorCode: code, nextRetryAt: code ? date(state.nextRetryAt) : null,
    stale: state?.stale === true, report, history, historyError: state?.historyError ? '趋势记录暂未保存' : null,
    activity: { runningCount: Number.isSafeInteger(state?.activity?.runningCount) && state.activity.runningCount >= 0 ? state.activity.runningCount : null,
      unreadCount: Number.isSafeInteger(state?.activity?.unreadCount) && state.activity.unreadCount >= 0 ? state.activity.unreadCount : null, scope: '本机已同步任务' } };
}
function createWorkBuddyLabelWindow({ BrowserWindow, screen, getPetWindow, getObstacles = () => [], getStackAnchor = () => null, getBubbleBounds = () => null, getPresentation = () => null, getGuardEntry = () => false, onGuard = () => {}, getAppearance = () => 'system', alwaysOnTop = true, onRefresh = () => {}, onTrend = () => {}, onTasks = () => {}, onError = () => {}, onLayout = () => {} }) {
  let groupTransitionMode=null,groupTransitionEpoch=0,groupResumeImmediate=false;
  let win = null, ready = false, visible = false, expanded = false, current = null, resetExpandedPending = false, top = Boolean(alwaysOnTop);
  const error = e => { try { onError(e); } catch (_) {} };
  const guard = createWorkBuddyGuardEntryWindow({ BrowserWindow, alwaysOnTop, onGuard, onError });
  const live = w => w && !w.isDestroyed() && !w.webContents.isDestroyed?.();
  const fade = createNativeWindowFade({ onError: error });
  function notifyLayout() { try { onLayout(); } catch (e) { error(e); } }
  function hide({ animate = false } = {}) { groupTransitionMode=null;groupTransitionEpoch++;const changed = visible || expanded; visible = false; expanded = false; guard.hide({safety:true}); if (live(win)) { win.setIgnoreMouseEvents?.(true, { forward: true }); fade.hide(win, { animate: sendQuotaCardMotion(win, false, getPresentation(), animate && ['peeked', 'tucked'].includes(getPresentation()?.mode)) }); } if (changed) notifyLayout(); }
  function destroy() { groupTransitionMode=null;groupTransitionEpoch++;fade.cancel(win); guard.destroy(); const old = win; win = null; ready = visible = expanded = false; if (live(old)) old.destroy(); }
  function reposition() {
    if(groupTransitionMode==='hold'||groupTransitionMode==='masked')return;
    if (!ready || !visible || !live(win)) return;
    try {
      const presentation = getPresentation();
      // Stop before reading a disappearing stack anchor during the edge exit.
      if (presentation?.mode === 'tucked' && presentation.quotaAnimateHide === true) { hide({ animate: true }); return; }
      if (presentation?.quotaGroupHidden === true) { guard.hide(); win.setIgnoreMouseEvents?.(true, { forward: true }); fade.hide(win, { animate: sendQuotaCardMotion(win, false, presentation, presentation.quotaGroupAnimate === true), ...(presentation.quotaGroupAnimate ? {duration:220,easing:'group-collapse'} : {}) }); return; }
      if(resetExpandedPending){expanded=false;resetExpandedPending=false;}
      const pet = getPetWindow();
      if (!pet || pet.isDestroyed() || !pet.isVisible()) { fade.hide(win); guard.hide(); return; }
      const p = pet.getBounds(), area = screen.getDisplayMatching(p).workArea, obstacles = getObstacles() || [];
      const stackAnchor = getStackAnchor(), bubbleBounds = getBubbleBounds();
      let bounds = workBuddyLabelBounds(p, area, obstacles, expanded, stackAnchor, presentation, bubbleBounds), spaceError = false;
      if (!bounds && expanded) { expanded = false; spaceError = true; notifyLayout(); bounds = workBuddyLabelBounds(p, area, obstacles, false, stackAnchor, presentation, bubbleBounds); }
      if (!bounds) { fade.hide(win); guard.hide(); return; }
      const appearance = getAppearance();
      win.setBounds(bounds, false);
      win.webContents.send(CHANNEL, { ...current, expanded, spaceError, appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system' });
      win.setIgnoreMouseEvents?.(groupTransitionMode==='stage',{forward:true});
      if(groupTransitionMode==='stage'){fade.cancel(win);sendQuotaCardMotion(win,true,{...presentation,quotaGroupAnimate:false},false);win.hide();}
      else fade.show(win, sendQuotaCardMotion(win, true, presentation, !groupResumeImmediate && (presentation?.quotaGroupAnimate === true || ['peeked', 'tucked'].includes(presentation?.mode))));
      if (!expanded && getGuardEntry() === true) guard.show(bounds, area, [p, ...obstacles], presentation?.side);
      else guard.hide();
    } catch (e) { guard.hide(); if (live(win)) fade.hide(win); error(e); }
  }
  function ensure() {
    if (live(win)) return;
    const target = new BrowserWindow({ ...quotaLabelSize('compact'), title: 'WorkBuddy 积分', transparent: true, frame: false, resizable: false, skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false, maximizable: false, minimizable: false,
      webPreferences: { preload: path.join(__dirname, '../workbuddy-label-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    win = target; ready = false;
    target.setAlwaysOnTop(top, 'floating');
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview']) target.webContents.on(event, e => e.preventDefault());
    target.webContents.on('did-start-loading',()=>{if(win===target){ready=false;groupTransitionEpoch++;}});
    target.webContents.on('ipc-message', (e, channel, kind) => {
      if (groupTransitionMode || win !== target || !ready || !visible || !live(target) || !target.isVisible() || e.sender !== target.webContents || e.senderFrame !== target.webContents.mainFrame) return;
      try {
        if (channel === `${CHANNEL}-toggle`) { expanded = !expanded; notifyLayout(); reposition(); }
        if (channel === `${CHANNEL}-refresh` && !current.busy) onRefresh();
        if (channel === `${CHANNEL}-trend`) onTrend();
        if (channel === `${CHANNEL}-tasks` && ['tasks', 'results'].includes(kind)) onTasks(kind);
      } catch (err) { error(err); }
    });
    target.on('closed', () => { if (win === target) { guard.hide(); win = null; ready = false; } });
    target.webContents.on('render-process-gone', () => { if (win === target) { destroy(); error(new Error('WorkBuddy 积分窗口已退出')); } });
    const loaded = () => { if (win === target && !ready && live(target)) { ready = true; notifyLayout(); reposition(); } };
    target.webContents.on('did-finish-load', loaded);
    Promise.resolve(target.loadFile(path.join(__dirname, '../workbuddy-label.html'))).then(loaded).catch(e => { if (win === target) destroy(); error(e); });
  }
  return { show(state) { current = safeState(state); if (!current.enabled) { hide(); return; } const changed = !visible; visible = true; try { ensure(); if (changed) notifyLayout(); reposition(); } catch (e) { destroy(); error(e); } }, hide, destroy, reposition, resetExpanded() { resetExpandedPending=true; },
    setGroupTransitionMode(mode) {
      if(![null,'hold','stage','masked'].includes(mode)||mode===groupTransitionMode)return;
      groupTransitionMode=mode;groupTransitionEpoch++;guard.setGroupTransitionMode(mode);
      if(live(win)){fade.cancel(win);win.setIgnoreMouseEvents?.(true,{forward:true});if(mode==='stage'||mode==='masked')win.hide();}
      groupResumeImmediate=mode===null;try{if(mode===null||mode==='stage')reposition();}finally{groupResumeImmediate=false;}
    },
    captureGroupTransitionFrames() {
      const stageAvailable=()=>groupTransitionMode!=='stage'||getPresentation()?.quotaGroupHidden!==true;
      if(!stageAvailable())return Promise.reject(new Error('Quota group stage has no visible layout'));
      const epoch=groupTransitionEpoch,target=win;
      return captureQuotaGroupFrames({getTargets:()=>[target,guard.getCaptureWindow()],isReady:()=>ready&&visible&&win===target&&live(target)&&guard.isCaptureReady(),isCurrent:()=>stageAvailable()&&epoch===groupTransitionEpoch&&target===win});
    },
    getWindow: () => live(win) ? win : null,
    getGuardWindow: () => guard.getWindow(),
    getLayoutMetrics() {
      if (!visible || !current?.enabled) return null;
      return { width: expanded&&!resetExpandedPending ? 196 : 128, height: expanded&&!resetExpandedPending ? 120 : 32, inset: expanded&&!resetExpandedPending ? 0 : 2 };
    },
    getVisibleBounds() { if (!live(win) || !win.isVisible()&&groupTransitionMode!=='stage') return null; const bounds = win.getBounds(), inset = expanded ? 0 : 2; return { x: bounds.x + inset, y: bounds.y + inset, width: bounds.width - inset * 2, height: bounds.height - inset * 2 }; },
    setAlwaysOnTop(value) { guard.setAlwaysOnTop(value); top = Boolean(value); try { if (live(win)) win.setAlwaysOnTop(top, 'floating'); } catch (e) { error(e); } } };
}
module.exports = { createWorkBuddyLabelWindow, workBuddyLabelBounds, safeState };
