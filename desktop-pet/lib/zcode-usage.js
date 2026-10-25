const OFFICIAL_HOSTS = new Set(['zcode.z.ai', 'api.z.ai', 'open.bigmodel.cn']);
const MAX_BYTES = 2 * 1024 * 1024;
const text = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const validUnits = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const time = value => typeof value === 'number' && Number.isFinite(value) && value > 0
  && value <= 8640000000000000 ? value < 1e12 ? Math.round(value * 1000) : Math.round(value) : null;
const fail = code => Object.assign(new Error(code), { code });
async function requestOfficialJson(url, { headers = {}, fetch: fetchImpl = globalThis.fetch, signal } = {}) {
  let endpoint; try { endpoint = new URL(url); } catch (_error) { throw fail('ZCODE_UNTRUSTED_ENDPOINT'); }
  if (endpoint.protocol !== 'https:' || !OFFICIAL_HOSTS.has(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port) {
    throw fail('ZCODE_UNTRUSTED_ENDPOINT');
  }
  let response;
  try { response = await fetchImpl(endpoint.href, { method: 'GET', headers, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }); }
  catch (_error) { throw fail('ZCODE_NETWORK_ERROR'); }
  if (!response?.ok || response.status !== 200) throw fail([401, 403].includes(response?.status) ? 'ZCODE_LOGIN_REQUIRED' : 'ZCODE_HTTP_ERROR');
  if (response.headers?.get && Number(response.headers.get('content-length')) > MAX_BYTES) throw fail('ZCODE_RESPONSE_TOO_LARGE');
  let body = '';
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > MAX_BYTES) throw fail('ZCODE_RESPONSE_TOO_LARGE');
          chunks.push(Buffer.from(value));
        }
        body = Buffer.concat(chunks).toString('utf8');
      } finally { await reader.cancel().catch(() => {}); }
    } else body = await response.text();
    if (Buffer.byteLength(body) > MAX_BYTES) throw fail('ZCODE_RESPONSE_TOO_LARGE');
    return JSON.parse(body);
  } catch (error) { throw fail(error.code === 'ZCODE_RESPONSE_TOO_LARGE' ? error.code : 'ZCODE_INVALID_RESPONSE'); }
}
function normalizeZcodeBalance(payload, now = Date.now()) {
  const data = payload?.data || payload;
  const plans = Array.isArray(data?.plans) ? data.plans.slice(0, 64) : [];
  const seen = new Set();
  return (Array.isArray(data?.balances) ? data.balances.slice(0, 64) : []).flatMap(row => {
    const plan = plans.find(item => item?.plan_id === row?.plan_id
      && (!row?.user_plan_id || item.user_plan_id === row.user_plan_id));
    const entitlement = plan?.entitlements?.find(item => item?.entitlement_id === row?.entitlement_id);
    const start = time(row?.period_start); const end = time(row?.period_end || row?.expires_at);
    const total = row?.total_units; const remainingUnits = row?.remaining_units;
    const planId = text(row?.plan_id); const entitlementId = text(row?.entitlement_id);
    if (!plan || (plan.status && plan.status !== 'active') || !entitlement || !planId || !entitlementId || !start || !end || end <= start || end <= now || !validUnits(total) || total <= 0
      || !validUnits(remainingUnits) || remainingUnits > total || !text(row?.show_name)) return [];
    const bucketId = `zcode:${planId}:${entitlementId}${text(row.user_plan_id) ? `:${text(row.user_plan_id)}` : ''}`;
    if (seen.has(bucketId)) return []; seen.add(bucketId);
    const periodKind = entitlement?.period === 'daily' ? 'daily' : entitlement?.period === 'one_time' ? 'one_time' : 'unknown';
    return [{ sourceId: 'zcode', source: 'zcode-plan', id: bucketId, bucketId, planId, entitlementId,
      label: text(row.show_name), planName: text(plan?.name) || 'ZCode',
      model: text(row.capabilities?.find(value => typeof value === 'string' && value.startsWith('model:'))?.slice(6)),
      windowMinutes: (end - start) / 60000, remaining: remainingUnits / total * 100,
      resetsAt: end, expiresAt: time(row.expires_at), total, remainingUnits, unit: text(row.unit_type) || 'unknown',
      meter: text(row.meter), periodStart: start, periodKind }];
  });
}
function normalizeCodingPlanQuota(payload, now = Date.now()) {
  const data = payload?.data || payload;
  const multipliers = { 1: 1440, 3: 60, 5: 1, 6: 10080 };
  return (Array.isArray(data?.limits) ? data.limits.slice(0, 64) : []).flatMap(row => {
    if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(row?.type) || !Number.isFinite(row.percentage)
      || row.percentage < 0 || row.percentage > 100 || !Number.isInteger(row.number) || row.number <= 0) return [];
    const tool = row.type === 'TIME_LIMIT';
    // This documented legacy MCP marker means monthly, not a one-minute model window.
    const monthly = tool && row.unit === 5 && row.number === 1;
    const explicitStart = time(row.periodStart || row.period_start);
    const windowMinutes = monthly ? null : multipliers[row.unit] * row.number;
    const resetsAt = time(row.nextResetTime);
    if ((!monthly && !windowMinutes) || !resetsAt || resetsAt <= now || (!tool && resetsAt > now + windowMinutes * 60000 + 60000)) return [];
    const periodStart = explicitStart && explicitStart < resetsAt ? explicitStart : monthly ? null : resetsAt - windowMinutes * 60000;
    const actualSpan = periodStart !== null ? (resetsAt - periodStart) / 60000 : null;
    const total = validUnits(row.usage) && row.usage > 0 ? row.usage : null;
    const remainingUnits = validUnits(row.remaining) && total !== null && row.remaining <= total ? row.remaining
      : validUnits(row.currentValue) && total !== null && row.currentValue <= total ? total - row.currentValue : null;
    const remaining = total !== null && remainingUnits !== null ? remainingUnits / total * 100 : 100 - row.percentage;
    const bucketId = `zcode:paid:${row.type}:${row.unit}:${row.number}`;
    return [{ sourceId: 'zcode', source: 'coding-plan', id: bucketId, bucketId, label: tool ? 'MCP 工具' : row.type === 'CREDIT_LIMIT' ? 'Coding Plan 积分' : 'Coding Plan',
      planName: text(data.planName || data.plan) || 'Coding Plan', model: '', meter: tool ? 'tool_usage' : 'model_usage',
      windowMinutes: actualSpan, remaining, resetsAt, periodStart,
      periodKind: tool && row.unit === 5 ? 'monthly' : 'rolling', total, remainingUnits,
      unit: tool ? 'calls' : row.type === 'CREDIT_LIMIT' ? 'credits' : 'quota' }];
  });
}
async function fetchZcodeUsage(account, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  const buckets = []; let balanceState = 'unavailable'; let paidState = 'unavailable'; let firstError = null;
  if (account?.jwtToken && account?.deviceMid) {
    try {
      const payload = await requestOfficialJson('https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.16.3',
        { ...options, headers: { Authorization: `Bearer ${account.jwtToken}`, 'x-device-mid': account.deviceMid } });
      if (![undefined, 0, 200].includes(payload.code)) throw fail('ZCODE_BILLING_ERROR');
      const data = payload?.data || payload;
      if (!Array.isArray(data.balances) || !Array.isArray(data.plans)) throw fail('ZCODE_INVALID_RESPONSE');
      buckets.push(...normalizeZcodeBalance(payload, now)); balanceState = buckets.length ? 'connected' : 'empty';
    } catch (error) { firstError = error; balanceState = 'error'; }
  }
  if (account?.codingPlanApiKey && ['zai', 'bigmodel'].includes(account.family)) {
    const base = account.family === 'zai' ? 'https://api.z.ai' : 'https://open.bigmodel.cn';
    try {
      const team = account.selection?.scope === 'team' && account.selection.organizationId && account.selection.projectId;
      const payload = await requestOfficialJson(`${base}/api/monitor/usage/quota/limit${team ? '?type=2' : ''}`,
        { ...options, headers: { Authorization: `Bearer ${account.codingPlanApiKey}`,
          ...(team ? { 'Bigmodel-Organization': account.selection.organizationId, 'Bigmodel-Project': account.selection.projectId } : {}) } });
      if (payload.success !== true || payload.code !== 200 || !Array.isArray(payload.data?.limits)) throw fail('ZCODE_INVALID_RESPONSE');
      const paid = normalizeCodingPlanQuota(payload, now); buckets.push(...paid); paidState = paid.length ? 'connected' : 'empty';
    } catch (error) { firstError ||= error; paidState = 'error'; }
  }
  if (![balanceState, paidState].some(state => ['connected', 'empty'].includes(state))) throw firstError || fail('ZCODE_USAGE_UNAVAILABLE');
  const models = new Map();
  for (const row of buckets) {
    if (row.source !== 'zcode-plan' || !row.model) continue;
    models.set(row.model.toLowerCase(), row.model);
  }
  return { state: 'connected', buckets, windows: buckets, modelIds: [...models.values()], updatedAt: now, balanceState, paidState };
}
module.exports = { normalizeZcodeBalance, normalizeCodingPlanQuota, fetchZcodeUsage, requestOfficialJson };
