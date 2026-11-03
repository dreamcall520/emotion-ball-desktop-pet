const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError']);
const CODES = new Set(`ENOENT EACCES EPERM ENOSPC EIO ECONNREFUSED ECONNRESET ETIMEDOUT ENOTFOUND EHOSTUNREACH EPIPE EAI_AGAIN ENETUNREACH EBADF EBUSY EEXIST EMFILE ENFILE EISDIR ENOTDIR EROFS
UND_ERR_CONNECT_TIMEOUT UND_ERR_HEADERS_TIMEOUT UND_ERR_BODY_TIMEOUT UND_ERR_SOCKET ERR_INVALID_URL ERR_INVALID_ARG_TYPE ERR_INVALID_ARG_VALUE
WINDOW_UNRESPONSIVE RENDER_PROCESS_GONE PAGE_LOAD_FAILED RENDERER_ERROR RENDERER_CONSOLE_ERROR PRELOAD_ERROR
ERR_NETWORK ERR_ABORTED ERR_FAILED ERR_INTERNET_DISCONNECTED ERR_NAME_NOT_RESOLVED ERR_CONNECTION_REFUSED ERR_CONNECTION_RESET ERR_TIMED_OUT ERR_CERT_DATE_INVALID ERR_CERT_AUTHORITY_INVALID
LOGIN_REQUIRED ACCOUNT_CHANGED UNSUPPORTED_PLATFORM UNSUPPORTED_AUTH UNSUPPORTED_ACCOUNT UNSUPPORTED_QUOTA RATE_LIMITED TIMEOUT CONNECTION_FAILED SERVICE_UNAVAILABLE INVALID_RESPONSE ACCOUNT_RESTRICTED UPDATE_FAILED
INVALID_LOCATION DATA_OLD LOCATION_UNSUPPORTED LOCATION_NATIVE_UNAVAILABLE LOCATION_DENIED LOCATION_RESTRICTED LOCATION_SERVICES_DISABLED LOCATION_TIMEOUT LOCATION_BUSY LOCATION_MAIN_THREAD_REQUIRED LOCATION_UNAVAILABLE LOCATION_NO_FIX
INVALID_INSTALLER DOWNLOAD_BUSY START_PENDING WINDOW_CLOSED START_TIMEOUT START_FAILED SAVE_DIALOG_FAILED TRANSFER_INTERRUPTED RESUME_FAILED DOWNLOAD_FAILED CANCELLED DOWNLOAD_COMPLETED
DOWNLOAD_REVEAL_FAILED DOWNLOAD_UNEXPECTED BROWSER_OPEN_FAILED SELECTION_SAVE_FAILED BALANCE_WINDOW_FAILED BALANCE_DETAILS_WINDOW_FAILED CONSENT_UNAVAILABLE ZCODE_UNAVAILABLE ACTION_TIMEOUT LOGIN_SETTING_MISMATCH
ZCODE_ACCOUNT_MISSING ZCODE_CREDENTIAL_DECRYPT_FAILED ZCODE_PROVIDER_UNSUPPORTED ZCODE_LOGIN_REQUIRED ZCODE_NETWORK_ERROR ZCODE_HTTP_ERROR ZCODE_BILLING_ERROR ZCODE_USAGE_UNAVAILABLE ZCODE_INVALID_RESPONSE ZCODE_INVALID_ACCOUNT_FILE ZCODE_TEAM_SELECTION_REQUIRED ZCODE_TEAM_KEY_MISSING ZCODE_TEAM_ACCESS_DENIED
UNKNOWN_ERROR_CODE UNCLASSIFIED_ERROR`.split(/\s+/));
const STAGES = new Set(['quota-query', 'quota-auth', 'quota-request', 'quota-parse', 'weather-storage', 'weather-animation', 'weather-window', 'weather-refresh', 'weather-location', 'weather-search', 'window-load', 'renderer-console', 'renderer-exception', 'main-process', 'operation', 'download']);
const REASONS = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure']);
// Only shipped code names are eligible, never arbitrary user paths or imported assets.
const PAGES = new Set(fs.readdirSync(ROOT).filter(name => /\.(?:html|js)$/.test(name)));
const SOURCES = new Set([...PAGES].filter(name => name.endsWith('.js')));
for (const name of fs.readdirSync(path.join(ROOT, 'lib'))) if (name.endsWith('.js')) SOURCES.add(`lib/${name}`);
const position = value => Number.isSafeInteger(value) && value > 0 && value <= 10000000;
const own = (value, key) => {
  try { const descriptor = value && Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
};

function sourceLocation(errorOrSource, root = ROOT) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return {};
  const rawStack = own(errorOrSource, 'stack');
  const candidates = typeof errorOrSource === 'string' ? [errorOrSource] : typeof rawStack === 'string'
    ? rawStack.split('\n').slice(1, 30).filter(line => /^\s*at\s/.test(line)).map(line => line.trim().replace(/^at\s+(?:.*?\()?/, '').replace(/\)$/, '')) : [];
  for (const candidate of candidates) {
    const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(candidate);
    let filename = match?.[1];
    if (!filename || /[?#\0\r\n]/.test(filename)) continue;
    try { if (filename.startsWith('file://')) filename = fileURLToPath(filename); } catch { continue; }
    if (!path.isAbsolute(filename)) continue;
    const relative = path.relative(path.resolve(root), filename).split(path.sep).join('/');
    if (!SOURCES.has(relative) || relative.startsWith('../')) continue;
    const result = { source: relative };
    if (position(Number(match[2]))) result.line = Number(match[2]);
    if (position(Number(match[3]))) result.column = Number(match[3]);
    return result;
  }
  return {};
}

function normalizeDiagnostic(_scope, error, context = {}) {
  const rawName = own(error, 'name');
  // Built-in Error names live on the prototype; do not invoke arbitrary getters.
  let name = NAMES.has(rawName) ? rawName : 'Error';
  if (error instanceof Error && rawName === undefined) {
    for (const Type of [TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError]) if (error instanceof Type) { name = Type.name; break; }
  }
  let code = 'UNCLASSIFIED_ERROR', current = error;
  const seen = new Set();
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current);
    const value = own(current, 'code');
    if (CODES.has(value)) { code = value; break; }
    if (value !== undefined && value !== null && value !== '') code = 'UNKNOWN_ERROR_CODE';
    current = own(current, 'cause');
  }
  const safe = {};
  const stage = own(context, 'stage'), page = own(context, 'page'), source = own(context, 'source');
  if (STAGES.has(stage)) safe.stage = stage;
  if (PAGES.has(page)) safe.page = page;
  if (SOURCES.has(source)) safe.source = source;
  for (const key of ['line', 'column']) if (safe.source && position(own(context, key))) safe[key] = own(context, key);
  const reason = own(context, 'reason'), status = own(context, 'httpStatus'), retryable = own(context, 'retryable'), delay = own(context, 'retryDelayMs');
  const severity = own(context, 'severity'), expected = own(context, 'expected'), failures = own(context, 'failureCount'), retryAfter = own(context, 'retryAfterSeconds');
  if (['info', 'warning', 'error', 'fatal'].includes(severity)) safe.severity = severity;
  if (typeof expected === 'boolean') safe.expected = expected;
  if (Number.isSafeInteger(failures) && failures >= 1 && failures <= 1000000) safe.failureCount = failures;
  if (Number.isSafeInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 86400) safe.retryAfterSeconds = retryAfter;
  const processKind = own(context, 'process'), netCode = own(context, 'netErrorCode'), downloadStage = own(context, 'downloadStage'), attempt = own(context, 'attempt');
  if (['main', 'renderer', 'preload'].includes(processKind)) safe.process = processKind;
  if (Number.isSafeInteger(netCode) && netCode >= -1000 && netCode <= -1) safe.netErrorCode = netCode;
  if (['prepare', 'start', 'save', 'transfer', 'cancel'].includes(downloadStage)) safe.downloadStage = downloadStage;
  if (Number.isSafeInteger(attempt) && attempt >= 0 && attempt <= 100) safe.attempt = attempt;
  if (REASONS.has(reason)) safe.reason = reason;
  if (Number.isSafeInteger(status) && status >= 100 && status <= 599) safe.httpStatus = status;
  if (typeof retryable === 'boolean') safe.retryable = retryable;
  if (Number.isSafeInteger(delay) && delay >= 0 && delay <= 86400000) safe.retryDelayMs = delay;
  const authorization = own(context, 'locationAuthorization');
  if (['not-determined','restricted','denied','granted','unknown'].includes(authorization)) safe.locationAuthorization = authorization;
  for (const key of ['locationMainThread','locationStarted']) if (typeof own(context,key) === 'boolean') safe[key] = own(context,key);
  for (const key of ['locationCallbacks','locationUnknownFailures','locationSamplesRejected']) if (Number.isSafeInteger(own(context,key)) && own(context,key) >= 0 && own(context,key) <= 1000000) safe[key] = own(context,key);
  return { name, code, context: safe };
}

module.exports = { normalizeDiagnostic, sourceLocation };
