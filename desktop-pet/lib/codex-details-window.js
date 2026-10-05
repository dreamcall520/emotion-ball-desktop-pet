const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ACTIONS = new Set(['tasks', 'results', 'trend', 'opportunities', 'credits']);
const WIDTHS = { tasks: 340, results: 340, trend: 404, opportunities: 360, credits: 360 };

function createCodexDetailsWindow({ BrowserWindow, screen, getAnchor, alwaysOnTop = true,
  onError = () => {}, onVisibilityChange = () => {} }) {
  const file = path.join(__dirname, '../codex-details.html');
  const url = pathToFileURL(file).href;
  let win = null, ready = false, model = null, visible = false, topmost = alwaysOnTop;
  let lastVisible = false;
  const alive = () => win && !win.isDestroyed();
  const report = error => { try { onError(error); } catch (_) {} };
  function visibilityChanged(value) {
    if (lastVisible === value) return;
    lastVisible = value;
    try { onVisibilityChange(value); } catch (error) { report(error); }
  }
  function bounds(height) {
    const anchor = getAnchor?.() || screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(WIDTHS[model?.action] || 360, area.width);
    height = Math.min(Math.max(120, Math.round(height)), 700, area.height);
    const previous = alive() ? win.getBounds() : null;
    const x = previous?.x ?? anchor.x + (anchor.width - width) / 2;
    const y = previous?.y ?? anchor.y + (anchor.height - height) / 2;
    return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height };
  }
  function send() {
    if (!alive() || !ready || !model) return;
    try { win.webContents.send('pet:codex-details', model); }
    catch (error) { report(error); }
  }
  function close() { visible = false; if (alive()) win.hide(); visibilityChanged(false); }
  function destroy() {
    visible = false; ready = false; model = null;
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
      try { ensure(); win.setBounds(bounds(value.action === 'trend' ? 420 : 300)); visibilityChanged(true); send(); if (ready) win.show(); return true; }
      catch (error) { report(error); destroy(); return false; }
    },
    update(value) { if (!visible || !alive()) return; model = value; send(); },
    owns(event) {
      return Boolean(alive() && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === url);
    },
    resize(height) {
      if (!alive() || !visible || !Number.isSafeInteger(height) || height < 120 || height > 2000) return;
      try { win.setBounds(bounds(height)); } catch (error) { report(error); }
    },
    setAlwaysOnTop(value) { topmost = Boolean(value); if (alive()) win.setAlwaysOnTop(topmost, 'floating'); },
    getWindow() { return alive() ? win : null; },
    getAction() { return model?.action || null; },
    getPeriod() { return model?.period || null; },
    isVisible() { return visible && Boolean(alive()); },
    close, destroy
  };
}

module.exports = { createCodexDetailsWindow, ACTIONS };
