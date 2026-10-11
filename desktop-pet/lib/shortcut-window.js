const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { adjacentBounds } = require('./window-placement');
const { petVisualBounds } = require('./pet-visual-bounds');
const { layoutShortcuts } = require('./shortcut-layout');

const FILE = path.join(__dirname, '../shortcuts.html');
const ACTIONS = new Set(['chat', 'custom', 'note', 'todo', 'pomodoro', 'settings']);
const contains = (r, p, margin = 0) => Boolean(r && p && p.x >= r.x - margin && p.y >= r.y - margin &&
  p.x < r.x + r.width + margin && p.y < r.y + r.height + margin);

function createShortcutWindow({ BrowserWindow, ipcMain, screen, getPetWindow,
  getPresentation, getConfig, getErrors, save, onAction, onPin, onRecording,
  isSuppressed = () => false, onError = () => {} }) {
  let win = null, ready = false, opened = false, stopped = false, view = null, layout = null, session = 0;
  let focusPending = false, ignored = null, hoverTimer = null, leaveTimer = null, blocked = false;
  const alive = () => win && !win.isDestroyed();
  const pet = () => { const value = getPetWindow(); return value && !value.isDestroyed() ? value : null; };
  const unavailable = () => stopped || isSuppressed() || !pet()?.isVisible() || getPresentation()?.mode === 'hidden';
  const state = () => ({ view, session, config: getConfig(), registrationErrors: getErrors(), layout, focus: focusPending });
  const source = event => Boolean(!stopped && !isSuppressed() && alive() && opened && ready &&
    event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === pathToFileURL(FILE).href);
  const cancelHover = () => { clearTimeout(hoverTimer); hoverTimer = null; };
  const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = null; };
  function setIgnored(value) {
    if (!alive() || ignored === value) return;
    win.setIgnoreMouseEvents(value, { forward: true }); ignored = value;
  }
  function close() {
    opened = false; focusPending = false; cancelHover(); cancelLeave(); blocked = true;
    onRecording(false); onPin(false);
    if (alive()) win.hide();
  }
  function ensure() {
    if (alive()) return;
    win = new BrowserWindow({ width: 416, height: 404, title: '球球 · 快捷打开',
      transparent: true, frame: false, resizable: false, focusable: true, skipTaskbar: true,
      show: false, hasShadow: false, fullscreenable: false, maximizable: false, minimizable: false,
      backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, '../shortcuts-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false } });
    ready = false; ignored = null;
    const created = win;
    created.setAlwaysOnTop(true, 'floating');
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    created.setHiddenInMissionControl(true);
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.on('render-process-gone', (_event, details) => {
      if (created !== win) return;
      close(); created.destroy(); onError(new Error(`快捷面板渲染退出：${details.reason}`));
    });
    created.on('blur', () => { if (created === win) close(); });
    created.on('close', event => { if (!stopped && created === win) { event.preventDefault(); close(); } });
    created.on('closed', () => { if (created === win) { ready = false; win = null; } });
    created.loadFile(FILE).then(() => { if (created !== win || created.isDestroyed()) return; ready = true; sync(); })
      .catch(error => { if (created === win) close(); if (!created.isDestroyed()) created.destroy(); onError(error); });
  }
  function sync() {
    if (!opened) return;
    if (unavailable() || getPresentation()?.dragging) { close(); return; }
    const bounds = pet().getBounds(), presentation = getPresentation();
    const area = screen.getDisplayMatching(bounds).workArea;
    const visual = petVisualBounds(bounds, presentation?.shape, presentation);
    if (view === 'settings') {
      const size = { width: Math.min(416, area.width), height: Math.min(680, area.height) };
      layout = { bounds: adjacentBounds(visual, area, size), items: [] };
    } else {
      try { layout = layoutShortcuts({ petBounds: visual, workArea: area, shape: getConfig().shape, side: presentation?.side }); }
      catch (error) { close(); onError(error); return; }
      view = layout.shape || getConfig().shape;
    }
    ensure();
    if (!ready) return;
    win.setBounds(layout.bounds, false);
    win.webContents.send('shortcut:state', state());
    if (focusPending) { setIgnored(false); win.show(); win.focus(); }
    else if (!win.isVisible()) win.showInactive();
    focusPending = false;
    sampleCursor(screen.getCursorScreenPoint());
  }
  function open({ focus = true, settings = false } = {}) {
    if (unavailable()) return false;
    cancelHover(); cancelLeave(); opened = true; session++; view = settings ? 'settings' : getConfig().shape;
    focusPending = focus; onPin(true);
    sync(); return true;
  }
  function sampleCursor(point) {
    if (unavailable() || getPresentation()?.dragging) { if (opened) close(); cancelHover(); return; }
    const bounds = pet().getBounds(), presentation = getPresentation();
    const target = petVisualBounds(bounds, presentation?.shape, presentation);
    const overPet = contains(target, point);
    if (!overPet) blocked = false;
    if (opened) {
      const hit = view !== 'floating' ? contains(layout?.bounds, point) : layout?.items.some(item => contains({
        ...item, x: item.x + layout.bounds.x, y: item.y + layout.bounds.y }, point));
      setIgnored(!hit);
      if (view === 'settings' || alive() && win.isFocused() || overPet || contains(layout?.bounds, point, 16)) cancelLeave();
      else if (!leaveTimer) leaveTimer = setTimeout(close, 650);
      return;
    }
    if (!overPet || blocked || presentation?.mode === 'tucked') { cancelHover(); return; }
    if (!hoverTimer) hoverTimer = setTimeout(() => {
      hoverTimer = null;
      const current = pet(), presentation = getPresentation();
      if (!blocked && !unavailable() && !presentation?.dragging && presentation?.mode !== 'tucked' && current &&
        contains(petVisualBounds(current.getBounds(), presentation?.shape, presentation), screen.getCursorScreenPoint())) open({ focus: false });
    }, 450);
  }
  function action(id) {
    if (!ACTIONS.has(id)) return;
    if (id === 'settings') { open({ settings: true }); return; }
    close(); onAction(id);
  }
  function apply(config) {
    onRecording(false);
    const result = save(config);
    if (result.ok) { view = getConfig().shape; focusPending = true; sync(); }
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
    'shortcut:close': event => { if (source(event)) close(); },
    'shortcut:settings': event => { if (source(event)) open({ settings: true }); },
    'shortcut:pointer': event => { if (source(event)) sampleCursor(screen.getCursorScreenPoint()); },
    'shortcut:recording': (event, value) => { if (source(event) && view === 'settings' && typeof value === 'boolean') onRecording(value); }
  };
  for (const [channel, listener] of Object.entries(listeners)) ipcMain.on(channel, listener);
  return { open, close, sync, sampleCursor, action, getWindow: () => alive() ? win : null,
    getState: state, isOpen: () => opened,
    cancelHover() { cancelHover(); blocked = true; },
    interrupt() { close(); blocked = true; },
    dispose() { close(); stopped = true; for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
      for (const [channel, listener] of Object.entries(listeners)) ipcMain.removeListener(channel, listener);
      if (alive()) win.destroy(); }
  };
}
module.exports = { createShortcutWindow };
