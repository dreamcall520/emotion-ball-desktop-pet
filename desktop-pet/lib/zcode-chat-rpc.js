const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createZcodeProtocol } = require('./zcode-protocol');
const { readZcodeAccount } = require('./zcode-account');
const { requestOfficialJson, fetchZcodeUsage, resolveZcodeTeamAccount } = require('./zcode-usage');
const { teamContext, teamAccountScope, isTeam } = require('./zcode-team-auth');
const { isModelId } = require('./chat-models');
const fail = code => Object.assign(new Error(code), { code });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const CHAT_INSTRUCTIONS = '你是桌面宠物球球，用简短自然的简体中文陪用户聊天，一般一两句话。' +
  '只能聊天，不执行命令、不调用工具、不读取文件或其他会话，不声称做过未经确认的操作。' +
  '只输出JSON对象，严格包含text和action两个字段，例如{"text":"你好呀！","action":"none"}。' +
  'action仅可为none、hop、jelly、sway、peek、bow、spin、sleep、wake、dockLeft、dockRight、restore。' +
  '只有用户本次明确要求球球做动作才选择对应动作，否则为none。动作在回复完成后本地执行，不能提前声称完成。';
const SAFE_CONFIG = Object.freeze({ features: { subagent: false, memory: false, skill: false, mcp: false, rewind: false },
  memory: { use: false }, plugins: { enabled: false }, skills: { enabled: false, includeInstructions: false },
  hooks: { enabled: false, events: {} }, mcp: { servers: {} }, permission: { mode: 'guarded', allowedTools: [] } });
function readJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024 || stat.isSymbolicLink()) throw fail('UNSAFE_CONFIG');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function prepareZcodeRuntime({ workspaceDir, account, env = process.env, home = os.homedir() }) {
  if (!path.isAbsolute(workspaceDir) || workspaceDir.includes('\0')) throw fail('INVALID_INPUT');
  const app = ['/Applications/ZCode.app', path.join(home, 'Applications/ZCode.app')].find(candidate =>
    fs.existsSync(path.join(candidate, 'Contents/Resources/glm/zcode.cjs')));
  if (!app) throw fail('MISSING');
  const binary = path.join(app, 'Contents/Resources/glm/zcode.cjs');
  if (fs.lstatSync(binary).isSymbolicLink() || !fs.statSync(binary).isFile()) throw fail('UNSAFE_CONFIG');
  const plist = fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8');
  const appVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>([\d.]+)<\/string>/.exec(plist)?.[1];
  if (!appVersion) throw fail('UNSUPPORTED');
  const base = account.baseDir || home;
  const bundledPath = path.join(app, 'Contents/Resources/config/provider/zcode-builtin.json');
  let builtinPath = bundledPath, release = readJson(bundledPath);
  const cachedRoot = path.join(base, '.zcode/v2/runtime/provider', `${process.platform}-${process.arch}`, appVersion);
  try {
    const endpointKey = `endpoint-${createHash('sha256').update('https://zcode.z.ai').digest('hex').slice(0, 32)}`;
    const candidate = path.join(cachedRoot, endpointKey, 'zcode-builtin.json');
    const value = readJson(candidate);
    if (value.revision > release.revision) { release = value; builtinPath = candidate; }
  } catch {}
  // Hooks merge with OR in ZCode; a local false cannot disable enabled global hooks.
  const globalConfig = path.join(home, '.zcode/cli/config.json');
  if (fs.existsSync(globalConfig) && readJson(globalConfig).hooks?.enabled === true) throw fail('UNSAFE_CONFIG');
  for (const target of [workspaceDir, path.join(workspaceDir, '.git'), path.join(workspaceDir, '.zcode'), path.join(workspaceDir, 'runtime'), path.join(workspaceDir, '.zcode/config.json'), path.join(workspaceDir, '.zcode/provider-config.json')]) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw fail('UNSAFE_CONFIG');
  }
  fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(workspaceDir, '.git'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(workspaceDir, '.zcode'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(workspaceDir, '.zcode/config.json'), JSON.stringify(SAFE_CONFIG), { mode: 0o600 });
  const personalPath = path.join(workspaceDir, '.zcode/provider-config.json');
  fs.writeFileSync(personalPath, JSON.stringify({ schemaVersion: 1, config: {
    providerConfigRules: { providerRules: [] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }
  } }), { mode: 0o600 });
  const storage = path.join(workspaceDir, 'runtime'); fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('ZCODE_') &&
    !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
  Object.assign(childEnv, { ZCODE_STORAGE_DIR: storage, ZCODE_SESSION_DB_PATH: path.join(storage, 'db.sqlite'),
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinPath, ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
    ZCODE_DYNAMIC_WORKFLOW_MODE: 'disabled', ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED: 'false',
    ZCODE_TELEMETRY_DEVICE_MID: account.deviceMid || '', ZCODE_APP_VERSION: appVersion });
  return { binary, release, builtinPath, appVersion, env: childEnv };
}
function projectZcodeModels(release, { family, kind, modelIds }) {
  const providerId = `account:${family}-${kind}`;
  const rule = release?.config?.providerConfigRules?.providerRules?.find(row => row.providerId === providerId);
  if (!rule || !Array.isArray(rule.config?.builtinModelIds)) throw fail('MODELS_UNAVAILABLE');
  const officialIds = [...release.config.providerConfigRules.providerRules, ...release.config.providerConfigRules.templateRules || []]
    .flatMap(entry => entry.config?.builtinModelIds || []);
  const sourceIds = Array.isArray(modelIds) && modelIds.length ? modelIds : rule.config.builtinModelIds;
  const canonical = [...new Set(sourceIds.filter(isModelId).map(id => officialIds.find(known => known.toLowerCase() === id.toLowerCase()) || id))];
  return canonical.slice(0, 100).map(modelId => {
    let efforts = [];
    for (const entry of release.config.modelConfigRules?.modelRules || []) {
      try { if (new RegExp(entry.modelMatch, 'i').test(modelId) && Array.isArray(entry.config?.optionSpecs?.reasoningLevel?.values))
        efforts = entry.config.optionSpecs.reasoningLevel.values.filter(value => typeof value === 'string' && /^[a-z]{1,16}$/.test(value)); } catch {}
    }
    if (!efforts.length) efforts = ['none'];
    return { id: `zcode-${kind}-${modelId}`, displayName: `${modelId}${kind === 'start-plan' ? ' · 体验/活动' : kind === 'team-coding-plan' ? ' · 团队 Coding Plan' : ' · Coding Plan'}`,
      supportedReasoningEfforts: efforts, defaultReasoningEffort: efforts[0], isDefault: /flash/i.test(modelId), providerId, modelId };
  });
}
function resolveZcodeChatModel(models, selection) {
  const available = Array.isArray(models) ? models.filter(row => isModelId(row?.id)) : [];
  const automatic = !selection || selection === 'auto';
  const model = automatic ? available.find(row => row.isDefault) || available[0] : available.find(row => row.id === selection);
  if (!model) throw fail(automatic ? 'MODELS_UNAVAILABLE' : 'MODEL_UNAVAILABLE');
  return { model: model.id, effort: model.defaultReasoningEffort || 'none', displayName: model.displayName, automatic, reason: automatic ? 'chat' : 'manual' };
}
function requiresVerification(config) { return !config || config.enabled !== false && config.skip_model_request !== true; }
function createZcodeChatRpc({ workspaceDir, env = process.env, home = os.homedir(), readAccount = readZcodeAccount,
  prepareRuntime = prepareZcodeRuntime, createProtocol = createZcodeProtocol, requestJson = requestOfficialJson,
  fetchUsage = fetchZcodeUsage, resolveTeamAccount = resolveZcodeTeamAccount,
  onNotification = () => {}, onDisconnect = () => {}, ...transportOptions } = {}) {
  if (typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir)) throw fail('INVALID_INPUT');
  let protocol, starting, account, runtime, catalog = [], threadId, activeTurn, revision = 0, closed = false;
  function emit(method, params) { onNotification({ method, params: { threadId, ...params } }); }
  function notification(packet) {
    if (packet.method !== 'session/event' || packet.params?.sessionId !== threadId || !activeTurn) return;
    const event = packet.params, payload = event.payload || {}, turn = activeTurn;
    if (payload.inputId && payload.inputId !== turn.id) return;
    if (['tool.updated', 'permission.requested', 'userInput.requested'].includes(event.type) ||
      event.type === 'model.streaming' && /^(tool_|tool\.)/.test(payload.kind || '')) {
      void protocol.close(); activeTurn = null; onDisconnect('TOOL_BLOCKED'); return;
    }
    if (event.type === 'turn.started') emit('turn/started', { turn: { id: turn.id, status: 'inProgress' } });
    else if (event.type === 'model.streaming' && payload.kind === 'text_delta' && typeof payload.delta === 'string') {
      if (payload.delta.length > 128 * 1024) { void protocol.close(); onDisconnect('INVALID_FRAME'); return; }
      emit('item/agentMessage/delta', { turnId: turn.id, itemId: turn.id, delta: payload.delta });
    } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      const response = payload.response;
      if (typeof response === 'string' && response.length <= 128 * 1024) emit('item/completed',
        { turnId: turn.id, item: { id: turn.id, type: 'agentMessage', text: response, phase: 'final_answer' } });
      const status = event.type === 'turn.failed' ? 'failed' : payload.resultType === 'cancelled' ? 'interrupted'
        : payload.resultType === 'success' ? 'completed' : 'failed';
      activeTurn = null; emit('turn/completed', { turn: { id: turn.id, status, ...(status === 'failed' ? { errorCode: 'TURN_FAILED' } : {}) } });
    }
  }
  async function currentAccount() {
    const latest = await readAccount({ home, env });
    if (!latest?.accountKey || !(isTeam(latest) ? latest.accessToken : latest.jwtToken)) throw fail('UNAUTHENTICATED');
    if (account && latest.accountKey !== account.accountKey) { account = latest; catalog = []; emit('account/updated', {}); throw fail('UNAUTHENTICATED'); }
    account = latest; return account;
  }
  function sameRuntimeAccount(before, latest, scope = isTeam(before) ? teamAccountScope(before) : null) {
    return before.accountKey === latest.accountKey && before.accountId === latest.accountId && before.accessToken === latest.accessToken && before.jwtToken === latest.jwtToken &&
      (scope === null ? !isTeam(latest) : isTeam(latest) && scope === teamAccountScope(latest));
  }
  async function runtimeAccount(params = {}) {
    if (closed) throw fail('CLOSED');
    const before = await currentAccount();
    const scope = isTeam(before) ? teamAccountScope(before) : null;
    const { expectedAccountScope, rejectedProjectTokenFingerprint } = params;
    if (scope !== null && (expectedAccountScope !== undefined && expectedAccountScope !== scope ||
      rejectedProjectTokenFingerprint !== undefined && (expectedAccountScope === undefined ||
        typeof rejectedProjectTokenFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(rejectedProjectTokenFingerprint)))) throw fail('UNAUTHENTICATED');
    if (closed) throw fail('CLOSED');
    const resolved = await resolveTeamAccount(before, { appVersion: runtime.appVersion,
      ...(scope !== null ? { expectedAccountScope, rejectedProjectTokenFingerprint } : {}) });
    const latest = await currentAccount();
    if (closed) throw fail('CLOSED');
    if (!sameRuntimeAccount(before, latest, scope) || scope !== null && resolved.codingPlanAccountScope !== scope) throw fail('UNAUTHENTICATED');
    return resolved;
  }
  async function serverRequest(method, params) {
    if (method === 'session/requestRuntimePreferences') return { additionalDirectories: [], nativeSearchEnhancementsEnabled: false,
      toolSearchMode: 'off', subagentRuntimeConfigEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false };
    if (method !== 'interaction/requestProviderRuntimeHeaders' || params?.sessionId !== threadId) return undefined;
    const model = catalog.find(row => row.providerId === params.providerId);
    if (!model) throw fail('UNAUTHENTICATED');
    const selected = await runtimeAccount(params);
    const headers = { 'HTTP-Referer': 'https://zcode.z.ai', 'User-Agent': `ZCode/${runtime.appVersion}`,
      'X-ZCode-App-Version': runtime.appVersion, 'X-Title': 'Z Code@electron', 'X-Platform': `${process.platform}-${process.arch}`,
      'X-Client-Language': 'zh-CN', 'X-Client-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(selected.deviceMid ? { 'X-Device-Mid': selected.deviceMid } : {}) };
    if (model.providerId.endsWith('-start-plan')) {
      const config = await requestJson(`https://zcode.z.ai/api/v1/client/configs?app_version=${encodeURIComponent(runtime.appVersion)}&platform=${process.platform}-${process.arch}`);
      const latest = await currentAccount();
      if (closed || selected.accountKey !== latest.accountKey || selected.jwtToken !== latest.jwtToken) throw fail('UNAUTHENTICATED');
      if (config.code !== 0 || requiresVerification(config.data?.configs?.captcha)) throw fail('VERIFICATION_REQUIRED');
      return { headersApplied: true, requestAuth: { apiKey: selected.jwtToken, headers } };
    }
    if (!selected.codingPlanApiKey) throw fail('UNAUTHENTICATED');
    const requestAuth = { apiKey: selected.codingPlanApiKey, headers };
    if (isTeam(selected)) {
      Object.assign(headers, teamContext(selected).headers);
      Object.assign(requestAuth, { apiKeyId: selected.codingPlanApiKeyId, accountScope: selected.codingPlanAccountScope });
    }
    return { headersApplied: true, requestAuth };
  }
  async function start() {
    if (closed) throw fail('CLOSED');
    if (starting) return starting;
    const operation = (async () => {
      await currentAccount(); runtime = await prepareRuntime({ workspaceDir, account, env, home });
      if (closed) throw fail('CLOSED');
      protocol = createProtocol({ ...transportOptions, binary: runtime.binary, cwd: workspaceDir, env: runtime.env,
        onRequest: serverRequest, onNotification: notification, onDisconnect });
      await protocol.start(); await protocol.request('runtime/capabilities', {});
    })().catch(async error => {
      await protocol?.close(); protocol = null;
      if (starting === operation) starting = null;
      throw fail(error?.code || 'DISCONNECTED');
    });
    starting = operation;
    return operation;
  }
  async function listModels() {
    await currentAccount();
    if (!runtime) throw fail('DISCONNECTED');
    catalog = [];
    const selected = await runtimeAccount();
    const usage = await fetchUsage(selected);
    await currentAccount();
    if (closed) throw fail('CLOSED');
    if (!sameRuntimeAccount(selected, account)) throw fail('UNAUTHENTICATED');
    const hasBalance = usage.buckets?.some(row => row.source !== 'coding-plan' && row.remaining > 0);
    const kind = isTeam(selected) ? selected.codingPlanApiKey && ['connected', 'empty'].includes(usage.paidState) ? 'team-coding-plan' : null
      : hasBalance ? 'start-plan' : selected.codingPlanApiKey && usage.paidState === 'connected' ? 'individual-coding-plan' : null;
    if (!kind) throw fail('MODELS_UNAVAILABLE');
    catalog = projectZcodeModels(runtime.release, { family: account.family, kind, ...(kind === 'start-plan' ? { modelIds: usage.modelIds } : {}) });
    const providerId = catalog[0]?.providerId;
    if (!providerId) throw fail('MODELS_UNAVAILABLE');
    const basedOnZCodeBuiltinRevision = `zcode-builtin:${runtime.release.revision}:${createHash('sha256').update(path.resolve(runtime.builtinPath)).digest('hex')}`;
    await protocol.request('provider/updateAccountConfig', { revision: `qiuqiu:${account.accountKey}:${++revision}`, basedOnZCodeBuiltinRevision,
      providers: { [providerId]: { access: { type: 'zhipu-account', entitled: true },
        ...(kind === 'start-plan' ? { builtinModelIds: catalog.map(row => row.modelId) } : {}) } },
      states: { [providerId]: { availability: 'available', entitled: true, current: true } } });
    await currentAccount();
    if (closed || !sameRuntimeAccount(selected, account)) {
      catalog = []; throw fail(closed ? 'CLOSED' : 'UNAUTHENTICATED');
    }
    return catalog.map(({ providerId: _provider, modelId: _model, ...row }) => row);
  }
  async function loadThread(id) {
    await currentAccount();
    if (threadId || id !== undefined && !validId(id)) throw fail('INVALID_INPUT');
    const params = { ...(id ? { sessionId: id } : { mode: 'guarded', titleGenerationEnabled: false }),
      workspace: { workspacePath: workspaceDir, workspaceKey: workspaceDir }, additionalDirectories: [], toolAllowlist: [], mcpServers: [],
      offPeakToolEnabled: false, dynamicWorkflowEnabled: false, dynamicWorkflowMode: 'disabled' };
    const snapshot = await protocol.request(id ? 'session/resume' : 'session/create', params);
    if (!validId(snapshot.session?.sessionId) || id && snapshot.session.sessionId !== id ||
      snapshot.session.workspace?.workspacePath !== workspaceDir || snapshot.settings?.permission?.mode !== 'guarded') throw fail('UNSAFE_CONFIG');
    threadId = snapshot.session.sessionId;
    await protocol.request('session/subscribe', { sessionId: threadId, deliveryKind: 'desktop-continuous',
      afterSeq: snapshot.runtime?.eventSeq || 0, includeSnapshot: false });
    return { id: threadId, status: snapshot.runtime?.activeTurnId ? 'active' : 'idle', activeTurnId: snapshot.runtime?.activeTurnId || null };
  }
  async function startTurn(id, text, selection) {
    await currentAccount();
    if (!validId(id) || id !== threadId || typeof text !== 'string' || !text.trim() || text.length > 8000 || text.includes('\0')) throw fail('INVALID_INPUT');
    if (activeTurn) throw fail('BUSY');
    const model = catalog.find(row => row.id === selection?.model);
    if (!model || !model.supportedReasoningEfforts.includes(selection.effort)) throw fail('MODEL_UNAVAILABLE');
    const turn = { id: `turn_${randomUUID()}`, status: 'inProgress' }; activeTurn = turn;
    try {
      await protocol.request('session/send', { sessionId: threadId, inputId: turn.id, queryId: turn.id,
        content: `${CHAT_INSTRUCTIONS}\n\n用户本次消息：\n${text}`,
        modelSelection: { providerId: model.providerId, modelId: model.modelId, ...(selection.effort !== 'none' ? { options: { reasoningLevel: selection.effort } } : {}) },
        modelExecution: { selectionScope: 'execution', memoryExtraction: 'skip', subagents: { foregroundModel: 'submission', background: 'deny' } } });
      return turn;
    } catch (error) { activeTurn = null; throw error; }
  }
  return { start, listModels, readAccount: async () => { await currentAccount(); return { authenticated: true, accountKey: account.accountKey }; },
    startThread: () => loadThread(), resumeThread: loadThread, startTurn,
    interruptTurn: async (id, turnId) => {
      if (id !== threadId || !activeTurn || turnId !== activeTurn.id) throw fail('INVALID_INPUT');
      await protocol.request('session/stop', { sessionId: threadId });
    }, close: async () => { closed = true; await protocol?.close(); } };
}
module.exports = { createZcodeChatRpc, resolveZcodeChatModel, projectZcodeModels, requiresVerification, prepareZcodeRuntime, SAFE_CONFIG };
