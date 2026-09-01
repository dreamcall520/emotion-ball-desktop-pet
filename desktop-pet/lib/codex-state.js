const UNKNOWN = 'unknown';
const MAX_TASKS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAIT_METHODS = new Set([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput',
  'mcpServer/elicitation/request', 'execCommandApproval', 'applyPatchApproval'
]);
const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
const CLIENT_SOURCES = new Set(['cli', 'vscode', 'exec', 'appServer', 'api']);
const THREAD_SOURCES = new Set([...CLIENT_SOURCES, 'user', 'agent_created_thread', 'agent_forked_thread']);
const TAIL_TURN_KEY = /^tail:[0-9]+:local:(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const isTurnKey = key => typeof key === 'string' && (key.startsWith('turn:') || TAIL_TURN_KEY.test(key));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 200) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const positive = value => Number.isFinite(value) && value > 0;
const isTaskId = value => typeof value === 'string' && UUID.test(value);
const title = value => text(value) || '未命名任务';

function normalizeQuota(raw, now) {
  const windows = [];
  const groups = object(raw?.rateLimitsByLimitId) ? Object.entries(raw.rateLimitsByLimitId).slice(0, 32)
    : object(raw?.rateLimits) ? [[text(raw.rateLimits.limitId, 100) || 'codex', raw.rateLimits]] : [];
  for (const [key, group] of groups) {
    if (!object(group)) continue;
    const id = text(key, 100) || 'unknown';
    for (const slot of ['primary', 'secondary']) {
      const value = group[slot];
      if (!object(value)) continue;
      windows.push({
        id: `${id}:${slot}`, label: text(group.limitName, 100) || id,
        windowMinutes: Number.isSafeInteger(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : UNKNOWN,
        remaining: Number.isFinite(value.usedPercent) && value.usedPercent >= 0 && value.usedPercent <= 100 ? 100 - value.usedPercent : UNKNOWN,
        resetsAt: positive(value.resetsAt) && Number.isSafeInteger(value.resetsAt * 1000) ? value.resetsAt * 1000 : UNKNOWN
      });
    }
  }
  const resetCredits = raw?.rateLimitResetCredits;
  const availableCount = object(resetCredits) ? resetCredits.availableCount : null;
  return {
    windows,
    updatedAt: now,
    ...(Number.isSafeInteger(availableCount) && availableCount >= 0
      ? { resetCreditsAvailable: availableCount } : {})
  };
}

function isEligibleThread(raw) {
  if (!object(raw) || !isTaskId(raw.id) || raw.archived === true || raw.ephemeral === true) return false;
  if (raw.hostId != null && raw.hostId !== 'local') return false;
  if (raw.parentThreadId != null || raw.parent_thread_id != null) return false;
  // Client transport and user-facing task origin are different enums. Agent-created
  // peer tasks are not internal subagents; unknown/object-valued sources stay excluded.
  if (raw.source != null && !CLIENT_SOURCES.has(raw.source)) return false;
  if (raw.threadSource != null && !THREAD_SOURCES.has(raw.threadSource)) return false;
  return true;
}

function normalizeThreadList(raw, limit = MAX_TASKS) {
  if (!Array.isArray(raw?.data)) return [];
  const boundedLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(100, limit)) : MAX_TASKS;
  const seen = new Set();
  return raw.data.filter(isEligibleThread).map(row => ({
    id: row.id, title: title(row.name), state: UNKNOWN, turnId: null,
    updatedAt: positive(row.updatedAt) ? row.updatedAt * 1000 : null, partial: true
  })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }).slice(0, boundedLimit);
}

function projectTurn(raw, location) {
  if (!object(raw)) return null;
  const turnId = text(raw.turnId ?? raw.id, 200);
  if (!turnId) return null;
  return {
    turnId, status: TERMINAL.has(raw.status) || raw.status === 'inProgress' ? raw.status : UNKNOWN,
    startedAt: positive(raw.turnStartedAtMs) ? raw.turnStartedAtMs : null, location
  };
}

function latestTurn(raw) {
  const history = raw.turnHistory;
  if (history?.kind === 'canonical' && object(history.history?.entitiesByKey)) {
    let latest = null;
    let ambiguous = false;
    let count = 0;
    let hasUndated = false;
    for (const [key, entity] of Object.entries(history.history.entitiesByKey)) {
      if (!isTurnKey(key)) continue;
      const next = projectTurn(entity, `canonical:${text(key, 220)}`);
      if (!next) continue;
      count++; hasUndated ||= next.startedAt === null;
      if (!latest || (next.startedAt !== null && (latest.startedAt === null || next.startedAt > latest.startedAt))) {
        latest = next;
        ambiguous = false;
      } else if (next.startedAt === latest.startedAt) ambiguous = true;
    }
    if ((ambiguous || (hasUndated && count > 1)) && latest) latest.orderUnknown = true;
    return latest;
  }
  let latest = null;
  if (Array.isArray(raw.turns)) raw.turns.forEach((turn, index) => {
    const next = projectTurn(turn, `legacy:${index}`);
    if (next) latest = next;
  });
  return latest;
}

function flagsWaiting(flags) {
  return Array.isArray(flags) && flags.some(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput');
}

function requestsWaiting(requests) {
  return Array.isArray(requests) && requests.some(request => WAIT_METHODS.has(request?.method));
}

const waitFlag = value => ['waitingOnApproval', 'waitingOnUserInput'].includes(value) ? value : null;
const waitMethod = value => WAIT_METHODS.has(value) ? value : null;
const scalarList = (value, project) => Array.isArray(value) ? value.slice(0, 64).map(project) : [];
function patchScalarList(list, index, operation, value) {
  if (!Number.isSafeInteger(index) || index < 0 || index > list.length) return false;
  if (operation === 'add') {
    if (list.length >= 64) return false;
    list.splice(index, 0, value);
  } else {
    if (index >= list.length) return false;
    if (operation === 'remove') list.splice(index, 1);
    else list[index] = value;
  }
  return true;
}

// The returned projection contains only scalar metadata and ONE scalar turn record.
// Never keep a reference to a received state/history/request/item object.
function projectTask(raw = {}) {
  return {
    id: isTaskId(raw.id) ? raw.id : null, title: title(raw.title ?? raw.name),
    runtime: ['active', 'idle', 'notLoaded'].includes(raw.threadRuntimeStatus?.type) ? raw.threadRuntimeStatus.type : null,
    runtimeUnknown: raw.threadRuntimeStatus != null && !['active', 'idle'].includes(raw.threadRuntimeStatus?.type),
    flagWaiting: flagsWaiting(raw.threadRuntimeStatus?.activeFlags), requestWaiting: requestsWaiting(raw.requests),
    activeFlags: scalarList(raw.threadRuntimeStatus?.activeFlags, waitFlag),
    requestMethods: scalarList(raw.requests, request => waitMethod(request?.method)),
    requestOverflow: raw.requests?.length > 64,
    flagOverflow: raw.threadRuntimeStatus?.activeFlags?.length > 64,
    turn: latestTurn(raw)
  };
}

function taskFromProjection(projected, now) {
  let state = UNKNOWN;
  const turnStatus = projected.turn?.orderUnknown ? UNKNOWN : projected.turn?.status;
  if (!projected.runtimeUnknown && !projected.requestOverflow && !projected.flagOverflow) {
    if (projected.flagWaiting || projected.requestWaiting) state = 'waiting';
    else if (projected.runtime === 'active') state = 'active';
    else if (TERMINAL.has(turnStatus)) state = turnStatus;
    else if (projected.runtime === 'idle') state = 'idle';
    else if (turnStatus === 'inProgress') state = 'active';
  }
  return { id: projected.id, title: projected.title, state, turnId: projected.turn?.turnId ?? null, updatedAt: now, partial: true };
}

function normalizeTask(raw, now) {
  return taskFromProjection(projectTask(raw), now);
}

function mergeWholeTurn(task, raw, location, canonical, operation) {
  const next = projectTurn(raw, location);
  if (!next || operation === 'remove') return false;
  // Scalar updates cannot establish ordering relative to an omitted ambiguous turn.
  // Only a new full projection can clear this uncertainty.
  if (task.turn?.orderUnknown) next.orderUnknown = true;
  // Local turns retain tail:<generation>:local:<index-or-client-message-id> after
  // receiving their server turnId. Preserve that location for status patches.
  if (canonical && location !== `canonical:turn:${next.turnId}` &&
    !TAIL_TURN_KEY.test(location.slice('canonical:'.length))) return false;
  if (canonical && task.turn?.location === location && task.turn.turnId !== next.turnId) return false;
  if (!task.turn || task.turn.location === location) { task.turn = next; return true; }
  if (canonical) {
    if (next.startedAt === null || task.turn.startedAt === null || next.startedAt === task.turn.startedAt) return false;
    if (next.startedAt > task.turn.startedAt) task.turn = next;
    return true;
  }
  const index = Number(location.slice('legacy:'.length));
  const current = Number(task.turn.location.slice('legacy:'.length));
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(current)) return false;
  if (index > current) { task.turn = next; return true; }
  // Replacing an older legacy turn cannot change the latest one; inserting before it shifts indices.
  return operation === 'replace';
}

function applyTaskPatches(previous, patches) {
  const task = { ...previous, turn: previous.turn ? { ...previous.turn } : null,
    activeFlags: [...previous.activeFlags], requestMethods: [...previous.requestMethods] };
  let needsSnapshot = !Array.isArray(patches);
  for (const patch of Array.isArray(patches) ? patches : []) {
    const path = patch?.path;
    if (!Array.isArray(path) || path.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) continue;
    const root = path[0];
    if (path.length === 0) { needsSnapshot = true; continue; }
    if (!['title', 'threadRuntimeStatus', 'requests', 'turns', 'turnHistory', 'parentThreadId', 'parent_thread_id',
      'source', 'threadSource', 'archived', 'ephemeral', 'hostId', 'id'].includes(root)) continue;
    if (root === 'threadRuntimeStatus' && path.length > 1 && !['type', 'activeFlags'].includes(path[1])) continue;
    if (path.includes('items') || path.includes('params') || path.includes('error')) continue;
    if (!['add', 'replace', 'remove'].includes(patch.op)) { needsSnapshot = true; continue; }
    const value = patch.op === 'remove' ? null : patch.value;
    if (root === 'title' && path.length === 1) task.title = title(value);
    else if (root === 'requests' && path.length === 1) {
      task.requestMethods = scalarList(value, request => waitMethod(request?.method));
      task.requestOverflow = value?.length > 64;
    } else if (root === 'requests' && path.length === 2) {
      if (!patchScalarList(task.requestMethods, path[1], patch.op, waitMethod(value?.method))) needsSnapshot = true;
    } else if (root === 'requests' && path.length === 3 && path[2] === 'method') {
      if (!patchScalarList(task.requestMethods, path[1], 'replace', waitMethod(value))) needsSnapshot = true;
    } else if (root === 'requests' && path.length > 2) continue;
    else if (root === 'threadRuntimeStatus' && path.length === 1) {
      task.runtime = ['active', 'idle', 'notLoaded'].includes(value?.type) ? value.type : null;
      task.runtimeUnknown = !['active', 'idle'].includes(value?.type);
      task.activeFlags = scalarList(value?.activeFlags, waitFlag);
      task.flagOverflow = value?.activeFlags?.length > 64;
    } else if (root === 'threadRuntimeStatus' && path.length === 2 && path[1] === 'type') {
      task.runtime = ['active', 'idle', 'notLoaded'].includes(value) ? value : null;
      task.runtimeUnknown = !['active', 'idle'].includes(value);
    } else if (root === 'threadRuntimeStatus' && path.length === 2 && path[1] === 'activeFlags') {
      task.activeFlags = scalarList(value, waitFlag);
      task.flagOverflow = value?.length > 64;
    } else if (root === 'threadRuntimeStatus' && path.length === 3 && path[1] === 'activeFlags') {
      if (!patchScalarList(task.activeFlags, path[2], patch.op, waitFlag(value))) needsSnapshot = true;
    }
    else if (root === 'turns' || root === 'turnHistory') {
      const canonical = root === 'turnHistory' && path[1] === 'history' && path[2] === 'entitiesByKey';
      const location = root === 'turns' ? `legacy:${path[1]}` : canonical ? `canonical:${path[3]}` : null;
      const fieldIndex = canonical ? 4 : 2;
      if (canonical && typeof path[3] === 'string' && !isTurnKey(path[3])) continue;
      if (path.length >= fieldIndex + 1 && !['status', 'turnId', 'id', 'turnStartedAtMs'].includes(path[fieldIndex])) continue;
      if (location && path.length === fieldIndex) {
        if (!mergeWholeTurn(task, value, location, canonical, patch.op)) needsSnapshot = true;
      } else if (task.turn && task.turn.location === location && path.length === fieldIndex + 1 && path[fieldIndex] === 'status') {
        task.turn.status = TERMINAL.has(value) || value === 'inProgress' ? value : UNKNOWN;
      } else needsSnapshot = true;
    } else needsSnapshot = true;
  }
  task.flagWaiting = task.activeFlags.some(Boolean); task.requestWaiting = task.requestMethods.some(Boolean);
  return { task, needsSnapshot };
}

module.exports = { UNKNOWN, MAX_TASKS, isTaskId, isEligibleThread, normalizeQuota, normalizeThreadList,
  normalizeTask, projectTask, taskFromProjection, applyTaskPatches };
