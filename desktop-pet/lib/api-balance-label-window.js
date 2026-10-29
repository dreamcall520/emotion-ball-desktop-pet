const path = require('node:path');
const { captureQuotaGroupFrames } = require('./quota-group-capture');
const { sendQuotaCardMotion } = require('./quota-card-motion');
const { createNativeWindowFade } = require('./native-window-fade');
const CHANNEL = 'pet:api-balance-label';
const SIZES = Object.freeze({ compact: Object.freeze({ width: 128, height: 32 }), expanded: Object.freeze({ width: 196, height: 120 }) });
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBounds = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const STATUS = new Set(['disabled', 'empty', 'ready', 'loading', 'stale', 'unauthenticated', 'unsupported', 'unconfigured', 'error']);
const ERROR_MESSAGES = Object.freeze({
  CONFIG_UNAVAILABLE: '暂时无法读取账户配置', CONFIG_INVALID: '账户配置格式暂不支持',
  UNSUPPORTED_PROVIDER: '此供应商暂无余额接口', UNSUPPORTED_ENDPOINT: '此服务地址暂无已验证的余额接口',
  MISSING_API_KEY: '请在连接设置中配置账户密钥', UNAUTHENTICATED: '账户密钥已失效，请在连接设置中更新',
  RATE_LIMITED: '请求较多，稍后自动重试', TIMEOUT: '查询超时，稍后自动重试',
  CONNECTION_FAILED: '连接暂未恢复，稍后自动重试', SERVICE_UNAVAILABLE: '服务暂不可用，稍后自动重试',
  INVALID_RESPONSE: '返回数据不完整，本次余额未更新', CANCELLED: '本次查询已取消', UPDATE_FAILED: '余额暂未更新，请稍后重试'
});
const date = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
function safeReport(value, expectedCurrency) {
  if (!value || !Number.isFinite(value.available) || !currency(value.currency) || date(value.updatedAt) === null || expectedCurrency && value.currency !== expectedCurrency) return null;
  return { available: value.available, cash: Number.isFinite(value.cash) ? value.cash : null,
    voucher: Number.isFinite(value.voucher) ? value.voucher : null, currency: value.currency, updatedAt: value.updatedAt };
}
function safeState(state) {
  const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[已隐藏]').trim().slice(0, 60) : '';
  const accounts = Array.isArray(state?.accounts) ? [...new Map(state.accounts.filter(account => validId(account?.id)).slice(0, 100).map(account => {
    const status = STATUS.has(account.status) ? account.status : 'unconfigured';
    const supported = account.supported === true, unit = currency(account.currency);
    const report = supported && !['unauthenticated', 'unsupported', 'unconfigured', 'disabled'].includes(status) ? safeReport(account.report, unit) : null;
    return [account.id, { id: account.id, name: text(account.name) || 'API 账户', provider: account.provider === 'moonshot' ? 'moonshot' : 'unknown',
      currency: unit, supported, status, busy: account.busy === true, stale: account.stale === true, report }];
  })).values()] : [];
  const selected = accounts.find(account => account.id === state?.selectedAccountId);
  const status = STATUS.has(state?.status) ? state.status : selected ? 'unconfigured' : 'empty';
  const report = selected?.supported && !['unauthenticated', 'unsupported', 'unconfigured', 'empty', 'disabled'].includes(status) ? safeReport(state.report, selected.currency) : null;
  const code = state?.error || state?.errorCode ? Object.hasOwn(ERROR_MESSAGES, state.errorCode) ? state.errorCode : 'UPDATE_FAILED' : null;
  const history = selected?.supported && report && Array.isArray(state?.history) ? [...new Map(state.history.filter(point => date(point?.at) !== null && Number.isFinite(point.available)).map(point => [point.at,
    { at: point.at, available: point.available, cash: Number.isFinite(point.cash) ? point.cash : null, voucher: Number.isFinite(point.voucher) ? point.voucher : null }])).values()].sort((a, b) => a.at - b.at).slice(-2016) : [];
  return { enabled: state?.enabled === true, busy: state?.busy === true, accounts, selectedAccountId: selected?.id || null,
    status, error: code ? ERROR_MESSAGES[code] : null, errorCode: code, nextRetryAt: code ? date(state.nextRetryAt) : null,
    report, history, stale: state?.stale === true, historyError: state?.historyError ? '部分余额记录暂未保存' : null };
}
function apiBalanceLabelBounds(pet, area, obstacles = [], expanded = false, stackAnchor = null, presentation = null, bubbleBounds = null) {
  if (!validBounds(pet) || !validBounds(area)) return null;
  const { width, height } = expanded ? SIZES.expanded : SIZES.compact;
  if (width > area.width || height > area.height || presentation?.quotaGroupHidden) return null;
  const coordinated = ['free', 'peeked'].includes(presentation?.mode) && presentation.quotaGroupLayout;
  if (validBounds(coordinated) && coordinated.width === width && coordinated.height === height && coordinated.x >= area.x && coordinated.y >= area.y &&
      coordinated.x + width <= area.x + area.width && coordinated.y + height <= area.y + area.height) return coordinated;
  const anchor = validBounds(stackAnchor) ? stackAnchor : pet, gap = 8;
  const blocked = [pet, ...obstacles.filter(validBounds), ...(validBounds(stackAnchor) ? [stackAnchor] : []), ...(validBounds(bubbleBounds) ? [bubbleBounds] : [])];
  const clampX = x => Math.max(area.x, Math.min(x, area.x + area.width - width));
  const center = clampX(anchor.x + (anchor.width - width) / 2);
  const preferred = validBounds(stackAnchor) && presentation?.side === 'left' ? clampX(anchor.x)
    : validBounds(stackAnchor) && presentation?.side === 'right' ? clampX(anchor.x + anchor.width - width) : center;
  const xs = validBounds(stackAnchor) ? [preferred] : [center, clampX(pet.x - width - gap), clampX(pet.x + pet.width + gap)];
  for (const x of xs) {
    const column = { x, y: area.y, width, height: area.height }, ys = [anchor.y + anchor.height + gap, anchor.y - height - gap];
    if (!validBounds(stackAnchor)) ys.push(...blocked.filter(item => overlaps(column, item)).flatMap(item => [item.y + item.height + gap, item.y - height - gap]).sort((a, b) => Math.abs(a - ys[0]) - Math.abs(b - ys[0])));
    const floor = validBounds(bubbleBounds) && overlaps(column, bubbleBounds) ? bubbleBounds.y + bubbleBounds.height + gap : -Infinity;
    for (const y of ys) {
      const bounds = { x: Math.round(x), y: Math.round(y), width, height };
      if (y >= floor && bounds.x >= area.x && bounds.y >= area.y && bounds.x + width <= area.x + area.width && bounds.y + height <= area.y + area.height && !blocked.some(item => overlaps(bounds, item))) return bounds;
    }
  }
  return null;
}
function createApiBalanceLabelWindow({ BrowserWindow, screen, getPetWindow, getObstacles = () => [], getStackAnchor = () => null,
  getBubbleBounds = () => null, getPresentation = () => null, getAppearance = () => 'system', alwaysOnTop = true,
  onSelectAccount = () => {}, onRefresh = () => {}, onTrend = () => {}, onSettings = () => {}, onExpandedChange = () => {}, onLayout = () => {}, onError = () => {} }) {
  let win = null, ready = false, visible = false, expanded = false, current = null, resetExpandedPending = false, top = Boolean(alwaysOnTop);
  let groupTransitionMode = null, groupTransitionEpoch = 0, groupResumeImmediate = false;
  const live = target => target && !target.isDestroyed() && !target.webContents.isDestroyed?.();
  const reportError = error => { try { onError(error); } catch (_) {} };
  const notifyLayout = () => { try { onLayout(); } catch (error) { reportError(error); } };
  const fade = createNativeWindowFade({ onError: reportError });
  function setExpanded(value) {
    if (expanded === value) return;
    expanded = value; try { onExpandedChange(value); } catch (error) { reportError(error); }
  }
  function hide({ animate = false } = {}) {
    groupTransitionMode = null; groupTransitionEpoch++;
    const changed = visible || expanded; visible = false; setExpanded(false);
    if (live(win)) { win.setIgnoreMouseEvents?.(true, { forward: true }); fade.hide(win, { animate: sendQuotaCardMotion(win, false, getPresentation(), animate && ['peeked', 'tucked'].includes(getPresentation()?.mode)) }); }
    if (changed) notifyLayout();
  }
  function destroy() {
    groupTransitionMode = null; groupTransitionEpoch++; fade.cancel(win);
    const old = win, changed = visible || expanded; win = null; ready = visible = false; current = null; setExpanded(false);
    if (live(old)) old.destroy(); if (changed) notifyLayout();
  }
  function reposition() {
    if (groupTransitionMode === 'hold' || groupTransitionMode === 'masked' || !ready || !visible || !live(win)) return;
    try {
      const presentation = getPresentation();
      if (presentation?.mode === 'tucked' && presentation.quotaAnimateHide === true) { hide({ animate: true }); return; }
      if (presentation?.quotaGroupHidden === true) {
        win.setIgnoreMouseEvents?.(true, { forward: true });
        fade.hide(win, { animate: sendQuotaCardMotion(win, false, presentation, presentation.quotaGroupAnimate === true), ...(presentation.quotaGroupAnimate ? { duration: 220, easing: 'group-collapse' } : {}) }); return;
      }
      if (resetExpandedPending) { resetExpandedPending = false; setExpanded(false); }
      const pet = getPetWindow();
      if (!pet || pet.isDestroyed() || !pet.isVisible()) { fade.hide(win); return; }
      const petBounds = pet.getBounds(), area = screen.getDisplayMatching(petBounds).workArea, obstacles = getObstacles() || [];
      const anchor = getStackAnchor(), bubble = getBubbleBounds();
      let bounds = apiBalanceLabelBounds(petBounds, area, obstacles, expanded, anchor, presentation, bubble), spaceError = false;
      if (!bounds && expanded) { setExpanded(false); spaceError = true; notifyLayout(); bounds = apiBalanceLabelBounds(petBounds, area, obstacles, false, anchor, presentation, bubble); }
      if (!bounds) { fade.hide(win); return; }
      const appearance = getAppearance();
      win.setBounds(bounds, false); win.webContents.send(CHANNEL, { ...current, expanded, spaceError, appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system' });
      win.setIgnoreMouseEvents?.(groupTransitionMode === 'stage', { forward: true });
      if (groupTransitionMode === 'stage') { fade.cancel(win); sendQuotaCardMotion(win, true, { ...presentation, quotaGroupAnimate: false }, false); win.hide(); }
      else fade.show(win, sendQuotaCardMotion(win, true, presentation, !groupResumeImmediate && (presentation?.quotaGroupAnimate === true || ['peeked', 'tucked'].includes(presentation?.mode))));
    } catch (error) { if (live(win)) fade.hide(win); reportError(error); }
  }
  function ensure() {
    if (live(win)) return;
    const target = new BrowserWindow({ ...SIZES.compact, title: 'API 账户余额', transparent: true, frame: false, resizable: false, skipTaskbar: true,
      show: false, hasShadow: false, fullscreenable: false, maximizable: false, minimizable: false,
      webPreferences: { preload: path.join(__dirname, '../api-balance-label-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    win = target; ready = false;
    target.setAlwaysOnTop(top, 'floating'); target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const name of ['will-navigate', 'will-attach-webview']) target.webContents.on(name, event => event.preventDefault());
    target.webContents.on('did-start-loading', () => { if (win === target) { ready = false; groupTransitionEpoch++; } });
    target.webContents.on('ipc-message', (event, channel, id) => {
      if (groupTransitionMode || win !== target || !ready || !visible || !live(target) || !target.isVisible() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame) return;
      try {
        if (channel === `${CHANNEL}-toggle`) { setExpanded(!expanded); notifyLayout(); reposition(); }
        if (channel === `${CHANNEL}-trend` && current.accounts.some(account => account.id === current.selectedAccountId && account.supported) && !['disabled', 'unconfigured', 'unauthenticated'].includes(current.status)) onTrend();
        if (channel === `${CHANNEL}-refresh` && !current.busy && current.accounts.some(account => account.id === current.selectedAccountId && account.supported)) onRefresh();
        if (channel === `${CHANNEL}-settings`) onSettings();
        if (channel === `${CHANNEL}-select` && validId(id) && current.accounts.some(account => account.id === id) && id !== current.selectedAccountId) onSelectAccount(id);
      } catch (error) { reportError(error); }
    });
    target.on('closed', () => { if (win === target) { win = null; ready = visible = false; setExpanded(false); notifyLayout(); } });
    target.webContents.on('render-process-gone', () => { if (win === target) { destroy(); reportError(new Error('API 余额窗口已退出')); } });
    const loaded = () => { if (win === target && !ready && live(target)) { ready = true; notifyLayout(); reposition(); } };
    target.webContents.on('did-finish-load', loaded);
    Promise.resolve(target.loadFile(path.join(__dirname, '../api-balance-label.html'))).then(loaded).catch(error => { if (win === target) destroy(); reportError(error); });
  }
  return {
    show(state) { current = safeState(state); if (!current.enabled) { hide(); return; } const changed = !visible; visible = true; try { ensure(); if (changed) notifyLayout(); reposition(); } catch (error) { destroy(); reportError(error); } },
    hide, destroy, reposition, resetExpanded() { resetExpandedPending = true; },
    setGroupTransitionMode(mode) {
      if (![null, 'hold', 'stage', 'masked'].includes(mode) || mode === groupTransitionMode) return;
      groupTransitionMode = mode; groupTransitionEpoch++;
      if (live(win)) { fade.cancel(win); win.setIgnoreMouseEvents?.(true, { forward: true }); if (mode === 'stage' || mode === 'masked') win.hide(); }
      groupResumeImmediate = mode === null; try { if (mode === null || mode === 'stage') reposition(); } finally { groupResumeImmediate = false; }
    },
    captureGroupTransitionFrames() {
      const available = () => groupTransitionMode !== 'stage' || getPresentation()?.quotaGroupHidden !== true;
      if (!available()) return Promise.reject(new Error('Quota group stage has no visible layout'));
      const epoch = groupTransitionEpoch, target = win;
      return captureQuotaGroupFrames({ getTargets: () => [target], isReady: () => ready && visible && win === target && live(target),
        isCurrent: () => available() && epoch === groupTransitionEpoch && target === win });
    },
    getWindow: () => live(win) ? win : null,
    getLayoutMetrics() { return visible && current?.enabled ? { ...(expanded && !resetExpandedPending ? SIZES.expanded : SIZES.compact), inset: expanded && !resetExpandedPending ? 0 : 2 } : null; },
    getVisibleBounds() {
      if (!live(win) || !win.isVisible() && groupTransitionMode !== 'stage') return null;
      const bounds = win.getBounds(), inset = expanded ? 0 : 2;
      return { x: bounds.x + inset, y: bounds.y + inset, width: bounds.width - inset * 2, height: bounds.height - inset * 2 };
    },
    setAlwaysOnTop(value) { top = Boolean(value); try { if (live(win)) win.setAlwaysOnTop(top, 'floating'); } catch (error) { reportError(error); } }
  };
}
module.exports = { createApiBalanceLabelWindow, apiBalanceLabelBounds, safeState };
