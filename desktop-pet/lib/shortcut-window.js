const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { adjacentBounds } = require('./window-placement');
const { petVisualBounds } = require('./pet-visual-bounds');
const { layoutShortcuts } = require('./shortcut-layout');

const FILE = path.join(__dirname, '../shortcuts.html');
const ACTIONS = new Set(['chat', 'custom', 'note', 'todo', 'pomodoro', 'settings']);
const OPEN_DURATION = 260, CLOSE_DURATION = 180;
const sameBounds = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);
const contains = (r, p, margin = 0) => Boolean(r && p && p.x >= r.x - margin && p.y >= r.y - margin &&
  p.x < r.x + r.width + margin && p.y < r.y + r.height + margin);

function createShortcutWindow({ BrowserWindow, ipcMain, screen, getPetWindow,
  getPresentation, getConfig, getErrors, save, onAction, onPin, onRecording,
  isSuppressed = () => false, onLayout = () => {}, onError = () => {} }) {
  let win = null, ready = false, opened = false, stopped = false, view = null, layout = null, session = 0;
  let focusPending = false, ignored = null, hoverTimer = null, leaveTimer = null, blocked = false;
  let edgeIdleTimer = null, edgeWakeConsumed = false;
  let closeTimer = null, closing = false, pinned = false, recording = false, settingsPositioned = false;
  let origin = null, animation = null, lastPublished = null, lastPlacement = null, suspended = false;
  const alive = () => win && !win.isDestroyed();
  const pet = () => { const value = getPetWindow(); return value && !value.isDestroyed() ? value : null; };
  const unavailable = (settings = view === 'settings') => stopped || isSuppressed() || !pet()?.isVisible() ||
    getPresentation()?.mode === 'hidden' || (!settings && getConfig().enabled !== true);
  const state = () => ({ view, session, config: getConfig(), registrationErrors: getErrors(), layout, origin, animation, focus: focusPending });
  const trustedSource = event => Boolean(!stopped && alive() && ready &&
    event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === pathToFileURL(FILE).href);
  const source = event => trustedSource(event) && opened && !suspended && !isSuppressed();
  const cancelHover = () => { clearTimeout(hoverTimer); hoverTimer = null; };
  const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = null; };
  const cancelEdgeIdle = () => { clearTimeout(edgeIdleTimer); edgeIdleTimer = null; };
  function setIgnored(value) {
    if (!alive() || ignored === value) return;
    win.setIgnoreMouseEvents(value, { forward: true }); ignored = value;
  }
  function setPin(value) { if (pinned !== value) { pinned = value; onPin(value); } }
  function setRecording(value) { if (recording !== value) { recording = value; onRecording(value); } }
  function cancelClose() { clearTimeout(closeTimer); closeTimer = null; closing = false; }
  function publish() {
    if (!alive() || !ready) return;
    const packet = state();
    // Focus is a one-shot request, not a reason to redraw settings on the next sync.
    const signature = JSON.stringify({ ...packet, focus: false });
    if (signature === lastPublished && !packet.focus) return;
    lastPublished = signature;
    win.webContents.send('shortcut:state', packet);
  }
  function finishClose() {
    cancelClose();
    if (alive() && win.isVisible()) win.hide();
    setPin(false);
    onLayout();
  }
  function settingsMoved() {
    if (!opened || view !== 'settings' || !settingsPositioned || !alive()) return;
    if (unavailable() || getPresentation()?.dragging) { close({ immediate: true }); return; }
    // Do not clamp each native move: the user must be able to drag across a
    // display seam. Normal sync still clamps after display/config changes.
    layout = { bounds: win.getBounds(), items: [] };
    const visual = petVisualBounds(pet().getBounds(), getPresentation()?.shape, getPresentation());
    origin = { x: visual.x + visual.width / 2 - layout.bounds.x, y: visual.y + visual.height / 2 - layout.bounds.y };
    publish(); onLayout(); sampleCursor(screen.getCursorScreenPoint());
  }
  function rebaseCanvas(actual) {
    const dx = layout.bounds.x - actual.x, dy = layout.bounds.y - actual.y;
    layout = { ...layout, bounds: actual, items: layout.items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy })) };
    origin = { x: origin.x + dx, y: origin.y + dy };
  }
  function canvasMoved() {
    if (view === 'settings') { settingsMoved(); return; }
    if (!(opened || closing) || !alive() || !layout) return;
    const actual = win.getBounds();
    if (sameBounds(actual, layout.bounds)) return;
    // The OS can finish clamping only after showInactive returns.
    if (lastPlacement) lastPlacement.actual = actual;
    rebaseCanvas(actual); publish(); onLayout(); sampleCursor(screen.getCursorScreenPoint());
  }
  function close({ immediate = false } = {}) {
    cancelHover(); cancelLeave(); cancelEdgeIdle(); blocked = true;
    // Closing and recording cancellation must remain possible during suppression.
    const hideImmediately = immediate || unavailable() || getPresentation()?.dragging;
    if (!opened && !closing) { setRecording(false); return; }
    opened = false; focusPending = false; setRecording(false);
    if (hideImmediately || !alive() || !ready || !win.isVisible()) { finishClose(); return; }
    if (closing) return;
    closing = true;
    animation = { session, phase: 'closing', duration: CLOSE_DURATION };
    setIgnored(true);
    publish();
    const created = win, token = session;
    closeTimer = setTimeout(() => {
      if (created === win && token === session && !opened) finishClose();
    }, CLOSE_DURATION);
  }
  function ensure() {
    if (alive()) return;
    win = new BrowserWindow({ width: 416, height: 404, title: '球球 · 快捷打开',
      transparent: true, frame: false, resizable: false, focusable: true, skipTaskbar: true,
      show: false, hasShadow: false, fullscreenable: false, maximizable: false, minimizable: false,
      backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, '../shortcuts-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false } });
    ready = false; ignored = null; lastPublished = null; lastPlacement = null;
    const created = win;
    created.setAlwaysOnTop(true, 'floating');
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    created.setHiddenInMissionControl(true);
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.on('render-process-gone', (_event, details) => {
      if (created !== win) return;
      close({ immediate: true }); created.destroy(); onError(new Error(`快捷面板渲染退出：${details.reason}`));
    });
    created.on('focus', () => { if (created === win && opened) cancelEdgeIdle(); });
    created.webContents.on('before-input-event', () => { if (created === win && opened) cancelEdgeIdle(); });
    created.on('blur', () => { if (created !== win || suspended) return; setRecording(false); if (view !== 'settings') close(); });
    created.on('move', () => { if (created === win) canvasMoved(); });
    created.on('close', event => { if (!stopped && created === win) { event.preventDefault(); close(); } });
    created.on('closed', () => { if (created === win) { close({ immediate: true }); ready = false; win = null; settingsPositioned = false; } });
    created.loadFile(FILE).then(() => { if (created !== win || created.isDestroyed()) return; ready = true; sync(); })
      .catch(error => { if (created === win) close({ immediate: true }); if (!created.isDestroyed()) created.destroy(); onError(error); });
  }
  function sync() {
    if (suspended) return;
    if (!opened) {
      if (closing && (unavailable() || getPresentation()?.dragging)) close({ immediate: true });
      return;
    }
    if (unavailable() || getPresentation()?.dragging) { close({ immediate: true }); return; }
    const bounds = pet().getBounds(), presentation = getPresentation();
    const area = screen.getDisplayMatching(bounds).workArea;
    const visual = petVisualBounds(bounds, presentation?.shape, presentation);
    if (view === 'settings') {
      // Only the first placement follows the pet. Native header dragging owns the
      // position for the rest of this settings session, including other displays.
      const current = settingsPositioned && alive() ? win.getBounds() : null;
      const workArea = current ? screen.getDisplayMatching(current).workArea : area;
      const size = { width: Math.min(416, workArea.width), height: Math.min(600, workArea.height) };
      const placement = current ? {
        x: Math.round(Math.min(Math.max(current.x, workArea.x), workArea.x + workArea.width - size.width)),
        y: Math.round(Math.min(Math.max(current.y, workArea.y), workArea.y + workArea.height - size.height)), ...size
      } : adjacentBounds(visual, workArea, size);
      layout = { bounds: placement, items: [] };
    } else {
      try { layout = layoutShortcuts({ petBounds: visual, workArea: area, shape: getConfig().shape, side: presentation?.side }); }
      catch (error) { close({ immediate: true }); onError(error); return; }
      view = layout.shape || getConfig().shape;
      settingsPositioned = false;
    }
    origin = { x: visual.x + visual.width / 2 - layout.bounds.x, y: visual.y + visual.height / 2 - layout.bounds.y };
    ensure();
    if (!ready) return;
    const requested = layout.bounds, current = win.getBounds();
    // macOS can clamp the transparent animation gutter at a display edge.
    // Keep painted cards, their hit regions and the motion origin at the same
    // global positions when the native canvas does not accept that origin.
    if (!sameBounds(current, requested) && !(sameBounds(lastPlacement?.requested, requested) &&
        sameBounds(lastPlacement?.actual, current))) win.setBounds(requested, false);
    const actual = win.getBounds();
    lastPlacement = { requested, actual };
    rebaseCanvas(actual);
    if (view === 'settings') settingsPositioned = true;
    publish();
    if (focusPending) { setIgnored(false); win.show(); win.focus(); }
    else if (!win.isVisible()) win.showInactive();
    focusPending = false;
    onLayout();
    sampleCursor(screen.getCursorScreenPoint());
  }
  function open({ focus = true, settings = false } = {}) {
    if (suspended || unavailable(settings)) return false;
    cancelClose(); cancelHover(); cancelLeave(); cancelEdgeIdle(); setRecording(false);
    opened = true; session++; view = settings ? 'settings' : getConfig().shape; settingsPositioned = false;
    animation = { session, phase: 'opening', duration: OPEN_DURATION };
    focusPending = focus; setPin(true);
    sync(); return true;
  }
  function wakeFromEdge(point) {
    const presentation = getPresentation(), current = pet();
    if (opened || closing || edgeWakeConsumed || suspended || unavailable(false) || presentation?.dragging ||
      !presentation?.side || presentation.mode !== 'peeked' || !current ||
      !contains(petVisualBounds(current.getBounds(), presentation.shape, presentation), point)) return false;
    if (!open({ focus: false })) return false;
    blocked = true; edgeWakeConsumed = true;
    edgeIdleTimer = setTimeout(() => {
      sampleCursor(screen.getCursorScreenPoint());
      if (edgeIdleTimer === null) return;
      edgeIdleTimer = null; close({ immediate: true });
    }, 2000);
    return true;
  }
  function sampleCursor(point) {
    if (suspended) { cancelHover(); cancelLeave(); return; }
    if (unavailable(opened && view === 'settings') || getPresentation()?.dragging) { if (opened || closing) close({ immediate: true }); cancelHover(); return; }
    const bounds = pet().getBounds(), presentation = getPresentation();
    const target = petVisualBounds(bounds, presentation?.shape, presentation);
    const overPet = contains(target, point);
    if (!overPet) { blocked = false; edgeWakeConsumed = false; }
    if (closing) return;
    if (opened) {
      const hit = view !== 'floating' || layout?.items.some(item => contains({
        ...item, x: item.x + layout.bounds.x, y: item.y + layout.bounds.y }, point));
      if (!overPet && (view === 'settings' || layout?.items.some(item => contains({
        ...item, x: item.x + layout.bounds.x, y: item.y + layout.bounds.y }, point)))) cancelEdgeIdle();
      setIgnored(!hit);
      if (view === 'settings' || alive() && win.isFocused() || overPet || contains(layout?.bounds, point, 16)) cancelLeave();
      else if (!leaveTimer) leaveTimer = setTimeout(() => close(), 650);
      return;
    }
    if (!overPet || blocked || presentation?.mode === 'tucked') { cancelHover(); return; }
    if (!hoverTimer) hoverTimer = setTimeout(() => {
      hoverTimer = null;
      const current = pet(), presentation = getPresentation();
      if (!blocked && !unavailable(false) && !presentation?.dragging && presentation?.mode !== 'tucked' && current &&
        contains(petVisualBounds(current.getBounds(), presentation?.shape, presentation), screen.getCursorScreenPoint())) open({ focus: false });
    }, 450);
  }
  function setSuspended(value) {
    value = value === true;
    if (suspended === value) return;
    suspended = value; cancelHover(); cancelLeave(); cancelEdgeIdle(); focusPending = false;
    if (suspended) {
      if (closing) { finishClose(); return; }
      // A drag borrows the screen without ending the menu/settings session.
      setIgnored(true);
      if (alive() && win.isVisible()) win.hide();
      onLayout();
    } else if (opened) sync();
  }
  function action(id) {
    if (!ACTIONS.has(id)) return;
    cancelEdgeIdle();
    if (id === 'settings') { open({ settings: true }); return; }
    close(); onAction(id);
  }
  function apply(config) {
    cancelEdgeIdle(); setRecording(false);
    const result = save(config);
    if (result.ok) {
      if (view !== 'settings') {
        view = getConfig().shape; settingsPositioned = false; session++;
        animation = { session, phase: 'opening', duration: OPEN_DURATION };
        focusPending = true;
      }
      sync();
    }
    return { ok: result.ok, error: result.errors?.map(error => [error.accelerator, error.message].filter(Boolean).join('：')).join('\n'), state: state() };
  }
  const handlers = {
    'shortcut:get-state': event => source(event) ? state() : null,
    'shortcut:save': (event, config) => source(event) && view === 'settings' ? apply(config) : { ok: false, error: '来源无效。' },
    'shortcut:shape': (event, shape) => source(event) && ['floating', 'list'].includes(shape) ? apply({ ...getConfig(), shape }) : { ok: false, error: '来源无效。' }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const listeners = {
    'shortcut:action': (event, id) => { if (source(event)) action(id); },
    'shortcut:close': event => { if (trustedSource(event)) close(); },
    'shortcut:settings': event => { if (source(event)) open({ settings: true }); },
    'shortcut:pointer': event => { if (source(event)) sampleCursor(screen.getCursorScreenPoint()); },
    'shortcut:recording': (event, value) => {
      if (value === false && trustedSource(event)) setRecording(false);
      else if (value === true && source(event) && view === 'settings') setRecording(true);
    }
  };
  for (const [channel, listener] of Object.entries(listeners)) ipcMain.on(channel, listener);
  return { open, close, sync, sampleCursor, wakeFromEdge, action, setSuspended, getWindow: () => alive() ? win : null,
    getState: state, isOpen: () => opened, isPresenting: () => pinned,
    cancelHover() { cancelHover(); blocked = true; },
    interrupt() { close({ immediate: true }); blocked = true; },
    dispose() { close({ immediate: true }); stopped = true; for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
      for (const [channel, listener] of Object.entries(listeners)) ipcMain.removeListener(channel, listener);
      if (alive()) win.destroy(); }
  };
}
module.exports = { createShortcutWindow };
