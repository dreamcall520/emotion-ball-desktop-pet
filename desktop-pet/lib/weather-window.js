const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { captureQuotaGroupFrames } = require('./quota-group-capture');
const { createLocationBridge } = require('./weather-location');
const { createWeatherService } = require('./weather-service');
const { apiBalanceLabelBounds } = require('./api-balance-label-window');

function validCity(value) {
  return value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 100;
}
function createWeatherWindow({ BrowserWindow, ipcMain, screen, fetch, filePath, getPetWindow, getObstacles = () => [], getStackAnchor = () => null, getBubbleBounds = () => null, getPresentation = () => null, getSuppressed = () => false, getAppearance = () => 'system', getReducedMotion = () => false, locationBridge = createLocationBridge(), onLayout = () => {}, onChange = () => {}, onError = () => {}, alwaysOnTop = true }) {
  const service = createWeatherService({ fetch });
  let win = null, enabled = false, timer = null, revision = 0, city = null, state = { status: 'unconfigured', city: null }, suspended = false;
  let cardVisible = true, groupTransitionMode = null, groupEpoch = 0, ready = false, cityRequested = false, explicitOpen = false;
  let size = { width: 128, height: 32 }, topmost = alwaysOnTop, expandedAnchor = null, requestedBounds = null;
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
    if (!win || win.isDestroyed() || groupTransitionMode === 'hold') return;
    const pet = getPetWindow();
    if (!enabled || (!cardVisible && !explicitOpen) || suspended || ['hold','masked'].includes(groupTransitionMode) || (!explicitOpen && getPresentation()?.quotaGroupHidden) || getSuppressed() || !pet || pet.isDestroyed() || !pet.isVisible()) { win.hide(); return; }
    const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
    const layoutKey = JSON.stringify([bounds, area]);
    if (size.width !== 390) expandedAnchor = null;
    let next;
    if (expandedAnchor?.key === layoutKey) {
      next = { x: expandedAnchor.x, y: expandedAnchor.y, width: Math.min(size.width, area.width), height: Math.min(size.height, area.y + area.height - expandedAnchor.y) };
    } else {
      const compact = apiBalanceLabelBounds(bounds, area, getObstacles(), false, getStackAnchor(), explicitOpen ? { ...getPresentation(), quotaGroupHidden: false } : getPresentation(), getBubbleBounds());
      if (!compact) { win.hide(); return; }
      if (size.width === 390) {
        const width = Math.min(size.width, area.width), x = Math.max(area.x, Math.min(compact.x + (compact.width - width) / 2, area.x + area.width - width));
        // Reserve the supported expanded envelope once so switching between
        // city search and forecasts keeps a stable origin without clipping.
        const y = Math.max(area.y, Math.min(compact.y, area.y + area.height - Math.min(720, area.height)));
        const height = Math.min(size.height, area.height);
        next = { x: Math.round(x), y, width, height };
        expandedAnchor = { key: layoutKey, x: next.x, y: next.y };
      } else next = compact;
    }
    const current = requestedBounds || win.getBounds?.();
    if (!current || ['x','y','width','height'].some(key => current[key] !== next[key])) { requestedBounds = { ...next }; win.setBounds(next, animate && !getReducedMotion()); }
    if (!win.isVisible() && groupTransitionMode !== 'stage') win.showInactive();
    win.setIgnoreMouseEvents?.(groupTransitionMode !== null, { forward: true });
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
    win.on('closed', () => { if (owner === win) { revision++; ready = false; win = null; } });
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
    'weather:get': () => publish(), 'weather:refresh': () => refresh(true),
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
    'weather:resize': value => { const wasExpanded = size.width === 390; const expanded = value === true || value?.expanded === true; if (!expanded) explicitOpen = false; size = { width: expanded ? 390 : 128, height: expanded ? Math.max(210, Math.min(720, Math.round(Number.isFinite(value?.height) ? value.height : 620))) : 32 }; if (win) reposition(wasExpanded !== expanded); onLayout(); return size; }
  })) ipcMain.handle(channel, (event, value) => { if (!trusted(event)) return null; return handler(value); });
  function setEnabled(value) { const previous = enabled; enabled = value === true; try { persist(); } catch (error) { enabled = previous; throw error; } revision++; clearInterval(timer); timer = null; if (enabled) { ensureWindow(); timer = setInterval(() => { if (!suspended) void refresh(); }, 30 * 60 * 1000); timer.unref?.(); void refresh(); } else win?.hide(); publish(); reposition(); onLayout(); }
  return { start() { if (enabled) setEnabled(true); }, setEnabled, isEnabled: () => enabled, getState: () => state, getWindow: () => win, isExpanded: () => enabled && (cardVisible || explicitOpen) && size.width === 390, isCardVisible: () => cardVisible,
    setCardVisible(value) { const previous = cardVisible; cardVisible = value === true; try { persist(); } catch (error) { cardVisible = previous; throw error; } publish(); reposition(); onLayout(); },
    getBounds: () => win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null,
    getVisibleBounds: () => win && !win.isDestroyed() && (win.isVisible() || groupTransitionMode === 'stage') ? win.getBounds() : null,
    getLayoutMetrics: () => enabled && cardVisible ? { width: 128, height: 32, inset: 2 } : null,
    resetExpanded() { explicitOpen = false; cityRequested = false; size = { width: 128, height: 32 }; expandedAnchor = null; win?.webContents.send('weather:collapse'); },
    setGroupTransitionMode(mode) { if (![null,'hold','stage','masked'].includes(mode) || mode === groupTransitionMode) return; groupTransitionMode = mode; groupEpoch++; if (mode === 'stage' || mode === 'masked') win?.hide(); reposition(); },
    captureGroupTransitionFrames() { const target = win, epoch = groupEpoch; return captureQuotaGroupFrames({ getTargets: () => [target], isReady: () => ready && enabled && cardVisible && win === target && !target.isDestroyed(), isCurrent: () => epoch === groupEpoch && win === target && (groupTransitionMode !== 'stage' || !getPresentation()?.quotaGroupHidden) }); },
    setAlwaysOnTop(value) { topmost = Boolean(value); win?.setAlwaysOnTop(topmost, 'floating'); },
    openCity() { if (!enabled) setEnabled(true); explicitOpen = true; size = { width: 390, height: 210 }; const target = ensureWindow(); if (ready) { target.webContents.send('weather:choose-city'); target.show(); target.focus?.(); } else cityRequested = true; reposition(); onLayout(); },
    open() { if (!enabled) setEnabled(true); ensureWindow(); reposition(); publish(); }, reposition,
    pause() { suspended = true; revision++; win?.hide(); }, resume() { suspended = false; reposition(); if (enabled) void refresh(); },
    destroy() { revision++; clearInterval(timer); win?.destroy(); win = null; for (const name of ['get','refresh','search','city','location','resize']) ipcMain.removeHandler('weather:' + name); } };
}
module.exports = { createWeatherWindow, validCity };
