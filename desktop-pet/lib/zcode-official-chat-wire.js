'use strict';
const fail = code => Object.assign(new Error(code), { code });
const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validModel = value => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,256}$/.test(value);
const cleanText = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const METHODS = new Set(['start', 'readAccount', 'listModels', 'startThread', 'resumeThread', 'startTurn', 'interruptTurn', 'getConsentIdentity']);
const SAFE_ERRORS = new Set(['INVALID_REQUEST', 'INVALID_INPUT', 'INVALID_FRAME', 'DIRECTORY_ACCESS_REQUIRED', 'UNSAFE_CONFIG',
  'CHAT_AUTHORIZATION_REQUIRED', 'ZCODE_ACCOUNT_CHANGED', 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY', 'ZCODE_ACCOUNT_MISSING',
  'ZCODE_INVALID_ACCOUNT_FILE', 'ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED', 'ZCODE_CREDENTIAL_DECRYPT_FAILED',
  'ZCODE_PROVIDER_UNSUPPORTED', 'ZCODE_LOGIN_REQUIRED', 'ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING',
  'ZCODE_TEAM_ACCESS_DENIED', 'ZCODE_PERSONAL_KEY_MISSING', 'ZCODE_PERSONAL_PROJECT_UNAVAILABLE', 'ZCODE_PLAN_ACCESS_DENIED', 'ZCODE_INDIVIDUAL_PLAN_UNAVAILABLE', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR',
  'ZCODE_UNTRUSTED_ENDPOINT', 'ZCODE_INVALID_RESPONSE', 'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_BILLING_ERROR',
  'VERIFICATION_REQUIRED', 'UNAUTHENTICATED', 'DISCONNECTED', 'CLOSED', 'CANCELLED', 'TIMEOUT',
  'PROCESS_EXIT_UNCONFIRMED', 'TOOL_BLOCKED', 'MODELS_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'BUSY', 'THREAD_BUSY',
  'RATE_LIMITED', 'UNSUPPORTED', 'MISSING']);
const safeCode = code => SAFE_ERRORS.has(code) ? code : 'ZCODE_INVALID_RESPONSE';
function callArguments(method, args) {
  if (!METHODS.has(method) || !Array.isArray(args)) throw fail('INVALID_REQUEST');
  if (['start', 'readAccount', 'listModels', 'startThread'].includes(method)) {
    if (args.length) throw fail('INVALID_REQUEST'); return [];
  }
  if (method === 'getConsentIdentity') {
    if (args.length !== 1 || !args[0] || !validModel(args[0].model)) throw fail('INVALID_REQUEST');
    return [{ model: args[0].model }];
  }
  if (method === 'resumeThread') {
    if (args.length !== 1 || !validId(args[0])) throw fail('INVALID_REQUEST'); return [args[0]];
  }
  if (method === 'interruptTurn') {
    if (args.length !== 2 || !args.every(validId)) throw fail('INVALID_REQUEST'); return [...args];
  }
  const [id, text, selection] = args;
  if (args.length !== 3 || !validId(id) || !cleanText(text, 8000) || !text.trim() ||
    !selection || !validModel(selection.model) || typeof selection.effort !== 'string' || !/^[a-z]{1,16}$/.test(selection.effort)) throw fail('INVALID_REQUEST');
  return [id, text, { model: selection.model, effort: selection.effort }];
}
function projectResult(method, value) {
  if (method === 'start' || method === 'interruptTurn') return null;
  if (method === 'getConsentIdentity') {
    if (!validAccount(value?.accountKey) || value.channel !== 'official' || !['https://zcode.z.ai', 'https://api.z.ai', 'https://open.bigmodel.cn'].includes(value.recipientOrigin)) throw fail('ZCODE_INVALID_RESPONSE');
    return { accountKey: value.accountKey, recipientOrigin: value.recipientOrigin, channel: 'official' };
  }
  if (method === 'readAccount') {
    if (value?.authenticated !== true || !validAccount(value.accountKey)) throw fail('ZCODE_INVALID_RESPONSE');
    return { authenticated: true, accountKey: value.accountKey };
  }
  if (method === 'listModels') {
    if (!Array.isArray(value) || !value.length || value.length > 100) throw fail('ZCODE_INVALID_RESPONSE');
    return value.map(row => {
      if (!validModel(row?.id) || !cleanText(row.displayName, 256) || !row.displayName ||
        !Array.isArray(row.supportedReasoningEfforts) || !row.supportedReasoningEfforts.length || row.supportedReasoningEfforts.length > 24 ||
        !row.supportedReasoningEfforts.every(item => typeof item === 'string' && /^[a-z]{1,16}$/.test(item)) ||
        !row.supportedReasoningEfforts.includes(row.defaultReasoningEffort) || typeof row.isDefault !== 'boolean') throw fail('ZCODE_INVALID_RESPONSE');
      return { id: row.id, displayName: row.displayName, supportedReasoningEfforts: [...row.supportedReasoningEfforts],
        defaultReasoningEffort: row.defaultReasoningEffort, isDefault: row.isDefault };
    });
  }
  if (!validId(value?.id)) throw fail('ZCODE_INVALID_RESPONSE');
  if (method === 'startTurn') {
    if (value.status !== 'inProgress') throw fail('ZCODE_INVALID_RESPONSE'); return { id: value.id, status: 'inProgress' };
  }
  if (!['idle', 'active'].includes(value.status) || value.activeTurnId !== null && !validId(value.activeTurnId)) throw fail('ZCODE_INVALID_RESPONSE');
  return { id: value.id, status: value.status, activeTurnId: value.activeTurnId };
}
function projectNotification(packet) {
  const params = packet?.params || {}, threadId = params.threadId;
  if (packet?.method === 'account/updated') return { method: packet.method, params: validId(threadId) ? { threadId } : {} };
  if (!validId(threadId)) throw fail('ZCODE_INVALID_RESPONSE');
  const base = { threadId };
  if (packet.method === 'turn/started' || packet.method === 'turn/completed') {
    const turn = params.turn;
    if (!validId(turn?.id) || !(packet.method === 'turn/started' ? ['inProgress'] : ['completed', 'failed', 'interrupted']).includes(turn.status)) throw fail('ZCODE_INVALID_RESPONSE');
    return { method: packet.method, params: { ...base, turn: { id: turn.id, status: turn.status,
      ...(turn.status === 'failed' ? { errorCode: 'TURN_FAILED' } : {}) } } };
  }
  if (!validId(params.turnId)) throw fail('ZCODE_INVALID_RESPONSE');
  if (packet.method === 'item/agentMessage/delta') {
    if (!validId(params.itemId) || !cleanText(params.delta, 128 * 1024)) throw fail('ZCODE_INVALID_RESPONSE');
    return { method: packet.method, params: { ...base, turnId: params.turnId, itemId: params.itemId, delta: params.delta } };
  }
  if (packet.method === 'item/completed') {
    const item = params.item;
    if (!validId(item?.id) || item.type !== 'agentMessage' || !cleanText(item.text, 128 * 1024) || item.phase !== 'final_answer') throw fail('ZCODE_INVALID_RESPONSE');
    return { method: packet.method, params: { ...base, turnId: params.turnId,
      item: { id: item.id, type: 'agentMessage', text: item.text, phase: 'final_answer' } } };
  }
  throw fail('ZCODE_INVALID_RESPONSE');
}
module.exports = { validAccount, METHODS, SAFE_ERRORS, safeCode, callArguments, projectResult, projectNotification };
