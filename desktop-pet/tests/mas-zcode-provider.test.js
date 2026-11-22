const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash, createCipheriv, randomBytes } = require('node:crypto');
const { createMasZcodeProvider } = require('../lib/mas-zcode-provider');
const { createZcodeCompanion } = require('../lib/zcode-companion');
const NOW = 1793390400000;
function encrypt(value, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
function fixture(t, { team = false, encrypted = false, key = true, fetch, credentialContext } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-zcode-provider-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, '.zcode'), v2 = path.join(root, 'v2'); fs.mkdirSync(v2, { recursive: true });
  const family = 'bigmodel', kind = team ? 'team-coding-plan' : 'individual-coding-plan';
  const raw = { 'oauth:active_provider': family, zcodejwttoken: 'synthetic-jwt',
    'oauth:bigmodel:access_token': 'synthetic-oauth', 'oauth:bigmodel:user_info': JSON.stringify({ user_id: 'synthetic-user' }) };
  const parts = team ? ['team', `account:${family}-${kind}`, 'product', 'organization', 'project'].map(encodeURIComponent).join(':')
    : `coding-plan:account:${family}-${kind}`;
  if (key) raw[`account-provider:${parts}:account:synthetic-user:api-key`] = 'synthetic-plan-key';
  credentialContext ||= { home };
  const secret = credentialContext.secret || `zcode-credential-fallback:${credentialContext.platform || os.platform()}:${credentialContext.home || os.userInfo().homedir}:${credentialContext.username || os.userInfo().username}`;
  const writeCredentials = value => fs.writeFileSync(path.join(v2, 'credentials.json'), JSON.stringify(encrypted
    ? Object.fromEntries(Object.entries(value).map(([name, material]) => [name, encrypt(material, secret)])) : value));
  writeCredentials(raw);
  fs.writeFileSync(path.join(v2, 'setting.json'), JSON.stringify({ providerFamilyDomain: family,
    providerFamilyConnectionSelections: { [family]: { kind, ...(team ? { productId: 'product', organizationId: 'organization', projectId: 'project' } : {}) } } }));
  const scopes = []; let selected = root;
  const directoryAccess = { withAccess: async (provider, operation) => {
    assert.equal(provider, 'zcode'); scopes.push('start');
    try { return await operation(selected); } finally { scopes.push('stop'); }
  } };
  const requests = [];
  const provider = createMasZcodeProvider({ directoryAccess, now: () => NOW, credentialContext,
    fetch: fetch || (async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200,
        data: { planName: 'Fixture Coding', limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 20,
          nextResetTime: NOW + 3600000, usage: 1000, remaining: 800 }] } }) };
    }) });
  return { home, root, v2, raw, writeCredentials, scopes, requests, provider,
    select: value => { selected = value; } };
}
function makeIndex(file, rows) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE tasks(task_id TEXT,title TEXT,task_status TEXT,provider TEXT,updated_at INTEGER,cli_updated_at INTEGER,cli_last_outcome TEXT,deleted INTEGER,archived INTEGER)');
  const insert = db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,0,0)');
  for (const row of rows) insert.run(row.id, row.title || row.id, row.status, row.provider || 'zcode', NOW - 100, NOW - 100, null);
  db.close();
}
function makeRuntime(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session(id TEXT,title TEXT,time_deleted INTEGER,time_archived INTEGER);
    CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER);
    INSERT INTO session VALUES('runtime-running','current running',NULL,NULL),('runtime-done','done',NULL,NULL);
    INSERT INTO turn_usage VALUES('runtime-running','turn-running','running',${NOW - 10},NULL),
      ('runtime-done','turn-done','completed',${NOW - 200},${NOW - 20});`);
  db.close();
}

test('使用明确选择的.zcode读取加密账户，以显式真实主目录作为cipher上下文且不修改文件', async t => {
  const f = fixture(t, { encrypted: true });
  const before = fs.readFileSync(path.join(f.v2, 'credentials.json'));
  const account = await f.provider.readAccount();
  assert.equal(account.family, 'bigmodel'); assert.equal(account.selection.scope, 'personal');
  assert.equal(account.codingPlanApiKey, 'synthetic-plan-key');
  assert.deepEqual(fs.readFileSync(path.join(f.v2, 'credentials.json')), before);
  assert.deepEqual(f.scopes, ['start', 'stop']);
  f.select(f.home);
  await assert.rejects(f.provider.readAccount(), { code: 'ZCODE_DIRECTORY_REQUIRED' });
});

test('自定义数据目录不替代真实用户主目录，沙盒读取只在授权目录内', async t => {
  const credentialContext = { home: '/Users/fixture-real-user', username: 'fixture-user', platform: 'darwin' };
  const f = fixture(t, { encrypted: true, credentialContext });
  assert.notEqual(path.dirname(f.root), credentialContext.home);
  const account = await f.provider.readAccount();
  assert.equal(account.codingPlanApiKey, 'synthetic-plan-key');
  assert.deepEqual(f.scopes, ['start', 'stop']);
});

test('默认cipher上下文取OS用户主目录，不取授权目录父路径或容器HOME', async t => {
  const f = fixture(t, { encrypted: true, credentialContext: {
    home: os.userInfo().homedir, username: os.userInfo().username, platform: os.platform()
  } });
  const provider = createMasZcodeProvider({ directoryAccess: { withAccess: (_provider, operation) => operation(f.root) } });
  assert.notEqual(path.dirname(f.root), os.userInfo().homedir);
  assert.equal((await provider.readAccount()).codingPlanApiKey, 'synthetic-plan-key');
});

test('MAS不借用未绑定账户的config key，旧账户切换和损坏config都不污染当前身份', async t => {
  const f = fixture(t, { key: false });
  fs.writeFileSync(path.join(f.v2, 'config.json'), JSON.stringify({ provider: {
    'builtin:bigmodel-coding-plan': { enabled: true, options: {
      apiKey: 'previous-personal-key', baseURL: 'https://open.bigmodel.cn/api/anthropic'
    } }
  } }));
  const before = await f.provider.readAccount();
  assert.equal(before.codingPlanApiKey, null);
  f.raw['oauth:bigmodel:user_info'] = JSON.stringify({ user_id: 'new-user' }); f.writeCredentials(f.raw);
  const switched = await f.provider.readAccount();
  assert.notEqual(switched.accountKey, before.accountKey); assert.equal(switched.codingPlanApiKey, null);
  await assert.rejects(f.provider.fetchUsage(switched), { code: 'ZCODE_USAGE_UNAVAILABLE' });
  assert.equal(f.requests.length, 0);
  fs.writeFileSync(path.join(f.v2, 'config.json'), '{broken');
  assert.equal((await f.provider.readAccount()).accountKey, switched.accountKey);
});

test('个人quota仅GET，复用已有套餐key，不触发新模型或付费API', async t => {
  const f = fixture(t);
  const account = await f.provider.readAccount();
  const quota = await f.provider.fetchUsage(account);
  assert.equal(quota.buckets.length, 1); assert.equal(quota.buckets[0].remaining, 80);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(f.requests[0].init.method, 'GET');
  assert.equal(f.requests[0].init.headers.Authorization, 'Bearer synthetic-plan-key');
});

function appFixture(f, version = '3.18.2') {
  const directory = path.join(f.home, 'ZCode.app'); fs.mkdirSync(path.join(directory, 'Contents'), { recursive: true });
  const file = path.join(directory, 'Contents/Info.plist');
  const writeVersion = value => fs.writeFileSync(file, `<plist><dict><key>CFBundleShortVersionString</key><string>${value}</string></dict></plist>`);
  writeVersion(version);
  return { directory: fs.realpathSync(directory), file, writeVersion };
}

test('额度按已授权官方App的当前版本查询，持有两项scope且每轮重读版本', async t => {
  const f = fixture(t, { key: false }), app = appFixture(f), events = [], urls = [];
  fs.writeFileSync(path.join(f.v2, 'telemetry-state.json'), JSON.stringify({ deviceMid: 'synthetic-mid' }));
  const access = (label, directory) => ({ acquire: async provider => {
    assert.equal(provider, 'zcode'); events.push(`${label}:start`);
    return { directory, isCurrent: () => true, release: () => events.push(`${label}:stop`) };
  } });
  const provider = createMasZcodeProvider({ directoryAccess: access('account', f.root), installedAppAccess: access('app', app.directory),
    credentialContext: { home: f.home }, now: () => NOW, fetch: async url => {
      events.push('fetch'); urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { balances: [], plans: [] } }) };
    } });
  const account = await provider.readAccount(); events.length = 0;
  await provider.fetchUsage(account, { appVersion: '1.0.0' });
  assert.match(urls[0], /\?app_version=3\.18\.2$/);
  assert.deepEqual(events, ['account:start', 'app:start', 'fetch', 'app:stop', 'account:stop']);
  app.writeVersion('3.18.3'); await provider.fetchUsage(account);
  assert.match(urls[1], /\?app_version=3\.18\.3$/);
});

test('App或账号scope在GET中被撤销时丢弃迟到结果并释放scope', async t => {
  for (const revoked of ['app', 'account']) {
    const f = fixture(t), app = appFixture(f), released = [];
    const current = { app: true, account: true }; let finish;
    const access = (label, directory) => ({ acquire: async () => ({ directory,
      isCurrent: () => current[label], release: () => released.push(label) }) });
    const provider = createMasZcodeProvider({ directoryAccess: access('account', f.root), installedAppAccess: access('app', app.directory),
      credentialContext: { home: f.home }, now: () => NOW, fetch: () => new Promise(resolve => { finish = resolve; }) });
    const account = await provider.readAccount(); released.length = 0;
    const pending = provider.fetchUsage(account); await new Promise(resolve => setImmediate(resolve));
    current[revoked] = false;
    finish({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: { limits: [] } }) });
    await assert.rejects(pending, { code: 'DISCONNECTED' });
    assert.deepEqual(released, ['app', 'account']);
  }
});

test('取消或无效App版本不发送额度请求，App目录外的plist不能供应版本', async t => {
  const f = fixture(t), app = appFixture(f, 'invalid'), controller = new AbortController();
  let acquisitions = 0, released = 0, requests = 0;
  const provider = createMasZcodeProvider({ directoryAccess: { withAccess: (_provider, operation) => operation(f.root) },
    installedAppAccess: { acquire: async () => { acquisitions++; return { directory: app.directory, release: () => released++ }; } },
    credentialContext: { home: f.home }, fetch: () => { requests++; } });
  const account = await provider.readAccount(); controller.abort();
  await assert.rejects(provider.fetchUsage(account, { signal: controller.signal }), { code: 'DISCONNECTED' });
  assert.equal(acquisitions, 0);
  await assert.rejects(provider.fetchUsage(account), { code: 'ZCODE_APP_VERSION_UNAVAILABLE' });
  assert.equal(released, 1); assert.equal(requests, 0);
  const outside = path.join(f.home, 'outside.plist');
  fs.writeFileSync(outside, '<key>CFBundleShortVersionString</key><string>3.18.2</string>');
  fs.unlinkSync(app.file); fs.symlinkSync(outside, app.file);
  await assert.rejects(provider.fetchUsage(account), { code: 'ZCODE_APP_VERSION_UNAVAILABLE' });
  assert.equal(released, 2); assert.equal(requests, 0);
});

test('团队quota保留组织/项目和团队套餐key，缺key不降级个人也不mint token', async t => {
  const f = fixture(t, { team: true });
  const account = await f.provider.readAccount();
  assert.equal(account.selection.scope, 'team');
  const quota = await f.provider.fetchUsage(account);
  assert.match(quota.buckets[0].planName, /团队/);
  assert.equal(f.requests[0].url, 'https://bigmodel.cn/api/monitor/usage/quota/limit?type=2');
  assert.equal(f.requests[0].init.headers['Bigmodel-Organization'], 'organization');
  assert.equal(f.requests[0].init.headers['Bigmodel-Project'], 'project');
  assert.equal(f.requests[0].init.headers.Authorization, 'synthetic-plan-key');
  const noKey = fixture(t, { team: true, key: false });
  await assert.rejects(noKey.provider.fetchUsage(await noKey.provider.readAccount()), { code: 'ZCODE_TEAM_KEY_MISSING' });
  assert.equal(noKey.requests.length, 0);
});

test('任务用node:sqlite只读缓存，最新running/waiting也不猜测active，终态证据保留', async t => {
  const f = fixture(t);
  const index = path.join(f.v2, 'tasks-index.sqlite'), runtime = path.join(f.root, 'cli/db/db.sqlite');
  makeIndex(index, [{ id: 'index-running', status: 'running' }, { id: 'index-waiting', status: 'waiting' },
    { id: 'index-done', status: 'completed' }, { id: 'foreign', provider: 'claude', status: 'running' }]);
  makeRuntime(runtime);
  const before = [index, runtime].map(file => fs.readFileSync(file));
  const tasks = await f.provider.readTasks({ account: await f.provider.readAccount() });
  assert.equal(tasks.state, 'unknown'); assert.equal(tasks.partial, true);
  assert.equal(tasks.activity.runningCount, null); assert.equal(tasks.accountAttributionVerified, false);
  assert.equal(tasks.items.length, 3);
  assert.ok(tasks.items.every(row => row.state === 'unknown' && row.liveVerified === false));
  assert.deepEqual(tasks.results.map(row => row.id).sort(), ['index-done', 'runtime-done']);
  assert.equal(tasks.results.find(row => row.id === 'runtime-done').turnId, 'turn-done');
  assert.deepEqual([index, runtime].map(file => fs.readFileSync(file)), before);
  assert.equal(JSON.stringify(tasks).includes(f.home), false);
});

test('没有缓存或空缓存都不宣称idle', async t => {
  const f = fixture(t);
  const missing = await f.provider.readTasks();
  assert.equal(missing.state, 'unknown'); assert.equal(missing.partial, true);
  assert.equal(missing.code, 'ZCODE_TASK_CACHE_UNAVAILABLE');
  makeIndex(path.join(f.v2, 'tasks-index.sqlite'), []);
  const empty = await f.provider.readTasks();
  assert.equal(empty.state, 'unknown'); assert.equal(empty.activity.runningCount, null);
});

test('拒绝授权外数据库及sidecar符号链接，不读取外部工具数据', async t => {
  const f = fixture(t);
  const outside = path.join(f.home, 'outside.sqlite'); makeIndex(outside, [{ id: 'outside', status: 'completed' }]);
  const index = path.join(f.v2, 'tasks-index.sqlite'); fs.symlinkSync(outside, index);
  await assert.rejects(f.provider.readTasks(), { code: 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY' });
  fs.unlinkSync(index); makeIndex(index, []);
  fs.symlinkSync(outside, index + '-wal');
  await assert.rejects(f.provider.readTasks(), { code: 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY' });
});

test('账户切换使旧请求失效，拒绝复用旧account查询新身份', async t => {
  const f = fixture(t);
  const first = await f.provider.readAccount();
  f.raw['oauth:bigmodel:user_info'] = JSON.stringify({ user_id: 'another-user' }); f.writeCredentials(f.raw);
  await assert.rejects(f.provider.fetchUsage(first), { code: 'ZCODE_LOGIN_REQUIRED' });
  assert.equal(f.requests.length, 0);
});

test('GET发出后切换官方账号，不返回旧账户额度', async t => {
  let finish;
  const f = fixture(t, { fetch: () => new Promise(resolve => { finish = resolve; }) });
  const account = await f.provider.readAccount();
  const pending = f.provider.fetchUsage(account); await new Promise(resolve => setImmediate(resolve));
  f.raw['oauth:bigmodel:user_info'] = JSON.stringify({ user_id: 'another-user' }); f.writeCredentials(f.raw);
  finish({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: 200, data: { limits: [] } }) });
  await assert.rejects(pending, { code: 'ZCODE_LOGIN_REQUIRED' });
});

test('v2官方runner只回安全账号和额度投影，provider不读取或透传原始凭据', async t => {
  const f = fixture(t), accountKey = 'a'.repeat(64), calls = [];
  fs.writeFileSync(path.join(f.v2, 'credentials.json'), JSON.stringify({ 'oauth:active_provider': 'enc:v2:os:synthetic' }));
  const account = { accountKey, family: 'zai', selection: { kind: 'individual-coding-plan', scope: 'personal' },
    hasJwtToken: true, accessToken: 'must-never-leave-runner' };
  const bucket = { sourceId: 'zcode', source: 'coding-plan', id: 'zcode:paid:CREDIT_LIMIT:3:5', bucketId: 'zcode:paid:CREDIT_LIMIT:3:5',
    label: 'Coding Plan 积分', planName: 'Fixture', remaining: 80, resetsAt: NOW + 3600000,
    periodStart: NOW - 4 * 3600000, windowMinutes: 300, periodKind: 'rolling', total: 100, remainingUnits: 80,
    unit: 'credits', privateKey: 'must-never-leave-runner' };
  const provider = createMasZcodeProvider({ directoryAccess: { withAccess: (_provider, operation) => operation(f.root) },
    now: () => NOW, run: async (operation, payload) => {
      calls.push(operation);
      if (operation === 'account-check') return account;
      assert.equal(operation, 'usage'); assert.deepEqual(payload, { expectedAccountKey: accountKey });
      return { accountKey, state: 'connected', buckets: [bucket], updatedAt: NOW, modelIds: [],
        balanceState: 'unavailable', paidState: 'connected', jwtToken: 'must-never-leave-runner' };
    } });
  const safeAccount = await provider.readAccount(), quota = await provider.fetchUsage(safeAccount);
  assert.equal(safeAccount.hasJwtToken, true); assert.equal(safeAccount.accessToken, undefined);
  assert.equal(quota.buckets[0].remaining, 80); assert.equal(quota.buckets[0].privateKey, undefined);
  assert.equal(JSON.stringify({ safeAccount, quota }).includes('must-never-leave-runner'), false);
  assert.deepEqual(calls, ['account-check', 'account-check', 'usage', 'account-check']);
  const tasks = await provider.readTasks({ account: safeAccount });
  assert.equal(tasks.state, 'unknown'); assert.equal(tasks.accountAttributionVerified, false);
});

test('官方runner迟到额度或任务缓存期间切账号都被丢弃', async t => {
  const f = fixture(t); let accountKey = 'a'.repeat(64), finish;
  const account = () => ({ accountKey, family: 'zai', selection: { kind: 'individual-coding-plan', scope: 'personal' } });
  const provider = createMasZcodeProvider({ directoryAccess: { withAccess: (_provider, operation) => {
    accountKey = 'b'.repeat(64); return operation(f.root);
  } }, run: async operation => operation === 'account-check' ? account() : new Promise(resolve => { finish = resolve; }) });
  const first = await provider.readAccount(), pending = provider.fetchUsage(first);
  await new Promise(resolve => setImmediate(resolve)); accountKey = 'b'.repeat(64);
  finish({ accountKey: first.accountKey, state: 'connected', buckets: [], updatedAt: NOW });
  await assert.rejects(pending, { code: 'ZCODE_LOGIN_REQUIRED' });
  accountKey = first.accountKey;
  await assert.rejects(provider.readTasks({ account: first }), { code: 'ZCODE_LOGIN_REQUIRED' });
});

test('对接真实createZcodeCompanion契约，unknown任务保持runningCount=null，聊天明确未打通', async t => {
  const f = fixture(t);
  makeIndex(path.join(f.v2, 'tasks-index.sqlite'), [{ id: 'index-running', status: 'running' }]);
  const companion = createZcodeCompanion({ ...f.provider.companionOptions, now: () => NOW });
  t.after(() => companion.close());
  await companion.setEnabled(true);
  const snapshot = companion.getSnapshot();
  assert.equal(snapshot.quota.state, 'connected'); assert.equal(snapshot.buckets[0].remaining, 80);
  assert.equal(snapshot.tasks.state, 'unknown'); assert.equal(snapshot.activity.runningCount, null);
  assert.equal(snapshot.tasks.items[0].state, 'unknown');
  const capabilities = f.provider.getCapabilities();
  assert.equal(capabilities.chat.available, false);
  assert.equal(capabilities.chat.code, 'ZCODE_MAS_CHAT_TRANSPORT_UNAVAILABLE');
  assert.equal(capabilities.quota.publicApiContractVerified, false);
  const safe = JSON.stringify(await f.provider.read());
  assert.equal(safe.includes('synthetic-plan-key'), false);
  assert.equal(safe.includes('synthetic-jwt'), false);
  assert.equal(safe.includes('synthetic-oauth'), false);
});

test('模块不依赖外部命令查询或聊天runtime', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/mas-zcode-provider.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?child_process['"]\)|\bspawn\(|\bexecFile\(|\/usr\/bin\/sqlite3|\/usr\/sbin\/lsof|\/bin\/ps/);
});
