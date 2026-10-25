const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createZcodeLink({ BrowserWindow, screen, ipcMain, getSettings, save, filePath,
  getPetWindow, getObstacles = () => [], getPresentation = () => null,
  getSuppressed = () => false, onChange = () => {}, onEnabledChanged = () => {},
  onLayout = () => {}, onError = () => {}, requestConsent = async () => true, cancelConsent = () => {},
  openTask = async () => false,
  createCompanion = require('./zcode-companion').createZcodeCompanion,
  createCard = require('./quota-label-window').createQuotaLabelWindow,
  createDetails = require('./codex-details-window').createCodexDetailsWindow,
  buildCard = require('./zcode-quota-view').buildZcodeQuotaLabelModel,
  buildDetails = require('./zcode-quota-view').buildZcodeDetailsModel }) {
  let closed = false, enabling = false, revision = 0, syncing = false;
  let enabled = getSettings().zcodeEnabled === true;
  let preferenceWarning = null;
  const handlers = [];
  const allowed = new Set(['quota', 'trend', 'tasks', 'results']);
  const report = error => { try { onError(error); } catch (_) {} };
  function obstacle() {
    const rows = getObstacles().filter(Boolean);
    if (!rows.length) return null;
    const x = Math.min(...rows.map(row => row.x)), y = Math.min(...rows.map(row => row.y));
    return { x, y, width: Math.max(...rows.map(row => row.x + row.width)) - x,
      height: Math.max(...rows.map(row => row.y + row.height)) - y };
  }
  const card = createCard({ BrowserWindow, screen, sourceId: 'zcode', getPetWindow,
    getObstacle: obstacle, getSize: () => getSettings().zcodeQuotaLabelSize,
    getAppearance: () => getSettings().codexQuotaAppearance,
    getPresentation, getSuppressed: () => getSuppressed() || details?.isVisible(),
    alwaysOnTop: getSettings().alwaysOnTop, onLayout, onError: report });
  const details = createDetails({ BrowserWindow, screen, sourceId: 'zcode',
    getAnchor: () => card.getVisibleBounds() || getPetWindow()?.getBounds?.(),
    alwaysOnTop: getSettings().alwaysOnTop, onError: report,
    onVisibilityChange: () => { card.reposition(); onLayout(); } });
  const service = createCompanion({ filePath, onChange: () => { sync(); onChange(); } });
  function model(action, bucketId) {
    const prefs = getSettings();
    return buildDetails(service.getSnapshot(), { action, bucketId,
      appearance: prefs.codexQuotaAppearance, colorMode: prefs.colorMode });
  }
  function sync() {
    if (closed || syncing) return;
    syncing = true;
    try {
      const prefs = getSettings(), pet = getPetWindow();
      const visible = enabled && prefs.zcodeQuotaAlwaysVisible && !getSuppressed()
        && pet && !pet.isDestroyed() && pet.isVisible();
      if (visible) card.show(buildCard(service.getSnapshot(), { size: prefs.zcodeQuotaLabelSize }));
      else card.hide();
      if (details.isVisible()) {
        if (!enabled || getSuppressed()) details.close();
        else details.update(model(details.getAction(), details.getPeriod()));
      }
    } catch (error) { report(error); }
    finally { syncing = false; }
  }
  async function setEnabled(value) {
    if (closed || (value === true && (enabled || enabling))) return false;
    const token = ++revision;
    if (value !== true) {
      enabled = false; cancelConsent();
      try { save({ zcodeEnabled: false }); preferenceWarning = null; }
      catch (error) { preferenceWarning = '联动已关闭，但未保存；重启可能恢复开启'; report(error); }
      card.destroy(); details.close();
      await service.setEnabled(false);
      await onEnabledChanged(false);
      onChange(); return true;
    }
    enabling = true;
    try {
      if (!await requestConsent() || closed || revision !== token) return false;
      save({ zcodeEnabled: true });
      preferenceWarning = null;
      enabled = true;
      await service.setEnabled(true);
      if (closed || revision !== token) return false;
      await onEnabledChanged(true);
      sync(); onChange(); return true;
    } catch (error) { report(error); return false; }
    finally { enabling = false; }
  }
  function setPreference(key, value) {
    if (closed || !enabled || !['zcodeQuotaAlwaysVisible', 'zcodeQuotaLabelSize'].includes(key)) return false;
    const next = key === 'zcodeQuotaLabelSize' ? ['compact', 'standard'].includes(value) ? value : null : typeof value === 'boolean' ? value : null;
    if (next === null) return false;
    try { save({ [key]: next }); sync(); onChange(); return true; }
    catch (error) { report(error); return false; }
  }
  function openDetails(action, bucketId) {
    if (closed || !enabled || getSuppressed() || !allowed.has(action)) return false;
    return details.open(model(action, typeof bucketId === 'string' ? bucketId : null));
  }
  function ownsCard(event) {
    const win = card.getWindow();
    return Boolean(win && event?.sender === win.webContents && event.senderFrame === event.sender.mainFrame
      && event.sender.getURL() === pathToFileURL(path.join(__dirname, '../quota-label.html')).href);
  }
  function listen(channel, fn, invoke = false) {
    if (invoke) ipcMain.handle(channel, fn); else ipcMain.on(channel, fn);
    handlers.push([channel, fn, invoke]);
  }
  listen('pet:zcode-quota-label-detail', (event, action, bucketId) => { if (ownsCard(event)) openDetails(action, bucketId); });
  listen('pet:zcode-details-open', (event, action, bucketId) => { if (details.owns(event)) openDetails(action, bucketId); });
  listen('pet:zcode-details-close', event => { if (details.owns(event)) details.close(); });
  listen('pet:zcode-details-resize', (event, height) => { if (details.owns(event)) details.resize(height); });
  listen('pet:zcode-details-read-all', (event, generation) => {
    if (!details.owns(event) || !details.isVisible() || details.getAction() !== 'results' || getSuppressed() || generation !== service.getSnapshot().generation) return false;
    return service.markAllRead();
  }, true);
  listen('pet:zcode-details-thread', async (event, id) => {
    if (!details.owns(event) || !details.isVisible() || getSuppressed() || !['tasks', 'results'].includes(details.getAction())) return;
    const snapshot = service.getSnapshot();
    const rows = details.getAction() === 'results' ? snapshot.history?.results : snapshot.tasks?.items;
    if (!Array.isArray(rows) || !rows.some(row => row.id === id)) return;
    try { await openTask(id); } catch (error) { report(error); }
  });
  function menu() {
    const prefs = getSettings();
    return { id: 'zcode-menu', label: 'ZCode 联动', submenu: [
      { id: 'zcode-enabled', label: '启用 ZCode 联动', type: 'checkbox', checked: enabled,
        click: item => { const value = item.checked; item.checked = enabled; void setEnabled(value); } },
      ...(preferenceWarning ? [{ id: 'zcode-preference-warning', label: preferenceWarning, enabled: false }] : []),
      { type: 'separator' },
      { id: 'zcode-quota-visible', label: '显示 ZCode 额度', type: 'checkbox', enabled,
        checked: prefs.zcodeQuotaAlwaysVisible === true,
        click: item => { const value = item.checked; item.checked = prefs.zcodeQuotaAlwaysVisible; setPreference('zcodeQuotaAlwaysVisible', value); } },
      { id: 'zcode-quota-size', label: '额度卡片大小', enabled,
        submenu: [['standard', '标准'], ['compact', '小巧']].map(([value, label]) => ({
          id: `zcode-size-${value}`, label, type: 'radio', checked: prefs.zcodeQuotaLabelSize === value,
          click: () => setPreference('zcodeQuotaLabelSize', value) })) },
      { id: 'zcode-quota-detail', label: '额度明细', enabled, click: () => openDetails('quota') },
      { id: 'zcode-trend', label: '额度趋势', enabled, click: () => openDetails('trend') },
      { id: 'zcode-tasks', label: '进行中任务', enabled, click: () => openDetails('tasks') },
      { id: 'zcode-refresh', label: '刷新 ZCode 状态', enabled, click: () => { void service.refresh(); } }
    ] };
  }
  return { menu, sync, setEnabled, setPreference, openDetails, getSnapshot: service.getSnapshot,
    start: () => enabled ? service.setEnabled(true) : undefined,
    isEnabled: () => enabled && !closed,
    getWindow: card.getWindow, getVisibleBounds: card.getVisibleBounds,
    reposition() { card.reposition(); sync(); },
    hide() { card.hide(); details.close(); },
    setAlwaysOnTop(value) { card.setAlwaysOnTop(value); details.setAlwaysOnTop(value); },
    close() {
      if (closed) return;
      closed = true; enabled = false; revision++; cancelConsent(); service.close(); card.destroy(); details.destroy();
      for (const [channel, fn, invoke] of handlers) {
        if (invoke) ipcMain.removeHandler?.(channel); else ipcMain.removeListener(channel, fn);
      }
    } };
}

module.exports = { createZcodeLink };
