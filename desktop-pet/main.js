const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
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
const { createWindowMotion } = require('./lib/window-motion');
const { createCodexCompanion } = require('./lib/codex-companion');
const { buildCodexMenu, buildCodexResultMenu, resolveCodexAction } = require('./lib/codex-menu');
const { buildQuotaLabelModel } = require('./lib/codex-quota-view');
const { createQuotaLabelWindow } = require('./lib/quota-label-window');

const APP_NAME = '球球桌宠';
const IS_SMOKE_TEST = process.env.PET_SMOKE_TEST === '1';
const IS_CODEX_SMOKE_ONLY = IS_SMOKE_TEST && process.env.PET_SMOKE_CODEX_ONLY === '1';

let petWindow = null;
let tray = null;
let settings = null;
let settingsFile = null;
let dragState = null;
let bounceState = null;
let isQuitting = false;
let activityMonitor = null;
let dialogue = null;
let bubble = null;
let bubbleVisibilityBinding = null;
let quotaLabel = null;
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

function codexHostAvailable() {
  return codexPageReady && !isQuitting && !screenLocked && petWindow && !petWindow.isDestroyed() && petWindow.isVisible() &&
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
  if (!payload) return;
  const shown = safelyInvokeWindow('气泡显示', () => bubble?.show(payload));
  if (shown) bindBubbleVisibilityEvents();
  repositionQuotaLabel();
  Promise.resolve().then(repositionQuotaLabel);
}

function hideBubble() {
  safelyInvokeWindow('气泡隐藏', () => bubble?.hide());
  repositionQuotaLabel();
}

function repositionBubble() {
  safelyInvokeWindow('气泡重排', () => bubble?.reposition());
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
          !screenLocked && petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
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
          size: settings.codexQuotaLabelSize
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
  }
}

function dismissCodexPresentation() {
  const alert = codexCompanion?.getSnapshot().currentAlert;
  if (!alert || !codexCompanion.dismiss(alert.id, alert.generation)) clearCodexPresentation();
}

function invalidateCodexPage() {
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
    'codexQuotaAppearance'
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
    if (items.length && petWindow && !petWindow.isDestroyed()) {
      Menu.buildFromTemplate(bindCodexMenu(items)).popup({ window: petWindow });
    }
    return items.length > 0;
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

function persistWindowPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
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
    bubblesEnabled: settings.bubblesEnabled
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
  sendCompanionSettings();
  refreshTrayMenu();
}

function showDialogue(event) {
  if (screenLocked || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return null;
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
  persistSettings();
  refreshTrayMenu();
}

function setAlwaysOnTop(enabled) {
  settings.alwaysOnTop = Boolean(enabled);
  safelyInvokeWindow('球球窗口置顶', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  });
  safelyInvokeWindow('气泡窗口置顶', () => bubble?.setAlwaysOnTop(settings.alwaysOnTop));
  safelyInvokeWindow('额度标签置顶', () => quotaLabel?.setAlwaysOnTop(settings.alwaysOnTop));
  persistSettings();
  refreshTrayMenu();
}

function resetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopMotion();
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
    ['micro', '超小（60 × 60）'],
    ['tiny', '极小（80 × 80）'],
    ['small', '小（120 × 120）'],
    ['medium', '中（180 × 180）'],
    ['large', '大（260 × 260）']
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
      ...(settings.codexEnabled ? [{ id: 'codex-status', label: 'Codex 状态', submenu: [
        ...(codexNotice ? [{ label: codexNotice.text, enabled: false }, { type: 'separator' }] : []),
        ...bindCodexMenu(buildCodexMenu(codexCompanion?.getSnapshot(), codexNow()))
      ] }] : [])
    ]
  };
}

function menuTemplate() {
  return [
    { label: '随机表情', click: () => sendCommand('random') },
    { label: '立即睡眠', click: () => sendCommand('sleep') },
    { label: '立即唤醒', click: () => sendCommand('wake') },
    {
      label: '保持清醒', type: 'checkbox', checked: settings.keepAwake,
      click: item => setCompanionSetting('keepAwake', item.checked)
    },
    {
      label: '互动气泡', type: 'checkbox', checked: settings.bubblesEnabled,
      click: item => setCompanionSetting('bubblesEnabled', item.checked)
    },
    codexMenu(),
    { type: 'separator' },
    { label: '尺寸', submenu: sizeMenu() },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: item => setAlwaysOnTop(item.checked)
    },
    {
      label: app.isPackaged ? '开机自动启动' : '开机自动启动（打包后可用）',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: loginItemEnabled(),
      click: item => setOpenAtLogin(item.checked)
    },
    { label: '恢复默认位置', click: resetPosition },
    { type: 'separator' },
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

function showPetContextMenu() {
  if (!petWindow || petWindow.isDestroyed()) return;
  Menu.buildFromTemplate(menuTemplate()).popup({ window: petWindow });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets/tray-iconTemplate.png');
  const trayImage = nativeImage.createFromPath(iconPath);
  trayImage.setTemplateImage(true);
  tray = new Tray(trayImage);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();
  tray.on('click', () => {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    else {
      makeWindowVisible();
      petWindow.showInactive();
      petWindow.moveTop();
      syncQuotaLabel(codexCompanion?.getSnapshot());
    }
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

    if (!IS_CODEX_SMOKE_ONLY) {
      await require('./scripts/verify-companion').verifyCompanion({
        pet: petWindow, bubble, dialogue, monitor: activityMonitor, screen, BrowserWindow,
        command: sendCommand, setSetting: setCompanionSetting, getSettings: () => ({ ...settings }), showDialogue
      });
    }

    await require('./scripts/verify-codex-companion').verifyCodexCompanion({
      pet: petWindow, bubble, quotaLabel, monitor: activityMonitor, screen, BrowserWindow,
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
  petWindow = candidatePetWindow;
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
    if (isCurrentPetWindow()) repositionBubble();
  });
  createdPetWindow.on('resize', () => {
    if (!isCurrentPetWindow()) return;
    stopMotion();
    if (isCurrentPetWindow()) repositionBubble();
  });
  createdPetWindow.on('hide', () => {
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时停止动作', stopMotion);
    if (!isCurrentPetWindow()) return;
    hideBubble();
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时额度标签隐藏', () => quotaLabel?.hide());
    if (!isCurrentPetWindow()) return;
    safelyInvokeWindow('隐藏时对白清理', () => dialogue?.dismiss());
  });
  let closedCleanupStarted = false;
  createdPetWindow.on('closed', () => {
    if (!isCurrentPetWindow() || closedCleanupStarted) return;
    closedCleanupStarted = true;
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
  ipcMain.on('pet:say', (event, scene) => {
    if (fromPetWindow(event)) showDialogue(scene);
  });

  ipcMain.on('pet:bubble-reply', (event, payload) => {
    const bubbleWindow = bubble?.getWindow();
    if (!bubbleWindow || bubbleWindow.isDestroyed() || event.sender !== bubbleWindow.webContents) return;
    if (!payload || !Number.isInteger(payload.id)) return;
    const action = dialogue.respond(payload.id, payload.action, performance.now());
    if (!action) return;
    hideBubble();
    if (action?.command === 'codex') void routeCodexAction(action.descriptor);
    else sendCommand(action);
  });

  ipcMain.on('pet:bubble-resize', (event, payload) => {
    const bubbleWindow = bubble?.getWindow();
    if (!bubbleWindow || bubbleWindow.isDestroyed() || event.sender !== bubbleWindow.webContents) return;
    bubble.resize(payload);
  });

  ipcMain.on('pet:drag-start', (event, rawPoint) => {
    if (!fromPetWindow(event) || screenLocked) return;
    const point = validPoint(rawPoint);
    if (!point) return;
    // 页面已在 pointerdown 清理待执行互动；不发送全局 stop，避免迟到后误杀新双击。
    stopMotion({ notifyRenderer: false });
    const [x, y] = petWindow.getPosition();
    dragState = { pointer: point, window: { x, y } };
  });

  ipcMain.on('pet:drag-move', (event, rawPoint) => {
    if (!fromPetWindow(event) || !dragState || screenLocked) return;
    const point = validPoint(rawPoint);
    if (!point) return;
    petWindow.setPosition(
      dragState.window.x + point.x - dragState.pointer.x,
      dragState.window.y + point.y - dragState.pointer.y,
      false
    );
  });

  ipcMain.on('pet:drag-end', event => {
    if (!fromPetWindow(event) || !dragState) return;
    dragState = null;
    if (!screenLocked) {
      const anchor = hostMotion?.anchor;
      const visible = anchor && ensureVisibleBounds(anchor, screen.getAllDisplays(), screen.getPrimaryDisplay());
      if (anchor && anchor.x === visible.x && anchor.y === visible.y &&
        anchor.width === visible.width && anchor.height === visible.height) {
        // macOS 屏幕边缘下，pointerup 可能晚于双击动作到达主进程。
        // 动作锚点仍完整可见时只记住锚点，不把中途动画帧落盘。
        settings.x = anchor.x;
        settings.y = anchor.y;
        persistSettings();
      } else makeWindowVisible(false);
    }
  });

  ipcMain.on('pet:bounce', event => {
    if (!fromPetWindow(event) || screenLocked || !petWindow.isVisible()) return;
    startWindowBounce();
  });

  ipcMain.on('pet:motion-start', (event, request) => {
    if (!fromPetWindow(event) || screenLocked || !petWindow.isVisible() || !request ||
      !Number.isSafeInteger(request.token) || request.token <= 0 || !getMotion(request.action)) return;
    dismissCodexPresentation();
    stopWindowBounce();
    hostMotion = { owner: 'user', token: request.token, action: request.action, anchor: petWindow.getBounds() };
    if (!windowMotion.start({ token: request.token, action: request.action })) hostMotion = null;
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
    hostMotion = { owner: 'codex', token: request.token, action: request.action, anchor: petWindow.getBounds() };
    if (!windowMotion.start({ token: request.token, action: request.action })) {
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
    if (petWindow && !petWindow.isDestroyed()) makeWindowVisible();
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
  settings = loadSettings(settingsFile);
  dialogue = new DialogueDirector({ now: performance.now(), enabled: settings.bubblesEnabled });
  bubble = createBubbleWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('气泡窗口', error)
  });
  quotaLabel = createQuotaLabelWindow({
    BrowserWindow, screen, getPetWindow: () => petWindow,
    getObstacle: quotaObstacleBounds,
    getSize: () => settings?.codexQuotaLabelSize,
    getAppearance: () => settings?.codexQuotaAppearance,
    alwaysOnTop: settings.alwaysOnTop,
    onError: error => writeError('额度标签窗口', error)
  });
  activityMonitor = createActivityMonitor({
    screen, powerMonitor, getWindow: () => petWindow,
    onSample: packet => {
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:activity', packet);
    },
    onError: error => writeError('活动状态检测', error)
  });
  const pause = () => {
    screenLocked = true;
    dragState = null;
    safelyInvokeWindow('锁屏时停止动作', stopMotion);
    safelyInvokeWindow('锁屏时暂停活动监测', () => activityMonitor.pause());
    hideBubble();
    safelyInvokeWindow('锁屏时额度标签隐藏', () => quotaLabel?.hide());
    safelyInvokeWindow('锁屏时对白清理', () => dialogue.dismiss());
  };
  const resume = () => { screenLocked = false; activityMonitor.resume(); syncQuotaLabel(codexCompanion?.getSnapshot()); };
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
  if (settings.codexEnabled) void codexCompanion.setEnabled(true);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    else {
      makeWindowVisible();
      petWindow.showInactive();
      petWindow.moveTop();
      syncQuotaLabel(codexCompanion?.getSnapshot());
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (quitCleanupStarted) return;
    quitCleanupStarted = true;
    codexConsentToken++;
    safelyInvokeWindow('退出时 Codex 联动清理', () => codexCompanion?.close());
    safelyInvokeWindow('退出时停止动作', stopMotion);
    safelyInvokeWindow('退出时活动监测清理', () => activityMonitor?.stop());
    destroyBubbleSafely();
    safelyInvokeWindow('退出时额度标签销毁', () => quotaLabel?.destroy());
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
