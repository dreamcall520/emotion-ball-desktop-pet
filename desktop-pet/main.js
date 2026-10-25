const { createCodexIconPreference } = require('./lib/codex-icon-preference');
const { settingsEntries, findSettingsAction } = require('./lib/global-settings');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray
} = require('electron');
const { loadSettings, saveSettings, normalizePresetName, normalizeAppearancePresets, findDuplicateAppearancePreset } = require('./lib/settings');
const { createCodexPetStore } = require('./lib/codex-pets');
const {
  SIZES,
  defaultBounds,
  ensureVisibleBounds,
  positionWindowNearPet
} = require('./lib/window-placement');
const {
  BOUNCE_TOTAL_MS,
  bounceOffset
} = require('./lib/window-bounce');
const { createActivityMonitor, createPowerGuard } = require('./lib/activity-monitor');
const { DialogueDirector } = require('./lib/dialogue');
const { createBubbleWindow } = require('./lib/bubble-window');
const { getMotion } = require('./lib/interaction-motion');
const SheepSkin = require('./lib/sheep-skin');
const SheepTheme = require('./lib/sheep-theme');
const CompanionMotion = require('./lib/companion-motion');
const PetFacing = require('./lib/pet-facing');
const { createThoughtWindow } = require('./lib/thought-window');
const { createSheepOfferingWindow, normalizeState: normalizeSheepOfferingState } = require('./lib/sheep-offering-window');
const { createWindowMotion } = require('./lib/window-motion');
const { createCodexCompanion } = require('./lib/codex-companion');
const { buildCodexMenu, buildCodexResultMenu, resolveCodexAction, CONNECTION_LABELS } = require('./lib/codex-menu');
const { buildQuotaLabelModel, buildCodexDetailsModel } = require('./lib/codex-quota-view');
const { createQuotaHistory } = require('./lib/codex-quota-history');
const { quotaFreeStackBounds } = require('./lib/quota-label-placement');
const { createQuotaCardGroup, normalizeQuotaCards } = require('./lib/quota-card-group');
const { createQuotaCardGroupWindow } = require('./lib/quota-card-group-window');
let quotaCardGroup = null, quotaCardGroupWindow = null, quotaGroupLastActive = false;
const { createCodexDetailsWindow, ACTIONS: CODEX_DETAIL_ACTIONS } = require('./lib/codex-details-window');
const { isTaskId } = require('./lib/codex-state');
const { createQuotaLabelWindow } = require('./lib/quota-label-window');
const { createQuotaGuardWindow } = require('./lib/quota-guard-window');
const { createEdgeTuck } = require('./lib/edge-tuck');
const { createEdgeNotice } = require('./lib/edge-notice');
const { createEdgeNoticeWindow } = require('./lib/edge-notice-window');
const { createChatStore } = require('./lib/chat-store');
const { createChatCompanion } = require('./lib/chat-companion');
const { createCodexChatRpc } = require('./lib/codex-chat-rpc');
const { createChatWindow } = require('./lib/chat-window');
const { createChatSources } = require('./lib/chat-sources');
const { createZcodeLink } = require('./lib/zcode-link');
const { buildZcodeQuotaLabelModel } = require('./lib/zcode-quota-view');
const { createZcodeConsentWindow } = require('./lib/zcode-consent-window');
const { createZcodeChatRpc, resolveZcodeChatModel } = require('./lib/zcode-chat-rpc');
const { runWorkBuddy } = require('./lib/workbuddy-client');
const { createWorkBuddyQuota } = require('./lib/workbuddy-quota');
const { createWorkBuddyChat } = require('./lib/workbuddy-chat');
const { createWorkBuddyLabelWindow, safeState: safeWorkBuddyState } = require('./lib/workbuddy-label-window');
const { createWorkBuddyDetailsWindow } = require('./lib/workbuddy-details-window');
const { createWorkBuddyConsent } = require('./lib/workbuddy-consent-window');
const { createWorkBuddyUsage } = require('./lib/workbuddy-usage');
const { createWorkBuddyTasks } = require('./lib/workbuddy-tasks');
const { createNotesCompanion } = require('./lib/notes-companion');
const { createNotesOrganizer } = require('./lib/notes-organizer');
const { createPomodoro } = require('./lib/pomodoro');
const { createPomodoroWindows } = require('./lib/pomodoro-window');
const { createShortcutRegistrar } = require('./lib/shortcuts');
const { createShortcutWindow } = require('./lib/shortcut-window');
const { createApiUsage } = require('./lib/api-usage');
const { createApiUsageLabelWindow } = require('./lib/api-usage-label-window');
const { checkLatestRelease, downloadInstaller } = require('./lib/app-update');
const { createColorModeManager } = require('./lib/color-mode');
const { normalizeCustomization, normalizeAppearance, effectiveAppearance } = require('./lib/customization');
const QuotaDisplay = require('./lib/quota-display');

const APP_NAME = '球球桌宠';
const ACCEPTANCE_KIND = require('../package.json').qiuqiuAcceptance;
const IS_ACCEPTANCE = ['zcode', 'combined'].includes(ACCEPTANCE_KIND);
const ACCEPTANCE_NAME = ACCEPTANCE_KIND === 'combined' ? '球球桌宠-联动整合验收' : '球球桌宠-ZCode验收';
const APP_WEBSITE = 'https://qiuqiu.pet/';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IS_SMOKE_TEST = process.env.PET_SMOKE_TEST === '1';
const IS_CODEX_STATUS_SMOKE_ONLY = IS_SMOKE_TEST && process.env.PET_SMOKE_CODEX_STATUS_ONLY === '1';
const IS_CODEX_SMOKE_ONLY = IS_SMOKE_TEST && (process.env.PET_SMOKE_CODEX_ONLY === '1' || IS_CODEX_STATUS_SMOKE_ONLY);

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
let codexPets = null;
let dragState = null;
let bounceState = null;
let isQuitting = false;
let activityMonitor = null;
let dialogue = null;
let bubble = null;
let thoughts = null;
let sheepOfferingWindow = null;
let sheepQuotaInk = null;
let bubbleVisibilityBinding = null;
let quotaLabel = null;
let quotaGuard = null;
let quotaGuardSource = 'codex';
let codexDetails = null;
let codexDetailReturn = null;
let codexThreadOpener = url => shell.openExternal(url);
let chat = null;
let workbuddyChat = null;
let workbuddyQuota = null;
let workbuddyLabel = null;
let workbuddyDetails = null;
let workbuddyConsent = null;
let workbuddyTasks = null;
let workbuddyUsage = null;
let workbuddyRun = runWorkBuddy;
let workbuddyTaskOpener = url => shell.openExternal(url);
let workbuddyEnablePending = false;
let workbuddyEnableToken = 0;
let chatProviderChanging = false;
let chatWindow = null;
let zcodeLink = null;
let zcodeConsent = null;
let notesCompanion = null;
let pomodoro = null;
let pomodoroWindows = null;
let shortcutRegistrar = null;
let shortcutWindow = null;
let pomodoroQuiet = false;
let pomodoroNow = Date.now;
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
let downloadFlight = null;
let updateCheckManual = false;
let lastUpdateCheckAt = -Infinity;
let lastUpdateResult = null;
let availableUpdate = null;
let aboutWindow = null;
let aboutReady = false;
let aboutUpdateState = { state: 'idle' };
const API_REFRESH_MS = 5 * 60 * 1000;
let smokeCustomizationSaveFailure = false;
let screenLocked = false;
let codexCompanion = null;
let codexIconPreference = null;
let codexNow = Date.now;
let codexConsentFlight = null;
let codexConsentToken = 0;
let codexConsentWindow = null;
let codexConsentRequest = null;
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

app.setName(IS_ACCEPTANCE ? ACCEPTANCE_NAME : APP_NAME);
if (IS_ACCEPTANCE && !IS_SMOKE_TEST) {
  const acceptanceData = path.join(app.getPath('appData'), ACCEPTANCE_NAME);
  fs.mkdirSync(acceptanceData, { recursive: true, mode: 0o700 });
  app.setPath('userData', acceptanceData);
}
const colorModes = createColorModeManager({ getMode: () => settings?.colorMode,
  getAppearance: () => settings?.codexQuotaAppearance, getTheme: () => settings?.uiTheme });
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

function pomodoroSuppressed() {
  const presentation = edgeTuck?.getPresentation();
  return screenLocked || isQuitting || chatWindow?.isVisible() ||
    presentation?.mode === 'hidden' || presentation?.paused === true;
}

function openPomodoro() {
  if (isQuitting || screenLocked) return;
  // An explicit open takes precedence over chat's passive companion suppression.
  chatWindow?.hide();
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) restorePet();
  pomodoroWindows?.open();
}

function openShortcuts(showSettings = false) {
  if (screenLocked || isQuitting) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) restorePet();
  // ponytail: share the pet-side space; add obstacle layout if both panels must stay open.
  // Motion cleanup can synchronously refresh quota. Finish it while the guard
  // still suppresses the card, then cancel the card's requested visibility
  // before guard.close() repositions it and before shortcuts acquire their pin.
  stopMotion();
  quotaLabel?.hide();
  quotaGuard?.close();
  if (!shortcutWindow?.open({ settings: showSettings })) syncQuotaLabel(codexCompanion?.getSnapshot());
}

function openShortcutAction(id) {
  if (screenLocked || isQuitting) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) restorePet();
  if (id === 'launcher') { if (shortcutWindow?.isOpen()) shortcutWindow.close(); else openShortcuts(); return; }
  shortcutWindow?.close();
  if (id === 'chat') openChat();
  else if (id === 'custom') openCustomization();
  else if (id === 'note' || id === 'todo') {
    const field = id === 'note' ? 'noteBehavior' : 'todoBehavior';
    const create = shortcutRegistrar?.getConfig()[field] === 'create';
    notesCompanion?.openPanel({ tab: id, ...(create ? { create: true } : {}) });
  }
  else if (id === 'pomodoro') openPomodoro();
}

function saveShortcutConfig(config) {
  let nextSettings;
  const result = shortcutRegistrar.apply(config, shortcutSettings => {
    nextSettings = saveSettings(settingsFile, { ...settings, shortcutSettings });
  });
  if (result.ok) { settings = nextSettings; safelyInvokeWindow('快捷键保存后刷新菜单', refreshTrayMenu); }
  return result;
}

function initializeShortcuts() {
  shortcutRegistrar = createShortcutRegistrar({ globalShortcut, config: settings.shortcutSettings, onAction: openShortcutAction });
  shortcutRegistrar.start();
  shortcutWindow = createShortcutWindow({ BrowserWindow, ipcMain, screen,
    getPetWindow: () => petWindow,
    getPresentation: () => ({ ...edgeTuck?.getPresentation(), dragging: dragState?.moved === true, shape: settings?.customization?.appearance?.shape }),
    getConfig: () => shortcutRegistrar.getConfig(), getErrors: () => shortcutRegistrar.getErrors(),
    save: saveShortcutConfig,
    onAction: openShortcutAction,
    onPin: value => {
      // The controller keeps its presentation pin through the closing animation.
      // Apply the shared visibility rule before edge expansion can re-enter sync.
      syncQuotaLabel(codexCompanion?.getSnapshot());
      if (value) {
        dialogue?.dismiss(); hideBubble();
        dismissCodexPresentation();
      }
      if (value && edgeTuck?.getPresentation().mode === 'tucked' && petWindow && !petWindow.isDestroyed()) {
        const bounds = petWindow.getBounds();
        edgeTuck.sampleCursor({ x: bounds.x + bounds.width * (edgeTuck.getPresentation().side === 'left' ? .25 : .75), y: bounds.y + bounds.height / 2 });
      }
      edgeTuck?.pin(value, 'shortcuts');
    },
    onRecording: value => shortcutRegistrar.setRecording(value),
    isSuppressed: () => screenLocked || isQuitting || quotaGuard?.isVisible() === true ||
      dragState?.moved === true || Boolean(hostMotion && !['jelly', 'bow', 'spin', 'dizzy', 'turn', 'land'].includes(hostMotion.action) && !shortcutWindow?.isOpen()),
    onLayout: () => {
      if (shortcutDialogueSuppressed()) { dialogue?.dismiss(); hideBubble(); }
      else safelyInvokeWindow('快捷布局变化时气泡避让', () => bubble?.reposition());
      pomodoroWindows?.sync();
    },
    onError: error => writeError('快捷面板', error) });
  app.on('browser-window-focus', (_event, focused) => {
    // Native focus notifications may arrive after another window has taken focus.
    if (!focused || focused.isDestroyed() || !focused.isFocused()) return;
    if (!shortcutWindow?.getState().focus && focused !== shortcutWindow?.getWindow() && focused !== petWindow) shortcutWindow?.close();
  });
}

function syncPomodoro(snapshot = pomodoro?.getSnapshot()) {
  const quiet = snapshot?.quiet === true;
  if (quiet !== pomodoroQuiet) {
    pomodoroQuiet = quiet;
    codexCompanion?.setQuietMode(quiet);
    if (quiet) {
      clearCodexPresentation();
      dialogue?.dismiss();
      hideBubble();
      thoughts?.hide();
      edgeNotice?.reset();
    }
    sendCompanionSettings();
    tickEdgeNotice(true);
  }
  pomodoroWindows?.sync();
}

function savePomodoroForQuit() {
  const previous = isQuitting;
  isQuitting = true;
  const saved = pomodoro?.close().ok !== false;
  isQuitting = previous;
  if (!saved) void dialog.showMessageBox({ type: 'error', title: '番茄钟尚未保存',
    message: '番茄钟暂时无法保存，请检查本机存储后再退出。', buttons: ['知道了'] });
  return saved;
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

function functionWindowObstacles() {
  return [quotaLabel, apiUsageLabel, workbuddyLabel, shortcutWindow, quotaGuard, zcodeLink].flatMap(controller => {
    const win = controller?.getWindow();
    return win && !win.isDestroyed() && win.isVisible() ? [win.getBounds()] : [];
  });
}

function positionFunctionWindow(win) {
  positionWindowNearPet(win, petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null, screen, functionWindowObstacles());
}

let globalSettingsWindow = null;
let globalSettingsBusy = false;
let globalSettingsInitialView = 'common';

function codexIconSystemDark() { return codexIconPreference?.getSystemDark() === true; }
function refreshCodexIcon() { if (!screenLocked && !isQuitting) syncQuotaLabel(codexCompanion?.getSnapshot()); }

let petSleepState = 'unknown';
function setPetSleepState(state) {
  if (petSleepState === state) return;
  petSleepState = state;
  if (globalSettingsWindow && !globalSettingsWindow.isDestroyed()) {
    try { globalSettingsWindow.webContents.send('pet:global-settings-sleep-state', state); } catch (_) {}
  }
}

function globalSettingsSnapshot() {
  const current = codexCompanion?.getSnapshot(), quota = current?.quota;
  const tasks = current?.tasks?.state === 'connected' ? current.tasks.items : null;
  const fresh = quota?.state === 'connected' && quota.stale !== true;
  const model = fresh ? quotaLabelModel(current) : null;
  const codexStatus = { enabled: settings.codexEnabled === true,
    connection: CONNECTION_LABELS[quota?.state] || '待更新', stale: quota?.stale === true,
    quota: (model?.items || []).map(item => ({ label: `${item.label || 'Codex'} · ${item.period || (item.windowMinutes % 1440 === 0 ? `${item.windowMinutes / 1440}天` : `${item.windowMinutes / 60}小时`)}`,
      remaining: item.remaining, resetsAt: item.resetsAt })),
    updatedAt: quota?.updatedAt ?? null,
    tasks: { active: tasks ? tasks.filter(item => item.state === 'active').length : null,
      waiting: tasks ? tasks.filter(item => item.state === 'waiting').length : null },
    taskActionId: '/codex-menu/codex-tasks-open' };
  return { quotaCards: quotaCardConfig(), petSleepState: petWindow && !petWindow.isDestroyed() ? petSleepState : 'unknown', codexIconPreference: codexIconPreference?.getPreference() || 'codex-system', codexIconDark: codexIconSystemDark(), codexStatus, version: app.getVersion(), entries: settingsEntries(menuTemplate()),
    shortcuts: shortcutRegistrar?.getConfig(), initialView: globalSettingsInitialView,
    summary: [
      { label: '球球状态', value: edgeTuck?.getPresentation().mode === 'hidden' ? '暂时隐藏' : '陪伴中' },
      { label: 'Codex 联动', value: settings.codexEnabled ? '已启用' : '未启用' },
      { label: 'ZCode 联动', value: zcodeLink?.isEnabled() ? '已启用' : '未启用' },
      { label: 'API 统计', value: apiUsage?.getState().connected ? '已连接' : '未连接' },
      { label: '界面外观', value: { system: '跟随系统', light: '浅色', dark: '深色' }[settings.codexQuotaAppearance] }
    ] };
}

function fromGlobalSettings(event, requireVisible = true) {
  return !isQuitting && !screenLocked && globalSettingsWindow && !globalSettingsWindow.isDestroyed() &&
    (!requireVisible || globalSettingsWindow.isVisible()) && event.sender === globalSettingsWindow.webContents &&
    event.senderFrame === globalSettingsWindow.webContents.mainFrame;
}

function openGlobalSettings(view) {
  const target = view === 'shortcuts' ? 'shortcuts' : null;
  if (isQuitting || screenLocked) return;
  if (globalSettingsWindow && !globalSettingsWindow.isDestroyed()) {
    globalSettingsWindow.show(); globalSettingsWindow.focus();
    if (target) globalSettingsWindow.webContents.send('pet:global-settings-navigate', target);
    return;
  }
  globalSettingsInitialView = target || 'common';
  const win = new BrowserWindow({ width: 980, height: 760, minWidth: 620, minHeight: 480,
    title: '球球 · 设置中心', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#F5F7FB', show: false,
    webPreferences: { preload: path.join(__dirname, 'global-settings-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  globalSettingsWindow = win;
  win.on('blur', () => shortcutRegistrar?.setRecording(false));
  win.on('hide', () => shortcutRegistrar?.setRecording(false));
  win.webContents.on('render-process-gone', () => shortcutRegistrar?.setRecording(false));
  win.on('closed', () => shortcutRegistrar?.setRecording(false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { if (globalSettingsWindow === win) globalSettingsWindow = null; });
  win.once('ready-to-show', () => { if (!isQuitting && !screenLocked && !win.isDestroyed()) win.show(); });
  void win.loadFile(path.join(__dirname, 'global-settings.html')).catch(error => {
    writeError('全局设置', error); if (!win.isDestroyed()) win.destroy();
  });
}

function openApiUsage() {
  if (isQuitting || screenLocked) return;
  if (apiUsageWindow && !apiUsageWindow.isDestroyed()) {
    positionFunctionWindow(apiUsageWindow);
    apiUsageWindow.show();
    apiUsageWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 620, height: 700, minWidth: 460, minHeight: 520,
    title: 'OpenAI API 费用与用量', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#F5F7FB', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'api-usage-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged
    }
  });
  apiUsageWindow = win;
  positionFunctionWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('show',()=>syncQuotaLabel(codexCompanion?.getSnapshot()));
  win.on('hide',()=>syncQuotaLabel(codexCompanion?.getSnapshot()));
  win.on('closed', () => { if (apiUsageWindow === win) apiUsageWindow = null; syncQuotaLabel(codexCompanion?.getSnapshot()); });
  win.once('ready-to-show', () => {
    if (!isQuitting && !win.isDestroyed() && !screenLocked) { positionFunctionWindow(win); win.show(); }
  });
  void win.loadFile(path.join(__dirname, 'api-usage.html')).catch(error => writeError('API 费用面板', error));
}

function fromAboutWindow(event, requireVisible = false) {
  return Boolean(!isQuitting && !screenLocked && aboutWindow && !aboutWindow.isDestroyed() &&
    (!requireVisible || aboutWindow.isVisible()) && event.sender === aboutWindow.webContents);
}

function openAbout() {
  if (isQuitting || screenLocked) return;
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutReady) {
      if (!aboutWindow.isVisible()) positionFunctionWindow(aboutWindow);
      aboutWindow.show(); aboutWindow.focus();
    }
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
  positionFunctionWindow(win);
  aboutReady = false;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { if (aboutWindow === win) { aboutWindow = null; aboutReady = false; } });
  win.once('ready-to-show', () => {
    if (aboutWindow !== win || win.isDestroyed()) return;
    aboutReady = true;
    if (!isQuitting && !screenLocked) { positionFunctionWindow(win); win.show(); win.focus(); }
  });
  void win.loadFile(path.join(__dirname, 'about.html')).catch(error => {
    writeError('关于球球', error);
    if (!win.isDestroyed()) win.destroy();
  });
  return win;
}

function fromCodexConsentWindow(event) {
  return Boolean(!isQuitting && !screenLocked && codexConsentRequest?.ready && codexConsentWindow &&
    !codexConsentWindow.isDestroyed() && codexConsentWindow.isVisible() && event.sender === codexConsentWindow.webContents);
}

function finishCodexConsent(accepted = false) {
  const request = codexConsentRequest;
  if (!request) return false;
  codexConsentRequest = null;
  if (codexConsentWindow === request.win) codexConsentWindow = null;
  clearTimeout(request.timer);
  request.resolve(accepted === true);
  try { if (!request.win.isDestroyed()) request.win.destroy(); } catch (_) { /* The request is already invalidated. */ }
  return true;
}

function codexConsentInfo() {
  return { appearance: effectiveCustomization(settings.customization).appearance,
    codexPet: codexPetDescriptor(settings.customization.appearance) };
}

function requestCodexConsent() {
  if (isQuitting || screenLocked || codexConsentRequest) return Promise.resolve(false);
  const win = new BrowserWindow({
    width: 460, height: 656, resizable: false, maximizable: false, fullscreenable: false,
    title: '开启 Codex 联动', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: getNotesAppearance() === 'dark' ? '#242838' : '#EDF4FF', show: false,
    webPreferences: { preload: path.join(__dirname, 'codex-consent-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged }
  });
  let resolve;
  const result = new Promise(done => { resolve = done; });
  const request = { win, resolve, ready: false, timer: null };
  codexConsentWindow = win;
  codexConsentRequest = request;
  const cancel = () => { if (codexConsentRequest === request) finishCodexConsent(false); };
  request.timer = setTimeout(cancel, 30000);
  try {
    positionFunctionWindow(win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('did-fail-load', cancel);
    win.webContents.on('render-process-gone', cancel);
    win.on('closed', cancel);
    win.on('hide', cancel);
    win.once('ready-to-show', () => {
      if (codexConsentRequest !== request || win.isDestroyed()) return;
      if (isQuitting || screenLocked) { cancel(); return; }
      try {
        clearTimeout(request.timer); request.timer = null; request.ready = true;
        positionFunctionWindow(win); win.show(); win.focus();
        win.webContents.send('pet:codex-consent-info', codexConsentInfo());
      } catch (_) { cancel(); }
    });
    void win.loadFile(path.join(__dirname, 'codex-consent.html')).catch(cancel);
  }
  catch (_) { cancel(); }
  return result;
}

function setAboutUpdate(state) {
  aboutUpdateState = state;
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.webContents.send('pet:about-update-state', state);
}

function aboutReleaseState(result) {
  return { state: 'ready', currentVersion: result.currentVersion, latestVersion: result.latestVersion,
    hasUpdate: result.hasUpdate, downloadAvailable: Boolean(result.installer), downloadMessage: result.downloadMessage,
    ...(aboutUpdateState.latestVersion === result.latestVersion && aboutUpdateState.download
      ? { download: aboutUpdateState.download } : {}) };
}

function activeChat() { return chat; }

function chatSnapshot(state = activeChat()?.getState()) {
  return { ...state, provider: state?.source || 'codex', appUpdate: availableUpdate ? { latestVersion: availableUpdate.latestVersion } : null };
}

async function showUpdateResult(result) {
  setAboutUpdate(aboutReleaseState(result));
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
  if (pomodoroQuiet || shortcutWindow?.isPresenting() || isQuitting || screenLocked || chatWindow?.isVisible() || presentationSuppressed() ||
    !petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || dragState || hostMotion || bounceState) return false;
  const payload = dialogue?.offerUpdate(result.latestVersion, performance.now());
  return Boolean(payload && showBubble(payload));
}

function checkForUpdates(manual = false) {
  if (IS_ACCEPTANCE && !IS_SMOKE_TEST) {
    if (manual) { openAbout(); setAboutUpdate({ state: 'error', message: '独立验收版通过本次提供的安装包更新。' }); }
    return Promise.resolve();
  }
  if (downloadFlight) return downloadFlight;
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
      const handled = pomodoroQuiet || chatWindow?.isVisible() || showUpdateBubble(result) || await showUpdateResult(result);
      if (handled && settings.autoUpdateCheck !== false && !isQuitting) {
        settings.lastUpdateNotifiedVersion = result.latestVersion;
        persistSettings();
      }
    }
    if (!isQuitting && !screenLocked && (aboutUpdateState.latestVersion !== result.latestVersion ||
      aboutUpdateState.hasUpdate !== result.hasUpdate)) {
      setAboutUpdate(aboutReleaseState(result));
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
  if (IS_ACCEPTANCE) return;
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

function syncCustomizationVisibility() {
  const win = customizationWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:customization-visible', !screenLocked && win.isVisible() && !win.isMinimized());
}

function openCustomization() {
  if (isQuitting || screenLocked) return;
  if (customizationWindow && !customizationWindow.isDestroyed()) {
    positionFunctionWindow(customizationWindow);
    customizationWindow.show();
    customizationWindow.focus();
    syncCustomizationVisibility();
    return;
  }
  const win = new BrowserWindow({
    width: 960, height: 700, minWidth: 760, minHeight: 580, useContentSize: true,
    title: '定制球球', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: settings?.codexQuotaAppearance === 'dark' ||
      settings?.codexQuotaAppearance === 'system' && nativeTheme.shouldUseDarkColors ? '#263D42' : '#E0F5ED', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'customize-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged
    }
  });
  const [outerWidth, outerHeight] = win.getSize();
  const [contentWidth, contentHeight] = win.getContentSize();
  win.setMinimumSize(760 + outerWidth - contentWidth, 580 + outerHeight - contentHeight);
  customizationWindow = win;
  for (const event of ['show', 'hide', 'minimize', 'restore']) win.on(event, syncCustomizationVisibility);
  positionFunctionWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-fail-load', (_event, code, description) => writeError('定制面板加载', `${code} ${description}`));
  win.on('closed', () => {
    if (customizationWindow !== win) return;
    customizationWindow = null;
  });
  win.once('ready-to-show', () => {
    if (!isQuitting && !win.isDestroyed() && !screenLocked) { positionFunctionWindow(win); win.show(); }
    syncCustomizationVisibility();
  });
  void win.loadFile(path.join(__dirname, 'customize.html')).catch(error => writeError('定制面板', error));
}

function effectiveCustomization(value) {
  const customization = normalizeCustomization(value);
  return { ...customization,
    appearance: effectiveAppearance(customization.appearance) };
}

function codexPetDescriptor(appearance) {
  if (appearance?.shape !== 'codex-pet' || !codexPets) return null;
  let pet;
  try { pet = codexPets.getImported(appearance.codexPetId); }
  catch (_) {
    try { pet = codexPets.resolve(appearance.codexPetId); }
    catch (_) { return null; }
  }
  return { id: pet.id, name: pet.name, version: pet.version, rows: pet.rows,
    imageURL: pathToFileURL(pet.spritesheetPath).href };
}

function importCodexAppearance(appearance) {
  if (appearance.shape !== 'codex-pet') return appearance;
  let pet;
  try { pet = codexPets.getImported(appearance.codexPetId); }
  catch (_) { pet = codexPets.importPet(appearance.codexPetId); }
  return { ...appearance, codexPetId: pet.id };
}

async function prepareCodexAppearance(appearance) {
  const normalized = normalizeAppearance(appearance);
  if (normalized.shape !== 'codex-pet') throw new Error('宠物编号不合法');
  const copied = importCodexAppearance(normalized);
  const descriptor = codexPetDescriptor(copied);
  if (!descriptor || !customizationWindow || customizationWindow.isDestroyed()) throw new Error('宠物暂不可用');
  // nativeImage decodes PNG/JPEG. Chromium also decodes WebP; validate the durable copy before saving its reference.
  const dimensions = await customizationWindow.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: `new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = ${JSON.stringify(descriptor.imageURL)};
  })` }]);
  if (dimensions?.width !== 1536 || dimensions?.height !== descriptor.rows * 208) throw new Error('宠物图片无法解码');
  return copied;
}

function changeAppearancePreset(action, value) {
  if (IS_SMOKE_TEST && smokeCustomizationSaveFailure) return { ok: false, error: '操作未完成，请稍后重试' };
  if (!settings || isQuitting || !value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '操作未完成，请重试' };
  const presets = normalizeAppearancePresets(settings.appearancePresets);
  let next;
  if (action === 'add') {
    const name = normalizePresetName(value.name);
    if (!name) return { ok: false, error: '请输入 1–24 个字符的名称，勿包含控制字符' };
    if (!value.appearance || typeof value.appearance !== 'object' || Array.isArray(value.appearance)) return { ok: false, error: '形象未读取完成，请重试' };
    if (value.appearance.shape === 'codex-pet') {
      const normalized = normalizeAppearance(value.appearance);
      if (normalized.shape !== 'codex-pet') return { ok: false, error: '宠物暂不可用，请重新读取' };
      try { value = { ...value, appearance: importCodexAppearance(normalized) }; }
      catch (_) { return { ok: false, error: '宠物导入未完成，请重新读取后再试' }; }
    }
    const duplicate = findDuplicateAppearancePreset(presets, value.appearance);
    if (duplicate) return { ok: false, error: `已收藏为「${duplicate.name}」，无需重复保存` };
    if (presets.some(item => item.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: '已有同名形象，请换一个名称' };
    if (presets.length >= 20) return { ok: false, error: '最多保存 20 套形象，可先删除不再需要的形象' };
    next = [...presets, { id: randomUUID(), name, appearance: normalizeAppearance(value.appearance) }];
  } else {
    const index = presets.findIndex(item => item.id === value.id);
    if (index < 0) return { ok: false, error: '形象已不存在，请重新打开定制页' };
    if (action === 'rename') {
      const name = normalizePresetName(value.name);
      if (!name) return { ok: false, error: '请输入 1–24 个字符的名称，勿包含控制字符' };
      if (presets.some((item, at) => at !== index && item.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: '已有同名形象，请换一个名称' };
      next = presets.map((item, at) => at === index ? { ...item, name } : item);
    } else if (action === 'delete') next = presets.filter((_, at) => at !== index);
    else return { ok: false, error: '操作未完成，请重试' };
  }
  const previous = settings;
  settings = { ...settings, appearancePresets: next };
  try { persistSettings(); }
  catch (error) { settings = previous; writeError('保存我的形象', error); return { ok: false, error: '操作未完成，请稍后重试' }; }
  return { ok: true, presets: normalizeAppearancePresets(settings.appearancePresets).map(item => ({
    ...item, appearance: effectiveCustomization({ appearance: item.appearance }).appearance,
    codexPet: codexPetDescriptor(item.appearance) })) };
}

function saveCustomization(value, setAsStartupDefault = true, quotaDisplay) {
  if (IS_SMOKE_TEST && smokeCustomizationSaveFailure) return false;
  if (!settings || isQuitting) return false;
  const previous = settings;
  const customization = effectiveCustomization(value);
  if (value?.appearance?.shape === 'codex-pet') {
    if (customization.appearance.shape !== 'codex-pet') return false;
    try { customization.appearance = importCodexAppearance(customization.appearance); }
    catch (error) { writeError('导入 Codex 宠物', error); return false; }
  }
  settings = { ...settings, customization,
    startupAppearance: setAsStartupDefault ? customization.appearance : settings.startupAppearance };
  if (quotaDisplay !== undefined) {
    settings.quotaDisplay = QuotaDisplay.normalize(quotaDisplay, settings);
    if (settings.quotaDisplay.style === 'card') {
      settings.codexQuotaPeriod = settings.quotaDisplay.period === 'both' ? 'auto' : settings.quotaDisplay.period;
      settings.codexQuotaLabelSize = settings.quotaDisplay.cardSize;
    }
  }
  try { persistSettings(); }
  catch (error) {
    settings = previous;
    writeError('保存球球定制', error);
    return false;
  }
  sendCompanionSettings();
  chatWindow?.syncAppearance();
  repositionQuotaLabel();
  syncQuotaLabel();
  refreshTrayMenu();
  return true;
}

function openChat() {
  if (isQuitting || screenLocked || !activeChat()) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) restorePet();
  else if (edgeTuck?.getPresentation().side) edgeTuck.restore();
  stopMotion();
  dismissCodexPresentation();
  dialogue?.dismiss();
  hideBubble();
  thoughts?.hide();
  quotaGuard?.close();
  quotaLabel?.hide();
  zcodeLink?.hide();
  apiUsageLabel?.hide();
  workbuddyLabel?.hide();
  workbuddyDetails?.close();
  edgeNoticeWindow?.hide();
  chatWindow.show(chatSnapshot());
  pomodoroWindows?.sync();
  // Opening checks login and shows local history; only send() can create a thread.
  const state = chat.getState();
  const connection = !settings.codexEnabled && zcodeLink?.isEnabled() && state.source === 'codex' && !state.hasConversation
    ? chat.selectSource('zcode') : chat.connect();
  void connection.catch(() => {});
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
  const visible = Boolean(!pomodoroQuiet && !shortcutWindow?.isPresenting() && !isQuitting && !chatWindow?.isVisible() && codexPageReady && petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  const quotaEnabled = settings?.codexEnabled === true && settings.codexQuotaAlwaysVisible === true && !shortcutWindow?.isPresenting();
  const zcodeQuotaEnabled = settings?.zcodeEnabled === true && zcodeLink?.isEnabled()
    && settings.zcodeQuotaAlwaysVisible === true && !shortcutWindow?.isPresenting();
  edgeNotice?.tick({ presentation, visible, locked: screenLocked,
    bubblesEnabled: settings?.bubblesEnabled === true, quotaEnabled, zcodeQuotaEnabled,
    workbuddyEnabled: settings?.workbuddyEnabled === true && settings.workbuddyQuotaAlwaysVisible !== false, workbuddyState: workbuddyQuota?.getState(),
    appearance: settings?.codexQuotaAppearance,
    quotaModel: visible && quotaEnabled && presentation?.mode === 'tucked'
      ? buildQuotaLabelModel(codexCompanion?.getSnapshot(), { period: settings.codexQuotaPeriod, size: 'compact',
        showExtraCredits: settings.codexShowExtraCredits }, codexNow()) : null,
    zcodeQuotaModel: visible && !screenLocked && zcodeQuotaEnabled && presentation?.mode === 'tucked'
      ? buildZcodeQuotaLabelModel(zcodeLink.getSnapshot(), { size: 'compact' }) : null
  });
}

let lastPresentationMode = 'free', quotaEdgeFadeOut = false;
function applyPresentation(packet) {
  const previousMode = lastPresentationMode;
  lastPresentationMode = packet.mode;
  if (packet.mode !== 'tucked' || packet.paused || packet.cancelDrag) quotaEdgeFadeOut = false;
  else if (previousMode === 'peeked') quotaEdgeFadeOut = true;
  if (previousMode === 'tucked' && packet.mode === 'peeked' && !packet.dragging) {
    shortcutWindow?.wakeFromEdge(screen.getCursorScreenPoint());
  }
  sendPresentation(packet);
  if (packet.suppressed) {
    stopMotion();
    dialogue?.dismiss();
    hideBubble();
    safelyInvokeWindow('收起时额度标签隐藏', () => quotaLabel?.hide({ animate: quotaEdgeFadeOut }));
    safelyInvokeWindow('收起时守护战隐藏', () => quotaGuard?.close());
    safelyInvokeWindow('收起时 API 卡片隐藏', () => apiUsageLabel?.hide({ animate: quotaEdgeFadeOut }));
    zcodeLink?.hide({ animate: quotaEdgeFadeOut });
  } else syncQuotaLabel(codexCompanion?.getSnapshot());
  syncWorkBuddyLabel();
  tickEdgeNotice(true);
  pomodoroWindows?.sync();
  shortcutWindow?.sync();
  refreshTrayMenu();
}

function edgeRetentionBounds() {
  return [bubble, quotaLabel, apiUsageLabel, zcodeLink, workbuddyLabel, { getWindow: () => workbuddyLabel?.getGuardWindow?.() }, chatWindow, shortcutWindow, quotaGuard].flatMap(controller => {
    try {
      const win = controller?.getWindow();
      return win && !win.isDestroyed() && win.isVisible() ? [win.getBounds()] : [];
    } catch (_) { return []; }
  });
}

function dockPet(side) {
  shortcutWindow?.interrupt();
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
  zcodeLink?.hide();
}

function codexHostAvailable() {
  return !pomodoroQuiet && !shortcutWindow?.isPresenting() && codexPageReady && !isQuitting && !screenLocked && !chatWindow?.isVisible() && !shortcutWindow?.isPresenting() && !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible() &&
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

function quotaCardConfig() { return normalizeQuotaCards({order:settings?.quotaCardOrder,pinned:settings?.quotaCardPinned}); }
function quotaCardGroupInput() {
  const display=quotaDisplayConfig();
  return {config:quotaCardConfig(),eligible:[
    settings?.codexEnabled===true && settings.codexQuotaAlwaysVisible===true && (display.style==='card'||display.showNumbers) ? 'codex':null,
    settings?.openaiApiAlwaysVisible===true ? 'api':null,
    settings?.zcodeEnabled===true && settings.zcodeQuotaAlwaysVisible===true ? 'zcode':null,
    settings?.workbuddyEnabled===true && settings.workbuddyQuotaAlwaysVisible!==false ? 'workbuddy':null].filter(Boolean),
    suppressed:Boolean(isQuitting||screenLocked||dragState?.moved||pomodoroQuiet||presentationSuppressed()||shortcutWindow?.isPresenting()||chatWindow?.isVisible()||apiUsageWindow?.isVisible()||codexDetails?.isVisible()||zcodeLink?.isDetailsVisible?.()||workbuddyDetails?.isVisible?.()||quotaGuard?.isVisible?.()||!petWindow||petWindow.isDestroyed()||!petWindow.isVisible())};
}
function quotaCardCollected(id) { if(apiUsageWindow?.isVisible())return true; const state=quotaCardGroup?.getState(); return Boolean(state && state.eligible.includes(id) && !quotaCardGroupInput().suppressed && !state.visible.includes(id)); }
function syncQuotaCardGroup() { const state=quotaCardGroup?.sync(); if(state?.bar)quotaCardGroupWindow?.show(state);else quotaCardGroupWindow?.hide(); }
let quotaFreeStackKey = 'null', quotaFreeStackApplying = false;
function quotaFreeStackPlan() {
  const pet = petWindow && !petWindow.isDestroyed() && petWindow.isVisible() ? petWindow.getBounds() : null;
  if (!pet) return null;
  const area=screen.getDisplayMatching(pet).workArea,style=quotaDisplayConfig().style;
  return quotaFreeStackBounds(pet,area,
    {codex:quotaCardCollected('codex')?null:quotaLabel?.getLayoutMetrics?.(),api:quotaCardCollected('api')?null:apiUsageLabel?.getLayoutMetrics?.(),zcode:quotaCardCollected('zcode')?null:zcodeLink?.getLayoutMetrics?.(),workbuddy:quotaCardCollected('workbuddy')?null:workbuddyLabel?.getLayoutMetrics?.()},
    {...edgeTuck?.getPresentation(),quotaCardOrder:quotaCardConfig().order,quotaCardBarBounds:quotaCardGroupWindow?.getBounds(),shape:settings?.customization?.appearance?.shape,quotaStyle:style,
      facing:PetFacing.resolve(pet,area),sheepInk:sheepQuotaInk?.quotaStyle===style?sheepQuotaInk:null,
      sheepTheme:SheepTheme.resolveTheme(settings?.customization?.appearance?.sheepTheme,new Date())},quotaObstacleBounds());
}
function syncQuotaFreeStack() {
  if (quotaFreeStackApplying) return;
  quotaFreeStackApplying = true;
  try {
    for (let pass=0;pass<3;pass++) {
      const key=JSON.stringify(quotaFreeStackPlan());
      if (key===quotaFreeStackKey) break;
      quotaFreeStackKey=key;
      safelyInvokeWindow('三卡整组重排',()=>{quotaLabel?.reposition();apiUsageLabel?.reposition();zcodeLink?.reposition();workbuddyLabel?.reposition();});
    }
  } finally { quotaFreeStackApplying=false; }
}
function zcodeQuotaStackBounds() {
  return [quotaLabel?.getVisibleBounds(), apiUsageLabel?.getVisibleBounds?.()]
    .filter(Boolean).sort((a, b) => b.y + b.height - a.y - a.height)[0] || null;
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
  safelyInvokeWindow('守护战重排', () => quotaGuard?.reposition());
  try { quotaLabel?.reposition(); } catch (error) { reportQuotaError('额度标签重排', error); }
  safelyInvokeWindow('API 卡片重排', () => apiUsageLabel?.reposition());
  safelyInvokeWindow('ZCode 卡片重排', () => zcodeLink?.reposition());
  safelyInvokeWindow('WorkBuddy 卡片重排', () => workbuddyLabel?.reposition());
  safelyInvokeWindow('WorkBuddy 趋势重排', () => workbuddyDetails?.reposition());
}

function syncApiUsageLabel() {
  syncQuotaCardGroup();
  if (!apiUsage || !apiUsageLabel) return;
  const state = apiUsage.getState();
  const enabled = !isQuitting && settings?.openaiApiAlwaysVisible === true;
  const visible = enabled && !screenLocked && !chatWindow?.isVisible() && !shortcutWindow?.isPresenting() && !workbuddyDetails?.isVisible() && !codexDetails?.isVisible() && !zcodeLink?.isDetailsVisible() && !presentationSuppressed() &&
    petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
  safelyInvokeWindow('API 卡片同步', () => visible ? apiUsageLabel.show(state) : apiUsageLabel.hide({ animate: quotaEdgeFadeOut && !screenLocked && !isQuitting }));
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

function workBuddyCardState() {
  const state = workbuddyQuota?.getState(), tasks = workbuddyTasks?.getState();
  return { ...state, activity: { runningCount: null, unreadCount: tasks?.report?.pendingReview ?? null } };
}
function workBuddyDetailsState(action = workbuddyDetails?.getAction?.() || 'trend') {
  return { ...safeWorkBuddyState(workBuddyCardState()), action, usage: workbuddyUsage?.getState(), tasks: workbuddyTasks?.getState() };
}
async function openWorkBuddyTask(id) {
  if (!settings?.workbuddyEnabled || screenLocked || isQuitting || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return false;
  const accountKey = workbuddyQuota?.getState().accountKey;
  if (!accountKey || !workbuddyTasks?.getState().report?.items.some(item => item.id === id)) return false;
  try {
    const result = await workbuddyRun('task-open', { expectedAccountKey: accountKey, id });
    if (!settings.workbuddyEnabled || screenLocked || isQuitting || workbuddyQuota?.getState().accountKey !== accountKey ||
        result?.accountKey !== accountKey || result?.id !== id || result?.url !== `workbuddy://chat/${encodeURIComponent(id)}`) return false;
    await workbuddyTaskOpener(result.url);
    workbuddyTasks.dismiss(id);
    return true;
  } catch (_) { return false; }
}
function openWorkBuddyTasks(action = 'tasks') {
  if (!['tasks', 'results'].includes(action) || !settings?.workbuddyEnabled || screenLocked || isQuitting) return false;
  codexDetails?.close(); quotaGuard?.close();
  const opened = workbuddyDetails?.open(workBuddyDetailsState(action));
  void workbuddyTasks?.refresh();
  return opened === true;
}

function syncWorkBuddyLabel() {
  syncQuotaCardGroup();
  if (!workbuddyLabel || !workbuddyQuota) return;
  const eligible = settings?.workbuddyEnabled === true && !isQuitting && !screenLocked && !pomodoroQuiet &&
    !chatWindow?.isVisible() && !shortcutWindow?.isPresenting() && !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
  const visible = eligible && settings.workbuddyQuotaAlwaysVisible !== false && !zcodeLink?.isDetailsVisible() && !codexDetails?.isVisible() && !workbuddyDetails?.isVisible() && !quotaGuard?.isVisible();
  safelyInvokeWindow('WorkBuddy 积分显示', () => visible ? workbuddyLabel.show(workBuddyCardState()) : workbuddyLabel.hide({ animate: quotaEdgeFadeOut && !screenLocked && !isQuitting }));
  if (!eligible) workbuddyDetails?.close();
}

function setWorkBuddyPreference(name, value) {
  if (!settings?.workbuddyEnabled || isQuitting || typeof value !== 'boolean' ||
      !['workbuddyQuotaAlwaysVisible', 'workbuddyQuotaFunEnabled'].includes(name) || settings[name] === value) return false;
  try { settings = saveSettings(settingsFile, { ...settings, [name]: value }); }
  catch (_) { refreshTrayMenu(); return false; }
  if (!value && quotaGuardSource === 'workbuddy') quotaGuard?.close();
  syncWorkBuddyLabel();
  syncQuotaFreeStack();
  tickEdgeNotice(true);
  refreshTrayMenu();
  return true;
}

async function setWorkBuddyEnabled(value) {
  const enabled = value === true;
  if (!enabled) { workbuddyEnableToken++; workbuddyConsent?.cancel(); }
  if (enabled && settings.workbuddyEnabled !== true) {
    if (workbuddyEnablePending || isQuitting || screenLocked) return false;
    const token = ++workbuddyEnableToken;
    workbuddyEnablePending = true;
    try {
      if (!await workbuddyConsent?.request() || token !== workbuddyEnableToken || isQuitting || screenLocked) return false;
    } finally { workbuddyEnablePending = false; }
  }
  try {
    settings = saveSettings(settingsFile, { ...settings, workbuddyEnabled: enabled,
      ...(!enabled && settings.chatSource === 'workbuddy' ? { chatSource: 'codex', chatProvider: 'codex' } : {}) });
  } catch (_) { return false; }
  if (!enabled) { await chat?.workbuddyDisabled(); if (quotaGuardSource === 'workbuddy') quotaGuard?.close(); }
  workbuddyTasks?.setEnabled(enabled);
  workbuddyUsage?.setEnabled(enabled);
  workbuddyQuota?.setEnabled(enabled);
  syncWorkBuddyLabel();
  chatWindow?.update(chatSnapshot());
  refreshTrayMenu();
  return true;
}

async function setChatProvider(provider) {
  if (!['codex', 'zcode', 'workbuddy'].includes(provider) || isQuitting || screenLocked || chatProviderChanging) return { accepted: false };
  const state = chat?.getState();
  if (state?.busy || state?.connection === 'connecting' || state?.sourceChanging) return { accepted: false, error: '请先等待当前回复或连接完成。' };
  chatProviderChanging = true;
  try {
    if (provider === 'workbuddy' && !settings.workbuddyEnabled && !await setWorkBuddyEnabled(true)) return { accepted: false, error: 'WorkBuddy 设置未能保存。' };
    if (isQuitting || screenLocked) return { accepted: false };
    return await chat.selectSource(provider);
  } finally { chatProviderChanging = false; }
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

function shortcutDialogueSuppressed() {
  return Boolean(shortcutWindow?.isPresenting());
}

function showBubble(payload) {
  if (!payload || pomodoroQuiet || shortcutDialogueSuppressed() ||
    presentationSuppressed() || chatWindow?.isVisible()) return false;
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
  safelyInvokeWindow('番茄钟重排', () => pomodoroWindows?.reposition());
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

function quotaDisplayConfig({ fallback = true } = {}) {
  const config = QuotaDisplay.normalize(settings?.quotaDisplay, settings);
  // Liquid reserves need a separable ball body. Sprite pets retain their whole
  // original frame inside the rings; keep a pool preference for switching back.
  if (fallback && config.style === 'pool' && settings?.customization?.appearance?.shape === 'codex-pet') config.style = 'card';
  return config.style === 'card' ? { ...config,
    period: settings?.codexQuotaPeriod === 'auto' ? 'both' : settings?.codexQuotaPeriod || 'both',
    cardSize: settings?.codexQuotaLabelSize || 'compact' } : config;
}

function quotaDisplayModel(snapshot = codexCompanion?.getSnapshot()) {
  return buildQuotaLabelModel(snapshot, { period: 'auto', size: 'standard', showExtraCredits: false }, codexNow());
}

function quotaLabelModel(snapshot = codexCompanion?.getSnapshot()) {
  const display = quotaDisplayConfig();
  const model = buildQuotaLabelModel(snapshot, {
    period: display.style === 'card' ? settings.codexQuotaPeriod : 'auto',
    size: display.style === 'card' ? settings.codexQuotaLabelSize : 'compact',
    showExtraCredits: display.style === 'card' && settings.codexShowExtraCredits
  }, codexNow());
  model.codexIconPreference = codexIconPreference?.getPreference() || 'codex-system';
  model.codexIconDark = codexIconSystemDark();
  const numberPeriods = QuotaDisplay.periods(display, model);
  return display.style === 'card' || numberPeriods.length === 0 ? model : { ...model, display: 'numbers',
    items: model.items.filter(item => numberPeriods.includes(item.windowMinutes === 300 ? 'fiveHour' : 'weekly')),
    numberPeriods, numberColors: settings.customization.appearance };
}

function publishQuotaDisplay(snapshot, visible) {
  const model = quotaDisplayModel(snapshot), config = quotaDisplayConfig();
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:quota-display', { model, config, visible });
  if (customizationWindow && !customizationWindow.isDestroyed()) customizationWindow.webContents.send('pet:quota-display', model);
}

function syncQuotaLabel(snapshot = null) {
  syncQuotaCardGroup();
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
          !screenLocked && !chatWindow?.isVisible() && !workbuddyDetails?.isVisible() && !codexDetails?.isVisible() && !zcodeLink?.isDetailsVisible() && !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
      } catch (error) {
        reportQuotaError('额度标签状态', error);
      }
      const current = requestedSnapshot || codexCompanion?.getSnapshot();
      const display = quotaDisplayConfig();
      publishQuotaDisplay(current, Boolean(visible));
      if (shortcutWindow?.isPresenting()) visible = false;
      if (display.style !== 'card' && !display.showNumbers) visible = false;
      if (!visible) {
        shown = false;
        safelyInvokeWindow('额度隐藏时守护战隐藏', closeCodexQuotaGuard);
        try { quotaLabel.hide({ animate: quotaEdgeFadeOut && !screenLocked && !isQuitting }); } catch (error) { reportQuotaError('额度标签隐藏', error); }
        continue;
      }
      try {
        const labelModel = quotaLabelModel(current);
        quotaLabel.show(labelModel);
        if (quotaGuardSource === 'codex') quotaGuard?.update(labelModel);
        shown = true;
      } catch (error) {
        shown = false;
        reportQuotaError('额度标签同步', error);
        safelyInvokeWindow('额度同步失败时守护战隐藏', closeCodexQuotaGuard);
        try { quotaLabel.hide(); } catch (_) {}
      }
    }
    if (quotaSyncPending) {
      quotaSyncPending = false;
      quotaSyncSnapshot = null;
      shown = false;
      try { quotaLabel.hide(); } catch (_) {}
      reportQuotaError('额度标签同步', new Error('额度标签状态持续重入'));
      safelyInvokeWindow('额度同步重入时守护战隐藏', closeCodexQuotaGuard);
    }
    return shown;
  } finally {
    quotaSyncing = false;
    syncApiUsageLabel();
    zcodeLink?.sync();
    syncZcodeQuotaGuard();
    syncWorkBuddyLabel();
  }
}

function dismissCodexPresentation() {
  const alert = codexCompanion?.getSnapshot().currentAlert;
  if (!alert || !codexCompanion.dismiss(alert.id, alert.generation)) clearCodexPresentation();
}

function invalidateCodexPage() {
  setPetSleepState('unknown');
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
  codexThreadOpener = IS_SMOKE_TEST && typeof options.openThread === 'function' ? options.openThread : url => shell.openExternal(url);
  codexNow = options.now || Date.now;
  codexSentSettings = null;
  codexCompanion = createCodexCompanion({ ...options, now: codexNow,
    history: options.history || createQuotaHistory({ filePath: path.join(app.getPath('userData'), 'codex-status-history.json'),
      now: codexNow, onError: error => writeError('Codex 趋势记录', error) }), schedule: options.schedule || setTimeout,
    ignoreTask: id => chat?.ownsThread(id) === true,
    ignoreThread: row => typeof row?.cwd === 'string' && row.cwd.length > 0 &&
      path.resolve(row.cwd) === path.join(app.getPath('userData'), 'chat-workspace'),
    cancel: options.cancel || clearTimeout, canPresent: canPresentCodex, onAlert: presentCodexAlert,
    onAlertUpdate: alert => {
      const payload = dialogue?.updateCodex(alert, performance.now());
      if (payload) showBubble(payload);
    },
    onClear: clearCodexPresentation,
    onChange: snapshot => { syncCodexSettings(snapshot); syncQuotaLabel(snapshot); syncCodexDetails(snapshot); refreshTrayMenu(); }
  });
  codexCompanion.setPreferences({
    taskNameInAlerts: settings?.codexTaskNameInAlerts === true,
    quotaAlwaysVisible: settings?.codexQuotaAlwaysVisible === true,
    quotaPeriod: settings?.codexQuotaPeriod
  });
  codexCompanion.setQuietMode(pomodoroQuiet);
}

function codexDetailModel(snapshot, action, period) {
  const card = buildQuotaLabelModel(snapshot, { period: quotaDisplayConfig().style === 'card' ? settings?.codexQuotaPeriod : 'auto',
    size: settings?.codexQuotaLabelSize, showExtraCredits: settings?.codexShowExtraCredits }, codexNow());
  const selected = card.items.find(item => item.windowMinutes === period) || card.items[0];
  const model = buildCodexDetailsModel(snapshot, { action, period: selected?.windowMinutes || period,
    appearance: settings?.codexQuotaAppearance }, codexNow());
  return { ...model, action, generation: snapshot.generation, items: model.items.filter(item => card.items.some(row => row.windowMinutes === item.windowMinutes)),
    colorMode: settings?.colorMode === 'accessible' ? 'accessible' : 'standard',
    ...(codexDetailReturn ? { returnToTrend: true, returnPeriod: codexDetailReturn.period } : {}) };
}

function syncCodexDetails(snapshot = codexCompanion?.getSnapshot()) {
  if (!codexDetails?.isVisible()) return;
  if (isQuitting || screenLocked || snapshot?.enabled !== true) { codexDetails.close(); return; }
  codexDetails.update(codexDetailModel(snapshot, codexDetails.getAction(), codexDetails.getPeriod()));
}

function openCodexDetails(action, period) {
  if (!CODEX_DETAIL_ACTIONS.has(action) || isQuitting || screenLocked || settings?.codexEnabled !== true || !codexDetails) return false;
  workbuddyDetails?.close();
  quotaGuard?.close();
  if (action === 'opportunities' && codexDetails.getAction() === 'trend' && codexDetails.isVisible()) {
    codexDetailReturn = { period: codexDetails.getPeriod() };
  } else if (action !== 'opportunities' || !codexDetails.isVisible()) codexDetailReturn = null;
  return codexDetails.open(codexDetailModel(codexCompanion.getSnapshot(), action, period));
}

function fromQuotaLabel(event) {
  const win = quotaLabel?.getWindow();
  return Boolean(win && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame &&
    event.sender.getURL() === pathToFileURL(path.join(__dirname, 'quota-label.html')).href);
}

function canShowQuotaGuard() {
  if (quotaGuardSource === 'zcode') return Boolean(!isQuitting && !screenLocked && !shortcutWindow?.isPresenting()
    && settings?.zcodeEnabled === true && settings.zcodeQuotaAlwaysVisible === true && settings.zcodeQuotaFunEnabled !== false
    && !chatWindow?.isVisible() && !codexDetails?.isVisible() && !workbuddyDetails?.isVisible() && !presentationSuppressed()
    && zcodeLink?.isEnabled() && zcodeLink.isCardAvailable());
  if (quotaGuardSource === 'workbuddy') return Boolean(!isQuitting && !screenLocked && !shortcutWindow?.isPresenting() && settings?.workbuddyEnabled && settings.workbuddyQuotaAlwaysVisible !== false && settings.workbuddyQuotaFunEnabled !== false && !chatWindow?.isVisible() && !codexDetails?.isVisible() && !workbuddyDetails?.isVisible() && !presentationSuppressed() && petWindow?.isVisible());
  return Boolean(!isQuitting && !screenLocked && !shortcutWindow?.isPresenting() && settings?.codexEnabled === true &&
    settings.codexQuotaAlwaysVisible === true && settings.codexQuotaFunEnabled !== false &&
    !chatWindow?.isVisible() && !codexDetails?.isVisible() && !workbuddyDetails?.isVisible() && !zcodeLink?.isDetailsVisible() &&
    !presentationSuppressed() && petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
}

function zcodeGuardEntryAvailable() {
  return Boolean(!quotaLabel?.isGuardEntryVisible?.() && !(quotaGuard?.isVisible() && quotaGuardSource === 'codex'));
}

function closeCodexQuotaGuard() { if (quotaGuardSource === 'codex') quotaGuard?.close(); }

function syncZcodeQuotaGuard() {
  if (quotaGuardSource !== 'zcode' || !quotaGuard?.isVisible()) return;
  if (!canShowQuotaGuard()) quotaGuard.close();
  else quotaGuard.update(buildZcodeQuotaLabelModel(zcodeLink.getSnapshot(), { size: settings.zcodeQuotaLabelSize }));
}

function openQuotaGuard(source = 'codex') {
  if (source === 'zcode' && !zcodeGuardEntryAvailable()) return false;
  const previous = quotaGuardSource;
  quotaGuardSource = source === true || source === 'workbuddy' ? 'workbuddy' : source === 'zcode' ? 'zcode' : 'codex';
  if (!canShowQuotaGuard() || !quotaGuard) { quotaGuardSource = previous; return false; }
  const opened = quotaGuard.open(quotaGuardSource === 'workbuddy' ? { state: 'ready', items: [], practice: true } : quotaGuardSource === 'zcode'
    ? buildZcodeQuotaLabelModel(zcodeLink.getSnapshot(), { size: settings.zcodeQuotaLabelSize }) : quotaLabelModel());
  if (!opened) quotaGuardSource = previous;
  return opened;
}

async function openCodexDetailThread(id, turnId) {
  if (!isTaskId(id) || isQuitting || screenLocked || !codexDetails?.isVisible()) return false;
  const action = codexDetails.getAction();
  if (!['tasks', 'results'].includes(action)) return false;
  const snapshot = codexCompanion?.getSnapshot();
  if (snapshot?.enabled !== true) return false;
  const model = codexDetailModel(snapshot, action, codexDetails.getPeriod());
  const row = model[action]?.find(task => task.id === id && !task.unavailable &&
    (action !== 'results' || task.turnId === turnId));
  if (!row) return false;
  try {
    await codexThreadOpener(`codex://threads/${id.toLowerCase()}`);
    const current = codexCompanion?.getSnapshot();
    if (current?.generation === snapshot.generation && current.enabled === true) codexCompanion.markRead(id, row.turnId);
    return true;
  } catch (error) { writeError('打开 Codex 会话', error); return false; }
}

function setCodexPreference(name, value) {
  // Legacy callers share the application appearance; it does not depend on Codex.
  if (name === 'codexQuotaAppearance') return setInterfaceAppearance(value);
  if (!settings || settings.codexEnabled !== true || !codexCompanion || isQuitting) return false;
  const allowed = new Set([
    'codexTaskNameInAlerts', 'codexQuotaAlwaysVisible', 'codexQuotaPeriod', 'codexQuotaLabelSize',
    'codexShowExtraCredits', 'codexQuotaFunEnabled'
  ]);
  if (!allowed.has(name)) return false;
  const previous = settings[name];
  let next;
  if (name === 'codexQuotaPeriod') {
    next = ['auto', 'fiveHour', 'weekly'].includes(value) ? value : previous;
  } else if (name === 'codexQuotaLabelSize') {
    next = ['standard', 'compact'].includes(value) ? value : previous;
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
  syncCodexDetails();
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
    finishCodexConsent(false);
    const changed = settings.codexEnabled === true;
    settings.codexEnabled = false;
    if (changed) {
      try { quotaLabel?.destroy(); } catch (error) { reportQuotaError('额度标签销毁', error); }
      closeCodexQuotaGuard();
      codexDetails?.close();
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
  if (screenLocked || settings.codexEnabled || codexConsentFlight) return false;
  const token = ++codexConsentToken;
  const flight = {};
  codexConsentFlight = flight;
  try {
    const accepted = await requestCodexConsent();
    if (!accepted || token !== codexConsentToken || isQuitting || screenLocked) return false;
    const previous = {
      codexEnabled: settings.codexEnabled,
      codexTaskNameInAlerts: settings.codexTaskNameInAlerts,
      codexQuotaAlwaysVisible: settings.codexQuotaAlwaysVisible
    };
    // A user-confirmed off → on action enables both visible companion features.
    // Startup keeps explicit saved choices; turning off only stops the connection.
    settings.codexEnabled = true;
    settings.codexTaskNameInAlerts = true;
    settings.codexQuotaAlwaysVisible = true;
    try { persistSettings(); codexPreferenceWarning = null; }
    catch (_) {
      Object.assign(settings, previous);
      codexPreferenceWarning = '未能保存设置，Codex 联动仍保持关闭';
      return false;
    }
    codexCompanion.setPreferences({
      taskNameInAlerts: settings.codexTaskNameInAlerts,
      quotaAlwaysVisible: settings.codexQuotaAlwaysVisible,
      quotaPeriod: settings.codexQuotaPeriod
    });
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
      await codexThreadOpener(action.url);
      if (codexCompanion?.getSnapshot().generation === snapshot.generation) codexCompanion.markRead(action.taskId);
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
  notesCompanion?.syncAppearance();
  refreshTrayMenu();
  return true;
}

function setUiTheme(value) {
  if (!settings || isQuitting || !['green', 'blue'].includes(value) || settings.uiTheme === value) return false;
  const previous = settings.uiTheme;
  settings.uiTheme = value;
  try { persistSettings(); }
  catch (error) {
    settings.uiTheme = previous;
    writeError('保存主题色', error);
    refreshTrayMenu();
    return false;
  }
  colorModes.sync();
  refreshTrayMenu();
  return true;
}

function getNotesAppearance() {
  return settings?.codexQuotaAppearance === 'dark' || settings?.codexQuotaAppearance === 'system' && nativeTheme?.shouldUseDarkColors ? 'dark' : 'light';
}

// Keep the old programmatic entry point, with the same global behavior as the menu.
function setNotesAppearance(value) {
  return setInterfaceAppearance(value);
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
  if (!settings || isQuitting ||
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
  // themeSource is application-wide: system media queries and native controls
  // now follow this choice in standard and accessible modes alike.
  if (nativeTheme) nativeTheme.themeSource = value;
  colorModes.sync();
  notesCompanion?.syncAppearance();
  syncQuotaLabel(codexCompanion?.getSnapshot());
  syncCodexDetails();
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
    if (command?.command === 'sheep-offer') {
      const appearance = effectiveCustomization(settings.customization).appearance;
      const theme = SheepTheme.resolveTheme(appearance.sheepTheme, new Date());
      if (appearance.shape !== 'new-year-sheep' || !((theme === 'halloween' && command.kind === 'candy') || (theme === 'christmas' && command.kind === 'gift'))) return;
      command = { command: 'sheep-offer', kind: command.kind };
    } else if (command?.command === 'sheep-action') {
      const appearance = effectiveCustomization(settings.customization).appearance;
      if (appearance.shape !== 'new-year-sheep' || !SheepSkin.supportsAction(command.action, SheepTheme.resolveTheme(appearance.sheepTheme, new Date()))) return;
      command = { command: 'sheep-action', action: command.action };
    } else {
      if (command?.command !== 'again' || !getMotion(command.motion)) return;
      command = { command: 'again', motion: command.motion };
    }
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
    focusQuiet: pomodoroQuiet,
    bubblesEnabled: settings.bubblesEnabled,
    customization: effectiveCustomization(settings.customization),
    quotaDisplay: quotaDisplayConfig(),
    size: settings.size, codexPet: codexPetDescriptor(settings.customization.appearance)
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

function showDialogue(event, sheepAction) {
  if (pomodoroQuiet || shortcutDialogueSuppressed() || screenLocked || chatWindow?.isVisible() || presentationSuppressed() || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return null;
  const appearance = effectiveCustomization(settings.customization).appearance;
  const payload = dialogue.offer(event, performance.now(), { shape: appearance.shape,
    sheepTheme: SheepTheme.resolveTheme(appearance.sheepTheme, new Date()), sheepAction });
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
  const side = edgeTuck?.getPresentation().side;
  if (side === 'left' || side === 'right') {
    const area = screen.getDisplayMatching(next).workArea;
    next.x = Math.round(side === 'left' ? area.x : Math.max(area.x, area.x + area.width - next.width));
  }
  const previous = settings;
  settings = { ...settings, size: sizeName, x: next.x, y: next.y };
  try { persistSettings(); }
  catch (error) { settings = previous; throw error; }
  petWindow.setBounds(next, true);
  edgeTuck?.recover();
  sendCompanionSettings();
  if (customizationWindow && !customizationWindow.isDestroyed()) customizationWindow.webContents.send('pet:size', sizeName);
  refreshTrayMenu();
}

function setAlwaysOnTop(enabled) {
  settings.alwaysOnTop = Boolean(enabled);
  safelyInvokeWindow('球球窗口置顶', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  });
  safelyInvokeWindow('气泡窗口置顶', () => bubble?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('额度标签置顶', () => quotaLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('守护战置顶', () => quotaGuard?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('Codex 详情置顶', () => codexDetails?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('API 卡片置顶', () => apiUsageLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('WorkBuddy 卡片置顶', () => workbuddyLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('WorkBuddy 趋势置顶', () => workbuddyDetails?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('边缘提示置顶', () => edgeNoticeWindow?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('聊天面板置顶', () => chatWindow?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('ZCode 窗口置顶', () => zcodeLink?.setAlwaysOnTop(settings.alwaysOnTop));
  thoughts?.setAlwaysOnTop(settings.alwaysOnTop);
  sheepOfferingWindow?.setAlwaysOnTop(settings.alwaysOnTop);
  syncQuotaCardGroup();
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
  const cardSettingsEnabled = settings.codexEnabled === true && quotaDisplayConfig().style === 'card';
  return {
    id: 'codex-menu',
    label: 'Codex 与 API',
    submenu: [
      {
        id: 'codex-enabled', label: '启用 Codex 联动', type: 'checkbox', checked: settings.codexEnabled === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexEnabled === true;
          void setCodexEnabled(enabled); }
      },
      { type: 'separator' },
      {
        id: 'codex-task-names', label: '任务完成提醒显示名称', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexTaskNameInAlerts === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexTaskNameInAlerts === true;
          setCodexTaskNameInAlerts(enabled); }
      },
      {
        id: 'codex-quota-visible', label: '显示 Codex 额度', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexQuotaAlwaysVisible === true,
        click: item => { const enabled = item.checked; item.checked = settings.codexQuotaAlwaysVisible === true;
          setCodexPreference('codexQuotaAlwaysVisible', enabled); }
      },
      {
        id: 'codex-quota-fun', label: '额度趣味互动', type: 'checkbox',
        enabled: settings.codexEnabled === true, checked: settings.codexQuotaFunEnabled !== false,
        click: item => { const enabled = item.checked; item.checked = settings.codexQuotaFunEnabled !== false;
          setCodexPreference('codexQuotaFunEnabled', enabled); }
      },
      { id: 'codex-quota-settings', label: '经典额度卡设置', enabled: cardSettingsEnabled, submenu: [
        {
          id: 'codex-extra-credits', label: '显示额外点数', type: 'checkbox',
          enabled: cardSettingsEnabled, checked: settings.codexShowExtraCredits !== false,
          click: item => { const enabled = item.checked; item.checked = settings.codexShowExtraCredits !== false;
            setCodexPreference('codexShowExtraCredits', enabled); }
        },
        {
          id: 'codex-quota-period', label: '额度周期', enabled: cardSettingsEnabled,
          submenu: [
            ['auto', 'codex-quota-auto', '自动（按当前套餐）'],
            ['fiveHour', 'codex-quota-five-hour', '5 小时'],
            ['weekly', 'codex-quota-weekly', '周额度']
          ].map(([value, id, label]) => ({
            id, label, type: 'radio', enabled: cardSettingsEnabled,
            checked: settings.codexQuotaPeriod === value,
            click: item => {
              item.checked = settings.codexQuotaPeriod === value;
              setCodexPreference('codexQuotaPeriod', value);
            }
          }))
        },
        {
          id: 'codex-quota-label-size', label: '额度卡片大小', enabled: cardSettingsEnabled,
          submenu: [
            ['standard', 'codex-quota-label-standard', '标准'],
            ['compact', 'codex-quota-label-compact', '小巧']
          ].map(([value, id, label]) => ({
            id, label, type: 'radio', enabled: cardSettingsEnabled,
            checked: settings.codexQuotaLabelSize === value,
            click: item => {
              item.checked = settings.codexQuotaLabelSize === value;
              setCodexPreference('codexQuotaLabelSize', value);
            }
          }))
        },
      ] },
      ...(codexPreferenceWarning
        ? [{ id: 'codex-preference-warning', label: codexPreferenceWarning, enabled: false }]
        : []),
      { type: 'separator' },
      { id: 'openai-api-menu', label: 'OpenAI API', submenu: [
        { id: 'openai-api-usage', label: 'API 费用与用量', click: openApiUsage },
        { id: 'openai-api-visible', label: '显示 API 本月费用卡', type: 'checkbox',
          checked: settings.openaiApiAlwaysVisible === true,
          click: item => { const enabled = item.checked; item.checked = settings.openaiApiAlwaysVisible === true;
            setApiUsageVisible(enabled); } }
      ] },
      { id: 'codex-trend-open', label: '额度与趋势', enabled: settings.codexEnabled === true, click: () => openCodexDetails('trend') },
      { id: 'codex-tasks-open', label: '查看任务', enabled: settings.codexEnabled === true, click: () => openCodexDetails('tasks') },
      ...(settings.codexEnabled ? [{ id: 'codex-status', label: 'Codex 状态', submenu: [
        ...(codexNotice ? [{ label: codexNotice.text, enabled: false }, { type: 'separator' }] : []),
        ...bindCodexMenu(buildCodexMenu(codexCompanion?.getSnapshot(), codexNow()))
      ] }] : [])
    ]
  };
}

function menuTemplate() {
  const updateEntry = { id: 'update-check', label: availableUpdate ? `更新球球至 ${availableUpdate.latestVersion}`
    : updateCheck ? '正在检查更新' : '检查更新', enabled: Boolean(availableUpdate) || !updateCheck,
    click: () => { void (availableUpdate ? showUpdateResult(availableUpdate) : checkForUpdates(true)); } };
  return [
    ...(availableUpdate ? [updateEntry, { type: 'separator' }] : []),
    { id: 'global-settings', label: '设置中心', accelerator: 'CommandOrControl+,', click: openGlobalSettings },
    { id: 'chat-open', label: '和球球聊聊', click: openChat },
    { id: 'workbuddy-enabled', label: '启用 WorkBuddy 联动', type: 'checkbox', checked: settings.workbuddyEnabled,
      click: item => { void setWorkBuddyEnabled(item.checked); } },
    { id: 'workbuddy-quota-visible', label: '显示 WorkBuddy 积分卡', type: 'checkbox', enabled: settings.workbuddyEnabled === true, checked: settings.workbuddyQuotaAlwaysVisible !== false,
      click: item => { const enabled = item.checked; item.checked = settings.workbuddyQuotaAlwaysVisible !== false; setWorkBuddyPreference('workbuddyQuotaAlwaysVisible', enabled); } },
    { id: 'workbuddy-quota-fun', label: 'WorkBuddy 趣味游戏', type: 'checkbox', enabled: settings.workbuddyEnabled === true, checked: settings.workbuddyQuotaFunEnabled !== false,
      click: item => { const enabled = item.checked; item.checked = settings.workbuddyQuotaFunEnabled !== false; setWorkBuddyPreference('workbuddyQuotaFunEnabled', enabled); } },
    { id: 'customize-open', label: '定制球球', click: openCustomization },
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
    { id: 'shortcut-settings', label: '快捷键设置', click: () => openGlobalSettings('shortcuts') },
    { id: 'pomodoro-open', label: '番茄钟', click: openPomodoro },
    { type: 'separator' },
    { label: '球球与互动', submenu: [
      { label: '随机表情', click: () => sendCommand('random') },
      ...(settings.customization.appearance.shape === 'new-year-sheep' ? [{ label: '咩咩互动', submenu: [
        ['greet', SheepTheme.resolveTheme(effectiveCustomization(settings.customization).appearance.sheepTheme, new Date()) === 'spring-festival' ? '拱手拜年' : '咩咩问好', 'hello'], ['joy', '开心回应', 'play'],
        ['walk', '迈迈小蹄', 'play'], ['sleep', '暖暖打盹', 'sleep'],
        ...({
          none: [['ear', '揉揉耳朵', 'play'], ['bell', '抱住小铃铛', 'play'], ['stretch', '慢半拍伸懒腰', 'play']],
          halloween: [['candy', '送咩咩一颗糖', 'offering'], ['magic', '一点小魔法', 'play'], ['pumpkin', '抱抱南瓜', 'play']],
          christmas: [['receive-gift', '送咩咩一份礼物', 'offering'], ['gift', '咩咩递一份礼物', 'play'], ['scarf', '裹好小围巾', 'play'], ['snow', '接住小雪花', 'play']],
          'spring-festival': [['fortune', '送福到家', 'play'], ['firecrackers', '放鞭炮', 'play'], ['dumplings', '吃饺子', 'play']]
        }[SheepTheme.resolveTheme(effectiveCustomization(settings.customization).appearance.sheepTheme, new Date())])
      ].map(([action, label, scene]) => ({ label, click: () => {
        if (scene === 'offering') sendCommand({ command: 'sheep-offer', kind: action === 'candy' ? 'candy' : 'gift' });
        else if (action === 'sleep') sendCommand('sleep');
        else { sendCommand({ command: 'sheep-action', action }); showDialogue(scene, action); }
      } })) }] : []),
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
    ...(zcodeLink ? [zcodeLink.menu()] : []),
    { label: '贴边与显示', submenu: [
      { id: 'edge-left', label: '靠左收起', click: () => dockPet('left') },
      { id: 'edge-right', label: '靠右收起', click: () => dockPet('right') },
      { id: 'edge-leave', label: '离开边缘', enabled: Boolean(edgeTuck?.getPresentation().side), click: restorePet },
      { type: 'separator' },
      { id: 'edge-visibility', label: edgeTuck?.getPresentation().mode === 'hidden' ? '显示球球' : '暂时隐藏',
        click: () => edgeTuck?.getPresentation().mode === 'hidden' ? restorePet() : hidePet() }
    ] },
    { type: 'separator' },
    { label: '球球尺寸', submenu: sizeMenu() },
    {
      id: 'color-mode', label: '界面配色', submenu: [
        { id: 'color-appearance', label: '外观（所有窗口）',
          submenu: [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([value, label]) => ({
            id: `color-appearance-${value}`, label, type: 'radio', checked: settings.codexQuotaAppearance === value,
            click: () => setInterfaceAppearance(value)
          })) },
        { type: 'separator' },
        { id: 'ui-theme', label: '主题色', submenu: [['green', '薄荷绿'], ['blue', '晴空蓝']].map(([value, label]) => ({
          id: `ui-theme-${value}`, label, type: 'radio', checked: settings.uiTheme === value,
          click: () => setUiTheme(value)
        })) },
        { type: 'separator' },
        { id: 'color-accessible', label: '色弱友好（增强对比度）', type: 'checkbox', checked: settings.colorMode === 'accessible',
          click: item => setColorMode(item.checked ? 'accessible' : 'standard') }
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
    ...(!availableUpdate ? [updateEntry] : []),
    {
      label: '退出球球',
      click: () => app.quit()
    }
  ];
}

// Keep the full command catalog for settings; native menus expose destinations and the core Codex toggle.
function compactMenuTemplate() {
  const items = menuTemplate();
  const find = id => items.find(item => item.id === id);
  const notes = items.find(item => item.label === '便签与待办')?.submenu.find(item => item.id === 'notes-open');
  const codex = items.find(item => item.id === 'codex-menu').submenu;
  const codexEnabled = codex.find(item => item.id === 'codex-enabled');
  return [find('chat-open'), { ...find('customize-open'), label: '来定制球球' },
    notes && { ...notes, label: '便签与待办' }, find('pomodoro-open'),
    { type: 'separator' }, codexEnabled, zcodeLink?.menu().submenu[0], find('workbuddy-enabled'),
    { type: 'separator' }, find('global-settings'), find('about-open'), find('update-check'),
    { type: 'separator' }, items.find(item => item.label === '退出球球')].filter(Boolean);
}

function refreshTrayMenu() {
  if (!tray || !settings) return;
  tray.setContextMenu(Menu.buildFromTemplate(compactMenuTemplate()));
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
  shortcutWindow?.interrupt();
  return popupPetMenu(compactMenuTemplate());
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

    if (process.env.PET_SMOKE_ZCODE_STYLE_ONLY === '1') {
      await require('./scripts/verify-zcode-style').verifyZcodeStyle({ pet: petWindow, zcodeLink, zcodeConsent,
        codex: { request: requestCodexConsent, getWindow: () => codexConsentWindow },
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), getSettings: () => settings, powerMonitor, BrowserWindow, stopMotion });
      app.quit(); return;
    }

    if (process.env.PET_SMOKE_ZCODE_LINK_ONLY === '1') {
      await require('./scripts/verify-zcode-link').verifyZcodeLink({ pet: petWindow, chat, chatWindow, zcodeLink,
        openChat, BrowserWindow, getSettings: () => settings, getMenu: () => Menu.buildFromTemplate(menuTemplate()) });
      app.quit(); return;
    }

    if (process.env.PET_SMOKE_WORKBUDDY_ONLY === '1') {
      await require('./scripts/verify-workbuddy-integration').verifyWorkBuddyIntegration({
        pet: petWindow, quota: workbuddyQuota, label: workbuddyLabel, details: workbuddyDetails, tasks: workbuddyTasks, usage: workbuddyUsage,
        setTaskOpener: opener => { workbuddyTaskOpener = opener; }, getCompactMenu: compactMenuTemplate, apiLabel: apiUsageLabel, setApiVisible: setApiUsageVisible, shortcuts: shortcutWindow, openShortcuts, consent: workbuddyConsent, guard: quotaGuard, codexDetails, edge: edgeTuck, codexLabel: quotaLabel, chat, chatWindow,
        openChat, setProvider: setChatProvider, setEnabled: setWorkBuddyEnabled, getSettings: () => settings,
        getCodex: () => codexCompanion?.getSnapshot(), menuTemplate, setSize: setPetSize,
        edgeNotices: { tick: (time, state) => { edgeNoticeNow = () => 1000000000 + time; edgeNotice.tick(state); }, getWindow: () => edgeNoticeWindow.getWindow(), reset: () => { activityMonitor.stop(); edgeNoticeNow = () => performance.now(); lastEdgeNoticeTick = -Infinity; edgeNotice.reset(); } },
        outputDir: process.env.PET_SMOKE_WORKBUDDY_OUTPUT, live: process.env.PET_SMOKE_WORKBUDDY_LIVE === '1' });
      app.exit(0); return;
    }
    if (process.env.PET_SMOKE_SHORTCUT_ONLY === '1') {
      await require('./scripts/verify-shortcuts-integration').verifyShortcuts({
        pet: petWindow, controller: shortcutWindow, registrar: shortcutRegistrar,
        bubble, dialogue, showDialogue, showBubble, showUpdateBubble,
        screen, BrowserWindow, globalShortcut, edgeTuck, powerMonitor, settingsFile,
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), getSettings: () => settings,
        getWindows: () => ({ chat: chatWindow?.getWindow(), custom: customizationWindow,
          note: notesCompanion?.getWindows().panel, todo: notesCompanion?.getWindows().panel,
          pomodoro: BrowserWindow.getAllWindows().find(win => !win.isDestroyed() &&
            win.webContents.getURL().includes('/pomodoro.html?view=panel')) }), pomodoro
      });
      app.exit(0); return;
    }

    if (process.env.PET_SMOKE_POMODORO_ONLY === '1') {
      await require('./scripts/verify-pomodoro-integration').verifyPomodoro({
        pet: petWindow, service: pomodoro, windows: pomodoroWindows, BrowserWindow, powerMonitor,
        quotaLabel, edgeTuck, screen, notes: notesCompanion,
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), getSettings: () => settings,
        getQuiet: () => pomodoroQuiet, setClock: read => { pomodoroNow = read; }
      });
      app.exit(0); return;
    }

    if (process.env.PET_SMOKE_QUOTA_GUARD_ONLY === '1') {
      await require('./scripts/verify-quota-guard-integration').verifyQuotaGuardIntegration({
        pet: petWindow, label: quotaLabel, guard: quotaGuard, prepare: initializeCodexCompanion,
        getCompanion: () => codexCompanion, getSettings: () => settings, sync: syncQuotaLabel,
        setPreference: setCodexPreference, setTopmost: setAlwaysOnTop, hidePet, restorePet, ipcMain, powerMonitor,
        shortcuts: shortcutWindow, openShortcuts, screen, windows: pomodoroWindows, BrowserWindow,
        getMenuTemplate: menuTemplate, readSettings: () => loadSettings(settingsFile)
      });
      app.exit(0); return;
    }
    if (process.env.PET_SMOKE_QUOTA_DISPLAY_ONLY === '1') {
      persistSettings();
      await require('./scripts/verify-quota-display').verifyQuotaDisplay({ pet: petWindow, settingsFile, powerMonitor,
        open: () => {
          openCustomization(); customizationWindow.webContents.setBackgroundThrottling(false);
          return customizationWindow;
        }, about: openAbout,
        requestConsent: requestCodexConsent, getConsentWindow: () => codexConsentWindow,
        showNumbers: model => { quotaLabel.show(model); return quotaLabel.getWindow(); },
        previewSavedQuota: windows => {
          settings.codexEnabled = true; settings.codexQuotaAlwaysVisible = true;
          syncQuotaLabel({ enabled: true, quota: { state: 'connected', stale: false, updatedAt: codexNow(), windows } });
          return quotaLabel.getWindow();
        },
        sendModel: payload => petWindow.webContents.send('pet:quota-display', payload) });
      app.exit(0); return;
    }

    if (process.env.PET_SMOKE_FUNCTION_WINDOWS_ONLY === '1') {
      await require('./scripts/verify-function-windows').verifyFunctionWindows({
        pet: petWindow, screen, notes: notesCompanion, getObstacles: functionWindowObstacles,
        showCards: () => {
          quotaLabel.show({ state: 'ready', items: [{ label: 'Codex', windowMinutes: 10080, remaining: 95 }] });
          apiUsageLabel.show({ connected: true, busy: false, config: {}, report: null });
        },
        openers: [
          ['customize', () => { openCustomization(); return customizationWindow; }],
          ['notes', () => notesCompanion.openPanel()],
          ['api-usage', () => { openApiUsage(); return apiUsageWindow; }],
          ['about', openAbout]
        ]
      });
      app.exit(0); return;
    }
    if (process.env.PET_SMOKE_UI_THEME_ONLY === '1') {
      await require('./scripts/verify-ui-theme').verifyUiTheme({
        pet: petWindow, notes: notesCompanion, chat, settingsFile, nativeTheme,
        openWindows: () => { openChat(); openCustomization(); openApiUsage(); },
        getWindows: () => [petWindow, notesCompanion.getWindows().panel,
          ...notesCompanion.getWindows().notes, chatWindow.getWindow(), customizationWindow, apiUsageWindow],
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), getSettings: () => structuredClone(settings)
      });
      if (process.env.PET_SMOKE_UI_THEME_HOLD !== '1') app.exit(0);
      return;
    }
    if (process.env.PET_SMOKE_CODEX_PETS_ONLY === '1') {
      openCustomization();
      await require('./scripts/verify-codex-pets').verifyCodexPets({ pet: petWindow,
        customize: customizationWindow, openCustomization, openChat,
        getChatWindow: () => chatWindow.getWindow(), getSettings: () => settings,
        setSize: setPetSize, store: codexPets, packaged: app.isPackaged,
        getMenu: () => Menu.buildFromTemplate(menuTemplate()), nativeTheme,
        previewSavedQuota: windows => {
          const enabled = settings.codexEnabled, alwaysVisible = settings.codexQuotaAlwaysVisible;
          try {
            settings.codexEnabled = true; settings.codexQuotaAlwaysVisible = true;
            syncQuotaLabel({ enabled: true, quota: { state: 'connected', stale: false, updatedAt: codexNow(), windows } });
            return quotaLabel.getWindow();
          } finally {
            settings.codexEnabled = enabled; settings.codexQuotaAlwaysVisible = alwaysVisible;
          }
        } });
      app.exit(0); return;
    }

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
      assert.equal(editor.isVisible(), true, '定制形态验收使用真实可见窗口');
      editor.webContents.setBackgroundThrottling(false);
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
      await require('./scripts/verify-aurora-six-lobe').verifyAuroraSixLobe({ publicBuild: true,
        editor, pet: petWindow, chatWindow, getSettings: () => settings,
        readSettings: () => loadSettings(settingsFile), restore: value => {
          settings = value; persistSettings();
          sendCompanionSettings(); chatWindow?.syncAppearance(); return true;
        }, screen, monitor: activityMonitor, setSize: setPetSize, dock: dockPet,
        restoreEdge: () => edgeTuck.restore(), getPresentation: () => edgeTuck.getPresentation()
      });
      openCustomization();
      await waitFor(() => editor.webContents.executeJavaScript(`window.__customizerReady === true &&
        !document.hidden && Boolean(document.getElementById('preview-ball').dataset.renderedAppearance) &&
        Boolean(document.querySelector('#preview-ball svg .eb-head'))`));
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
      await require('./scripts/verify-customize-unified').verifyCustomizeUnified({
        pet: petWindow, editor: customizationWindow, chatWindow, open: openCustomization, setSize: setPetSize,
        getWindow: () => customizationWindow, getSettings: () => settings,
        readSettings: () => loadSettings(settingsFile),
        setSaveFailure: value => { smokeCustomizationSaveFailure = Boolean(value); },
        restore: value => { settings = value; persistSettings();
          sendCompanionSettings(); chatWindow.syncAppearance(); }
      });
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
              command: sendCommand,
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

    if (IS_CODEX_STATUS_SMOKE_ONLY) {
      await require('./scripts/verify-codex-status-v20').verifyCodexStatusV20({
        pet: petWindow, quotaLabel, details: codexDetails, BrowserWindow, screen,
        prepare: initializeCodexCompanion, getController: () => codexCompanion,
        getSettings: () => ({ ...settings }), openDetails: openCodexDetails,
        setQuotaPreference: setCodexPreference,
        setColorMode: mode => { settings.colorMode = mode; colorModes.sync(); },
        getSnapshot: () => codexCompanion.getSnapshot(),
        setEnabled: async enabled => { settings.codexEnabled = enabled; await codexCompanion.setEnabled(enabled); }
      });
      app.exit(0); return;
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
  let renderRecoveryTimer = null;

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
    activityMonitor?.stop();
    invalidateCodexPage();
    if (!isCurrentPetWindow()) return;
    writeError('渲染进程退出', JSON.stringify(details));
    if (IS_SMOKE_TEST) { app.exit(1); return; }
    clearTimeout(renderRecoveryTimer);
    if (isQuitting) return;
    renderRecoveryTimer = setTimeout(() => {
      renderRecoveryTimer = null;
      if (isCurrentPetWindow() && !createdPetWindow.isDestroyed() && !isQuitting && !codexPageReady) {
        createdPetWindow.webContents.reload();
      }
    }, 1000);
  });
  createdPetWindow.once('ready-to-show', () => {
    if (!isCurrentPetWindow() || createdPetWindow.isDestroyed()) return;
    createdPetWindow.showInactive();
    if (!isCurrentPetWindow()) return;
    syncQuotaLabel(codexCompanion?.getSnapshot());
    pomodoroWindows?.sync();
  });
  createdPetWindow.webContents.on('did-finish-load', () => {
    if (!isCurrentPetWindow()) return;
    clearTimeout(renderRecoveryTimer);
    renderRecoveryTimer = null;
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
    if (isCurrentPetWindow()) { invalidateCodexPage(); sheepOfferingWindow?.hide(); }
  });
  createdPetWindow.on('move', () => {
    if (!isCurrentPetWindow()) return;
    notesCompanion?.repositionReminder?.();
    sheepOfferingWindow?.reposition();
    shortcutWindow?.sync();
    syncQuotaCardGroup();
    if (chatWindow?.isFollowingChat?.()) return;
    thoughts?.hide(); repositionBubble(); edgeNoticeWindow?.reposition();
  });
  createdPetWindow.on('resize', () => {
    if (!isCurrentPetWindow()) return;
    sheepOfferingWindow?.update({eligible:false});
    dragState = null;
    shortcutWindow?.interrupt();
    stopMotion();
    edgeTuck?.recover();
    notesCompanion?.repositionReminder?.();
    if (isCurrentPetWindow()) repositionBubble();
  });
  createdPetWindow.on('show', () => {
    if (!isCurrentPetWindow()) return;
    if (edgeTuck?.getPresentation().mode === 'hidden') edgeTuck.restore();
    notesCompanion?.repositionReminder?.(true);
    pomodoroWindows?.sync();
  });
  createdPetWindow.on('hide', () => {
    // macOS may deliver hide after a quick hide/show pair. Do not hide a newly
    // reopened chat or re-tuck the pet for an obsolete native notification.
    if (!isCurrentPetWindow() || createdPetWindow.isVisible()) return;
    shortcutWindow?.interrupt();
    notesCompanion?.repositionReminder?.();
    dragState = null;
    chatWindow?.hide();
    if (edgeTuck?.getPresentation().mode !== 'hidden') edgeTuck?.hide();
    safelyInvokeWindow('隐藏时停止动作', stopMotion);
    if (!isCurrentPetWindow()) return;
    hideBubble();
    pomodoroWindows?.sync();
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时额度标签隐藏', () => quotaLabel?.hide());
    sheepOfferingWindow?.hide();
    safelyInvokeWindow('隐藏时守护战隐藏', () => quotaGuard?.close());
    safelyInvokeWindow('隐藏时 Codex 详情隐藏', () => codexDetails?.close());
    safelyInvokeWindow('隐藏时 API 卡片隐藏', () => apiUsageLabel?.hide());
    safelyInvokeWindow('隐藏时 ZCode 窗口隐藏', () => zcodeLink?.hide());
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时对白清理', () => dialogue?.dismiss());
  });
  let closedCleanupStarted = false;
  createdPetWindow.on('closed', () => {
    clearTimeout(renderRecoveryTimer);
    if (!isCurrentPetWindow() || closedCleanupStarted) return;
    closedCleanupStarted = true;
    setPetSleepState('unknown');
    shortcutWindow?.interrupt();
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
    safelyInvokeWindow('关闭时守护战销毁', () => quotaGuard?.destroy());
    safelyInvokeWindow('关闭时 Codex 详情销毁', () => codexDetails?.destroy());
    safelyInvokeWindow('关闭时 API 卡片销毁', () => apiUsageLabel?.destroy());
    safelyInvokeWindow('关闭时 ZCode 窗口隐藏', () => zcodeLink?.hide());
    thoughts?.destroy();
    sheepOfferingWindow?.destroy();
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
  ipcMain.handle('pet:global-quota-cards-save',(event,value)=>{
    if(!fromGlobalSettings(event))return {ok:false};
    const config=normalizeQuotaCards(value);
    try { settings=saveSettings(settingsFile,{...settings,quotaCardOrder:config.order,quotaCardPinned:config.pinned});
      syncQuotaLabel(codexCompanion?.getSnapshot());syncQuotaFreeStack();
      return {ok:true,config:quotaCardConfig(),snapshot:globalSettingsSnapshot()};
    } catch (_) {return {ok:false,error:'保存未完成，请重试。',config:quotaCardConfig(),snapshot:globalSettingsSnapshot()};}
  });
  ipcMain.handle('pet:global-shortcuts-save', (event, config) => {
    if (!fromGlobalSettings(event) || !shortcutRegistrar) return { ok: false };
    const result = saveShortcutConfig(config);
    shortcutWindow?.sync();
    return result;
  });
  ipcMain.on('pet:global-shortcuts-record', (event, value) => {
    if (fromGlobalSettings(event, false) && typeof value === 'boolean') shortcutRegistrar?.setRecording(value && fromGlobalSettings(event));
  });
  ipcMain.handle('pet:global-settings-get', event => fromGlobalSettings(event, false) ? globalSettingsSnapshot() : null);
  ipcMain.handle('pet:global-settings-action', async (event, id, checked) => {
    if (!fromGlobalSettings(event) || globalSettingsBusy || typeof id !== 'string') return { error: '当前无法修改，请稍后重试。' };
    const item = findSettingsAction(menuTemplate(), id);
    if (!item || (item.type === 'checkbox' && typeof checked !== 'boolean')) return { error: '该选项暂不可用，请刷新后重试。' };
    globalSettingsBusy = true;
    try {
      // Await consent instead of reporting success while its window is still open.
      if (item.id === 'codex-enabled') await setCodexEnabled(checked);
      else if (item.id === 'zcode-enabled') await zcodeLink?.setEnabled(checked);
      else if (item.id === 'workbuddy-enabled') await setWorkBuddyEnabled(checked);
      else await item.click({ ...item, checked: item.type === 'checkbox' ? checked : true });
      const current = findSettingsAction(menuTemplate(), id);
      const mismatch = current && (item.type === 'checkbox' && current.checked !== checked || item.type === 'radio' && !current.checked);
      return { snapshot: globalSettingsSnapshot(), ...(mismatch ? { error: '设置未更改，请确认授权或稍后重试。' } : {}) };
    } catch (_) { return { error: '操作未完成，请重试。', snapshot: globalSettingsSnapshot() }; }
    finally { globalSettingsBusy = false; }
  });
  ipcMain.handle('pet:codex-consent-get', event => fromCodexConsentWindow(event) ? codexConsentInfo() : null);
  ipcMain.handle('pet:codex-consent-answer', (event, accepted) => {
    if (!fromCodexConsentWindow(event) || typeof accepted !== 'boolean') return false;
    return finishCodexConsent(accepted);
  });
  ipcMain.handle('pet:about-get', event => fromAboutWindow(event)
    ? { version: app.getVersion(), website: APP_WEBSITE, developer: '春野', update: aboutUpdateState } : null);
  ipcMain.handle('pet:about-website', event => {
    if (!fromAboutWindow(event, true)) return false;
    return shell.openExternal(APP_WEBSITE).then(() => true, () => false);
  });
  ipcMain.handle('pet:about-update', async event => {
    if (!fromAboutWindow(event, true)) return false;
    await checkForUpdates(true);
    return true;
  });
  ipcMain.handle('pet:about-release', async event => {
    if (!fromAboutWindow(event, true) || aboutUpdateState.state !== 'ready' ||
      !availableUpdate || aboutUpdateState.latestVersion !== availableUpdate.latestVersion) return false;
    if (downloadFlight) return false;
    const release = availableUpdate;
    if (!release.installer) {
      setAboutUpdate({ ...aboutReleaseState(release), download: { state: 'error',
        message: release.downloadMessage || '暂未提供适合本机的安装包，请稍后再检查。' } });
      return false;
    }
    downloadFlight = downloadInstaller(event.sender, release.installer, {
      downloadsPath: app.getPath('downloads'),
      onProgress: progress => {
        if (!isQuitting && availableUpdate === release) setAboutUpdate({ ...aboutReleaseState(release), download: progress });
      }
    });
    try {
      const result = await downloadFlight;
      if (result.state === 'completed' && result.path && !isQuitting && !screenLocked) shell.showItemInFolder(result.path);
      return result.state === 'completed';
    } catch (error) {
      writeError('下载安装包', error);
      setAboutUpdate({ ...aboutReleaseState(release), download: { state: 'error', message: '下载未完成，请稍后重试。' } });
      return false;
    } finally { downloadFlight = null; }
  });
  ipcMain.on('pet:about-close', event => { if (fromAboutWindow(event)) aboutWindow.close(); });
  ipcMain.on('pet:quota-label-detail', (event, action, period) => { if (fromQuotaLabel(event)) openCodexDetails(action, period); });
  ipcMain.on('pet:quota-guard-open', event => { if (fromQuotaLabel(event) && quotaLabel.getWindow()?.isVisible()) openQuotaGuard(); });
  ipcMain.on('pet:quota-guard-close', event => { if (quotaGuard?.owns(event)) quotaGuard.close(); });
  ipcMain.on('pet:codex-details-close', event => { if (codexDetails?.owns(event)) { codexDetailReturn = null; codexDetails.close(); } });
  ipcMain.on('pet:codex-details-open', (event, action, period) => { if (codexDetails?.owns(event)) openCodexDetails(action, period); });
  ipcMain.on('pet:codex-details-thread', (event, id, turnId) => { if (codexDetails?.owns(event)) void openCodexDetailThread(id, turnId); });
  ipcMain.handle('pet:codex-details-read-all', (event, generation) => {
    if (!codexDetails?.owns(event) || !codexDetails.isVisible() || codexDetails.getAction() !== 'results' || isQuitting || screenLocked) return false;
    const snapshot = codexCompanion?.getSnapshot();
    if (snapshot?.enabled !== true || !Number.isSafeInteger(generation) || generation !== snapshot.generation) return false;
    try { return codexCompanion.markAllRead(); }
    catch (error) { writeError('标记 Codex 结果已读', error); return false; }
  });
  ipcMain.on('pet:codex-details-resize', (event, height) => { if (codexDetails?.owns(event)) codexDetails.resize(height); });
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
      appearancePresets: normalizeAppearancePresets(settings.appearancePresets).map(item => ({
        ...item, appearance: effectiveCustomization({ appearance: item.appearance }).appearance,
        codexPet: codexPetDescriptor(item.appearance) })),
      startupAppearance: effectiveAppearance(settings.startupAppearance),
      codexPet: codexPetDescriptor(settings.customization.appearance), size: settings.size,
      quotaDisplay: quotaDisplayConfig({ fallback: false }), quotaModel: quotaDisplayModel() } : null);
  ipcMain.handle('pet:codex-pets-list', event => {
    if (!fromCustomizationWindow(event) || screenLocked) return { ok: false, error: '请重新打开定制页后操作' };
    try {
      const sources = codexPets.list(), imported = codexPets.listImported();
      const library = new Map(sources.pets.map(pet => [pet.importedId, pet]));
      for (const pet of imported.pets) library.set(pet.importedId, { ...pet, imported: true });
      return { ok: true, skipped: sources.skipped + imported.skipped,
        pets: [...library.values()].map(pet => ({ id: pet.id, name: pet.name, importedId: pet.importedId,
          imported: pet.imported === true, version: pet.version, rows: pet.rows,
          imageURL: pathToFileURL(pet.spritesheetPath).href })) };
    } catch (error) { writeError('读取 Codex 宠物', error); return { ok: false, error: '暂时无法读取宠物，请稍后重试' }; }
  });
  ipcMain.handle('pet:customization-size', (event, size) => {
    if (!fromCustomizationWindow(event) || screenLocked || !Object.hasOwn(SIZES, size)) return false;
    try { setPetSize(size); return true; }
    catch (error) { writeError('调整球球尺寸', error); return false; }
  });
  for (const action of ['add', 'rename', 'delete']) ipcMain.handle('pet:appearance-preset-' + action, async (event, value) => {
    if (!fromCustomizationWindow(event) || screenLocked) return { ok: false, error: '请重新打开定制页后操作' };
    if (action === 'add' && value?.appearance?.shape === 'codex-pet') {
      try { value = { ...value, appearance: await prepareCodexAppearance(value.appearance) }; }
      catch (error) { writeError('校验 Codex 宠物', error); return { ok: false, error: '宠物导入未完成，请重新读取后再试' }; }
    }
    return fromCustomizationWindow(event) && !screenLocked
      ? changeAppearancePreset(action, value) : { ok: false, error: '请重新打开定制页后操作' };
  });
  ipcMain.handle('pet:customization-save', async (event, value, setAsStartupDefault, quotaDisplay) => {
    if (!fromCustomizationWindow(event) || screenLocked) return false;
    if (value?.appearance?.shape === 'codex-pet') {
      try { value = { ...value, appearance: await prepareCodexAppearance(value.appearance) }; }
      catch (error) { writeError('校验 Codex 宠物', error); return false; }
    }
    if (!fromCustomizationWindow(event) || screenLocked) return false;
    return saveCustomization(value, setAsStartupDefault, quotaDisplay);
  });
  ipcMain.handle('pet:chat-get', event => fromChatWindow(event) && !screenLocked ? chatSnapshot() : null);
  ipcMain.handle('pet:chat-open-update', event => {
    if (!fromChatWindow(event) || screenLocked || isQuitting || !chatWindow.isVisible() || !availableUpdate) return false;
    return showUpdateResult(availableUpdate);
  });
  ipcMain.handle('pet:chat-provider', (event, provider) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false };
    return setChatProvider(provider);
  });
  ipcMain.handle('pet:chat-send', (event, text) => {
    if (!fromChatWindow(event) || screenLocked || chatProviderChanging || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板并等待来源切换完成后再发送。' };
    return activeChat().send(text);
  });
  ipcMain.handle('pet:chat-stop', event => {
    if (fromChatWindow(event)) return activeChat().stop();
  });
  ipcMain.handle('pet:chat-new', event => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return activeChat().newChat();
  });
  ipcMain.handle('pet:chat-select', (event, id) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return activeChat().selectChat(id);
  });
  ipcMain.handle('pet:chat-model', (event, id) => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return activeChat().setModel(id);
  });
  ipcMain.handle('pet:chat-models-refresh', event => {
    if (!fromChatWindow(event) || screenLocked || !chatWindow.isVisible()) return { accepted: false, error: '请打开聊天面板后再操作。' };
    return activeChat().refreshModels();
  });
  ipcMain.handle('pet:chat-source', (event, source) => {
    if (!fromChatWindow(event) || event.senderFrame !== event.sender.mainFrame || screenLocked || !chatWindow.isVisible()) {
      return { accepted: false, error: '请打开聊天面板后再操作。' };
    }
    return setChatProvider(source);
  });
  ipcMain.on('pet:chat-close', event => { if (fromChatWindow(event)) chatWindow.hide(); });
  ipcMain.on('pet:sleep-state', (event, state) => {
    if (fromPetWindow(event) && event.senderFrame === event.sender.mainFrame && (state === 'awake' || state === 'sleep')) setPetSleepState(state);
  });
  ipcMain.on('pet:offering-state', (event, state) => {
    if (!fromPetWindow(event)) return;
    sheepOfferingWindow?.update(state);
    const next = normalizeSheepOfferingState(state);
    if (next?.theme !== 'christmas') sheepQuotaInk = null;
    else if (next.ink && !next.transient && state.settled === true) {
      sheepQuotaInk = { ...next, quotaStyle: quotaDisplayConfig().style };
      quotaLabel?.reposition();
    }
  });
  ipcMain.on('pet:offering-input', (event, input) => { sheepOfferingWindow?.handle(event,input); });
  ipcMain.on('pet:thought', (event, request) => {
    if (!fromPetWindow(event) || typeof request?.visible !== 'boolean') return;
    if (!request.visible) { thoughts?.hide(); return; }
    const snapshot = codexCompanion?.getSnapshot();
    if (pomodoroQuiet || !settings.codexEnabled || !codexPageReady || screenLocked || chatWindow?.isVisible() || presentationSuppressed() || dragState || hostMotion ||
        !petWindow.isVisible() || !snapshot?.tasks.items.some(task => task.state === 'active')) return;
    thoughts?.show(request);
  });
  ipcMain.on('pet:say', (event, scene) => {
    if (scene === 'thought' && !codexCompanion?.getSnapshot().tasks.items.some(task => task.state === 'active')) return;
    if (!fromPetWindow(event)) return;
    if (scene?.event === 'play' && scene.sheepAction !== undefined) {
      const appearance = effectiveCustomization(settings.customization).appearance;
      if (appearance.shape !== 'new-year-sheep' || !SheepSkin.supportsAction(scene.sheepAction, SheepTheme.resolveTheme(appearance.sheepTheme, new Date()))) return;
      showDialogue('play', scene.sheepAction);
    } else showDialogue(scene);
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
    shortcutWindow?.cancelHover();
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
    if (!dragState.moved && Math.hypot(point.x - dragState.pointer.x, point.y - dragState.pointer.y) > 6) {
      dragState.moved = true; shortcutWindow?.interrupt();
    }
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
    const appearance = effectiveCustomization(settings.customization).appearance;
    const theme = SheepTheme.resolveTheme(appearance.sheepTheme, new Date());
    const sheepAction = appearance.shape === 'new-year-sheep' ? SheepSkin.resolveAction(request.action, theme, 'codex') : null;
    const sheepTheme = sheepAction && require('./assets/sheep/manifest.json').themes[theme];
    const clip = sheepTheme?.actions[sheepAction];
    const baseDuration = clip?.durations.reduce((sum, ms) => sum + ms, 0);
    const legalDurations = [baseDuration];
    const reversePrefixes = bridge => {
      let sum = 0;
      return (bridge?.durations || []).map(ms => (sum += ms)).slice(1);
    };
    let leadingDurations;
    const targetWorking = sheepAction === 'working' || Boolean(clip?.startsAtWorking);
    if (targetWorking) {
      let sum = 0;
      const workHolds = sheepTheme?.workingTransition?.durations || [];
      leadingDurations = [...workHolds].reverse().map(ms => (sum += ms)).slice(1);
      if (workHolds.length) {
        const fullWork = workHolds.reduce((total, ms) => total + ms, 0);
        leadingDurations.push(...reversePrefixes(sheepTheme.idleTransition).map(ms => ms + fullWork));
        leadingDurations.push(...reversePrefixes(sheepTheme.sleepTransition).map(ms => ms + fullWork));
      }
    } else {
      leadingDurations = [...reversePrefixes(sheepTheme?.idleTransition), ...reversePrefixes(sheepTheme?.workingTransition), ...reversePrefixes(sheepTheme?.sleepTransition)];
    }
    // Only finite A/B/work/sleep bridge paths are legal; retain every bridge endpoint hold.
    const skipFirstHold = (targetWorking ? clip?.startsAtWorking : clip?.startsAtIdle) ? clip.durations[0] : 0;
    legalDurations.push(...leadingDurations.map(ms => baseDuration + ms - skipFirstHold));
    const durationMs = Number.isInteger(request.durationMs) && legalDurations.includes(request.durationMs)
      ? request.durationMs : baseDuration;
    if (!windowMotion.start({ token: request.token, action: request.action, durationMs,
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
    shortcutWindow?.interrupt();
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
  codexPets = createCodexPetStore({
    ...(IS_SMOKE_TEST && process.env.PET_CODEX_PETS_QA_SOURCE_ROOT ? { sourceRoot: process.env.PET_CODEX_PETS_QA_SOURCE_ROOT } : {}),
    importRoot: path.join(app.getPath('userData'), 'codex-pets'),
    readImageSize: (buffer, extension, size) => extension === '.png' ? nativeImage.createFromBuffer(buffer).getSize() : size
  });
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
  // The existing saved appearance wins over per-page legacy preferences.
  if (nativeTheme) nativeTheme.themeSource = settings.codexQuotaAppearance;
  // Theme choice survives restarts independently of the startup shape snapshot.
  settings.customization = { ...settings.customization, appearance: {
    ...settings.startupAppearance, sheepTheme: settings.customization.appearance.sheepTheme } };
  pomodoro = createPomodoro({ filePath: path.join(app.getPath('userData'), 'pomodoro.json'), now: () => pomodoroNow(),
    canEncourage: () => !pomodoroSuppressed() &&
      Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible() && !dragState && !hostMotion),
    onChange: syncPomodoro, onError: error => writeError('番茄钟记录', error) });
  pomodoroWindows = createPomodoroWindows({ BrowserWindow, ipcMain, screen,
    getPetWindow: () => petWindow,
    getPetBounds: () => petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    getPetPresentation: () => ({ ...edgeTuck?.getPresentation(), shape: settings?.customization?.appearance?.shape }),
    getWindowObstacles: functionWindowObstacles,
    getQuotaBounds: () => quotaLabel?.getVisibleBounds(),
    getQuotaWindowBounds: () => quotaLabel?.getWindow()?.getBounds(),
    getReminderBounds: () => {
      const win = notesCompanion?.getWindows().reminder;
      return win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null;
    },
    getSnapshot: () => pomodoro.getSnapshot(), onAction: (type, value) => pomodoro.action(type, value),
    isSuppressed: pomodoroSuppressed,
    onError: error => writeError('番茄钟窗口', error) });
  syncPomodoro();
  notesCompanion = createNotesCompanion({ BrowserWindow, screen, ipcMain, clipboard, dialog,
    organizer: createNotesOrganizer({ workspaceDir: path.join(app.getPath('userData'), 'notes-workspace') }),
    filePath: path.join(app.getPath('userData'), 'notes-todos.json'),
    getPetBounds: () => petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    getPetWindow: () => petWindow,
    getWindowObstacles: functionWindowObstacles,
    getPetPresentation: () => ({ ...edgeTuck?.getPresentation(), shape: settings?.customization?.appearance?.shape }),
    getDefaultTab: () => settings.notesDefaultTab,
    getAppearance: getNotesAppearance,
    getColorMode: () => settings.colorMode,
    isSuppressed: () => screenLocked || isQuitting,
    onComplete: () => { if (!pomodoroQuiet && !screenLocked && !isQuitting) sendCommand({ command: 'again', motion: 'hop' }); },
    onReminderLayout: () => pomodoroWindows?.sync(),
    onError: error => writeError('便签与待办', error) });
  nativeTheme?.on('updated', () => { if (settings.codexQuotaAppearance === 'system') notesCompanion?.syncAppearance(); });
  chatWindow = createChatWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getAppearance: () => effectiveAppearance(settings?.customization?.appearance),
    getCodexPet: appearance => codexPetDescriptor(appearance),
    getAvatarImage: async appearance => {
      const key = JSON.stringify(appearance);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (petWindow && !petWindow.isDestroyed()) {
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
      if (IS_SMOKE_TEST && (process.env.PET_SMOKE_CHAT_ONLY === '1' || process.env.PET_SMOKE_WORKBUDDY_ONLY === '1' || process.env.PET_SMOKE_CODEX_PETS_ONLY === '1' || process.env.PET_SMOKE_SHORTCUT_ONLY === '1')) return require('./scripts/verify-chat-integration').createSmokeChatRpc(options);
      fs.mkdirSync(options.workspaceDir, { recursive: true, mode: 0o700 });
      return createCodexChatRpc(options);
    },
    onChange: state => {
      if (chat?.sourceChanged) chat.sourceChanged('codex');
      else if (!screenLocked) chatWindow.update(chatSnapshot(state));
    },
    onAction: performChatAction });
  workbuddyRun = IS_SMOKE_TEST && process.env.PET_SMOKE_WORKBUDDY_ONLY === '1' && process.env.PET_SMOKE_WORKBUDDY_LIVE !== '1'
    ? require('./scripts/verify-workbuddy-integration').createSmokeWorkBuddyRunner() : runWorkBuddy;
  const makeWorkbuddyChat = () => (workbuddyChat = createWorkBuddyChat({ store: createChatStore(path.join(app.getPath('userData'), 'workbuddy-chat.json')),
    run: workbuddyRun, initialModelSelection: settings.workbuddyModel,
    onModelSelection: workbuddyModel => { settings = saveSettings(settingsFile, { ...settings, workbuddyModel }); },
    onChange: () => chat?.sourceChanged?.('workbuddy'),
    onAction: performChatAction }));
  workbuddyConsent = createWorkBuddyConsent({ BrowserWindow, ipcMain, positionWindow: positionFunctionWindow,
    getInfo: codexConsentInfo, getAppearance: getNotesAppearance, isPackaged: app.isPackaged,
    canRequest: () => !isQuitting && !screenLocked });
  workbuddyUsage = createWorkBuddyUsage({ run: workbuddyRun, getAccountKey: () => workbuddyQuota?.getState().accountKey,
    onChange: () => workbuddyDetails?.update(workBuddyDetailsState()) });
  workbuddyTasks = createWorkBuddyTasks({ run: workbuddyRun, stateFile: path.join(app.getPath('userData'), 'workbuddy-task-state.json'), getAccountKey: () => workbuddyQuota?.getState().accountKey,
    onChange: () => { syncWorkBuddyLabel(); workbuddyDetails?.update(workBuddyDetailsState()); } });
  workbuddyQuota = createWorkBuddyQuota({ run: workbuddyRun, historyFile: path.join(app.getPath('userData'), 'workbuddy-quota-history.json'), onChange: state => {
    workbuddyTasks.setEnabled(state.enabled); workbuddyUsage.setEnabled(state.enabled); syncWorkBuddyLabel(); workbuddyDetails?.update(workBuddyDetailsState());
    if (state.enabled && !state.busy && !state.error && state.report) { void workbuddyTasks.refresh(false); void workbuddyUsage.refresh(false); }
  } });
  workbuddyLabel = createWorkBuddyLabelWindow({ BrowserWindow, screen, getPetWindow: () => petWindow, getBubbleBounds: quotaObstacleBounds,
    getStackAnchor: () => {
      const api = apiUsageLabel?.getWindow();
      return zcodeLink?.getVisibleBounds?.() || (api && !api.isDestroyed() && api.isVisible() ? api.getBounds() : quotaLabel?.getVisibleBounds?.());
    },
    getPresentation: () => ({ ...edgeTuck?.getPresentation(), quotaAnimateHide: quotaEdgeFadeOut, quotaGroupHidden: quotaCardCollected('workbuddy') || quotaFreeStackPlan()?.hidden?.includes('workbuddy'), quotaGroupLayout: quotaFreeStackPlan()?.cards.workbuddy }),
    onLayout: syncQuotaFreeStack,
    getGuardEntry: () => settings.workbuddyEnabled === true && settings.workbuddyQuotaAlwaysVisible !== false && settings.workbuddyQuotaFunEnabled !== false
      && !(settings.zcodeQuotaFunEnabled !== false && zcodeLink?.isCardAvailable()) && !quotaLabel?.isGuardEntryVisible?.() && !codexDetails?.isVisible() && !workbuddyDetails?.isVisible(),
    getObstacles: () => [quotaLabel, apiUsageLabel, zcodeLink, bubble, shortcutWindow, quotaGuard].flatMap(controller => {
      if (controller === quotaLabel) { const card = quotaLabel?.getVisibleBounds?.(); return card ? [card] : []; }
      const win = controller?.getWindow();
      return win && !win.isDestroyed() && win.isVisible() ? [win.getBounds()] : [];
    }),
    getAppearance: () => settings.codexQuotaAppearance,
    alwaysOnTop: settings.alwaysOnTop,
    onRefresh: () => { void workbuddyQuota.refresh(); },
    onTrend: () => { codexDetails?.close(); quotaGuard?.close(); workbuddyDetails?.open(workBuddyDetailsState('trend')); void workbuddyUsage?.refresh(false); },
    onGuard: () => { openQuotaGuard(true); },
    onTasks: openWorkBuddyTasks,
    onError: () => {} });
  workbuddyDetails = createWorkBuddyDetailsWindow({ BrowserWindow, screen,
    getAnchor: () => { const card = workbuddyLabel?.getWindow(); return card && !card.isDestroyed() && card.isVisible() ? card.getBounds() : petWindow?.getBounds(); },
    getAppearance: () => settings.codexQuotaAppearance, alwaysOnTop: settings.alwaysOnTop,
    onRefreshTasks: () => { void workbuddyTasks?.refresh(); },
    onOpenTask: id => { void openWorkBuddyTask(id); },
    onClearTasks: () => { workbuddyTasks?.dismissAll(); },
    onVisibilityChange: () => { syncQuotaLabel(codexCompanion?.getSnapshot()); syncApiUsageLabel(); syncWorkBuddyLabel(); },
    onError: error => writeError('WorkBuddy 趋势窗口', error) });
  app.on('browser-window-created', (_event, win) => {
    for (const event of ['move', 'resize', 'show', 'hide', 'closed']) win.on(event, () => {
      if (win === petWindow || win === bubble?.getWindow()) syncWorkBuddyLabel();
    });
  });
  workbuddyQuota.setEnabled(settings.workbuddyEnabled);
  chat = createChatSources({ codex: chat, createWorkbuddy: makeWorkbuddyChat,
    isWorkbuddyEnabled: () => settings.workbuddyEnabled === true,
    initialSource: settings.chatSource,
    isZcodeEnabled: () => zcodeLink ? zcodeLink.isEnabled() : settings.zcodeEnabled === true,
    onSelect: chatSource => { settings = saveSettings(settingsFile, { ...settings, chatSource, chatProvider: chatSource === 'workbuddy' ? 'workbuddy' : 'codex' }); },
    onChange: state => { if (!screenLocked) chatWindow.update(chatSnapshot(state)); },
    createZcode: () => createChatCompanion({
      store: createChatStore(path.join(app.getPath('userData'), 'zcode-chat.json')),
      workspaceDir: path.join(app.getPath('userData'), 'zcode-chat-workspace'),
      providerName: 'ZCode', resolveModel: resolveZcodeChatModel,
      providerErrors: { UNSUPPORTED: '当前 ZCode 版本或登录方式暂不支持球球聊天，请更新 ZCode 或更换可用账号后重试。',
        VERIFICATION_REQUIRED: '请先在 ZCode 中完成安全验证后重试。',
        UNSAFE_CONFIG: '当前 ZCode 无法以仅聊天方式连接，请检查设置或更新 ZCode 后重试。' },
      initialModelSelection: settings.zcodeChatModel,
      onModelSelection: zcodeChatModel => { settings = saveSettings(settingsFile, { ...settings, zcodeChatModel }); },
      createRpc: options => {
        fs.mkdirSync(options.workspaceDir, { recursive: true, mode: 0o700 });
        return createZcodeChatRpc(options);
      },
      onChange: () => chat?.sourceChanged('zcode'), onAction: performChatAction
    }) });
  dialogue = new DialogueDirector({ now: performance.now(), enabled: settings.bubblesEnabled });
  sheepOfferingWindow = createSheepOfferingWindow({BrowserWindow,screen,getPetWindow:()=>petWindow,
    getTheme:()=>settings?.customization?.appearance?.shape==='new-year-sheep'?SheepTheme.resolveTheme(settings.customization.appearance.sheepTheme,new Date()):'none',
    getSuppressed:()=>screenLocked||!codexPageReady||presentationSuppressed()||edgeTuck?.getPresentation().mode!=='free',
    alwaysOnTop:settings.alwaysOnTop,
    onPointer:packet=>{
      if (packet.type === 'begin') shortcutWindow?.setSuspended(true);
      else if (packet.type === 'drop' || packet.type === 'cancel') shortcutWindow?.setSuspended(false);
      if(petWindow&&!petWindow.isDestroyed())petWindow.webContents.send('pet:offering-pointer',packet);
    },
    onError:error=>writeError('咩咩送物窗口',error)});
  thoughts = createThoughtWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getObstacle: quotaObstacleBounds,
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('思考光迹窗口', error) });
  bubble = createBubbleWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    getShape: () => settings?.customization?.appearance?.shape,
    getObstacles: () => {
      const state = shortcutWindow?.getState();
      if (!shortcutWindow?.isPresenting() || !state?.layout) return [];
      const { bounds, items } = state.layout;
      return state.view === 'floating' ? items.map(item => ({ ...item, x: bounds.x + item.x, y: bounds.y + item.y })) : [bounds];
    },
    alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('气泡窗口', error)
  });
  quotaLabel = createQuotaLabelWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    getObstacle: quotaObstacleBounds,
    getSize: () => quotaDisplayConfig().style === 'card' ? settings?.codexQuotaLabelSize : 'compact',
    getAppearance: () => settings?.codexQuotaAppearance,
    getGuardEntry: () => settings?.codexQuotaFunEnabled !== false,
    getSuppressed: () => shortcutWindow?.isPresenting() === true || codexDetails?.isVisible() === true || workbuddyDetails?.isVisible() === true || zcodeLink?.isDetailsVisible() === true || quotaGuard?.isVisible() === true,
    getPresentation: () => ({
      ...edgeTuck?.getPresentation(), quotaAnimateHide: quotaEdgeFadeOut,
      shape: settings?.customization?.appearance?.shape,
      quotaStyle: quotaDisplayConfig().style,
      quotaGroupHidden: quotaCardCollected('codex') || quotaFreeStackPlan()?.hidden?.includes('codex'), quotaGroupLayout: quotaFreeStackPlan()?.cards.codex,
      quotaGroupNeighbors: [apiUsageLabel?.getVisibleBounds?.(),zcodeLink?.getVisibleBounds(),workbuddyLabel?.getVisibleBounds?.()].filter(Boolean),
      sheepTheme: settings?.customization?.appearance?.sheepTheme,
      sheepInk: sheepQuotaInk?.quotaStyle === quotaDisplayConfig().style ? sheepQuotaInk : null
    }),
    alwaysOnTop: settings.alwaysOnTop,
    onLayout: () => { syncQuotaFreeStack(); pomodoroWindows?.sync(); zcodeLink?.reposition(); workbuddyLabel?.reposition(); },
    onError: error => writeError('额度标签窗口', error)
  });
  quotaGuard = createQuotaGuardWindow({ BrowserWindow, screen,
    getAnchor: () => petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    getObstacles: () => { const panel = pomodoroWindows?.getPanelBounds(); return panel ? [panel] : []; },
    getSize: () => quotaGuardSource === 'zcode' ? settings?.zcodeQuotaLabelSize : settings?.codexQuotaLabelSize,
    getAppearance: () => settings?.codexQuotaAppearance,
    canShow: canShowQuotaGuard,
    onLayout: () => pomodoroWindows?.sync(),
    onVisibilityChange: visible => {
      if (!visible) quotaGuardSource = 'codex';
      syncWorkBuddyLabel();
      if (visible) shortcutWindow?.interrupt();
      safelyInvokeWindow('守护战显隐时额度卡重排', () => { quotaLabel?.reposition(); zcodeLink?.reposition(); });
      pomodoroWindows?.sync();
    },
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('守护战窗口', error) });
  apiUsageLabel = createApiUsageLabelWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    getQuotaWindow: () => quotaLabel?.getWindow(), getObstacleBounds: quotaObstacleBounds,
    getQuotaBounds: () => quotaLabel?.getVisibleBounds(),
    getAppearance: () => settings?.codexQuotaAppearance,
    getPresentation: () => ({ ...edgeTuck?.getPresentation(), quotaAnimateHide: quotaEdgeFadeOut, shape: settings?.customization?.appearance?.shape,
      quotaStyle: quotaDisplayConfig().style, quotaGroupHidden: quotaCardCollected('api') || quotaFreeStackPlan()?.hidden?.includes('api'), quotaGroupLayout: quotaFreeStackPlan()?.cards.api }),
    onOpenDetails: openApiUsage, onLayout: () => { syncQuotaFreeStack(); zcodeLink?.reposition(); workbuddyLabel?.reposition(); }, alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('API 常驻卡片', error) });
  codexDetails = createCodexDetailsWindow({ BrowserWindow, screen,
    getAnchor: () => petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    onVisibilityChange: () => { safelyInvokeWindow('Codex 详情显隐时额度卡重排', () => quotaLabel?.reposition()); syncApiUsageLabel(); syncWorkBuddyLabel(); zcodeLink?.sync(); },
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('Codex 详情窗口', error) });
  zcodeConsent = createZcodeConsentWindow({ BrowserWindow, ipcMain,
    getInfo: codexConsentInfo, position: positionFunctionWindow, getAppearance: getNotesAppearance,
    isBlocked: () => isQuitting || screenLocked, onError: error => writeError('ZCode 授权窗口', error?.code || 'CONSENT_UNAVAILABLE') });
  zcodeLink = createZcodeLink({ BrowserWindow, screen, ipcMain,
    getSettings: () => settings,
    save: patch => { settings = saveSettings(settingsFile, { ...settings, ...patch }); },
    filePath: path.join(app.getPath('userData'), 'zcode-status-history.json'),
    getPetWindow: () => petWindow,
    getObstacles: () => [quotaLabel?.getVisibleBounds(), apiUsageLabel?.getWindow()?.isVisible()
      ? apiUsageLabel.getWindow().getBounds() : null, quotaObstacleBounds()].filter(Boolean),
    getPresentation: () => ({ ...edgeTuck?.getPresentation(), quotaAnimateHide: quotaEdgeFadeOut, shape: settings?.customization?.appearance?.shape,
      quotaBottomAligned: true, quotaStackBelow: zcodeQuotaStackBounds(),
      quotaStyle: quotaDisplayConfig().style, sheepTheme: settings?.customization?.appearance?.sheepTheme,
      quotaGroupHidden: quotaCardCollected('zcode') || quotaFreeStackPlan()?.hidden?.includes('zcode'), quotaGroupLayout: quotaFreeStackPlan()?.cards.zcode }),
    getSuppressed: () => isQuitting || screenLocked || chatWindow?.isVisible() || shortcutWindow?.isPresenting() || workbuddyDetails?.isVisible() || codexDetails?.isVisible() || presentationSuppressed(),
    onChange: () => { refreshTrayMenu(); tickEdgeNotice(true); syncZcodeQuotaGuard(); syncQuotaLabel(codexCompanion?.getSnapshot()); },
    getGuardEntry: zcodeGuardEntryAvailable,
    getCardSuppressed: () => quotaGuard?.isVisible() === true,
    onOpenGuard: () => openQuotaGuard('zcode'),
    onLayout: () => { syncQuotaFreeStack(); pomodoroWindows?.sync(); },
    onEnabledChanged: async enabled => {
      if (!enabled) await chat?.zcodeDisabled();
      else chat?.sourceChanged(settings.chatSource);
    },
    requestConsent: () => IS_SMOKE_TEST && process.env.PET_SMOKE_ZCODE_LINK_ONLY === '1'
      ? Promise.resolve(true) : zcodeConsent.open(),
    cancelConsent: () => zcodeConsent.cancel(),
    openTask: async id => {
      const result = await require('./lib/zcode-tasks').openZcodeTask(id);
      if (result?.opened || screenLocked || isQuitting) return;
      const choice = await dialog.showMessageBox({ type: 'info', title: 'ZCode 任务',
        message: '当前 ZCode 版本暂不支持直接定位单个任务。', detail: '可以在 ZCode 中按任务名称查看。',
        buttons: ['打开 ZCode', '关闭'], defaultId: 0, cancelId: 1, noLink: true });
      if (choice.response === 0 && !screenLocked && !isQuitting) await shell.openPath('/Applications/ZCode.app');
    },
    onError: error => writeError('ZCode 联动', error?.code || 'ZCODE_UNAVAILABLE') });
  edgeNoticeWindow = createEdgeNoticeWindow({ BrowserWindow, screen, getPetWindow: () => petWindow,
    alwaysOnTop: settings.alwaysOnTop, onError: error => writeError('边缘提示窗口', error) });
  edgeNotice = createEdgeNotice({ now: () => edgeNoticeNow(), ...(IS_SMOKE_TEST && process.env.PET_SMOKE_WORKBUDDY_ONLY === '1' ? { random: () => 0 } : {}), onChange: payload => {
    safelyInvokeWindow('边缘提示', () => payload ? edgeNoticeWindow.show(payload) : edgeNoticeWindow.hide());
  } });
  quotaCardGroupWindow = createQuotaCardGroupWindow({BrowserWindow,screen,ipcMain,onLayout:()=>syncQuotaFreeStack(),getAlwaysOnTop:()=>settings.alwaysOnTop,getPetWindow:()=>petWindow,getPresentation:()=>edgeTuck?.getPresentation(),
    onActivate:()=>quotaCardGroup?.activate(),onDismiss:()=>quotaCardGroup?.dismiss()});
  quotaCardGroup = createQuotaCardGroup({schedule:setTimeout,cancel:clearTimeout,now:()=>Date.now(),getState:quotaCardGroupInput,getCursor:()=>screen.getCursorScreenPoint(),
    getBounds:expanded=>[quotaCardGroupWindow?.getBounds(),...(expanded?[quotaLabel?.getVisibleBounds(),apiUsageLabel?.getVisibleBounds(),zcodeLink?.getVisibleBounds(),workbuddyLabel?.getVisibleBounds()]:[])].filter(Boolean),
    onChange:state=>{const changedCollection=state.bar||quotaGroupLastActive;quotaGroupLastActive=state.bar;edgeTuck?.pin(state.expanded,'quota-card-group');if(state.bar)quotaCardGroupWindow?.show(state);else quotaCardGroupWindow?.hide();if(changedCollection&&!quotaCardGroupInput().suppressed){syncQuotaLabel(codexCompanion?.getSnapshot());syncQuotaFreeStack();}}});
  quotaCardGroup.start();
  initializeShortcuts();
  codexIconPreference = createCodexIconPreference({ onChange: refreshCodexIcon,
    ...(IS_SMOKE_TEST ? { read: async () => 'codex-system', readDark: async () => false } : {}) });
  void codexIconPreference.start();
  activityMonitor = createActivityMonitor({
    screen, powerMonitor, getWindow: () => petWindow,
    onSample: packet => {
      if (!packet.locked) { edgeTuck?.sampleCursor(packet.cursor); shortcutWindow?.sampleCursor(packet.cursor); }
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:activity', packet);
      tickEdgeNotice();
    },
    onError: error => writeError('活动状态检测', error)
  });
  const pause = () => {
    screenLocked = true;
    codexIconPreference?.pause();
    workbuddyEnableToken++; workbuddyConsent?.cancel();
    shortcutWindow?.interrupt();
    codexConsentToken++;
    finishCodexConsent(false);
    zcodeConsent?.cancel();
    notesCompanion?.pause();
    if (customizationWindow && !customizationWindow.isDestroyed()) {
      syncCustomizationVisibility();
      customizationWindow.hide();
    }
    if (apiUsageWindow && !apiUsageWindow.isDestroyed()) apiUsageWindow.hide();
    if (globalSettingsWindow && !globalSettingsWindow.isDestroyed()) globalSettingsWindow.hide();
    chatWindow?.hide();
    void chat?.stop();
    void workbuddyChat?.stop();
    workbuddyLabel?.hide();
    workbuddyDetails?.close();
    dragState = null;
    safelyInvokeWindow('锁屏时停止动作', stopMotion);
    edgeTuck?.suspend();
    safelyInvokeWindow('锁屏时暂停活动监测', () => activityMonitor.pause());
    hideBubble();
    pomodoroWindows?.hide();
    safelyInvokeWindow('锁屏时额度标签隐藏', () => quotaLabel?.hide());
    sheepOfferingWindow?.hide();
    safelyInvokeWindow('锁屏时守护战隐藏', () => quotaGuard?.close());
    safelyInvokeWindow('锁屏时 Codex 详情隐藏', () => codexDetails?.close());
    safelyInvokeWindow('锁屏时 API 卡片隐藏', () => apiUsageLabel?.hide());
    safelyInvokeWindow('锁屏时 ZCode 窗口隐藏', () => zcodeLink?.hide());
    safelyInvokeWindow('锁屏时对白清理', () => dialogue.dismiss());
  };
  const resume = () => { screenLocked = false; void codexIconPreference?.start(); notesCompanion?.resume(); edgeTuck?.resume(); activityMonitor.resume(); syncQuotaLabel(codexCompanion?.getSnapshot()); syncPomodoro(); scheduleUpdateCheck(); };
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
  if (process.argv.includes('--shortcuts-preview')) openShortcuts();
  if (process.argv.includes('--shortcut-settings-preview')) openShortcuts(true);
  if (process.argv.includes('--pomodoro-preview')) openPomodoro();
  if (process.argv.includes('--settings-preview')) openGlobalSettings();
  if (process.argv.includes('--notes-preview')) notesCompanion.openPanel();
  scheduleUpdateCheck();
  if (settings.codexEnabled) void codexCompanion.setEnabled(true);
  void zcodeLink.start();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (settings) restorePet();
    if (argv.includes('--shortcuts-preview')) openShortcuts();
    if (argv.includes('--shortcut-settings-preview')) openShortcuts(true);
    if (argv.includes('--settings-preview')) openGlobalSettings();
    if (argv.includes('--notes-preview')) notesCompanion?.openPanel();
    if (argv.includes('--pomodoro-preview')) openPomodoro();
  });

  app.on('before-quit', event => {
    codexConsentToken++;
    finishCodexConsent(false);
    zcodeConsent?.cancel();
    const noteWindows = notesCompanion?.getWindows();
    const pendingReminders = notesCompanion?.getStore().getState().todos.some(item =>
      !item.deletedAt && !item.completed && ['pending', 'presented'].includes(item.reminderState));
    if (!quitCleanupStarted && !notesQuitReady && event?.preventDefault &&
      (pendingReminders || noteWindows?.panel || noteWindows?.notes.length || noteWindows?.reminder)) {
      event.preventDefault();
      if (!notesQuitFlight) notesQuitFlight = Promise.resolve(notesCompanion.close({ beforeCommit: savePomodoroForQuit })).then(allowed => {
        notesQuitFlight = null;
        if (allowed) { notesQuitReady = true; setTimeout(() => app.quit(), 0); }
      }).catch(error => { notesQuitFlight = null; writeError('便签保存后退出', error); });
      return;
    }
    isQuitting = true;
    if (!quitCleanupStarted && !savePomodoroForQuit()) {
      isQuitting = false;
      event?.preventDefault?.();
      return;
    }
    if (quitCleanupStarted) {
      if (!quitReady) event?.preventDefault?.();
      return;
    }
    quitCleanupStarted = true;
    quotaCardGroup?.close(); quotaCardGroupWindow?.destroy();
    codexIconPreference?.close();
    if (!notesQuitReady) void notesCompanion?.close();
    clearTimeout(updateTimer);
    updateTimer = null;
    clearTimeout(apiRefreshTimer);
    apiRefreshTimer = null;
    apiUsage?.close();
    workbuddyEnableToken++; workbuddyConsent?.close();
    workbuddyTasks?.close();
    workbuddyUsage?.close();
    workbuddyQuota?.close();
    workbuddyLabel?.destroy();
    workbuddyDetails?.destroy();
    safelyInvokeWindow('退出时快捷入口清理', () => { shortcutWindow?.dispose(); shortcutRegistrar?.dispose(); });
    safelyInvokeWindow('退出时番茄钟窗口销毁', () => pomodoroWindows?.close());
    safelyInvokeWindow('退出时全局设置销毁', () => globalSettingsWindow?.destroy());
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
    safelyInvokeWindow('退出时 ZCode 联动清理', () => zcodeLink?.close());
    safelyInvokeWindow('退出时 ZCode 授权清理', () => zcodeConsent?.close());
    safelyInvokeWindow('退出时停止动作', stopMotion);
    safelyInvokeWindow('退出时活动监测清理', () => activityMonitor?.stop());
    destroyBubbleSafely();
    safelyInvokeWindow('退出时额度标签销毁', () => quotaLabel?.destroy());
    safelyInvokeWindow('退出时守护战销毁', () => quotaGuard?.destroy());
    safelyInvokeWindow('退出时 Codex 详情销毁', () => codexDetails?.destroy());
    safelyInvokeWindow('退出时 API 卡片销毁', () => apiUsageLabel?.destroy());
    thoughts?.destroy();
    sheepOfferingWindow?.destroy();
    safelyInvokeWindow('退出时对白清理', () => dialogue?.dismiss());
  });

  app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
  });

  app.on('activate', () => {
    if (isQuitting || screenLocked || !settings) return;
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    else restorePet();
  });

  app.whenReady().then(bootstrap).catch(error => {
    writeError('应用启动失败', error);
    app.exit(1);
  });
}
