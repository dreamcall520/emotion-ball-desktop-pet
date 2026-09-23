const { randomUUID } = require('node:crypto');
const { emptyRecord, normalizeArchive, createChatRecord, chatTitle, hasChat, validId, MAX_MESSAGES, MAX_TEXT, MAX_CHATS } = require('./chat-store');
const { normalizeModelSelection, resolveChatModel } = require('./chat-models');

const ACTIONS = new Set(['none', 'hop', 'jelly', 'sway', 'peek', 'bow', 'spin', 'sleep', 'wake', 'dockLeft', 'dockRight', 'restore']);
const ERRORS = {
  MISSING: '未找到 Codex。请先安装并登录 Codex，再回来聊天。',
  UNAUTHENTICATED: '请先在 Codex 中登录，再发送消息。',
  UNSUPPORTED: '当前 Codex 版本或登录方式暂不支持聊天，请更新并使用 ChatGPT 登录。',
  ACCOUNT_CHANGED: 'Codex 账号已变化。请切回原账号继续，或点“新聊天”使用当前账号。',
  CREATION_UNCERTAIN: '上次创建对话的结果未确认。为避免重复创建，请先检查 Codex，或主动点“新聊天”。',
  ACTIVE_THREAD: '这段对话仍在 Codex 中执行。请等待结束，或在 Codex 中停止后再继续。',
  STORAGE: '聊天记录暂时无法保存，请检查本机存储后再试。',
  TIMEOUT: 'Codex 响应超时。原对话已保留，没有自动重发消息。',
  DISCONNECTED: '与 Codex 的连接中断。原对话已保留，下次发送会恢复它。',
  THREAD_UNAVAILABLE: '原对话暂时无法恢复。请检查 Codex，或主动点“新聊天”；不会自动另开。',
  THREAD_BUSY: '原对话正被另一个 Codex 连接使用。请结束该连接后再试；原对话已保留。',
  INVALID_RESPONSE: '这次回复未完整收到。可以继续聊，原对话保持不变。',
  TURN_FAILED: '这次回复没有完成，请检查 Codex 的连接和可用额度后再试。',
  RATE_LIMITED: 'Codex 当前可用额度不足或请求过于频繁，请稍后再聊。原对话已保留。',
  CONTEXT_LIMIT: '这段聊天已达到 Codex 的上下文上限。可以主动点“新聊天”重新开始。',
  UNSAFE_CONFIG: '当前 Codex 版本无法按聊天模式连接，请更新 Codex 后再试。',
  MODELS_UNAVAILABLE: '暂时没能读取可用模型，请重试模型列表后再发送。',
  MODEL_UNAVAILABLE: '所选模型暂不可用，请重新选择模型；原聊天已保留。',
  TOOL_BLOCKED: '这次请求超出了球球的聊天能力，已停止。可以继续聊或让球球做个小动作。',
  CLOSED: '聊天已关闭。'
};
const fault = code => Object.assign(new Error(ERRORS[code] || ERRORS.TURN_FAILED), { code });
const readableError = error => ERRORS[error?.code] || ERRORS.TURN_FAILED;

// Decode only the text field of a partially received JSON response. Never show the
// JSON envelope, execute model text, or interpret an action until the turn completes.
function partialReply(raw) {
  const match = /"text"\s*:\s*"/.exec(raw);
  if (!match) return '';
  let result = '';
  for (let i = match.index + match[0].length; i < raw.length && result.length < MAX_TEXT; i++) {
    const char = raw[i];
    if (char === '"') break;
    if (char !== '\\') { result += char; continue; }
    const next = raw[++i];
    if (!next) break;
    const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
    if (next === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[a-fA-F0-9]{4}$/.test(hex)) break;
      result += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else if (Object.hasOwn(escapes, next)) result += escapes[next];
    else break;
  }
  return result;
}

function finalReply(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).length !== 2 || typeof value.text !== 'string' || !value.text.trim() || !ACTIONS.has(value.action)) return null;
    return { text: value.text.slice(0, MAX_TEXT), action: value.action };
  } catch (_) { return null; }
}

function createChatCompanion({ store, createRpc, workspaceDir, onChange = () => {}, onAction = () => {}, turnTimeoutMs = 180000,
  initialModelSelection = 'auto', onModelSelection = () => {} }) {
  let record = normalizeArchive(emptyRecord()), storageProblem = false, storageLoaded = false;
  const readArchive = () => {
    const archive = normalizeArchive(store.read());
    for (const chat of [archive, ...archive.history]) for (const message of chat.messages) if (message.status === 'streaming') message.status = 'interrupted';
    return archive;
  };
  try { record = readArchive(); storageLoaded = true; } catch (_) { storageProblem = true; }
  let rpc = null, connecting = null, loadedThread = null, accountKey = null;
  let connection = 'idle', error = storageProblem ? ERRORS.STORAGE : null;
  let verified = false, closed = false, active = null, epoch = 0;
  let draining = Promise.resolve();
  let modelSelection = normalizeModelSelection(initialModelSelection), models = [], modelsStatus = 'idle', modelsError = null;
  let modelsClient = null, modelsAccount = null, modelLoad = null, activeModel = null, modelRevision = 0;
  const ownedThreads = new Set([record, ...record.history].map(chat => chat.threadId).filter(Boolean));

  function snapshot() {
    return { messages: verified ? record.messages.map(message => ({ ...message })) : [],
      busy: Boolean(active), connection, error, hasConversation: Boolean(record.threadId),
      canStartNewChat: hasChat(record) || Boolean(accountKey && record.accountKey && record.accountKey !== accountKey),
      modelSelection, models: verified ? models.map(model => ({ ...model, supportedReasoningEfforts: [...model.supportedReasoningEfforts] })) : [],
      modelsStatus: verified ? modelsStatus : 'idle', modelsError: verified ? modelsError : null,
      activeModel: verified && activeModel ? { ...activeModel } : null,
      activeChatId: verified ? record.chatId : null,
      history: accountKey && !storageProblem ? [record, ...record.history]
        .filter(chat => hasChat(chat) && (chat.accountKey === accountKey || (chat.chatId === record.chatId && verified && !chat.accountKey)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(chat => ({ id: chat.chatId, title: chat.title, updatedAt: chat.updatedAt, current: chat.chatId === record.chatId })) : [] };
  }
  const emit = () => { if (!closed) onChange(snapshot()); };
  async function loadModels(client, force = false) {
    if (!force && modelsClient === client && modelsAccount === accountKey && modelsStatus === 'ready') return;
    if (modelLoad?.client === client && modelLoad.account === accountKey) return modelLoad.promise;
    const operation = { client, account: accountKey };
    modelRevision++;
    modelsStatus = 'loading'; modelsError = null; emit();
    operation.promise = (async () => {
      try {
        const available = await client.listModels();
        if (closed || rpc !== client || !verified || accountKey !== operation.account) return;
        if (!Array.isArray(available) || !available.length) throw fault('MODELS_UNAVAILABLE');
        models = available; modelsClient = client; modelsAccount = operation.account; modelsStatus = 'ready';
      } catch (_) {
        if (closed || rpc !== client || !verified || accountKey !== operation.account) return;
        models = []; modelsClient = null; modelsAccount = null; modelsStatus = 'error'; modelsError = ERRORS.MODELS_UNAVAILABLE;
      } finally {
        if (modelLoad === operation) modelLoad = null;
        if (rpc === client) emit();
      }
    })();
    modelLoad = operation;
    return operation.promise;
  }
  function setModel(value) {
    if (closed || active || connecting || modelsStatus === 'loading') return { accepted: false, error: '请先等待当前回复或连接完成。' };
    if (typeof value !== 'string' || normalizeModelSelection(value) !== value ||
      (value !== 'auto' && (!verified || modelsStatus !== 'ready' || !models.some(model => model.id === value)))) {
      return { accepted: false, error: ERRORS.MODEL_UNAVAILABLE };
    }
    if (value === modelSelection) return { accepted: true };
    try { onModelSelection(value); }
    catch (_) { return { accepted: false, error: '模型设置未能保存，请稍后再试。' }; }
    modelSelection = value;
    activeModel = null;
    if (error === ERRORS.MODEL_UNAVAILABLE || error === ERRORS.MODELS_UNAVAILABLE) error = null;
    emit(); return { accepted: true };
  }
  async function refreshModels() {
    if (closed || active || connecting) return { accepted: false, error: '请先等待当前回复或连接完成。' };
    try {
      const previousRevision = modelRevision;
      const client = await connect();
      if (previousRevision === modelRevision) await loadModels(client, true);
      if (modelsStatus !== 'ready') return { accepted: false, error: modelsError || ERRORS.MODELS_UNAVAILABLE };
      if (error === ERRORS.MODELS_UNAVAILABLE) { error = null; emit(); }
      return { accepted: true };
    } catch (cause) { return { accepted: false, error: readableError(cause) }; }
  }
  function retireClient(client) {
    if (!client) return draining;
    const previous = draining;
    const done = Promise.resolve(client.close()).catch(() => {});
    draining = Promise.all([previous, done]).then(() => undefined);
    return draining;
  }
  function dropClient(client) {
    if (rpc === client) { rpc = null; connecting = null; loadedThread = null; connection = 'idle'; }
    return retireClient(client);
  }
  function persist() {
    record.messages = record.messages.slice(-MAX_MESSAGES);
    try { store.write(record); storageProblem = false; }
    catch (_) { storageProblem = true; throw fault('STORAGE'); }
  }
  function assistantFor(request) { return record.messages.find(message => message.id === request.assistantId); }
  async function interruptRequest(request) {
    if (!request.turnId || !request.client || request.interruptedIds.has(request.turnId)) return;
    request.interruptedIds.add(request.turnId);
    try {
      await request.client.interruptTurn(request.threadId, request.turnId);
      if (!request.terminal) dropClient(request.client);
      finish(request, 'interrupted');
    } catch (cause) {
      finish(request, 'interrupted', cause);
      if (rpc === request.client) { rpc = null; loadedThread = null; connecting = null; connection = 'error'; }
      retireClient(request.client);
    }
  }
  function finish(request, status, failure) {
    if (active !== request) return;
    clearTimeout(request.timer);
    const message = assistantFor(request);
    const payload = status === 'complete' && !request.cancelled ? finalReply(request.final || request.raw) : null;
    if (status === 'complete' && !payload) { status = 'error'; failure = fault('INVALID_RESPONSE'); }
    if (message) {
      message.status = request.cancelled ? 'interrupted' : status;
      if (payload) message.text = payload.text;
      if (!message.text) message.text = status === 'interrupted' || request.cancelled ? '这次回复已停止。' : '这次没有收到完整回复。';
    }
    record.pendingTurn = false;
    active = null;
    error = failure ? readableError(failure) : null;
    try { persist(); } catch (saveError) { error = readableError(saveError); }
    emit();
    if (payload && !request.cancelled && !storageProblem && payload.action !== 'none') onAction(payload.action);
  }
  function disconnect(origin, code = 'DISCONNECTED') {
    if (rpc !== origin || closed) return;
    rpc = null; connecting = null; loadedThread = null;
    connection = 'error';
    if (active) finish(active, 'error', fault(code));
    else { error = readableError({ code }); emit(); }
  }
  function notify(packet) {
    const request = active, params = packet?.params || {};
    if (packet?.method === 'account/updated') {
      // Re-check the account before another message; never assume a login event
      // grants access to the account that owns the saved conversation.
      verified = false; accountKey = null;
      models = []; modelsClient = null; modelsAccount = null; modelsStatus = 'idle'; modelsError = null; activeModel = null;
      if (request) {
        request.cancelled = true;
        if (request.turnId) void interruptRequest(request);
        finish(request, 'interrupted');
      }
      dropClient(rpc);
      emit(); return;
    }
    if (!request || request.phase === 'preparing' || params.threadId !== request.threadId) return;
    const incomingTurn = params.turnId || params.turn?.id;
    if (request.turnId && incomingTurn && request.turnId !== incomingTurn) return;
    if (incomingTurn && validId(incomingTurn)) request.turnId ||= incomingTurn;
    if (request.cancelled && request.turnId) void interruptRequest(request);
    if (packet.method === 'turn/started') return;
    if (packet.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      const id = params.itemId || 'reply';
      request.items[id] = ((request.items[id] || '') + params.delta).slice(0, MAX_TEXT * 4);
      request.raw = request.items[id];
      const message = assistantFor(request);
      const text = partialReply(request.raw);
      if (message && text) { message.text = text; emit(); }
    } else if (packet.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') {
      if (params.item.phase === 'commentary') return;
      request.final = params.item.text.slice(0, MAX_TEXT * 4);
      const message = assistantFor(request), text = partialReply(request.final);
      if (message && text) { message.text = text; emit(); }
    } else if (packet.method === 'turn/completed') {
      request.terminal = true;
      const status = params.turn?.status;
      finish(request, status === 'completed' ? 'complete' : status === 'interrupted' ? 'interrupted' : 'error',
        status === 'completed' || status === 'interrupted' ? null : fault(params.turn?.errorCode || 'TURN_FAILED'));
    } else if (packet.method === 'error' && params.willRetry !== true) finish(request, 'error', fault(params.error?.code || 'TURN_FAILED'));
  }

  async function connect() {
    if (closed) throw fault('CLOSED');
    if (connecting) return connecting;
    const currentEpoch = epoch;
    connection = 'connecting'; emit();
    const operation = (async () => {
      await draining;
      if (closed || currentEpoch !== epoch) throw fault('CLOSED');
      if (!rpc) {
        let created;
        created = createRpc({ workspaceDir, onNotification: packet => { if (rpc === created) notify(packet); }, onDisconnect: code => disconnect(created, code) });
        rpc = created;
      }
      const client = rpc;
      await client.start();
      const account = await client.readAccount();
      if (closed || currentEpoch !== epoch || rpc !== client) throw fault('CLOSED');
      if (!account.authenticated || !account.accountKey) throw fault(account.supported === false ? 'UNSUPPORTED' : 'UNAUTHENTICATED');
      accountKey = account.accountKey;
      if (record.accountKey && record.accountKey !== accountKey) { verified = false; throw fault('ACCOUNT_CHANGED'); }
      if (modelsAccount && modelsAccount !== accountKey) { models = []; modelsClient = null; modelsAccount = null; activeModel = null; }
      verified = true; connection = 'ready';
      error = storageProblem ? ERRORS.STORAGE : record.creationPending ? ERRORS.CREATION_UNCERTAIN : null;
      await loadModels(client);
      if (closed || currentEpoch !== epoch || rpc !== client) throw fault('CLOSED');
      emit(); return client;
    })();
    connecting = operation;
    try { return await operation; }
    catch (cause) {
      if (!closed && currentEpoch === epoch) {
        verified = false;
        if (cause?.code !== 'ACCOUNT_CHANGED') accountKey = null;
        connection = 'error'; error = readableError(cause); emit();
      }
      throw cause;
    }
    finally { if (connecting === operation) connecting = null; }
  }

  async function send(text) {
    if (closed || active) return { accepted: false, error: closed ? ERRORS.CLOSED : '球球正在回复，可以先停止再发送。' };
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || text.includes('\0')) return { accepted: false, error: '请输入 1–2000 字的消息。' };
    if (storageProblem) {
      try {
        if (!storageLoaded) {
          record = readArchive(); storageLoaded = true;
          for (const chat of [record, ...record.history]) if (chat.threadId) ownedThreads.add(chat.threadId);
        }
        persist();
      } catch (_) { return { accepted: false, error: ERRORS.STORAGE }; }
    }
    const request = { phase: 'preparing', threadId: null, turnId: null, assistantId: randomUUID(), raw: '', final: '', items: {}, cancelled: false, interruptedIds: new Set() };
    active = request; error = null; emit();
    try {
      const client = await connect();
      request.client = client;
      if (active !== request || request.cancelled) throw fault('CLOSED');
      if (modelsStatus !== 'ready' || modelsClient !== client) throw fault('MODELS_UNAVAILABLE');
      const selectedModel = resolveChatModel(models, modelSelection, text);
      if (record.creationPending) throw fault('CREATION_UNCERTAIN');
      if (!record.threadId) {
        const previousAccount = record.accountKey;
        record.accountKey = accountKey;
        record.creationPending = true;
        try { persist(); } // Mark the attempt before crossing the process boundary.
        catch (cause) { record.accountKey = previousAccount; record.creationPending = false; throw cause; }
        const thread = await client.startThread();
        if (!validId(thread?.id)) throw fault('CREATION_UNCERTAIN');
        record.threadId = thread.id; record.creationPending = false;
        ownedThreads.add(thread.id);
        persist(); // Persist the identifier before the first generation request.
        loadedThread = thread.id;
        if (client.nameThread) void client.nameThread(thread.id).catch(() => {});
      } else if (loadedThread !== record.threadId) {
        let thread;
        try { thread = await client.resumeThread(record.threadId); }
        catch (cause) { throw fault(['DISCONNECTED', 'THREAD_BUSY'].includes(cause?.code) ? cause.code : 'THREAD_UNAVAILABLE'); }
        if (thread?.id !== record.threadId) throw fault('THREAD_UNAVAILABLE');
        if (thread.activeTurnId || ['active', 'inProgress'].includes(thread.status)) throw fault('ACTIVE_THREAD');
        loadedThread = record.threadId;
      }
      if (active !== request || request.cancelled || closed) throw fault('CLOSED');
      request.threadId = record.threadId;
      record.messages.push({ id: randomUUID(), role: 'user', text: text.trim(), status: 'complete' },
        { id: request.assistantId, role: 'assistant', text: '', status: 'streaming' });
      if (record.messages.filter(message => message.role === 'user').length === 1) record.title = chatTitle(record);
      record.updatedAt = Date.now();
      record.pendingTurn = true; persist();
      activeModel = selectedModel;
      request.phase = 'starting'; emit();
      request.timer = setTimeout(() => {
        if (active !== request) return;
        request.cancelled = true;
        dropClient(client);
        finish(request, 'error', fault('TIMEOUT'));
        if (request.turnId) void interruptRequest(request);
        loadedThread = null;
      }, turnTimeoutMs);
      request.timer.unref?.();
      const turn = await client.startTurn(request.threadId, text.trim(), selectedModel);
      if (validId(turn?.id)) request.turnId = turn.id;
      if (request.cancelled) void interruptRequest(request);
      if (active !== request) return { accepted: true };
      if (!validId(turn?.id)) throw fault('INVALID_RESPONSE');
      request.turnId = turn.id; request.phase = 'running';
      if (request.cancelled) await stop();
      return { accepted: true };
    } catch (cause) {
      if (active !== request) return { accepted: true };
      loadedThread = null;
      const previous = rpc; rpc = null; connecting = null; retireClient(previous);
      const accepted = Boolean(assistantFor(request));
      finish(request, request.cancelled ? 'interrupted' : 'error', request.cancelled ? null : cause);
      return { accepted, ...(accepted ? {} : { error: readableError(cause) }) };
    }
  }

  async function stop() {
    const request = active;
    if (!request) return;
    request.cancelled = true;
    if (request.phase === 'preparing') return;
    if (!request.turnId) return; // The start response will finish cancellation.
    await interruptRequest(request);
  }

  async function newChat() {
    if (closed || active || connecting) return { accepted: false, error: '请先等待当前回复或连接完成。' };
    if (!storageLoaded || storageProblem) return { accepted: false, error: ERRORS.STORAGE };
    // Reuse the existing empty draft; confirmation alone never creates a Codex thread.
    if (!hasChat(record) && (!record.accountKey || record.accountKey === accountKey)) return { accepted: true };
    const draft = record.history.find(chat => !hasChat(chat) && chat.accountKey === accountKey);
    if (draft) return changeChat(draft);
    if (record.history.length + 1 >= MAX_CHATS) return { accepted: false, error: '聊天记录已达上限，请先继续已有聊天。' };
    return changeChat(createChatRecord({ ...emptyRecord(), accountKey }));
  }

  function changeChat(target) {
    const previous = record;
    const history = record.history.filter(chat => chat.chatId !== target.chatId);
    if (hasChat(record)) history.push(createChatRecord({ ...record, version: 1 }));
    record = { ...target, version: 2, history };
    try { persist(); }
    catch (cause) { record = previous; error = readableError(cause); emit(); return { accepted: false, error }; }
    epoch++; loadedThread = null; verified = Boolean(accountKey); error = null; activeModel = null;
    const previousRpc = rpc; rpc = null; connecting = null; retireClient(previousRpc);
    connection = accountKey ? 'ready' : 'idle'; emit();
    return { accepted: true };
  }

  async function selectChat(id) {
    if (closed || active || connecting) return { accepted: false, error: '请先等待当前回复或连接完成。' };
    if (!storageLoaded || storageProblem) return { accepted: false, error: ERRORS.STORAGE };
    if (!accountKey) return { accepted: false, error: ERRORS.UNAUTHENTICATED };
    const target = [record, ...record.history].find(chat => chat.chatId === id && chat.accountKey === accountKey);
    if (!target) return { accepted: false, error: '这段聊天暂不可用，请选择当前账号的聊天记录。' };
    if (target.chatId === record.chatId) return { accepted: true };
    // Select only local, account-matched records. Resume happens on the next send.
    return changeChat(target);
  }

  function close() {
    if (closed) return draining;
    const request = active;
    if (request) {
      request.cancelled = true;
      if (request.turnId) void interruptRequest(request);
      finish(request, 'interrupted');
    }
    closed = true; epoch++;
    const previous = rpc; rpc = null; connecting = null;
    return retireClient(previous);
  }
  return { getState: snapshot, connect, send, stop, newChat, selectChat, setModel, refreshModels, close, ownsThread: id => ownedThreads.has(id) };
}

module.exports = { createChatCompanion, partialReply, finalReply, ACTIONS, ERRORS };
