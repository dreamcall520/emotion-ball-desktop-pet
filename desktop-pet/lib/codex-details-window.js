const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { GAP } = require('./quota-label-placement');

const ACTIONS = new Set(['tasks', 'results', 'trend', 'opportunities', 'credits']);
const WIDTHS = { tasks: 340, results: 340, trend: 404, opportunities: 360, credits: 360 };

function placeDetails(pet, area, size, preferred = null) {
  const right = area.x + area.width, bottom = area.y + area.height;
  const below = Math.max(area.y, pet.y + pet.height + GAP);
  const beside = Math.max(area.x, pet.x + pet.width + GAP);
  const spaces = [
    { side: 'below', x: area.x, y: below, width: area.width, height: bottom - below },
    { side: 'above', x: area.x, y: area.y, width: area.width, height: Math.min(bottom, pet.y - GAP) - area.y },
    { side: 'right', x: beside, y: area.y, width: right - beside, height: area.height },
    { side: 'left', x: area.x, y: area.y, width: Math.min(right, pet.x - GAP) - area.x, height: area.height }
  ].filter(space => space.width >= 1 && space.height >= 1);
  const fitting = spaces.filter(space => space.width >= size.width && space.height >= size.height);
  let space = fitting.find(value => value.side === preferred) || fitting[0];
  if (!space) {
    // Preserve the readable panel width first; its existing vertical scroll
    // handles content taller than the free strip beside the pet.
    const fullWidth = spaces.filter(value => value.width >= size.width);
    const candidates = fullWidth.length ? fullWidth : spaces;
    space = candidates.sort((a, b) => {
      const retained = value => Math.min(size.width, value.width) * Math.min(size.height, value.height);
      return retained(b) - retained(a) || Number(b.side === preferred) - Number(a.side === preferred);
    })[0];
  }
  if (!space) throw new Error('球球周围没有可用的详情窗口空间');
  const width = Math.min(size.width, Math.floor(space.width));
  const height = Math.min(size.height, Math.floor(space.height));
  const clamp = (value, start, length, span) => Math.max(start, Math.min(value, start + length - span));
  const x = space.side === 'right' ? space.x : space.side === 'left' ? space.x + space.width - width
    : clamp(pet.x + (pet.width - width) / 2, space.x, space.width, width);
  const y = space.side === 'below' ? space.y : space.side === 'above' ? space.y + space.height - height
    : clamp(pet.y + (pet.height - height) / 2, space.y, space.height, height);
  return { x: Math.round(x), y: Math.round(y), width, height, placement: space.side };
}

function createCodexDetailsWindow({ BrowserWindow, screen, getAnchor, alwaysOnTop = true,
  onError = () => {}, onVisibilityChange = () => {} }) {
  const file = path.join(__dirname, '../codex-details.html');
  const url = pathToFileURL(file).href;
  let win = null, ready = false, model = null, visible = false, topmost = alwaysOnTop;
  let lastVisible = false;
  let lastBounds = null, placement = null, manuallyMoved = false;
  const alive = () => win && !win.isDestroyed();
  const report = error => { try { onError(error); } catch (_) {} };
  function visibilityChanged(value) {
    if (lastVisible === value) return;
    lastVisible = value;
    try { onVisibilityChange(value); } catch (error) { report(error); }
  }
  function bounds(height, { fromAnchor = false } = {}) {
    const previous = !fromAnchor && alive() ? win.getBounds() : null;
    if (fromAnchor) { placement = null; manuallyMoved = false; }
    else if (previous && lastBounds && (previous.x !== lastBounds.x || previous.y !== lastBounds.y)) manuallyMoved = true;
    const pet = manuallyMoved ? null : getAnchor?.();
    const anchor = manuallyMoved ? previous : pet || previous || screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(WIDTHS[model?.action] || 360, area.width);
    height = Math.min(Math.max(120, Math.round(height)), 700, area.height);
    if (pet) {
      const result = placeDetails(pet, area, { width, height }, placement);
      placement = result.placement;
      const { x, y } = result;
      return { x, y, width: result.width, height: result.height };
    }
    const x = previous?.x ?? anchor.x + (anchor.width - width) / 2;
    const y = previous?.y ?? anchor.y + (anchor.height - height) / 2;
    return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height };
  }
  function applyBounds(value) {
    win.setBounds(value, false);
    lastBounds = win.getBounds();
  }
  function send() {
    if (!alive() || !ready || !model) return;
    try { win.webContents.send('pet:codex-details', model); }
    catch (error) { report(error); }
  }
  function close() { visible = false; if (alive()) win.hide(); visibilityChanged(false); }
  function destroy() {
    visible = false; ready = false; model = null; lastBounds = null; placement = null; manuallyMoved = false;
    const previous = win; win = null;
    if (previous && !previous.isDestroyed()) previous.destroy();
    visibilityChanged(false);
  }
  function ensure() {
    if (alive()) return;
    win = new BrowserWindow({ ...bounds(model?.action === 'trend' ? 420 : 300),
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, useContentSize: true,
      fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      title: 'Codex 详情', webPreferences: { preload: path.join(__dirname, '../codex-details-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        spellcheck: false } });
    const target = win;
    target.setAlwaysOnTop(Boolean(topmost), 'floating');
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', event => event.preventDefault());
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    target.on('closed', () => { if (win === target) { win = null; ready = false; visible = false; visibilityChanged(false); } });
    target.webContents.once('did-finish-load', () => {
      if (win !== target) return;
      ready = true; send(); if (visible) target.show();
    });
    Promise.resolve(target.loadFile(file)).catch(error => { report(error); if (win === target) destroy(); });
  }
  return {
    open(value) {
      if (!ACTIONS.has(value?.action)) return false;
      model = value; visible = true;
      try { ensure(); applyBounds(bounds(value.action === 'trend' ? 420 : 300, { fromAnchor: true })); visibilityChanged(true); send(); if (ready) win.show(); return true; }
      catch (error) { report(error); destroy(); return false; }
    },
    update(value) { if (!visible || !alive()) return; model = value; send(); },
    owns(event) {
      return Boolean(alive() && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === url);
    },
    resize(height) {
      if (!alive() || !visible || !Number.isSafeInteger(height) || height < 120 || height > 2000) return;
      try { applyBounds(bounds(height)); } catch (error) { report(error); }
    },
    setAlwaysOnTop(value) { topmost = Boolean(value); if (alive()) win.setAlwaysOnTop(topmost, 'floating'); },
    getWindow() { return alive() ? win : null; },
    getAction() { return model?.action || null; },
    getPeriod() { return model?.period || null; },
    isVisible() { return visible && Boolean(alive()); },
    close, destroy
  };
}

module.exports = { createCodexDetailsWindow, ACTIONS, placeDetails };
