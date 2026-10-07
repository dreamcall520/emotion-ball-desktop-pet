const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
function moduleApi() {
  const file = path.resolve(__dirname, '../lib/codex-rpc.js');
  assert.ok(fs.existsSync(file), '需要只读额度连接与有界JSONL解析');
  return require(file);
}
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 123456;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); return true; };
  return child;
}
function setup({ reply = () => ({}), timeoutMs = 100, installed = true, installedAt, ignoreThread,
  fetch = null, now = Date.now, historyTimeoutMs = 5000, readUsageHistory } = {}) {
  const child = fakeChild(); const sent = []; const probes = []; const launches = [];
  child.stdin.on('data', chunk => {
    const packet = JSON.parse(chunk);
    sent.push(packet);
    if (!Object.hasOwn(packet, 'id')) return;
    const result = reply(packet);
    if (result !== undefined) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: packet.id, ...result }) + '\n'));
  });
  const rpc = moduleApi().createCodexRpc({
    spawn: (...args) => { launches.push(args); return child; },
    fs: { promises: {
      lstat: async file => { probes.push(file); if (!installed || (installedAt && file !== installedAt)) throw Object.assign(new Error('SECRET'), { code: 'ENOENT' }); return { isFile: () => true, isSymbolicLink: () => false }; },
      access: async () => {}
    } }, homedir: () => '/private/test-user', timeoutMs, ignoreThread, fetch, now, historyTimeoutMs, readUsageHistory
  });
  return { rpc, child, sent, probes, launches };
}

test('导入和构造零探测；只在start探测8个固定安装路径', async () => {
  const h = setup({ installed: false });
  assert.equal(h.probes.length, 0); assert.equal(h.launches.length, 0);
  await assert.rejects(h.rpc.start(), { code: 'MISSING' });
  assert.deepEqual(h.probes, [
    '/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/private/test-user/Applications/Codex.app/Contents/Resources/codex', '/private/test-user/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/private/test-user/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/private/test-user/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
  ]);
  h.rpc.close();
});

test('兼容当前 ChatGPT.app 内置 Codex CLI 路径', async () => {
  const installedAt = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const h = setup({ installedAt, reply: () => ({ result: {} }) });
  await h.rpc.start();
  assert.equal(h.launches[0][0], installedAt);
  h.rpc.close();
});

test('历史传输缺失时原有四个只读方法与参数保持，额度仍可用', async () => {
  const h = setup({ reply: packet => ({ result: packet.method === 'account/read' ? { account: { type: 'chatgpt', email: 'person@example.test', planType: 'plus' } }
    : packet.method === 'thread/list' ? { data: [{ id: ID, name: '标题', source: 'vscode', preview: 'SECRET', turns: ['SECRET'] }] }
      : packet.method === 'account/rateLimits/read' ? { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 2000000000 } } } : {} }) });
  await h.rpc.start();
  const account = await h.rpc.readAccount();
  const quota = await h.rpc.readQuota(100);
  const threads = await h.rpc.listThreads();
  assert.deepEqual(h.launches[0].slice(0, 2), ['/Applications/Codex.app/Contents/Resources/codex', ['app-server', '--stdio']]);
  assert.deepEqual(h.sent.map(p => p.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'thread/list']);
  assert.deepEqual(h.sent[1], { method: 'initialized', params: {} });
  assert.deepEqual(h.sent[2].params, { refreshToken: false });
  assert.deepEqual(h.sent[4].params, { limit: 20, sortKey: 'updated_at', archived: false, sourceKinds: [], useStateDbOnly: true });
  assert.match(account.accountKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(account).includes('person@'), false);
  assert.equal(JSON.stringify(threads).includes('SECRET'), false);
  assert.equal(quota.windows[0].remaining, 85);
  assert.equal(h.rpc.request, undefined);
  h.rpc.close();
});

test('新发现任务用只读元数据分页定位，不受最近20条限制且不泄露正文', async () => {
  const h = setup({ reply: packet => {
    if (packet.method !== 'thread/list') return { result: {} };
    if (!packet.params.cursor) return { result: { data: [], nextCursor: 'page-two' } };
    return { result: { data: [{ id: ID, name: '分页任务', source: 'vscode', preview: 'SECRET', turns: ['SECRET'] }] } };
  } });
  await h.rpc.start();
  const result = await h.rpc.findThread(ID);
  const requests = h.sent.filter(packet => packet.method === 'thread/list');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].params, {
    limit: 100, sortKey: 'updated_at', archived: false, sourceKinds: [], useStateDbOnly: true
  });
  assert.deepEqual(requests[1].params, {
    limit: 100, sortKey: 'updated_at', archived: false, sourceKinds: [], useStateDbOnly: true, cursor: 'page-two'
  });
  assert.deepEqual(result, { id: ID, title: '分页任务', state: 'unknown', turnId: null, updatedAt: null, partial: true });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  h.rpc.close();
});

test('账号计划升级不改变身份hash；明确未登录才返回null身份', async () => {
  let plan = 'plus'; let accountPresent = true;
  const h = setup({ reply: p => ({ result: p.method === 'account/read' ? { account: accountPresent ? { type: 'chatgpt', email: 'same@example.test', planType: plan } : null, requiresOpenaiAuth: true } : {} }) });
  await h.rpc.start();
  const first = await h.rpc.readAccount(); plan = 'pro';
  assert.equal((await h.rpc.readAccount()).accountKey, first.accountKey);
  accountPresent = false;
  assert.deepEqual(await h.rpc.readAccount(), { accountKey: null, authenticated: false });
  h.rpc.close();
});

for (const type of ['apiKey', 'futureAccountType']) test(`成功确认${type}账号时返回安全unsupported结果，不读取或输出密钥身份`, async t => {
  const h = setup({ reply: p => ({ result: p.method === 'account/read' ? { account: { type, apiKey: 'SECRET_KEY', email: 'SECRET_EMAIL' } } : {} }) });
  t.after(() => h.rpc.close()); await h.rpc.start();
  const account = await h.rpc.readAccount();
  assert.deepEqual(account, { accountKey: null, authenticated: null, supported: false });
  assert.equal(JSON.stringify(account).includes('SECRET'), false);
  assert.equal(JSON.stringify(account).includes(type), false);
});

test('损坏或不完整的账号响应保持读取错误，不伪造确认的账号类型变化', async () => {
  for (const raw of [null, {}, { account: 'apiKey' }, { account: [] }, { account: {} }, { account: { type: '' } }, { account: { type: 'chatgpt' } }]) {
    const h = setup({ reply: p => ({ result: p.method === 'account/read' ? raw : {} }) });
    try { await h.rpc.start(); await assert.rejects(h.rpc.readAccount(), { code: 'UNSUPPORTED' }); }
    finally { h.rpc.close(); }
  }
});

test('真实子进程分片JSONL及多行响应被正确解析，stderr不输出', async () => {
  let processChild;
  const rpc = moduleApi().createCodexRpc({ fs: { promises: { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }), access: async () => {} } },
    spawn: () => {
      processChild = spawn(process.execPath, ['-e', `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const p=JSON.parse(line);if(!Object.hasOwn(p,'id'))return;const value=JSON.stringify({id:p.id,result:p.method==='account/read'?{account:{type:'chatgpt',email:'测试@example.test'}}:{}})+'\\n';process.stdout.write(value.slice(0,4));setImmediate(()=>process.stdout.write(value.slice(4)));});process.stderr.write('SECRET_STDERR');`], { stdio: ['pipe', 'pipe', 'pipe'] });
      return processChild;
    }, timeoutMs: 2000 });
  try {
    await rpc.start();
    assert.match((await rpc.readAccount()).accountKey, /^[a-f0-9]{64}$/);
  } finally { rpc.close(); }
});

for (const [raw, expected] of [[{ code: -32601, message: 'SECRET' }, 'UNSUPPORTED'], [{ code: 401, message: 'SECRET' }, 'UNAUTHENTICATED'], [{ code: 500, message: 'SECRET' }, 'DISCONNECTED']]) {
  test(`RPC错误 ${raw.code} 只返回固定码 ${expected}`, async () => {
    const h = setup({ reply: () => ({ error: raw }) });
    await assert.rejects(h.rpc.start(), error => error.code === expected && !JSON.stringify(error).includes('SECRET') && !error.message.includes('SECRET'));
    h.rpc.close();
  });
}

test('请求超时有界并拒绝多余并发请求', async () => {
  const h = setup({ timeoutMs: 20, reply: p => p.method === 'initialize' ? { result: {} } : undefined });
  await h.rpc.start();
  const pending = Array.from({ length: 4 }, () => h.rpc.readAccount());
  const settled = Promise.allSettled(pending);
  await assert.rejects(h.rpc.readAccount(), { code: 'BUSY' });
  assert.ok((await settled).every(result => result.reason.code === 'TIMEOUT'));
  h.rpc.close();
});

for (const payload of ['{invalid}\n', '{"id":1,"result":\n', '[]\n', 'x'.repeat(1025)]) {
  test(`非法JSON/过大行关闭自己进程（${payload.length}字节）`, async () => {
    const child = fakeChild();
    const rpc = moduleApi().createCodexRpc({ fs: { promises: { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }), access: async () => {} } }, spawn: () => child, maxFrameBytes: 1024, timeoutMs: 100 });
    const pending = rpc.start();
    await new Promise(resolve => setImmediate(resolve));
    child.stdout.write(payload);
    await assert.rejects(pending, { code: 'INVALID_FRAME' });
    assert.equal(child.kills.length, 1);
    rpc.close();
  });
}

test('close拒绝在途请求、移除监听，只终止自己进程并忽略晚到响应', async () => {
  const h = setup({ reply: p => p.method === 'initialize' ? { result: {} } : undefined });
  await h.rpc.start();
  const pending = h.rpc.readQuota(100);
  h.rpc.close(); h.rpc.close();
  await assert.rejects(pending, { code: 'CLOSED' });
  h.child.stdout.write(JSON.stringify({ id: h.sent.at(-1).id, result: { token: 'SECRET' } }) + '\n');
  assert.equal(h.child.kills.length, 1);
  assert.equal(h.child.stdout.listenerCount('data'), 0);
  assert.equal(h.child.listenerCount('exit'), 0);
});

test('关闭发生在安装探测未结束时，不得后来创建进程', async () => {
  let finish; let launches = 0;
  const rpc = moduleApi().createCodexRpc({ fs: { promises: { lstat: () => new Promise(resolve => { finish = resolve; }), access: async () => {} } }, spawn: () => { launches++; return fakeChild(); } });
  const pending = rpc.start();
  rpc.close();
  finish({ isFile: () => true, isSymbolicLink: () => false });
  await assert.rejects(pending, { code: 'CLOSED' });
  assert.equal(launches, 0);
});

test('关闭与进程创建失败同时发生时，迟到原生error被安全收尾', async () => {
  let processChild;
  const rpc = moduleApi().createCodexRpc({
    fs: { promises: { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }), access: async () => {} } },
    spawn: () => {
      processChild = spawn('/emotion-ball-test-nonexistent-binary', [], { stdio: ['pipe', 'pipe', 'pipe'] });
      queueMicrotask(() => rpc.close());
      return processChild;
    }
  });
  await assert.rejects(rpc.start(), { code: 'CLOSED' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(processChild.listenerCount('error'), 0);
});

for (const method of ['listThreads', 'findThread']) test(method + ' 在移除 cwd 前过滤球球专用 workspace，外部任务正常返回', async t => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  const workspace = '/fixture/chat-workspace';
  const seen = [];
  const h = setup({ ignoreThread: row => { seen.push(row.cwd); return row.cwd === workspace; }, reply: packet => ({ result:
    packet.method === 'thread/list' ? { data: [
      { id: ID, cwd: workspace, name: '自己的聊天', source: 'vscode' },
      { id: otherId, cwd: '/other/project', name: '外部工作', source: 'vscode' }
    ] } : {} }) });
  t.after(() => h.rpc.close());
  await h.rpc.start();
  if (method === 'listThreads') {
    const rows = await h.rpc.listThreads();
    assert.deepEqual(rows.map(row => row.id), [otherId]);
    assert.equal(Object.hasOwn(rows[0], 'cwd'), false);
  } else {
    assert.equal(await h.rpc.findThread(ID), null);
    assert.equal((await h.rpc.findThread(otherId)).id, otherId);
  }
  assert.ok(seen.includes(workspace));
});

const HISTORY_NOW = Date.parse('2026-10-05T02:00:00Z');
const historyEvent = (id, kind = 'granted') => ({ id, kind, occurred_at: '2026-10-04T01:00:00Z', token: 'SECRET_EVENT_TOKEN', description: 'SECRET_DESCRIPTION' });
function historyFixture({ accountId = () => 'account-a', backendOrigin = 'https://chatgpt.com', auth, ...options } = {}) {
  return setup({ now: () => HISTORY_NOW, ...options, reply: packet => {
    if (packet.method === 'account/read') return { result: { account: { type: 'chatgpt', email: 'person@example.test' },
      workspaceRouting: { chatgptAccountId: accountId(), backendOrigin, accountRoutingOverride: 'NO_CONSTRAINT' } } };
    if (packet.method === 'getAuthStatus') {
      if (auth) return auth(packet);
      const claims = { 'https://api.openai.com/auth': { chatgpt_account_id: accountId() }, 'https://api.openai.com/profile': { email: 'person@example.test' } };
      return { result: { authMethod: 'chatgpt', authToken: `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SECRET_BEARER` } };
    }
    if (packet.method === 'account/rateLimits/read') return { result: { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 2000000000 } }, rateLimitResetCredits: { availableCount: 0, credits: [] } } };
    return { result: {} };
  } });
}
const historyResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('本地额度历史仅扫描当前账户周期一次，重置秒级抖动不重扫，换账户重新读取', async t => {
  let account = 'account-a'; let reset = Math.floor(HISTORY_NOW / 1000) + 18000;
  const calls = [];
  const h = setup({ now: () => HISTORY_NOW, readUsageHistory: async options => {
    calls.push(options);
    return [{ at: HISTORY_NOW - 60000, id: 'codex:primary', windowMinutes: 300,
      resetsAt: options.windows[0].resetsAt, remaining: 86 }];
  }, reply: packet => ({ result: packet.method === 'account/read'
    ? { account: { type: 'chatgpt', email: 'person@example.test' }, workspaceRouting: { chatgptAccountId: account } }
    : packet.method === 'account/rateLimits/read'
      ? { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: reset } } } : {} }) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  assert.equal((await h.rpc.readQuota(HISTORY_NOW)).historySamples.length, 1);
  assert.equal((await h.rpc.readQuota(HISTORY_NOW)).historySamples, undefined);
  reset++; await h.rpc.readQuota(HISTORY_NOW); assert.equal(calls.length, 1);
  reset += 18000; await h.rpc.readQuota(HISTORY_NOW); assert.equal(calls.length, 2);
  account = 'account-b'; await h.rpc.readAccount(); await h.rpc.readQuota(HISTORY_NOW);
  assert.deepEqual(calls.map(call => call.accountId), ['account-a', 'account-a', 'account-b']);
  assert.equal(calls[0].root, '/private/test-user/.codex');
  assert.equal(calls[0].now, HISTORY_NOW);
});

test('本地历史迟到结果不能跨账户；读取失败和缺失工作区身份不影响实时额度', async t => {
  let account = 'account-a'; let finish; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const h = historyFixture({ accountId: () => account, readUsageHistory: () => {
    entered(); return new Promise(resolve => { finish = resolve; });
  } });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const pending = h.rpc.readQuota(HISTORY_NOW); await started;
  account = 'account-b'; await h.rpc.readAccount();
  finish([{ at: HISTORY_NOW, id: 'codex:primary', windowMinutes: 300, resetsAt: 2000000000000, remaining: 85 }]);
  await assert.rejects(pending, { code: 'DISCONNECTED' });
  const failed = historyFixture({ readUsageHistory: async () => { throw new Error('unreadable'); } });
  t.after(() => failed.rpc.close()); await failed.rpc.start(); await failed.rpc.readAccount();
  const quota = await failed.rpc.readQuota(HISTORY_NOW);
  assert.equal(quota.windows[0].remaining, 85); assert.equal(quota.historySamples, undefined);
  let reads = 0;
  const unknown = setup({ readUsageHistory: () => { reads++; return []; }, reply: packet => ({ result:
    packet.method === 'account/read' ? { account: { type: 'chatgpt', email: 'person@example.test' } }
      : packet.method === 'account/rateLimits/read' ? { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 2000000000 } } } : {} }) });
  t.after(() => unknown.rpc.close()); await unknown.rpc.start(); await unknown.rpc.readAccount();
  assert.equal((await unknown.rpc.readQuota(HISTORY_NOW)).windows[0].remaining, 85);
  assert.equal(reads, 0);
});

test('账户历史只GET固定官方路径、瞬时认证、分页去重并缓存，零可用仍展示获得和使用事件', async t => {
  let time = HISTORY_NOW; const calls = [];
  const h = historyFixture({ now: () => time, fetch: async (url, options) => {
    calls.push({ url, options });
    return historyResponse(calls.length % 2 ? { events: [historyEvent('grant')], next_cursor: 'next +/&' }
      : { events: [historyEvent('grant'), historyEvent('use','redeemed')], next_cursor: null });
  } });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const quota = await h.rpc.readQuota(time);
  assert.equal(quota.resetCreditsAvailable,0);
  assert.equal(quota.accountResetHistory.state,'ready');
  assert.deepEqual(quota.accountResetHistory.events.map(event => event.kind),['granted','redeemed']);
  assert.equal(JSON.stringify(quota).includes('SECRET'),false);
  assert.deepEqual(h.sent.find(packet => packet.method === 'getAuthStatus').params,{ includeToken:true,refreshToken:false });
  assert.equal(h.rpc.getAuthStatus,undefined);
  assert.equal(calls[0].url,'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/history');
  assert.equal(new URL(calls[1].url).searchParams.get('cursor'),'next +/&');
  for (const {url,options} of calls) {
    assert.equal(new URL(url).origin,'https://chatgpt.com'); assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store');
    assert.equal(options.headers['ChatGPT-Account-Id'],'account-a');
    assert.match(options.headers.Authorization,/^Bearer fixture\./);
  }
  quota.accountResetHistory.events[0].kind = 'redeemed';
  const cached = await h.rpc.readQuota(time);
  assert.equal(cached.accountResetHistory.events[0].kind,'granted'); assert.equal(calls.length,2);
  time += 120000; await h.rpc.readQuota(time); assert.equal(calls.length,4);
});

test('账户history实际wire granted/used及ISO微秒结构完整投影为ready四条', async t => {
  const h = historyFixture({fetch:async () => historyResponse({events:[
    {id:'fixture-grant-1',kind:'granted',occurred_at:'2026-10-01T01:02:03.688749Z'},
    {id:'fixture-use-1',kind:'used',occurred_at:'2026-09-30T04:05:06.761799Z'},
    {id:'fixture-use-2',kind:'used',occurred_at:'2026-09-25T07:08:09.515618Z'},
    {id:'fixture-grant-2',kind:'granted',occurred_at:'2026-09-23T10:11:12.111611Z'}],
    window_start:'2026-09-05T02:00:00Z',as_of:'2026-10-05T02:00:00Z',next_cursor:null})});
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const quota = await h.rpc.readQuota(HISTORY_NOW);
  assert.equal(quota.accountResetHistory.state,'ready'); assert.equal(quota.accountResetHistory.events.length,4);
  assert.equal(quota.accountResetHistory.events.filter(row => row.kind === 'granted').length,2);
  assert.equal(quota.accountResetHistory.events.filter(row => row.kind === 'redeemed').length,2);
  assert.deepEqual(Object.keys(quota.accountResetHistory.events[0]),['id','kind','occurredAt']);
});

test('不支持auth、401与超时保持额度成功，历史未同步不能当作成功空记录', async t => {
  for (const [kind,expected] of [['unsupported','UNSUPPORTED'],['401','UNAUTHENTICATED'],['timeout','TIMEOUT']]) {
    let calls = 0;
    const h = historyFixture({ historyTimeoutMs:20,
      auth: kind === 'unsupported' ? () => ({ error:{code:-32601,message:'SECRET'} }) : undefined,
      fetch: async () => { calls++; if (kind === 'timeout') return new Promise(() => {}); return new Response('SECRET',{status:401}); } });
    try {
      await h.rpc.start(); await h.rpc.readAccount(); const quota = await h.rpc.readQuota(HISTORY_NOW);
      assert.equal(quota.windows[0].remaining,85); assert.equal(quota.accountResetHistory.code,expected);
      assert.notEqual(quota.accountResetHistory.state,'ready'); assert.equal(JSON.stringify(quota).includes('SECRET'),false);
      assert.equal(calls,kind === 'unsupported' ? 0 : 1);
    } finally { h.rpc.close(); }
  }
});

test('历史分页重复cursor、10页和200事件上限保留partial且不无限请求', async t => {
  for (const kind of ['repeat','pages','events']) {
    let calls = 0;
    const h = historyFixture({ fetch: async () => {
      calls++;
      return historyResponse({ events: kind === 'events' ? Array.from({length:201},(_,i) => historyEvent(`e-${i}`)) : [historyEvent(`e-${calls}`)],
        next_cursor: kind === 'repeat' ? 'same' : `page-${calls}` });
    } });
    try {
      await h.rpc.start(); await h.rpc.readAccount(); const history = (await h.rpc.readQuota(HISTORY_NOW)).accountResetHistory;
      assert.equal(history.state,'partial'); assert.equal(calls,kind === 'repeat' ? 2 : kind === 'pages' ? 10 : 1);
      assert.ok(history.events.length <= 200);
    } finally { h.rpc.close(); }
  }
});

test('历史第二页失败保留已读取部分，首次明确空结果才是ready零记录', async t => {
  let calls = 0;
  const h = historyFixture({ fetch: async () => ++calls === 1
    ? historyResponse({events:[historyEvent('grant')],next_cursor:'next'}) : new Response('',{status:500}) });
  t.after(() => h.rpc.close()); await h.rpc.start(); await h.rpc.readAccount();
  const partial = (await h.rpc.readQuota(HISTORY_NOW)).accountResetHistory;
  assert.equal(partial.state,'partial'); assert.equal(partial.events.length,1); assert.equal(partial.code,'DISCONNECTED');
  const empty = historyFixture({fetch:async () => historyResponse({events:[],next_cursor:null})});
  t.after(() => empty.rpc.close()); await empty.rpc.start(); await empty.rpc.readAccount();
  assert.equal((await empty.rpc.readQuota(HISTORY_NOW)).accountResetHistory.state,'ready');
});

test('重定向、非固定backendOrigin和过大/畸形历史响应不发送跨域凭据或影响额度', async t => {
  for (const kind of ['origin','redirect','oversize','invalid']) {
    let calls = 0;
    const h = historyFixture({ backendOrigin:kind === 'origin' ? 'https://other.example.test' : 'https://chatgpt.com', fetch:async () => {
      calls++;
      if (kind === 'redirect') { const response = historyResponse({events:[]}); Object.defineProperty(response,'redirected',{value:true}); return response; }
      if (kind === 'oversize') return new Response('x',{headers:{'Content-Length':String(256*1024+1)}});
      return historyResponse({token:'SECRET',events:'invalid'});
    } });
    try {
      await h.rpc.start(); await h.rpc.readAccount(); const quota = await h.rpc.readQuota(HISTORY_NOW);
      assert.equal(quota.windows[0].remaining,85); assert.notEqual(quota.accountResetHistory.state,'ready');
      assert.equal(calls,kind === 'origin' ? 0 : 1); assert.equal(JSON.stringify(quota).includes('SECRET'),false);
    } finally { h.rpc.close(); }
  }
});

test('账户切换与close立即丢弃在途历史，工作区切换清除缓存且不串记录', async t => {
  for (const closing of [false,true]) {
    let account = 'account-a', entered, finish;
    const started = new Promise(resolve => { entered = resolve; });
    const h = historyFixture({ accountId:() => account, fetch:() => { entered(); return new Promise(resolve => { finish = resolve; }); } });
    t.after(() => h.rpc.close()); await h.rpc.start(); const first = await h.rpc.readAccount();
    const pending = h.rpc.readQuota(HISTORY_NOW); await started;
    if (closing) h.rpc.close();
    else { account = 'account-b'; assert.notEqual((await h.rpc.readAccount()).accountKey,first.accountKey); }
    await assert.rejects(pending,{code:closing ? 'CLOSED' : 'DISCONNECTED'});
    finish(historyResponse({events:[historyEvent('old-account')]}));
  }
});

test('bearer中的账户与workspaceRouting不一致时不请求历史', async t => {
  let calls = 0;
  const claims = {'https://api.openai.com/auth':{chatgpt_account_id:'other-account'}};
  const h = historyFixture({ auth:() => ({result:{authMethod:'chatgpt',authToken:`fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SECRET`}}),fetch:async () => {calls++;return historyResponse({events:[]});} });
  t.after(() => h.rpc.close());await h.rpc.start();await h.rpc.readAccount();
  const quota = await h.rpc.readQuota(HISTORY_NOW);
  assert.equal(calls,0);assert.equal(quota.accountResetHistory.code,'UNAUTHENTICATED');assert.equal(quota.windows[0].remaining,85);
});

test('token profile email与account/read不匹配拒绝历史，额度保持可用', async t => {
  let calls = 0;
  const claims = {'https://api.openai.com/auth':{chatgpt_account_id:'account-a'},'https://api.openai.com/profile':{email:'other@example.test'}};
  const h = historyFixture({auth:() => ({result:{authMethod:'chatgpt',authToken:`fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SECRET`}}),fetch:async () => {calls++;return historyResponse({events:[]});}});
  t.after(() => h.rpc.close());await h.rpc.start();await h.rpc.readAccount();
  const quota = await h.rpc.readQuota(HISTORY_NOW);
  assert.equal(calls,0);assert.equal(quota.accountResetHistory.code,'UNAUTHENTICATED');assert.equal(quota.windows[0].remaining,85);
});

test('旧CLI无workspaceRouting/email claim时用前后account/read核身份，跨账户迟到事件不进入快照', async t => {
  let email = 'person@example.test', switchAfterFetch = false, reads = 0, time = HISTORY_NOW;
  const claims = {'https://api.openai.com/auth':{chatgpt_account_id:'account-a'}};
  const h = setup({now:() => time,reply:packet => {
    if (packet.method === 'account/read') {reads++;return {result:{account:{type:'chatgpt',email}}};}
    if (packet.method === 'getAuthStatus') return {result:{authMethod:'chatgpt',authToken:`fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SECRET`}};
    if (packet.method === 'account/rateLimits/read') return {result:{rateLimits:{primary:{usedPercent:15,windowDurationMins:300,resetsAt:2000000000}}}};
    return {result:{}};
  },fetch:async () => {if(switchAfterFetch)email='other@example.test';return historyResponse({events:[historyEvent('grant')]});}});
  t.after(() => h.rpc.close());await h.rpc.start();await h.rpc.readAccount();
  assert.equal((await h.rpc.readQuota(HISTORY_NOW)).accountResetHistory.events.length,1);assert.equal(reads,3);
  switchAfterFetch = true;
  time += 120000;
  await assert.rejects(h.rpc.readQuota(time),{code:'DISCONNECTED'});
});
