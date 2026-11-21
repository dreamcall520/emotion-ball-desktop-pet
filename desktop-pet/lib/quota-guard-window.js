const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { safeModel } = require('./quota-label-window');
const { placeDetails } = require('./codex-details-window');
const { adjacentBounds } = require('./window-placement');

const CHANNEL = 'pet:quota-guard-model';

function guardReadyKey(value) {
  const item = value?.practice === true ? { remaining: 100, windowMinutes: 300 } : value?.items?.[0];
  if (value?.state !== 'ready' || !item) return null;
  const zcode = value.sourceId === 'zcode';
  return JSON.stringify([value.practice === true, value.sourceId === 'zcode' ? 'zcode' : 'codex',
    item.windowMinutes, item.remaining, zcode ? item.bucketId || null : null,
    zcode ? item.periodStart ?? null : null, zcode ? item.resetsAt ?? null : null]);
}

function guardModel(value, size = 'standard', appearance = 'system', visible = false) {
  const sourceId = value?.sourceId === 'zcode' ? 'zcode' : 'codex';
  const model = safeModel(value, sourceId);
  return { ...model, ...(sourceId === 'zcode' ? { items: model.items.slice(0, 1).filter(item =>
    /^zcode:[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,394}$/u.test(item.bucketId)
    && Number.isSafeInteger(item.resetsAt) && item.resetsAt > 0) } : {}), size: size === 'compact' ? 'compact' : 'standard',
    appearance: ['light', 'dark'].includes(appearance) ? appearance : 'system', expanded: false,
    visible: visible === true, ...(value?.practice === true ? { practice: true } : {}) };
}

function createQuotaGuardWindow({ BrowserWindow, screen, getAnchor, getSize = () => 'standard',
  getAppearance = () => 'system', getObstacles = () => [], canShow = () => true, alwaysOnTop = true,
  prepareWindow = () => {}, onPresentation = () => {}, onError = () => {}, onVisibilityChange = () => {}, onLayout = () => {} }) {
  const file = path.join(__dirname, '../quota-guard.html');
  const url = pathToFileURL(file).href;
  let win = null, ready = false, model = null, visible = false, topmost = Boolean(alwaysOnTop);
  let presenting = null, presentationEpoch = 0, opened = false;
  let loaded = null, resolveLoaded = null, prewarmFlight = null, presentationNotice = null;
  const alive = () => Boolean(win && !win.isDestroyed());
  const report = error => { try { onError(error); } catch (_) {} };
  const allowed = () => { try { return canShow() === true; } catch (error) { report(error); return false; } };
  function changed(value) {
    if (visible === value) return;
    visible = value;
    try { onVisibilityChange(value); } catch (error) { report(error); }
  }
  function layoutChanged() {
    try { onLayout(); } catch (error) { report(error); }
  }
  function send() {
    if (!alive() || !ready || !model || !opened) return;
    try { win.webContents.send(CHANNEL, { ...model, visible }); } catch (error) { report(error); }
  }
  function bounds() {
    const anchor = getAnchor?.() || screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(anchor).workArea;
    const size = { width: Math.min(420, area.width), height: Math.min(model?.practice === true ? 310 : 410, area.height) };
    const placed = placeDetails(anchor, area, size), obstacles = getObstacles();
    const intersects = obstacle => obstacle && placed.x < obstacle.x + obstacle.width && placed.x + placed.width > obstacle.x &&
      placed.y < obstacle.y + obstacle.height && placed.y + placed.height > obstacle.y;
    const { x, y, width, height } = obstacles.some(intersects) ? adjacentBounds(anchor, area, size, obstacles) : placed;
    return { x, y, width, height };
  }
  function close() {
    presentationEpoch++; presenting = null; presentationNotice = null;
    changed(false);
    send();
    if (alive()) { try { win.hide(); } catch (error) { report(error); } }
    layoutChanged();
  }
  function destroy() {
    presentationEpoch++; presenting = null; presentationNotice = null;
    resolveLoaded?.(false); resolveLoaded = null; loaded = null; prewarmFlight = null;
    const target = win;
    win = null; ready = false; model = null; opened = false;
    changed(false);
    if (target && !target.isDestroyed()) { try { target.destroy(); } catch (error) { report(error); } }
  }
  function present(focus = false) {
    if (!alive() || !ready || !visible) return;
    if (!allowed()) { close(); return; }
    try {
      win.setBounds(bounds(), false);
      send();
      if (!visible || !allowed()) { close(); return; }
      if (win.isVisible()) {
        if (focus) { win.show(); win.focus(); }
        layoutChanged(); return;
      }
      const key = guardReadyKey(model);
      if (!key) { close(); return; }
      if (presenting?.target === win && presenting.key === key) { presenting.focus ||= focus; return; }
      const request = { target: win, key, focus, epoch: ++presentationEpoch }; presenting = request;
      // did-finish-load precedes asynchronous bitmap decoding. Keep the native
      // window hidden until the renderer has applied this exact model and drawn
      // its decoded local sprites; no timer or provider request is involved.
      Promise.resolve(win.webContents.executeJavaScript(`window.quotaGuardView.whenReady(${JSON.stringify(key)})`)).then(applied => {
        if (presenting !== request || request.epoch !== presentationEpoch || win !== request.target || !alive() || !visible || guardReadyKey(model) !== request.key) return;
        presenting = null;
        if (applied !== true) return;
        if (!allowed()) { close(); return; }
        presentationNotice = { epoch: request.epoch, key: request.key, practice: model.practice === true };
        if (request.focus) { win.show(); win.focus(); } else win.showInactive();
        layoutChanged();
      }).catch(error => { if (presenting === request) { report(error); destroy(); } });
    } catch (error) { report(error); destroy(); }
  }
  function ensure(preparing = false) {
    if (alive()) return;
    let initialBounds;
    if (preparing) {
      // Startup warming precedes the pet window. A hidden decoding surface only
      // needs a valid screen rectangle; it must not run adjacent pet placement.
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(420, area.width), height = Math.min(410, area.height);
      initialBounds = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
    } else initialBounds = bounds();
    win = new BrowserWindow({ ...initialBounds, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false, useContentSize: true,
      fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      title: '球球守护战', webPreferences: { preload: path.join(__dirname, '../quota-guard-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        spellcheck: false } });
    const target = win;
    loaded = new Promise(resolve => { resolveLoaded = resolve; });
    prepareWindow(target);
    target.setAlwaysOnTop(topmost, 'floating');
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', event => event.preventDefault());
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    target.on('show', () => {
      const notice = presentationNotice; presentationNotice = null;
      if (win !== target || !visible || !notice || notice.epoch !== presentationEpoch || notice.key !== guardReadyKey(model) || !target.isVisible()) return;
      try { onPresentation({ practice: notice.practice, ready: true }); } catch (error) { report(error); }
    });
    target.on('close', event => { if (win === target) { event.preventDefault(); close(); } });
    target.on('closed', () => { if (win === target) { resolveLoaded?.(false); resolveLoaded = null; loaded = null; prewarmFlight = null; win = null; ready = false; opened = false; changed(false); } });
    target.webContents.once('did-finish-load', () => {
      if (win !== target) return;
      ready = true; resolveLoaded?.(true); resolveLoaded = null; if (!visible) send(); present(true);
    });
    Promise.resolve(target.loadFile(file)).catch(error => { report(error); if (win === target) destroy(); });
  }
  return {
    prewarm() {
      if (visible) return Promise.resolve(ready);
      if (prewarmFlight && alive()) return prewarmFlight;
      try {
        ensure(true); const target = win, loading = loaded;
        prewarmFlight = Promise.resolve(loading).then(ok => ok && win === target && !target.isDestroyed() && !visible
          ? target.webContents.executeJavaScript('window.quotaGuardView.whenReady(null)') : false)
          .then(ok => ok === true && win === target && !target.isDestroyed())
          .catch(error => { if (win === target && !visible) { report(error); destroy(); } return false; });
        return prewarmFlight;
      } catch (error) { report(error); destroy(); return Promise.resolve(false); }
    },
    open(value) {
      const next = guardModel(value, getSize(), getAppearance(), true);
      if (!allowed() || next.state !== 'ready' || (!next.items.length && next.practice !== true)) return false;
      model = next; opened = true;
      try { ensure(); changed(true); present(true); return true; }
      catch (error) { report(error); destroy(); return false; }
    },
    update(value) {
      model = guardModel(value, getSize(), getAppearance(), visible);
      if (visible && !allowed()) close();
      else if (visible && alive() && !win.isVisible()) present();
      else send();
    },
    reposition() { if (visible) present(); },
    owns(event) {
      return Boolean(alive() && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === url);
    },
    setAlwaysOnTop(value) { topmost = Boolean(value); if (alive()) win.setAlwaysOnTop(topmost, 'floating'); },
    getWindow() { return alive() ? win : null; },
    isVisible() { return visible && alive(); },
    close, destroy
  };
}

module.exports = { createQuotaGuardWindow, guardModel, guardReadyKey, CHANNEL };
