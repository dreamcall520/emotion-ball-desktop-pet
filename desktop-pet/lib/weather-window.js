const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { captureQuotaGroupFrames } = require('./quota-group-capture');
const { createLocationBridge } = require('./weather-location');
const { createWeatherService } = require('./weather-service');
const { apiBalanceLabelBounds } = require('./api-balance-label-window');
const { createQuotaCardTransitionWindow } = require('./quota-card-transition-window');

function validCity(value) {
  return value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 100;
}
function weatherExpandedBounds(pet, area, size, obstacles = [], previous = null) {
  const gap = 8, width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const clampX = x => Math.max(area.x, Math.min(x, area.x + area.width - width));
  const clampY = y => Math.max(area.y, Math.min(y, area.y + area.height - height));
  const valid = b => b && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(b[key])) && b.width > 0 && b.height > 0;
  const blocked = [pet, ...obstacles.filter(valid)];
  const intersection = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const padded = blocked.map(b => ({ x: b.x - gap, y: b.y - gap, width: b.width + gap * 2, height: b.height + gap * 2 }));
  const centerX = pet.x + (pet.width - width) / 2, centerY = pet.y + (pet.height - height) / 2;
  const xs = [...new Set([centerX, pet.x - width - gap, pet.x + pet.width + gap, area.x, area.x + area.width - width,
    ...blocked.slice(1).flatMap(b => [b.x - width - gap, b.x + b.width + gap])].map(x => Math.round(clampX(x))))];
  const ys = [...new Set([pet.y - height - gap, pet.y + pet.height + gap, centerY, area.y, area.y + area.height - height,
    ...blocked.slice(1).flatMap(b => [b.y - height - gap, b.y + b.height + gap])].map(y => Math.round(clampY(y))))];
  const candidates = xs.flatMap(x => ys.map(y => {
    const bounds = { x, y, width, height };
    const dx = Math.max(pet.x - x - width, x - pet.x - pet.width, 0), dy = Math.max(pet.y - y - height, y - pet.y - pet.height, 0);
    return { bounds, overlap: padded.reduce((sum, b) => sum + intersection(bounds, b), 0),
      distance: dx * dx + dy * dy, movement: previous ? Math.abs(x - previous.x) + Math.abs(y - previous.y) : 0 };
  }));
  // Keep a nearby legal side while content changes. Only a genuinely cramped
  // screen falls back to the in-bounds candidate with the least overlap.
  candidates.sort((a, b) => a.overlap - b.overlap || a.distance - b.distance || a.movement - b.movement);
  return candidates[0].bounds;
}
function createWeatherWindow({ BrowserWindow, ipcMain, screen, fetch, filePath, getPetWindow, getObstacles = () => [], getStackAnchor = () => null, getCollectionWindow = () => null, getBubbleBounds = () => null, getPresentation = () => null, getSuppressed = () => false, getAppearance = () => 'system', getReducedMotion = () => false, locationBridge = createLocationBridge(), onLayout = () => {}, onChange = () => {}, onError = () => {}, alwaysOnTop = true }) {
  const service = createWeatherService({ fetch });
  let win = null, enabled = false, timer = null, revision = 0, city = null, state = { status: 'unconfigured', city: null }, suspended = false;
  let cardVisible = true, groupTransitionMode = null, groupEpoch = 0, ready = false, cityRequested = false, explicitOpen = false;
  let size = { width: 128, height: 32 }, topmost = alwaysOnTop, expandedAnchor = null, requestedBounds = null;
  let closing = null, collapseEpoch = 0, collapseOverlay = null;
  const collapseContext = () => { const pet = getPetWindow(); return pet && !pet.isDestroyed() ? JSON.stringify([pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea]) : ''; };
  const sameRect = (a, b) => a && b && ['x','y','width','height'].every(key => a[key] === b[key]);
  const endpointUsable = record => {
    if (!record.targetKind) return true;
    const presentation = getPresentation();
    if (Boolean(presentation?.quotaGroupHidden) !== (record.targetKind === 'bar')) return false;
    if (record.targetKind === 'bar') { const bar = getCollectionWindow(); return bar && !bar.isDestroyed() && bar.isVisible() && sameRect(bar.getBounds(), record.target); }
    const pet = getPetWindow().getBounds(), area = screen.getDisplayMatching(pet).workArea;
    return sameRect(apiBalanceLabelBounds(pet, area, getObstacles(), false, getStackAnchor(), { ...presentation, quotaGroupHidden: false }, getBubbleBounds()), record.target);
  };
  const collapseUsable = record => { const pet = getPetWindow(); return enabled && !suspended && cardVisible === record.cardVisible && groupTransitionMode === null && !getSuppressed() && pet && !pet.isDestroyed() && pet.isVisible() && record.context === collapseContext() && endpointUsable(record); };
  async function boundedPaint(promise, label) { let timer; try { return await Promise.race([promise, new Promise((_,reject) => { timer = setTimeout(() => reject(Error('天气收起'+label+'超时')), 600); })]); } finally { clearTimeout(timer); } }
  function overlay() { return collapseOverlay ||= createQuotaCardTransitionWindow({ BrowserWindow, ipcMain, getAlwaysOnTop: () => topmost, onError }); }
  function cancelCollapse() { collapseEpoch++; closing = null; if (win && !win.isDestroyed()) win.setOpacity?.(1); collapseOverlay?.hide(); }
  function resetExpanded() { cancelCollapse(); explicitOpen = false; cityRequested = false; size = { width: 128, height: 32 }; expandedAnchor = null; win?.webContents.send('weather:collapse'); }
  try { const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')); city = validCity(saved.city) ? saved.city : null; enabled = saved.enabled === true; cardVisible = saved.cardVisible !== false; } catch (error) { if (error.code !== 'ENOENT') onError(error); }
  function persist() { fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 }); const temp = filePath + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ enabled, city, cardVisible }), { mode: 0o600 }); fs.renameSync(temp, filePath); }
  const cacheFile = filePath + '.cache';
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (city && cached.city?.latitude === city.latitude && cached.city?.longitude === city.longitude && Number.isFinite(cached.updatedAt) && cached.updatedAt <= Date.now() + 60000 && Number.isFinite(cached.current?.temperature) && Array.isArray(cached.daily) && Array.isArray(cached.hourly)) state = { ...cached, city, status: 'stale', error: '正在尝试更新上次天气' };
  } catch (error) { if (error.code !== 'ENOENT') onError(error); }
  function saveCache() {
    const temp = cacheFile + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(temp, cacheFile); } catch (error) { onError(error); }
  }
  function publish() { const packet = { ...state, enabled, cardVisible, appearance: getAppearance() }; if (win && !win.isDestroyed()) win.webContents.send('weather:state', packet); onChange(packet); return packet; }
  function reposition(animate = false) {
    if (closing) { if (collapseUsable(closing)) return; resetExpanded(); }
    if (!win || win.isDestroyed() || groupTransitionMode === 'hold') return;
    const pet = getPetWindow();
    if (!enabled || (!cardVisible && !explicitOpen) || suspended || ['hold','masked'].includes(groupTransitionMode) || (!explicitOpen && size.width !== 390 && getPresentation()?.quotaGroupHidden) || getSuppressed() || !pet || pet.isDestroyed() || !pet.isVisible()) { win.hide(); return; }
    const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
    const layoutKey = JSON.stringify([bounds, area]);
    if (size.width !== 390) expandedAnchor = null;
    let next;
    if (size.width === 390) {
      // Expanded weather owns the card area. Other quota cards are hidden by
      // onLayout, so their old stack/transparent carriers are not obstacles.
      next = weatherExpandedBounds(bounds, area, size, [getBubbleBounds()], expandedAnchor?.key === layoutKey ? expandedAnchor : null);
      expandedAnchor = { key: layoutKey, x: next.x, y: next.y };
    } else {
      next = apiBalanceLabelBounds(bounds, area, getObstacles(), false, getStackAnchor(), explicitOpen ? { ...getPresentation(), quotaGroupHidden: false } : getPresentation(), getBubbleBounds());
      if (!next) { win.hide(); return; }
    }
    const current = requestedBounds || win.getBounds?.();
    if (!current || ['x','y','width','height'].some(key => current[key] !== next[key])) { requestedBounds = { ...next }; win.setBounds(next, animate && !getReducedMotion()); }
    if (!win.isVisible() && groupTransitionMode !== 'stage') win.showInactive();
    win.setIgnoreMouseEvents?.(groupTransitionMode !== null, { forward: true });
  }
  async function collapseWeather(value) {
    if (closing) { if (value?.reducedMotion === true || getReducedMotion()) { resetExpanded(); reposition(); onLayout(); return { collapsed: true, animated: false }; } return { pending: true }; }
    if (!win || win.isDestroyed() || size.width !== 390 || !win.isVisible() || getReducedMotion() || value?.reducedMotion === true) {
      const wasExpanded = size.width === 390; resetExpanded(); reposition(); if (wasExpanded) onLayout(); return { collapsed: true, animated: false };
    }
    const targetWindow = win, record = { token: ++collapseEpoch, context: collapseContext(), cardVisible };
    closing = record;
    const current = () => closing === record && record.token === collapseEpoch && targetWindow === win && !targetWindow.isDestroyed() && collapseUsable(record);
    try {
      record.stage = 'source-capture';
      const [source] = await captureQuotaGroupFrames({ getTargets: () => [targetWindow], isReady: () => ready, isCurrent: current });
      if (!current()) return { canceled: true };
      // Restore the quota stack first, but keep the original weather painted in
      // place until its full-size snapshot owns the same pixels in the overlay.
      size = { width: 128, height: 32 }; explicitOpen = false; expandedAnchor = null; onLayout();
      if (!current()) return { canceled: true };
      const pet = getPetWindow().getBounds(), area = screen.getDisplayMatching(pet).workArea;
      const collection = getPresentation()?.quotaGroupHidden ? getCollectionWindow() : null;
      const targetWindowForCapture = collection && !collection.isDestroyed() && collection.isVisible() ? collection : targetWindow;
      const targetKind = targetWindowForCapture === targetWindow ? 'compact' : 'bar';
      const compactBounds = targetKind === 'compact' ? apiBalanceLabelBounds(pet, area, getObstacles(), false, getStackAnchor(), { ...getPresentation(), quotaGroupHidden: false }, getBubbleBounds()) : null;
      const target = targetKind === 'bar' ? targetWindowForCapture.getBounds() : compactBounds;
      if (!target) throw Error('天气收起位置暂不可用');
      record.targetKind = targetKind; record.target = { ...target };
      const x = Math.min(source.bounds.x, target.x), y = Math.min(source.bounds.y, target.y);
      const host = { x, y, width: Math.max(source.bounds.x + source.bounds.width, target.x + target.width) - x, height: Math.max(source.bounds.y + source.bounds.height, target.y + target.height) - y };
      const layer = { bounds: source.bounds, image: 'data:image/png;base64,' + source.png.toString('base64') };
      const model = { token: record.token, bounds: host, anchor: target, layers: [layer], expanded: false, scale: screen.getDisplayMatching(pet).scaleFactor || 1 };
      record.stage = 'source-overlay'; await overlay().prepare(model); if (!current()) return { canceled: true };
      collapseOverlay.show(); targetWindow.setOpacity?.(0);
      if (compactBounds) { targetWindow.setBounds(compactBounds, false); requestedBounds = { ...compactBounds }; }
      targetWindow.showInactive(); targetWindow.webContents.send('weather:collapse');
      // macOS stops compositor frames when a previously shown window is hidden
      // then resized. Keep this native host active at zero native opacity under
      // the source overlay; capturePage still receives its opaque DOM pixels.
      const capturedContents = targetWindowForCapture.webContents;
      const previousThrottling = capturedContents.getLastWebPreferences?.().backgroundThrottling !== false;
      let compactImage;
      try {
        capturedContents.setBackgroundThrottling?.(false);
        record.stage = 'compact-dom';
        const compactDom = await boundedPaint(capturedContents.executeJavaScript(`(()=>{document.body.getBoundingClientRect();return ${targetKind === 'bar' ? 'true' : "document.querySelector('#quota-label')?.dataset.expanded==='false'"}})()`), 'DOM');
        if (!compactDom) throw Error('天气收起终点尚未切换为compact');
        if (!current()) return { canceled: true };
        record.stage = 'compact-paint'; compactImage = await boundedPaint(capturedContents.capturePage(), '绘制');
        const pixels = compactImage.getBitmap?.();
        if (compactImage.isEmpty?.() || pixels && !pixels.some((value,index) => index % 4 === 3 && value > 0)) throw Error('天气收起终点画面为空');
      } finally { if (!capturedContents.isDestroyed?.()) capturedContents.setBackgroundThrottling?.(previousThrottling); }
      const compact = { png: compactImage.toPNG() };
      if (!current()) return { canceled: true };
      record.stage = 'target-overlay'; await collapseOverlay.prepare({ ...model, weatherMorph: { source: source.bounds, target, targetKind, compactImage: 'data:image/png;base64,' + compact.png.toString('base64') } });
      if (!current()) return { canceled: true };
      record.stage = 'geometry'; await collapseOverlay.animate({ token: record.token, expanded: false });
      if (!current()) return { canceled: true };
      closing = null; reposition(); targetWindow.setOpacity?.(1); collapseOverlay.hide(); return { collapsed: true, animated: true };
    } catch (error) {
      if (closing === record) { closing = null; resetExpanded(); reposition(); onLayout(); onError(Object.assign(Error('天气连续收起 '+record.stage+': '+error.message), { cause: error })); }
      return { collapsed: true, animated: false };
    } finally { if (closing === record && !current()) { closing = null; resetExpanded(); reposition(); onLayout(); } }
  }
  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ ...size, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: topmost, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, '../weather-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'weather-location' } });
    const owner = win;
    const allowedLocation = (contents, permission) => permission === 'geolocation' && contents === owner.webContents && contents.getURL() === pathToFileURL(path.join(__dirname, '../weather.html')).href;
    win.webContents.session?.setPermissionRequestHandler((contents, permission, callback) => callback(allowedLocation(contents, permission)));
    win.webContents.session?.setPermissionCheckHandler((contents, permission) => allowedLocation(contents, permission));
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => { if (owner === win) { ready = true; publish(); reposition(); if (cityRequested) { cityRequested = false; owner.webContents.send('weather:choose-city'); owner.show(); owner.focus?.(); } } });
    win.on('closed', () => { if (owner === win) { cancelCollapse(); revision++; ready = false; win = null; } });
    void win.loadFile(path.join(__dirname, '../weather.html')).catch(onError);
    return win;
  }
  async function refresh(force = false) {
    if (!enabled || suspended || !city) return publish();
    const token = revision, requested = city;
    state = { ...state, city, status: 'loading', error: null }; publish();
    try {
      const result = await service.getWeather(requested, { force });
      if (token !== revision || !enabled || suspended) return state;
      const data = result.data;
      const previous = state;
      state = data ? { ...data, city: { ...requested, timezone: data.timezone || requested.timezone }, status: result.status, error: typeof result.error === 'string' ? result.error : result.error?.message, updatedAt: result.updatedAt || data.updatedAt }
        : { status: 'error', city: requested, error: result.error?.message || result.error || '天气暂时无法获取' };
      if (!data && previous.current && previous.city?.latitude === requested.latitude && previous.city?.longitude === requested.longitude) state = { ...previous, city: requested, status: 'stale', error: state.error };
      if (state.status === 'ready') saveCache();
    } catch (error) { if (token !== revision || !enabled || suspended) return state; state = { ...state, status: state.current ? 'stale' : 'error', error: '天气更新失败，请稍后重试' }; onError(error); }
    return publish();
  }
  async function select(value, mode = 'manual', waitForWeather = true) {
    if (!validCity(value)) throw new Error('请选择有效城市');
    const previous = city; city = { name: value.name.trim(), latitude: value.latitude, longitude: value.longitude, ...(typeof value.displayName === 'string' && value.displayName.trim() && value.displayName.length <= 100 ? { displayName: value.displayName.trim() } : {}), timezone: typeof value.timezone === 'string' ? value.timezone : 'auto', mode };
    try { persist(); } catch (error) { city = previous; throw error; }
    revision++; state = { status: 'loading', city }; if (waitForWeather) return refresh(); void refresh(); return publish();
  }
  const trusted = event => Boolean(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname, '../weather.html')).href);
  for (const [channel, handler] of Object.entries({
    'weather:get': () => publish(), 'weather:refresh': () => refresh(true), 'weather:collapse': value => collapseWeather(value),
    'weather:search': query => typeof query === 'string' && query.trim().length >= 2 && query.length <= 100 ? service.searchCities(query.trim()) : [],
    'weather:city': value => select(value),
    'weather:location': async value => {
      if (value !== undefined && value !== null) throw new Error('定位仅接受系统位置');
      const token = revision;
      try {
        ensureWindow().show(); win.focus?.();
        const coordinates = await locationBridge.locate();
        if (token !== revision || !enabled || !win || win.isDestroyed()) return { cancelled: true };
        return await select({ ...coordinates, name: coordinates.name || '当前位置', displayName: coordinates.locationLabel || coordinates.name }, 'current', false);
      } catch (error) { return { locationError: { code: error.code || 'LOCATION_UNAVAILABLE', message: error.message } }; }
    },
    'weather:resize': value => {
      const wasExpanded = size.width === 390, expanded = value === true || value?.expanded === true;
      if (expanded && closing) cancelCollapse();
      if (!expanded) explicitOpen = false;
      const next = { width: expanded ? 390 : 128, height: expanded ? Math.max(210, Math.min(720, Math.round(Number.isFinite(value?.height) ? value.height : 620))) : 32 };
      if (next.width === size.width && next.height === size.height) return size;
      size = next;
      // Collapse is painted by the overlay. A native shrink animation races
      // viewport resize and the quota cards that reappear in onLayout.
      if (win) reposition(expanded && !wasExpanded);
      if (expanded && typeof ipcMain.on === 'function') void overlay().warm();
      if (wasExpanded !== expanded) onLayout();
      return size;
    }
  })) ipcMain.handle(channel, (event, value) => { if (!trusted(event)) return null; return handler(value); });
  function setEnabled(value) { if (value !== true && closing) resetExpanded(); const previous = enabled; enabled = value === true; try { persist(); } catch (error) { enabled = previous; throw error; } revision++; clearInterval(timer); timer = null; if (enabled) { ensureWindow(); timer = setInterval(() => { if (!suspended) void refresh(); }, 30 * 60 * 1000); timer.unref?.(); void refresh(); } else win?.hide(); publish(); reposition(); onLayout(); }
  return { start() { if (enabled) setEnabled(true); }, setEnabled, isEnabled: () => enabled, getState: () => state, getWindow: () => win, getCollapseWindow: () => collapseOverlay?.getWindow() || null, isClosing: () => closing !== null, isExpanded: () => enabled && (cardVisible || explicitOpen) && size.width === 390, isCardVisible: () => cardVisible,
    setCardVisible(value) { const previous = cardVisible; cardVisible = value === true; try { persist(); } catch (error) { cardVisible = previous; throw error; } publish(); reposition(); onLayout(); },
    getBounds: () => win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null,
    getVisibleBounds: () => win && !win.isDestroyed() && (win.isVisible() || groupTransitionMode === 'stage') ? win.getBounds() : null,
    getLayoutMetrics: () => enabled && cardVisible ? { width: 128, height: 32, inset: 2 } : null,
    resetExpanded,
    setGroupTransitionMode(mode) { if (closing && mode !== null) return; if (![null,'hold','stage','masked'].includes(mode) || mode === groupTransitionMode) return; groupTransitionMode = mode; groupEpoch++; if (mode === 'stage' || mode === 'masked') win?.hide(); reposition(); },
    captureGroupTransitionFrames() { if (closing) return Promise.resolve([]); const target = win, epoch = groupEpoch; return captureQuotaGroupFrames({ getTargets: () => [target], isReady: () => ready && enabled && cardVisible && win === target && !target.isDestroyed(), isCurrent: () => epoch === groupEpoch && win === target && (groupTransitionMode !== 'stage' || !getPresentation()?.quotaGroupHidden) }); },
    setAlwaysOnTop(value) { topmost = Boolean(value); win?.setAlwaysOnTop(topmost, 'floating'); },
    openCity() { cancelCollapse(); if (!enabled) setEnabled(true); explicitOpen = true; size = { width: 390, height: 210 }; const target = ensureWindow(); if (ready) { target.webContents.send('weather:choose-city'); target.show(); target.focus?.(); } else cityRequested = true; reposition(); onLayout(); },
    open() { if (!enabled) setEnabled(true); ensureWindow(); reposition(); publish(); }, reposition,
    pause() { if (closing) resetExpanded(); suspended = true; revision++; win?.hide(); }, resume() { suspended = false; reposition(); if (enabled) void refresh(); },
    destroy() { cancelCollapse(); collapseOverlay?.destroy(); revision++; clearInterval(timer); win?.destroy(); win = null; for (const name of ['get','refresh','search','city','location','resize','collapse']) ipcMain.removeHandler('weather:' + name); } };
}
module.exports = { createWeatherWindow, validCity, weatherExpandedBounds };
