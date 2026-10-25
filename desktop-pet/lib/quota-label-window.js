const { captureQuotaGroupFrames } = require('./quota-group-capture');
const { sendQuotaCardMotion } = require('./quota-card-motion');
const { createNativeWindowFade } = require('./native-window-fade');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { quotaLabelBounds, quotaLabelSize, quotaRoleTargetWidth } = require('./quota-label-placement');
const { petVisualBounds } = require('./pet-visual-bounds');
const SheepTheme = require('./sheep-theme');
const PetFacing = require('./pet-facing');

const CHANNEL = 'pet:quota-label';
const TOGGLE_CHANNEL = 'pet:quota-label-toggle';
const POINTER_CHANNEL = 'pet:quota-label-pointer';
const FILE = path.join(__dirname, '../quota-label.html');
const STATES = new Set([
  'disabled', 'connecting', 'connected', 'ready', 'stale', 'reset-wait', 'period-missing',
  'empty', 'missing', 'unauthenticated', 'unsupported', 'disconnected'
]);
const CONTROL_AND_DIRECTION = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const EMPTY_MODEL = Object.freeze({ state: 'disconnected', items: Object.freeze([]), overflow: 0 });
const MAX_TOPMOST_SYNC_ATTEMPTS = 8;

function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(CONTROL_AND_DIRECTION, ' ').replace(/\s+/gu, ' ').trim())
    .slice(0, 32).join('');
}

function record(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function paceFields(value) {
  try {
    if (!value || !['fast', 'balanced', 'slow', 'unknown'].includes(value.state)) return {};
    return { pace: { state: value.state,
      remainingTimePercent: Number.isFinite(value.remainingTimePercent) && value.remainingTimePercent >= 0 && value.remainingTimePercent <= 100 ? value.remainingTimePercent : null } };
  } catch (_) { return {}; }
}

function activityFields(value) {
  try {
    if (!value) return {};
    const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 999999 ? value : null;
    return { activity: { runningCount: count(value.runningCount), unreadCount: count(value.unreadCount) } };
  } catch (_) { return {}; }
}

function bucketFields(item, sourceId) {
  if (sourceId !== 'zcode') return {};
  try { return {
      planName: cleanLabel(item.planName),
      ...(typeof item.model === 'string' ? { model: cleanLabel(item.model) } : {}),
      bucketId: typeof item.bucketId === 'string' && /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(item.bucketId) ? item.bucketId : '',
      periodKind: ['one_time', 'expiry', 'daily', 'rolling', 'weekly', 'monthly', 'unknown'].includes(item.periodKind) ? item.periodKind : 'unknown',
      periodStart: Number.isSafeInteger(item.periodStart) && item.periodStart > 0 ? item.periodStart : null,
      total: Number.isFinite(item.total) && item.total >= 0 ? item.total : null,
      remainingUnits: Number.isFinite(item.remainingUnits) && item.remainingUnits >= 0 ? item.remainingUnits : null,
      unit: typeof item.unit === 'string' ? item.unit.replace(/[^a-zA-Z\u4e00-\u9fff]/gu, '').slice(0, 16) : ''
  }; } catch (_) { return {}; }
}

function copyItem(value, sourceId = 'codex') {
  const item = record(value);
  if (!item) return null;
  let labelValue;
  let windowMinutes;
  let remaining;
  let resetsAt;
  let pace;
  let resetLabel;
  try {
    labelValue = item.label;
    windowMinutes = item.windowMinutes;
    remaining = item.remaining;
    resetsAt = item.resetsAt;
    pace = record(item.pace);
    resetLabel = cleanLabel(item.resetLabel);
  } catch (_) {
    return null;
  }
  const label = cleanLabel(labelValue);
  if (!label || (sourceId === 'zcode' ? windowMinutes !== null && (!Number.isFinite(windowMinutes) || windowMinutes <= 0) : !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0) ||
    typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return {
    label,
    windowMinutes,
    remaining,
    ...bucketFields(item, sourceId),
    ...(Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
    ...paceFields(pace),
    ...(resetLabel ? { resetLabel } : {})
  };
}

function copyItems(value, sourceId = 'codex') {
  try {
    if (!Array.isArray(value)) return [];
  } catch (_) {
    return [];
  }
  let length;
  try { length = value.length; } catch (_) { return []; }
  const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, sourceId === 'zcode' ? 32 : 2) : 0;
  const items = [];
  for (let index = 0; index < limit; index += 1) {
    let raw;
    try { raw = value[index]; } catch (_) { continue; }
    const item = copyItem(raw, sourceId);
    if (item) items.push(item);
  }
  return items;
}

function extraCreditsFields(source, state) {
  try {
    const value = record(source.extraCredits);
    if (!value || !['balance', 'none', 'unlimited', 'unknown', 'stale'].includes(value.state)) return {};
    const balance = typeof value.balance === 'string' && value.balance.length <= 128 &&
      /^\d+(?:\.\d+)?$/.test(value.balance) ? value.balance : null;
    const creditState = state === 'stale' ? 'stale' : value.state === 'balance' && balance === null ? 'unknown' : value.state;
    return { extraCredits: { state: creditState,
      ...(creditState === 'balance' ? { balance } : {}),
      ...(state === 'ready' && value.usageStatus === 'blocked' ? { usageStatus: 'blocked' } : {}) } };
  } catch (_) { return {}; }
}

function numberFields(source) {
  try {
    if (source.display !== 'numbers') return {};
    const rawPeriods = source.numberPeriods;
    const periods = Array.isArray(rawPeriods) && rawPeriods.length <= 2
      ? [...new Set(rawPeriods.filter(value => ['fiveHour', 'weekly'].includes(value)))] : [];
    const colors = record(source.numberColors);
    const bodyColor = colors?.bodyColor, glowPinkColor = colors?.glowPinkColor, shape = colors?.shape;
    return { display: 'numbers', numberPeriods: periods.length ? periods : ['fiveHour'], numberColors: {
      shape: shape === 'aurora-cloud' ? 'aurora-cloud' : 'blob',
      bodyColor: typeof bodyColor === 'string' && /^#[\da-f]{6}$/i.test(bodyColor) ? bodyColor : '#EEEBE4',
      glowPinkColor: typeof glowPinkColor === 'string' && /^#[\da-f]{6}$/i.test(glowPinkColor) ? glowPinkColor : '#D05ED6'
    } };
  } catch (_) { return {}; }
}

function iconPreferenceFields(source) {
  try { const value = source.codexIconPreference; return ['app-default', 'codex-system', 'space-system'].includes(value) ? { codexIconPreference: value, ...(typeof source.codexIconDark === 'boolean' ? { codexIconDark: source.codexIconDark } : {}) } : {}; }
  catch (_) { return {}; }
}

function safeModel(value, sourceId = 'codex') {
  const source = record(value);
  if (!source) return { state: EMPTY_MODEL.state, items: [], overflow: 0 };
  let stateValue;
  try { stateValue = source.state; } catch (_) { return { state: EMPTY_MODEL.state, items: [], overflow: 0 }; }
  const state = STATES.has(stateValue) ? stateValue : 'disconnected';
  const identity = sourceId === 'zcode' ? { sourceId: 'zcode' } : iconPreferenceFields(source);
  const numbers = numberFields(source);
  if (!['ready', 'stale'].includes(state)) return { ...identity, state, items: [], overflow: 0, ...numbers };
  let rawItems;
  let overflowValue;
  let resetCreditsAvailable;
  let activity;
  try {
    rawItems = source.items;
    overflowValue = source.overflow;
    resetCreditsAvailable = source.resetCreditsAvailable;
    activity = record(source.activity);
  } catch (_) {
    return { ...identity, state, items: [], overflow: 0, ...numbers };
  }
  const overflow = Number.isSafeInteger(overflowValue) && overflowValue > 0
    ? Math.min(overflowValue, 99) : 0;
  return {
    ...identity,
    state,
    ...numbers,
    items: copyItems(rawItems, sourceId),
    overflow,
    ...(sourceId === 'zcode' ? {} : extraCreditsFields(source, state)),
    ...activityFields(activity),
    ...(sourceId !== 'zcode' && Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
      ? { resetCreditsAvailable } : {})
  };
}

function createQuotaLabelWindow({
  BrowserWindow, screen, sourceId = 'codex', getPetWindow, getObstacle = () => null, getSize = () => 'standard',
  getAppearance = () => 'system', getPresentation = () => null, getSuppressed = () => false,
  getGuardEntry = () => false,
  onError = () => {}, onLayout = () => {}, alwaysOnTop = true
}) {
  sourceId = sourceId === 'zcode' ? 'zcode' : 'codex';
  const channel = sourceId === 'zcode' ? 'pet:zcode-quota-label' : CHANNEL;
  const toggleChannel = sourceId === 'zcode' ? 'pet:zcode-quota-label-toggle' : TOGGLE_CHANNEL;
  const pointerChannel = sourceId === 'zcode' ? 'pet:zcode-quota-label-pointer' : POINTER_CHANNEL;
  let groupTransitionMode = null, groupTransitionEpoch = 0, groupResumeImmediate = false;
  let win = null;
  let ready = false;
  let requestedVisible = false;
  let currentModel = null, resetExpandedPending = false;
  let currentLayout = null;
  let topmost = Boolean(alwaysOnTop);
  let topmostRevision = 0;
  let operation = 0;
  let reporting = false;
  let silentWindow = null;
  const topmostSyncing = new Set();

  function guardEntryVisible() {
    try { return getGuardEntry() === true && currentModel?.state === 'ready' &&
      currentModel.items.length > 0 && currentModel.expanded !== true; }
    catch (error) { report(error); return false; }
  }

  function requestedSize() {
    try {
      const name = getSize() === 'compact' ? 'compact' : 'standard';
      return { name, ...quotaLabelSize(name) };
    } catch (error) {
      report(error);
      return { name: 'standard', ...quotaLabelSize('standard') };
    }
  }

  function requestedAppearance() {
    try {
      const value = getAppearance();
      return ['light', 'dark'].includes(value) ? value : 'system';
    } catch (error) {
      report(error);
      return 'system';
    }
  }

  function safeDestroy(target) {
    fade.cancel(target);
    if (!target) return;
    let destroyed = false;
    try { destroyed = typeof target.isDestroyed === 'function' && target.isDestroyed(); } catch (_) {}
    if (destroyed) return;
    try { if (typeof target.destroy === 'function') target.destroy(); } catch (_) {}
  }

  function report(error, target = null) {
    if (!error || reporting || (target && target === silentWindow)) return;
    reporting = true;
    const before = win;
    try { onError(error); } catch (_) {}
    if (win && win !== before) silentWindow = win;
    reporting = false;
  }

  const fade = createNativeWindowFade({ onError: error => { if (win) detach(win, error); else report(error); } });
  function notifyLayout() {
    try { onLayout(); } catch (error) { report(error); }
  }

  function detach(target, error = null) {
    const current = win === target;
    if (current) {
      win = null;
      ready = false;
      operation += 1;
    }
    safeDestroy(target);
    if (current) notifyLayout();
    if (current && error) report(error, target);
  }

  function health(target) {
    if (!target) return { ok: false, error: null };
    try {
      if (typeof target.isDestroyed !== 'function' || target.isDestroyed()) return { ok: false, error: null };
      const contents = target.webContents;
      if (!contents) return { ok: false, error: null };
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return { ok: false, error: null };
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function confirm(target, token, model, requireVisible = true) {
    if (win !== target || operation !== token || currentModel !== model ||
      (requireVisible && !requestedVisible)) return false;
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return false;
    }
    return win === target && operation === token && currentModel === model &&
      (!requireVisible || requestedVisible);
  }

  function conceal(target = win, token = operation, animate = false) {
    if (!target || win !== target || operation !== token) return;
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return;
    }
    if (win !== target || operation !== token) return;
    const finish = () => {
      if (win !== target || operation !== token) return;
      if (ready && currentModel) {
        try { target.webContents.send(channel, { ...currentModel, visible: false, guardEntry: guardEntryVisible(),
          ...(currentLayout?.guardSide ? { guardSide: currentLayout.guardSide, cardInset: currentLayout.cardInset, guardTargetWidth: quotaRoleTargetWidth(rolePaintWidth()) } : {}) }); }
        catch (error) { detach(target, error); return; }
        if (win !== target || operation !== token) return;
      }
    };
    try {
      target.setIgnoreMouseEvents(true, { forward: true });
      fade.hide(target, { animate: sendQuotaCardMotion(target, false, getPresentation(), animate), onHidden: finish, ...(getPresentation()?.quotaGroupAnimate ? {duration:220,easing:'group-collapse'} : {}) });
    } catch (error) { detach(target, error); return; }
    if (win !== target || operation !== token) return;
    const afterHide = health(target);
    if (!afterHide.ok) {
      detach(target, afterHide.error);
      return;
    }
    if (win !== target || operation !== token) return;
    if (win === target && operation === token) notifyLayout();
  }

  function rolePaintWidth() {
    const q = currentModel?.items?.[0]?.remaining;
    return q === 0 ? 50 : q === 100 ? 24 : Number.isFinite(q) && q > 0 && q < 100 ? 22 : null;
  }

  function visualPresentation(petBounds, area) {
    const value = getPresentation() || {};
    return { ...value, quotaSourceId: sourceId, sheepTheme: SheepTheme.resolveTheme(value.sheepTheme, new Date()),
      facing: value.facing || PetFacing.resolve(petBounds, area),
      quotaRoleWidth: rolePaintWidth() };
  }

  function petLayout() {
    try {
      const pet = getPetWindow();
      if (!pet || typeof pet.isDestroyed !== 'function' || pet.isDestroyed() ||
        typeof pet.isVisible !== 'function' || !pet.isVisible() || typeof pet.getBounds !== 'function') return null;
      const petBounds = pet.getBounds();
      const display = screen.getDisplayMatching(petBounds);
      return quotaLabelBounds(petBounds, display && display.workArea, getObstacle(),
        currentModel?.size, currentModel?.expanded === true, currentModel?.items?.length,
        visualPresentation(petBounds, display && display.workArea), Boolean(currentModel?.extraCredits), guardEntryVisible(), rolePaintWidth());
    } catch (error) {
      report(error);
      return null;
    }
  }

  function pointerBlockedByNeighbor() {
    if (!currentLayout?.guardSide || typeof screen.getCursorScreenPoint !== 'function') return false;
    const point = screen.getCursorScreenPoint();
    const contains = bounds => bounds && point.x >= bounds.x && point.y >= bounds.y &&
      point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
    const pet = getPetWindow();
    const bounds = pet && !pet.isDestroyed() ? pet.getBounds() : null;
    const area = bounds && screen.getDisplayMatching(bounds)?.workArea;
    const presentation = bounds && visualPresentation(bounds, area);
    const body = bounds && (presentation?.shape === 'new-year-sheep' && ['ring','duo','split','stages'].includes(presentation.quotaStyle) ? bounds : petVisualBounds(bounds, presentation?.shape,
      { ...presentation, quotaAnchor: true, quotaGuard: true }));
    // The role target is 48px for ordinary roles, 64px for the composite. Its transparent tail
    // can overlap a neighbor, but must never intercept that neighbor's clicks.
    return Boolean(contains(body) || contains(getObstacle()) || presentation?.quotaGroupLayout &&
      Array.isArray(presentation.quotaGroupNeighbors) && presentation.quotaGroupNeighbors.some(contains));
  }

  function present() {
    const target = win;
    const token = operation;
    const model = currentModel;
    if (!ready || !confirm(target, token, model)) return;
    if (groupTransitionMode === 'hold' || groupTransitionMode === 'masked') return;
    const presentation = getPresentation();
    // Tuck notifications can reflow siblings before their explicit hide call.
    if (getSuppressed() || presentation?.quotaGroupHidden === true ||
        presentation?.mode === 'tucked' && presentation.quotaAnimateHide === true) {
      conceal(target, token, presentation?.quotaAnimateHide === true);
      return;
    }
    if (resetExpandedPending) { resetExpandedPending=false; if(currentModel?.expanded){currentModel={...currentModel,expanded:false};return present();} }
    const layout = petLayout();
    if (!confirm(target, token, model)) return;
    if (!layout) {
      conceal(target, token);
      return;
    }
    const { x, y, width, height } = layout;
    try { target.setBounds({ x, y, width, height }, false); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    currentLayout = layout;
    try { target.webContents.send(channel, { ...model, visible: true, guardEntry: guardEntryVisible(),
      ...(layout.guardSide ? { guardSide: layout.guardSide, cardInset: layout.cardInset, guardTargetWidth: quotaRoleTargetWidth(rolePaintWidth()) } : {}) }); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    try {
      if (layout.guardSide && typeof screen.getCursorScreenPoint === 'function') {
        const cursor = screen.getCursorScreenPoint(), native = target.getBounds();
        const card = quotaLabelSize(model.size, model.expanded, model.items.length, Boolean(model.extraCredits), false, null, sourceId);
        const face = { x: native.x + layout.cardInset.x, y: native.y + layout.cardInset.y, ...card };
        const role = { x: layout.guardSide === 'left' ? face.x - 8 - quotaRoleTargetWidth(rolePaintWidth()) : face.x + card.width + 8,
          y: face.y + card.height - 44, width: quotaRoleTargetWidth(rolePaintWidth()), height: 44 };
        const inside = bounds => cursor.x >= bounds.x && cursor.y >= bounds.y &&
          cursor.x < bounds.x + bounds.width && cursor.y < bounds.y + bounds.height;
        target.setIgnoreMouseEvents(pointerBlockedByNeighbor() || (!inside(face) && !inside(role)), { forward: true });
      } else if (layout.guardSide) target.setIgnoreMouseEvents(true, { forward: true });
      else if (model.items.length > 0 || model.display === 'numbers') target.setIgnoreMouseEvents(false);
      else target.setIgnoreMouseEvents(true, { forward: true });
    } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) return;
    if (groupTransitionMode === 'stage') { fade.cancel(target); target.setIgnoreMouseEvents(true, { forward: true }); sendQuotaCardMotion(target, true, { ...presentation, quotaGroupAnimate: false }, false); target.hide(); notifyLayout(); return; }
    try { const animate=sendQuotaCardMotion(target, true, presentation, !groupResumeImmediate && (presentation?.quotaGroupAnimate === true || ['peeked', 'tucked'].includes(presentation?.mode))); if(!confirm(target,token,model))return; fade.show(target, animate); } catch (error) { detach(target, error); return; }
    if (!confirm(target, token, model)) {
      if (win === target && !requestedVisible) conceal(target, operation);
      return;
    }
    if (silentWindow === target) silentWindow = null;
    notifyLayout();
  }

  function syncTopmost(target) {
    if (!target || win !== target) return false;
    if (topmostSyncing.has(target)) return true;
    topmostSyncing.add(target);
    try {
      for (let attempt = 0; attempt < MAX_TOPMOST_SYNC_ATTEMPTS; attempt += 1) {
        if (win !== target) return false;
        const revision = topmostRevision;
        const enabled = topmost;
        const status = health(target);
        if (!status.ok) {
          detach(target, status.error);
          return false;
        }
        if (win !== target) return false;
        if (topmostRevision !== revision) continue;
        try { target.setAlwaysOnTop(enabled, 'floating'); }
        catch (error) {
          detach(target, error);
          return false;
        }
        if (win !== target) return false;
        const afterApply = health(target);
        if (!afterApply.ok) {
          detach(target, afterApply.error);
          return false;
        }
        if (win !== target) return false;
        if (topmostRevision === revision) return true;
      }
      detach(target, new Error('额度标签置顶设置持续重入'));
      return false;
    } finally {
      topmostSyncing.delete(target);
    }
  }

  function setupStep(target, callback) {
    try { callback(); } catch (error) { detach(target, error); return false; }
    if (win !== target) {
      detach(target);
      return false;
    }
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return false;
    }
    return win === target;
  }

  function ensureWindow() {
    const entryToken = operation;
    const entryWindow = win;
    if (entryWindow) {
      const currentWindow = entryWindow;
      const currentStatus = health(currentWindow);
      if (operation !== entryToken || win !== currentWindow) return;
      if (currentStatus.ok) return;
      const beforeDetach = operation;
      detach(currentWindow, currentStatus.error);
      if (win || operation !== beforeDetach + 1) return;
    }
    const constructToken = operation;
    const expectedWindow = win;
    let loadingWindow = null;
    const initialSize = quotaLabelSize(currentModel?.size, currentModel?.expanded === true,
      currentModel?.items?.length, Boolean(currentModel?.extraCredits), guardEntryVisible(), rolePaintWidth(), sourceId);
    try { loadingWindow = new BrowserWindow({
      width: initialSize.width,
      height: initialSize.height,
      title: sourceId === 'zcode' ? 'ZCode 剩余额度' : 'Codex 剩余额度',
      transparent: true,
      frame: false,
      roundedCorners: false, // CSS owns the card corners, including the edge beside the role gutter.
      useContentSize: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../quota-label-preload.js'),
        ...(sourceId === 'zcode' ? { additionalArguments: ['--pet-source=zcode'] } : {}),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false
      }
    }); } catch (error) { report(error); return; }
    if (operation !== constructToken || win !== expectedWindow) {
      safeDestroy(loadingWindow);
      return;
    }
    win = loadingWindow;
    const steps = [
      () => syncTopmost(loadingWindow),
      () => loadingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }),
      () => loadingWindow.setHiddenInMissionControl(true),
      () => loadingWindow.setIgnoreMouseEvents(true, { forward: true }),
      () => loadingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' })),
      () => loadingWindow.webContents.on('will-navigate', event => {
        try { event.preventDefault(); } catch (_) {}
      }),
      () => loadingWindow.webContents.on('did-start-loading',()=>{if(win===loadingWindow){ready=false;groupTransitionEpoch++;}}),
      () => loadingWindow.webContents.on('ipc-message', (event, channel, value) => {
        if (groupTransitionMode) return;
        if (channel === pointerChannel) {
          if (typeof value !== 'boolean' || win !== loadingWindow || !requestedVisible || !ready ||
            !loadingWindow.isVisible() || event?.sender !== loadingWindow.webContents ||
            event.senderFrame !== event.sender.mainFrame || event.sender.getURL() !== pathToFileURL(FILE).href) return;
          try { loadingWindow.setIgnoreMouseEvents(!value || pointerBlockedByNeighbor() || (!currentModel?.items.length && currentModel?.display !== 'numbers'), { forward: true }); }
          catch (error) { detach(loadingWindow, error); }
          return;
        }
        if (channel !== toggleChannel || win !== loadingWindow || !requestedVisible || !ready ||
          !currentModel?.items.length || currentModel.display === 'numbers') return;
        if (sourceId === 'zcode' && (event?.sender !== loadingWindow.webContents ||
          event.senderFrame !== event.sender.mainFrame || event.sender.getURL() !== pathToFileURL(FILE).href)) return;
        operation += 1;
        currentModel = { ...currentModel, expanded: currentModel.expanded !== true };
        try { present(); } catch (error) { detach(loadingWindow, error); }
      }),
      () => loadingWindow.webContents.on('render-process-gone', (_event, details) => {
        let reason = 'unknown';
        try { if (details && typeof details.reason === 'string') reason = details.reason; } catch (_) {}
        detach(loadingWindow, new Error(`额度标签渲染退出：${reason}`));
      }),
      () => loadingWindow.on('closed', () => {
        if (win !== loadingWindow) return;
        win = null;
        ready = false;
        requestedVisible = false;
        operation += 1;
        notifyLayout();
      })
    ];
    for (const step of steps) if (!setupStep(loadingWindow, step)) return;

    const markReady = () => {
      if (win !== loadingWindow || ready) return;
      const status = health(loadingWindow);
      if (!status.ok) {
        detach(loadingWindow, status.error);
        return;
      }
      if (win !== loadingWindow) return;
      ready = true;
      try { present(); } catch (error) { detach(loadingWindow, error); }
    };
    if (!setupStep(loadingWindow,
      () => loadingWindow.webContents.on('did-finish-load', markReady))) return;
    let loading;
    try { loading = loadingWindow.loadFile(FILE); }
    catch (error) { detach(loadingWindow, error); return; }
    if (win !== loadingWindow) {
      detach(loadingWindow);
      return;
    }
    Promise.resolve(loading).then(markReady).catch(error => detach(loadingWindow, error));
  }

  function hide({ animate = false } = {}) {
    groupTransitionMode = null; groupTransitionEpoch++;
    operation += 1;
    requestedVisible = false;
    if (currentModel?.expanded === true) currentModel = { ...currentModel, expanded: false };
    conceal(win, operation, animate && ['peeked', 'tucked'].includes(getPresentation()?.mode));
  }

  function destroy() {
    groupTransitionMode = null; groupTransitionEpoch++;
    operation += 1;
    requestedVisible = false;
    currentModel = null;
    const previous = win;
    win = null;
    ready = false;
    safeDestroy(previous);
    notifyLayout();
  }

  function getWindow() {
    const target = win;
    if (!target) return null;
    const status = health(target);
    if (!status.ok) {
      detach(target, status.error);
      return null;
    }
    return win === target ? target : null;
  }

  return {
    show(model) {
      operation += 1;
      const token = operation;
      const copied = safeModel(model, sourceId);
      if (operation !== token) return;
      const size = requestedSize();
      if (operation !== token) return;
      const appearance = requestedAppearance();
      if (operation !== token) return;
      const expanded = copied.display !== 'numbers' && currentModel?.display !== 'numbers' &&
        currentModel?.size === size.name && currentModel.expanded === true &&
        copied.items.length > 0;
      currentModel = { ...copied, size: size.name, appearance, expanded };
      requestedVisible = true;
      try { ensureWindow(); } catch (error) { report(error); }
      try { present(); } catch (error) { if (win) detach(win, error); else report(error); }
    },
    hide,
    reposition() {
      operation += 1;
      try { present(); } catch (error) { if (win) detach(win, error); else report(error); }
    },
    getWindow,
    setGroupTransitionMode(mode) {
      if (![null,'hold','stage','masked'].includes(mode) || mode===groupTransitionMode) return;
      groupTransitionMode=mode; groupTransitionEpoch++;
      const target=getWindow();
      if(target){fade.cancel(target);target.setIgnoreMouseEvents(true,{forward:true});if(mode==='stage'||mode==='masked')target.hide();}
      groupResumeImmediate=mode===null;try{if(mode===null||mode==='stage')present();}finally{groupResumeImmediate=false;}
    },
    captureGroupTransitionFrames() {
      const stageAvailable=()=>groupTransitionMode!=='stage'||getPresentation()?.quotaGroupHidden!==true;
      if(!stageAvailable())return Promise.reject(new Error('Quota group stage has no visible layout'));
      const epoch=groupTransitionEpoch,target=win;
      return captureQuotaGroupFrames({getTargets:()=>[target],isReady:()=>ready&&requestedVisible&&win===target&&Boolean(target),isCurrent:()=>stageAvailable()&&groupTransitionEpoch===epoch&&win===target});
    },
    resetExpanded() { resetExpandedPending=true; },
    getLayoutMetrics() {
      const target=getWindow();
      if (!requestedVisible || !target || getSuppressed() || !currentModel?.items.length || currentModel.display === 'numbers') return null;
      return { ...quotaLabelSize(currentModel.size,!resetExpandedPending&&currentModel.expanded,currentModel.items.length,Boolean(currentModel.extraCredits),false,null,sourceId),
        inset: currentModel.size==='compact'&&(resetExpandedPending||!currentModel.expanded)?2:0,
        guardTargetWidth: guardEntryVisible()?quotaRoleTargetWidth(rolePaintWidth()):0, roleWidth:rolePaintWidth() };
    },
    getVisibleBounds() {
      const target = getWindow();
      if (!target || !requestedVisible || !currentModel?.items.length || !target.isVisible() && groupTransitionMode !== 'stage') return null;
      const bounds = target.getBounds();
      const card = quotaLabelSize(currentModel.size, currentModel.expanded, currentModel.items.length,
        Boolean(currentModel.extraCredits), false, null, sourceId);
      // Use the painted card offset independently of its transparent role gutter.
      const inset = currentModel.size === 'compact' && !currentModel.expanded ? 2 : 0;
      const width = Math.min(bounds.width, card.width), height = Math.min(bounds.height, card.height);
      return { x: bounds.x + (currentLayout?.cardInset?.x || 0) + inset,
        y: bounds.y + (currentLayout?.cardInset?.y ?? bounds.height - height) + inset,
        width: width - inset * 2, height: height - inset * 2 };
    },
    setAlwaysOnTop(enabled) {
      operation += 1;
      topmost = Boolean(enabled);
      topmostRevision += 1;
      const target = win;
      if (!target) return;
      try { syncTopmost(target); }
      catch (error) { if (win === target) detach(target, error); else report(error); }
    },
    isGuardEntryVisible({ includeStaged = false } = {}) {
      // Layout priority includes staged paint; IPC callers keep actual visibility.
      return Boolean(win && !win.isDestroyed() && (win.isVisible() || (includeStaged && groupTransitionMode === 'stage')) && guardEntryVisible());
    },
    destroy
  };
}

module.exports = { createQuotaLabelWindow, safeModel };
