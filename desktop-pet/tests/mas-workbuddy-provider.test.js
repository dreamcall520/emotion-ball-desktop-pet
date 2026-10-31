'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMasWorkBuddyProvider } = require('../lib/mas-workbuddy-provider');
const summary = () => ({ scope: 'website-summary', credits: { total: 500, remaining: 450, used: 50, reserved: 2 },
  planNames: ['体验版'], updatedAt: 1000 });
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ readSummary, fetch, loadURL, constructError, externalError, onLoginComplete, userAgent = 'IsolatedWebsite/123' } = {}) {
  const windows = [], partitions = [], changes = [], external = [], quotaCalls = [], fetchCalls = [];
  const websiteSession = {
    getUserAgent: () => userAgent,
    setUserAgent: value => { userAgent = value; },
    fetch: fetch || (async (url, options) => {
      fetchCalls.push([url, options]);
      return new Response(JSON.stringify({ code: 0, data: { Packages: [{ CapacityUnit: 'credits', CycleTotalCapacity: '500', CycleRemainCapacity: '450', CycleFrozenCapacity: '2', SubscriptionPackageName: '体验版' }] } }));
    }),
    setPermissionRequestHandler(handler) { this.permissionRequest = handler; },
    setPermissionCheckHandler(handler) { this.permissionCheck = handler; }
  };
  class Window extends EventEmitter {
    constructor(options) {
      super(); if (constructError) throw constructError;
      this.options = options; this.destroyed = false; this.shown = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.popup = handler; };
      windows.push(this);
    }
    async loadURL(url, options) {
      this.url = url; this.loadOptions = options;
      if (loadURL) return loadURL(this, url, options);
      this.emit('ready-to-show');
    }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    close() { this.destroy(); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const options = {
    BrowserWindow: Window, session: { fromPartition(...args) { partitions.push(args); return websiteSession; } },
    shell: { async openExternal(url) { external.push(url); if (externalError) throw externalError; } },
    onChange: state => changes.push(state),onLoginComplete
  };
  if (readSummary) options.createQuota = options => {
    quotaCalls.push(options);
    return { readSummary };
  };
  return { provider: createMasWorkBuddyProvider(options), options, windows, partitions, websiteSession,
    changes, external, quotaCalls, fetchCalls, Window };
}
function navigation(win, name, url, ...rest) {
  let prevented = false;
  win.webContents.emit(name, { preventDefault() { prevented = true; } }, url, ...rest);
  return prevented;
}

test('创建专用持久Session，登录页和真实quota适配使用同一Session与UA', async () => {
  const h = harness();
  assert.deepEqual(h.partitions, [['persist:qiuqiu-mas-workbuddy-web', { cache: false }]]);
  assert.equal(h.provider.getState().status, 'needs-login');
  const page = await h.provider.openLogin();
  const win = h.windows[0];
  const login = new URL(win.url);
  assert.equal(login.origin, 'https://www.workbuddy.cn'); assert.equal(login.pathname, '/login/');
  assert.equal(login.searchParams.get('platform'), 'website'); assert.equal(login.searchParams.get('product'), 'workbuddy');
  assert.equal(login.searchParams.get('redirect_uri'), 'https://www.workbuddy.cn/profile/plans-usage');
  assert.equal(win.loadOptions.userAgent, h.websiteSession.getUserAgent());
  assert.equal(win.options.webPreferences.session, h.websiteSession);
  assert.equal(win.options.webPreferences.preload, undefined);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.webSecurity, true);
  assert.equal(win.options.webPreferences.devTools, false);
  assert.equal(page.status, 'needs-login', '页面打开不能冒充已登录');
  const result = await h.provider.readSummary();
  assert.equal(result.credits.remaining, 450);
  assert.equal(h.fetchCalls[0][1].headers['User-Agent'], win.loadOptions.userAgent);
  assert.equal(h.fetchCalls[0][1].credentials, 'include');
  assert.equal(h.provider.getState().capabilities.quota.available, true);
  h.provider.close();
});

test('不开自动登录/额度查询，只在用户调用时请求，持久Cookie不被清空', () => {
  const h = harness();
  assert.equal(h.windows.length, 0); assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.provider.getState().summary, null);
  let permission;
  h.websiteSession.permissionRequest(null, 'camera', value => { permission = value; });
  assert.equal(permission, false); assert.equal(h.websiteSession.permissionCheck(), false);
  h.provider.close(); assert.equal(h.fetchCalls.length, 0);
});

test('复用登录窗口；每次重新登录都清旧账户结果及进行中请求', async () => {
  const h = harness({ readSummary: async () => summary() });
  await h.provider.openLogin(); await h.provider.readSummary();
  assert.ok(h.provider.getState().summary);
  await h.provider.openLogin();
  assert.equal(h.windows.length, 1); assert.equal(h.provider.getState().summary, null);
  assert.equal(h.provider.getState().status, 'needs-login');
  assert.equal(h.windows[0].shown, true); h.provider.close();
});

test('合法官网和公开WeChat OAuth导航允许；非官网HTTPS交系统浏览器', async () => {
  const h = harness(); await h.provider.openLogin(); const win = h.windows[0];
  assert.equal(navigation(win, 'will-navigate', 'https://www.workbuddy.cn/login/?platform=website'), false);
  assert.equal(navigation(win, 'will-redirect', { url: 'https://open.weixin.qq.com/connect/oauth2/authorize?state=synthetic', isMainFrame: true }), false);
  assert.equal(navigation(win, 'will-navigate', 'https://example.com/help'), true);
  await flush(); assert.deepEqual(h.external, ['https://example.com/help']);
  assert.equal(h.provider.getState().status, 'needs-login'); h.provider.close();
});

test('不能用相似域名/非HTTPS/自定义协议或包含授权码token的外链带走登录上下文', async () => {
  const h = harness(); await h.provider.openLogin(); const win = h.windows[0];
  for (const url of ['http://www.workbuddy.cn/login', 'file:///tmp/fixture', 'javascript:alert(1)',
    'workbuddy://auth?token=SECRET', 'https://evil.workbuddy.cn.invalid/?code=SECRET',
    'https://example.com/callback?state=SECRET', 'https://example.com/#access_token=SECRET',
    'https://user:pass@www.workbuddy.cn/', 'https://www.workbuddy.cn:8443/']) {
    assert.equal(navigation(win, 'will-navigate', url), true);
  }
  await flush(); assert.deepEqual(h.external, []);
  const state = h.provider.getState(); assert.equal(state.errorCode, 'NAVIGATION_NOT_SUPPORTED');
  assert.ok(!JSON.stringify(state).includes('SECRET')); h.provider.close();
});

test('不错误拦截正常iframe验证码跳转；不允许挂webview', async () => {
  const h = harness(); await h.provider.openLogin(); const win = h.windows[0];
  assert.equal(navigation(win, 'will-redirect', { url: 'https://captcha.example.invalid/frame', isMainFrame: false }), false);
  assert.equal(navigation(win, 'will-redirect', 'https://captcha.example.invalid/frame', false, false), false);
  let prevented = false;
  win.webContents.emit('will-attach-webview', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); h.provider.close();
});

test('官方OAuth弹窗安全参数继承，外链弹窗拒绝后交shell；关闭清理所有自有窗', async () => {
  const h = harness(); await h.provider.openLogin(); const win = h.windows[0];
  const result = win.popup({ url: 'https://open.weixin.qq.com/connect/qrconnect?state=synthetic' });
  assert.equal(result.action, 'allow');
  assert.equal(result.overrideBrowserWindowOptions.webPreferences.session, h.websiteSession);
  assert.equal(result.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
  assert.deepEqual(win.popup({ url: 'https://example.com/docs' }), { action: 'deny' });
  await flush(); assert.deepEqual(h.external, ['https://example.com/docs']);
  const child = new h.Window(result.overrideBrowserWindowOptions);
  win.webContents.emit('did-create-window', child);
  assert.equal(navigation(child, 'will-navigate', 'https://example.com/help'), true);
  h.provider.close(); assert.equal(win.isDestroyed(), true); assert.equal(child.isDestroyed(), true);
  assert.equal(h.provider.getState().loginVisible, false);
});

test('成功summary白名单投影，不泄露注入adapter多余账号标识，状态不可外改', async () => {
  const h = harness({ readSummary: async () => ({ ...summary(), accountKey: 'SECRET', token: 'SECRET' }) });
  const result = await h.provider.readSummary();
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  result.credits.remaining = 0;
  const state = h.provider.getState(); assert.equal(state.summary.credits.remaining, 450);
  state.summary.credits.remaining = 0; assert.equal(h.provider.getState().summary.credits.remaining, 450);
  assert.deepEqual(state.capabilities.quota.coverage, { packages: 'credits-only', basicRewardPurchased: 'not-separated', cycleReset: 'not-queried', enterpriseLimit: 'not-verified' });
  assert.deepEqual(state.capabilities.chat, { available: false, reason: 'openapi-application-not-configured' });
  assert.deepEqual(state.capabilities.tasks, { available: false, reason: 'openapi-application-not-configured' });
  h.provider.close();
});

test('不接受旧桌面个人/企业report、不完整汇总或假used数量', async () => {
  for (const value of [{ scope: 'enterprise', total: 500 }, { scope: 'personal', total: 500 },
    { ...summary(), credits: { ...summary().credits, used: -1 } },
    { ...summary(), credits: { ...summary().credits, used: 10 } },
    { ...summary(), planNames: ['x'.repeat(201)] }]) {
    const h = harness({ readSummary: async () => value });
    await assert.rejects(h.provider.readSummary(), { code: 'INVALID_RESPONSE' });
    assert.equal(h.provider.getState().summary, null); h.provider.close();
  }
});

test('登录失效清旧账号结果，其他查询错误仅保留明确stale的旧summary', async () => {
  let errorCode;
  const h = harness({ readSummary: async () => { if (errorCode) throw Object.assign(new Error('SECRET'), { code: errorCode }); return summary(); } });
  await h.provider.readSummary(); errorCode = 'RATE_LIMITED';
  await assert.rejects(h.provider.readSummary(), { code: 'RATE_LIMITED' });
  assert.equal(h.provider.getState().stale, true); assert.ok(h.provider.getState().summary);
  assert.ok(!JSON.stringify(h.provider.getState()).includes('SECRET'));
  errorCode = 'LOGIN_REQUIRED'; await assert.rejects(h.provider.readSummary(), { code: 'LOGIN_REQUIRED' });
  assert.equal(h.provider.getState().status, 'needs-login'); assert.equal(h.provider.getState().summary, null);
  assert.equal(h.provider.getState().stale, false); h.provider.close();
});

test('后请求取代前请求，前请求晚返回不能覆盖新的额度', async () => {
  const requests = [];
  const h = harness({ readSummary: ({ signal }) => new Promise(resolve => requests.push({ signal, resolve })) });
  const first = h.provider.readSummary(), firstRejected = assert.rejects(first, { code: 'CANCELLED' });
  const second = h.provider.readSummary();
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ ...summary(), credits: { total: 500, remaining: 300, used: 200, reserved: 0 } });
  await second; requests[0].resolve(summary()); await firstRejected;
  assert.equal(h.provider.getState().summary.credits.remaining, 300); h.provider.close();
});

test('取消透传并明确失败；关闭中断本provider请求且不让迟到结果复活', async () => {
  let request;
  const h = harness({ readSummary: ({ signal }) => new Promise((resolve, reject) => {
    request = { signal, resolve }; signal.addEventListener('abort', () => reject(Object.assign(new Error('SECRET'), { code: 'CANCELLED' })), { once: true });
  }) });
  const controller = new AbortController(); const first = h.provider.readSummary({ signal: controller.signal });
  controller.abort(); await assert.rejects(first, { code: 'CANCELLED' });
  assert.equal(request.signal.aborted, true);
  const last = h.provider.readSummary(); h.provider.close();
  await assert.rejects(last, { code: 'CLOSED' });
  assert.equal(h.provider.getState().status, 'closed'); assert.equal(h.provider.getState().summary, null);
  await assert.rejects(h.provider.openLogin(), { code: 'CLOSED' });
  await assert.rejects(h.provider.readSummary(), { code: 'CLOSED' });
});

test('登录窗口失败/构造异常都给安全错误，不透传原始异常', async () => {
  for (const options of [{ loadURL: async () => { throw new Error('Cookie=SECRET'); } }, { constructError: new Error('SECRET') }]) {
    const h = harness(options);
    await assert.rejects(h.provider.openLogin(), error => error.code === 'LOGIN_FAILED' && !error.message.includes('SECRET'));
    assert.equal(h.provider.getState().status, 'needs-login'); h.provider.close();
  }
});

test('shell外链失败显式状态，不带原URL/异常；窗口关闭不算登出', async () => {
  const h = harness({ externalError: new Error('SECRET') }); await h.provider.openLogin();
  navigation(h.windows[0], 'will-navigate', 'https://example.com/help');
  await flush(); assert.equal(h.provider.getState().errorCode, 'EXTERNAL_LINK_FAILED');
  assert.ok(!JSON.stringify(h.provider.getState()).includes('SECRET'));
  h.windows[0].destroy(); assert.equal(h.provider.getState().loginVisible, false);
  assert.notEqual(h.provider.getState().status, 'closed'); h.provider.close();
});

test('官网顶层页面导航清旧结果并取消旧查询，iframe导航不会清卡片', async () => {
  let resolveLater, calls = 0;
  const h = harness({ readSummary: () => ++calls === 1 ? Promise.resolve(summary()) : new Promise(resolve => { resolveLater = resolve; }) });
  await h.provider.openLogin(); await h.provider.readSummary(); const win = h.windows[0];
  win.webContents.emit('did-navigate-in-page', {}, 'https://www.workbuddy.cn/login/', false);
  assert.ok(h.provider.getState().summary);
  const pending = h.provider.readSummary(), rejected = assert.rejects(pending, { code: 'CANCELLED' });
  win.webContents.emit('did-navigate', {}, { url: 'https://www.workbuddy.cn/login/', isMainFrame: true });
  assert.equal(h.provider.getState().summary, null); assert.equal(h.provider.getState().busy, false);
  resolveLater(summary()); await rejected;
  assert.equal(h.provider.getState().summary, null); h.provider.close();
});

test('旧登录窗口迟到失败不能覆盖新窗口状态', async () => {
  let rejectFirst, count = 0;
  const h = harness({ loadURL: async win => {
    if (++count === 1) return new Promise((_, reject) => { rejectFirst = reject; });
    win.emit('ready-to-show');
  } });
  const first = h.provider.openLogin(), rejected = assert.rejects(first, { code: 'CANCELLED' });
  h.windows[0].destroy(); await h.provider.openLogin();
  rejectFirst(new Error('SECRET')); await rejected;
  assert.equal(h.provider.getState().errorCode, null);
  assert.equal(h.provider.getState().loginVisible, true);
  assert.equal(h.windows[1].destroyed, false); h.provider.close();
});

test('登录失败仅保留ERR纯码或数值errno，不透传原始message/URL；重试清旧诊断', async () => {
  for (const [raw, expected] of [
    [{ code: 'ERR_NAME_NOT_RESOLVED', message: 'SECRET_URL' }, 'ERR_NAME_NOT_RESOLVED'],
    [{ errno: -105, message: 'Cookie=SECRET' }, -105],
    [{ code: 'ERR_CERT_AUTHORITY_INVALID', errno: -202, url: 'https://secret.invalid/?token=SECRET' }, 'ERR_CERT_AUTHORITY_INVALID'],
    [{ code: 'ERR_FAILED https://secret.invalid/', message: 'SECRET' }, null],
    [{ errno: 'SECRET', message: 'SECRET' }, null]
  ]) {
    let fail = true;
    const h = harness({ loadURL: async win => {
      if (fail) throw Object.assign(new Error(raw.message || 'SECRET'), raw);
      win.emit('ready-to-show');
    } });
    await assert.rejects(h.provider.openLogin(), { code: 'LOGIN_FAILED' });
    const state = h.provider.getState();
    assert.equal(state.loadErrorCode, expected); assert.match(state.errorMessage, /重试/);
    assert.ok(!JSON.stringify(state).includes('SECRET')); assert.ok(!JSON.stringify(state).includes('secret.invalid'));
    fail = false; await h.provider.openLogin();
    assert.equal(h.provider.getState().loadErrorCode, null); assert.equal(h.provider.getState().errorCode, null);
    h.provider.close();
  }
});

 test('中文App产品项在专用Session统一移除，登录窗口和fetch保留相同ASCII Chromium UA', async () => {
 const h = harness({userAgent:'Mozilla/5.0 (Macintosh) 球球商店候选/0.4.9 Chrome/142.0.0.0 Electron/39.0.0 Safari/537.36'});
 await h.provider.openLogin();await h.provider.readSummary();
 const ua=h.websiteSession.getUserAgent();assert.equal(ua,'Mozilla/5.0 (Macintosh) Chrome/142.0.0.0 Electron/39.0.0 Safari/537.36');
 assert.equal(h.windows[0].loadOptions.userAgent,ua);assert.equal(h.fetchCalls[0][1].headers['User-Agent'],ua);h.provider.close();
});

test('本人登录页完成后自动核验积分并回调，无需手动刷新',async()=>{
 let finished=0,reads=0;const h=harness({readSummary:async()=>{reads++;return summary();},onLoginComplete:()=>finished++});
 await h.provider.openLogin();h.windows[0].webContents.emit('did-finish-load');
 await new Promise(r=>setTimeout(r,1100));
 assert.equal(reads,1);assert.equal(finished,1);assert.equal(h.provider.getState().status,'connected');assert.equal(h.windows[0].destroyed,true);h.provider.close();
});
test('停用会失效官网汇总并关闭自有登录窗口，重连仍可复用原session',async()=>{const f=harness({readSummary:async()=>summary()});await f.provider.readSummary();assert.equal(f.provider.getState().status,'connected');await f.provider.openLogin();await f.provider.readSummary();f.provider.revoke();assert.equal(f.provider.getState().summary,null);assert.equal(f.provider.getState().loginVisible,false);assert.equal(f.windows.every(win=>win.destroyed),true);await f.provider.openLogin();await f.provider.readSummary();assert.equal(f.provider.getState().status,'connected');f.provider.close();});
