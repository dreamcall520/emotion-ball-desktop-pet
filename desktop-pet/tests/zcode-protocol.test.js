const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createZcodeProtocol } = require('../lib/zcode-protocol');
function harness(options = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.pid = 123; child.kill = () => child.emit('exit', 0);
  const sent = []; child.stdin.on('data', data => sent.push(JSON.parse(String(data))));
  const rpc = createZcodeProtocol({ binary: '/app/zcode.cjs', cwd: '/chat', spawn: () => child, timeoutMs: 100, ...options });
  return { rpc, child, sent, receive: value => child.stdout.write(JSON.stringify(value) + '\n') };
}
test('official ZCode NDJSON excludes JSON-RPC field and supports runtime preference requests', async () => {
  const h = harness({ onRequest: (method) => method === 'session/requestRuntimePreferences' ? { memoryEnabled: false } : undefined });
  await h.rpc.start(); const pending = h.rpc.request('runtime/capabilities', {});
  assert.equal(h.sent[0].jsonrpc, undefined); h.receive({ id: h.sent[0].id, result: { historyFirst: true } });
  assert.deepEqual(await pending, { historyFirst: true });
  h.receive({ id: 'server-1', method: 'session/requestRuntimePreferences', params: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent[1], { id: 'server-1', result: { memoryEnabled: false } }); await h.rpc.close();
});
test('unsupported server tools fail closed without exposing arguments', async () => {
  const h = harness(); await h.rpc.start();
  h.receive({ id: 'danger', method: 'interaction/requestPermission', params: { command: 'private' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.sent[0].error.code, -32601); assert.equal(JSON.stringify(h.sent).includes('private'), false);
  await assert.rejects(h.rpc.request('session/send', {}), { code: 'TOOL_BLOCKED' });
});

test('runtime authentication preserves explicit team and login errors without leaking provider responses', async () => {
  for (const code of ['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED', 'ZCODE_LOGIN_REQUIRED']) {
    const disconnected = [];
    const h = harness({ onRequest: () => { throw Object.assign(new Error('PRIVATE_AUTH_RESPONSE'), { code }); },
      onDisconnect: value => disconnected.push(value) });
    await h.rpc.start();
    h.receive({ id: 'auth', method: 'interaction/requestProviderRuntimeHeaders', params: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(disconnected, [code]);
    await assert.rejects(h.rpc.request('session/send', {}), { code });
    assert.equal(JSON.stringify(h.sent).includes('PRIVATE_AUTH_RESPONSE'), false);
  }
  const blocked = harness({ onRequest: () => { throw Object.assign(new Error('PRIVATE'), { code: 'ZCODE_TEAM_ACCESS_DENIED' }); } });
  await blocked.rpc.start(); blocked.receive({ id: 'tool', method: 'interaction/requestPermission', params: {} });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(blocked.rpc.request('session/send', {}), { code: 'TOOL_BLOCKED' });
});

test('transient runtime authentication failures are disconnected, while tool interception remains blocked', async () => {
  for (const code of ['ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR', 'ZCODE_INVALID_RESPONSE']) {
    const disconnected = [];
    const h = harness({ onRequest: () => { throw Object.assign(new Error('PRIVATE_AUTH_RESPONSE'), { code }); },
      onDisconnect: value => disconnected.push(value) });
    await h.rpc.start(); h.receive({ id: 'auth', method: 'interaction/requestProviderRuntimeHeaders', params: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(disconnected, ['DISCONNECTED']);
    await assert.rejects(h.rpc.request('session/send', {}), { code: 'DISCONNECTED' });
    assert.equal(JSON.stringify(h.sent).includes('PRIVATE_AUTH_RESPONSE'), false);
  }
});
test('oversized frames and timed out mutation close the owned connection', async () => {
  const h = harness({ maxFrameBytes: 30 }); await h.rpc.start(); h.child.stdout.write('x'.repeat(31));
  await assert.rejects(h.rpc.request('session/send', {}), { code: 'INVALID_FRAME' });
  const t = harness({ timeoutMs: 5 }); await t.rpc.start();
  await assert.rejects(t.rpc.request('session/send', {}), { code: 'TIMEOUT' });
  await assert.rejects(t.rpc.request('session/send', {}), { code: 'TIMEOUT' });
});
