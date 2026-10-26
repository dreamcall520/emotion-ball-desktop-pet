const WEBSITE = 'https://www.workbuddy.cn';
const ALLOWED_HOSTS = new Set(['www.workbuddy.cn', 'www.codebuddy.cn', 'copilot.tencent.com']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = condition => { if (!condition) fail('INVALID_USAGE_RESPONSE'); };
const dayAt = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
function usageRange(now) {
  const endDate = dayAt(now), startDate = dayAt(now - 6 * 86400000);
  return { startDate, endDate };
}
async function json(response) {
  if (!response.ok) fail(response.status === 401 ? 'LOGIN_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'USAGE_UNAVAILABLE');
  const chunks = []; let size = 0;
  for await (const part of response.body) { size += part.length; check(size <= 4 * 1024 * 1024); chunks.push(part); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { fail('INVALID_USAGE_RESPONSE'); }
  check(value && typeof value === 'object' && Object.hasOwn(value, 'code') && Number.isFinite(Number(value.code)));
  if (Number(value.code)) fail('USAGE_UNAVAILABLE');
  check(value.data && typeof value.data === 'object');
  return value.data;
}
function createCookieJar() {
  const values = [];
  return {
    take(response, url) {
      for (const raw of response.headers.getSetCookie()) {
        const parts = raw.split(';').map(value => value.trim()), pair = parts.shift(), equals = pair.indexOf('=');
        if (equals < 1) continue;
        const attribute = name => parts.find(value => value.toLowerCase().startsWith(name + '='))?.slice(name.length + 1);
        const rawDomain = attribute('domain'), domain = rawDomain ? rawDomain.replace(/^\./, '').toLowerCase() : url.hostname;
        if (!['workbuddy.cn', 'codebuddy.cn', 'tencent.com', ...ALLOWED_HOSTS].includes(domain)) continue;
        if (!(url.hostname === domain || url.hostname.endsWith('.' + domain))) continue;
        const name = pair.slice(0, equals), cookiePath = attribute('path') || '/';
        const old = values.findIndex(value => value.name === name && value.domain === domain && value.path === cookiePath);
        if (old >= 0) values.splice(old, 1);
        if (attribute('max-age') === '0') continue;
        values.push({ name, pair, domain, hostOnly: !rawDomain, path: cookiePath });
      }
    },
    header(url) { return values.filter(value => (url.hostname === value.domain || !value.hostOnly && url.hostname.endsWith('.' + value.domain)) &&
      (url.pathname === value.path || url.pathname.startsWith(value.path.endsWith('/') ? value.path : value.path + '/'))).map(value => value.pair).join('; '); }
  };
}
async function loginWebsite({ auth, authHeaders, fetchImpl, signal }) {
  check(typeof auth.refreshToken === 'string' && auth.refreshToken.length > 20);
  const device = await json(await fetchImpl('https://copilot.tencent.com/v2/plugin/device/auth/code', {
    method: 'POST', headers: { ...authHeaders, 'X-Refresh-Token': auth.refreshToken }, redirect: 'error', signal }));
  check(typeof device.deviceCode === 'string' && device.deviceCode.length > 0 && device.deviceCode.length < 4096);
  let url = new URL('/console/client-login', WEBSITE);
  url.searchParams.set('code', device.deviceCode); url.searchParams.set('target', '/profile/plans-usage');
  const cookies = createCookieJar();
  for (let index = 0; index < 6; index++) {
    check(url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port);
    const response = await fetchImpl(url, { headers: { Cookie: cookies.header(url) }, redirect: 'manual', signal });
    cookies.take(response, url);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); check(typeof location === 'string' && location.length < 8192);
      url = new URL(location, url); continue;
    }
    if (!response.ok) fail('LOGIN_REQUIRED');
    check(url.origin === WEBSITE && url.pathname === '/profile/plans-usage');
    check(cookies.header(new URL('/billing/meter/get-user-request-usage', WEBSITE)).length > 0);
    return cookies;
  }
  fail('USAGE_UNAVAILABLE');
}
function aggregateUsage(pages, { startDate, endDate }, updatedAt) {
  const units = new Map(), todayUnits = new Map(), ids = new Set(); let requestCount = 0;
  for (const rows of pages) for (const row of rows) {
    // Read only billing metadata; input and inputTrunc are deliberately never accessed.
    const time = row?.requestTime, credit = row?.credit;
    check(typeof time === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(time));
    const date = time.slice(0, 10), timestamp = Date.parse(time.replace(' ', 'T') + '+08:00');
    check(Number.isFinite(timestamp) && dayAt(timestamp) === date && date >= startDate && date <= endDate);
    check((typeof credit === 'number' || typeof credit === 'string' && credit.trim() !== '') && Number.isFinite(Number(credit)) && Number(credit) >= 0);
    const value = Math.round(Number(credit) * 1e8); check(Number.isSafeInteger(value));
    if (date === endDate) {
      check(timestamp <= updatedAt);
      const atTotal = (todayUnits.get(timestamp) || 0) + value; check(Number.isSafeInteger(atTotal));
      todayUnits.set(timestamp, atTotal);
    }
    const id = row.requestId;
    if (typeof id === 'string' && id) { check(!ids.has(id)); ids.add(id); }
    const total = (units.get(date) || 0) + value; check(Number.isSafeInteger(total)); units.set(date, total); requestCount++;
    check(requestCount <= 10000);
  }
  const days = [];
  for (let time = Date.parse(startDate + 'T00:00:00+08:00'); dayAt(time) <= endDate; time += 86400000) {
    const date = dayAt(time); days.push({ date, credits: (units.get(date) || 0) / 1e8 });
  }
  const total = [...units.values()].reduce((sum, value) => sum + value, 0); check(Number.isSafeInteger(total));
  const todayRecords = [...todayUnits].sort(([a], [b]) => a - b).map(([at, value]) => ({ at, credits: value / 1e8 }));
  return { source: 'official-request-usage', timezone: 'Asia/Shanghai', startDate, endDate, days,
    todayRecords, todayCredits: days.at(-1).credits, totalCredits: total / 1e8, requestCount, updatedAt, delayHours: 3, complete: true };
}
async function readWorkBuddyUsage({ auth, authHeaders, fetchImpl = fetch, signal, now = Date.now }) {
  if(auth?.scope==='enterprise'||auth?.enterpriseId)fail('USAGE_UNAVAILABLE');
  const startedAt = now(), range = usageRange(startedAt), cookies = await loginWebsite({ auth, authHeaders, fetchImpl, signal });
  const url = new URL('/billing/meter/get-user-request-usage', WEBSITE), pages = [];
  let total = null, received = 0;
  // The official personal component uses v1 page numbers; v2 is the enterprise component.
  for (let pageNum = 1; pageNum <= 100; pageNum++) {
    const body = await json(await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      'X-Client-Platform': 'web', Cookie: cookies.header(url) }, body: JSON.stringify({ startTime: range.startDate + ' 00:00:00',
      endTime: range.endDate + ' 23:59:59', pageNum, pageSize: 100 }), redirect: 'error', signal }));
    check(Number.isSafeInteger(body.total) && body.total >= 0 && Array.isArray(body.data) && body.data.length <= 100);
    if (total === null) total = body.total;
    check(total === body.total);
    pages.push(body.data.map(row => ({ requestTime: row.requestTime, credit: row.credit, requestId: row.requestId })));
    received += body.data.length; check(received <= total);
    if (received === total) return { accountKey: auth.accountKey, usage: aggregateUsage(pages, range, now()) };
    check(body.data.length === 100);
  }
  fail('USAGE_INCOMPLETE');
}
module.exports = { readWorkBuddyUsage, aggregateUsage, usageRange, createCookieJar };
