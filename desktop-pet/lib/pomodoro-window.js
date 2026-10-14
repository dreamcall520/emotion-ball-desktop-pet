const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { petVisualBounds } = require('./pet-visual-bounds');
const { adjacentBounds } = require('./window-placement');

const FACES = new Set(['analog', 'timeline', 'modules', 'minutes']);
const MODES = new Set(['focus', 'short', 'long']);
const FILE = path.join(__dirname, '../pomodoro.html');
const ACTIONS = {
  panel: new Set(['toggle', 'reset', 'mode', 'settings', 'intention', 'pin', 'rest', 'extend', 'dismiss', 'close-panel', 'layout']),
  mini: new Set(['open']),
  message: new Set(['rest', 'extend', 'dismiss', 'layout'])
};

function validAction(type, value, view) {
  if (type === 'mode') return MODES.has(value);
  if (type === 'intention') return typeof value === 'string' && value.length <= 60 && !/[\u0000-\u001f\u007f]/u.test(value);
  if (type === 'pin') return typeof value === 'boolean';
  if (type === 'layout') return value && typeof value === 'object' && !Array.isArray(value) && (view === 'message' ?
    Object.keys(value).length === 1 && [36, 54].includes(value.cardHeight) :
    Object.keys(value).every(key => ['face', 'settings'].includes(key)) && FACES.has(value.face) && typeof value.settings === 'boolean');
  if (type === 'settings') return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['face', 'encouragementEnabled', 'durations'].includes(key)) &&
    FACES.has(value.face) && typeof value.encouragementEnabled === 'boolean' && value.durations &&
    Object.keys(value.durations).length === 3 && Object.entries({ focus: 180, short: 60, long: 120 }).every(([key, max]) =>
      Number.isSafeInteger(value.durations[key]) && value.durations[key] >= 1 && value.durations[key] <= max);
  return value === undefined || value === null;
}

function createPomodoroWindows({ BrowserWindow, ipcMain, screen, getPetWindow, getPetBounds,
  getPetPresentation = () => null, getWindowObstacles = () => [], getQuotaBounds = () => null,
  getQuotaWindowBounds = () => null,
  getReminderBounds = () => null, getSnapshot, onAction,
  isSuppressed = () => false, onError = () => {} }) {
  const entries = new Map();
  let panelOpen = false, settingsOpen = false, stopped = false, panelAnchorPending = false, panelFocusPending = false;
  let messageCardHeight = 36;
  const alive = win => win && !win.isDestroyed();
  const report = error => { try { onError(error); } catch (_) {} };
  const snapshot = view => ({ ...getSnapshot(), panelOpen,
    ...(view === 'mini' && entries.get('mini')?.pointer ? { miniPointer: { ...entries.get('mini').pointer } } : {}) });
  const url = view => { const result = pathToFileURL(FILE); result.searchParams.set('view', view); return result.href; };
  function source(event) {
    for (const [view, entry] of entries) {
      if (alive(entry.win) && event?.sender === entry.win.webContents && event.senderFrame === event.sender.mainFrame &&
        event.sender.getURL() === url(view)) return view;
    }
    return null;
  }
  function hide() {
    for (const { win } of entries.values()) if (alive(win)) { try { win.hide(); } catch (error) { report(error); } }
  }
  function unavailable() {
    const pet = getPetWindow(), presentation = getPetPresentation();
    return stopped || isSuppressed() || !alive(pet) || !pet.isVisible() || presentation?.mode === 'hidden';
  }
  function fit(bounds, area) {
    const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
    return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))), width, height };
  }
  const intersects = (a, b) => a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x && a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
  function place(view, size, pet, area, obstacles, miniBounds, quotaBounds, reminder, visibleQuotaBounds) {
    if (view === 'panel') {
      const right = { x: pet.x + pet.width + 24, y: pet.y + (pet.height - size.height) / 2, ...size };
      if (right.x + size.width <= area.x + area.width && right.y >= area.y && right.y + size.height <= area.y + area.height &&
        !obstacles.some(obstacle => intersects(right, obstacle))) return right;
      return adjacentBounds(pet, area, size, obstacles);
    }
    if (view === 'message' && reminder) {
      const above = fit({ x: pet.x + (pet.width - size.width) / 2, y: pet.y - size.height - 8, ...size }, area);
      const face = { x: above.x + 6, y: above.y + 6, width: above.width - 12, height: above.height - 12 };
      if (above.y + above.height <= pet.y - 8 && !obstacles.some(obstacle => intersects(face, obstacle))) return above;
      return adjacentBounds(pet, area, size, obstacles);
    }
    const miniAnchor = quotaBounds || pet;
    const first = fit({ x: view === 'message' && miniBounds ? miniBounds.x + (miniBounds.width - size.width) / 2 :
      miniAnchor.x + (miniAnchor.width - size.width) / 2,
      y: view === 'message' && miniBounds ? miniBounds.y + 4 - size.height :
        miniAnchor.y - size.height - (quotaBounds ? 2 : 8), ...size }, area);
    const face = { x: first.x + 6, y: first.y + 6, width: first.width - 12, height: first.height - 12 };
    const aboveFits = view !== 'mini' || first.y + size.height <= miniAnchor.y - (quotaBounds ? 2 : 8) + .5;
    if (aboveFits && !obstacles.some(obstacle => intersects(face, obstacle))) return first;
    if (view === 'mini' && (!aboveFits || intersects(face, pet))) {
      // At the top edge, keep the fallback under the painted card, not the
      // native card+role envelope which would shift the timer sideways.
      const anchor = visibleQuotaBounds || pet, gap = visibleQuotaBounds ? 2 : 8;
      const below = fit({ x: anchor.x + (anchor.width - size.width) / 2,
        y: anchor.y + anchor.height + gap, ...size }, area);
      const belowFace = { x: below.x + 6, y: below.y + 6, width: below.width - 12, height: below.height - 12 };
      if (below.y >= anchor.y + anchor.height + gap && !obstacles.some(obstacle => intersects(belowFace, obstacle))) return below;
    }
    // Keep the quota/mini/message stack on the same row when a neighboring
    // panel only blocks one side before trying another side of the anchor.
    if (view === 'message' || quotaBounds || reminder) {
      const alongRow = obstacles.filter(obstacle => intersects(face, obstacle))
        .flatMap(obstacle => [obstacle.x - size.width, obstacle.x + obstacle.width])
        .map(x => fit({ ...first, x }, area)).sort((a, b) => Math.abs(a.x - first.x) - Math.abs(b.x - first.x));
      const available = alongRow.find(bounds => !obstacles.some(obstacle => intersects(
        { x: bounds.x + 6, y: bounds.y + 6, width: bounds.width - 12, height: bounds.height - 12 }, obstacle)));
      if (available) return available;
    }
    return adjacentBounds(miniBounds || miniAnchor, area, size, obstacles);
  }
  function ensure(view) {
    const previous = entries.get(view);
    if (previous && alive(previous.win)) return previous;
    const win = new BrowserWindow({ width: view === 'panel' ? 320 : view === 'mini' ? 112 : 196,
      height: view === 'panel' ? 476 : 48, title: '球球 · 番茄钟',
      transparent: true, frame: false, resizable: false, focusable: view === 'panel',
      skipTaskbar: true, show: false, fullscreenable: false, maximizable: false, minimizable: false,
      hasShadow: false, backgroundColor: '#00000000', webPreferences: {
        preload: path.join(__dirname, '../pomodoro-preload.js'), contextIsolation: true, nodeIntegration: false,
        sandbox: true, spellcheck: false, backgroundThrottling: false } });
    const entry = { win, ready: false, positioned: false };
    entries.set(view, entry);
    try {
      win.setAlwaysOnTop(view !== 'panel', 'floating');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setHiddenInMissionControl(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('render-process-gone', (_event, details) => {
        if (entries.get(view) !== entry) return;
        entries.delete(view); win.destroy(); report(new Error(`番茄钟渲染退出：${details.reason}`));
      });
      win.on('close', event => { if (!stopped && view === 'panel') { event.preventDefault(); panelOpen = false; settingsOpen = false; sync(); } });
      win.on('closed', () => { if (entries.get(view) === entry) entries.delete(view); });
      win.loadFile(FILE, { query: { view } }).then(() => {
        if (entries.get(view) !== entry || !alive(win)) return;
        entry.ready = true; sync();
      }).catch(error => { if (entries.get(view) === entry) entries.delete(view); if (alive(win)) win.destroy(); report(error); });
    } catch (error) { entries.delete(view); if (alive(win)) win.destroy(); report(error); }
    return entry;
  }
  function sync() {
    try {
      if (unavailable()) { panelFocusPending = false; hide(); return; }
      const state = snapshot(), nativePet = getPetBounds?.() || getPetWindow().getBounds();
      const presentation = getPetPresentation(), pet = petVisualBounds(nativePet, presentation?.shape, presentation);
      const area = screen.getDisplayMatching(pet).workArea;
      const quota = getQuotaBounds();
      const visibleQuotaBounds = quota && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(quota[key])) &&
        quota.width > 0 && quota.height > 0 ? quota : null;
      const atEdge = presentation?.side === 'left' ? Math.abs(nativePet.x - area.x) <= 1 :
        presentation?.side === 'right' && Math.abs(nativePet.x + nativePet.width - area.x - area.width) <= 1;
      const quotaBounds = presentation?.mode === 'peeked' && presentation.dragging !== true && atEdge ? visibleQuotaBounds : null;
      const quotaWindowBounds = visibleQuotaBounds ? getQuotaWindowBounds() : null;
      const obstacles = [...getWindowObstacles(), getReminderBounds(), pet].filter(item => item &&
        ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item[key])) && item.width > 0 && item.height > 0);
      const active = ['running', 'paused'].includes(state.status);
      const views = [];
      if (panelOpen) views.push(['panel', { width: 320, height: settingsOpen || state.face !== 'analog' ? 384 : 476 }]);
      if (state.reminder) views.push(['message', { width: 256, height: state.mode === 'focus' ? 188 : 164 }]);
      if (!state.reminder && active) views.push(['mini', { width: 112, height: 48 }]);
      if (!state.reminder && state.encouragement) views.push(['message', { width: 196, height: messageCardHeight + 12 }]);
      const visible = new Set(views.map(([view]) => view));
      for (const [view, entry] of entries) if (!visible.has(view) && alive(entry.win)) entry.win.hide();
      let miniBounds = null;
      for (const [view, size] of views) {
        const entry = ensure(view);
        if (!alive(entry.win) || !entry.ready) continue;
        const current = entry.win.getBounds();
        // The anchored stack follows the card face, not its guard role's transparent gutter.
        const placementObstacles = quotaWindowBounds && (view === 'mini' || (view === 'message' && !state.reminder)) ?
          obstacles.map(item => ['x', 'y', 'width', 'height'].every(key => item[key] === quotaWindowBounds[key]) ? visibleQuotaBounds : item) : obstacles;
        const retainedPanelBounds = view === 'panel' && entry.positioned && !panelAnchorPending ?
          fit({ ...current, ...size }, screen.getDisplayMatching(current).workArea) : null;
        const bounds = retainedPanelBounds || place(view, size, pet, area, placementObstacles, miniBounds, quotaBounds, state.reminder, visibleQuotaBounds);
        if (['x', 'y', 'width', 'height'].some(key => bounds[key] !== current[key])) entry.win.setBounds(bounds, false);
        entry.positioned = true;
        if (view === 'panel') panelAnchorPending = false;
        if (view === 'mini') {
          miniBounds = bounds;
          const actual = entry.win.getBounds(), face = { x: actual.x + 6, y: actual.y + 6, width: actual.width - 12, height: actual.height - 12 };
          entry.pointer = { side: face.y + face.height / 2 < pet.y + pet.height / 2 ? 'bottom' : 'top',
            offset: Math.max(22, Math.min(face.width - 22, pet.x + pet.width / 2 - face.x)) };
        }
        obstacles.push(view === 'panel' ? bounds : { x: bounds.x + 6, y: bounds.y + 6, width: bounds.width - 12, height: bounds.height - 12 });
        entry.win.setAlwaysOnTop(view === 'panel' ? state.pinned === true : true, 'floating');
        entry.win.setIgnoreMouseEvents(view === 'message' && !state.reminder, { forward: true });
        entry.win.webContents.send('pomodoro:state', view === 'mini' ? { ...state, miniPointer: entry.pointer } : state);
        if (view === 'panel' && panelFocusPending) {
          entry.win.show(); entry.win.focus(); panelFocusPending = false;
        } else if (!entry.win.isVisible()) entry.win.showInactive();
      }
    } catch (error) { hide(); report(error); }
  }
  async function action(event, type, value) {
    const view = source(event);
    if (!view || !entries.get(view).win.isVisible() || !ACTIONS[view].has(type) || !validAction(type, value, view) ||
      (view === 'message' && type !== 'layout' && !getSnapshot().reminder)) return { ok: false, message: '无法执行此操作。' };
    if (stopped || isSuppressed()) return { ok: false, message: '当前无法操作番茄钟。' };
    if (type === 'open') { open(); return { ok: true, state: snapshot(view) }; }
    if (type === 'close-panel') { panelOpen = false; settingsOpen = false; panelFocusPending = false; sync(); return { ok: true, state: snapshot() }; }
    if (type === 'layout') {
      if (view === 'message') messageCardHeight = value.cardHeight; else settingsOpen = value.settings;
      sync(); return { ok: true, state: snapshot() };
    }
    try {
      const result = await onAction(type, value);
      sync();
      return result && typeof result.ok === 'boolean' ? result : { ok: false, message: '操作未完成，请重试。' };
    } catch (error) { report(error); return { ok: false, message: '操作未完成，请重试。' }; }
  }
  function open() { if (stopped) return; panelAnchorPending = !panelOpen; panelOpen = true; panelFocusPending = !unavailable(); sync(); }
  ipcMain.handle('pomodoro:load', event => { const view = source(event); return view ? { ok: true, state: snapshot(view) } : { ok: false, message: '来源无效。' }; });
  ipcMain.handle('pomodoro:action', action);
  function close() {
    stopped = true; panelOpen = false;
    ipcMain.removeHandler('pomodoro:load'); ipcMain.removeHandler('pomodoro:action');
    for (const { win } of entries.values()) if (alive(win)) win.destroy();
    entries.clear();
  }
  return { open, sync, reposition: sync, hide, close,
    getPanelBounds() { const win = entries.get('panel')?.win; return alive(win) && win.isVisible() ? win.getBounds() : null; } };
}

module.exports = { createPomodoroWindows };
