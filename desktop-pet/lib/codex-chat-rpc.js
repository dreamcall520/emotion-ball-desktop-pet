const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

// Keep this connection independent of the existing read-only quota/status RPC.
const ERROR_CODES = Object.freeze(['MISSING', 'UNAUTHENTICATED', 'UNSUPPORTED', 'DISCONNECTED',
  'TIMEOUT', 'INVALID_FRAME', 'INVALID_INPUT', 'CLOSED', 'BUSY', 'TOOL_BLOCKED',
  'UNSAFE_CONFIG', 'THREAD_NOT_FOUND', 'THREAD_BUSY', 'RATE_LIMITED', 'CONTEXT_LIMIT']);
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 128 * 1024;
const METHODS = new Set(['initialize', 'config/read', 'account/read', 'thread/start', 'thread/resume',
  'thread/name/set', 'thread/read', 'turn/start', 'turn/interrupt']);
const DISABLED_FEATURES = Object.freeze(['shell_tool', 'shell_snapshot', 'apps', 'plugins', 'hooks',
  'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'multi_agent', 'multi_agent_v2',
  'code_mode', 'code_mode_host', 'view_image', 'memories', 'chronicle', 'skill_search',
  'skill_mcp_dependency_install', 'remote_plugin', 'image_generation', 'goals', 'tool_suggest',
  'recommended_plugins', 'workspace_dependencies', 'request_permissions_tool', 'sleep_tool']);
const ACTIONS = Object.freeze(['none', 'hop', 'jelly', 'sway', 'peek', 'bow', 'spin', 'sleep', 'wake',
  'dockLeft', 'dockRight', 'restore']);
const CHAT_OUTPUT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  properties: { text: { type: 'string' }, action: { type: 'string', enum: ACTIONS } },
  required: ['text', 'action'] });
const CHAT_INSTRUCTIONS = '你是桌面宠物球球，温和、有一点调皮，用简短自然的简体中文陪用户聊天。通常回复一两句话。' +
  '这是球球专用的连续对话，可以沿用 Codex 加载的用户全局偏好。不能读取其他会话、电脑文件、屏幕或账号额度。' +
  '不执行命令、不调用外部工具、不修改文件、不安装插件。不要声称已经执行任何未经确认的操作。' +
  '最终只返回符合指定 JSON Schema 的对象，text 是给用户看的话，action 是球球本地动作。' +
  '只有用户明确要求球球做动作时 action 才能不是 none：hop 跳一下，jelly 软弹，sway 摇摆，peek 探头，' +
  'bow 鞠躬，spin 转圈，sleep 睡觉，wake 醒来，dockLeft 靠左收起，dockRight 靠右收起，restore 离开边缘。' +
  '用户没有明确要求、只是引用一句话、或请求不支持的功能时 action 为 none。动作由球球在回复完成后执行，' +
  '因此用“好呀，转给你看”等表达，不要提前声称动作已经完成。';

function chatError(code) {
  const safe = ERROR_CODES.includes(code) ? code : 'DISCONNECTED';
  return Object.assign(new Error(safe), { code: safe });
}
function errorCode(raw) {
  if (raw?.code === 401 || raw?.code === 403 || raw?.codexErrorInfo === 'unauthorized') return 'UNAUTHENTICATED';
  if (raw?.code === 429 || ['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(raw?.codexErrorInfo)) return 'RATE_LIMITED';
  if (raw?.codexErrorInfo === 'contextWindowExceeded') return 'CONTEXT_LIMIT';
  if (raw?.code === 404) return 'THREAD_NOT_FOUND';
  if (raw?.code === -32600 && /already has an active writer/.test(raw.message || '')) return 'THREAD_BUSY';
  if (raw?.code === -32601 || raw?.code === -32602) return 'UNSUPPORTED';
  return 'DISCONNECTED';
}
function isId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
function boundedText(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw chatError('INVALID_FRAME');
  return value;
}
function projectAccount(raw) {
  if (raw?.account === null) return { accountKey: null, authenticated: false };
  const account = raw?.account;
  if (account?.type !== 'chatgpt' || typeof account.email !== 'string' || !account.email.trim()) throw chatError('UNSUPPORTED');
  return { accountKey: createHash('sha256').update(`chatgpt:${account.email.trim().toLowerCase()}`).digest('hex'), authenticated: true };
}
function projectTurn(raw) {
  if (!isId(raw?.id) || !['inProgress', 'completed', 'interrupted', 'failed'].includes(raw.status)) throw chatError('INVALID_FRAME');
  return { id: raw.id, status: raw.status, ...(raw.error ? { errorCode: errorCode(raw.error) } : {}) };
}
function finishNativeClose(target) {
  const ignore = () => {};
  target.once('error', ignore);
  target.once('close', () => target.removeListener('error', ignore));
}

function createCodexChatRpc({ workspaceDir, fs = nodeFs, spawn = nodeSpawn, homedir = os.homedir, env = process.env,
  timeoutMs = 15000, maxFrameBytes = MAX_FRAME_BYTES, onNotification = () => {}, onDisconnect = () => {} } = {}) {
  if (typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0')) throw chatError('INVALID_INPUT');
  const cwd = path.resolve(workspaceDir);
  const defaultCodexHome = path.join(homedir(), '.codex');
  const globalInstructionPaths = new Set(['AGENTS.md', 'AGENTS.override.md'].map(name => path.join(defaultCodexHome, name)));
  const timeout = Math.max(1, Math.min(30000, Number(timeoutMs) || 15000));
  const frameLimit = Math.max(1, Math.min(MAX_FRAME_BYTES, Number(maxFrameBytes) || MAX_FRAME_BYTES));
  const pending = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let child = null, closed = false, ready = false, safetyReady = false, starting = null, startReject = null, startTimer = null;
  let nextId = 0, chunks = [], buffered = 0, accountKey = null, threadAccountKey = null, accountRevision = 0;
  let accountObserved = false;
  let threadId = null, threadRequest = false;
  let closing = null;
  let activeTurnId = null, turnPending = false, threadStatus = 'idle', mcpNames = [];
  const completedBeforeReply = new Set();
  const ensureOpen = () => { if (closed) throw chatError('CLOSED'); };
  const emit = packet => { try { onNotification(packet); } catch { /* UI callbacks cannot break framing. */ } };

  function shutdown(code = 'CLOSED') {
    if (closed) return closing || Promise.resolve();
    closed = true; ready = false; safetyReady = false;
    clearTimeout(startTimer); startTimer = null;
    startReject?.(chatError(code)); startReject = null;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(chatError(code)); }
    pending.clear(); chunks = []; buffered = 0;
    if (child) {
      const owned = child; child = null;
      owned.stdout.removeListener('data', onData);
      owned.stdout.removeListener('error', onFailure);
      owned.stdin.removeListener('error', onFailure);
      owned.stderr.removeListener('error', onFailure);
      owned.removeListener('error', onFailure); owned.removeListener('exit', onFailure);
      for (const target of [owned, owned.stdin, owned.stdout, owned.stderr]) finishNativeClose(target);
      closing = new Promise(resolve => {
        let termTimer, killTimer, endTimer;
        const done = () => {
          clearTimeout(termTimer); clearTimeout(killTimer); clearTimeout(endTimer);
          owned.removeListener('exit', done); owned.removeListener('close', done);
          resolve();
        };
        const kill = signal => { try { if (Number.isSafeInteger(owned.pid) && owned.pid > 0) owned.kill(signal); } catch { done(); } };
        owned.once('exit', done); owned.once('close', done);
        if (code === 'CLOSED') {
          // EOF lets Codex flush the rollout and release its writer ownership.
          // Give normal shutdown a chance before escalating only our own process.
          termTimer = setTimeout(() => kill('SIGTERM'), 1500);
          killTimer = setTimeout(() => kill('SIGKILL'), 3500);
          endTimer = setTimeout(done, 4000);
          try { owned.stdin.end(); } catch { kill('SIGTERM'); }
          owned.stdout.resume();
        } else {
          endTimer = setTimeout(done, 1000);
          kill('SIGKILL');
        }
      });
    } else {
      closing = Promise.resolve();
    }
    if (code !== 'CLOSED') { try { onDisconnect(code); } catch { /* no diagnostic content escapes */ } }
    return closing;
  }
  function onFailure() { shutdown('DISCONNECTED'); }
  function write(packet) {
    try { child.stdin.write(JSON.stringify(packet) + '\n'); } catch { shutdown('DISCONNECTED'); }
  }

  function notification(method, params) {
    if (method === 'account/updated') {
      accountKey = null; accountRevision++;
      // Initial account/read can itself announce the loaded login. There is no
      // previously verified identity to invalidate yet; readAccount confirms it
      // again below before authorizing any thread or model request.
      if (accountObserved) emit({ method, params: {} });
      return;
    }
    if (!params || params.threadId !== threadId) return;
    if (method === 'turn/started' || method === 'turn/completed') {
      const turn = projectTurn(params.turn);
      if (method === 'turn/started') { activeTurnId = turn.id; threadStatus = 'active'; }
      else {
        if (turnPending) {
          if (completedBeforeReply.size >= 8) throw chatError('INVALID_FRAME');
          completedBeforeReply.add(turn.id);
        }
        if (activeTurnId === turn.id || turnPending) { activeTurnId = null; threadStatus = 'idle'; }
      }
      emit({ method, params: { threadId, turn } });
    } else if (method === 'item/agentMessage/delta') {
      if (!isId(params.turnId) || !isId(params.itemId)) throw chatError('INVALID_FRAME');
      emit({ method, params: { threadId, turnId: params.turnId, itemId: params.itemId, delta: boundedText(params.delta) } });
    } else if (method === 'item/completed' || method === 'item/started') {
      if (!isId(params.turnId) || !isId(params.item?.id)) throw chatError('INVALID_FRAME');
      const item = params.item;
      if (!['agentMessage', 'userMessage', 'reasoning', 'contextCompaction'].includes(item.type)) {
        shutdown('TOOL_BLOCKED'); return;
      }
      if (item.type !== 'agentMessage') return;
      emit({ method, params: { threadId, turnId: params.turnId,
        item: { id: item.id, type: item.type, text: boundedText(item.text),
          phase: ['commentary', 'final_answer'].includes(item.phase) ? item.phase : null } } });
    } else if (method === 'error') {
      if (!isId(params.turnId)) throw chatError('INVALID_FRAME');
      emit({ method, params: { threadId, turnId: params.turnId,
        error: { code: errorCode(params.error) }, willRetry: params.willRetry === true } });
    }
  }

  function receive(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw chatError('INVALID_FRAME');
    if (typeof packet.method === 'string') {
      if (Object.hasOwn(packet, 'id')) {
        // Chat has no approval or dynamic-tool UI. Never acknowledge execution or relay arguments.
        write({ id: packet.id, error: { code: -32601, message: 'Chat tools are disabled' } });
        shutdown('TOOL_BLOCKED'); return;
      }
      notification(packet.method, packet.params); return;
    }
    const entry = pending.get(packet.id);
    if (!entry) return;
    pending.delete(packet.id); clearTimeout(entry.timer);
    if (packet.error) { entry.reject(chatError(errorCode(packet.error))); return; }
    if (!Object.hasOwn(packet, 'result')) { entry.reject(chatError('INVALID_FRAME')); return; }
    try { entry.resolve(entry.project(packet.result)); } catch (error) { entry.reject(chatError(error.code)); }
  }
  function onData(input) {
    if (closed) return;
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0, frames = 0;
    while (offset < data.length && !closed) {
      const end = data.indexOf(10, offset), stop = end < 0 ? data.length : end;
      const size = stop - offset;
      if (buffered + size > frameLimit || ++frames > 1024) { shutdown('INVALID_FRAME'); return; }
      if (size) { chunks.push(Buffer.from(data.subarray(offset, stop))); buffered += size; }
      offset = end < 0 ? data.length : end + 1;
      if (end < 0) break;
      const frame = Buffer.concat(chunks, buffered); chunks = []; buffered = 0;
      if (!frame.length) continue;
      try { receive(JSON.parse(decoder.decode(frame))); } catch { shutdown('INVALID_FRAME'); }
    }
  }
  function request(method, params, project = () => undefined, { fatalTimeout = true } = {}) {
    if (closed) return Promise.reject(chatError('CLOSED'));
    if (!METHODS.has(method)) return Promise.reject(chatError('UNSUPPORTED'));
    if (!child || (method !== 'initialize' && !ready)) return Promise.reject(chatError('DISCONNECTED'));
    if (pending.size >= 8) return Promise.reject(chatError('BUSY'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      // A timed-out mutation may already have succeeded. Close; never resend/start a replacement.
      const timer = setTimeout(() => {
        if (fatalTimeout) shutdown('TIMEOUT');
        else { pending.delete(id); reject(chatError('TIMEOUT')); }
      }, timeout);
      pending.set(id, { resolve, reject, timer, project });
      write({ id, method, params });
    });
  }
  async function discover() {
    const home = homedir();
    const candidates = ['/Applications/Codex.app', '/Applications/ChatGPT.app',
      path.join(home, 'Applications/Codex.app'), path.join(home, 'Applications/ChatGPT.app')]
      .map(app => path.join(app, 'Contents/Resources/codex'));
    for (const file of candidates) {
      ensureOpen();
      try {
        const stat = await fs.promises.lstat(file); ensureOpen();
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        await fs.promises.access(file, nodeFs.constants.X_OK); ensureOpen(); return file;
      } catch { if (closed) throw chatError('CLOSED'); }
    }
    throw chatError('MISSING');
  }
  function start() {
    if (closed) return Promise.reject(chatError('CLOSED'));
    if (starting) return starting;
    const cancelled = new Promise((resolve, reject) => { startReject = reject; });
    startTimer = setTimeout(() => shutdown('TIMEOUT'), timeout);
    const connect = (async () => {
      // Sharing the user's default Codex login also retains its built-in global
      // preferences provider. Do not silently accept another profile/home.
      if (env.CODEX_HOME !== undefined && (typeof env.CODEX_HOME !== 'string' ||
        !path.isAbsolute(env.CODEX_HOME) || path.resolve(env.CODEX_HOME) !== defaultCodexHome)) throw chatError('UNSAFE_CONFIG');
      const binary = await discover(); ensureOpen();
      const overrides = [...DISABLED_FEATURES.map(name => `features.${name}=false`),
        'web_search="disabled"', 'project_doc_max_bytes=0', 'skills.include_instructions=false',
        'features.skip_host_skill_discovery=true'];
      child = spawn(binary, ['app-server', '--stdio', ...overrides.flatMap(value => ['-c', value])],
        { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.on('error', onFailure); child.on('exit', onFailure);
      child.stdout.on('data', onData); child.stdout.on('error', onFailure);
      child.stdin.on('error', onFailure); child.stderr.on('error', onFailure); child.stderr.resume();
      await request('initialize', { clientInfo: { name: 'qiuqiu-chat', version: '1.0.0' },
        capabilities: { experimentalApi: true } }); ensureOpen();
      write({ method: 'initialized', params: {} }); ready = true;
      mcpNames = await request('config/read', { includeLayers: false }, raw => {
        const config = raw?.config;
        if (!config || DISABLED_FEATURES.some(name => config.features?.[name] !== false) ||
          config.web_search !== 'disabled' || config.project_doc_max_bytes !== 0) throw chatError('UNSAFE_CONFIG');
        if (config.mcp_servers !== undefined && (!config.mcp_servers || typeof config.mcp_servers !== 'object' || Array.isArray(config.mcp_servers))) throw chatError('UNSAFE_CONFIG');
        const names = Object.keys(config.mcp_servers || {});
        if (names.length > 200 || names.some(name => !name || name.length > 256 || /[\x00-\x1f]/.test(name))) throw chatError('UNSAFE_CONFIG');
        return names;
      });
      safetyReady = true;
    })();
    starting = Promise.race([connect, cancelled]).catch(error => { shutdown(error.code); throw chatError(error.code); })
      .finally(() => { clearTimeout(startTimer); startTimer = null; startReject = null; });
    return starting;
  }

  function threadParams() {
    return { cwd, sandbox: 'read-only', approvalPolicy: 'never', baseInstructions: CHAT_INSTRUCTIONS,
      developerInstructions: CHAT_INSTRUCTIONS, config: {
        mcp_servers: Object.fromEntries(mcpNames.map(name => [name, { enabled: false }])),
        features: Object.fromEntries([...DISABLED_FEATURES.map(name => [name, false]), ['skip_host_skill_discovery', true]]),
        web_search: 'disabled', project_doc_max_bytes: 0, skills: { include_instructions: false }
      } };
  }
  function projectThread(raw, expectedId) {
    if (!isId(raw?.thread?.id) || (expectedId && raw.thread.id !== expectedId)) throw chatError('INVALID_FRAME');
    const environments = raw.thread.environments;
    const emptyEnvironment = Array.isArray(environments) && environments.length === 0;
    // Current app-server resume restores its default local selection and has no
    // environment setter. Accept only this exact chat workspace as idle metadata;
    // startTurn supplies [] before start_or_steer_turn constructs the model turn.
    // https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/turn_processor.rs
    const resumeLocal = expectedId && Array.isArray(environments) && environments.length === 1 &&
      environments[0]?.environmentId === 'local' && environments[0].cwd === cwd &&
      Array.isArray(environments[0].runtimeWorkspaceRoots) && environments[0].runtimeWorkspaceRoots.length === 1 &&
      environments[0].runtimeWorkspaceRoots[0] === cwd;
    if ((!emptyEnvironment && !resumeLocal) ||
      raw.sandbox?.type !== 'readOnly' || raw.sandbox.networkAccess === true || raw.approvalPolicy !== 'never' ||
      raw.cwd !== cwd || !Array.isArray(raw.instructionSources) ||
      raw.instructionSources.some(source => !globalInstructionPaths.has(source))) throw chatError('UNSAFE_CONFIG');
    threadId = raw.thread.id;
    threadAccountKey = accountKey;
    const active = Array.isArray(raw.thread.turns) ? raw.thread.turns.find(turn => turn.status === 'inProgress') : null;
    activeTurnId = isId(active?.id) ? active.id : null;
    threadStatus = activeTurnId || raw.thread.status?.type === 'active' ? 'active' : 'idle';
    return { id: threadId, status: threadStatus, activeTurnId };
  }
  async function loadThread(id) {
    ensureOpen();
    if (!safetyReady) throw chatError('UNSAFE_CONFIG');
    if (!accountKey) throw chatError('UNAUTHENTICATED');
    if (threadRequest || threadId) throw chatError('BUSY');
    if (id !== undefined && !isId(id)) throw chatError('INVALID_INPUT');
    threadRequest = true;
    try {
      const result = await request(id === undefined ? 'thread/start' : 'thread/resume',
        { ...threadParams(), ...(id === undefined ? { ephemeral: false, environments: [], dynamicTools: [] }
          : { threadId: id, excludeTurns: true }) }, raw => projectThread(raw, id));
      return result;
    } finally { threadRequest = false; }
  }
  async function startTurn(id, text) {
    ensureOpen();
    if (!safetyReady) throw chatError('UNSAFE_CONFIG');
    if (!isId(id) || id !== threadId || typeof text !== 'string' || !text.trim() || text.length > 8000) throw chatError('INVALID_INPUT');
    if (!accountKey || accountKey !== threadAccountKey) throw chatError('UNAUTHENTICATED');
    if (turnPending || threadStatus === 'active') throw chatError('BUSY');
    turnPending = true;
    completedBeforeReply.clear();
    // Notifications may arrive before the turn/start response. Do not regress a completed turn.
    try {
      return await request('turn/start', { threadId: id, input: [{ type: 'text', text }], cwd,
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
        environments: [], outputSchema: CHAT_OUTPUT_SCHEMA }, raw => {
        const turn = projectTurn(raw?.turn);
        if (!completedBeforeReply.has(turn.id) && turn.status === 'inProgress') { activeTurnId = turn.id; threadStatus = 'active'; }
        return turn;
      });
    } finally { turnPending = false; completedBeforeReply.clear(); }
  }
  function readThreadEnvironment() {
    if (!threadId) return Promise.reject(chatError('INVALID_INPUT'));
    return request('thread/read', { threadId, includeTurns: false }, raw => {
      const environments = raw?.thread?.environments;
      if (raw?.thread?.id !== threadId || !Array.isArray(environments)) throw chatError('UNSAFE_CONFIG');
      if (!environments.length) return { environments: [] };
      const selected = environments[0];
      if (environments.length !== 1 || selected?.environmentId !== 'local' || selected.cwd !== cwd ||
        !Array.isArray(selected.runtimeWorkspaceRoots) || selected.runtimeWorkspaceRoots.length !== 1 ||
        selected.runtimeWorkspaceRoots[0] !== cwd) throw chatError('UNSAFE_CONFIG');
      return { environments: [{ environmentId: 'local', cwd, runtimeWorkspaceRoots: [cwd] }] };
    });
  }

  return { start,
    readAccount: async () => {
      accountKey = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const revision = accountRevision;
        const projected = await request('account/read', { refreshToken: false }, raw =>
          revision === accountRevision ? projectAccount(raw) : null);
        if (!projected || revision !== accountRevision) continue;
        accountObserved = true; accountKey = projected.accountKey;
        return projected;
      }
      throw chatError('UNAUTHENTICATED');
    },
    startThread: () => loadThread(), resumeThread: id => loadThread(id), startTurn,
    nameThread: id => {
      if (!isId(id) || id !== threadId) return Promise.reject(chatError('INVALID_INPUT'));
      return request('thread/name/set', { threadId: id, name: '和球球聊天' }, () => undefined, { fatalTimeout: false });
    },
    readThreadEnvironment,
    verifyThreadEnvironment: async id => {
      if (!isId(id) || id !== threadId) return Promise.reject(chatError('INVALID_INPUT'));
      const state = await readThreadEnvironment();
      if (state.environments.length) throw chatError('UNSAFE_CONFIG');
      return { id, environmentsDisabled: true };
    },
    interruptTurn: (id, turnId) => {
      if (!isId(id) || id !== threadId || !isId(turnId)) return Promise.reject(chatError('INVALID_INPUT'));
      return request('turn/interrupt', { threadId: id, turnId });
    },
    close: () => shutdown()
  };
}

module.exports = { createCodexChatRpc, chatError, ERROR_CODES, MAX_FRAME_BYTES, DISABLED_FEATURES, CHAT_OUTPUT_SCHEMA };
