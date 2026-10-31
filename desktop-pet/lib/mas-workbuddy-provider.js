'use strict';

const { createWorkBuddyWebQuota } = require('./workbuddy-web-quota');
const PARTITION = 'persist:qiuqiu-mas-workbuddy-web';
const LOGIN_PAGE = 'https://www.workbuddy.cn/login/?platform=website&state=2&redirect_uri=https%3A%2F%2Fwww.workbuddy.cn%2Fprofile%2Fplans-usage&product=workbuddy';
// Verified from WorkBuddy's public /login page, not guessed Tencent-wide domains.
const LOGIN_HOSTS = new Set(['www.workbuddy.cn', 'workbuddy.cn', 'open.weixin.qq.com']);
const ERROR_MESSAGES = Object.freeze({
  CLOSED: 'WorkBuddy 连接已关闭。',
  LOGIN_REQUIRED: '请在球球的 WorkBuddy 官网窗口登录，然后刷新额度。',
  LOGIN_FAILED: 'WorkBuddy 登录页面暂时无法打开，请重试。',
  NAVIGATION_NOT_SUPPORTED: '该外部登录跳转尚未支持，请保留当前窗口并反馈。',
  EXTERNAL_LINK_FAILED: '外部网页暂时无法打开。',
  RATE_LIMITED: 'WorkBuddy 查询过于频繁，请稍后重试。',
  REDIRECT_REJECTED: 'WorkBuddy 查询发生意外跳转，本次未更新。',
  TIMEOUT: 'WorkBuddy 查询超时，本次未更新。',
  CANCELLED: '已取消 WorkBuddy 查询。',
  RESPONSE_TOO_LARGE: 'WorkBuddy 返回内容过大，本次未更新。',
  INVALID_RESPONSE: 'WorkBuddy 返回格式异常，本次未更新。',
  API_ERROR: 'WorkBuddy 未能提供额度，本次未更新。',
  NO_CREDIT_DATA: 'WorkBuddy 未提供可识别的积分汇总。',
  SERVICE_UNAVAILABLE: 'WorkBuddy 服务暂不可用。',
  CONNECTION_FAILED: '无法连接 WorkBuddy，请稍后重试。',
  SESSION_UNAVAILABLE: 'WorkBuddy 网页会话暂不可用。'
});
function providerError(code) {
  const safe = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'CONNECTION_FAILED';
  return Object.assign(new Error(ERROR_MESSAGES[safe]), { code: safe });
}
function safeLoadErrorCode(error) {
  if (typeof error?.code === 'string' && /^ERR_[A-Z0-9_]+$/.test(error.code)) return error.code;
  return Number.isSafeInteger(error?.errno) ? error.errno : null;
}
function parsedURL(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
    return url;
  } catch (_) { return null; }
}
function allowedLogin(raw) {
  const url = parsedURL(raw);
  return Boolean(url && LOGIN_HOSTS.has(url.hostname));
}
function sensitiveExternalURL(url) {
  return [...url.searchParams.keys()].some(key => /^(?:code|state|access_token|id_token|refresh_token|token|authorization|client_secret)$/i.test(key)) ||
    /(?:access_token|id_token|refresh_token|client_secret)=/i.test(url.hash);
}

// Candidate provider, intentionally not wired to main.js. The app's own persistent
// website Session owns cookies; no Chrome import, desktop auth/keychain read,
// secret handling, automatic OAuth application registration or model request.
function createMasWorkBuddyProvider({ BrowserWindow, session, shell, onChange = () => {},
  createQuota = createWorkBuddyWebQuota, quotaOptions = {}, onLoginComplete = () => {} } = {}) {
  if (typeof BrowserWindow !== 'function' || typeof session?.fromPartition !== 'function' ||
      typeof shell?.openExternal !== 'function' || typeof createQuota !== 'function') {
    throw new TypeError('BrowserWindow, session.fromPartition and shell.openExternal are required');
  }
  const websiteSession = session.fromPartition(PARTITION, { cache: false });
  if (!websiteSession || typeof websiteSession.getUserAgent !== 'function' || typeof websiteSession.fetch !== 'function') {
    throw new TypeError('A website Session with fetch/getUserAgent is required');
  }
  // Electron includes the application name in its default UA. Chinese product
  // names cannot be represented by fetch Headers' ByteString conversion. Remove
  // only non-ASCII product tokens, keeping Chromium/Electron versions untouched.
  const originalUA = websiteSession.getUserAgent();
  if (typeof originalUA !== 'string' || /[\r\n]/.test(originalUA)) throw new TypeError('Invalid website Session user agent');
  if (/[^\x20-\x7e]/.test(originalUA)) {
    const asciiUA = originalUA.split(/\s+/).filter(token => /^[\x21-\x7e]+$/.test(token)).join(' ');
    if (!asciiUA || typeof websiteSession.setUserAgent !== 'function') throw new TypeError('Website Session requires an ASCII user agent');
    websiteSession.setUserAgent(asciiUA);
  }
  // No provider page needs a native device permission to display its login QR code.
  websiteSession.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  websiteSession.setPermissionCheckHandler?.(() => false);
  const quota = createQuota({ ...quotaOptions, session: websiteSession });
  if (typeof quota?.readSummary !== 'function') throw new TypeError('A quota reader is required');
  const windows = new Set();
  let loginWindow = null, closed = false, generation = 0, flight = null, loginCheckTimer=null;
  let state = { status: 'needs-login', busy: false, loginVisible: false, summary: null, stale: false,
    errorCode: null, errorMessage: null, loadErrorCode: null };
  function getState() {
    return structuredClone({ ...state, capabilities: {
      quota: { implemented: true, available: state.status === 'connected', scope: 'website-summary',
        coverage: { packages: 'credits-only', basicRewardPurchased: 'not-separated',
          cycleReset: 'not-queried', enterpriseLimit: 'not-verified' } },
      chat: { available: false, reason: 'openapi-application-not-configured' },
      tasks: { available: false, reason: 'openapi-application-not-configured' }
    } });
  }
  function notify() { try { onChange(getState()); } catch (_) { /* UI failure cannot alter the website session. */ } }
  function update(patch) { state = { ...state, ...patch }; notify(); }
  function failNavigation(code) {
    if (closed) return;
    update({ errorCode: code, errorMessage: ERROR_MESSAGES[code] });
  }
  function showExternal(raw) {
    const url = parsedURL(raw);
    if (!url || sensitiveExternalURL(url)) { failNavigation('NAVIGATION_NOT_SUPPORTED'); return; }
    // Never load non-login sites into the cookie-bearing login window.
    Promise.resolve().then(() => shell.openExternal(url.href)).catch(() => failNavigation('EXTERNAL_LINK_FAILED'));
  }
  function webPreferences() {
    return { session: websiteSession, contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, webviewTag: false, spellcheck: false, devTools: false };
  }
  function secureWindow(win) {
    windows.add(win);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (closed) return { action: 'deny' };
      if (allowedLogin(url)) return { action: 'allow', overrideBrowserWindowOptions: {
        width: 900, height: 740, title: 'WorkBuddy 官网授权 · 球球', webPreferences: webPreferences()
      } };
      showExternal(url);
      return { action: 'deny' };
    });
    const guard = (event, details, _isInPlace, isMainFrame) => {
      // will-redirect can describe a captcha/other iframe. Those stay in the normal
      // isolated browser sandbox; do not break legitimate embedded OAuth resources.
      if (isMainFrame === false || details?.isMainFrame === false) return;
      const url = typeof details === 'string' ? details : details?.url;
      if (allowedLogin(url) && !closed) return;
      event.preventDefault();
      if (!closed) showExternal(url);
    };
    const navigated = (_event, details, isMainFrame) => {
      if (closed || isMainFrame === false || details?.isMainFrame === false) return;
      const url = typeof details === 'string' ? details : details?.url;
      if (allowedLogin(url)) invalidateForLogin();
    };
    // A provider-side navigation can be account switching. No previous account's
    // summary survives it; the page finishing still does not prove login.
    win.webContents.on('did-finish-load',()=>{
      clearTimeout(loginCheckTimer);
      if(closed||win!==loginWindow)return;
      loginCheckTimer=setTimeout(()=>{
        if(closed||win!==loginWindow||win.isDestroyed())return;
        void readSummary().then(()=>{if(!closed&&win===loginWindow){onLoginComplete();win.close();}}).catch(()=>{});
      },1000);loginCheckTimer.unref?.();
    });
    win.webContents.on('did-navigate', navigated);
    win.webContents.on('did-navigate-in-page', navigated);
    win.webContents.on('will-navigate', guard);
    win.webContents.on('will-redirect', guard);
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('did-create-window', child => { if (closed) child.destroy(); else secureWindow(child); });
    win.on('closed', () => {
      windows.delete(win);
      if (loginWindow === win) loginWindow = null;
      if (!closed) update({ loginVisible: windows.size > 0 });
    });
  }
  function invalidateForLogin() {
    generation++;
    flight?.controller.abort(); flight = null;
    update({ status: 'needs-login', busy: false, summary: null, stale: false,
      errorCode: null, errorMessage: null, loadErrorCode: null });
  }
  async function openLogin() {
    if (closed) throw providerError('CLOSED');
    // A user may switch accounts here. Never retain a previously queried card.
    invalidateForLogin();
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.show(); loginWindow.focus(); update({ loginVisible: true }); return getState();
    }
    let win;
    try {
      win = new BrowserWindow({ width: 1040, height: 800, minWidth: 700, minHeight: 560,
        title: 'WorkBuddy 官网登录 · 球球商店候选', autoHideMenuBar: true, show: false, webPreferences: webPreferences() });
      loginWindow = win;
      secureWindow(win);
      win.once('ready-to-show', () => {
        if (!closed && !win.isDestroyed()) { win.show(); win.focus(); update({ loginVisible: true }); }
      });
      // loadURL's UA and subsequent session.fetch's UA come from the same Session.
      await win.loadURL(LOGIN_PAGE, { userAgent: websiteSession.getUserAgent() });
      if (closed) throw providerError('CLOSED');
      if (win.isDestroyed() || loginWindow !== win) throw providerError('CANCELLED');
      return getState(); // A loaded page is not evidence that login succeeded.
    } catch (error) {
      if (closed) throw providerError('CLOSED');
      if (win && loginWindow !== win) throw providerError('CANCELLED');
      if (win && !win.isDestroyed()) win.destroy();
      update({ status: 'needs-login', errorCode: 'LOGIN_FAILED', errorMessage: ERROR_MESSAGES.LOGIN_FAILED,
        loadErrorCode: safeLoadErrorCode(error) });
      throw providerError('LOGIN_FAILED');
    }
  }
  async function readSummary({ signal } = {}) {
    if (closed) throw providerError('CLOSED');
    if (signal?.aborted) throw providerError('CANCELLED');
    const previous = flight;
    const controller = new AbortController(), id = ++generation;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    flight = { controller, id };
    previous?.controller.abort();
    update({ status: 'checking', busy: true, errorCode: null, errorMessage: null });
    try {
      const summary = await quota.readSummary({ signal: controller.signal });
      if (closed || id !== generation || controller.signal.aborted) throw providerError(closed ? 'CLOSED' : 'CANCELLED');
      // Validate the adapter boundary too, so a future implementation cannot
      // silently send the old desktop personal/enterprise report into this state.
      if (summary?.scope !== 'website-summary' || !summary.credits ||
          !['total', 'remaining', 'used', 'reserved'].every(key => Number.isFinite(summary.credits[key]) && summary.credits[key] >= 0)) {
        throw providerError('INVALID_RESPONSE');
      }
      if (!Array.isArray(summary.planNames) || summary.planNames.some(name => typeof name !== 'string' || name.length > 200) ||
          !Number.isFinite(summary.updatedAt) || summary.updatedAt < 0 ||
          summary.credits.used !== Math.max(0, summary.credits.total - summary.credits.remaining)) {
        throw providerError('INVALID_RESPONSE');
      }
      const safe = { scope: 'website-summary', credits: {
        total: summary.credits.total, remaining: summary.credits.remaining,
        used: summary.credits.used, reserved: summary.credits.reserved
      }, planNames: [...summary.planNames], updatedAt: summary.updatedAt,
      coverage: getState().capabilities.quota.coverage };
      update({ status: 'connected', busy: false, summary: safe, stale: false, errorCode: null, errorMessage: null, loadErrorCode: null });
      return structuredClone(safe);
    } catch (error) {
      const code = closed ? 'CLOSED' : controller.signal.aborted ? 'CANCELLED' :
        Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'CONNECTION_FAILED';
      if (!closed && id === generation) {
        const clear = code === 'LOGIN_REQUIRED';
        update({ status: clear ? 'needs-login' : 'error', busy: false,
          summary: clear ? null : state.summary, stale: !clear && Boolean(state.summary),
          errorCode: code, errorMessage: ERROR_MESSAGES[code] });
      }
      throw providerError(code);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (flight?.id === id) flight = null;
    }
  }
  function close() {
    if (closed) return;
    closed = true; generation++; clearTimeout(loginCheckTimer);
    flight?.controller.abort(); flight = null;
    for (const win of [...windows]) { try { if (!win.isDestroyed()) win.destroy(); } catch (_) {} }
    windows.clear(); loginWindow = null;
    state = { ...state, status: 'closed', busy: false, loginVisible: false, summary: null, stale: false };
    notify();
    // close never clears persistent cookies or logs the user out without asking.
  }
  return { getState, openLogin, readSummary, close };
}
module.exports = { createMasWorkBuddyProvider };
