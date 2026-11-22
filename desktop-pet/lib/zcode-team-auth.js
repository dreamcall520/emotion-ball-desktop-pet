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
// Current ZCode 3.18.x binds paid requests to the OAuth session as well as the
// selected family/project. This scope is separate from stable quota history.
function officialAccountScope(account) {
  const kind = account?.selection?.kind;
  if (!['zai', 'bigmodel'].includes(account?.family) || !['individual-coding-plan', 'team-coding-plan'].includes(kind)) throw fail('ZCODE_LOGIN_REQUIRED');
  if (isTeam(account)) teamContext(account);
  const oauth = account?.accessToken;
  if (typeof oauth !== 'string' || !valid(oauth.replace(/^Bearer\s+/i, '').trim()) || !valid(account.accountIdentity || account.accountId)
    || account.jwtToken != null && typeof account.jwtToken !== 'string' || account.family === 'bigmodel' && oauth.trim() === account.jwtToken?.trim()) throw fail('ZCODE_LOGIN_REQUIRED');
  return fingerprint(JSON.stringify([account.family, kind, isTeam(account)
    ? [account.selection.organizationId, account.selection.projectId, account.selection.productId] : null,
  oauth.trim(), account.jwtToken?.trim() ?? null, account.sessionRevision ?? null,
  account.accountIdentity ?? account.accountId ?? null, account.zcodeUserId ?? account.accountId ?? null]));
}

// Existing long-lived key IDs are discovered with GET. The sole mutation is
// the official short-lived session-token exchange; this reader never creates,
// deletes, or persists an API key, a project, or credentials.
function createZcodeOfficialAccountAuth(requestJson, { now = Date.now } = {}) {
  let cached;
  async function resolveOfficialAccount(account, options = {}) {
    if (!['individual-coding-plan', 'team-coding-plan'].includes(account?.selection?.kind)) return account;
    const scope = officialAccountScope(account), team = isTeam(account), oauth = account.accessToken.trim().replace(/^Bearer\s+/i, '');
    const { expectedAccountScope, rejectedProjectTokenFingerprint, readAccount, ...requestOptions } = options;
    if (expectedAccountScope !== undefined && (!validFingerprint(expectedAccountScope) || expectedAccountScope !== scope)
      || rejectedProjectTokenFingerprint !== undefined && (!validFingerprint(rejectedProjectTokenFingerprint) || expectedAccountScope === undefined)) throw fail('ZCODE_LOGIN_REQUIRED');
    if (options.signal?.aborted) throw fail('DISCONNECTED');
    if (cached?.scope !== scope) { cached?.controller?.abort(); cached = { scope }; }
    const entry = cached;
    if (!entry.flight && entry.controller?.signal.aborted) { entry.controller = null; entry.token = null; entry.expiresAt = 0; }
    const assertCurrent = async () => {
      if (cached !== entry) throw fail('ZCODE_LOGIN_REQUIRED');
      if (options.signal?.aborted || entry.controller?.signal.aborted) throw fail('DISCONNECTED');
      if (typeof readAccount === 'function') {
        const latest = await readAccount();
        if (cached !== entry || officialAccountScope(latest) !== scope || account.accountKey && latest.accountKey !== account.accountKey) throw fail('ZCODE_LOGIN_REQUIRED');
        if (options.signal?.aborted) throw fail('DISCONNECTED');
      }
    };
    await assertCurrent();
    if (entry.token && rejectedProjectTokenFingerprint === fingerprint(entry.token)) { entry.token = null; entry.expiresAt = 0; }
    const material = async () => {
      await assertCurrent();
      if (!entry.token || !entry.location || entry.expiresAt <= now()) throw fail('ZCODE_LOGIN_REQUIRED');
      return { ...account, codingPlanApiKey: entry.token, codingPlanApiKeyId: entry.location.apiKeyId,
        codingPlanAccountScope: scope, codingPlanProjectToken: true,
        codingPlanQuotaOrigin: account.family === 'zai' ? 'https://api.z.ai' : 'https://open.bigmodel.cn' };
    };
    if (entry.token && entry.expiresAt > now() + 120000) return material();
    if (entry.flight) { await waitForFlight(entry.flight, options.signal); return material(); }
    entry.controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, entry.controller.signal]) : entry.controller.signal;
    const origin = account.family === 'zai' ? 'https://api.z.ai' : 'https://bigmodel.cn';
    const request = async (url, init) => {
      await assertCurrent();
      const payload = await requestJson(url, { ...requestOptions, ...init, signal });
      await assertCurrent(); return dataOf(payload);
    };
    entry.flight = (async () => {
      if (!entry.location) {
        const info = await request(`${origin}/api/biz/customer/getCustomerInfo`, { headers: { Authorization: oauth, 'Content-Type': 'application/json' } });
        if (!Array.isArray(info?.organizations)) throw fail('ZCODE_INVALID_RESPONSE');
        let selected;
        if (team) {
          const org = info.organizations.find(row => row?.organizationId === account.selection.organizationId);
          if (!Array.isArray(org?.projects) || !org.projects.some(row => row?.projectId === account.selection.projectId && String(row.projectType).trim() === '2')) throw fail('ZCODE_TEAM_ACCESS_DENIED');
          selected = { organizationId: account.selection.organizationId, projectId: account.selection.projectId };
          const entitlement = await request(`${origin}/api/biz/team/subscribe/product/querySubscribeDetail`, { headers: {
            Authorization: account.family === 'zai' ? `Bearer ${oauth}` : oauth,
            'Bigmodel-Organization': selected.organizationId, 'Bigmodel-Project': selected.projectId } });
          if (entitlement.hasSubscription === false || entitlement.status === 'EXPIRED' || entitlement.memberGrantStatus === 'UNASSIGNED') throw fail('ZCODE_TEAM_ACCESS_DENIED');
          if (entitlement.hasSubscription !== true || entitlement.status !== 'EFFECTIVE' || entitlement.memberGrantStatus !== 'VALID') throw fail('ZCODE_INVALID_RESPONSE');
        } else {
          const organizations = info.organizations.filter(row => valid(row?.organizationId) && Array.isArray(row.projects))
            .map(row => ({ ...row, projects: row.projects.filter(project => valid(project?.projectId) && String(project.projectType ?? '').trim() !== '2') }))
            .filter(row => row.projects.length);
          const org = organizations.find(row => typeof row.organizationName === 'string' && row.organizationName.includes('默认机构')) || organizations[0];
          const project = org?.projects.find(row => typeof row.projectName === 'string' && row.projectName.includes('默认项目')) || org?.projects[0];
          if (!org || !project) throw fail('ZCODE_PERSONAL_PROJECT_UNAVAILABLE');
          selected = { organizationId: org.organizationId, projectId: project.projectId };
        }
        const base = `${origin}/api/biz/v1/organization/${encodeURIComponent(selected.organizationId)}/projects/${encodeURIComponent(selected.projectId)}/api_keys`;
        const keys = await request(base, { headers: { Authorization: team || account.family === 'bigmodel' ? oauth : `Bearer ${oauth}`,
          'Content-Type': 'application/json', ...(team ? { 'Bigmodel-Organization': selected.organizationId, 'Bigmodel-Project': selected.projectId } : {}) } });
        if (!Array.isArray(keys)) throw fail('ZCODE_INVALID_RESPONSE');
        const key = keys.find(row => row?.name === (team ? 'zcode-team-api-key' : 'zcode-api-key') && (!team || row.keyType === 2) && valid(row.apiKey));
        if (!key) throw fail(team ? 'ZCODE_TEAM_KEY_MISSING' : 'ZCODE_PERSONAL_KEY_MISSING');
        entry.location = { ...selected, apiKeyId: key.apiKey };
      }
      const appVersion = options.appVersion || '3.18.2';
      if (typeof appVersion !== 'string' || !/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(appVersion)) throw fail('ZCODE_INVALID_APP_VERSION');
      const location = entry.location, started = now();
      const token = await request(`${origin}/api/biz/v1/organization/${encodeURIComponent(location.organizationId)}/projects/${encodeURIComponent(location.projectId)}/api_keys/${encodeURIComponent(location.apiKeyId)}/access_tokens`, {
        method: 'POST', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientType: 'zcode', clientVersion: appVersion }) });
      if (token.enable === false) throw fail(team ? 'ZCODE_TEAM_ACCESS_DENIED' : 'ZCODE_PLAN_ACCESS_DENIED');
      if (token.enable !== undefined && token.enable !== true) throw fail('ZCODE_INVALID_RESPONSE');
      const expiresAt = Math.min(token.expiresAt * 1000, started + token.expiresIn * 1000);
      if (!valid(token.accessToken) || token.tokenType !== 'Bearer' || !Number.isFinite(token.expiresIn) || token.expiresIn <= 0
        || !Number.isFinite(token.expiresAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw fail('ZCODE_INVALID_RESPONSE');
      entry.token = token.accessToken; entry.expiresAt = expiresAt;
    })().catch(error => { entry.token = null; entry.expiresAt = 0; throw error; }).finally(() => { entry.flight = null; });
    await waitForFlight(entry.flight, options.signal); return material();
  }
  resolveOfficialAccount.invalidate = account => {
    if (cached?.scope === officialAccountScope(account) && account.codingPlanApiKey === cached.token) {
      cached.controller?.abort(); cached = null;
    }
  };
  return resolveOfficialAccount;
}
module.exports = { createZcodeTeamAuth, teamContext, teamAccountScope, isTeam, officialAccountScope, createZcodeOfficialAccountAuth };
