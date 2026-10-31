const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { startZcodeLocalChatService } = require('../scripts/start-zcode-local-chat-service');
const { createZcodeChatWsRpc } = require('../lib/zcode-chat-ws-rpc');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-host-tests-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const calls = [], statuses = []; let hostOptions, rpcCount = 0, accountKey = 'c'.repeat(64);
  const service = await startZcodeLocalChatService({ temporaryRoot, hostHome: '/synthetic/user',
    env: { SYNTHETIC_ONLY: '1' }, onStatus: status => statuses.push(status),
    createRpc: context => {
      hostOptions = context; rpcCount++;
      return { start: async () => { calls.push(['start']); }, close: async () => { calls.push(['close']); },
        readAccount: async () => ({ authenticated: true, accountKey }),
        listModels: async () => { calls.push(['models']); if (options.modelsError) throw Object.assign(new Error('secret-account-material'), { code: options.modelsError });
          return [{ id: 'synthetic-zcode-model', displayName: 'Synthetic', defaultReasoningEffort: 'none', supportedReasoningEfforts: ['none'] }]; },
        startThread: async () => { calls.push(['create']); return { id: 'owned-thread', status: 'idle', activeTurnId: null }; },
        resumeThread: async id => { calls.push(['resume', id]); return { id, status: 'idle', activeTurnId: null }; },
        startTurn: async (id, text, selection) => {
          calls.push(['turn', id, text, selection]);
          context.onNotification({ method: 'turn/started', params: { threadId: id, turn: { id: 'owned-turn', status: 'inProgress' } } });
          context.onNotification({ method: 'item/agentMessage/delta', params: { threadId: id, turnId: 'owned-turn', delta: '合成回复' } });
          context.onNotification({ method: 'turn/completed', params: { threadId: id, turn: { id: 'owned-turn', status: 'completed' } } });
          return { id: 'owned-turn', status: 'inProgress' };
        }, interruptTurn: async (id, turnId) => { calls.push(['interrupt', id, turnId]); }
      };
    } });
  t.after(async () => service.stop());
  const pairing = JSON.parse(fs.readFileSync(service.pairingFile, 'utf8'));
  const clients = [];
  function client(extra = {}) {
    const value = createZcodeChatWsRpc({ endpoint: pairing.endpoint, bearerToken: pairing.bearerToken, timeoutMs: 1000, ...extra });
    clients.push(value); return value;
  }
  t.after(async () => { await Promise.all(clients.map(value => value.close())); });
  return { service, pairing, calls, statuses, client, setAccountKey: value => { accountKey = value; }, hostOptions: () => hostOptions, rpcCount: () => rpcCount };
}
function rejectedHandshake(endpoint, headers) {
  return new Promise(resolve => {
    const socket = new WebSocket(endpoint, { headers });
    socket.on('open', () => { socket.close(); resolve(false); });
    socket.on('error', () => resolve(true));
  });
}

test('用户主动host仅监听随机loopback，临时700目录/600配对，ready不读取账号或模型', async t => {
  const f = await fixture(t);
  assert.match(f.service.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/zcode$/);
  assert.equal(fs.statSync(f.service.pairingDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.service.pairingFile).mode & 0o777, 0o600);
  assert.equal(f.pairing.provider, 'zcode'); assert.equal(f.pairing.version, 1);
  assert.ok(f.pairing.bearerToken.length >= 32);
  assert.equal(JSON.stringify(f.statuses).includes(f.pairing.bearerToken), false);
  assert.equal(f.rpcCount(), 0); assert.deepEqual(f.calls, []);
  const response = await fetch(`http://127.0.0.1:${f.service.port}/readyz`);
  assert.equal(response.status, 200);
  await f.service.stop(); assert.equal(fs.existsSync(f.service.pairingDirectory), false);
});

test('鉴权WS只接收正确header，拒绝错误token、浏览器Origin和URL token', async t => {
  const f = await fixture(t), auth = `Bearer ${f.pairing.bearerToken}`;
  assert.equal(await rejectedHandshake(f.service.endpoint, {}), true);
  assert.equal(await rejectedHandshake(f.service.endpoint, { Authorization: 'Bearer synthetic-wrong-token' }), true);
  assert.equal(await rejectedHandshake(f.service.endpoint, { Authorization: auth, Origin: 'https://example.invalid' }), true);
  assert.equal(await rejectedHandshake(f.service.endpoint + '?token=synthetic', { Authorization: auth }), true);
  assert.equal(f.rpcCount(), 0);
  const client = f.client(); await client.start(); assert.equal(f.rpcCount(), 1);
});

test('适配原RPC的账号/模型/会话/流式事件，专用workspace与原安全模块位于host', async t => {
  const f = await fixture(t), notifications = [];
  const client = f.client({ onNotification: packet => notifications.push(packet) });
  const first = client.start(); assert.equal(client.start(), first); await first;
  assert.deepEqual(await client.readAccount(), { authenticated: true, accountKey: 'c'.repeat(64) });
  const models = await client.listModels(); assert.equal(models[0].id, 'synthetic-zcode-model');
  const thread = await client.startThread();
  const turn = await client.startTurn(thread.id, '合成输入，不会触发真实模型', { model: models[0].id, effort: 'none' });
  assert.equal(turn.id, 'owned-turn'); await tick();
  assert.deepEqual(notifications.map(packet => packet.method), ['turn/started', 'item/agentMessage/delta', 'turn/completed']);
  await client.interruptTurn(thread.id, turn.id);
  assert.equal(typeof f.hostOptions().readAccount, 'function');
  assert.equal(f.hostOptions().home, '/synthetic/user');
  assert.equal(f.hostOptions().workspaceDir.startsWith(f.service.pairingDirectory + path.sep), true);
  assert.equal(f.hostOptions().env.SYNTHETIC_ONLY, '1');
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
  await assert.rejects(client.nameThread(thread.id, 'name'), { code: 'UNSUPPORTED' });
});

test('不能resume或向用户其他项目会话发消息，也不允许超长消息', async t => {
  const f = await fixture(t), client = f.client(); await client.start();
  await assert.rejects(client.resumeThread('foreign-thread'), { code: 'THREAD_NOT_OWNED' });
  await assert.rejects(client.startTurn('foreign-thread', 'synthetic', { model: 'synthetic-zcode-model', effort: 'none' }), { code: 'THREAD_NOT_OWNED' });
  await client.startThread();
  await assert.rejects(client.startTurn('owned-thread', 'x'.repeat(8001), { model: 'synthetic-zcode-model', effort: 'none' }), { code: 'INVALID_INPUT' });
  assert.equal(f.calls.some(call => call[0] === 'turn'), false);
});

test('真实空额度对应models unavailable必须原样报告，不替换付费API或伪造回复', async t => {
  const f = await fixture(t, { modelsError: 'MODELS_UNAVAILABLE' }), client = f.client();
  await client.start();
  await assert.rejects(client.listModels(), { code: 'MODELS_UNAVAILABLE', message: 'MODELS_UNAVAILABLE' });
  assert.equal(f.calls.some(call => call[0] === 'turn'), false);
  assert.equal(JSON.stringify(f.statuses).includes('secret-account-material'), false);
});

test('服务端不转发工具审批请求，未知通知使连接失败关闭', async t => {
  const f = await fixture(t); const disconnects = [], notifications = [];
  const client = f.client({ onDisconnect: code => disconnects.push(code), onNotification: packet => notifications.push(packet) });
  await client.start();
  f.hostOptions().onNotification({ id: 5, method: 'item/commandExecution/requestApproval', params: {} });
  for (let n = 0; n < 4; n++) await tick();
  assert.deepEqual(notifications, []);
  await assert.rejects(client.readAccount(), { code: 'CLOSED' });
  assert.ok(disconnects.length >= 1);
});

test('连接关闭只关闭自建RPC；服务停止清理配对并使旧连接不可用', async t => {
  const f = await fixture(t), client = f.client(); await client.start();
  await client.close(); for (let n = 0; n < 3; n++) await tick();
  assert.equal(f.calls.filter(call => call[0] === 'close').length, 1);
  assert.equal(fs.existsSync(f.service.pairingFile), true);
  const next = f.client(); await next.start();
  assert.equal(f.rpcCount(), 2);
  await f.service.stop(); await f.service.stop();
  assert.equal(fs.existsSync(f.service.pairingDirectory), false);
  await assert.rejects(next.readAccount());
});

test('client拒绝远端endpoint/无效token；已中止的启动不创建服务', async () => {
  assert.throws(() => createZcodeChatWsRpc({ endpoint: 'ws://example.invalid:1234', bearerToken: 'synthetic-capability-token' }));
  assert.throws(() => createZcodeChatWsRpc({ endpoint: 'ws://127.0.0.1:1234', bearerToken: 'short' }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startZcodeLocalChatService({ signal: controller.signal }), { code: 'STOPPED' });
});


test('host创建的线程绑定原账号，重连后账号变化不能借旧线程发消息或取消', async t => {
  const f = await fixture(t), first = f.client(); await first.start(); await first.startThread();
  await first.close(); for (let n = 0; n < 3; n++) await tick();
  f.setAccountKey('d'.repeat(64));
  const next = f.client(); await next.start();
  await assert.rejects(next.resumeThread('owned-thread'), { code: 'UNAUTHENTICATED' });
  await assert.rejects(next.startTurn('owned-thread', 'synthetic', { model: 'synthetic-zcode-model', effort: 'none' }), { code: 'UNAUTHENTICATED' });
  await assert.rejects(next.interruptTurn('owned-thread', 'owned-turn'), { code: 'UNAUTHENTICATED' });
  assert.equal(f.calls.some(call => call[0] === 'turn'), false);
  assert.equal(f.calls.some(call => call[0] === 'interrupt'), false);
});
