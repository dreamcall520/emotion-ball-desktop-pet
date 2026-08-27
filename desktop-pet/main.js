const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
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

const APP_NAME = '球球桌宠';
const IS_SMOKE_TEST = process.env.PET_SMOKE_TEST === '1';

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
let screenLocked = false;

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

function startWindowBounce() {
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

function makeWindowVisible() {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopWindowBounce();
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
  petWindow.webContents.send('pet:command', command);
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
    if (!settings.bubblesEnabled) bubble.hide();
  }
  persistSettings();
  sendCompanionSettings();
  refreshTrayMenu();
}

function showDialogue(event) {
  if (screenLocked || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return null;
  const payload = dialogue.offer(event, performance.now());
  if (payload) bubble.show(payload);
  return payload;
}

function setPetSize(sizeName) {
  if (!SIZES[sizeName] || !petWindow || petWindow.isDestroyed()) return;
  stopWindowBounce();
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
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  }
  bubble?.setAlwaysOnTop(settings.alwaysOnTop);
  persistSettings();
  refreshTrayMenu();
}

function resetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopWindowBounce();
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
      click: () => {
        isQuitting = true;
        app.quit();
      }
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

    await require('./scripts/verify-companion').verifyCompanion({
      pet: petWindow, bubble, monitor: activityMonitor, screen, BrowserWindow,
      command: sendCommand, setSetting: setCompanionSetting, showDialogue
    });

    setPetSize('tiny');
    await new Promise(resolve => setTimeout(resolve, 250));
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
    if (sleepVisual.width !== 80 || sleepVisual.height !== 80) {
      throw new Error(`极小尺寸错误：${sleepVisual.width} × ${sleepVisual.height}`);
    }
    if (sleepVisual.zCount !== 3 || sleepVisual.visibleZCount < 1) {
      throw new Error(`极小尺寸 Zzz 不可见：${JSON.stringify(sleepVisual)}`);
    }
    if (!sleepVisual.hasVisibleZInsideWindow) {
      throw new Error(`极小尺寸 Zzz 被窗口裁切：${JSON.stringify(sleepVisual)}`);
    }
    if (sleepVisual.eyeHeights.length !== 2 || sleepVisual.eyeHeights.some(height => height < 1.5)) {
      throw new Error(`极小尺寸睡眼过细：${JSON.stringify(sleepVisual.eyeHeights)}`);
    }
    if (process.env.PET_SMOKE_SCREENSHOT) {
      const screenshot = await petWindow.webContents.capturePage();
      fs.writeFileSync(path.resolve(process.env.PET_SMOKE_SCREENSHOT), screenshot.toPNG());
    }
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

  petWindow = new BrowserWindow({
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

  petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setHiddenInMissionControl(true);
  petWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  petWindow.webContents.on('will-navigate', event => event.preventDefault());
  petWindow.webContents.on('did-fail-load', (_event, code, description) => {
    writeError('页面加载失败', `${code} ${description}`);
    if (IS_SMOKE_TEST) app.exit(1);
  });
  petWindow.webContents.on('render-process-gone', (_event, details) => {
    writeError('渲染进程退出', JSON.stringify(details));
    if (IS_SMOKE_TEST) app.exit(1);
  });
  petWindow.once('ready-to-show', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.showInactive();
  });
  petWindow.webContents.on('did-finish-load', () => {
    sendCompanionSettings();
    activityMonitor.start();
    finishSmokeTest();
  });
  petWindow.on('move', () => bubble?.reposition());
  petWindow.on('resize', () => bubble?.reposition());
  petWindow.on('hide', () => { bubble?.hide(); dialogue?.dismiss(); });
  petWindow.on('closed', () => {
    stopWindowBounce(false);
    activityMonitor?.stop();
    bubble?.destroy();
    dialogue?.dismiss();
    petWindow = null;
  });

  petWindow.loadFile(path.join(__dirname, 'index.html')).catch(error => {
    writeError('无法打开桌宠页面', error);
    if (IS_SMOKE_TEST) app.exit(1);
  });
  return petWindow;
}

function registerIpc() {
  ipcMain.on('pet:say', (event, scene) => {
    if (fromPetWindow(event) && typeof scene === 'string') showDialogue(scene);
  });

  ipcMain.on('pet:bubble-reply', (event, payload) => {
    const bubbleWindow = bubble?.getWindow();
    if (!bubbleWindow || bubbleWindow.isDestroyed() || event.sender !== bubbleWindow.webContents) return;
    if (!payload || !Number.isInteger(payload.id)) return;
    const action = dialogue.respond(payload.id, payload.action, performance.now());
    if (!action) return;
    bubble.hide();
    sendCommand(action);
  });

  ipcMain.on('pet:drag-start', (event, rawPoint) => {
    if (!fromPetWindow(event) || screenLocked) return;
    const point = validPoint(rawPoint);
    if (!point) return;
    stopWindowBounce();
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
    if (!fromPetWindow(event)) return;
    dragState = null;
    if (!screenLocked) makeWindowVisible();
  });

  ipcMain.on('pet:bounce', event => {
    if (!fromPetWindow(event) || screenLocked) return;
    startWindowBounce();
  });

  ipcMain.on('pet:stop-motion', event => {
    if (fromPetWindow(event)) stopWindowBounce();
  });

  ipcMain.on('pet:context-menu', event => {
    if (!fromPetWindow(event)) return;
    showPetContextMenu();
  });
}

function registerDisplayRecovery() {
  const recover = () => {
    if (petWindow && !petWindow.isDestroyed()) makeWindowVisible();
    bubble?.reposition();
  };
  screen.on('display-added', recover);
  screen.on('display-removed', recover);
  screen.on('display-metrics-changed', recover);
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
    stopWindowBounce();
    activityMonitor.pause();
    bubble.hide();
    dialogue.dismiss();
  };
  const resume = () => { screenLocked = false; activityMonitor.resume(); };
  const powerGuard = createPowerGuard({ pause, resume });
  powerMonitor.on('lock-screen', () => powerGuard.setLocked(true));
  powerMonitor.on('suspend', () => powerGuard.setSuspended(true));
  powerMonitor.on('unlock-screen', () => powerGuard.setLocked(false));
  powerMonitor.on('resume', () => powerGuard.setSuspended(false));
  registerIpc();
  registerDisplayRecovery();
  createPetWindow();
  createTray();
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
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopWindowBounce();
    activityMonitor?.stop();
    bubble?.destroy();
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
