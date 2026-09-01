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
function setup({ reply = () => ({}), timeoutMs = 100, installed = true } = {}) {
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
      lstat: async file => { probes.push(file); if (!installed) throw Object.assign(new Error('SECRET'), { code: 'ENOENT' }); return { isFile: () => true, isSymbolicLink: () => false }; },
      access: async () => {}
    } }, homedir: () => '/private/test-user', timeoutMs
  });
  return { rpc, child, sent, probes, launches };
}

test('导入和构造零探测；只在start探测4个固定安装路径', async () => {
  const h = setup({ installed: false });
  assert.equal(h.probes.length, 0); assert.equal(h.launches.length, 0);
  await assert.rejects(h.rpc.start(), { code: 'MISSING' });
  assert.deepEqual(h.probes, [
    '/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/private/test-user/Applications/Codex.app/Contents/Resources/codex', '/private/test-user/Applications/ChatGPT.app/Contents/Resources/codex'
  ]);
  h.rpc.close();
});

test('只开放四个只读方法并固定敏感参数，不请求历史', async () => {
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
