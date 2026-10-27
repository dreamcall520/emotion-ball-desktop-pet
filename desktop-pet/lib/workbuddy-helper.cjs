const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ORIGIN = 'https://copilot.tencent.com';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code = 'INVALID_RESPONSE') => { if (!condition) fail(code); };
function base64(value, length) {
  check(typeof value === 'string');
  const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value && (length === undefined || bytes.length === length));
  return bytes;
}
const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const prefixed = value => { const bytes = Buffer.from(value); return Buffer.concat([u32(bytes.length), bytes]); };
function aad(id) {
  return Buffer.concat([Buffer.from('WB-AAD\0'), Buffer.from([1]), prefixed('WBEV1'), prefixed('sym-v1'),
    u32(1), prefixed(id), Buffer.from([2, 0, 0])]);
}
function decryptToken(field, key, id) {
  if (typeof field === 'string') { check(field.length > 20, 'LOGIN_REQUIRED'); return field; }
  check(field && Object.keys(field).sort().join(',') === '$wbEncrypted,envelope' && field.$wbEncrypted === 1, 'UNSUPPORTED_AUTH');
  const envelope = JSON.parse(base64(field.envelope).toString('utf8'));
  check(Object.keys(envelope).sort().join(',') === 'authTag,ciphertext,keyId,nonce,suite');
  check(envelope.suite === 1 && envelope.keyId === id, 'UNSUPPORTED_AUTH');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, base64(envelope.nonce, 12), { authTagLength: 16 });
  decipher.setAAD(aad(id));
  decipher.setAuthTag(base64(envelope.authTag, 16));
  const token = Buffer.concat([decipher.update(base64(envelope.ciphertext)), decipher.final()]).toString('utf8');
  check(token.length > 20, 'LOGIN_REQUIRED');
  return token;
}
const ENTERPRISE_DOMAINS = new Set(['www.workbuddy.cn', 'www.codebuddy.cn', 'copilot.tencent.com']);
function sessionIdentity(session) {
  const account = session.account, domain = session.auth?.domain;
  check(account && typeof account.uid === 'string' && account.uid.length > 0, 'LOGIN_REQUIRED');
  check(/^[\x21-\x7e]{1,256}$/.test(account.uid), 'UNSUPPORTED_ACCOUNT');
  check(account.enterpriseId == null || typeof account.enterpriseId === 'string', 'UNSUPPORTED_ACCOUNT');
  const enterpriseId = account.enterpriseId?.trim?.() || '';
  if (!enterpriseId) {
    const type = typeof account.type === 'string' ? account.type.trim().toLowerCase() : '';
    check(['personal', 'pro'].includes(type) && account.isCurrentOneIdEnterprise !== true && domain === 'www.workbuddy.cn' &&
      (!session.deploymentType || session.deploymentType === 'SaaS') &&
      (!session.networkEnvironment || session.networkEnvironment === 'internal'), 'UNSUPPORTED_ACCOUNT');
    return { uid: account.uid, domain, scope: 'personal',
      accountKey: crypto.createHash('sha256').update('workbuddy:' + domain + ':personal:' + account.uid).digest('hex') };
  }
  check(ENTERPRISE_DOMAINS.has(domain) && account.type !== 'exclusive' &&
    (!session.deploymentType || session.deploymentType === 'SaaS') &&
    (!session.networkEnvironment || session.networkEnvironment === 'internal'), 'UNSUPPORTED_ACCOUNT');
  check(/^[A-Za-z0-9._:-]{1,128}$/.test(enterpriseId) && typeof account.type === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(account.type), 'UNSUPPORTED_ACCOUNT');
  const departmentId = account.departmentId ?? account.department_id ?? '';
  const department = account.departmentFullName ?? '';
  check(typeof departmentId === 'string' && departmentId.length <= 256 && !/[\r\n]/.test(departmentId), 'UNSUPPORTED_ACCOUNT');
  // Official desktop quota/gateway headers omit this optional field. Keep its opaque
  // authority identity in the scope only; do not invent a wire encoding for Chinese.
  let departmentScope;
  if (typeof department === 'string') {
    check(department.length <= 2048 && !/[\r\n]/.test(department), 'UNSUPPORTED_ACCOUNT');
    departmentScope = department;
  } else {
    check(department && department.$wbEncrypted === 1 &&
      Object.keys(department).sort().join(',') === '$wbEncrypted,envelope' &&
      typeof department.envelope === 'string' && department.envelope.length <= 16384, 'UNSUPPORTED_AUTH');
    base64(department.envelope);
    departmentScope = JSON.stringify(department);
  }
  const scope = ['workbuddy', domain, 'enterprise', account.uid, account.type, enterpriseId, departmentId, departmentScope];
  return { uid: account.uid, domain, scope: 'enterprise', enterpriseId, departmentId,
    accountKey: crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex') };
}
function readAuth(includeRefresh = false) {
  check(process.platform === 'darwin', 'UNSUPPORTED_PLATFORM');
  const file = path.join(os.homedir(), 'Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info');
  check(fs.existsSync(file) && !fs.existsSync(file + '.logged-out'), 'LOGIN_REQUIRED');
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  const identity = sessionIdentity(session);
  const payload = JSON.parse(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet());
  check(payload.version === 1, 'UNSUPPORTED_AUTH');
  base64(payload.atRestSecretKey, 32);
  const key = crypto.createHash('sha256').update(payload.atRestSecretKey, 'utf8').digest();
  try {
    const keyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    return { token: decryptToken(session.auth.accessToken, key, keyId), ...identity,
      ...(includeRefresh && identity.scope === 'personal' ? { refreshToken: decryptToken(session.auth.refreshToken, key, keyId) } : {}) };
  } finally { key.fill(0); }
}
function headers(auth, conversationId) {
  const values = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + auth.token,
    'X-User-Id': auth.uid, 'X-Domain': auth.domain, 'X-Product': 'SaaS', 'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy', 'X-IDE-Version': '5.8.3', 'User-Agent': 'CLI/5.8.3 WorkBuddy/5.8.3',
    'X-Requested-With': 'XMLHttpRequest' };
  if (auth.scope === 'enterprise') Object.assign(values, {
    'X-Enterprise-Id': auth.enterpriseId, 'X-Tenant-Id': auth.enterpriseId
  });
  if (conversationId) Object.assign(values, { 'X-Agent-Intent': 'craft', 'X-Agent-Purpose': 'conversation',
    'X-Conversation-ID': conversationId, 'X-Conversation-Request-ID': crypto.randomUUID(),
    'X-Conversation-Message-ID': crypto.randomUUID() });
  if (conversationId) values['X-Request-ID'] = values['X-Conversation-Message-ID'];
  return values;
}
async function request(auth, route, body, signal, conversationId) {
  auth.verifyCurrent?.();
  const origin = auth.scope === 'enterprise' && route.startsWith('/v2/billing/') ? 'https://www.workbuddy.cn' : ORIGIN;
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: headers(auth, conversationId),
    body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' });
  auth.verifyCurrent?.();
  if (!response.ok) {
    if (response.status === 401) fail('LOGIN_REQUIRED');
    if (response.status === 429) fail('RATE_LIMITED');
    let code;
    try { code = Number((await response.json()).code); } catch (_) {}
    if (code === 14018) fail('INSUFFICIENT_CREDITS');
    if (code === 11140) fail('ACCOUNT_RESTRICTED');
    fail(response.status === 400 ? 'MODEL_UNAVAILABLE' : 'SERVICE_UNAVAILABLE');
  }
  return response;
}
async function jsonRequest(auth, route, body, signal) {
  const response = await request(auth, route, body, signal);
  const parts = []; let size = 0;
  for await (const part of response.body) { size += part.length; check(size <= 4 * 1024 * 1024); parts.push(part); }
  const raw = Buffer.concat(parts).toString('utf8');
  auth.verifyCurrent?.();
  const envelope = JSON.parse(raw);
  if (Number(envelope.code)) fail(Number(envelope.code) === 14018 ? 'INSUFFICIENT_CREDITS' : 'SERVICE_UNAVAILABLE');
  check(envelope.data && typeof envelope.data === 'object');
  return envelope.data;
}
function amount(value) {
  check((typeof value === 'string' && value.trim() !== '') || typeof value === 'number');
  const number = Number(value); check(Number.isFinite(number) && number >= 0); return number;
}
function timestamp(value) {
  let ms;
  if (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) ms = Number(value);
  else {
    check(typeof value === 'string');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) value = value.replace(' ', 'T') + '+08:00';
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value));
    ms = Date.parse(value);
  }
  check(Number.isSafeInteger(ms) && ms > 0 && ms <= 8640000000000000); return ms;
}
const code = (id, suffix) => `TCACA_code_${id}_${suffix}`;
const BASIC = code('008', 'cfWoLwvjU4');
const REWARD = code('007', 'nzdH5h4Nl0');
const PAID_BASE = [code('002', 'AkiJS3ZHF5'), code('005', 'maRGyrHhw1'), code('003', 'FAnt7lcmRT'), code('023', '4xbGhMrE6q'),
  code('026', 'BaESVICNoi'), code('027', '0FCGVA6vSa')];
const ADDON = [code('009', '0XmEQc2xOf'), code('038', 'OhvqZtiPKr'), code('036', 'lupO5WgNdG')];
const FREE_BASE = [BASIC, code('035', 'ArVxJcGDsm'), code('039', 'KRcQj7wUat'), code('040', 'mi9rCYg46x')];
const PLAN_BONUS = [code('028', 'NtpWi0jzXs'), code('037', 'WxOD3MpI2o')];
const BENEFIT = [REWARD, code('029', '6wCGEWquYy'), code('030', 'BjSt89qTvr')];
const PAID = [...PAID_BASE, ...ADDON];
const FREE = [code('001', 'PqouKr6QWV'), code('006', 'DbXS0lrypC'), ...FREE_BASE, ...PLAN_BONUS, ...BENEFIT];
const CREDIT_GROUPS = new Map([
  ...[...PAID_BASE, ...FREE_BASE].map(code => [code, 'basic']),
  ...[...PLAN_BONUS, ...BENEFIT].map(code => [code, 'reward']), ...ADDON.map(code => [code, 'purchased'])
]);
function quotaReport(summary, accounts, now = Date.now()) {
  check(summary && typeof summary.IsPaidUser === 'boolean' && Array.isArray(summary.Packages) && Array.isArray(accounts));
  const remaining = p => amount(p.CycleRemainCapacity === undefined
    ? amount(p.CycleTotalCapacity) - amount(p.CycleUsedCapacity) : p.CycleRemainCapacity);
  const detailRemaining = p => {
    check(p.SlicePeriodUsageDetails == null || Array.isArray(p.SlicePeriodUsageDetails));
    const slice = Number(p.CapacityType) === 4 && p.SlicePeriodUsageDetails?.[0];
    return amount(slice ? slice.SlicePeriodCapacityRemainPrecise : p.CycleCapacityRemainPrecise == null || p.CycleCapacityRemainPrecise === ''
      ? p.CycleCapacityRemain : p.CycleCapacityRemainPrecise);
  };
  const totals = new Map(), details = new Map(), resources = new Map(), unique = [];
  const add = (map, p, left) => {
    check(p && typeof p.PackageCode === 'string');
    // Legacy count-based packages must never be reported as credits.
    check(CREDIT_GROUPS.has(p.PackageCode) || left === 0, 'UNSUPPORTED_QUOTA');
    map.set(p.PackageCode, amount((map.get(p.PackageCode) || 0) + left));
  };
  for (const p of summary.Packages) { check(p && typeof p === 'object'); add(totals, p, remaining(p)); }
  for (const p of accounts) {
    check(p && typeof p === 'object');
    const left = detailRemaining(p), id = p.ResourceId;
    if (id != null && id !== '') {
      check(typeof id === 'string' || Number.isSafeInteger(id));
      const previous = resources.get(String(id));
      if (previous) {
        check(previous.PackageCode === p.PackageCode && detailRemaining(previous) === left &&
          previous.CycleEndTime === p.CycleEndTime && previous.DeductionEndTime === p.DeductionEndTime);
        continue;
      }
      resources.set(String(id), p);
    }
    add(details, p, left); unique.push(p);
  }
  const balances = { basic: 0, reward: 0, purchased: 0 };
  for (const packageCode of new Set([...totals.keys(), ...details.keys()])) {
    const left = totals.get(packageCode) || 0;
    check(Math.abs(left - (details.get(packageCode) || 0)) < 0.000001);
    const group = CREDIT_GROUPS.get(packageCode);
    if (group) balances[group] = amount(balances[group] + left);
  }
  const bases = [...totals.keys()].filter(code => CREDIT_GROUPS.get(code) === 'basic');
  const refreshCode = bases.includes(summary.SubscriptionPackageCode) ? summary.SubscriptionPackageCode : bases.length === 1 ? bases[0] : null;
  const refreshes = unique.filter(p => p.PackageCode === refreshCode && p.CycleEndTime)
    .map(p => timestamp(p.CycleEndTime) + 1000).filter(at => at > now);
  const expires = unique.filter(p => [...ADDON, ...BENEFIT].includes(p.PackageCode) && detailRemaining(p) > 0).map(p => {
    const at = timestamp(p.DeductionEndTime); check(at > now);
    return { amount: detailRemaining(p), at };
  }).sort((a, b) => a.at - b.at);
  return { total: amount(balances.basic + balances.reward + balances.purchased), ...balances,
    plan: summary.IsPaidUser ? '个人付费版' : '体验版', nextRefreshAt: refreshes.length ? Math.min(...refreshes) : null, expires, updatedAt: now };
}
function enterpriseQuotaReport(value, now = Date.now()) {
  check(value && typeof value === 'object');
  const limit = value.limitNum, used = value.credit;
  check(typeof limit === 'number' && Number.isFinite(limit) && (limit === -1 || limit >= 0));
  check(typeof used === 'number' && Number.isFinite(used) && used >= 0);
  let nextRefreshAt = null;
  if (value.cycleResetTime != null && value.cycleResetTime !== '') {
    check(typeof value.cycleResetTime === 'string');
    nextRefreshAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.cycleResetTime)
      ? timestamp(value.cycleResetTime) : Date.parse(value.cycleResetTime);
    check(Number.isFinite(nextRefreshAt));
  }
  return { scope: 'enterprise', unlimited: limit === -1,
    total: limit === -1 ? null : Math.max(0, limit - used), limit: limit === -1 ? null : limit, used,
    basic: null, reward: null, purchased: null, plan: '企业版', nextRefreshAt, expires: [], updatedAt: now };
}
async function quota(auth, signal) {
  if (auth.scope === 'enterprise') {
    const raw = await jsonRequest(auth, '/v2/billing/meter/get-enterprise-user-usage', {}, signal);
    const value = typeof raw.limitNum === 'number' ? raw : raw.data;
    return { accountKey: auth.accountKey, report: enterpriseQuotaReport(value) };
  }
  const summary = await jsonRequest(auth, '/billing/meter/get-user-resource-summary', {}, signal);
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const accounts = [];
  for (const [kind, extra] of [['paid', { PackageCodes: PAID, NeedRenewInfo: true }], ['free', { PackageCodes: FREE,
    SlicePeriodStartTime: day + ' 00:00:00', SlicePeriodEndTime: day + ' 23:59:59' }]]) {
    let count = 0;
    for (let page = 1; page <= 10; page++) {
      const result = await jsonRequest(auth, '/billing/meter/get-user-resource-' + kind + '-packages',
        { PageNumber: page, PageSize: 200, Status: [0, 3], ...extra }, signal);
      check(Array.isArray(result.Accounts) && Number.isInteger(result.TotalCount) && result.TotalCount >= 0);
      accounts.push(...result.Accounts); count += result.Accounts.length;
      if (count >= result.TotalCount) { check(count === result.TotalCount); break; }
      check(result.Accounts.length === 200 && page < 10);
    }
  }
  return { accountKey: auth.accountKey, report: quotaReport(summary, accounts) };
}
async function models(auth, signal) {
  const config = await jsonRequest(auth, '/v3/config', undefined, signal);
  check(Array.isArray(config.agents) && Array.isArray(config.models));
  const ids = config.agents.filter(agent => agent.name === 'cli').flatMap(agent => agent.models || []);
  const result = config.models.filter(model => ids.includes(model.id) && model.disabled !== true).map(model => {
    check(typeof model.id === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(model.id));
    check(typeof model.name === 'string' && model.name.length <= 200);
    return { id: model.id, displayName: model.name };
  });
  check(result.length > 0, auth.scope === 'enterprise' ? 'MODEL_UNAVAILABLE' : 'INVALID_RESPONSE');
  check(result.length <= 200);
  return { accountKey: auth.accountKey, models: result };
}
async function readSse(body, onDelta) {
  check(body && body[Symbol.asyncIterator]);
  const decoder = new TextDecoder();
  let buffer = '', text = '', terminal = false;
  function event(raw) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { terminal = true; return; }
    const packet = JSON.parse(data);
    if (packet.error || Number(packet.code)) fail(Number(packet.code ?? packet.error?.code) === 14018 ? 'INSUFFICIENT_CREDITS' : 'SERVICE_UNAVAILABLE');
    check(Array.isArray(packet.choices));
    for (const choice of packet.choices) {
      const tools = choice.delta?.tool_calls, legacyCall = choice.delta?.function_call;
      if (tools != null) check(Array.isArray(tools));
      if (legacyCall != null) check(typeof legacyCall === 'object' && !Array.isArray(legacyCall) &&
        Object.keys(legacyCall).every(key => ['name', 'arguments'].includes(key)));
      const legacyTool = legacyCall && ['name', 'arguments'].some(key => legacyCall[key] != null && legacyCall[key] !== '');
      if ((tools?.length > 0) || legacyTool || choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') fail('TOOLS_UNSUPPORTED');
      const content = choice.delta?.content;
      if (content != null) {
        check(!terminal && typeof content === 'string'); text += content; check(text.length <= 32000, 'RESPONSE_TOO_LONG');
        if (content) onDelta(content);
      }
      if (choice.finish_reason) {
        check(choice.finish_reason === 'stop', choice.finish_reason === 'length' ? 'TRUNCATED_RESPONSE' : 'INVALID_RESPONSE'); terminal = true;
      }
    }
  }
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    check(buffer.length <= 1024 * 1024, 'RESPONSE_TOO_LONG');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) event(buffer);
  check(terminal && text.trim().length > 0, 'TRUNCATED_RESPONSE');
  return text;
}
async function execute(operation, payload, onDelta = () => {}, { authReader = readAuth } = {}) {
  check(['quota', 'models', 'chat', 'tasks', 'task-open', 'usage'].includes(operation), 'INVALID_REQUEST');
  const auth = authReader(operation === 'usage');
  if (auth.scope === 'enterprise') auth.verifyCurrent = () => {
    const current = authReader(false);
    check(current.accountKey === auth.accountKey, 'ACCOUNT_CHANGED');
  };
  try {
  if (payload.expectedAccountKey !== undefined) check(payload.expectedAccountKey === auth.accountKey, 'ACCOUNT_CHANGED');
  if (auth.scope === 'enterprise' && ['tasks', 'task-open'].includes(operation)) fail('TASK_CACHE_UNSUPPORTED');
  if (operation === 'tasks') return require('./workbuddy-tasks-reader').readWorkBuddyTasks({ uid: auth.uid, accountKey: auth.accountKey });
  if (operation === 'task-open') {
    check(typeof payload.expectedAccountKey === 'string', 'ACCOUNT_CHANGED');
    return require('./workbuddy-tasks-reader').workBuddyTaskLink({ uid: auth.uid, accountKey: auth.accountKey, id: payload.id });
  }
  const signal = AbortSignal.timeout(operation === 'chat' ? 180000 : 55000);
  if (operation === 'quota') return await quota(auth, signal);
  if (operation === 'models') return await models(auth, signal);
  if (operation === 'usage') return await require('./workbuddy-usage-reader').readWorkBuddyUsage({ auth, authHeaders: headers(auth), signal });
  check(typeof payload.expectedAccountKey === 'string', 'ACCOUNT_CHANGED');
  check(typeof payload.model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(payload.model), 'INVALID_REQUEST');
  check(typeof payload.conversationId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.conversationId), 'INVALID_REQUEST');
  check(Array.isArray(payload.messages) && payload.messages.length > 0 && payload.messages.length <= 100, 'INVALID_REQUEST');
  check(payload.messages.every(message => ['system', 'user', 'assistant'].includes(message.role) && typeof message.content === 'string'), 'INVALID_REQUEST');
  check(JSON.stringify(payload.messages).length <= 200000, 'CONTEXT_TOO_LONG');
  const directory = await models(auth, signal);
  check(directory.models.some(model => model.id === payload.model), 'MODEL_UNAVAILABLE');
  const response = await request(auth, '/v2/chat/completions', { model: payload.model, messages: payload.messages,
    stream: true, stream_options: { include_usage: true }, max_tokens: 1024 }, signal, payload.conversationId);
  check((response.headers.get('content-type') || '').includes('text/event-stream'));
  const text = await readSse(response.body, delta => { auth.verifyCurrent?.(); onDelta(delta); });
  auth.verifyCurrent?.();
  return { accountKey: auth.accountKey, text };
  } catch (error) { error.accountKey = auth.accountKey; throw error; }
}
const SAFE_ERRORS = new Set(['INVALID_RESPONSE', 'LOGIN_REQUIRED', 'UNSUPPORTED_AUTH', 'UNSUPPORTED_PLATFORM', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_QUOTA',
  'RATE_LIMITED', 'INSUFFICIENT_CREDITS', 'ACCOUNT_RESTRICTED', 'MODEL_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'ACCOUNT_CHANGED',
  'TOOLS_UNSUPPORTED', 'TRUNCATED_RESPONSE', 'RESPONSE_TOO_LONG', 'INVALID_REQUEST', 'CONTEXT_TOO_LONG', 'TASK_CACHE_UNAVAILABLE', 'TASK_CACHE_UNSUPPORTED', 'TASK_NOT_FOUND',
  'INVALID_USAGE_RESPONSE', 'USAGE_UNAVAILABLE', 'USAGE_INCOMPLETE']);
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > 256000) process.exit(1); });
  process.stdin.on('end', async () => {
    const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
    try {
      const message = JSON.parse(input);
      const result = await execute(message.operation, message.payload || {}, text => emit({ type: 'delta', text }));
      emit({ type: 'result', result });
    } catch (error) {
      emit({ type: 'error', code: SAFE_ERRORS.has(error.code) ? error.code : error.name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTION_FAILED',
        ...(/^[0-9a-f]{64}$/.test(error.accountKey || '') ? { accountKey: error.accountKey } : {}) });
      process.exitCode = 1;
    }
  });
}
module.exports = { aad, decryptToken, quotaReport, enterpriseQuotaReport, sessionIdentity, readSse, execute };
