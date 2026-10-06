const path = require('node:path');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function chatBounds(petBounds, workArea) {
  const areaWidth = Math.max(1, Math.floor(workArea.width));
  const areaHeight = Math.max(1, Math.floor(workArea.height));
  const paddingX = Math.min(12, Math.floor((areaWidth - 1) / 2));
  const paddingY = Math.min(12, Math.floor((areaHeight - 1) / 2));
  const width = Math.min(360, areaWidth - paddingX * 2);
  const height = Math.min(480, areaHeight - paddingY * 2);
  const petCenterX = petBounds.x + petBounds.width / 2;
  const towardRight = petCenterX < workArea.x + areaWidth / 2;
  const targetX = towardRight ? petBounds.x + petBounds.width + 12 : petBounds.x - width - 12;
  return {
    x: Math.round(clamp(targetX, workArea.x + paddingX, workArea.x + areaWidth - paddingX - width)),
    y: Math.round(clamp(petBounds.y + petBounds.height / 2 - height / 2,
      workArea.y + paddingY, workArea.y + areaHeight - paddingY - height)),
    width,
    height
  };
}

function createChatWindow({ BrowserWindow, screen, getPetWindow, getAppearance = () => null,
  getCodexPet = () => null,
  getAvatarImage = async () => null,
  onError = () => {}, onVisibilityChange = () => {}, onMoveEnd = () => {},
  onFollowStart = () => {}, alwaysOnTop = true }) {
  let win = null;
  let ready = false;
  let wantedVisible = false;
  let current = null;
  let topmost = alwaysOnTop;
  let lastVisible = false;
  let appearanceKey = '';
  let positioned = null;
  let movedPet = null;
  let nativeMoving = false;
  let settleTimer = null;

  function cancelSettle() {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  }

  function scheduleSettle() {
    cancelSettle();
    settleTimer = setTimeout(() => { settleTimer = null; settleChatMove(); }, 200);
  }

  function visibilityChanged(visible) {
    if (visible === lastVisible) return;
    lastVisible = visible;
    onVisibilityChange(visible);
  }

  function reposition() {
    if (!win || win.isDestroyed()) return;
    const pet = getPetWindow();
    if (!pet || pet.isDestroyed()) return;
    const petBounds = pet.getBounds();
    const current = win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    if (movedPet && petBounds.x === movedPet.x && petBounds.y === movedPet.y &&
      (nativeMoving || (current.x >= area.x && current.y >= area.y &&
      current.x + current.width <= area.x + area.width &&
      current.y + current.height <= area.y + area.height))) return;
    cancelSettle();
    nativeMoving = false;
    movedPet = null;
    positioned = chatBounds(petBounds, screen.getDisplayMatching(petBounds).workArea);
    win.setBounds(positioned, false);
  }

  function followChatMove(nextBounds) {
    if (!win || win.isDestroyed() || !win.isVisible() || !positioned) return;
    const bounds = nextBounds || win.getBounds();
    const dx = bounds.x - positioned.x;
    const dy = bounds.y - positioned.y;
    if (!dx && !dy) return;
    if (!nativeMoving) onFollowStart();
    nativeMoving = true;
    positioned = bounds;
    const pet = getPetWindow();
    if (!pet || pet.isDestroyed()) return;
    const petBounds = pet.getBounds();
    movedPet = { x: petBounds.x + dx, y: petBounds.y + dy };
    pet.setPosition(movedPet.x, movedPet.y, false);
    scheduleSettle();
  }

  function settleChatMove() {
    const moved = nativeMoving;
    nativeMoving = false;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const pet = getPetWindow();
    if (!pet || pet.isDestroyed()) return;
    const bounds = win.getBounds();
    const petBounds = pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const fit = (value, size, petValue, petSize, start, length) => {
      const padding = Math.min(12, Math.floor((length - 1) / 2));
      const left = Math.min(value, petValue) - value;
      const right = Math.max(value + size, petValue + petSize) - value;
      const min = start + padding - left;
      const max = start + length - padding - right;
      return min <= max ? clamp(value, min, max)
        : clamp(value, start + padding, start + length - padding - size);
    };
    const x = Math.round(fit(bounds.x, bounds.width, petBounds.x, petBounds.width,
      area.x, area.width));
    const y = Math.round(fit(bounds.y, bounds.height, petBounds.y, petBounds.height,
      area.y, area.height));
    const dx = x - bounds.x;
    const dy = y - bounds.y;
    if (!dx && !dy) { if (moved) onMoveEnd(); return; }
    positioned = { ...bounds, x, y };
    movedPet = { x: petBounds.x + dx, y: petBounds.y + dy };
    win.setPosition(x, y, false);
    pet.setPosition(movedPet.x, movedPet.y, false);
    if (moved) onMoveEnd();
  }

  function deliver() {
    if (ready && current && win && !win.isDestroyed()) win.webContents.send('pet:chat-state', current);
  }

  function syncAppearance() {
    const appearance = getAppearance();
    const key = JSON.stringify(appearance || null);
    if (!ready || !win || win.isDestroyed() || key === appearanceKey) return;
    const codexPet = getCodexPet(appearance);
    if (appearance?.shape === 'codex-pet') win.webContents.send('pet:chat-appearance', appearance, null, codexPet);
    else win.webContents.send('pet:chat-appearance', appearance);
    appearanceKey = key;
    if (appearance?.shape === 'aurora-cloud') {
      const target = win;
      void Promise.resolve().then(() => getAvatarImage(appearance)).then(image => {
        if (image && win === target && !target.isDestroyed() && appearanceKey === key) {
          target.webContents.send('pet:chat-appearance', appearance, image);
        }
      }).catch(onError);
    }
  }

  function present() {
    if (!wantedVisible || !ready || !win || win.isDestroyed()) return;
    reposition();
    win.show();
    win.focus();
  }

  function hide() {
    wantedVisible = false;
    cancelSettle();
    nativeMoving = false;
    movedPet = null;
    if (win && !win.isDestroyed()) win.hide();
  }

  function destroy() {
    wantedVisible = false;
    cancelSettle();
    ready = false;
    appearanceKey = '';
    positioned = null;
    movedPet = null;
    nativeMoving = false;
    const previous = win;
    win = null;
    visibilityChanged(false);
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    ready = false;
    appearanceKey = '';
    positioned = null;
    movedPet = null;
    nativeMoving = false;
    win = new BrowserWindow({
      width: 360, height: 480,
      title: '聊一会儿',
      transparent: true, frame: false, resizable: false,
      useContentSize: true,
      focusable: true, skipTaskbar: true, show: false,
      fullscreenable: false, maximizable: false, minimizable: false,
      hasShadow: false, backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../chat-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        spellcheck: false
      }
    });
    const loadingWindow = win;
    win.setAlwaysOnTop(topmost, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setHiddenInMissionControl(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_event, details) => {
      if (win !== loadingWindow) return;
      destroy();
      onError(new Error(`聊天面板意外退出：${details.reason}`));
    });
    win.on('show', () => { if (win === loadingWindow) visibilityChanged(true); });
    win.on('hide', () => { if (win === loadingWindow) visibilityChanged(false); });
    win.on('will-move', (_event, bounds) => { if (win === loadingWindow) followChatMove(bounds); });
    win.on('move', () => { if (win === loadingWindow) followChatMove(); });
    win.on('close', event => {
      if (win !== loadingWindow) return;
      event.preventDefault();
      hide();
    });
    win.on('closed', () => {
      if (win !== loadingWindow) return;
      win = null;
      cancelSettle();
      ready = false;
      appearanceKey = '';
      positioned = null;
      movedPet = null;
      nativeMoving = false;
      wantedVisible = false;
      visibilityChanged(false);
    });
    win.loadFile(path.join(__dirname, '../chat.html')).then(() => {
      if (win !== loadingWindow || loadingWindow.isDestroyed()) return;
      ready = true;
      deliver();
      syncAppearance();
      present();
    }).catch(error => {
      if (win !== loadingWindow) return;
      destroy();
      onError(error);
    });
  }

  return {
    show(snapshot) {
      current = snapshot;
      wantedVisible = true;
      ensureWindow();
      deliver();
      syncAppearance();
      present();
    },
    update(snapshot) {
      current = snapshot;
      deliver();
      syncAppearance();
    },
    syncAppearance,
    hide,
    destroy,
    reposition,
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
    isFollowingChat() {
      const pet = getPetWindow();
      if (!nativeMoving || !movedPet || !pet || pet.isDestroyed()) return false;
      const { x, y } = pet.getBounds();
      return x === movedPet.x && y === movedPet.y;
    },
    getWindow: () => win,
    setAlwaysOnTop(enabled) {
      topmost = enabled;
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, 'floating');
    }
  };
}

module.exports = { createChatWindow, chatBounds };
