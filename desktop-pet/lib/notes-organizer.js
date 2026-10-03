const fs = require('node:fs');
const path = require('node:path');
const { createCodexChatRpc, NOTES_TEXT_LIMIT } = require('./codex-chat-rpc');
const { resolveChatModel } = require('./chat-models');

const MESSAGES = {
  INVALID_INPUT: '请提供有效的便签：标题最多 200 字，正文最多 20,000 字，至少一项有内容。',
  INVALID_RESPONSE: '整理结果不完整或格式不符，原文未替换，请重试。',
  BUSY: '已有便签正在整理，请等待完成或先取消。',
  MISSING: '未找到 Codex，请先安装并登录 Codex。',
  UNAUTHENTICATED: '请先在 Codex 中使用 ChatGPT 账号登录，再整理便签。',
  UNSUPPORTED: '当前 Codex 版本或登录方式不支持整理，请更新并使用 ChatGPT 登录。',
  UNSAFE_CONFIG: '当前 Codex 无法按纯文字模式连接，请更新后重试。',
  RATE_LIMITED: 'Codex 可用额度不足或请求过于频繁，请稍后重试。',
  MODEL_UNAVAILABLE: '所用模型暂不可用，请稍后重试。',
  MODELS_UNAVAILABLE: '暂时无法读取可用模型，请稍后重试。',
  CONTEXT_LIMIT: '这条便签超出当前模型的处理范围，原文未替换。',
  TIMEOUT: '整理超时，原文未替换；没有自动重发。',
  CANCELLED: '本次整理已取消，原文未替换。',
  CLOSED: '便签整理已关闭，原文未替换。',
  TOOL_BLOCKED: '本次请求超出纯文字整理范围，已停止，原文未替换。',
  STORAGE: '整理工作目录暂不可用，请检查本机存储后重试。',
  DISCONNECTED: '整理连接中断，原文未替换，请重试。'
};
const safeCode = code => typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'DISCONNECTED';
const failure = code => Object.assign(new Error(MESSAGES[safeCode(code)]), { code: safeCode(code) });
const notesOrganizerMessage = error => MESSAGES[safeCode(error?.code)];
function validateText(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'title') || !Object.hasOwn(value, 'body') || typeof value.title !== 'string' || typeof value.body !== 'string' ||
    Array.from(value.title).length > 200 || Array.from(value.body).length > 20000 ||
    !value.title.trim() && !value.body.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.title + value.body)) throw failure(code);
  return { title: value.title, body: value.body };
}
function createNotesOrganizer({ workspaceDir, createRpc = createCodexChatRpc, timeoutMs = 120000, fsImpl = fs }) {
  if (typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0')) throw failure('INVALID_INPUT');
  let active = null, closed = false, draining = Promise.resolve();
  const timeout = Math.max(1, Math.min(180000, Number(timeoutMs) || 120000));
  const retire = client => {
    if (!client) return draining;
    const ending = Promise.resolve().then(() => client.close()).catch(() => {});
    draining = Promise.all([draining, ending]).then(() => undefined);return draining;
  };
  function finish(request, result, error) {
    if (request.done) return;
    request.done = true;clearTimeout(request.timer);
    if (active === request) active = null;
    retire(request.client);
    if (error !== undefined) request.reject(failure(error?.code));else request.resolve(result);
  }
  function abort(code) {
    const request = active;if (!request) return draining;
    if (request.turnId && request.threadId && request.client) {
      try { Promise.resolve(request.client.interruptTurn(request.threadId, request.turnId)).catch(() => {}); } catch (_) {}
    }
    finish(request, null, failure(code));return draining;
  }
  function notification(request, packet) {
    if (active !== request || request.done) return;
    if (packet?.method === 'account/updated') { finish(request, null, failure('UNAUTHENTICATED'));return; }
    const p = packet?.params;
    if (!p || !request.threadId || p.threadId !== request.threadId) return;
    const turnId = p.turnId || p.turn?.id;
    if (request.turnId && turnId !== request.turnId) return;
    if (typeof turnId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(turnId)) return;
    request.turnId ||= turnId;
    if (packet.method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.phase !== 'commentary') {
      if (typeof p.item.text !== 'string' || p.item.text.length > NOTES_TEXT_LIMIT) { finish(request, null, failure('INVALID_RESPONSE'));return; }
      request.final = p.item.text;
    } else if (packet.method === 'turn/completed') {
      if (p.turn?.status !== 'completed') { finish(request, null, failure(p.turn?.status === 'interrupted' ? 'CANCELLED' : p.turn?.errorCode));return; }
      try {
        const result = validateText(JSON.parse(request.final), 'INVALID_RESPONSE');
        if (/(?:^|\n)\s*```/.test(result.title + '\n' + result.body)) throw failure('INVALID_RESPONSE');
        finish(request, result);
      } catch (_) { finish(request, null, failure('INVALID_RESPONSE')); }
    } else if (packet.method === 'error' && p.willRetry !== true) finish(request, null, failure(p.error?.code));
  }
  async function organize(input) {
    const source = validateText(input, 'INVALID_INPUT');
    if (closed) throw failure('CLOSED');if (active) throw failure('BUSY');
    const request = { client: null, threadId: null, turnId: null, final: '', done: false };
    const answer = new Promise((resolve, reject) => { request.resolve = resolve;request.reject = reject; });active = request;
    request.timer = setTimeout(() => { if (active === request) abort('TIMEOUT'); }, timeout);
    void (async () => {
      try {
        await draining;if (request.done) return;
        try { fsImpl.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 }); } catch (_) { throw failure('STORAGE'); }
        request.client = createRpc({ workspaceDir, purpose: 'notes',
          onNotification: packet => notification(request, packet),
          onDisconnect: code => finish(request, null, failure(code)) });
        await request.client.start();if (request.done) return;
        const account = await request.client.readAccount();if (request.done) return;
        if (!account?.authenticated || !account.accountKey) throw failure('UNAUTHENTICATED');
        const models = await request.client.listModels();if (request.done) return;
        const selection = resolveChatModel(models, 'auto', '整理便签文字');
        const thread = await request.client.startThread();if (request.done) return;
        if (typeof thread?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(thread.id) || thread.activeTurnId || thread.status === 'active') throw failure('INVALID_RESPONSE');
        request.threadId = thread.id;
        const turn = await request.client.startTurn(thread.id, JSON.stringify(source), selection);if (request.done) return;
        if (typeof turn?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(turn.id) || request.turnId && request.turnId !== turn.id) throw failure('INVALID_RESPONSE');
        request.turnId = turn.id;
      } catch (error) { finish(request, null, error); }
    })();
    return answer;
  }
  return { organize, cancel: () => abort('CANCELLED'), close() { closed = true;return abort('CLOSED'); } };
}
module.exports = { createNotesOrganizer, notesOrganizerMessage };
