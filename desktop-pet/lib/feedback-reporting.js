const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');

const ENDPOINT = 'https://qiuqiu-feedback-entry.pages.dev/api/feedback';
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const MAX_IMAGE = 1024 * 1024, MAX_QUEUE = 20, COOLDOWN = 60 * 60 * 1000;
const SCOPES = new Set(['应用运行', '窗口崩溃', '窗口无响应', '页面加载失败', '页面脚本错误', '未处理异步错误', '主进程异常',
  '快捷面板', '全局设置', 'API 费用面板', '关于球球', '保存更新提醒', '定制面板加载', '定制面板', '保存我的形象',
  '导入 Codex 宠物', '保存球球定制', 'API 余额账户', 'API 余额卡', 'API 余额趋势', '保存 API 常驻显示', 'Codex 趋势记录',
  '打开 Codex 会话', '保存界面配色', '保存主题色', '保存便签待办默认页面', '保存界面外观', '开机启动回读不一致',
  '冒烟检查失败', '渲染进程退出', '无法打开桌宠页面', '安装包下载状态', '标记 Codex 结果已读', '读取 Codex 宠物',
  '调整球球尺寸', '校验 Codex 宠物', '番茄钟记录', '番茄钟窗口', '便签与待办', '聊天面板', 'WorkBuddy 积分查询',
  'WorkBuddy 趋势窗口', '咩咩送物窗口', '思考光迹窗口', '气泡窗口', '额度标签窗口', '守护战窗口', 'API 常驻卡片',
  'Codex 详情窗口', 'ZCode 授权窗口', 'ZCode 联动', '边缘提示窗口', '活动状态检测', '天气', '便签保存后退出', '应用启动失败']);
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError']);
const CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
  'EHOSTUNREACH', 'EPIPE', 'WINDOW_UNRESPONSIVE', 'RENDER_PROCESS_GONE', 'PAGE_LOAD_FAILED', 'RENDERER_ERROR', 'ERR_NETWORK', 'ERR_ABORTED', 'ERR_FAILED', 'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_TIMED_OUT', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID']);
const number = value => Number.isSafeInteger(value) && value >= 0;
const failure = message => new Error(message);
function field(value, label, maximum, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.includes('\0') || value.trim().length > maximum || required && !value.trim()) {
    throw failure(`${label}${required ? '不能为空，且' : ''}不能超过 ${maximum} 字。`);
  }
  return value.trim();
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function attachments(value = []) {
  if (!Array.isArray(value) || value.length > 3) throw failure('最多选择 3 张截图。');
  return value.map(item => {
    const name = field(item?.name, '截图文件名', 255, true);
    if (/[\\/]/.test(name)) throw failure('截图文件名不能包含路径。');
    if (typeof item.data !== 'string' || !item.data || item.data.length > Math.ceil(MAX_IMAGE / 3) * 4 ||
        item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw failure('截图编码或大小不正确，每张最多 1 MB。');
    const bytes = Buffer.from(item.data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString('base64') !== item.data || imageType(bytes) !== item.type) {
      throw failure('请选择有效的 PNG、JPG、GIF 或 WebP 图片，每张最多 1 MB。');
    }
    return { name, type: item.type, data: item.data };
  });
}
function fingerprint(entry) {
  return createHash('sha256').update(JSON.stringify([entry.scope, entry.name, entry.code, entry.version, entry.os])).digest('hex');
}
function automaticPayload(entry) {
  return { submissionId: entry.id, type: 'problem', title: `[自动异常] ${entry.scope}`, contact: '', version: entry.version,
    os: entry.os, source: 'app', attachments: [], detail: JSON.stringify({ kind: 'automatic-error', module: entry.scope,
      errorName: entry.name, errorCode: entry.code, fingerprint: fingerprint(entry), firstSeenAt: entry.firstAt,
      lastSeenAt: entry.lastAt, occurrences: entry.sentCount || entry.count }, null, 2) };
}

function createFeedbackReporting({ directory, version, fetch = globalThis.fetch, enabled = false, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout, onChange = () => {} } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Feedback directory required');
  const file = path.join(directory, 'feedback-outbox.json');
  const diagnostic = Object.freeze({ appVersion: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? version : 'unknown',
    platform: process.platform, systemRelease: os.release(), architecture: process.arch,
    electron: process.versions.electron || '', node: process.versions.node });
  const environment = { version: diagnostic.appVersion, os: `${diagnostic.platform} ${diagnostic.systemRelease} ${diagnostic.architecture}`, source: 'app' };
  let active = enabled === true, disposed = false, queue = [], recent = [], timer = null, flight = null, controller = null;
  let lastSentAt = null, lastError = '', epoch = 0;
  const getState = () => ({ enabled: active, pending: queue.length, lastSentAt, lastError });
  const notify = () => { try { onChange(getState()); } catch {} };
  const context = () => ({ ...environment, diagnostic: { ...diagnostic } });
  function stopTimer() { if (timer !== null) cancel(timer); timer = null; }
  function persist() {
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ schema: 1, queue, recent, lastSentAt }), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      return true;
    } catch { lastError = '异常暂存未完成，请检查本机存储空间或权限。'; notify(); return false; }
  }
  function load() {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw failure('invalid');
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.schema !== 1 || !Array.isArray(stored.queue) || stored.queue.length > MAX_QUEUE || !Array.isArray(stored.recent) || stored.recent.length > 100) throw failure('invalid');
      queue = stored.queue.map(entry => {
        if (!entry || !UUID.test(entry.id) || !SCOPES.has(entry.scope) || !NAMES.has(entry.name) || entry.code !== '' && !CODES.has(entry.code) ||
          !/^(?:\d+\.\d+\.\d+(?:[-+][\w.-]+)?|unknown)$/.test(entry.version) || typeof entry.os !== 'string' || !/^(?:darwin|win32|linux|freebsd|openbsd|aix|sunos|android) [\w.+-]{1,80} (?:arm64|x64|ia32|arm|riscv64|ppc64|s390x)$/.test(entry.os) ||
          !['firstAt', 'lastAt', 'count', 'sentCount', 'attempts', 'nextAttemptAt'].every(key => number(entry[key])) || entry.count < 1 || entry.count > 1000000 || entry.sentCount > entry.count || entry.attempts > 1000000) throw failure('invalid');
        return Object.fromEntries(['id', 'scope', 'name', 'code', 'version', 'os', 'firstAt', 'lastAt', 'count', 'sentCount', 'attempts', 'nextAttemptAt'].map(key => [key, entry[key]]));
      });
      recent = stored.recent.filter(item => item && /^[a-f0-9]{64}$/.test(item.key) && number(item.at) && item.at > now() - COOLDOWN && item.at <= now()).map(item => ({ key: item.key, at: item.at }));
      lastSentAt = number(stored.lastSentAt) ? stored.lastSentAt : null;
    } catch (error) {
      queue = []; recent = [];
      if (error.code !== 'ENOENT') lastError = '异常暂存无法读取，旧记录未自动发送。';
    }
  }
  async function post(payload, signal) {
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
      if (!response.ok) throw failure(response.status === 429 ? '提交较频繁，请稍后重试。' : '提交失败，内容已保留，请稍后重试。');
      const result = await response.json();
      if (typeof result?.id !== 'string' || result.id.toLowerCase() !== payload.submissionId.toLowerCase()) throw failure('未收到提交确认，内容已保留，请稍后重试。');
      return { id: result.id.toLowerCase() };
    } catch (error) {
      const allowed = ['提交较频繁，请稍后重试。', '提交失败，内容已保留，请稍后重试。', '未收到提交确认，内容已保留，请稍后重试。'];
      throw failure(allowed.includes(error?.message) ? error.message : '网络暂时不可用，内容已保留，请稍后重试。');
    }
  }
  async function submit(value) {
    if (disposed) throw failure('请重新打开意见反馈后再试。');
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.submissionId !== 'string' || !UUID.test(value.submissionId)) throw failure('提交编号不正确，请重新填写反馈。');
    if (!['problem', 'suggestion', 'feature'].includes(value.type)) throw failure('请选择反馈类型。');
    const include = value.includeDiagnostics === true;
    const detail = field(value.detail, '详细说明', include ? 4000 : 5000, true);
    const payload = { submissionId: value.submissionId.toLowerCase(), type: value.type, title: field(value.title, '标题', 100, true),
      detail: include ? `${detail}\n\n【使用环境】\n${JSON.stringify(diagnostic, null, 2)}` : detail,
      contact: field(value.contact, '联系方式', 200), version: include ? environment.version : '', os: include ? environment.os : '',
      source: 'app', attachments: attachments(value.attachments) };
    if (Buffer.byteLength(JSON.stringify(payload)) > 5 * 1024 * 1024) throw failure('提交内容过大，请减少截图后重试。');
    return post(payload, AbortSignal.timeout(30000));
  }
  function arm(delay) {
    stopTimer();
    if (!active || disposed || !queue.length || flight) return;
    timer = schedule(() => { timer = null; void flush(); }, Math.min(COOLDOWN, Math.max(0, delay)));
    timer?.unref?.();
  }
  function capture(scope, error) {
    if (!active || disposed) return false;
    const at = now(), item = { scope: SCOPES.has(scope) ? scope : '应用运行',
      name: NAMES.has(error?.name) ? error.name : 'Error', code: CODES.has(error?.code) ? error.code : '',
      version: environment.version, os: environment.os };
    const key = fingerprint(item);
    recent = recent.filter(entry => entry.at > at - COOLDOWN && entry.at <= at);
    const existing = queue.find(entry => fingerprint(entry) === key);
    if (existing) {
      // shortcut: Count the initial sample only; add separate counters if full incident totals are needed.
      if (!existing.attempts) { existing.count = Math.min(1000000, existing.count + 1); existing.lastAt = at; }
      if (persist()) arm(Math.min(...queue.map(item => item.nextAttemptAt)) - at);
      notify(); return true;
    }
    if (recent.some(entry => entry.key === key)) return false;
    if (queue.length >= MAX_QUEUE) { lastError = '待上报异常已达暂存上限，稍后将继续发送现有记录。'; notify(); return false; }
    queue.push({ ...item, id: randomUUID(), firstAt: at, lastAt: at, count: 1, sentCount: 0, attempts: 0, nextAttemptAt: at + 2000 });
    if (persist()) arm(2000);
    notify(); return true;
  }
  function flush() {
    if (!active || disposed) return Promise.resolve(getState());
    if (flight) return flight;
    stopTimer();
    const entry = queue.filter(item => item.nextAttemptAt <= now()).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
    if (!entry) { if (queue.length) arm(Math.min(...queue.map(item => item.nextAttemptAt)) - now()); return Promise.resolve(getState()); }
    // Freeze the submitted body across retries: the server binds each UUID to one exact payload.
    entry.sentCount ||= entry.count;
    entry.attempts++;
    if (!persist()) return Promise.resolve(getState());
    const requestEpoch = epoch, currentController = controller = new AbortController();
    const signal = AbortSignal.any([currentController.signal, AbortSignal.timeout(30000)]);
    flight = (async () => {
      try {
        await post(automaticPayload(entry), signal);
        if (!active || disposed || epoch !== requestEpoch) return;
        queue = queue.filter(item => item.id !== entry.id);
        recent.push({ key: fingerprint(entry), at: now() }); recent = recent.slice(-100);
        lastSentAt = now(); lastError = ''; persist();
      } catch (error) {
        if (!active || disposed || epoch !== requestEpoch) return;
        lastError = error.message;
        entry.nextAttemptAt = now() + Math.min(COOLDOWN, 60000 * 2 ** Math.min(entry.attempts - 1, 6));
        persist();
      } finally {
        if (epoch !== requestEpoch) return;
        if (controller === currentController) controller = null;
        flight = null;
        if (active && !disposed && queue.length) arm(Math.min(...queue.map(item => item.nextAttemptAt)) - now());
        notify();
      }
    })().then(() => getState());
    return flight;
  }
  function setEnabled(value) {
    if (disposed) return getState();
    const next = value === true;
    if (next === active) return getState();
    active = next;
    stopTimer();
    if (active) {
      queue = []; recent = []; lastError = '';
      if (!persist()) active = false;
    } else {
      epoch++; controller?.abort(); controller = null; flight = null; queue = []; recent = []; lastError = '';
      try { fs.rmSync(file, { force: true }); fs.rmSync(`${file}.tmp`, { force: true }); }
      catch { lastError = '旧异常暂存清理未完成，请检查本机存储权限。'; }
    }
    notify(); return getState();
  }
  function dispose() { disposed = true; epoch++; stopTimer(); controller?.abort(); controller = null; flight = null; }
  if (active) { load(); if (queue.length) arm(Math.min(...queue.map(item => item.nextAttemptAt)) - now()); }
  return { context, submit, capture, setEnabled, getState, flush, dispose };
}
module.exports = { createFeedbackReporting };
