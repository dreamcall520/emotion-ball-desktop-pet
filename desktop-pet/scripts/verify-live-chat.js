// Explicit opt-in only. Uses one persisted verification thread and real Codex quota.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { createCodexChatRpc } = require('../lib/codex-chat-rpc');
const { createChatCompanion } = require('../lib/chat-companion');
const { createChatStore } = require('../lib/chat-store');

async function main() {
  assert.equal(process.env.PET_CHAT_LIVE, '1', 'Set PET_CHAT_LIVE=1 explicitly; this check can consume Codex quota.');
  const folder = process.env.PET_CHAT_LIVE_DIR;
  assert.ok(folder && path.isAbsolute(folder), 'Use an explicit, isolated artifact directory.');
  const workspaceDir = path.join(folder, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  const store = createChatStore(path.join(folder, 'chat.json'));
  const counts = { starts: 0, resumes: 0, turns: 0 };
  const policies = [];
  const wrappedSpawn = (...args) => {
    const child = spawn(...args);
    let buffer = '';
    const pending = new Map(), write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk, ...rest) => {
      const packet = JSON.parse(String(chunk));
      if (packet.id) pending.set(packet.id, packet.method);
      if (packet.method === 'thread/start') counts.starts++;
      if (packet.method === 'thread/resume') counts.resumes++;
      if (packet.method === 'turn/start') counts.turns++;
      return write(chunk, ...rest);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line) continue;
        const packet = JSON.parse(line), method = pending.get(packet.id);
        pending.delete(packet.id);
        if (['thread/start', 'thread/resume'].includes(method) && packet.result) {
          const r = packet.result;
          // Project only non-secret policy fields; never dump config, account, or raw events.
          const policy = { method, threadId: r.thread?.id, environments: r.thread?.environments,
            sandbox: r.sandbox, approvalPolicy: r.approvalPolicy,
            runtimeWorkspaceRoots: r.runtimeWorkspaceRoots, activePermissionProfile: r.activePermissionProfile,
            instructionSources: r.instructionSources };
          policies.push(policy);
          fs.writeFileSync(path.join(folder, 'policies.json'), JSON.stringify(policies, null, 2), { mode: 0o600 });
        }
      }
    });
    return child;
  };
  let latestClient;
  const createRpc = options => {
    latestClient = createCodexChatRpc({ ...options, spawn: wrappedSpawn, timeoutMs: 30000 });
    return latestClient;
  };
  // Account-only probing creates no empty, potentially non-persistent threads.
  const rpc = createRpc({ workspaceDir });
  try {
    await rpc.start();
    const account = await rpc.readAccount();
    assert.equal(account.authenticated, true);
    console.log(JSON.stringify({ phase: 'account', authenticated: true, ...counts }));
  } finally { await rpc.close(); }
  if (process.env.PET_CHAT_LIVE_SEND !== '1') return;
  let expectedId;
  const completed = [];
  const resumeOnly = process.env.PET_CHAT_LIVE_RESUME_ONLY === '1';
  let chat;
  const newController = () => createChatCompanion({ store, createRpc, workspaceDir });
  const send = async text => {
    const result = await chat.send(text);
    assert.equal(result.accepted, true, result.error);
    const deadline = Date.now() + 120000;
    while (chat.getState().busy && Date.now() < deadline) await wait(100);
    const state = chat.getState();
    assert.equal(state.busy, false, 'Reply timed out');
    assert.equal(state.error, null, state.error);
    expectedId ||= store.read().threadId;
    assert.equal(store.read().threadId, expectedId);
    const last = state.messages.at(-1);
    assert.equal(last.status, 'complete');
    completed.push(last.text);
  };
  try {
    chat = newController();
    if (process.env.PET_CHAT_LIVE_NEW === '1') {
      // Explicit test operator reset only; never an automatic failure fallback.
      const file = path.join(folder, 'chat.json');
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(folder, `previous-chat-${Date.now()}.json`));
      assert.equal((await chat.newChat()).accepted, true);
    }
    await chat.connect();
    if (!resumeOnly) {
      await send('球球，我们做个简短的聊天测试。请记住暗号“橘子月亮”，只回答“记住啦”。');
      await send('刚才让你记住的暗号是什么？');
      assert.match(completed.at(-1), /橘子月亮/);
    } else {
      expectedId = store.read().threadId;
      assert.ok(expectedId && store.read().messages.length >= 4);
      completed.push(...store.read().messages.filter(message => message.role === 'assistant').map(message => message.text));
    }
    await chat.close();
    chat = newController();
    await send('我关闭并重新打开了聊天。继续刚才的对话，暗号是什么？');
    assert.match(completed.at(-1), /橘子月亮/);
    assert.ok(policies.length >= (resumeOnly ? 1 : 2));
    assert.ok(policies.every(policy => policy.threadId === expectedId));
    const environment = await latestClient.verifyThreadEnvironment(expectedId);
    assert.equal(environment.environmentsDisabled, true);
    const report = { passed: true, threadId: expectedId, ...counts, completed, policies, environment };
    fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ phase: 'conversation', passed: true, threadId: expectedId, ...counts, completed }));
  } finally { await chat?.close(); }
}

main().catch(error => { console.error(error.code === 'ERR_ASSERTION' ? error.message : error.code || 'VERIFICATION_FAILED'); process.exitCode = 1; });
