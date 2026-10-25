const path = require('node:path');
const { quotaLabelSize } = require('./quota-label-placement');
const CHANNEL = 'pet:workbuddy-label';
const valid = b => b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function workBuddyLabelBounds(pet, area, obstacles = [], expanded = false) {
  if (!valid(pet) || !valid(area)) return null;
  const { width } = quotaLabelSize(expanded ? 'compactExpanded' : 'compact');
  const height = expanded ? 120 : quotaLabelSize('compact').height;
  const gap = 8;
  const blocked = [pet, ...obstacles.filter(valid)];
  const centerX = pet.x + (pet.width - width) / 2;
  const xs = [centerX, pet.x, pet.x + pet.width - width, area.x, area.x + area.width - width];
  const ys = [pet.y + pet.height + gap, pet.y - height - gap, area.y, area.y + area.height - height];
  for (const b of blocked) { xs.push(b.x - width - gap, b.x + b.width + gap); ys.push(b.y - height - gap, b.y + b.height + gap); }
  const below = { x: centerX, y: ys[0], width, height };
  const stack = obstacles.filter(valid).filter(b => overlaps(below, b)).map(b => b.y + b.height + gap).sort((a, b) => a - b);
  const candidates = [...[ys[0], ...stack, ys[1]].map(y => ({ x: centerX, y })), ...ys.flatMap(y => xs.map(x => ({ x, y })))];
  for (const { x, y } of candidates) {
    const b = { x: Math.round(x), y: Math.round(y), width, height };
    if (b.x >= area.x && b.y >= area.y && b.x + width <= area.x + area.width && b.y + height <= area.y + area.height && !blocked.some(o => overlaps(b, o))) return b;
  }
  return null;
}
function safeState(state) {
  const number = n => Number.isFinite(n) && n >= 0;
  const date = n => Number.isFinite(n) && n >= 0 ? n : null;
  const r = state?.report;
  const report = r && ['total', 'basic', 'reward', 'purchased'].every(k => number(r[k])) ? {
    total: r.total, basic: r.basic, reward: r.reward, purchased: r.purchased,
    plan: typeof r.plan === 'string' ? r.plan.slice(0, 60) : '未知套餐',
    nextRefreshAt: date(r.nextRefreshAt), updatedAt: date(r.updatedAt),
    expires: Array.isArray(r.expires) ? r.expires.filter(e => e && number(e.amount) && date(e.at) !== null).map(e => ({ amount: e.amount, at: e.at })) : []
  } : null;
  const history = Array.isArray(state?.history) ? [...new Map(state.history.filter(sample =>
    sample && Number.isSafeInteger(sample.at) && sample.at >= 0 && sample.at <= 8640000000000000 && number(sample.total))
    .map(sample => [sample.at, { at: sample.at, total: sample.total }])).values()].sort((a, b) => a.at - b.at).slice(-6000) : [];
  // Only fixed status text crosses IPC; upstream errors can contain credentials.
  return { enabled: state?.enabled === true, busy: state?.busy === true,
    error: state?.error ? '更新失败，请稍后重试' : null, stale: state?.stale === true, report, history, historyError: state?.historyError ? '趋势记录暂未保存' : null };
}
function createWorkBuddyLabelWindow({ BrowserWindow, screen, getPetWindow, getObstacles = () => [], getAppearance = () => 'system', alwaysOnTop = true, onRefresh = () => {}, onTrend = () => {}, onError = () => {} }) {
  let win = null, ready = false, visible = false, expanded = false, current = null, top = Boolean(alwaysOnTop);
  const error = e => { try { onError(e); } catch (_) {} };
  const live = w => w && !w.isDestroyed() && !w.webContents.isDestroyed?.();
  function hide() { visible = false; expanded = false; if (live(win)) win.hide(); }
  function destroy() { const old = win; win = null; ready = visible = expanded = false; if (live(old)) old.destroy(); }
  function reposition() {
    if (!ready || !visible || !live(win)) return;
    try {
      const pet = getPetWindow();
      if (!pet || pet.isDestroyed() || !pet.isVisible()) { win.hide(); return; }
      const p = pet.getBounds(), area = screen.getDisplayMatching(p).workArea, obstacles = getObstacles() || [];
      let bounds = workBuddyLabelBounds(p, area, obstacles, expanded), spaceError = false;
      if (!bounds && expanded) { expanded = false; spaceError = true; bounds = workBuddyLabelBounds(p, area, obstacles); }
      if (!bounds) { win.hide(); return; }
      const appearance = getAppearance();
      win.setBounds(bounds, false);
      win.webContents.send(CHANNEL, { ...current, expanded, spaceError, appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system' });
      win.showInactive();
    } catch (e) { if (live(win)) win.hide(); error(e); }
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
    target.webContents.on('ipc-message', (e, channel) => {
      if (win !== target || !ready || !visible || !live(target) || !target.isVisible() || e.sender !== target.webContents || e.senderFrame !== target.webContents.mainFrame) return;
      try {
        if (channel === `${CHANNEL}-toggle`) { expanded = !expanded; reposition(); }
        if (channel === `${CHANNEL}-refresh` && !current.busy) onRefresh();
        if (channel === `${CHANNEL}-trend`) onTrend();
      } catch (err) { error(err); }
    });
    target.on('closed', () => { if (win === target) { win = null; ready = false; } });
    target.webContents.on('render-process-gone', () => { if (win === target) { destroy(); error(new Error('WorkBuddy 积分窗口已退出')); } });
    const loaded = () => { if (win === target && !ready && live(target)) { ready = true; reposition(); } };
    target.webContents.on('did-finish-load', loaded);
    Promise.resolve(target.loadFile(path.join(__dirname, '../workbuddy-label.html'))).then(loaded).catch(e => { if (win === target) destroy(); error(e); });
  }
  return { show(state) { current = safeState(state); if (!current.enabled) { hide(); return; } visible = true; try { ensure(); reposition(); } catch (e) { destroy(); error(e); } }, hide, destroy, reposition,
    getWindow: () => live(win) ? win : null,
    setAlwaysOnTop(value) { top = Boolean(value); try { if (live(win)) win.setAlwaysOnTop(top, 'floating'); } catch (e) { error(e); } } };
}
module.exports = { createWorkBuddyLabelWindow, workBuddyLabelBounds, safeState };
