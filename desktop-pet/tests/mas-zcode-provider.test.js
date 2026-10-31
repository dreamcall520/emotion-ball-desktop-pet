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
  const secret = `zcode-credential-fallback:${os.platform()}:${home}:${os.userInfo().username}`;
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

test('使用明确选择的.zcode读取加密账户，以来源父路径作为cipher上下文且不修改文件', async t => {
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
