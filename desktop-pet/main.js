const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray
} = require('electron');
const { loadSettings, saveSettings } = require('./lib/settings');
const {
  SIZES,
  defaultBounds,
  ensureVisibleBounds
} = require('./lib/window-placement');
const {
  BOUNCE_TOTAL_MS,
  bounceOffset
} = require('./lib/window-bounce');
const { createActivityMonitor, createPowerGuard } = require('./lib/activity-monitor');
const { DialogueDirector } = require('./lib/dialogue');
const { createBubbleWindow } = require('./lib/bubble-window');
const { getMotion } = require('./lib/interaction-motion');
const CompanionMotion = require('./lib/companion-motion');
const PetFacing = require('./lib/pet-facing');
const { createThoughtWindow } = require('./lib/thought-window');
const { createWindowMotion } = require('./lib/window-motion');
const { createCodexCompanion } = require('./lib/codex-companion');
const { buildCodexMenu, buildCodexResultMenu, resolveCodexAction } = require('./lib/codex-menu');
const { buildQuotaLabelModel } = require('./lib/codex-quota-view');
const { createQuotaLabelWindow } = require('./lib/quota-label-window');
const { createEdgeTuck } = require('./lib/edge-tuck');
const { createEdgeNotice } = require('./lib/edge-notice');
const { createEdgeNoticeWindow } = require('./lib/edge-notice-window');
const { createChatStore } = require('./lib/chat-store');
const { createChatCompanion } = require('./lib/chat-companion');
const { createCodexChatRpc } = require('./lib/codex-chat-rpc');
const { createChatWindow } = require('./lib/chat-window');
const { createNotesCompanion } = require('./lib/notes-companion');
const { createNotesOrganizer } = require('./lib/notes-organizer');
const { createApiUsage } = require('./lib/api-usage');
const { createApiUsageLabelWindow } = require('./lib/api-usage-label-window');
const { checkLatestRelease } = require('./lib/app-update');
const { createColorModeManager } = require('./lib/color-mode');
const { normalizeCustomization, effectiveAppearance } = require('./lib/customization');

const APP_NAME = '球球桌宠';
const APP_WEBSITE = 'https://qiuqiu.pet/';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IS_SMOKE_TEST = process.env.PET_SMOKE_TEST === '1';
const IS_CODEX_SMOKE_ONLY = IS_SMOKE_TEST && process.env.PET_SMOKE_CODEX_ONLY === '1';

let petWindow = null;
let edgeTuck = null;
let edgeNotice = null;
let edgeNoticeWindow = null;
let edgeNoticeNow = () => performance.now();
let lastEdgeNoticeTick = -Infinity;
let petMenuToken = 0;
let tray = null;
let settings = null;
let settingsFile = null;
let dragState = null;
let bounceState = null;
let isQuitting = false;
let activityMonitor = null;
let dialogue = null;
let bubble = null;
let thoughts = null;
let bubbleVisibilityBinding = null;
let quotaLabel = null;
let chat = null;
let chatWindow = null;
let notesCompanion = null;
let notesQuitReady = false;
let notesQuitFlight = null;
let customizationWindow = null;
let apiUsage = null;
let apiUsageWindow = null;
let apiUsageLabel = null;
let apiRefreshTimer = null;
let apiLastAttemptAt = -Infinity;
let updateTimer = null;
let updateCheck = null;
let updateCheckManual = false;
let lastUpdateCheckAt = -Infinity;
let lastUpdateResult = null;
let availableUpdate = null;
let aboutWindow = null;
let aboutReady = false;
let aboutUpdateState = { state: 'idle' };
const API_REFRESH_MS = 5 * 60 * 1000;
let customizationPreviewAppearance = null;
let screenLocked = false;
let codexCompanion = null;
let codexNow = Date.now;
let codexConsentFlight = null;
let codexConsentToken = 0;
let codexPresentation = null;
let codexRenderer = null;
let codexPageReady = false;
let codexPageEpoch = 0;
let codexSentSettings = null;
let codexNotice = null;
let codexPreferenceWarning = null;
let hostMotion = null;
let quotaSyncing = false;
let quotaSyncPending = false;
let quotaSyncSnapshot = null;
let bubbleDestroying = false;
let petWindowCreationRevision = 0;
let quitCleanupStarted = false;
let quitReady = false;
const windowMotion = createWindowMotion({
  getWindow: () => petWindow,
  getWorkArea: bounds => screen.getDisplayMatching(bounds).workArea,
  getDisplayId: bounds => screen.getDisplayMatching(bounds).id,
  now: () => performance.now(), schedule: setTimeout, cancel: clearTimeout,
  sendFrame: packet => {
    if (packet.frame.done && hostMotion?.token === packet.token) hostMotion = null;
    petWindow.webContents.send('pet:motion-frame', packet);
  }
});

app.setName(APP_NAME);
const colorModes = createColorModeManager({ getMode: () => settings?.colorMode,
  getAppearance: () => settings?.codexQuotaAppearance });
app.on('browser-window-created', (_event, win) => colorModes.track(win));

function writeError(scope, error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  const line = `[${new Date().toISOString()}] ${scope}: ${message}\n`;
  process.stderr.write(line);
  try {
    const logFile = path.join(app.getPath('userData'), 'errors.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (logError) {
    process.stderr.write(`无法写入错误日志: ${logError.message}\n`);
  }
}

function validPoint(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: Math.round(value.x), y: Math.round(value.y) };
}

function fromPetWindow(event) {
  return Boolean(
    petWindow &&
    !petWindow.isDestroyed() &&
    event.sender === petWindow.webContents
  );
}

function presentationSuppressed() {
  return edgeTuck?.getPresentation().suppressed === true;
}

function fromChatWindow(event) {
  const win = chatWindow?.getWindow();
  return Boolean(!isQuitting && win && !win.isDestroyed() && event.sender === win.webContents);
}

function fromCustomizationWindow(event) {
  return Boolean(!isQuitting && customizationWindow && !customizationWindow.isDestroyed() &&
    event.sender === customizationWindow.webContents);
}

function fromApiUsageWindow(event, requireVisible = true) {
  return Boolean(!isQuitting && !screenLocked && apiUsageWindow && !apiUsageWindow.isDestroyed() &&
    (!requireVisible || apiUsageWindow.isVisible()) && event.sender === apiUsageWindow.webContents);
}

function openApiUsage() {
  if (isQuitting || screenLocked) return;
  if (apiUsageWindow && !apiUsageWindow.isDestroyed()) {
    apiUsageWindow.show();
    apiUsageWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 620, height: 700, minWidth: 460, minHeight: 520,
    title: 'OpenAI API 费用与用量', backgroundColor: '#F6F4EF', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'api-usage-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged
    }
  });
  apiUsageWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { if (apiUsageWindow === win) apiUsageWindow = null; });
  win.once('ready-to-show', () => { if (!win.isDestroyed() && !screenLocked) win.show(); });
  void win.loadFile(path.join(__dirname, 'api-usage.html')).catch(error => writeError('API 费用面板', error));
}

function fromAboutWindow(event, requireVisible = false) {
  return Boolean(!isQuitting && !screenLocked && aboutWindow && !aboutWindow.isDestroyed() &&
    (!requireVisible || aboutWindow.isVisible()) && event.sender === aboutWindow.webContents);
}

function openAbout() {
  if (isQuitting || screenLocked) return;
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutReady) { aboutWindow.show(); aboutWindow.focus(); }
    return aboutWindow;
  }
  const win = new BrowserWindow({
    width: 360, height: 480, resizable: false, maximizable: false, fullscreenable: false,
    title: '关于球球', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#EDF4FF', show: false,
    webPreferences: { preload: path.join(__dirname, 'about-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged }
  });
  aboutWindow = win;
  aboutReady = false;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { if (aboutWindow === win) { aboutWindow = null; aboutReady = false; } });
  win.once('ready-to-show', () => {
    if (aboutWindow !== win || win.isDestroyed()) return;
    aboutReady = true;
    if (!isQuitting && !screenLocked) { win.show(); win.focus(); }
  });
  void win.loadFile(path.join(__dirname, 'about.html')).catch(error => {
    writeError('关于球球', error);
    if (!win.isDestroyed()) win.destroy();
  });
  return win;
}

function setAboutUpdate(state) {
  aboutUpdateState = state;
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.webContents.send('pet:about-update-state', state);
}

function chatSnapshot(state = chat?.getState()) {
  return { ...state, appUpdate: availableUpdate ? { latestVersion: availableUpdate.latestVersion } : null };
}

async function showUpdateResult(result) {
  setAboutUpdate({ state: 'ready', currentVersion: result.currentVersion,
    latestVersion: result.latestVersion, hasUpdate: result.hasUpdate });
  const win = openAbout();
  if (!win) return false;
  if (!win.isVisible()) await new Promise(resolve => {
    const done = () => { win.removeListener('ready-to-show', done); win.removeListener('closed', done); resolve(); };
    win.once('ready-to-show', done);
    win.once('closed', done);
  });
  return !isQuitting && !screenLocked && !win.isDestroyed() && win.isVisible();
}

function showUpdateBubble(result) {
  if (isQuitting || screenLocked || chatWindow?.isVisible() || presentationSuppressed() ||
    !petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || dragState || hostMotion || bounceState) return false;
  const payload = dialogue?.offerUpdate(result.latestVersion, performance.now());
  return Boolean(payload && showBubble(payload));
}

function checkForUpdates(manual = false) {
  if (isQuitting || screenLocked || (!manual && settings?.autoUpdateCheck === false)) return Promise.resolve();
  if (updateCheck) {
    if (manual) { updateCheckManual = true; openAbout(); if (!lastUpdateResult) setAboutUpdate({ state: 'checking' }); }
    return updateCheck;
  }
  if (manual) { openAbout(); setAboutUpdate({ state: 'checking' }); }
  const cached = Date.now() - lastUpdateCheckAt < 60000 ? lastUpdateResult : null;
  if (!cached && Date.now() - lastUpdateCheckAt < 60000) {
    if (manual) setAboutUpdate({ state: 'error', message: '刚刚检查过更新，请稍等一分钟后再试。' });
    updateCheckManual = false;
    return Promise.resolve();
  }
  updateCheckManual = manual;
  if (!cached) { lastUpdateCheckAt = Date.now(); lastUpdateResult = null; }
  updateCheck = Promise.resolve().then(() => cached || checkLatestRelease(app.getVersion(),
    IS_SMOKE_TEST && process.env.PET_SMOKE_CHAT_ONLY === '1'
      ? { get: require('./scripts/verify-chat-integration').getSmokeRelease } : undefined)).then(async result => {
    lastUpdateResult = result;
    if (isQuitting || screenLocked) return;
    availableUpdate = result.hasUpdate ? result : null;
    chatWindow?.update(chatSnapshot());
    if (updateCheckManual) await showUpdateResult(result);
    else if (settings.autoUpdateCheck !== false && result.hasUpdate &&
      settings.lastUpdateNotifiedVersion !== result.latestVersion) {
      const shown = chatWindow?.isVisible() || showUpdateBubble(result) || await showUpdateResult(result);
      if (shown && settings.autoUpdateCheck !== false && !isQuitting) {
        settings.lastUpdateNotifiedVersion = result.latestVersion;
        persistSettings();
      }
    }
    if (!isQuitting && !screenLocked && (aboutUpdateState.latestVersion !== result.latestVersion ||
      aboutUpdateState.hasUpdate !== result.hasUpdate)) {
      setAboutUpdate({ state: 'ready', currentVersion: result.currentVersion,
        latestVersion: result.latestVersion, hasUpdate: result.hasUpdate });
    }
  }).catch(async () => {
    if (updateCheckManual && !isQuitting && !screenLocked)
      setAboutUpdate({ state: 'error', message: '暂时无法检查更新，请检查网络后重试。' });
  }).finally(() => {
    updateCheck = null; updateCheckManual = false;
    if (!isQuitting) {
      if (aboutUpdateState.state === 'checking') setAboutUpdate({ state: 'idle' });
      refreshTrayMenu();
    }
  });
  refreshTrayMenu();
  return updateCheck;
}

function scheduleUpdateCheck(delay = 30000) {
  clearTimeout(updateTimer);
  updateTimer = null;
  if (isQuitting || !app.isPackaged || IS_SMOKE_TEST || settings?.autoUpdateCheck === false) return;
  updateTimer = setTimeout(() => {
    updateTimer = null;
    void checkForUpdates().finally(() => scheduleUpdateCheck(UPDATE_INTERVAL_MS));
  }, delay);
}

function setAutoUpdateCheck(value) {
  const previous = settings.autoUpdateCheck;
  settings.autoUpdateCheck = Boolean(value);
  try { persistSettings(); }
  catch (error) { settings.autoUpdateCheck = previous; writeError('保存更新提醒', error); }
  scheduleUpdateCheck();
  refreshTrayMenu();
}

function openCustomization() {
  if (isQuitting || screenLocked) return;
  if (customizationWindow && !customizationWindow.isDestroyed()) {
    customizationWindow.show();
    customizationWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 960, height: 700, minWidth: 760, minHeight: 580,
    title: '定制球球', backgroundColor: '#F6F4EF', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'customize-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged
    }
  });
  customizationWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-fail-load', (_event, code, description) => writeError('定制面板加载', `${code} ${description}`));
  win.on('closed', () => {
    if (customizationWindow !== win) return;
    customizationWindow = null;
    customizationPreviewAppearance = null;
    chatWindow?.syncAppearance();
  });
  win.once('ready-to-show', () => { if (!win.isDestroyed() && !screenLocked) win.show(); });
  void win.loadFile(path.join(__dirname, 'customize.html')).catch(error => writeError('定制面板', error));
}

function effectiveCustomization(value) {
  const customization = normalizeCustomization(value);
  return { ...customization,
    appearance: effectiveAppearance(customization.appearance) };
}

function saveCustomization(value, setAsStartupDefault = true) {
  if (!settings || isQuitting) return false;
  const previous = settings;
  const customization = effectiveCustomization(value);
  settings = { ...settings, customization,
    startupAppearance: setAsStartupDefault ? customization.appearance : settings.startupAppearance };
  try { persistSettings(); }
  catch (error) {
    settings = previous;
    writeError('保存球球定制', error);
    return false;
  }
  sendCompanionSettings();
  customizationPreviewAppearance = null;
  chatWindow?.syncAppearance();
  repositionQuotaLabel();
  refreshTrayMenu();
  return true;
}

function openChat() {
  if (isQuitting || screenLocked || !chat) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) restorePet();
  else if (edgeTuck?.getPresentation().side) edgeTuck.restore();
  stopMotion();
  dismissCodexPresentation();
  dialogue?.dismiss();
  hideBubble();
  thoughts?.hide();
  quotaLabel?.hide();
  apiUsageLabel?.hide();
  edgeNoticeWindow?.hide();
  chatWindow.show(chatSnapshot());
  // Opening checks login and shows local history; only send() can create a thread.
  void chat.connect().catch(() => {});
}

function performChatAction(action) {
  if (isQuitting || screenLocked || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  if (action === 'dockLeft' || action === 'dockRight') { dockPet(action === 'dockLeft' ? 'left' : 'right'); return; }
  if (action === 'restore') { restorePet(); return; }
  if (action === 'sleep' || action === 'wake') { restorePet(); sendCommand(action); return; }
  if (['hop', 'jelly', 'sway', 'peek', 'bow', 'spin'].includes(action)) {
    restorePet();
    sendCommand('wake');
    sendCommand({ command: 'again', motion: action });
  }
}

function sendPresentation(packet) {
  if (!petWindow || petWindow.isDestroyed()) return;
  try { petWindow.webContents.send('pet:presentation', packet); } catch (_) {}
}

function tickEdgeNotice(force = false) {
  const now = edgeNoticeNow();
  if (!force && now - lastEdgeNoticeTick < 500) return;
  lastEdgeNoticeTick = now;
  const presentation = edgeTuck?.getPresentation();
  const visible = Boolean(!isQuitting && !chatWindow?.isVisible() && codexPageReady && petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  const quotaEnabled = settings?.codexEnabled === true && settings.codexQuotaAlwaysVisible === true;
  edgeNotice?.tick({ presentation, visible, locked: screenLocked,
    bubblesEnabled: settings?.bubblesEnabled === true, quotaEnabled,
    appearance: settings?.codexQuotaAppearance,
    quotaModel: visible && quotaEnabled && presentation?.mode === 'tucked'
      ? buildQuotaLabelModel(codexCompanion?.getSnapshot(), { period: settings.codexQuotaPeriod, size: 'compact',
        showExtraCredits: settings.codexShowExtraCredits }, codexNow()) : null
  });
}

function applyPresentation(packet) {
  sendPresentation(packet);
  if (packet.suppressed) {
    stopMotion();
    dialogue?.dismiss();
    hideBubble();
    safelyInvokeWindow('收起时额度标签隐藏', () => quotaLabel?.hide());
    safelyInvokeWindow('收起时 API 卡片隐藏', () => apiUsageLabel?.hide());
  } else syncQuotaLabel(codexCompanion?.getSnapshot());
  tickEdgeNotice(true);
  refreshTrayMenu();
}

function edgeRetentionBounds() {
  return [bubble, quotaLabel, apiUsageLabel, chatWindow].flatMap(controller => {
    try {
      const win = controller?.getWindow();
      return win && !win.isDestroyed() && win.isVisible() ? [win.getBounds()] : [];
    } catch (_) { return []; }
  });
}

function dockPet(side) {
  if (!petWindow || petWindow.isDestroyed() || screenLocked) return;
  dragState = null;
  stopMotion();
  edgeTuck?.dock(side);
  petWindow.showInactive();
  persistWindowPosition();
}

function restorePet() {
  if (!petWindow || petWindow.isDestroyed()) { createPetWindow(); return; }
  dragState = null;
  stopMotion();
  edgeTuck?.restore();
  makeWindowVisible();
  petWindow.showInactive();
  petWindow.moveTop();
  syncQuotaLabel(codexCompanion?.getSnapshot());
  refreshTrayMenu();
}

function hidePet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  chatWindow?.hide();
  dragState = null;
  edgeTuck?.hide();
  petWindow.hide();
}

function codexHostAvailable() {
  return codexPageReady && !isQuitting && !screenLocked && !chatWindow?.isVisible() && !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible() &&
    !dragState && !bounceState && !hostMotion && !dialogue?.hasBubble(performance.now());
}

function canPresentCodex() {
  return Boolean(settings?.codexEnabled && codexHostAvailable() && codexRenderer?.available === true &&
    codexRenderer.generation === codexCompanion?.getSnapshot().generation && codexRenderer.pageEpoch === codexPageEpoch);
}

function sendCodexCommand(command) {
  if (!petWindow || petWindow.isDestroyed()) return;
  try { petWindow.webContents.send('pet:command', command); } catch (_) { /* 关闭期间不再展示。 */ }
}

function clearCodexPresentation() {
  const previous = codexPresentation;
  codexPresentation = null;
  if (hostMotion?.owner === 'codex') {
    windowMotion.stop();
    hostMotion = null;
  }
  if (previous) sendCodexCommand({ command: 'codex-cancel', alertId: previous.id,
    generation: previous.generation, pageEpoch: previous.pageEpoch, ...(previous.token ? { token: previous.token } : {}) });
  if (dialogue?.dismissCodex()) hideBubble();
}

function quotaObstacleBounds() {
  try {
    const win = bubble?.getWindow();
    if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed() ||
      typeof win.isVisible !== 'function' || !win.isVisible() || typeof win.getBounds !== 'function') return null;
    const bounds = win.getBounds();
    return bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) && bounds.width > 0 && Number.isFinite(bounds.height) && bounds.height > 0
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  } catch (_) {
    return null;
  }
}

function reportQuotaError(scope, error) {
  try { writeError(scope, error); } catch (_) { /* 关闭期间错误记录不得影响生命周期。 */ }
}

function safelyInvokeWindow(scope, callback) {
  try {
    callback();
    return true;
  } catch (error) {
    reportQuotaError(scope, error);
    return false;
  }
}

function repositionQuotaLabel() {
  try { quotaLabel?.reposition(); } catch (error) { reportQuotaError('额度标签重排', error); }
  safelyInvokeWindow('API 卡片重排', () => apiUsageLabel?.reposition());
}

function syncApiUsageLabel() {
  if (!apiUsage || !apiUsageLabel) return;
  const state = apiUsage.getState();
  const enabled = !isQuitting && settings?.openaiApiAlwaysVisible === true;
  const visible = enabled && !screenLocked && !chatWindow?.isVisible() && !presentationSuppressed() &&
    petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
  safelyInvokeWindow('API 卡片同步', () => visible ? apiUsageLabel.show(state) : apiUsageLabel.hide());
  if (!enabled || !state.connected) {
    clearTimeout(apiRefreshTimer);
    apiRefreshTimer = null;
    return;
  }
  if (!apiRefreshTimer) apiRefreshTimer = setTimeout(() => {
    apiRefreshTimer = null;
    syncApiUsageLabel();
  }, API_REFRESH_MS);
  if (visible && !state.busy && Date.now() - Math.max(apiLastAttemptAt, state.report?.updatedAt || 0) >= API_REFRESH_MS) {
    apiLastAttemptAt = Date.now();
    void apiUsage.refresh();
  }
}

function setApiUsageVisible(value) {
  const previous = settings.openaiApiAlwaysVisible;
  settings.openaiApiAlwaysVisible = Boolean(value);
  try { persistSettings(); }
  catch (error) {
    settings.openaiApiAlwaysVisible = previous;
    writeError('保存 API 常驻显示', error);
  }
  syncApiUsageLabel();
  refreshTrayMenu();
}

function detachBubbleVisibilityEvents(expected = null) {
  const binding = bubbleVisibilityBinding;
  if (!binding || (expected && binding !== expected)) return;
  bubbleVisibilityBinding = null;
  try {
    if (typeof binding.win.removeListener === 'function') {
      binding.win.removeListener('show', binding.onVisibility);
      binding.win.removeListener('hide', binding.onVisibility);
      binding.win.removeListener('closed', binding.onClosed);
    }
  } catch (error) {
    reportQuotaError('气泡可见性解绑', error);
  }
}

function bindBubbleVisibilityEvents() {
  let win;
  try {
    win = bubble?.getWindow();
    if (!win || typeof win.on !== 'function' || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return;
  } catch (error) {
    reportQuotaError('气泡可见性绑定', error);
    return;
  }
  if (bubbleVisibilityBinding?.win === win) return;
  detachBubbleVisibilityEvents();
  const binding = { win, onVisibility: null, onClosed: null };
  binding.onVisibility = () => {
    if (bubbleVisibilityBinding !== binding) return;
    try {
      if (bubble?.getWindow() !== win) return;
    } catch (_) {
      return;
    }
    repositionQuotaLabel();
    thoughts?.reposition();
  };
  binding.onClosed = () => {
    if (bubbleVisibilityBinding !== binding) return;
    detachBubbleVisibilityEvents(binding);
    try {
      const current = bubble?.getWindow();
      if (current && current !== win) return;
    } catch (_) {
      return;
    }
    repositionQuotaLabel();
  };
  bubbleVisibilityBinding = binding;
  try {
    win.on('show', binding.onVisibility);
    win.on('hide', binding.onVisibility);
    win.on('closed', binding.onClosed);
  } catch (error) {
    detachBubbleVisibilityEvents(binding);
    reportQuotaError('气泡可见性绑定', error);
  }
}

function showBubble(payload) {
  if (!payload || presentationSuppressed() || chatWindow?.isVisible()) return false;
  const shown = safelyInvokeWindow('气泡显示', () => bubble?.show(payload));
  if (shown) bindBubbleVisibilityEvents();
  repositionQuotaLabel();
  Promise.resolve().then(repositionQuotaLabel);
  return shown;
}

function hideBubble() {
  safelyInvokeWindow('气泡隐藏', () => bubble?.hide());
  repositionQuotaLabel();
}

function repositionBubble() {
  safelyInvokeWindow('气泡重排', () => bubble?.reposition());
  safelyInvokeWindow('聊天面板重排', () => chatWindow?.reposition());
  repositionQuotaLabel();
}

function destroyBubbleSafely() {
  if (bubbleDestroying) return false;
  bubbleDestroying = true;
  try {
    detachBubbleVisibilityEvents();
    return safelyInvokeWindow('气泡销毁', () => bubble?.destroy());
  } finally {
    bubbleDestroying = false;
  }
}

function syncQuotaLabel(snapshot = null) {
  tickEdgeNotice(true);
  quotaSyncPending = true;
  quotaSyncSnapshot = snapshot;
  if (quotaSyncing || !quotaLabel) return false;
  quotaSyncing = true;
  let shown = false;
  let attempts = 0;
  try {
    while (quotaSyncPending && attempts++ < 8) {
      quotaSyncPending = false;
      const requestedSnapshot = quotaSyncSnapshot;
      quotaSyncSnapshot = null;
      let visible = false;
      try {
        visible = !isQuitting && settings?.codexEnabled === true && settings.codexQuotaAlwaysVisible === true &&
          !screenLocked && !chatWindow?.isVisible() && !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
      } catch (error) {
        reportQuotaError('额度标签状态', error);
      }
      if (!visible) {
        shown = false;
        try { quotaLabel.hide(); } catch (error) { reportQuotaError('额度标签隐藏', error); }
        continue;
      }
      try {
        const current = requestedSnapshot || codexCompanion?.getSnapshot();
        quotaLabel.show(buildQuotaLabelModel(current, {
          period: settings.codexQuotaPeriod,
          size: settings.codexQuotaLabelSize,
          showExtraCredits: settings.codexShowExtraCredits
        }, codexNow()));
        shown = true;
      } catch (error) {
        shown = false;
        reportQuotaError('额度标签同步', error);
        try { quotaLabel.hide(); } catch (_) {}
      }
    }
    if (quotaSyncPending) {
      quotaSyncPending = false;
      quotaSyncSnapshot = null;
      shown = false;
      try { quotaLabel.hide(); } catch (_) {}
      reportQuotaError('额度标签同步', new Error('额度标签状态持续重入'));
    }
    return shown;
  } finally {
    quotaSyncing = false;
    syncApiUsageLabel();
  }
}

function dismissCodexPresentation() {
  const alert = codexCompanion?.getSnapshot().currentAlert;
  if (!alert || !codexCompanion.dismiss(alert.id, alert.generation)) clearCodexPresentation();
}

function invalidateCodexPage() {
  edgeNotice?.reset();
  thoughts?.hide();
  codexPageEpoch++;
  codexPageReady = false;
  codexRenderer = null;
  dismissCodexPresentation();
}

function syncCodexSettings(snapshot, force = false) {
  if (!snapshot) return;
  const activeTaskCount = snapshot.enabled === true && Array.isArray(snapshot.tasks?.items)
    ? snapshot.tasks.items.filter(task => task?.state === 'active').length
    : 0;
  const next = { enabled: snapshot.enabled, generation: snapshot.generation,
    pageEpoch: codexPageEpoch, activeTaskCount };
  if (!next.enabled || activeTaskCount === 0) thoughts?.hide();
  if (codexNotice?.generation !== next.generation) codexNotice = null;
  // 导航清理会同步触发状态更新；新页面代次只能在新页面 ready 后发送。
  if (!codexPageReady || !petWindow || petWindow.isDestroyed()) return;
  if (!force && codexSentSettings?.enabled === next.enabled && codexSentSettings?.generation === next.generation &&
    codexSentSettings?.pageEpoch === next.pageEpoch && codexSentSettings?.activeTaskCount === next.activeTaskCount) return;
  const connectionChanged = !codexSentSettings || codexSentSettings.enabled !== next.enabled ||
    codexSentSettings.generation !== next.generation || codexSentSettings.pageEpoch !== next.pageEpoch;
  if (connectionChanged) codexRenderer = null;
  codexSentSettings = next;
  petWindow.webContents.send('pet:codex-settings', next);
}

function presentCodexAlert(alert) {
  const current = codexCompanion?.getSnapshot().currentAlert;
  if (!canPresentCodex() || current?.id !== alert.id || current.generation !== alert.generation) return;
  codexPresentation = { ...current, pageEpoch: codexPageEpoch };
  sendCodexCommand({ command: 'codex', alertId: current.id, generation: current.generation, pageEpoch: codexPageEpoch, motion: current.motion });
}

function initializeCodexCompanion(options = {}) {
  codexCompanion?.close();
  codexNow = options.now || Date.now;
  codexSentSettings = null;
  codexCompanion = createCodexCompanion({ ...options, now: codexNow, schedule: options.schedule || setTimeout,
    ignoreTask: id => chat?.ownsThread(id) === true,
    ignoreThread: row => typeof row?.cwd === 'string' && row.cwd.length > 0 &&
      path.resolve(row.cwd) === path.join(app.getPath('userData'), 'chat-workspace'),
    cancel: options.cancel || clearTimeout, canPresent: canPresentCodex, onAlert: presentCodexAlert,
    onAlertUpdate: alert => {
      const payload = dialogue?.updateCodex(alert, performance.now());
      if (payload) showBubble(payload);
    },
    onClear: clearCodexPresentation,
    onChange: snapshot => { syncCodexSettings(snapshot); syncQuotaLabel(snapshot); refreshTrayMenu(); }
  });
  codexCompanion.setPreferences({
    taskNameInAlerts: settings?.codexTaskNameInAlerts === true,
    quotaAlwaysVisible: settings?.codexQuotaAlwaysVisible === true,
    quotaPeriod: settings?.codexQuotaPeriod
  });
}

function setCodexPreference(name, value) {
  if (!settings || settings.codexEnabled !== true || !codexCompanion || isQuitting) return false;
  const allowed = new Set([
    'codexTaskNameInAlerts', 'codexQuotaAlwaysVisible', 'codexQuotaPeriod', 'codexQuotaLabelSize',
    'codexQuotaAppearance', 'codexShowExtraCredits'
  ]);
  if (!allowed.has(name)) return false;
  const previous = settings[name];
  let next;
  if (name === 'codexQuotaPeriod') {
    next = ['auto', 'fiveHour', 'weekly'].includes(value) ? value : previous;
  } else if (name === 'codexQuotaLabelSize') {
    next = ['standard', 'compact'].includes(value) ? value : previous;
  } else if (name === 'codexQuotaAppearance') {
    next = ['system', 'light', 'dark'].includes(value) ? value : previous;
  } else {
    next = Boolean(value);
  }
  if (previous === next) return false;
  settings[name] = next;
  try { persistSettings(); }
  catch (_) {
    settings[name] = previous;
    refreshTrayMenu();
    return false;
  }
  codexCompanion.setPreferences({
    taskNameInAlerts: settings.codexTaskNameInAlerts,
    quotaAlwaysVisible: settings.codexQuotaAlwaysVisible,
    quotaPeriod: settings.codexQuotaPeriod
  });
  syncQuotaLabel(codexCompanion.getSnapshot());
  if (name === 'codexQuotaAppearance') colorModes.sync();
  refreshTrayMenu();
  return true;
}

function setCodexTaskNameInAlerts(enabled) {
  return setCodexPreference('codexTaskNameInAlerts', enabled);
}

async function setCodexEnabled(enabled) {
  if (!codexCompanion || isQuitting) return false;
  if (enabled !== true) {
    codexConsentToken++;
    const changed = settings.codexEnabled === true;
    settings.codexEnabled = false;
    if (changed) {
      try { quotaLabel?.destroy(); } catch (error) { reportQuotaError('额度标签销毁', error); }
    }
    // 停止读取不依赖磁盘写入成功；保存失败也必须先释放连接和计时器。
    await codexCompanion.setEnabled(false);
    syncQuotaLabel(codexCompanion.getSnapshot());
    if (changed) {
      try { persistSettings(); codexPreferenceWarning = null; }
      catch (_) { codexPreferenceWarning = '联动已关闭，但未保存；重启可能恢复开启'; }
    }
    refreshTrayMenu();
    return true;
  }
  if (settings.codexEnabled || codexConsentFlight) return false;
  const token = ++codexConsentToken;
  const flight = {};
  codexConsentFlight = flight;
  try {
    const result = await dialog.showMessageBox({
      type: 'info', title: '开启 Codex 联动？', message: '让球球提醒 Codex 额度与任务进展',
      detail: '开启后，仅在本机读取 Codex 的额度与任务状态。状态包可能附带已加载的聊天内容；球球只提取进展，正文立即丢弃，不保存、不上传。\n不监听键盘，也不会代你创建、发送、审批或中断任务。随时关闭即可停止读取。',
      buttons: ['开启联动', '暂不开启'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (result.response !== 0 || token !== codexConsentToken || isQuitting) return false;
    settings.codexEnabled = true;
    try { persistSettings(); codexPreferenceWarning = null; }
    catch (_) {
      settings.codexEnabled = false;
      codexPreferenceWarning = '未能保存设置，Codex 联动仍保持关闭';
      return false;
    }
    await codexCompanion.setEnabled(true);
    syncQuotaLabel(codexCompanion.getSnapshot());
    return true;
  } catch (_) {
    // 不记录来自系统或 Codex 的原始错误内容。
    return false;
  } finally {
    if (codexConsentFlight === flight) codexConsentFlight = null;
    refreshTrayMenu();
  }
}

function bindCodexMenu(items) {
  return items.map(({ action, submenu, ...item }) => ({ ...item,
    ...(submenu ? { submenu: bindCodexMenu(submenu) } : {}),
    ...(action ? { click: () => routeCodexAction(action) } : {})
  }));
}

async function routeCodexAction(descriptor) {
  const snapshot = codexCompanion?.getSnapshot();
  const action = resolveCodexAction(snapshot, descriptor, codexNow());
  if (!action || isQuitting) return false;
  if (action.type === 'refresh') { await codexCompanion.refresh(); return true; }
  if (action.type === 'dismiss') return codexCompanion.dismiss(action.alertId, descriptor.generation);
  if (action.type === 'show-results') {
    const items = buildCodexResultMenu(snapshot, action.alertId, codexNow());
    return items.length > 0 && popupPetMenu(bindCodexMenu(items));
  }
  if (descriptor.scope === 'alert') codexCompanion.dismiss(descriptor.alertId, descriptor.generation);
  if (action.type === 'open-task') {
    try {
      await shell.openExternal(action.url);
      if (descriptor.scope === 'result') codexCompanion.dismiss(descriptor.alertId, descriptor.generation);
    } catch (_) {
      const current = codexCompanion?.getSnapshot();
      if (current?.enabled && current.generation === snapshot.generation) {
        codexNotice = { generation: current.generation, text: '无法打开 Codex，请确认已安装' };
        refreshTrayMenu();
      }
    }
  }
  return true;
}

function persistSettings() {
  settings = saveSettings(settingsFile, settings);
}

function setColorMode(value) {
  if (!settings || isQuitting || !['standard', 'accessible'].includes(value) || settings.colorMode === value) return false;
  const previous = settings.colorMode;
  settings.colorMode = value;
  try { persistSettings(); }
  catch (error) {
    settings.colorMode = previous;
    writeError('保存界面配色', error);
    refreshTrayMenu();
    return false;
  }
  colorModes.sync();
  refreshTrayMenu();
  return true;
}

function setNotesDefaultTab(value) {
  if (!settings || isQuitting || !['note', 'todo'].includes(value) || settings.notesDefaultTab === value) return false;
  const previous = settings.notesDefaultTab;
  settings.notesDefaultTab = value;
  try { persistSettings(); }
  catch (error) {
    settings.notesDefaultTab = previous;
    writeError('保存便签待办默认页面', error);
    refreshTrayMenu();
    return false;
  }
  refreshTrayMenu();
  return true;
}

function setInterfaceAppearance(value) {
  if (!settings || isQuitting || settings.colorMode !== 'accessible' ||
    !['system', 'light', 'dark'].includes(value) || settings.codexQuotaAppearance === value) return false;
  const previous = settings.codexQuotaAppearance;
  settings.codexQuotaAppearance = value;
  try { persistSettings(); }
  catch (error) {
    settings.codexQuotaAppearance = previous;
    writeError('保存界面外观', error);
    refreshTrayMenu();
    return false;
  }
  colorModes.sync();
  syncQuotaLabel(codexCompanion?.getSnapshot());
  refreshTrayMenu();
  return true;
}

function persistWindowPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = ensureVisibleBounds(petWindow.getBounds(), screen.getAllDisplays(), screen.getPrimaryDisplay());
  settings.x = bounds.x;
  settings.y = bounds.y;
  persistSettings();
}

// 仅由显式原生 smoke 闭包调用，用于在真实尺寸入口验收后精确还原初始设置。
function restoreSmokePetSettings(value) {
  if (!value || !SIZES[value.size] ||
    !(value.x === null || Number.isFinite(value.x)) ||
    !(value.y === null || Number.isFinite(value.y))) return false;
  settings.size = value.size;
  settings.x = value.x === null ? null : Math.round(value.x);
  settings.y = value.y === null ? null : Math.round(value.y);
  persistSettings();
  return true;
}

function stopWindowBounce(restorePosition = true) {
  if (!bounceState) return;
  const current = bounceState;
  bounceState = null;
  clearTimeout(current.timer);
  if (
    restorePosition &&
    petWindow &&
    !petWindow.isDestroyed()
  ) {
    petWindow.setPosition(current.x, current.y, false);
  }
}

function stopMotion({ restore = true, notify = true, notifyRenderer = true } = {}) {
  thoughts?.hide();
  dismissCodexPresentation();
  stopWindowBounce(restore);
  windowMotion.stop({ restore, notify });
  hostMotion = null;
  if (notifyRenderer && petWindow && !petWindow.isDestroyed()) sendCommand('stop');
}

function startWindowBounce() {
  dismissCodexPresentation();
  windowMotion.stop();
  hostMotion = null;
  if (
    bounceState ||
    !petWindow ||
    petWindow.isDestroyed()
  ) {
    return;
  }

  const [x, y] = petWindow.getPosition();
  const width = petWindow.getBounds().width;
  const startedAt = performance.now();
  const state = { x, y, width, startedAt, timer: null };
  bounceState = state;

  const moveNextFrame = () => {
    if (
      bounceState !== state ||
      !petWindow ||
      petWindow.isDestroyed()
    ) {
      return;
    }

    const elapsedMs = performance.now() - state.startedAt;
    if (elapsedMs >= BOUNCE_TOTAL_MS) {
      stopWindowBounce();
      return;
    }

    petWindow.setPosition(
      state.x,
      state.y - bounceOffset(elapsedMs, state.width),
      false
    );
    state.timer = setTimeout(moveNextFrame, 16);
  };

  moveNextFrame();
}

function currentBounds() {
  const size = SIZES[settings.size] || SIZES.medium;
  if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
    return ensureVisibleBounds(
      { x: settings.x, y: settings.y, ...size },
      screen.getAllDisplays(),
      screen.getPrimaryDisplay()
    );
  }
  return defaultBounds(screen.getPrimaryDisplay(), settings.size);
}

function makeWindowVisible(notifyRenderer = true) {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopMotion({ notifyRenderer });
  const next = ensureVisibleBounds(
    petWindow.getBounds(),
    screen.getAllDisplays(),
    screen.getPrimaryDisplay()
  );
  petWindow.setBounds(next, false);
  persistWindowPosition();
}

function sendCommand(command) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (typeof command !== 'string') {
    if (command?.command !== 'again' || !getMotion(command.motion)) return;
    command = { command: 'again', motion: command.motion };
  }
  if (command === 'sleep' || command === 'rest') {
    dragState = null;
    stopMotion({ notifyRenderer: false });
  }
  try {
    petWindow.webContents.send('pet:command', command);
  } catch (_) { /* 窗口关闭或渲染进程退出时，停止操作仍需完成。 */ }
}

function sendCompanionSettings() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:settings', {
    keepAwake: settings.keepAwake,
    bubblesEnabled: settings.bubblesEnabled,
    customization: effectiveCustomization(settings.customization)
  });
}

function setCompanionSetting(name, enabled) {
  if (!['keepAwake', 'bubblesEnabled'].includes(name)) return;
  settings[name] = Boolean(enabled);
  if (name === 'bubblesEnabled') {
    dialogue.setEnabled(settings.bubblesEnabled);
    if (!settings.bubblesEnabled) hideBubble();
  }
  persistSettings();
  tickEdgeNotice(true);
  sendCompanionSettings();
  refreshTrayMenu();
}

function showDialogue(event) {
  if (screenLocked || chatWindow?.isVisible() || presentationSuppressed() || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return null;
  const payload = dialogue.offer(event, performance.now());
  if (payload) dismissCodexPresentation();
  if (payload) showBubble(payload);
  else if (!dialogue.hasBubble(performance.now())) hideBubble();
  return payload;
}

function setPetSize(sizeName) {
  if (!SIZES[sizeName] || !petWindow || petWindow.isDestroyed()) return;
  stopMotion();
  const current = petWindow.getBounds();
  const size = SIZES[sizeName];
  const proposed = {
    x: Math.round(current.x + (current.width - size.width) / 2),
    y: Math.round(current.y + (current.height - size.height) / 2),
    ...size
  };
  const next = ensureVisibleBounds(
    proposed,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay()
  );
  settings.size = sizeName;
  settings.x = next.x;
  settings.y = next.y;
  petWindow.setBounds(next, true);
  edgeTuck?.recover();
  persistWindowPosition();
  refreshTrayMenu();
}

function setAlwaysOnTop(enabled) {
  settings.alwaysOnTop = Boolean(enabled);
  safelyInvokeWindow('球球窗口置顶', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  });
  safelyInvokeWindow('气泡窗口置顶', () => bubble?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('额度标签置顶', () => quotaLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('API 卡片置顶', () => apiUsageLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('边缘提示置顶', () => edgeNoticeWindow?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('聊天面板置顶', () => chatWindow?.setAlwaysOnTop(settings.alwaysOnTop));
  thoughts?.setAlwaysOnTop(settings.alwaysOnTop);
  persistSettings();
  refreshTrayMenu();
}

function resetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  dragState = null;
  stopMotion();
  edgeTuck?.restore();
  petWindow.showInactive();
  const next = defaultBounds(screen.getPrimaryDisplay(), settings.size);
  petWindow.setBounds(next, true);
  settings.x = next.x;
  settings.y = next.y;
  persistSettings();
}

function loginItemEnabled() {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== Boolean(enabled)) {
    writeError('开机启动回读不一致', `期望 ${Boolean(enabled)}，实际 ${actual}`);
  }
  refreshTrayMenu();
}

function sizeMenu() {
  return [
    ['micro', '袖珍（60 × 60）'],
    ['tiny', '迷你（80 × 80）'],
    ['compact', '紧凑（108 × 108）'],
    ['small', '标准（120 × 120）'],
    ['medium', '大（180 × 180）'],
    ['large', '特大（260 × 260）']
  ].map(([value, label]) => ({
    label,
    type: 'radio',
    checked: settings.size === value,
    click: () => setPetSize(value)
  }));
}

function codexMenu() {
  return {
    id: 'codex-menu',
    label: 'Codex 联动',
    submenu: [
      {
        id: 'codex-enabled', label: '启用 Codex 联动', type: 'checkbox', checked: settings.codexEnabled === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexEnabled === true;
          void setCodexEnabled(enabled); }
      },
      {
        id: 'codex-task-names', label: '完成提醒显示任务名称', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexTaskNameInAlerts === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexTaskNameInAlerts === true;
          setCodexTaskNameInAlerts(enabled); }
      },
      {
        id: 'codex-quota-visible', label: '一直显示剩余额度', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexQuotaAlwaysVisible === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexQuotaAlwaysVisible === true;
          setCodexPreference('codexQuotaAlwaysVisible', enabled); }
      },
      {
        id: 'codex-extra-credits', label: '显示额外点数', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexShowExtraCredits !== false,
        click: item => { const enabled = item.checked; item.checked = settings.codexShowExtraCredits !== false;
          setCodexPreference('codexShowExtraCredits', enabled); }
      },
      {
        id: 'codex-quota-period', label: '额度提醒周期', enabled: settings.codexEnabled === true,
        submenu: [
          ['auto', 'codex-quota-auto', '自动（按当前套餐）'],
          ['fiveHour', 'codex-quota-five-hour', '5 小时'],
          ['weekly', 'codex-quota-weekly', '周额度']
        ].map(([value, id, label]) => ({
          id, label, type: 'radio', enabled: settings.codexEnabled === true,
          checked: settings.codexQuotaPeriod === value,
          click: item => {
            item.checked = settings.codexQuotaPeriod === value;
            setCodexPreference('codexQuotaPeriod', value);
          }
        }))
      },
      {
        id: 'codex-quota-label-size', label: '额度卡片大小', enabled: settings.codexEnabled === true,
        submenu: [
          ['standard', 'codex-quota-label-standard', '标准'],
          ['compact', 'codex-quota-label-compact', '小巧']
        ].map(([value, id, label]) => ({
          id, label, type: 'radio', enabled: settings.codexEnabled === true,
          checked: settings.codexQuotaLabelSize === value,
          click: item => {
            item.checked = settings.codexQuotaLabelSize === value;
            setCodexPreference('codexQuotaLabelSize', value);
          }
        }))
      },
      {
        id: 'codex-quota-appearance', label: '额度卡片外观', enabled: settings.codexEnabled === true,
        submenu: [
          ['system', 'codex-quota-appearance-system', '跟随系统'],
          ['light', 'codex-quota-appearance-light', '浅色'],
          ['dark', 'codex-quota-appearance-dark', '深色']
        ].map(([value, id, label]) => ({
          id, label, type: 'radio', enabled: settings.codexEnabled === true,
          checked: settings.codexQuotaAppearance === value,
          click: item => {
            item.checked = settings.codexQuotaAppearance === value;
            setCodexPreference('codexQuotaAppearance', value);
          }
        }))
      },
      ...(codexPreferenceWarning
        ? [{ id: 'codex-preference-warning', label: codexPreferenceWarning, enabled: false }]
        : []),
      { id: 'openai-api-usage', label: 'OpenAI API 费用与用量…', click: openApiUsage },
      { id: 'openai-api-visible', label: '一直显示 API 本月费用', type: 'checkbox',
        checked: settings.openaiApiAlwaysVisible === true,
        click: item => { const enabled = item.checked; item.checked = settings.openaiApiAlwaysVisible === true;
          setApiUsageVisible(enabled); } },
      ...(settings.codexEnabled ? [{ id: 'codex-status', label: 'Codex 状态', submenu: [
        ...(codexNotice ? [{ label: codexNotice.text, enabled: false }, { type: 'separator' }] : []),
        ...bindCodexMenu(buildCodexMenu(codexCompanion?.getSnapshot(), codexNow()))
      ] }] : [])
    ]
  };
}

function menuTemplate() {
  return [
    { id: 'chat-open', label: '和球球聊聊', click: openChat },
    { id: 'customize-open', label: '来定制球球', click: openCustomization },
    { label: '便签与待办', submenu: [
      { id: 'notes-open', label: '打开主面板', click: () => notesCompanion?.openPanel() },
      { id: 'notes-new', label: '新建便签', click: () => notesCompanion?.openPanel({ tab: 'note', create: true }) },
      { id: 'notes-todo-new', label: '添加待办', click: () => notesCompanion?.openPanel({ tab: 'todo', create: true }) },
      { type: 'separator' },
      { id: 'notes-default-tab', label: '默认打开', submenu: [['note', '便签'], ['todo', '待办']].map(([value, label]) => ({
        id: `notes-default-${value}`, label, type: 'radio', checked: (settings.notesDefaultTab === 'note' ? 'note' : 'todo') === value,
        click: item => { item.checked = (settings.notesDefaultTab === 'note' ? 'note' : 'todo') === value; setNotesDefaultTab(value); }
      })) }
    ] },
    { type: 'separator' },
    { label: '球球与互动', submenu: [
      { label: '随机表情', click: () => sendCommand('random') },
      { type: 'separator' },
      { label: '立即睡眠', click: () => sendCommand('sleep') },
      { label: '立即唤醒', click: () => sendCommand('wake') },
      { type: 'separator' },
      { label: '保持清醒', type: 'checkbox', checked: settings.keepAwake,
        click: item => setCompanionSetting('keepAwake', item.checked) },
      { label: '互动气泡', type: 'checkbox', checked: settings.bubblesEnabled,
        click: item => setCompanionSetting('bubblesEnabled', item.checked) }
    ] },
    codexMenu(),
    { label: '贴边与显示', submenu: [
      { id: 'edge-left', label: '靠左收起', click: () => dockPet('left') },
      { id: 'edge-right', label: '靠右收起', click: () => dockPet('right') },
      { id: 'edge-leave', label: '离开边缘', enabled: Boolean(edgeTuck?.getPresentation().side), click: restorePet },
      { type: 'separator' },
      { id: 'edge-visibility', label: edgeTuck?.getPresentation().mode === 'hidden' ? '显示球球' : '暂时隐藏',
        click: () => edgeTuck?.getPresentation().mode === 'hidden' ? restorePet() : hidePet() }
    ] },
    { type: 'separator' },
    { label: '尺寸', submenu: sizeMenu() },
    {
      id: 'color-mode', label: '界面配色', submenu: [
        { id: 'color-standard', label: '标准配色', type: 'radio', checked: settings.colorMode !== 'accessible',
          click: () => setColorMode('standard') },
        { id: 'color-accessible', label: '色弱友好（高对比）', type: 'radio', checked: settings.colorMode === 'accessible',
          click: () => setColorMode('accessible') },
        { type: 'separator' },
        { id: 'color-appearance', label: '色弱友好外观', enabled: settings.colorMode === 'accessible',
          submenu: [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([value, label]) => ({
            id: `color-appearance-${value}`, label, type: 'radio', checked: settings.codexQuotaAppearance === value,
            click: () => setInterfaceAppearance(value)
          })) }
      ]
    },
    { label: '常规设置', submenu: [
      { label: '始终置顶', type: 'checkbox', checked: settings.alwaysOnTop,
        click: item => setAlwaysOnTop(item.checked) },
      { label: app.isPackaged ? '开机自动启动' : '开机自动启动（打包后可用）',
        type: 'checkbox', enabled: app.isPackaged, checked: loginItemEnabled(),
        click: item => setOpenAtLogin(item.checked) },
      { type: 'separator' },
      { label: '恢复默认位置', click: resetPosition },
      { id: 'update-auto', label: '自动提醒新版本', type: 'checkbox', checked: settings.autoUpdateCheck !== false,
        click: item => setAutoUpdateCheck(item.checked) }
    ] },
    { type: 'separator' },
    { id: 'about-open', label: '关于球球', click: () => { void openAbout(); } },
    { id: 'update-check', label: availableUpdate ? `● 有新版本 ${availableUpdate.latestVersion}…`
      : updateCheck ? '正在检查更新…' : '检查更新…', enabled: Boolean(availableUpdate) || !updateCheck,
      click: () => { void (availableUpdate ? showUpdateResult(availableUpdate) : checkForUpdates(true)); } },
    {
      label: '退出球球',
      click: () => app.quit()
    }
  ];
}

function refreshTrayMenu() {
  if (!tray || !settings) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function popupPetMenu(items) {
  const win = petWindow, controller = edgeTuck;
  if (!win || win.isDestroyed()) return false;
  const token = ++petMenuToken;
  let opened = false, released = false;
  const release = () => {
    if (released) return;
    released = true;
    win.removeListener('closed', release);
    // 旧菜单或旧窗口的关闭回调不能解除后来菜单的展开保护。
    if (token === petMenuToken && controller === edgeTuck) controller?.pin(false);
  };
  controller?.pin(true);
  win.once('closed', release);
  try {
    // 交由 AppKit 定位第一项，避免 Electron 为长菜单计算的底边补偿
    // 把锚点移出小尺寸透明窗口，触发原生菜单的滚动裁切。
    Menu.buildFromTemplate(items).popup({ window: win, positioningItem: 0, callback: release });
    opened = true;
    return true;
  } finally {
    if (!opened) release();
  }
}

function showPetContextMenu() {
  return popupPetMenu(menuTemplate());
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets/tray-iconTemplate.png');
  const trayImage = nativeImage.createFromPath(iconPath);
  trayImage.setTemplateImage(true);
  tray = new Tray(trayImage);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();
  tray.on('click', () => {
    restorePet();
  });
}

async function finishSmokeTest() {
  if (!IS_SMOKE_TEST || !petWindow || petWindow.isDestroyed()) return;
  try {
    const ready = await petWindow.webContents.executeJavaScript(
      'Boolean(window.__petReady)'
    );
    if (!ready) throw new Error('桌宠页面未完成初始化');
    const companionReady = await petWindow.webContents.executeJavaScript(
      "Boolean(window.petDesktop.onActivity && document.getElementById('pet').dataset.mode)"
    );
    if (!companionReady) throw new Error('轻陪伴活动感知尚未接入');

    if (process.env.PET_SMOKE_API_USAGE_ONLY === '1') {
      await require('./scripts/verify-api-usage-integration').verifyApiUsage({
        getWindow: () => apiUsageWindow, service: apiUsage, pet: petWindow,
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), powerMonitor,
        apiLabel: apiUsageLabel, quotaLabel, screen, edgeTuck, monitor: activityMonitor,
        setSize: setPetSize,
        setShape: shape => saveCustomization({ ...settings.customization,
          appearance: { ...settings.customization.appearance, shape,
            auroraStyle: 'dimensional', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF' } }),
        showDemoQuota: () => { quotaLabel.show(buildQuotaLabelModel({ enabled: true,
          quota: { state: 'connected', stale: false, windows: [{ id: 'codex:weekly', label: 'Codex',
            windowMinutes: 10080, remaining: 79, resetsAt: Date.now() + 86400000 }] }
        }, { period: 'auto', size: 'compact' }, Date.now())); syncApiUsageLabel(); }
      });
      app.exit(0);
      return;
    }

    if (process.env.PET_SMOKE_CUSTOMIZE_ONLY === '1') {
      const assert = require('node:assert/strict');
      const initialIdleEyes = settings.customization.appearance.idleEyes;
      const waitFor = async check => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (await check()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('定制面板检查超时');
      };
      openCustomization();
      await waitFor(async () => customizationWindow && !customizationWindow.isDestroyed() &&
        customizationWindow.webContents.executeJavaScript('window.__customizerReady === true').catch(() => false));
      const editor = customizationWindow;
      await waitFor(() => editor.isVisible());
      assert.equal(await editor.webContents.executeJavaScript(
        "document.getElementById('startup-default').checked"), true);
      assert.equal(await editor.webContents.executeJavaScript(
        "Boolean(document.getElementById('motion-title') || document.getElementById('preview-play'))"
      ), false);
      assert.equal(menuTemplate().some(item => item.id === 'custom-sequence-play'), false);
      process.stdout.write('PET_CUSTOMIZE_READY\n');
      for (const [shape, bodyColor, eyeColor] of [
        ['blob', '#EEEBE4', '#1A1A1A'],
        ['cloud', '#5B3BC7', '#FFFFFF'],
        ['aurora-cloud', '#5B3BC7', '#FFFFFF'],
        ['square', '#EEEBE4', '#1A1A1A']
      ]) {
        await editor.webContents.executeJavaScript(
          `document.querySelector('[data-shape="${shape}"]').click(); true`);
        await waitFor(() => editor.webContents.executeJavaScript(`(() =>
          document.querySelector('[data-shape="${shape}"]').getAttribute('aria-pressed') === 'true' &&
          document.getElementById('startup-default').checked === ${shape === settings.startupAppearance.shape} &&
          document.getElementById('body-hex').value === '${bodyColor}' &&
          document.getElementById('eye-hex').value === '${eyeColor}' &&
          document.querySelectorAll('#stage svg .eb-head').length === 1
        )()`));
        if (shape === 'aurora-cloud') await waitFor(() => editor.webContents.executeJavaScript(
          "Boolean(document.querySelector('#preview-ball .eb-rive-aurora.ready'))"));
        if (shape === 'aurora-cloud') {
          chatWindow.show({ messages: [] });
          await waitFor(async () => chatWindow.getWindow()?.webContents.executeJavaScript(
            "Boolean(document.querySelector('#chat-avatar .eb-rive-aurora.ready'))").catch(() => false));
          chatWindow.hide();
          process.stdout.write('PET_CUSTOMIZE_CHAT_AVATAR_OK\n');
        }
        if (shape !== 'aurora-cloud') {
          assert.equal(await editor.webContents.executeJavaScript(`(() => {
            const icon = document.querySelector('[data-shape="${shape}"] .shape-art svg');
            const eyes = [...icon.querySelectorAll('.eb-eye')];
            return icon.querySelectorAll('.eb-head').length === 1 &&
              eyes.length === 2 && eyes.every(eye =>
                eye.getAttribute('fill') === '${eyeColor}');
          })()`), true, `${shape}形态卡应展示对应推荐配色`);
        }
        if (shape === 'aurora-cloud') {
          assert.equal(await editor.webContents.executeJavaScript(`(() =>
            document.getElementById('glow-pink-hex').value === '#D05ED6' &&
            document.getElementById('glow-gold-hex').value === '#D0AD8A' &&
            !document.getElementById('aurora-transparency-field').hidden &&
            document.getElementById('aurora-transparency').value === '0'
          )()`), true);
          await editor.webContents.executeJavaScript(`(() => {
            const slider = document.getElementById('aurora-transparency');
            slider.value = '42'; slider.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`);
          await waitFor(() => editor.webContents.executeJavaScript(`(() =>
            document.getElementById('aurora-transparency-value').textContent === '42%' &&
            document.querySelector('#preview-ball .eb-aurora-material')?.getAttribute('opacity') === '0.58'
          )()`));
          await editor.webContents.executeJavaScript(`(() => {
            const slider = document.getElementById('aurora-transparency');
            slider.value = '24'; slider.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`);
        }
      }
      process.stdout.write('PET_CUSTOMIZE_RECOMMENDED_COLORS_OK\n');
      await require('./scripts/verify-aurora-six-lobe').verifyAuroraSixLobe({
        editor, pet: petWindow, chatWindow, getSettings: () => settings,
        readSettings: () => loadSettings(settingsFile), restore: value => {
          settings = value; persistSettings(); customizationPreviewAppearance = null;
          sendCompanionSettings(); chatWindow?.syncAppearance(); return true;
        }, screen, monitor: activityMonitor, setSize: setPetSize, dock: dockPet,
        restoreEdge: () => edgeTuck.restore(), getPresentation: () => edgeTuck.getPresentation()
      });
      if (process.env.PET_SMOKE_AURORA_SCREENSHOT) {
        await editor.webContents.executeJavaScript("document.querySelector('[data-shape=\"aurora-cloud\"]').click(); true");
        await waitFor(() => editor.webContents.executeJavaScript(`(() =>
          document.querySelector('[data-shape="aurora-cloud"]').getAttribute('aria-pressed') === 'true' &&
          document.getElementById('body-hex').value === '#5B3BC7' &&
          document.getElementById('eye-hex').value === '#FFFFFF' &&
          document.getElementById('preview-ball').querySelector('svg .eb-head') !== null
        )()`));
        await new Promise(resolve => setTimeout(resolve, 250));
        const screenshotPath = path.resolve(process.env.PET_SMOKE_AURORA_SCREENSHOT);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, (await editor.webContents.capturePage()).toPNG());
        if (process.env.PET_SMOKE_AURORA_BACKGROUNDS === '1') {
          const extension = path.extname(screenshotPath);
          const stem = extension ? screenshotPath.slice(0, -extension.length) : screenshotPath;
          await editor.webContents.executeJavaScript("document.getElementById('stage').classList.add('dark'); true");
          await new Promise(resolve => setTimeout(resolve, 250));
          fs.writeFileSync(`${stem}-dark.png`, (await editor.webContents.capturePage()).toPNG());
          await editor.webContents.executeJavaScript(`(() => {
            const stage = document.getElementById('stage');
            stage.classList.remove('dark');
            stage.style.background = 'repeating-linear-gradient(90deg, #202A44 0 18px, #A9B4C4 18px 20px, #202A44 20px 38px, #A9B4C4 38px 40px)';
            return true;
          })()`);
          await new Promise(resolve => setTimeout(resolve, 250));
          fs.writeFileSync(`${stem}-grid.png`, (await editor.webContents.capturePage()).toPNG());
          await editor.webContents.executeJavaScript("document.getElementById('stage').style.background = ''; true");
        }
      }
      if (process.env.PET_SMOKE_CLOUD_SCREENSHOT) {
        await editor.webContents.executeJavaScript(`(() => {
          document.querySelector('[data-shape="cloud"]').click();
          for (const [id, value] of [['body-hex', '#08090D'], ['eye-hex', '#FFFFFF']]) {
            const node = document.getElementById(id); node.value = value;
            node.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        })()`);
        await waitFor(() => editor.webContents.executeJavaScript(`(() =>
          document.querySelector('[data-shape="cloud"]').getAttribute('aria-pressed') === 'true' &&
          document.getElementById('preview-ball').querySelector('svg .eb-head') !== null
        )()`));
        await new Promise(resolve => setTimeout(resolve, 300));
        const screenshotPath = path.resolve(process.env.PET_SMOKE_CLOUD_SCREENSHOT);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, (await editor.webContents.capturePage()).toPNG());
      }
      await editor.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-shape="square"]').click();
        document.getElementById('manual-toggle').click();
        const slider = (id, value) => { const node = document.getElementById(id); node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true })); };
        slider('shape-width', 113); slider('shape-softness', 72);
        slider('eye-spacing', 115); slider('eye-scale', 110);
        slider('aurora-transparency', 42);
        const bodyHex = document.getElementById('body-hex'); bodyHex.value = '#28415C';
        bodyHex.dispatchEvent(new Event('input', { bubbles: true }));
        const eyeColor = document.getElementById('eye-color'); eyeColor.value = '#F4E8C8';
        eyeColor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      process.stdout.write('PET_CUSTOMIZE_EDITED\n');
      await waitFor(async () => editor.webContents.executeJavaScript(`(() =>
        document.querySelector('[data-shape="square"]').getAttribute('aria-pressed') === 'true' &&
        document.getElementById('body-hex').value === '#28415C' &&
        document.getElementById('eye-hex').value === '#F4E8C8' &&
        document.getElementById('aurora-transparency-value').textContent === '42%' &&
        document.querySelector('#preview-ball > svg')?.style.opacity === '0.58' &&
        document.getElementById('preview-ball').querySelector('svg .eb-head') !== null &&
        document.querySelectorAll('#stage svg .eb-head').length === 1
      )()`));
      await editor.webContents.executeJavaScript("document.getElementById('preview-desktop').click(); true");
      const expectedDesktopPixels = ({ micro: 60, tiny: 80, compact: 108, small: 120, medium: 180, large: 260 })[settings.size] || 80;
      await waitFor(() => editor.webContents.executeJavaScript(`(() =>
        document.getElementById('preview-desktop').getAttribute('aria-pressed') === 'true' &&
        document.getElementById('stage').dataset.previewMode === 'desktop' &&
        document.getElementById('preview-ball').style.width === '${expectedDesktopPixels}px' &&
        document.querySelectorAll('#stage svg .eb-head').length === 1
      )()`));
      if (process.env.PET_SMOKE_CUSTOMIZE_DESKTOP_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const screenshotPath = path.resolve(process.env.PET_SMOKE_CUSTOMIZE_DESKTOP_SCREENSHOT);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, (await editor.webContents.capturePage()).toPNG());
      }
      assert.equal(await editor.webContents.executeJavaScript(`(() => {
        const button = document.getElementById('preview-desktop'); button.focus();
        const keyboardFocus = document.activeElement === button;
        const stage = document.getElementById('stage');
        const toggle = document.getElementById('stage-toggle'); toggle.click();
        const dark = stage.classList.contains('dark'); toggle.click();
        return keyboardFocus && dark && !stage.classList.contains('dark');
      })()`), true);
      await editor.webContents.executeJavaScript("document.getElementById('preview-large').click(); true");
      await waitFor(() => editor.webContents.executeJavaScript(`(() =>
        document.getElementById('preview-large').getAttribute('aria-pressed') === 'true' &&
        document.getElementById('preview-ball').style.width === '205px'
      )()`));
      assert.equal(await editor.webContents.executeJavaScript(`(() => {
        const toggle = document.getElementById('manual-toggle');
        toggle.click(); const retained = document.getElementById('shape-width').value === '113'; toggle.click();
        const square = document.querySelector('[data-shape="square"]'); square.focus(); square.click();
        const shapeFocus = document.activeElement === square;
        const swatch = document.querySelector('#body-swatches .swatch'); swatch.focus(); swatch.click();
        const swatchFocus = document.activeElement === swatch;
        const bodyHex = document.getElementById('body-hex'); bodyHex.value = '#28415C';
        bodyHex.dispatchEvent(new Event('input', { bubbles: true }));
        const eyeHex = document.getElementById('eye-hex'); eyeHex.value = '#F4E8C8';
        eyeHex.dispatchEvent(new Event('input', { bubbles: true }));
        return retained && shapeFocus && swatchFocus;
      })()`), true);
      await new Promise(resolve => setTimeout(resolve, 300));
      if (process.env.PET_SMOKE_CUSTOMIZE_SCREENSHOT) {
        await editor.webContents.executeJavaScript('window.scrollTo(0, 0); true');
        await new Promise(resolve => setTimeout(resolve, 100));
        const screenshotPath = path.resolve(process.env.PET_SMOKE_CUSTOMIZE_SCREENSHOT);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, (await editor.webContents.capturePage()).toPNG());
      }
      if (process.env.PET_SMOKE_CUSTOMIZE_DETAILS_SCREENSHOT) {
        await editor.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight); true');
        await new Promise(resolve => setTimeout(resolve, 100));
        const screenshotPath = path.resolve(process.env.PET_SMOKE_CUSTOMIZE_DETAILS_SCREENSHOT);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, (await editor.webContents.capturePage()).toPNG());
      }
      process.stdout.write('PET_CUSTOMIZE_CAPTURED\n');
      assert.equal(await editor.webContents.executeJavaScript(`(() => {
        const hex = document.getElementById('body-hex'); hex.value = 'invalid';
        hex.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('save').click();
        const blocked = hex.classList.contains('invalid') && document.activeElement === hex;
        hex.value = '#28415C'; hex.dispatchEvent(new Event('input', { bubbles: true }));
        return blocked;
      })()`), true);
      assert.notEqual(settings.customization.appearance.bodyColor, '#28415C');
      await editor.webContents.executeJavaScript("document.getElementById('startup-default').click(); true");
      await editor.webContents.executeJavaScript("document.getElementById('save').click(); true");
      await waitFor(() => settings.customization.appearance.bodyColor === '#28415C');
      assert.equal(settings.startupAppearance.bodyColor, '#28415C');
      assert.equal(settings.startupAppearance.shape, 'square');
      process.stdout.write('PET_CUSTOMIZE_STARTUP_DEFAULT_OK\n');
      process.stdout.write('PET_CUSTOMIZE_SAVED\n');
      await waitFor(async () => petWindow.webContents.executeJavaScript(
        "[...document.querySelectorAll('linearGradient stop, radialGradient stop')].some(node => node.getAttribute('stop-color') === '#28415C')"
      ));
      assert.equal(settings.customization.appearance.shape, 'square');
      assert.equal(settings.customization.appearance.shapeTuning.width, 1.13);
      assert.equal(settings.customization.appearance.shapeTuning.softness, 0.72);
      assert.equal(settings.customization.appearance.eyeSpacing, 1.15);
      assert.equal(settings.customization.appearance.eyeColor, '#F4E8C8');
      assert.equal(settings.customization.appearance.auroraTransparency, 42);
      assert.equal(await petWindow.webContents.executeJavaScript(
        "document.querySelector('#pet > svg')?.style.opacity"), '0.58');
      assert.equal(settings.customization.appearance.idleEyes, initialIdleEyes);
      process.stdout.write('PET_CUSTOMIZE_SMOKE_OK\n');
      app.exit(0);
      return;
    }

    if (process.env.PET_SMOKE_CHAT_ONLY === '1') {
      if (process.env.PET_SMOKE_CHAT_AVATAR === '1') {
        if (!saveCustomization({ ...settings.customization,
          appearance: { ...settings.customization.appearance, shape: 'aurora-cloud',
            auroraStyle: 'simple', bodyColor: '#8B72D8' } })) throw new Error('聊天头像测试外观保存失败');
      }
      await require('./scripts/verify-chat-integration').verifyChatIntegration({ pet: petWindow, chat, chatWindow,
        screen, getMenu: () => Menu.buildFromTemplate(menuTemplate()), getPresentation: () => edgeTuck.getPresentation(),
        hidePet, restorePet, powerMonitor, checkUpdates: checkForUpdates, getAboutWindow: () => aboutWindow,
        getBubbleWindow: () => bubble.getWindow() });
      app.quit();
      return;
    }

    if (process.env.PET_SMOKE_EDGE_ONLY === '1') {
      await require('./scripts/verify-edge-tuck').verifyEdgeTuck({
        pet: petWindow, bubble, quotaLabel, monitor: activityMonitor, screen,
        getThoughtWindow: () => thoughts?.getWindow(),
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), setSize: setPetSize,
        getSettings: () => ({ ...settings }), showDialogue,
        getPresentation: () => edgeTuck.getPresentation(), prepare: initializeCodexCompanion,
        verifyNotices: async () => {
          try {
            await require('./scripts/verify-edge-companion').verifyEdgeCompanion({
              pet: petWindow, screen, quotaLabel, notice: edgeNoticeWindow,
              dock: dockPet, hide: hidePet, restore: restorePet,
              pause: () => edgeTuck.suspend(), resume: () => edgeTuck.resume(),
              setSetting: setCompanionSetting, setQuotaPreference: setCodexPreference,
              tick: time => { edgeNoticeNow = () => time; tickEdgeNotice(true); },
              reset: () => edgeNotice.reset(), getPresentation: () => edgeTuck.getPresentation()
            });
          } finally { edgeNoticeNow = () => performance.now(); lastEdgeNoticeTick = -Infinity; edgeNotice.reset(); }
        },
        setQuotaPreference: setCodexPreference,
        setEnabled: async enabled => { settings.codexEnabled = enabled; await codexCompanion.setEnabled(enabled); }
      });
      process.stdout.write('PET_EDGE_SMOKE_OK\n');
      app.exit(0);
      return;
    }

    if (!IS_CODEX_SMOKE_ONLY) {
      await require('./scripts/verify-companion').verifyCompanion({
        pet: petWindow, bubble, dialogue, monitor: activityMonitor, screen, BrowserWindow,
        command: sendCommand, setSetting: setCompanionSetting, getSettings: () => ({ ...settings }), showDialogue
      });
    }

    await require('./scripts/verify-codex-companion').verifyCodexCompanion({
      pet: petWindow, bubble, quotaLabel, monitor: activityMonitor, screen, BrowserWindow,
      getThoughtWindow: () => thoughts?.getWindow(),
      command: sendCommand, setSetting: setCompanionSetting, setSize: setPetSize,
      getMenu: () => Menu.buildFromTemplate(menuTemplate()), getSettings: () => ({ ...settings }),
      prepare: initializeCodexCompanion, getController: () => codexCompanion,
      canPresent: canPresentCodex, getMotionOwner: () => hostMotion,
      clearDialogue: () => { dialogue.dismiss(); hideBubble(); },
      setQuotaPreference: setCodexPreference,
      restorePetSettings: restoreSmokePetSettings,
      // 只在显式冒烟闭包提供模拟开关，不注册测试 IPC，也不显示真实授权弹窗。
      setEnabled: async enabled => { settings.codexEnabled = enabled; await codexCompanion.setEnabled(enabled); }
    });

    const inspectSleepVisual = async (pixels, minimumEyeHeight, screenshotPath = null) => {
      await new Promise(resolve => setTimeout(resolve, 250));
      sendCommand('wake');
      await new Promise(resolve => setTimeout(resolve, 120));
      sendCommand('sleep');
      await new Promise(resolve => setTimeout(resolve, 1100));
      const sleepVisual = await petWindow.webContents.executeJavaScript(`(() => {
      const zNodes = [...document.querySelectorAll('.eb-sleep-z')];
      const visibleZ = zNodes.filter(node => Number(node.getAttribute('opacity')) > 0.05);
      const eyeHeights = [...document.querySelectorAll('.eb-eye')]
        .map(node => node.getBoundingClientRect().height);
      const hasVisibleZInsideWindow = visibleZ.some(node => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 &&
          rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      });
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        zCount: zNodes.length,
        visibleZCount: visibleZ.length,
        hasVisibleZInsideWindow,
        eyeHeights
      };
      })()`);
      if (sleepVisual.width !== pixels || sleepVisual.height !== pixels) {
        throw new Error(`${pixels} 尺寸错误：${sleepVisual.width} × ${sleepVisual.height}`);
      }
      if (sleepVisual.zCount !== 3 || sleepVisual.visibleZCount < 1) {
        throw new Error(`${pixels} 尺寸 Zzz 不可见：${JSON.stringify(sleepVisual)}`);
      }
      if (!sleepVisual.hasVisibleZInsideWindow) {
        throw new Error(`${pixels} 尺寸 Zzz 被窗口裁切：${JSON.stringify(sleepVisual)}`);
      }
      if (sleepVisual.eyeHeights.length !== 2 ||
        sleepVisual.eyeHeights.some(height => height < minimumEyeHeight)) {
        throw new Error(`${pixels} 尺寸睡眼过细：${JSON.stringify(sleepVisual.eyeHeights)}`);
      }
      if (screenshotPath) {
        const screenshot = await petWindow.webContents.capturePage();
        fs.writeFileSync(path.resolve(screenshotPath), screenshot.toPNG());
      }
    };

    setPetSize('micro');
    const tinyScreenshot = process.env.PET_SMOKE_SCREENSHOT;
    const microScreenshot = tinyScreenshot
      ? path.join(path.dirname(path.resolve(tinyScreenshot)),
        `${path.basename(tinyScreenshot, path.extname(tinyScreenshot))}-micro${path.extname(tinyScreenshot) || '.png'}`)
      : null;
    await inspectSleepVisual(60, 1, microScreenshot);
    process.stdout.write('PET_SLEEP_VISUAL_MICRO_OK\n');

    setPetSize('tiny');
    await inspectSleepVisual(80, 1.5, tinyScreenshot);
    process.stdout.write('PET_SLEEP_VISUAL_OK\n');

    const startY = petWindow.getPosition()[1];
    await petWindow.webContents.executeJavaScript(
      'window.petDesktop.bounce(); true'
    );
    await new Promise(resolve => setTimeout(resolve, 300));
    const jumpingY = petWindow.getPosition()[1];
    if (jumpingY >= startY) {
      throw new Error('原生窗口未执行向上弹跳');
    }

    await new Promise(resolve => setTimeout(resolve, BOUNCE_TOTAL_MS + 100));
    const settledY = petWindow.getPosition()[1];
    if (settledY !== startY) {
      throw new Error(`弹跳结束后位置未还原：${startY} -> ${settledY}`);
    }

    process.stdout.write('PET_BOUNCE_OK\n');
    process.stdout.write('PET_SMOKE_OK\n');
    app.exit(0);
  } catch (error) {
    writeError('冒烟检查失败', error);
    app.exit(1);
  }
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const creationRevision = ++petWindowCreationRevision;
  invalidateCodexPage();
  if (creationRevision !== petWindowCreationRevision) return petWindow;

  const candidatePetWindow = new BrowserWindow({
    ...currentBounds(),
    title: APP_NAME,
    transparent: true,
    focusable: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });
  if (creationRevision !== petWindowCreationRevision) {
    safelyInvokeWindow('旧球球窗口作废', () => {
      if (!candidatePetWindow.isDestroyed()) candidatePetWindow.destroy();
    });
    return petWindow;
  }
  edgeTuck?.dispose();
  petWindow = candidatePetWindow;
  edgeTuck = createEdgeTuck({ getWindow: () => petWindow,
    getWorkArea: bounds => screen.getDisplayMatching(bounds).workArea,
    getRetentionBounds: edgeRetentionBounds, onChange: applyPresentation,
    schedule: setTimeout, cancel: clearTimeout });
  const createdPetWindow = candidatePetWindow;
  const isCurrentPetWindow = () => petWindow === createdPetWindow;

  createdPetWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  createdPetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  createdPetWindow.setHiddenInMissionControl(true);
  createdPetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  createdPetWindow.webContents.on('will-navigate', event => event.preventDefault());
  createdPetWindow.webContents.on('did-fail-load', (_event, code, description) => {
    if (!isCurrentPetWindow()) return;
    writeError('页面加载失败', `${code} ${description}`);
    if (IS_SMOKE_TEST) app.exit(1);
  });
  createdPetWindow.webContents.on('render-process-gone', (_event, details) => {
    if (!isCurrentPetWindow()) return;
    invalidateCodexPage();
    if (!isCurrentPetWindow()) return;
    writeError('渲染进程退出', JSON.stringify(details));
    if (IS_SMOKE_TEST) app.exit(1);
  });
  createdPetWindow.once('ready-to-show', () => {
    if (!isCurrentPetWindow() || createdPetWindow.isDestroyed()) return;
    createdPetWindow.showInactive();
    if (!isCurrentPetWindow()) return;
    syncQuotaLabel(codexCompanion?.getSnapshot());
  });
  createdPetWindow.webContents.on('did-finish-load', () => {
    if (!isCurrentPetWindow()) return;
    codexPageReady = true;
    if (!isCurrentPetWindow()) return;
    sendCompanionSettings();
    edgeTuck?.publish();
    if (!isCurrentPetWindow()) return;
    syncCodexSettings(codexCompanion?.getSnapshot(), true);
    if (!isCurrentPetWindow()) return;
    activityMonitor.start();
    if (!isCurrentPetWindow()) return;
    finishSmokeTest();
  });
  createdPetWindow.webContents.on('did-start-loading', () => {
    if (isCurrentPetWindow()) invalidateCodexPage();
  });
  createdPetWindow.on('move', () => {
    if (!isCurrentPetWindow()) return;
    notesCompanion?.repositionReminder?.();
    if (chatWindow?.isFollowingChat?.()) return;
    thoughts?.hide(); repositionBubble(); edgeNoticeWindow?.reposition();
  });
  createdPetWindow.on('resize', () => {
    if (!isCurrentPetWindow()) return;
    dragState = null;
    stopMotion();
    edgeTuck?.recover();
    notesCompanion?.repositionReminder?.();
    if (isCurrentPetWindow()) repositionBubble();
  });
  createdPetWindow.on('show', () => {
    if (!isCurrentPetWindow()) return;
    if (edgeTuck?.getPresentation().mode === 'hidden') edgeTuck.restore();
    notesCompanion?.repositionReminder?.(true);
  });
  createdPetWindow.on('hide', () => {
    // macOS may deliver hide after a quick hide/show pair. Do not hide a newly
    // reopened chat or re-tuck the pet for an obsolete native notification.
    if (!isCurrentPetWindow() || createdPetWindow.isVisible()) return;
    notesCompanion?.repositionReminder?.();
    dragState = null;
    chatWindow?.hide();
    if (edgeTuck?.getPresentation().mode !== 'hidden') edgeTuck?.hide();
    safelyInvokeWindow('隐藏时停止动作', stopMotion);
    if (!isCurrentPetWindow()) return;
    hideBubble();
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时额度标签隐藏', () => quotaLabel?.hide());
    safelyInvokeWindow('隐藏时 API 卡片隐藏', () => apiUsageLabel?.hide());
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时对白清理', () => dialogue?.dismiss());
  });
  let closedCleanupStarted = false;
  createdPetWindow.on('closed', () => {
    if (!isCurrentPetWindow() || closedCleanupStarted) return;
    closedCleanupStarted = true;
    notesCompanion?.repositionReminder?.();
    chatWindow?.hide();
    edgeTuck?.dispose();
    edgeNotice?.reset();
    safelyInvokeWindow('关闭时边缘提示销毁', () => edgeNoticeWindow?.destroy());
    if (isQuitting) {
      petWindow = null;
      return;
    }
    safelyInvokeWindow('关闭时页面状态清理', invalidateCodexPage);
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('关闭时停止动作', () => stopMotion({ restore: false, notify: false, notifyRenderer: false }));
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('关闭时活动监测清理', () => activityMonitor?.stop());
    if (!isCurrentPetWindow()) return;
    destroyBubbleSafely();
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('关闭时额度标签销毁', () => quotaLabel?.destroy());
    safelyInvokeWindow('关闭时 API 卡片销毁', () => apiUsageLabel?.destroy());
    thoughts?.destroy();
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('关闭时对白清理', () => dialogue?.dismiss());
    if (isCurrentPetWindow()) petWindow = null;
  });

  createdPetWindow.loadFile(path.join(__dirname, 'index.html')).catch(error => {
    if (!isCurrentPetWindow()) return;
    writeError('无法打开桌宠页面', error);
    if (IS_SMOKE_TEST) app.exit(1);
  });
  if (!isCurrentPetWindow()) {
    safelyInvokeWindow('旧球球窗口作废', () => {
      if (!createdPetWindow.isDestroyed()) createdPetWindow.destroy();
    });
    return petWindow;
  }
  return createdPetWindow;
}

function registerIpc() {
  ipcMain.handle('pet:about-get', event => fromAboutWindow(event)
    ? { version: app.getVersion(), website: APP_WEBSITE, developer: '马晓坤', update: aboutUpdateState } : null);
  ipcMain.handle('pet:about-website', event => {
    if (!fromAboutWindow(event, true)) return false;
    return shell.openExternal(APP_WEBSITE).then(() => true, () => false);
  });
  ipcMain.handle('pet:about-update', async event => {
    if (!fromAboutWindow(event, true)) return false;
    await checkForUpdates(true);
    return true;
  });
  ipcMain.handle('pet:about-release', event => {
    if (!fromAboutWindow(event, true) || aboutUpdateState.state !== 'ready' ||
      !availableUpdate || aboutUpdateState.latestVersion !== availableUpdate.latestVersion) return false;
    return shell.openExternal(availableUpdate.url).then(() => true, () => false);
  });
  ipcMain.on('pet:about-close', event => { if (fromAboutWindow(event)) aboutWindow.close(); });
  ipcMain.handle('pet:api-usage-get', event => fromApiUsageWindow(event, false) ? apiUsage.getState() : null);
  ipcMain.handle('pet:api-usage-connect', (event, value) => fromApiUsageWindow(event) ? apiUsage.connect(value) : null);
  ipcMain.handle('pet:api-usage-refresh', event => fromApiUsageWindow(event) ? apiUsage.refresh() : null);
  ipcMain.handle('pet:api-usage-disconnect', event => fromApiUsageWindow(event) ? apiUsage.disconnect() : null);
  ipcMain.handle('pet:api-usage-guide', event => {
    if (!fromApiUsageWindow(event)) return false;
    return shell.openExternal('https://platform.openai.com/settings/organization/admin-keys')
      .then(() => true, () => false);
  });
  ipcMain.handle('pet:customization-get', event => fromCustomizationWindow(event) && !screenLocked
    ? { customization: effectiveCustomization(settings.customization),
      startupAppearance: effectiveAppearance(settings.startupAppearance),
      size: settings.size } : null);
  ipcMain.on('pet:customization-preview', (event, appearance) => {
    if (!fromCustomizationWindow(event) || screenLocked || !appearance || typeof appearance !== 'object') return;
    customizationPreviewAppearance = effectiveAppearance(appearance);
    chatWindow?.syncAppearance();
  });
  ipcMain.handle('pet:customization-save', (event, value, setAsStartupDefault) => {
    if (!fromCustomizationWindow(event) || screenLocked) return false;
    return saveCustomization(value, setAsStartupDefault);
  });
  ipcMain.handle('pet:chat-get', event => fromChatWindow(event) && !screenLocked ? chatSnapshot() : null);
  ipcMain.handle('pet:chat-open-update', event => {
    if (!fromChatWindow(event) || screenLocked || isQuitting || !chatWindow.isVisible() || !availableUpdate) return false;
    return showUpdateResult(availableUpdate);
  });
  ipcMain.handle('pet:chat-send', (event, text) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再发送。' };
    return chat.send(text);
  });
  ipcMain.handle('pet:chat-stop', event => {
    if (fromChatWindow(event)) return chat.stop();
  });
  ipcMain.handle('pet:chat-new', event => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return chat.newChat();
  });
  ipcMain.handle('pet:chat-select', (event, id) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return chat.selectChat(id);
  });
  ipcMain.handle('pet:chat-model', (event, id) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return chat.setModel(id);
  });
  ipcMain.handle('pet:chat-models-refresh', event => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return chat.refreshModels();
  });
  ipcMain.on('pet:chat-close', event => { if (fromChatWindow(event)) chatWindow.hide(); });
  ipcMain.on('pet:thought', (event, request) => {
    if (!fromPetWindow(event) || typeof request?.visible !== 'boolean') return;
    if (!request.visible) { thoughts?.hide(); return; }
    const snapshot = codexCompanion?.getSnapshot();
    if (!settings.codexEnabled || !codexPageReady || screenLocked || chatWindow?.isVisible() || presentationSuppressed() || dragState || hostMotion ||
        !petWindow.isVisible() || !snapshot?.tasks.items.some(task => task.state === 'active')) return;
    thoughts?.show(request);
  });
  ipcMain.on('pet:say', (event, scene) => {
    if (scene === 'thought' && !codexCompanion?.getSnapshot().tasks.items.some(task => task.state === 'active')) return;
    if (fromPetWindow(event)) showDialogue(scene);
  });

  ipcMain.on('pet:bubble-reply', (event, payload) => {
    const bubbleWindow = bubble?.getWindow();
    if (!bubbleWindow || bubbleWindow.isDestroyed() || event.sender !== bubbleWindow.webContents) return;
    if (isQuitting || screenLocked || !bubbleWindow.isVisible() || !petWindow?.isVisible()) return;
    if (!payload || !Number.isInteger(payload.id)) return;
    const action = dialogue.respond(payload.id, payload.action, performance.now());
    if (!action) return;
    hideBubble();
    if (action?.command === 'app-update') {
      if (action.open && availableUpdate?.latestVersion === action.version) void showUpdateResult(availableUpdate);
    } else if (action?.command === 'codex') void routeCodexAction(action.descriptor);
    else sendCommand(action);
  });

  ipcMain.on('pet:bubble-resize', (event, payload) => {
    const bubbleWindow = bubble?.getWindow();
    if (!bubbleWindow || bubbleWindow.isDestroyed() || event.sender !== bubbleWindow.webContents) return;
    bubble.resize(payload);
  });

  ipcMain.on('pet:drag-start', (event, rawPoint) => {
    if (!fromPetWindow(event) || screenLocked || !petWindow.isVisible()) return;
    const point = validPoint(rawPoint);
    if (!point) return;
    // 页面已在 pointerdown 清理待执行互动；不发送全局 stop，避免迟到后误杀新双击。
    stopMotion({ notifyRenderer: false });
    edgeTuck?.beginDrag();
    const [x, y] = petWindow.getPosition();
    dragState = { pointer: point, window: { x, y }, moved: false };
  });

  ipcMain.on('pet:drag-move', (event, rawPoint) => {
    if (!fromPetWindow(event) || !dragState || screenLocked) return;
    const point = validPoint(rawPoint);
    if (!point) return;
    if (Math.hypot(point.x - dragState.pointer.x, point.y - dragState.pointer.y) > 6) dragState.moved = true;
    petWindow.setPosition(
      dragState.window.x + point.x - dragState.pointer.x,
      dragState.window.y + point.y - dragState.pointer.y,
      false
    );
  });

  ipcMain.on('pet:drag-end', event => {
    if (!fromPetWindow(event) || !dragState) return;
    const moved = dragState.moved;
    dragState = null;
    if (!screenLocked) {
      const anchor = hostMotion?.anchor;
      const visible = anchor && ensureVisibleBounds(anchor, screen.getAllDisplays(), screen.getPrimaryDisplay());
      if (!moved && anchor && anchor.x === visible.x && anchor.y === visible.y &&
        anchor.width === visible.width && anchor.height === visible.height) {
        // macOS 屏幕边缘下，pointerup 可能晚于双击动作到达主进程。
        // 动作锚点仍完整可见时只记住锚点，不把中途动画帧落盘。
        settings.x = anchor.x;
        settings.y = anchor.y;
        persistSettings();
      } else {
        // Only a real drag can dock. Keep a late click release from interrupting a new motion.
        if (moved || anchor) stopMotion({ notifyRenderer: false });
        const next = ensureVisibleBounds(petWindow.getBounds(), screen.getAllDisplays(), screen.getPrimaryDisplay());
        petWindow.setPosition(next.x, next.y, false);
        edgeTuck?.endDrag(moved);
        persistWindowPosition();
      }
      if (edgeTuck?.getPresentation().dragging) edgeTuck.endDrag(false);
    }
  });

  ipcMain.on('pet:bounce', event => {
    if (!fromPetWindow(event) || screenLocked || presentationSuppressed() || !petWindow.isVisible()) return;
    startWindowBounce();
  });

  ipcMain.on('pet:motion-start', (event, request) => {
    if (!fromPetWindow(event) || screenLocked || presentationSuppressed() || !petWindow.isVisible() || !request ||
      !Number.isSafeInteger(request.token) || request.token <= 0 ||
      (!getMotion(request.action) && !CompanionMotion.getMotion(request.action))) return;
    thoughts?.hide();
    dismissCodexPresentation();
    stopWindowBounce();
    hostMotion = { owner: 'user', token: request.token, action: request.action, anchor: petWindow.getBounds() };
    const bounds = petWindow.getBounds();
    const side = PetFacing.resolve(bounds, screen.getDisplayMatching(bounds).workArea, request.side);
    if (!windowMotion.start({ token: request.token, action: request.action, side,
      reducedMotion: request.reducedMotion === true })) hostMotion = null;
  });

  ipcMain.on('pet:codex-availability', (event, packet) => {
    const snapshot = codexCompanion?.getSnapshot();
    if (!fromPetWindow(event) || !codexPageReady || !snapshot?.enabled || packet?.generation !== snapshot.generation ||
      packet.pageEpoch !== codexPageEpoch || typeof packet.available !== 'boolean') return;
    codexRenderer = { generation: packet.generation, pageEpoch: packet.pageEpoch, available: packet.available };
  });

  ipcMain.on('pet:codex-motion-ready', (event, request) => {
    if (!fromPetWindow(event) || !Number.isSafeInteger(request?.token) || request.token <= 0 ||
      !Number.isSafeInteger(request.alertId) || !Number.isSafeInteger(request.generation) ||
      !Number.isSafeInteger(request.pageEpoch) || request.pageEpoch <= 0 || !getMotion(request.action)) return;
    if (codexPresentation?.token === request.token && codexPresentation.id === request.alertId &&
      codexPresentation.generation === request.generation && codexPresentation.pageEpoch === request.pageEpoch) return;
    const snapshot = codexCompanion?.getSnapshot();
    const alert = snapshot?.currentAlert;
    const valid = settings.codexEnabled && snapshot?.enabled && codexHostAvailable() &&
      request.pageEpoch === codexPageEpoch && codexPresentation?.pageEpoch === codexPageEpoch &&
      alert?.id === request.alertId && alert.generation === request.generation && alert.motion === request.action &&
      codexPresentation?.id === alert.id && codexPresentation.generation === alert.generation && !codexPresentation.token;
    if (!valid) {
      sendCodexCommand({ command: 'codex-cancel', token: request.token, alertId: request.alertId,
        generation: request.generation, pageEpoch: request.pageEpoch });
      return;
    }
    codexPresentation.token = request.token;
    thoughts?.hide();
    hostMotion = { owner: 'codex', token: request.token, action: request.action, anchor: petWindow.getBounds() };
    const bounds = petWindow.getBounds();
    if (!windowMotion.start({ token: request.token, action: request.action,
      side: PetFacing.resolve(bounds, screen.getDisplayMatching(bounds).workArea) })) {
      dismissCodexPresentation();
      return;
    }
    const payload = dialogue.offerCodex(alert, performance.now(), alert.expiresAt - codexNow());
    if (payload) showBubble(payload);
  });

  ipcMain.on('pet:stop-motion', event => {
    if (fromPetWindow(event)) stopMotion({ notifyRenderer: false });
  });

  ipcMain.on('pet:context-menu', event => {
    if (!fromPetWindow(event)) return;
    showPetContextMenu();
  });
}

function registerDisplayRecovery() {
  const recover = () => {
    if (petWindow && !petWindow.isDestroyed()) {
      dragState = null;
      makeWindowVisible();
      edgeTuck?.recover();
      persistWindowPosition();
    }
    repositionBubble();
  };
  screen.on('display-added', recover);
  screen.on('display-removed', recover);
  screen.on('display-metrics-changed', (_event, _display, changedMetrics) => {
    if (Array.isArray(changedMetrics) && changedMetrics.length > 0 &&
      changedMetrics.every(metric => metric === 'workArea') && windowMotion.refreshWorkArea()) {
      repositionBubble();
      return;
    }
    recover();
  });
}

async function bootstrap() {
  if (IS_SMOKE_TEST) {
    const smokeDirectory = app.commandLine.getSwitchValue('user-data-dir');
    if (!smokeDirectory || fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(smokeDirectory)) {
      throw new Error(`冒烟检查必须使用独立设置目录：指定=${smokeDirectory} 实际=${app.getPath('userData')}`);
    }
    process.stdout.write('PET_USER_DATA_OK\n');
  }
  app.setActivationPolicy('accessory');
  if (app.dock) app.dock.hide();
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  apiUsage = createApiUsage({ filePath: path.join(app.getPath('userData'), 'openai-api-usage.enc'), safeStorage,
    ...(IS_SMOKE_TEST && process.env.PET_SMOKE_API_USAGE_ONLY === '1'
      ? { get: require('./scripts/verify-api-usage-integration').smokeGet,
        safeStorage: require('./scripts/verify-api-usage-integration').smokeStorage } : {}),
    onChange: state => {
      if (state.busy) apiLastAttemptAt = Date.now();
      if (apiUsageWindow && !apiUsageWindow.isDestroyed()) apiUsageWindow.webContents.send('pet:api-usage-state', state);
      syncApiUsageLabel();
    }
  });
  settings = loadSettings(settingsFile);
  settings.customization = { ...settings.customization, appearance: settings.startupAppearance };
  notesCompanion = createNotesCompanion({ BrowserWindow, screen, ipcMain, clipboard, dialog,
    organizer: createNotesOrganizer({ workspaceDir: path.join(app.getPath('userData'), 'notes-workspace') }),
    filePath: path.join(app.getPath('userData'), 'notes-todos.json'),
    getPetBounds: () => petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    getPetWindow: () => petWindow,
    getPetPresentation: () => ({ ...edgeTuck?.getPresentation(), shape: settings?.customization?.appearance?.shape }),
    getDefaultTab: () => settings.notesDefaultTab,
    isSuppressed: () => screenLocked || isQuitting,
    onComplete: () => { if (!screenLocked && !isQuitting) sendCommand({ command: 'again', motion: 'hop' }); },
    onError: error => writeError('便签与待办', error) });
  chatWindow = createChatWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getAppearance: () => effectiveAppearance(customizationPreviewAppearance || settings?.customization?.appearance),
    getAvatarImage: async appearance => {
      const key = JSON.stringify(appearance);
      for (let attempt = 0; attempt < 20; attempt++) {
        const preview = customizationPreviewAppearance && customizationWindow && !customizationWindow.isDestroyed()
          ? customizationWindow : null;
        if (preview) {
          const image = await preview.webContents.executeJavaScript(`(() => {
            const target = document.querySelector('#preview-ball');
            const canvas = target?.querySelector(':scope > .eb-rive-aurora.ready');
            if (!canvas || target.dataset.avatarAppearance !== ${JSON.stringify(key)}) return null;
            const box = target.getBoundingClientRect();
            const source = canvas.getBoundingClientRect();
            const crop = document.createElement('canvas');
            crop.width = crop.height = 96;
            const context = crop.getContext('2d');
            context.globalAlpha = Number(getComputedStyle(canvas).opacity);
            context.drawImage(canvas,
              (box.left - source.left) / source.width * canvas.width,
              (box.top - source.top) / source.height * canvas.height,
              box.width / source.width * canvas.width,
              box.height / source.height * canvas.height, 0, 0, 96, 96);
            return crop.toDataURL('image/png');
          })()`).catch(() => null);
          if (image) return image;
        } else if (petWindow && !petWindow.isDestroyed()) {
          const ready = await petWindow.webContents.executeJavaScript(`(() => {
            const target = document.querySelector('#pet');
            return target?.dataset.avatarAppearance === ${JSON.stringify(key)} &&
              Boolean(target.querySelector(':scope > .eb-rive-aurora.ready'));
          })()`).catch(() => false);
          if (ready) return (await petWindow.webContents.capturePage()).toDataURL();
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return null;
    },
    alwaysOnTop: settings.alwaysOnTop,
    onFollowStart: () => { if (edgeTuck?.getPresentation().side) edgeTuck.restore(); },
    onMoveEnd: persistWindowPosition,
    onVisibilityChange: () => syncQuotaLabel(codexCompanion?.getSnapshot()),
    onError: error => writeError('聊天面板', error) });
  chat = createChatCompanion({ store: createChatStore(path.join(app.getPath('userData'), 'chat.json')),
    workspaceDir: path.join(app.getPath('userData'), 'chat-workspace'),
    initialModelSelection: settings.chatModel,
    onModelSelection: chatModel => { settings = saveSettings(settingsFile, { ...settings, chatModel }); },
    createRpc: options => {
      if (IS_SMOKE_TEST && process.env.PET_SMOKE_CHAT_ONLY === '1') return require('./scripts/verify-chat-integration').createSmokeChatRpc(options);
      fs.mkdirSync(options.workspaceDir, { recursive: true, mode: 0o700 });
      return createCodexChatRpc(options);
    },
    onChange: state => { if (!screenLocked) chatWindow.update(chatSnapshot(state)); },
    onAction: performChatAction });
  dialogue = new DialogueDirector({ now: performance.now(), enabled: settings.bubblesEnabled });
  thoughts = createThoughtWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getObstacle: quotaObstacleBounds,
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('思考光迹窗口', error) });
  bubble = createBubbleWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    getShape: () => settings?.customization?.appearance?.shape,
    alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('气泡窗口', error)
  });
  quotaLabel = createQuotaLabelWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    getObstacle: quotaObstacleBounds,
    getSize: () => settings?.codexQuotaLabelSize,
    getAppearance: () => settings?.codexQuotaAppearance,
    getPresentation: () => ({
      ...edgeTuck?.getPresentation(),
      shape: settings?.customization?.appearance?.shape
    }),
    alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('额度标签窗口', error)
  });
  apiUsageLabel = createApiUsageLabelWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getQuotaWindow: () => quotaLabel?.getWindow(), getObstacleBounds: quotaObstacleBounds,
    getAppearance: () => settings?.codexQuotaAppearance,
    getPresentation: () => ({ ...edgeTuck?.getPresentation(), shape: settings?.customization?.appearance?.shape }),
    onOpenDetails: openApiUsage, alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('API 常驻卡片', error) });
  edgeNoticeWindow = createEdgeNoticeWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('边缘提示窗口', error) });
  edgeNotice = createEdgeNotice({ now: () => edgeNoticeNow(), onChange: payload => {
    safelyInvokeWindow('边缘提示', () => payload ? edgeNoticeWindow.show(payload) : edgeNoticeWindow.hide());
  } });
  activityMonitor = createActivityMonitor({
    screen, powerMonitor, getWindow: () => petWindow,
    onSample: packet => {
      if (!packet.locked) edgeTuck?.sampleCursor(packet.cursor);
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:activity', packet);
      tickEdgeNotice();
    },
    onError: error => writeError('活动状态检测', error)
  });
  const pause = () => {
    screenLocked = true;
    notesCompanion?.pause();
    if (customizationWindow && !customizationWindow.isDestroyed()) customizationWindow.hide();
    if (apiUsageWindow && !apiUsageWindow.isDestroyed()) apiUsageWindow.hide();
    chatWindow?.hide();
    void chat?.stop();
    dragState = null;
    safelyInvokeWindow('锁屏时停止动作', stopMotion);
    edgeTuck?.suspend();
    safelyInvokeWindow('锁屏时暂停活动监测', () => activityMonitor.pause());
    hideBubble();
    safelyInvokeWindow('锁屏时额度标签隐藏', () => quotaLabel?.hide());
    safelyInvokeWindow('锁屏时 API 卡片隐藏', () => apiUsageLabel?.hide());
    safelyInvokeWindow('锁屏时对白清理', () => dialogue.dismiss());
  };
  const resume = () => { screenLocked = false; notesCompanion?.resume(); edgeTuck?.resume(); activityMonitor.resume(); syncQuotaLabel(codexCompanion?.getSnapshot()); scheduleUpdateCheck(); };
  const powerGuard = createPowerGuard({ pause, resume });
  powerMonitor.on('lock-screen', () => powerGuard.setLocked(true));
  powerMonitor.on('suspend', () => powerGuard.setSuspended(true));
  powerMonitor.on('unlock-screen', () => powerGuard.setLocked(false));
  powerMonitor.on('resume', () => powerGuard.setSuspended(false));
  registerIpc();
  registerDisplayRecovery();
  initializeCodexCompanion();
  createPetWindow();
  createTray();
  if (process.argv.includes('--notes-preview')) notesCompanion.openPanel();
  scheduleUpdateCheck();
  if (settings.codexEnabled) void codexCompanion.setEnabled(true);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (settings) restorePet();
    if (argv.includes('--notes-preview')) notesCompanion?.openPanel();
  });

  app.on('before-quit', event => {
    const noteWindows = notesCompanion?.getWindows();
    const pendingReminders = notesCompanion?.getStore().getState().todos.some(item =>
      !item.deletedAt && !item.completed && ['pending', 'presented'].includes(item.reminderState));
    if (!quitCleanupStarted && !notesQuitReady && event?.preventDefault &&
      (pendingReminders || noteWindows?.panel || noteWindows?.notes.length || noteWindows?.reminder)) {
      event.preventDefault();
      if (!notesQuitFlight) notesQuitFlight = Promise.resolve(notesCompanion.close()).then(allowed => {
        notesQuitFlight = null;
        if (allowed) { notesQuitReady = true; setTimeout(() => app.quit(), 0); }
      }).catch(error => { notesQuitFlight = null; writeError('便签保存后退出', error); });
      return;
    }
    isQuitting = true;
    if (quitCleanupStarted) {
      if (!quitReady) event?.preventDefault?.();
      return;
    }
    quitCleanupStarted = true;
    if (!notesQuitReady) void notesCompanion?.close();
    clearTimeout(updateTimer);
    updateTimer = null;
    clearTimeout(apiRefreshTimer);
    apiRefreshTimer = null;
    apiUsage?.close();
    safelyInvokeWindow('退出时关于窗口销毁', () => aboutWindow?.destroy());
    let chatClosing;
    safelyInvokeWindow('退出时聊天停止', () => { chatClosing = chat?.close(); });
    if (event?.preventDefault && chatClosing?.then) {
      event.preventDefault();
      // Leave the cancelled native quit event before starting the next one.
      Promise.resolve(chatClosing)
        .catch(error => reportQuotaError('退出时聊天停止', error))
        .finally(() => setTimeout(() => { quitReady = true; app.quit(); }, 0));
    } else quitReady = true;
    safelyInvokeWindow('退出时聊天面板销毁', () => chatWindow?.destroy());
    edgeTuck?.dispose();
    edgeNotice?.reset();
    safelyInvokeWindow('退出时边缘提示销毁', () => edgeNoticeWindow?.destroy());
    codexConsentToken++;
    safelyInvokeWindow('退出时 Codex 联动清理', () => codexCompanion?.close());
    safelyInvokeWindow('退出时停止动作', stopMotion);
    safelyInvokeWindow('退出时活动监测清理', () => activityMonitor?.stop());
    destroyBubbleSafely();
    safelyInvokeWindow('退出时额度标签销毁', () => quotaLabel?.destroy());
    safelyInvokeWindow('退出时 API 卡片销毁', () => apiUsageLabel?.destroy());
    thoughts?.destroy();
    safelyInvokeWindow('退出时对白清理', () => dialogue?.dismiss());
  });

  app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
  });

  app.on('activate', () => {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  });

  app.whenReady().then(bootstrap).catch(error => {
    writeError('应用启动失败', error);
    app.exit(1);
  });
}
