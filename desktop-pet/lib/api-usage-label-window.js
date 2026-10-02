const path = require('node:path');
const { quotaLabelBounds, quotaLabelSize } = require('./quota-label-placement');

const CHANNEL = 'pet:api-usage-label';
const TOGGLE_CHANNEL = 'pet:api-usage-label-toggle';
const OPEN_CHANNEL = 'pet:api-usage-label-open';
const QUOTA_EVENTS = ['move', 'resize', 'show', 'hide', 'closed'];

function validBounds(bounds) {
  return Boolean(bounds && ['x', 'y', 'width', 'height'].every(name => Number.isFinite(bounds[name])) &&
    bounds.width > 0 && bounds.height > 0);
}

function apiLabelBounds(pet, area, quota, bubble, expanded = false, presentation = null) {
  const hasQuota = validBounds(pet) && validBounds(quota);
  const anchor = hasQuota ? {
    x: Math.min(pet.x, quota.x), y: Math.min(pet.y, quota.y),
    width: Math.max(pet.x + pet.width, quota.x + quota.width) - Math.min(pet.x, quota.x),
    height: Math.max(pet.y + pet.height, quota.y + quota.height) - Math.min(pet.y, quota.y)
  } : pet;
  // The union is a native-window obstacle, not a painted pet silhouette.
  return quotaLabelBounds(anchor, area, bubble, 'compact', expanded, 2,
    hasQuota ? null : presentation);
}

function safeState(state) {
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{0,200}$/.test(value) &&
    !value.startsWith('sk-') ? value : '';
  const money = entries => Array.isArray(entries) && entries.every(entry => entry &&
    typeof entry.currency === 'string' && /^[A-Za-z]{3}$/.test(entry.currency) &&
    typeof entry.value === 'number' && Number.isFinite(entry.value))
    ? entries.map(entry => ({ currency: entry.currency.toUpperCase(), value: entry.value })) : null;
  try {
    const connected = state?.connected === true;
    let report = null;
    const source = connected && state.report;
    if (source && typeof source.month === 'string' && /^\d{4}-\d{2}$/.test(source.month) &&
        Number.isFinite(source.updatedAt) && source.updatedAt >= 0) {
      const month = money(source.costs?.month), today = money(source.costs?.today);
      const usage = source.usage;
      if (month && today && usage && ['inputTokens', 'outputTokens', 'requests'].every(name => integer(usage[name])) &&
          (usage.cachedInputTokens === null || integer(usage.cachedInputTokens) && usage.cachedInputTokens <= usage.inputTokens)) {
        report = { month: source.month, updatedAt: source.updatedAt, costs: { month, today },
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens, requests: usage.requests } };
      }
    }
    return { connected, busy: state?.busy === true,
      error: typeof state?.error === 'string' ? state.error.slice(0, 512) : null,
      config: { projectId: id(state?.config?.projectId), apiKeyId: id(state?.config?.apiKeyId) }, report };
  } catch (_) {
    return { connected: false, busy: false, error: null, config: { projectId: '', apiKeyId: '' }, report: null };
  }
}

function createApiUsageLabelWindow({ BrowserWindow, screen, getPetWindow, getQuotaWindow = () => null,
  getObstacleBounds = () => null, getAppearance = () => 'system', getPresentation = () => null,
  onOpenDetails = () => {}, alwaysOnTop = true, onError = () => {} }) {
  let win = null, ready = false, requestedVisible = false, current = null, expanded = false;
  let topmost = Boolean(alwaysOnTop), revision = 0, presenting = false, pending = false;
  let observedQuota = null, quotaListener = null;

  function reportError(error) { try { onError(error); } catch (_) {} }
  function live(target) {
    return Boolean(target && !target.isDestroyed() && target.webContents &&
      !target.webContents.isDestroyed?.());
  }
  function clearQuotaListeners() {
    if (observedQuota && quotaListener) for (const event of QUOTA_EVENTS) {
      observedQuota.removeListener(event, quotaListener);
    }
    observedQuota = null;
    quotaListener = null;
  }
  function safeDestroy(target) {
    try { if (target && !target.isDestroyed()) target.destroy(); } catch (error) { reportError(error); }
  }
  function destroy() {
    revision += 1;
    const previous = win;
    win = null;
    ready = false;
    requestedVisible = false;
    current = null;
    expanded = false;
    clearQuotaListeners();
    safeDestroy(previous);
  }
  function failed(error, target) {
    if (target && win !== target) return;
    destroy();
    reportError(error);
  }
  function conceal(target, token) {
    if (win !== target || revision !== token || !live(target)) return;
    target.setIgnoreMouseEvents(true, { forward: true });
    if (win === target && revision === token) target.hide();
  }
  function hide() {
    revision += 1;
    requestedVisible = false;
    expanded = false;
    clearQuotaListeners();
    const target = win;
    try { conceal(target, revision); } catch (error) { failed(error, target); }
  }
  function active(target, token) {
    return win === target && revision === token && requestedVisible && ready && current && live(target);
  }
  function watchQuota() {
    const target = getQuotaWindow();
    const next = target && !target.isDestroyed() ? target : null;
    if (next !== observedQuota) {
      clearQuotaListeners();
      if (next) {
        observedQuota = next;
        let queued = false;
        const listener = () => {
          if (queued) return;
          queued = true;
          // Native show/resize can notify before visibility or bounds settle.
          queueMicrotask(() => {
            queued = false;
            if (observedQuota === next && quotaListener === listener && requestedVisible) reposition();
          });
        };
        quotaListener = listener;
        for (const event of QUOTA_EVENTS) next.on(event, listener);
      }
    }
    return next && next.isVisible() ? next.getBounds() : null;
  }
  function present() {
    if (presenting) { pending = true; return; }
    presenting = true;
    let activeTarget = win;
    try {
      for (let pass = 0; pass < 8; pass += 1) {
        pending = false;
        const target = win, token = revision;
        activeTarget = target;
        if (!active(target, token)) return;
        const pet = getPetWindow();
        if (!active(target, token)) { if (pending) continue; return; }
        if (!pet || pet.isDestroyed() || !pet.isVisible()) { hide(); return; }
        const bounds = pet.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const quota = watchQuota();
        const obstacle = getObstacleBounds();
        const presentation = getPresentation();
        const appearanceValue = getAppearance();
        const appearance = ['light', 'dark'].includes(appearanceValue) ? appearanceValue : 'system';
        if (!active(target, token)) { if (pending) continue; return; }
        const payload = { ...current, expanded, appearance };
        const steps = [
          () => target.setBounds(apiLabelBounds(bounds, area, quota, obstacle, expanded, presentation), false),
          () => target.webContents.send(CHANNEL, payload),
          () => target.setIgnoreMouseEvents(false),
          () => target.showInactive()
        ];
        for (const step of steps) {
          if (!active(target, token)) break;
          step();
        }
        if (win === target && !requestedVisible) conceal(target, revision);
        if (!pending) return;
      }
      failed(new Error('API 费用标签定位持续重入'), win);
    } catch (error) { failed(error, activeTarget); }
    finally { presenting = false; }
  }
  function reposition() { revision += 1; present(); }
  function ensureWindow() {
    if (win && live(win)) return;
    if (win) {
      const previous = win;
      win = null;
      ready = false;
      clearQuotaListeners();
      safeDestroy(previous);
    }
    const token = revision;
    const size = quotaLabelSize('compact', expanded, 2);
    const target = new BrowserWindow({
      ...size, title: 'OpenAI API 费用', transparent: true, frame: false,
      resizable: false, focusable: false, skipTaskbar: true, show: false,
      fullscreenable: false, maximizable: false, minimizable: false,
      hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, '../api-usage-label-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
        backgroundThrottling: false }
    });
    if (revision !== token || win) { safeDestroy(target); return; }
    win = target;
    ready = false;
    try {
      target.setAlwaysOnTop(topmost, 'floating');
      target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      target.setHiddenInMissionControl(true);
      target.setIgnoreMouseEvents(true, { forward: true });
      if (win !== target || !live(target)) { safeDestroy(target); return; }
      target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const event of ['will-navigate', 'will-attach-webview']) {
        target.webContents.on(event, event => event.preventDefault());
      }
      target.webContents.on('ipc-message', (event, channel) => {
        const token = revision;
        if (![TOGGLE_CHANNEL, OPEN_CHANNEL].includes(channel) || win !== target || !ready ||
            !requestedVisible || !live(target) || !target.isVisible() ||
            event?.sender !== target.webContents ||
            target.webContents.mainFrame && event.senderFrame !== target.webContents.mainFrame) return;
        if (!active(target, token)) return;
        if (channel === OPEN_CHANNEL || !current?.report) {
          try { onOpenDetails(); } catch (error) { reportError(error); }
        } else { expanded = !expanded; reposition(); }
      });
      target.webContents.on('render-process-gone', (_event, details) =>
        failed(new Error(`API 费用标签渲染退出：${details?.reason || 'unknown'}`), target));
      target.on('closed', () => {
        if (win !== target) return;
        win = null;
        ready = false;
        requestedVisible = false;
        current = null;
        expanded = false;
        revision += 1;
        clearQuotaListeners();
      });
      const markReady = () => {
        if (win !== target || ready) return;
        if (!live(target)) { failed(new Error('API 费用标签窗口不可用'), target); return; }
        ready = true;
        present();
      };
      target.webContents.on('did-finish-load', markReady);
      Promise.resolve(target.loadFile(path.join(__dirname, '../api-usage-label.html')))
        .then(markReady).catch(error => failed(error, target));
    } catch (error) { failed(error, target); }
  }
  return {
    show(state) {
      revision += 1;
      current = safeState(state);
      if (!current.report) expanded = false;
      requestedVisible = true;
      try { ensureWindow(); present(); } catch (error) { failed(error, win); }
    },
    hide, reposition, destroy,
    getWindow() {
      if (win && !live(win)) { failed(new Error('API 费用标签窗口不可用'), win); }
      return win;
    },
    setAlwaysOnTop(value) {
      topmost = Boolean(value);
      const target = win;
      try { if (live(target)) target.setAlwaysOnTop(topmost, 'floating'); }
      catch (error) { failed(error, target); }
    }
  };
}

module.exports = { createApiUsageLabelWindow, apiLabelBounds };
