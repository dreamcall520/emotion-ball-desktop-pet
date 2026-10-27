const { createHash } = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const valid = value => typeof value === 'string' && value.trim() === value && /^[^\x00-\x20\x7f]{1,4096}$/.test(value);
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const validFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isTeam = account => account?.selection?.kind === 'team-coding-plan' || account?.selection?.scope === 'team';
function teamContext(account) {
  const selection = account?.selection || {};
  if (!['zai', 'bigmodel'].includes(account?.family) ||
    ![selection.productId, selection.organizationId, selection.projectId].every(value => valid(value) && value.length <= 256)) {
    throw fail('ZCODE_TEAM_SELECTION_REQUIRED');
  }
  return { origin: account.family === 'bigmodel' ? 'https://bigmodel.cn' : 'https://api.z.ai',
    headers: { 'Bigmodel-Organization': selection.organizationId, 'Bigmodel-Project': selection.projectId } };
}
function dataOf(payload) {
  if (![0, 200, '0', '200'].includes(payload?.code) || !payload.data) throw fail('ZCODE_INVALID_RESPONSE');
  return payload.data;
}
function teamAccountScope(account) {
  teamContext(account);
  const oauth = typeof account.accessToken === 'string' ? account.accessToken.replace(/^Bearer\s+/i, '') : '';
  if (!valid(oauth) || !valid(account.accountId) || account.jwtToken != null && typeof account.jwtToken !== 'string') throw fail('ZCODE_LOGIN_REQUIRED');
  const { organizationId, projectId, productId } = account.selection;
  // Match ZCode's host accountScope; this is deliberately separate from the stable quota-history accountKey.
  return fingerprint(JSON.stringify([account.family, 'team-coding-plan', [organizationId, projectId, productId],
    account.accessToken.trim(), account.jwtToken?.trim() ?? null]));
}
function waitForFlight(flight, signal) {
  if (!signal) return flight;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(fail('DISCONNECTED')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    flight.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
// Reuse an existing ZCode team key ID; only its short-lived project token is minted, never a new API key.
function createZcodeTeamAuth(requestJson, { now = Date.now } = {}) {
  let cached;
  const scopeKey = account => JSON.stringify([account.accountId, teamAccountScope(account)]);
  async function resolveTeamAccount(account, options = {}) {
    if (!isTeam(account)) return account;
    const { origin, headers } = teamContext(account), selection = account.selection;
    const accountScope = teamAccountScope(account), scope = scopeKey(account);
    const { expectedAccountScope, rejectedProjectTokenFingerprint, ...requestOptions } = options;
    if (expectedAccountScope !== undefined && (!validFingerprint(expectedAccountScope) || expectedAccountScope !== accountScope) ||
      rejectedProjectTokenFingerprint !== undefined && (!validFingerprint(rejectedProjectTokenFingerprint) || expectedAccountScope === undefined)) {
      throw fail('ZCODE_LOGIN_REQUIRED');
    }
    if (options.signal?.aborted) throw fail('DISCONNECTED');
    const oauth = account.accessToken.replace(/^Bearer\s+/i, '');
    if (cached?.scope !== scope) { cached?.controller?.abort(); cached = { scope }; }
    const entry = cached;
    if (entry.token && rejectedProjectTokenFingerprint === fingerprint(entry.token)) {
      entry.token = null; entry.apiKeyId = null; entry.expiresAt = 0; entry.checkedAt = 0;
    }
    const material = () => {
      if (cached !== entry) throw fail('ZCODE_LOGIN_REQUIRED');
      if (options.signal?.aborted) throw fail('DISCONNECTED');
      if (!entry.token || !entry.apiKeyId) throw fail('ZCODE_LOGIN_REQUIRED');
      return { ...account, codingPlanApiKey: entry.token, codingPlanApiKeyId: entry.apiKeyId,
        codingPlanAccountScope: accountScope, codingPlanProjectToken: true };
    };
    if (entry.token && entry.expiresAt > now() + 120000 && entry.checkedAt > now() - 120000) return material();
    if (entry.flight) { await waitForFlight(entry.flight, options.signal); return material(); }
    entry.controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, entry.controller.signal]) : entry.controller.signal;
    const request = async (url, init = {}) => {
      const result = await requestJson(url, { ...requestOptions, ...init, signal });
      if (cached !== entry) throw fail('ZCODE_LOGIN_REQUIRED');
      if (signal.aborted) throw fail('DISCONNECTED');
      return dataOf(result);
    };
    entry.flight = (async () => {
      const info = await request(`${origin}/api/biz/customer/getCustomerInfo`,
        { headers: { Authorization: oauth, 'Content-Type': 'application/json' } });
      if (!Array.isArray(info.organizations)) throw fail('ZCODE_INVALID_RESPONSE');
      const organization = info.organizations.find(row => String(row?.organizationId) === selection.organizationId);
      if (!Array.isArray(organization?.projects) ||
        !organization.projects.some(row => String(row?.projectId) === selection.projectId && String(row.projectType).trim() === '2')) {
        throw fail('ZCODE_TEAM_ACCESS_DENIED');
      }
      const entitlement = await request(`${origin}/api/biz/team/subscribe/product/querySubscribeDetail`, {
        headers: { ...headers, Authorization: account.family === 'zai' ? `Bearer ${oauth}` : oauth } });
      if (entitlement.hasSubscription === false || entitlement.status === 'EXPIRED' || entitlement.memberGrantStatus === 'UNASSIGNED') {
        throw fail('ZCODE_TEAM_ACCESS_DENIED');
      }
      if (entitlement.hasSubscription !== true || entitlement.status !== 'EFFECTIVE' || entitlement.memberGrantStatus !== 'VALID') throw fail('ZCODE_INVALID_RESPONSE');
      if (!entry.token || entry.expiresAt <= now() + 120000) {
        const base = `${origin}/api/biz/v1/organization/${encodeURIComponent(selection.organizationId)}/projects/${encodeURIComponent(selection.projectId)}/api_keys`;
        const keys = await request(base, { headers: { ...headers, Authorization: oauth, 'Content-Type': 'application/json' } });
        if (!Array.isArray(keys)) throw fail('ZCODE_INVALID_RESPONSE');
        const key = keys.find(row => row?.name === 'zcode-team-api-key' && row.keyType === 2 && valid(row.apiKey));
        if (!key) throw fail('ZCODE_TEAM_KEY_MISSING');
        const started = now();
        const token = await request(`${base}/${encodeURIComponent(key.apiKey)}/access_tokens`, {
          method: 'POST', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientType: 'zcode', clientVersion: options.appVersion || '3.16.3' }) });
        if (token.enable === false) throw fail('ZCODE_TEAM_ACCESS_DENIED');
        if (token.enable !== undefined && token.enable !== true) throw fail('ZCODE_INVALID_RESPONSE');
        const expiresAt = Math.min(token.expiresAt * 1000, started + token.expiresIn * 1000);
        if (!valid(token.accessToken) || token.tokenType !== 'Bearer' || !Number.isFinite(token.expiresIn) || token.expiresIn <= 0 ||
          !Number.isFinite(token.expiresAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw fail('ZCODE_INVALID_RESPONSE');
        entry.token = token.accessToken; entry.apiKeyId = key.apiKey; entry.expiresAt = expiresAt;
      }
      entry.checkedAt = now();
    })().catch(error => { entry.token = null; entry.apiKeyId = null; throw error; }).finally(() => { entry.flight = null; });
    await waitForFlight(entry.flight, options.signal);
    return material();
  }
  resolveTeamAccount.invalidate = account => {
    if (isTeam(account) && typeof account?.accessToken === 'string' && cached?.scope === scopeKey(account) &&
      account.codingPlanApiKey && account.codingPlanApiKey === cached.token) {
      cached.controller?.abort(); cached = null;
    }
  };
  return resolveTeamAccount;
}
module.exports = { createZcodeTeamAuth, teamContext, teamAccountScope, isTeam };
